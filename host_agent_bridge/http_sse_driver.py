"""Current HTTP/SSE binding for the transport-neutral Host Agent kernel."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
import json
import re
from typing import Any, Protocol

from host_agent_bridge.contracts import (
    validate_health,
    validate_metadata_proposal,
    validate_query_response,
)
from host_agent_bridge.neutral_contract import (
    ErrorEvent,
    EvidenceEvent,
    FinalEvent,
    NeutralEvent,
    NeutralInvocation,
    NeutralReadiness,
    StatusEvent,
)

NEUTRAL_INTERFACE_VERSION = "neutral.session.v1"
HTTP_SSE_BINDING_KIND = "http-sse"
HTTP_SSE_BINDING_VERSION = "gui-host-agent-http-sse.v1"
SUPPORTED_OPERATIONS = ("query", "metadata.propose")

MAX_BODY_BYTES = 4 * 1024 * 1024
MAX_SSE_FRAME_BYTES = 256 * 1024
MAX_SSE_FRAMES = 512
MAX_SAFE_ERROR_TEXT = 128

_SAFE_PROVENANCE = re.compile(r"prov:[A-Za-z0-9._:-]+")
_SAFE_ERROR_CODES = frozenset({"BINDING_ERROR", "CANCELLED", "PROVIDER_FAILED", "TOOL_FAILED"})
_SAFE_ERROR_REASONS = frozenset({"provider-failed", "synthetic-tool-failure"})
_SAFE_READINESS_CODES = frozenset({"OFFLINE"})


class CurrentWireClient(Protocol):
    def get_json(self, path: str) -> dict[str, Any]:
        ...

    def post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        ...

    def post_sse(self, path: str, payload: dict[str, Any]) -> list[tuple[str, Any]]:
        ...


class HttpSseBindingError(ValueError):
    """A stable binding failure that never includes an untrusted wire body."""


def _json_size(value: Any) -> int:
    try:
        return len(
            json.dumps(
                value,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
                allow_nan=False,
            ).encode("utf-8")
        )
    except (TypeError, ValueError, OverflowError) as exc:
        raise HttpSseBindingError("current wire value was not finite JSON") from exc


def _require_body_bound(value: Any) -> None:
    if _json_size(value) > MAX_BODY_BYTES:
        raise HttpSseBindingError("current wire response body exceeded the binding limit")


def _safe_provenance(value: Any, fallback: str) -> str:
    if (
        isinstance(value, str)
        and len(value) <= MAX_SAFE_ERROR_TEXT
        and _SAFE_PROVENANCE.fullmatch(value) is not None
    ):
        return value
    return fallback


class HttpSseBindingDriver:
    """Project the current GUI HTTP/SSE wire into Package K neutral events."""

    def __init__(
        self,
        client: CurrentWireClient,
        *,
        interface_version: str = NEUTRAL_INTERFACE_VERSION,
        binding_kind: str = HTTP_SSE_BINDING_KIND,
        binding_version: str = HTTP_SSE_BINDING_VERSION,
        supported_operations: Sequence[str] = SUPPORTED_OPERATIONS,
    ) -> None:
        if not interface_version or not binding_kind or not binding_version:
            raise ValueError("HTTP/SSE binding identity and interface version must be non-empty")
        if not supported_operations or any(
            operation not in SUPPORTED_OPERATIONS for operation in supported_operations
        ):
            raise ValueError("HTTP/SSE binding operations must be a non-empty supported subset")
        self._client = client
        self._interface_version = interface_version
        self._binding_kind = binding_kind
        self._binding_version = binding_version
        self._supported_operations = tuple(supported_operations)

    def readiness(self) -> NeutralReadiness:
        payload = self._client.get_json("/health")
        _require_body_bound(payload)
        try:
            health = validate_health(payload)
        except ValueError as exc:
            raise HttpSseBindingError("current health envelope was invalid") from exc
        available = health.running and health.ready and health.mode == "READY"
        return NeutralReadiness(
            interface_version=self._interface_version,
            supported_operations=self._supported_operations,
            binding_kind=self._binding_kind,
            binding_version=self._binding_version,
            available=available,
            reason=health.reason,
            code=(
                "READY"
                if available
                else health.reason if health.reason in _SAFE_READINESS_CODES else health.mode
            ),
        )

    def invoke(self, invocation: NeutralInvocation) -> Iterable[NeutralEvent | dict[str, Any]]:
        dumped = invocation.model_dump(mode="json")
        payload = dumped["domain_payload"]
        if not isinstance(payload, dict):
            raise HttpSseBindingError("guarded domain payload was not an object")
        _require_body_bound(payload)
        if invocation.request.operation == "query":
            return self._invoke_query(invocation, payload)
        if invocation.request.operation == "metadata.propose":
            return self._invoke_metadata(invocation, payload)
        raise HttpSseBindingError("guarded operation was unsupported")

    def _invoke_query(
        self,
        invocation: NeutralInvocation,
        payload: dict[str, Any],
    ) -> tuple[NeutralEvent | dict[str, Any], ...]:
        frames = self._client.post_sse("/query/stream", payload)
        if not isinstance(frames, list):
            raise HttpSseBindingError("current query stream was not a frame list")
        if len(frames) > MAX_SSE_FRAMES:
            raise HttpSseBindingError("current query stream exceeded the frame-count limit")

        total_bytes = 0
        events: list[NeutralEvent | dict[str, Any]] = []
        for frame_index, frame in enumerate(frames):
            if not isinstance(frame, tuple) or len(frame) != 2:
                raise HttpSseBindingError("current query stream contained an invalid frame")
            event_type, data = frame
            frame_bytes = _json_size([event_type, data])
            if frame_bytes > MAX_SSE_FRAME_BYTES:
                raise HttpSseBindingError("current query stream frame exceeded the frame limit")
            total_bytes += frame_bytes
            if total_bytes > MAX_BODY_BYTES:
                raise HttpSseBindingError("current query stream exceeded the body limit")
            events.extend(self._map_query_frame(invocation, frame_index, event_type, data))
        return tuple(events)

    def _map_query_frame(
        self,
        invocation: NeutralInvocation,
        frame_index: int,
        event_type: Any,
        data: Any,
    ) -> tuple[NeutralEvent | dict[str, Any], ...]:
        request_id = invocation.request.request_id
        if not isinstance(event_type, str) or not isinstance(data, dict):
            raise HttpSseBindingError("current query stream frame shape was invalid")
        if "request_id" in data:
            raw_request_id = data["request_id"]
            if not isinstance(raw_request_id, str) or not raw_request_id:
                raise HttpSseBindingError("current query event request_id was invalid")
            event_request_id = raw_request_id
        else:
            event_request_id = request_id
        if "sequence" in data:
            raw_sequence = data["sequence"]
            if (
                isinstance(raw_sequence, bool)
                or not isinstance(raw_sequence, int)
                or raw_sequence < 0
            ):
                raise HttpSseBindingError("current query event sequence was invalid")
            sequence = raw_sequence
        else:
            sequence = frame_index
        fallback_provenance = invocation.request.provenance_ref or "http-sse:query"

        if event_type == "delta":
            text = data.get("text")
            if not isinstance(text, str) or not text or len(text.encode("utf-8")) > MAX_SSE_FRAME_BYTES:
                raise HttpSseBindingError("current query delta shape was invalid")
            return ()
        if event_type == "status":
            phase = data.get("phase")
            message = data.get("message")
            if not isinstance(phase, str) or not phase or not isinstance(message, str) or not message:
                raise HttpSseBindingError("current query status shape was invalid")
            return (
                StatusEvent(
                    request_id=event_request_id,
                    sequence=sequence,
                    phase=phase,
                    message=message,
                ),
            )
        if event_type == "evidence":
            evidence = data.get("evidence")
            if evidence is None:
                evidence = {
                    key: value
                    for key, value in data.items()
                    if key not in {"request_id", "sequence", "provenance_ref"}
                }
            if not isinstance(evidence, dict):
                raise HttpSseBindingError("current query evidence shape was invalid")
            return (
                EvidenceEvent(
                    request_id=event_request_id,
                    sequence=sequence,
                    evidence=evidence,
                    provenance_ref=_safe_provenance(data.get("provenance_ref"), fallback_provenance),
                ),
            )
        if event_type == "final":
            try:
                validate_query_response(data)
            except ValueError as exc:
                raise HttpSseBindingError("current query final envelope was invalid") from exc
            return (
                FinalEvent(
                    request_id=event_request_id,
                    sequence=sequence,
                    domain_envelope=data,
                    provenance_ref=_safe_provenance(data.get("provenance_ref"), fallback_provenance),
                ),
            )
        if event_type == "error":
            return (self._map_error(invocation, event_request_id, sequence, data),)

        return (
            {
                "request_id": event_request_id,
                "sequence": sequence,
                "unexpected_current_event": event_type,
            },
        )

    def _invoke_metadata(
        self,
        invocation: NeutralInvocation,
        payload: dict[str, Any],
    ) -> tuple[FinalEvent]:
        response = self._client.post_json("/metadata/propose", payload)
        _require_body_bound(response)
        try:
            validate_metadata_proposal(response)
        except ValueError as exc:
            raise HttpSseBindingError("current metadata envelope was invalid") from exc
        request_id = response.get("request_id")
        if not isinstance(request_id, str) or not request_id:
            raise HttpSseBindingError("current metadata request correlation was invalid")
        return (
            FinalEvent(
                request_id=request_id,
                sequence=0,
                domain_envelope=response,
                provenance_ref=_safe_provenance(
                    response.get("provenance_ref"),
                    invocation.request.provenance_ref or "http-sse:metadata",
                ),
            ),
        )

    @staticmethod
    def _map_error(
        invocation: NeutralInvocation,
        request_id: str,
        sequence: int,
        data: Mapping[str, Any],
    ) -> ErrorEvent:
        raw_code = data.get("code")
        code = raw_code if raw_code in _SAFE_ERROR_CODES else "BINDING_ERROR"
        raw_reason = data.get("reason")
        reason = raw_reason if raw_reason in _SAFE_ERROR_REASONS else None
        provider_outcome = data.get("provider_outcome")
        if provider_outcome not in {"succeeded", "failed", "unknown"}:
            provider_outcome = "unknown"
        effect_known = data.get("effect_known")
        if not isinstance(effect_known, bool):
            effect_known = False
        presentation = data.get("presentation_state")
        presentation_state = presentation.lower() if isinstance(presentation, str) else "failed"
        if code == "CANCELLED":
            presentation_state = "canceled"
        elif presentation_state != "failed":
            presentation_state = "failed"

        unchanged: dict[str, Any] = {"code": code}
        if reason is not None:
            unchanged["reason"] = reason
        unchanged["provider_outcome"] = provider_outcome
        unchanged["effect_known"] = effect_known

        return ErrorEvent(
            request_id=request_id,
            sequence=sequence,
            code=code,
            layer="binding",
            safe_message="Host agent binding reported an error.",
            retryable=data.get("retryable") if isinstance(data.get("retryable"), bool) else False,
            unchanged_provider_error_or_outcome=unchanged,
            provenance_ref=invocation.request.provenance_ref,
            effect_known=effect_known,
            presentation_state=presentation_state,
            provider_outcome=provider_outcome,
        )


__all__ = [
    "HTTP_SSE_BINDING_KIND",
    "HTTP_SSE_BINDING_VERSION",
    "MAX_BODY_BYTES",
    "MAX_SSE_FRAME_BYTES",
    "MAX_SSE_FRAMES",
    "NEUTRAL_INTERFACE_VERSION",
    "HttpSseBindingDriver",
]
