"""Life Index-owned validation guard for a neutral Host Agent binding."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
import hashlib
import json
import threading
from typing import Any, Protocol

from pydantic import ValidationError

from host_agent_bridge.neutral_contract import (
    ClientContextSnapshot,
    ErrorEvent,
    FinalEvent,
    NeutralEvent,
    NeutralInvocation,
    NeutralReadiness,
    NeutralSessionRequest,
    SessionAuthority,
    SessionExposureProfile,
    _build_neutral_invocation,
    _freeze_json,
    validate_neutral_event,
)

DEFAULT_MAX_RETAINED_REQUESTS = 256
DEFAULT_MAX_TERMINAL_BYTES = 256 * 1024


class NeutralKernelError(ValueError):
    """Stable, safe preflight or protocol-violation result."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.safe_message = message


class RawNeutralBinding(Protocol):
    def readiness(self) -> NeutralReadiness | dict[str, Any]:
        ...

    def invoke(self, invocation: NeutralInvocation) -> Iterable[NeutralEvent | dict[str, Any]]:
        ...


@dataclass
class _RequestRecord:
    """Bounded session state; never retains raw request or domain payload data."""

    digest: str | None
    in_flight: bool
    registered_waiters: int = 0
    wake: threading.Event = field(default_factory=threading.Event)
    terminal: FinalEvent | ErrorEvent | None = None


class NeutralSessionGuard:
    """Fail-closed session validation around an injected raw binding.

    The guard knows only opaque capability IDs supplied by its owner. It never
    imports a registry, maps a session operation to a tool, or interprets a
    domain envelope. Request records retain only a SHA-256 correlation digest,
    lifecycle state, a bounded waiter count, a wait primitive, and one bounded
    winning terminal.
    """

    def __init__(
        self,
        raw_binding: RawNeutralBinding,
        *,
        available_capability_ids: Sequence[str],
        interface_versions: Sequence[str],
        binding_kind: str,
        binding_version: str,
        max_retained_requests: int = DEFAULT_MAX_RETAINED_REQUESTS,
        max_terminal_bytes: int = DEFAULT_MAX_TERMINAL_BYTES,
    ) -> None:
        if not binding_kind or not binding_version:
            raise ValueError("binding kind and version must be non-empty")
        if not interface_versions or any(not value for value in interface_versions):
            raise ValueError("at least one non-empty interface version is required")
        if any(not value for value in available_capability_ids):
            raise ValueError("available capability IDs must be non-empty")
        if len(set(available_capability_ids)) != len(tuple(available_capability_ids)):
            raise ValueError("available capability IDs must not contain duplicates")
        if isinstance(max_retained_requests, bool) or not isinstance(max_retained_requests, int):
            raise ValueError("max_retained_requests must be a positive integer")
        if max_retained_requests <= 0:
            raise ValueError("max_retained_requests must be a positive integer")
        if isinstance(max_terminal_bytes, bool) or not isinstance(max_terminal_bytes, int):
            raise ValueError("max_terminal_bytes must be a positive integer")
        if max_terminal_bytes <= 0:
            raise ValueError("max_terminal_bytes must be a positive integer")

        self._raw_binding = raw_binding
        self._available_capability_ids = frozenset(available_capability_ids)
        self._interface_versions = frozenset(interface_versions)
        self._binding_kind = binding_kind
        self._binding_version = binding_version
        self._max_retained_requests = max_retained_requests
        self._max_terminal_bytes = max_terminal_bytes
        self._lock = threading.RLock()
        self._closed = False
        self._records: dict[str, _RequestRecord] = {}

    def readiness(
        self,
        profile: SessionExposureProfile,
        authority: SessionAuthority,
    ) -> NeutralReadiness:
        self._ensure_open()
        self._validate_profile_authority(profile, authority)
        readiness = self._validated_readiness(profile)
        self._ensure_open()
        return readiness

    def _validated_readiness(self, profile: SessionExposureProfile) -> NeutralReadiness:
        try:
            raw = NeutralReadiness.model_validate(self._raw_binding.readiness())
        except Exception as exc:
            raise NeutralKernelError("UNAVAILABLE", "Binding readiness was unavailable.") from exc

        incompatible = (
            raw.interface_version not in self._interface_versions
            or raw.binding_kind != self._binding_kind
            or raw.binding_version != self._binding_version
            or not set(profile.allowed_session_operations).issubset(raw.supported_operations)
        )
        if incompatible:
            return raw.model_copy(
                update={
                    "available": False,
                    "reason": "UNSUPPORTED_VERSION",
                    "code": "UNSUPPORTED_VERSION",
                }
            )
        return raw

    def invoke(
        self,
        request: NeutralSessionRequest,
        profile: SessionExposureProfile,
        authority: SessionAuthority,
        context: ClientContextSnapshot,
        *,
        domain_payload: Mapping[str, Any],
    ) -> tuple[NeutralEvent, ...]:
        self._ensure_open()
        self._validate_profile_authority(profile, authority)
        self._validate_request(request, profile, authority, context)
        evaluated_payload = self._evaluate_domain_payload(request, domain_payload)
        digest = self._request_digest(request, profile, authority, context, evaluated_payload)

        while True:
            owner, record, cached, registered_waiter = self._reserve(
                request.request_id, digest
            )
            if cached is not None:
                return (cached,)
            if owner:
                break
            if not registered_waiter:  # pragma: no cover - internal invariant
                raise RuntimeError("non-owner request was not registered as a waiter")
            winner = self._wait_for_registered_record(record)
            if winner is not None:
                return (winner,)
            # A pre-dispatch failure released this generation without a
            # provider effect. Retry rather than leaving the waiter stuck.

        try:
            readiness = self._validated_readiness(profile)
            if not readiness.available:
                code = (
                    "UNSUPPORTED_VERSION"
                    if readiness.code == "UNSUPPORTED_VERSION"
                    else "UNAVAILABLE"
                )
                message = (
                    "Binding interface or operation is unsupported."
                    if code == "UNSUPPORTED_VERSION"
                    else "Binding is unavailable."
                )
                raise NeutralKernelError(code, message)
            invocation = _build_neutral_invocation(
                request=request,
                authority=authority,
                profile=profile,
                domain_payload=evaluated_payload,
            )
        except NeutralKernelError as exc:
            won = self._release_pre_dispatch(request.request_id, record)
            if won is not None:
                return (won,)
            raise exc
        except Exception as exc:
            won = self._release_pre_dispatch(request.request_id, record)
            if won is not None:
                return (won,)
            raise NeutralKernelError("INVOCATION_INVALID", "Guarded invocation was invalid.") from exc

        events: list[NeutralEvent] = []
        previous_sequence: int | None = None
        terminal: FinalEvent | ErrorEvent | None = None
        candidate_events: tuple[NeutralEvent, ...] | None = None
        try:
            raw_events = self._raw_binding.invoke(invocation)
            for raw_event in raw_events:
                try:
                    event = validate_neutral_event(raw_event)
                except ValidationError as exc:
                    raise NeutralKernelError("EVENT_INVALID", "Binding event was invalid.") from exc
                if event.request_id != request.request_id:
                    raise NeutralKernelError(
                        "EVENT_REQUEST_MISMATCH", "Binding event request_id did not match."
                    )
                if terminal is not None:
                    if isinstance(event, (FinalEvent, ErrorEvent)):
                        raise NeutralKernelError(
                            "DUPLICATE_TERMINAL", "Binding emitted a second terminal event."
                        )
                    raise NeutralKernelError("LATE_FRAME", "Binding emitted an event after the terminal event.")
                if previous_sequence is not None and event.sequence <= previous_sequence:
                    raise NeutralKernelError(
                        "EVENT_SEQUENCE", "Binding event sequence was not strictly monotonic."
                    )
                previous_sequence = event.sequence
                events.append(event)
                if isinstance(event, (FinalEvent, ErrorEvent)):
                    terminal = event
        except NeutralKernelError as exc:
            terminal = self._binding_error(request, exc.code, protocol_violation=True)
        except Exception:
            terminal = self._binding_error(request, "BINDING_FAILURE", protocol_violation=False)
        else:
            if terminal is None:
                terminal = self._binding_error(request, "MISSING_TERMINAL", protocol_violation=True)
            else:
                candidate_events = tuple(events)

        return self._complete(request.request_id, record, terminal, candidate_events)

    def cancel(self, request_id: str, *, provenance_ref: str | None) -> FinalEvent | ErrorEvent:
        """Record cancellation locally; no transport-level cancellation is claimed."""

        if not request_id:
            raise ValueError("request_id must be non-empty")
        candidate = ErrorEvent(
            request_id=request_id,
            sequence=0,
            code="CANCELLED",
            layer="session",
            safe_message="Request canceled.",
            retryable=False,
            unchanged_provider_error_or_outcome=None,
            provenance_ref=provenance_ref,
            effect_known=False,
            presentation_state="canceled",
            provider_outcome="unknown",
        )
        with self._lock:
            self._raise_if_closed_locked()
            record = self._records.get(request_id)
            if record is not None:
                if record.terminal is not None:
                    return record.terminal
            else:
                if len(self._records) >= self._max_retained_requests:
                    raise NeutralKernelError(
                        "SESSION_CAPACITY", "Session request retention capacity was reached."
                    )
                self._ensure_terminal_limit(request_id)
                record = _RequestRecord(digest=None, in_flight=False)
                self._records[request_id] = record
            record.terminal = self._bounded_terminal(candidate)
            record.wake.set()
            return record.terminal

    def terminal_for(self, request_id: str) -> FinalEvent | ErrorEvent | None:
        with self._lock:
            if self._closed:
                return None
            record = self._records.get(request_id)
            return record.terminal if record is not None else None

    def release(self, request_id: str) -> bool:
        """Forget one completed request; missing/repeated release returns False."""

        if not request_id:
            raise ValueError("request_id must be non-empty")
        with self._lock:
            record = self._records.get(request_id)
            if record is None:
                return False
            if record.in_flight or record.registered_waiters:
                raise NeutralKernelError("REQUEST_IN_FLIGHT", "An active request cannot be released.")
            del self._records[request_id]
            return True

    def close(self) -> None:
        """Idempotently close the session, forget records, and wake all waiters."""

        with self._lock:
            if self._closed:
                return
            self._closed = True
            records = tuple(self._records.values())
            self._records.clear()
            for record in records:
                record.wake.set()

    def _reserve(
        self,
        request_id: str,
        digest: str,
    ) -> tuple[bool, _RequestRecord, FinalEvent | ErrorEvent | None, bool]:
        with self._lock:
            self._raise_if_closed_locked()
            record = self._records.get(request_id)
            if record is not None:
                if record.digest is not None and record.digest != digest:
                    raise NeutralKernelError(
                        "REQUEST_ID_REUSE", "request_id was reused with different correlation."
                    )
                if record.digest is None:
                    record.digest = digest
                if record.terminal is not None:
                    return False, record, record.terminal, False
                if record.in_flight:
                    record.registered_waiters += 1
                    return False, record, None, True
                record.in_flight = True
                record.wake.clear()
                return True, record, None, False
            if len(self._records) >= self._max_retained_requests:
                raise NeutralKernelError(
                    "SESSION_CAPACITY", "Session request retention capacity was reached."
                )
            self._ensure_terminal_limit(request_id)
            record = _RequestRecord(digest=digest, in_flight=True)
            self._records[request_id] = record
            return True, record, None, False

    def _wait_for_registered_record(
        self,
        record: _RequestRecord,
    ) -> FinalEvent | ErrorEvent | None:
        try:
            record.wake.wait()
            with self._lock:
                self._raise_if_closed_locked()
                # A terminal belongs to this exact record generation. Release
                # cannot remove it while this registered waiter is outstanding.
                if record.terminal is not None:
                    return record.terminal
                return None
        finally:
            with self._lock:
                if record.registered_waiters <= 0:  # pragma: no cover - invariant defense
                    raise RuntimeError("registered waiter count underflow")
                record.registered_waiters -= 1

    def _release_pre_dispatch(
        self,
        request_id: str,
        record: _RequestRecord,
    ) -> FinalEvent | ErrorEvent | None:
        with self._lock:
            self._raise_if_closed_locked()
            current = self._records.get(request_id)
            if current is not record:
                raise NeutralKernelError("SESSION_CLOSED", "Session guard is closed.")
            record.in_flight = False
            if record.terminal is not None:
                record.wake.set()
                return record.terminal
            del self._records[request_id]
            record.wake.set()
            return None

    def _complete(
        self,
        request_id: str,
        record: _RequestRecord,
        candidate: FinalEvent | ErrorEvent,
        candidate_events: tuple[NeutralEvent, ...] | None,
    ) -> tuple[NeutralEvent, ...]:
        with self._lock:
            self._raise_if_closed_locked()
            if self._records.get(request_id) is not record:
                raise NeutralKernelError("SESSION_CLOSED", "Session guard is closed.")
            record.in_flight = False
            if record.terminal is None:
                record.terminal = self._bounded_terminal(candidate)
            winner = record.terminal
            record.wake.set()
            if winner is candidate and candidate_events is not None:
                return candidate_events
            return (winner,)

    def _bounded_terminal(self, candidate: FinalEvent | ErrorEvent) -> FinalEvent | ErrorEvent:
        if self._terminal_size(candidate) <= self._max_terminal_bytes:
            return candidate
        replacement = self._terminal_oversize_error(candidate.request_id)
        if self._terminal_size(replacement) > self._max_terminal_bytes:
            raise NeutralKernelError(
                "TERMINAL_LIMIT_INVALID",
                "Terminal retention limit cannot hold a sanitized terminal.",
            )
        return replacement

    @staticmethod
    def _terminal_oversize_error(request_id: str) -> ErrorEvent:
        return ErrorEvent(
            request_id=request_id,
            sequence=0,
            code="TERMINAL_OVERSIZE",
            layer="binding",
            safe_message="Binding terminal exceeded the retention limit.",
            retryable=False,
            unchanged_provider_error_or_outcome=None,
            provenance_ref=None,
            effect_known=False,
            presentation_state="failed",
            provider_outcome="unknown",
        )

    def _ensure_terminal_limit(self, request_id: str) -> None:
        if self._terminal_size(self._terminal_oversize_error(request_id)) > self._max_terminal_bytes:
            raise NeutralKernelError(
                "TERMINAL_LIMIT_INVALID",
                "Terminal retention limit cannot hold a sanitized terminal.",
            )

    @staticmethod
    def _terminal_size(terminal: FinalEvent | ErrorEvent) -> int:
        return len(
            json.dumps(
                terminal.model_dump(mode="json"),
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        )

    @staticmethod
    def _binding_error(
        request: NeutralSessionRequest,
        code: str,
        *,
        protocol_violation: bool,
    ) -> ErrorEvent:
        return ErrorEvent(
            request_id=request.request_id,
            sequence=0,
            code=code,
            layer="binding",
            safe_message=(
                "Binding returned an invalid event stream."
                if protocol_violation
                else "Binding invocation failed."
            ),
            retryable=False,
            unchanged_provider_error_or_outcome=None,
            provenance_ref=request.provenance_ref,
            effect_known=False,
            presentation_state="failed",
            provider_outcome="unknown",
        )

    @staticmethod
    def _request_digest(
        request: NeutralSessionRequest,
        profile: SessionExposureProfile,
        authority: SessionAuthority,
        context: ClientContextSnapshot,
        domain_payload: Mapping[str, Any],
    ) -> str:
        payload = {
            "request": request.model_dump(mode="json"),
            "profile": profile.model_dump(mode="json"),
            "authority": authority.model_dump(mode="json"),
            "context": context.model_dump(mode="json"),
            "domain_payload": domain_payload,
        }
        canonical = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(canonical).hexdigest()

    def _ensure_open(self) -> None:
        with self._lock:
            self._raise_if_closed_locked()

    def _raise_if_closed_locked(self) -> None:
        if self._closed:
            raise NeutralKernelError("SESSION_CLOSED", "Session guard is closed.")

    def _validate_profile_authority(
        self,
        profile: SessionExposureProfile,
        authority: SessionAuthority,
    ) -> None:
        unavailable = set(profile.capability_ids) - self._available_capability_ids
        if unavailable:
            raise NeutralKernelError(
                "CAPABILITY_NOT_AVAILABLE",
                "Exposure profile contains a capability outside the injected authority.",
            )
        if authority.exposure_profile_ref != profile.profile_id:
            raise NeutralKernelError(
                "PROFILE_MISMATCH", "Session authority profile reference did not match."
            )
        if not set(authority.allowed_session_operations).issubset(profile.allowed_session_operations):
            raise NeutralKernelError(
                "OPERATION_SCOPE_MISMATCH",
                "Session authority operations were not coherent with the exposure profile.",
            )

    def _validate_request(
        self,
        request: NeutralSessionRequest,
        profile: SessionExposureProfile,
        authority: SessionAuthority,
        context: ClientContextSnapshot,
    ) -> None:
        if request.session_id != authority.session_id:
            raise NeutralKernelError("SESSION_MISMATCH", "Request session_id did not match authority.")
        if request.context_id != context.context_id or request.context_snapshot != context:
            raise NeutralKernelError("CONTEXT_MISMATCH", "Request context did not match the supplied snapshot.")
        if request.exposure_profile_ref != profile.profile_id:
            raise NeutralKernelError("PROFILE_MISMATCH", "Request exposure profile reference did not match.")
        if request.binding_kind != self._binding_kind or request.binding_version != self._binding_version:
            raise NeutralKernelError("BINDING_MISMATCH", "Request binding kind or version did not match.")
        if request.operation not in profile.allowed_session_operations:
            raise NeutralKernelError("OPERATION_NOT_ALLOWED", "Request operation was not allowed by the profile.")
        if request.operation not in authority.allowed_session_operations:
            raise NeutralKernelError("OPERATION_NOT_ALLOWED", "Request operation was not allowed by authority.")
        requested = set(request.requested_capability_ids)
        if not requested.issubset(profile.capability_ids):
            raise NeutralKernelError("CAPABILITY_NOT_ALLOWED", "Requested capability was not allowed by the profile.")
        if not requested.issubset(self._available_capability_ids):
            raise NeutralKernelError("CAPABILITY_NOT_AVAILABLE", "Requested capability was not available.")

    @staticmethod
    def _evaluate_domain_payload(
        request: NeutralSessionRequest,
        domain_payload: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        if not isinstance(domain_payload, Mapping):
            raise NeutralKernelError("DOMAIN_PAYLOAD_INVALID", "Domain payload must be a JSON object.")
        payload = dict(domain_payload)
        if "request_id" in payload and payload["request_id"] != request.request_id:
            raise NeutralKernelError(
                "DOMAIN_REQUEST_MISMATCH",
                "Domain payload request_id did not match the authoritative request.",
            )
        payload["request_id"] = request.request_id
        try:
            return _freeze_json(payload, path="domain_payload")
        except (TypeError, ValueError) as exc:
            raise NeutralKernelError(
                "DOMAIN_PAYLOAD_INVALID", "Domain payload was not JSON-compatible."
            ) from exc


__all__ = [
    "DEFAULT_MAX_RETAINED_REQUESTS",
    "DEFAULT_MAX_TERMINAL_BYTES",
    "NeutralKernelError",
    "NeutralSessionGuard",
    "RawNeutralBinding",
]
