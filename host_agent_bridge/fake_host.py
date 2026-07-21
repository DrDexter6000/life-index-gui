"""Deterministic synthetic Host Agent binding for neutral-kernel tests."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any, Literal

from pydantic import ValidationError

from host_agent_bridge.neutral_contract import (
    ClientContextSnapshot,
    ContextFact,
    ErrorEvent,
    EvidenceEvent,
    FinalEvent,
    NeutralEvent,
    NeutralInvocation,
    NeutralReadiness,
    NeutralSessionRequest,
    SessionAuthority,
    SessionExposureProfile,
    StatusEvent,
)
from host_agent_bridge.neutral_vectors import (
    AuthoritySpec,
    ContextSpec,
    EventSpec,
    NeutralVector,
    ProfileSpec,
    ReadinessSpec,
    RequestSpec,
    VectorObservation,
)
from host_agent_bridge.session_guard import NeutralKernelError, NeutralSessionGuard


class DeterministicFakeHost:
    """A no-model, no-network, no-data fake with observable call counts."""

    def __init__(
        self,
        *,
        readiness: NeutralReadiness | dict[str, Any],
        events_by_request: Mapping[str, Iterable[NeutralEvent | dict[str, Any]]] | None = None,
        invoke_exception: Exception | None = None,
        validate_event_correlation: bool = True,
    ) -> None:
        self._readiness = readiness
        self._events_by_request = {
            request_id: tuple(events) for request_id, events in (events_by_request or {}).items()
        }
        self._invoke_exception = invoke_exception
        self._validate_event_correlation = validate_event_correlation
        self.readiness_call_count = 0
        self.invoke_call_count = 0
        self.invoked_request_ids: list[str] = []
        self.invocations: list[NeutralInvocation] = []

    def readiness(self) -> NeutralReadiness | dict[str, Any]:
        self.readiness_call_count += 1
        return self._readiness

    def invoke(self, invocation: NeutralInvocation) -> tuple[NeutralEvent | dict[str, Any], ...]:
        self.invoke_call_count += 1
        self.invocations.append(invocation)
        request_id = invocation.request.request_id
        self.invoked_request_ids.append(request_id)
        if invocation.domain_payload.get("request_id") != request_id:
            raise ValueError("guarded domain payload request_id did not match request")
        if self._invoke_exception is not None:
            raise self._invoke_exception
        events = self._events_by_request.get(request_id, ())
        if self._validate_event_correlation:
            for event in events:
                event_request_id = (
                    event.request_id
                    if isinstance(event, (StatusEvent, EvidenceEvent, FinalEvent, ErrorEvent))
                    else event.get("request_id")
                )
                if event_request_id != request_id:
                    raise ValueError("fake event request_id did not match guarded invocation")
                if isinstance(event, FinalEvent) and event.domain_envelope.get("request_id") != request_id:
                    raise ValueError("fake final domain-envelope request_id did not match guarded invocation")
                if isinstance(event, Mapping) and "domain_envelope" in event:
                    envelope = event.get("domain_envelope")
                    if not isinstance(envelope, Mapping) or envelope.get("request_id") != request_id:
                        raise ValueError(
                            "fake final domain-envelope request_id did not match guarded invocation"
                        )
        return events


class FakeNeutralVectorHarness:
    """Materialize neutral vectors for one truthful synthetic binding identity."""

    def __init__(
        self,
        *,
        available_capability_ids: tuple[str, ...],
        binding_kind: str,
        binding_version: str,
        interface_version: str = "neutral.session.v1",
    ) -> None:
        if len(available_capability_ids) < 3:
            raise ValueError("vector harness requires at least three injected capability IDs")
        if len(set(available_capability_ids)) != len(available_capability_ids):
            raise ValueError("injected capability IDs must be distinct")
        if not binding_kind or not binding_version or not interface_version:
            raise ValueError("binding identity and interface version must be non-empty")
        self._available_capability_ids = available_capability_ids
        self._binding_kind = binding_kind
        self._binding_version = binding_version
        self._interface_version = interface_version
        self.seen_vectors: list[NeutralVector] = []
        self.materialized_binding_identities: list[tuple[str, str]] = []

    def execute(self, vector: NeutralVector) -> VectorObservation:
        self.seen_vectors.append(vector)
        self.materialized_binding_identities.append((self._binding_kind, self._binding_version))

        context = self._materialize_context(vector.context) if vector.context is not None else None
        profile = self._materialize_profile(vector.profile)
        authority = self._materialize_authority(vector.authority, profile)
        readiness = self._materialize_readiness(vector.readiness)
        request = (
            self._materialize_request(vector.request, context, profile, authority)
            if vector.request is not None and context is not None
            else None
        )
        raw_events = self._materialize_events(vector.raw_events, request) if request is not None else ()
        events_by_request = {request.request_id: raw_events} if request is not None else {}
        fake = DeterministicFakeHost(
            readiness=readiness,
            events_by_request=events_by_request,
            invoke_exception=(
                RuntimeError("synthetic unsafe binding detail")
                if vector.action == "binding-exception"
                else None
            ),
            validate_event_correlation=False,
        )
        guard = NeutralSessionGuard(
            fake,
            available_capability_ids=self._available_capability_ids,
            interface_versions=(self._interface_version,),
            binding_kind=self._binding_kind,
            binding_version=self._binding_version,
        )

        reason = ""
        terminal: FinalEvent | ErrorEvent | None = None
        available: bool | None = None
        retry_stable: bool | None = None
        payload = self._materialize_domain_payload(vector.request) if vector.request is not None else {}

        try:
            if vector.action == "readiness":
                ready = guard.readiness(profile, authority)
                reason = ready.code
                available = ready.available
            elif vector.action == "cancel-symmetry":
                reason = self._observe_cancel_symmetry()
            else:
                if request is None or context is None:
                    raise AssertionError(f"{vector.name}: action requires request and context specs")
                if vector.action == "invoke":
                    terminal = guard.invoke(
                        request,
                        profile,
                        authority,
                        context,
                        domain_payload=payload,
                    )[-1]
                elif vector.action == "cancel-before":
                    first = guard.cancel(request.request_id, provenance_ref="prov:cancel")
                    returned = guard.invoke(
                        request,
                        profile,
                        authority,
                        context,
                        domain_payload=payload,
                    )
                    terminal = returned[-1]
                    retry_stable = returned == (first,) and terminal is first
                elif vector.action == "cancel-duplicate":
                    first = guard.cancel(request.request_id, provenance_ref="prov:cancel")
                    second = guard.cancel(request.request_id, provenance_ref="prov:ignored")
                    terminal = second
                    retry_stable = second is first
                elif vector.action == "cancel-after-terminal":
                    first = guard.invoke(
                        request,
                        profile,
                        authority,
                        context,
                        domain_payload=payload,
                    )[-1]
                    second = guard.cancel(request.request_id, provenance_ref="prov:cancel")
                    terminal = second
                    retry_stable = second is first
                elif vector.action == "request-reuse":
                    guard.invoke(
                        request,
                        profile,
                        authority,
                        context,
                        domain_payload=payload,
                    )
                    terminal = guard.terminal_for(request.request_id)
                    if vector.followup_mutation is None:
                        raise AssertionError(f"{vector.name}: request reuse requires a mutation spec")
                    changed = request.model_copy(
                        update={"tool_trace_ref": vector.followup_mutation.tool_trace_ref}
                    )
                    guard.invoke(
                        changed,
                        profile,
                        authority,
                        context,
                        domain_payload=payload,
                    )
                elif vector.action in {"invoke-retry", "binding-exception"}:
                    first = guard.invoke(
                        request,
                        profile,
                        authority,
                        context,
                        domain_payload=payload,
                    )
                    terminal = first[-1]
                    second = guard.invoke(
                        request,
                        profile,
                        authority,
                        context,
                        domain_payload=payload,
                    )
                    retry_stable = second == first and second[0] is terminal
                else:  # pragma: no cover - Literal exhaustiveness guard
                    raise AssertionError(f"{vector.name}: unknown action {vector.action}")
        except NeutralKernelError as exc:
            reason = exc.code
            if request is not None:
                terminal = guard.terminal_for(request.request_id)
        else:
            if terminal is not None:
                reason = terminal.code if isinstance(terminal, ErrorEvent) else "FINAL"

        observed_terminal: Literal["final", "error"] | None = None
        if isinstance(terminal, FinalEvent):
            observed_terminal = "final"
        elif isinstance(terminal, ErrorEvent):
            observed_terminal = "error"

        guarded_invocation: bool | None = None
        payload_request_id_bound: bool | None = None
        immutable_json: bool | None = None
        if "opaque-invocation" in vector.coverage:
            guarded_invocation = len(fake.invocations) == 1 and isinstance(
                fake.invocations[0], NeutralInvocation
            )
            payload_request_id_bound = (
                guarded_invocation
                and request is not None
                and fake.invocations[0].domain_payload.get("request_id") == request.request_id
            )
        if "deep-immutable-json" in vector.coverage:
            immutable_json = self._observe_deep_immutability(fake, terminal, context)

        return VectorObservation(
            reason=reason,
            terminal=observed_terminal,
            readiness_call_count=fake.readiness_call_count,
            invoke_call_count=fake.invoke_call_count,
            available=available,
            provenance_ref=(
                terminal.provenance_ref
                if "provenance" in vector.coverage and terminal is not None
                else None
            ),
            retry_stable=retry_stable,
            guarded_invocation=guarded_invocation,
            payload_request_id_bound=payload_request_id_bound,
            immutable_json=immutable_json,
        )

    def _resolve_capabilities(
        self,
        slots: tuple[int, ...],
        *,
        include_unavailable: bool,
    ) -> tuple[str, ...]:
        try:
            resolved = tuple(self._available_capability_ids[index] for index in slots)
        except IndexError as exc:
            raise ValueError("vector capability slot exceeds injected registry fixture") from exc
        if include_unavailable:
            unavailable = f"{self._binding_kind}.synthetic-unavailable"
            while unavailable in self._available_capability_ids:
                unavailable += ".outside"
            resolved = (*resolved, unavailable)
        return resolved

    @staticmethod
    def _materialize_context(spec: ContextSpec) -> ClientContextSnapshot:
        def fact(value: Any) -> ContextFact:
            return ContextFact(
                value=value.value,
                source=value.source,
                observed_at_or_freshness=value.observed_at_or_freshness,
                manual_override=value.manual_override,
                provenance=value.provenance,
            )

        return ClientContextSnapshot(
            context_id=spec.context_id,
            locale=spec.locale,
            timezone=fact(spec.timezone),
            client_location=fact(spec.client_location),
            weather=fact(spec.weather),
        )

    def _materialize_profile(self, spec: ProfileSpec) -> SessionExposureProfile:
        return SessionExposureProfile(
            profile_id=spec.profile_id,
            capability_ids=self._resolve_capabilities(
                spec.capability_slots,
                include_unavailable=spec.include_unavailable_capability,
            ),
            allowed_session_operations=spec.allowed_session_operations,
        )

    @staticmethod
    def _materialize_authority(
        spec: AuthoritySpec,
        profile: SessionExposureProfile,
    ) -> SessionAuthority:
        return SessionAuthority(
            session_id=spec.session_id,
            data_scope_ref=spec.data_scope_ref,
            allowed_session_operations=spec.allowed_session_operations,
            exposure_profile_ref=(
                profile.profile_id if spec.profile_relation == "match" else f"{profile.profile_id}.mismatch"
            ),
            explicit_user_confirmation_state=spec.explicit_user_confirmation_state,
            explicit_user_confirmation_ref=spec.explicit_user_confirmation_ref,
        )

    def _materialize_readiness(self, spec: ReadinessSpec) -> NeutralReadiness:
        return NeutralReadiness(
            interface_version=(
                self._interface_version
                if spec.interface_version_relation == "match"
                else f"{self._interface_version}.unsupported"
            ),
            supported_operations=spec.supported_operations,
            binding_kind=(
                self._binding_kind
                if spec.binding_identity_relation == "match"
                else f"{self._binding_kind}.mismatch"
            ),
            binding_version=self._binding_version,
            available=spec.available,
            reason=spec.reason,
            code=spec.code,
        )

    def _materialize_request(
        self,
        spec: RequestSpec,
        context: ClientContextSnapshot,
        profile: SessionExposureProfile,
        authority: SessionAuthority,
    ) -> NeutralSessionRequest:
        request_context = context
        if spec.context_relation == "mismatch":
            request_context = context.model_copy(update={"context_id": f"{context.context_id}.mismatch"})
        return NeutralSessionRequest(
            request_id=spec.request_id,
            operation=spec.operation,
            session_id=(
                authority.session_id
                if spec.session_relation == "match"
                else f"{authority.session_id}.mismatch"
            ),
            context_id=request_context.context_id,
            exposure_profile_ref=(
                profile.profile_id if spec.profile_relation == "match" else f"{profile.profile_id}.mismatch"
            ),
            binding_kind=self._binding_kind,
            binding_version=(
                self._binding_version
                if spec.binding_identity_relation == "match"
                else f"{self._binding_version}.mismatch"
            ),
            requested_capability_ids=self._resolve_capabilities(
                spec.capability_slots,
                include_unavailable=spec.include_unavailable_capability,
            ),
            cli_package_version_ref="cli:synthetic",
            cli_schema_version_ref="schema:synthetic",
            tool_trace_ref=spec.tool_trace_ref,
            provenance_ref="prov:request",
            context_snapshot=request_context,
        )

    @staticmethod
    def _materialize_domain_payload(spec: RequestSpec) -> dict[str, Any]:
        payload = dict(spec.domain_payload)
        if spec.payload_request_id_relation == "match":
            payload["request_id"] = spec.request_id
        elif spec.payload_request_id_relation == "mismatch":
            payload["request_id"] = f"{spec.request_id}.mismatch"
        elif spec.payload_request_id_relation == "null":
            payload["request_id"] = None
        return payload

    @staticmethod
    def _materialize_events(
        specs: tuple[EventSpec, ...],
        request: NeutralSessionRequest,
    ) -> tuple[NeutralEvent | dict[str, Any], ...]:
        events: list[NeutralEvent | dict[str, Any]] = []
        for spec in specs:
            request_id = (
                request.request_id
                if spec.request_relation == "match"
                else f"{request.request_id}.mismatch"
            )
            if spec.kind == "invalid":
                events.append(
                    {
                        "request_id": request_id,
                        "sequence": spec.sequence,
                        "unexpected": "not a neutral event",
                    }
                )
            elif spec.kind == "status":
                events.append(
                    StatusEvent(
                        request_id=request_id,
                        sequence=spec.sequence,
                        phase=spec.phase,
                        message=spec.message,
                    )
                )
            elif spec.kind == "evidence":
                events.append(
                    EvidenceEvent(
                        request_id=request_id,
                        sequence=spec.sequence,
                        evidence=dict(spec.evidence),
                        provenance_ref=spec.provenance_ref or "prov:evidence",
                    )
                )
            elif spec.kind == "final":
                domain_request_id = (
                    request_id
                    if spec.domain_request_relation == "match"
                    else f"{request_id}.mismatch"
                )
                events.append(
                    FinalEvent(
                        request_id=request_id,
                        sequence=spec.sequence,
                        domain_envelope={
                            "request_id": domain_request_id,
                            "mode": spec.mode,
                            "result": "synthetic",
                        },
                        provenance_ref=spec.provenance_ref or "prov:final",
                    )
                )
            else:
                events.append(
                    ErrorEvent(
                        request_id=request_id,
                        sequence=spec.sequence,
                        code=spec.code,
                        layer=spec.layer,
                        safe_message=spec.safe_message,
                        retryable=spec.retryable,
                        unchanged_provider_error_or_outcome=spec.unchanged_provider_error_or_outcome,
                        provenance_ref=spec.provenance_ref,
                        effect_known=spec.effect_known,
                        presentation_state=spec.presentation_state,
                        provider_outcome=spec.provider_outcome,
                    )
                )
        return tuple(events)

    @staticmethod
    def _observe_cancel_symmetry() -> str:
        valid = ErrorEvent(
            request_id="vector-cancel-symmetry",
            sequence=0,
            code="FAILED",
            layer="binding",
            safe_message="Synthetic failure.",
            retryable=False,
            unchanged_provider_error_or_outcome=None,
            provenance_ref=None,
            effect_known=False,
            presentation_state="failed",
            provider_outcome="unknown",
        )
        try:
            ErrorEvent.model_validate({**valid.model_dump(), "presentation_state": "canceled"})
        except ValidationError:
            return "CANCEL_SYMMETRY"
        raise AssertionError("canceled presentation accepted without CANCELLED code")

    @staticmethod
    def _observe_deep_immutability(
        fake: DeterministicFakeHost,
        terminal: FinalEvent | ErrorEvent | None,
        context: ClientContextSnapshot | None,
    ) -> bool:
        if len(fake.invocations) != 1 or terminal is None or context is None:
            return False
        try:
            fake.invocations[0].domain_payload["mutation"] = True
        except TypeError:
            pass
        else:
            return False
        try:
            context.client_location.value["mutation"] = True
        except TypeError:
            pass
        else:
            return False
        if isinstance(terminal, FinalEvent):
            try:
                terminal.domain_envelope["mutation"] = True
            except TypeError:
                return True
            return False
        return True


__all__ = ["DeterministicFakeHost", "FakeNeutralVectorHarness"]
