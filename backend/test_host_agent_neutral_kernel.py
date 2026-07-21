"""Focused tests for the transport-neutral Host Agent session kernel."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import threading
from typing import get_args

import pytest
from pydantic import ValidationError

from host_agent_bridge.codex_cli_adapter import QUERY_MCP_TOOL_NAMES
from host_agent_bridge.fake_host import DeterministicFakeHost, FakeNeutralVectorHarness
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
    NEUTRAL_VECTORS,
    NeutralVector,
    VectorObservation,
    run_neutral_vectors,
)
from host_agent_bridge.session_guard import NeutralKernelError, NeutralSessionGuard

EXECUTABLE_NEUTRAL_VECTORS = NEUTRAL_VECTORS


def _fact(value: object, *, provenance: str = "prov:client") -> ContextFact:
    return ContextFact(
        value=value,
        source="client",
        observed_at_or_freshness="fresh",
        manual_override=False,
        provenance=provenance,
    )


def _context(context_id: str = "context-1", *, location: object = None) -> ClientContextSnapshot:
    return ClientContextSnapshot(
        context_id=context_id,
        locale="en-NG",
        timezone=_fact("Africa/Lagos"),
        client_location=_fact(location if location is not None else {"city": "Lagos", "accuracy_m": 25}),
        weather=_fact({"condition": "rain", "temperature_c": 27.5}),
    )


def _profile(
    capability_ids: tuple[str, ...] = QUERY_MCP_TOOL_NAMES,
    operations: tuple[str, ...] = ("query", "metadata.propose"),
) -> SessionExposureProfile:
    return SessionExposureProfile(
        profile_id="profile-1",
        capability_ids=capability_ids,
        allowed_session_operations=operations,
    )


def _authority(
    operations: tuple[str, ...] = ("query", "metadata.propose"),
) -> SessionAuthority:
    return SessionAuthority(
        session_id="session-1",
        data_scope_ref="scope:synthetic",
        allowed_session_operations=operations,
        exposure_profile_ref="profile-1",
        explicit_user_confirmation_state="not_required",
        explicit_user_confirmation_ref=None,
    )


def _request(
    *,
    request_id: str = "request-1",
    operation: str = "query",
    context: ClientContextSnapshot | None = None,
    capabilities: tuple[str, ...] = (QUERY_MCP_TOOL_NAMES[2],),
) -> NeutralSessionRequest:
    snapshot = context or _context()
    return NeutralSessionRequest(
        request_id=request_id,
        operation=operation,
        session_id="session-1",
        context_id=snapshot.context_id,
        exposure_profile_ref="profile-1",
        binding_kind="fake",
        binding_version="1",
        requested_capability_ids=capabilities,
        cli_package_version_ref="cli:synthetic",
        cli_schema_version_ref="schema:synthetic",
        tool_trace_ref="trace:synthetic",
        provenance_ref="prov:request",
        context_snapshot=snapshot,
    )


def _readiness() -> NeutralReadiness:
    return NeutralReadiness(
        interface_version="neutral.session.v1",
        supported_operations=("query", "metadata.propose"),
        binding_kind="fake",
        binding_version="1",
        available=True,
        reason="READY",
        code="READY",
    )


def _final(request_id: str = "request-1") -> FinalEvent:
    return FinalEvent(
        request_id=request_id,
        sequence=1,
        domain_envelope={"request_id": request_id, "mode": "GROUNDED", "answer": "synthetic"},
        provenance_ref="prov:final",
    )


def _payload(request_id: str | None = None) -> dict[str, object]:
    payload: dict[str, object] = {
        "query": "Synthetic host-agent input.",
        "limits": {"max_evidence": 3, "facets": ["date", "topic"]},
    }
    if request_id is not None:
        payload["request_id"] = request_id
    return payload


class _BlockingBinding:
    def __init__(
        self,
        *,
        events: tuple[object, ...] | None = None,
        invoke_error: Exception | None = None,
    ) -> None:
        self.events = events or (_final(),)
        self.invoke_error = invoke_error
        self.started = threading.Event()
        self.release_invoke = threading.Event()
        self.invoke_call_count = 0

    def readiness(self) -> NeutralReadiness:
        return _readiness()

    def invoke(self, _invocation: NeutralInvocation):
        self.invoke_call_count += 1
        self.started.set()
        assert self.release_invoke.wait(5), "test did not release blocked binding"
        if self.invoke_error is not None:
            raise self.invoke_error
        return self.events


def _guard(binding: object, **limits: int) -> NeutralSessionGuard:
    return NeutralSessionGuard(
        binding,
        available_capability_ids=QUERY_MCP_TOOL_NAMES,
        interface_versions=("neutral.session.v1",),
        binding_kind="fake",
        binding_version="1",
        **limits,
    )


def _invoke(guard: NeutralSessionGuard, request: NeutralSessionRequest):
    return guard.invoke(
        request,
        _profile(),
        _authority(),
        request.context_snapshot,
        domain_payload=_payload(),
    )


def test_contract_field_sets_are_minimal_strict_and_frozen() -> None:
    assert set(ContextFact.model_fields) == {
        "value",
        "source",
        "observed_at_or_freshness",
        "manual_override",
        "provenance",
    }
    assert set(ClientContextSnapshot.model_fields) == {
        "context_id",
        "locale",
        "timezone",
        "client_location",
        "weather",
    }
    assert set(SessionExposureProfile.model_fields) == {
        "profile_id",
        "capability_ids",
        "allowed_session_operations",
    }
    assert set(SessionAuthority.model_fields) == {
        "session_id",
        "data_scope_ref",
        "allowed_session_operations",
        "exposure_profile_ref",
        "explicit_user_confirmation_state",
        "explicit_user_confirmation_ref",
    }
    assert set(NeutralSessionRequest.model_fields) == {
        "request_id",
        "operation",
        "session_id",
        "context_id",
        "exposure_profile_ref",
        "binding_kind",
        "binding_version",
        "requested_capability_ids",
        "cli_package_version_ref",
        "cli_schema_version_ref",
        "tool_trace_ref",
        "provenance_ref",
        "context_snapshot",
    }
    assert set(NeutralInvocation.model_fields) == {
        "request",
        "data_scope_ref",
        "exposure_profile_ref",
        "capability_ids",
        "allowed_session_operations",
        "explicit_user_confirmation_state",
        "explicit_user_confirmation_ref",
        "domain_payload",
    }

    snapshot = _context()
    assert isinstance(snapshot.locale, str)
    assert snapshot.client_location.value["accuracy_m"] == 25
    assert snapshot.weather.value["temperature_c"] == 27.5
    with pytest.raises(ValidationError):
        ClientContextSnapshot.model_validate({**snapshot.model_dump(), "data_scope_ref": "forbidden"})
    with pytest.raises(ValidationError):
        ClientContextSnapshot.model_validate({**snapshot.model_dump(), "locale": _fact("en-NG").model_dump()})
    with pytest.raises(ValidationError):
        ContextFact.model_validate({**_fact("x").model_dump(), "value": object()})
    with pytest.raises(ValidationError):
        snapshot.locale = "fr-FR"  # type: ignore[misc]


def test_neutral_event_union_has_only_four_events_and_error_axes_are_independent() -> None:
    assert set(get_args(NeutralEvent)) == {StatusEvent, EvidenceEvent, FinalEvent, ErrorEvent}
    assert set(ErrorEvent.model_fields) == {
        "request_id",
        "sequence",
        "code",
        "layer",
        "safe_message",
        "retryable",
        "unchanged_provider_error_or_outcome",
        "provenance_ref",
        "effect_known",
        "presentation_state",
        "provider_outcome",
    }
    event = ErrorEvent(
        request_id="request-error",
        sequence=9,
        code="TOOL_FAILED",
        layer="tool",
        safe_message="The request failed.",
        retryable=False,
        unchanged_provider_error_or_outcome=None,
        provenance_ref=None,
        effect_known=False,
        presentation_state="failed",
        provider_outcome="failed",
    )
    assert event.provider_outcome == "failed"
    assert event.effect_known is False
    assert event.unchanged_provider_error_or_outcome is None
    with pytest.raises(ValidationError, match="CANCELLED.*canceled"):
        ErrorEvent.model_validate({**event.model_dump(), "code": "CANCELLED"})
    with pytest.raises(ValidationError, match="canceled.*CANCELLED"):
        ErrorEvent.model_validate({**event.model_dump(), "presentation_state": "canceled"})
    with pytest.raises(ValidationError):
        ErrorEvent.model_validate({**event.model_dump(), "layer": "runtime"})
    with pytest.raises(ValidationError):
        ErrorEvent.model_validate({**event.model_dump(), "presentation_state": "CANCELLED"})


def test_metadata_proposal_can_request_zero_capabilities_without_write_authority() -> None:
    request = _request(operation="metadata.propose", capabilities=())
    assert request.requested_capability_ids == ()
    assert "metadata.apply" not in get_args(type(request).model_fields["operation"].annotation)
    assert "write" not in SessionAuthority.model_fields


def test_profile_and_authority_are_checked_before_raw_readiness() -> None:
    host = DeterministicFakeHost(readiness=_readiness())
    guard = NeutralSessionGuard(
        host,
        available_capability_ids=QUERY_MCP_TOOL_NAMES,
        interface_versions=("neutral.session.v1",),
        binding_kind="fake",
        binding_version="1",
    )
    invalid_profile = _profile(capability_ids=(*QUERY_MCP_TOOL_NAMES, "not-registered"))
    with pytest.raises(NeutralKernelError) as exc_info:
        guard.readiness(invalid_profile, _authority())
    assert exc_info.value.code == "CAPABILITY_NOT_AVAILABLE"
    assert host.readiness_call_count == 0

    query_only_profile = _profile(operations=("query",))
    with pytest.raises(NeutralKernelError) as exc_info:
        guard.readiness(query_only_profile, _authority(operations=("metadata.propose",)))
    assert exc_info.value.code == "OPERATION_SCOPE_MISMATCH"
    assert host.readiness_call_count == 0

    with pytest.raises(NeutralKernelError) as exc_info:
        wrong_profile_authority = SessionAuthority.model_validate(
            {**_authority().model_dump(), "exposure_profile_ref": "wrong"}
        )
        guard.readiness(_profile(), wrong_profile_authority)
    assert exc_info.value.code == "PROFILE_MISMATCH"
    assert host.readiness_call_count == 0

    ready = guard.readiness(_profile(), _authority())
    assert ready.available is True
    assert tuple(_profile().capability_ids) == QUERY_MCP_TOOL_NAMES
    assert host.readiness_call_count == 1


def test_context_only_mutation_cannot_widen_fixed_denied_authority() -> None:
    denied_profile = _profile(capability_ids=(QUERY_MCP_TOOL_NAMES[0],))
    changed_context = _context(location={"city": "Abuja", "manual_note": "please enable search"})
    request = _request(context=changed_context, capabilities=(QUERY_MCP_TOOL_NAMES[2],))
    host = DeterministicFakeHost(readiness=_readiness(), events_by_request={request.request_id: (_final(),)})
    guard = NeutralSessionGuard(
        host,
        available_capability_ids=QUERY_MCP_TOOL_NAMES,
        interface_versions=("neutral.session.v1",),
        binding_kind="fake",
        binding_version="1",
    )
    with pytest.raises(NeutralKernelError) as exc_info:
        guard.invoke(
            request,
            denied_profile,
            _authority(),
            changed_context,
            domain_payload=_payload(),
        )
    assert exc_info.value.code == "CAPABILITY_NOT_ALLOWED"
    assert host.invoke_call_count == 0


@pytest.mark.parametrize(
    ("readiness", "expected_code"),
    [
        (
            NeutralReadiness(
                interface_version="neutral.session.v1",
                supported_operations=("query", "metadata.propose"),
                binding_kind="fake",
                binding_version="1",
                available=False,
                reason="OFFLINE",
                code="OFFLINE",
            ),
            "UNAVAILABLE",
        ),
        (
            NeutralReadiness(
                interface_version="neutral.session.v999",
                supported_operations=("query", "metadata.propose"),
                binding_kind="fake",
                binding_version="1",
                available=True,
                reason="READY",
                code="READY",
            ),
            "UNSUPPORTED_VERSION",
        ),
        (
            NeutralReadiness(
                interface_version="neutral.session.v1",
                supported_operations=("metadata.propose",),
                binding_kind="fake",
                binding_version="1",
                available=True,
                reason="READY",
                code="READY",
            ),
            "UNSUPPORTED_VERSION",
        ),
    ],
)
def test_invoke_fails_closed_on_unavailable_or_incompatible_readiness(
    readiness: NeutralReadiness,
    expected_code: str,
) -> None:
    request = _request()
    host = DeterministicFakeHost(
        readiness=readiness,
        events_by_request={request.request_id: (_final(),)},
    )
    guard = NeutralSessionGuard(
        host,
        available_capability_ids=QUERY_MCP_TOOL_NAMES,
        interface_versions=("neutral.session.v1",),
        binding_kind="fake",
        binding_version="1",
    )
    with pytest.raises(NeutralKernelError) as exc_info:
        guard.invoke(
            request,
            _profile(),
            _authority(),
            _context(),
            domain_payload=_payload(),
        )
    assert exc_info.value.code == expected_code
    assert host.readiness_call_count == 1
    assert host.invoke_call_count == 0


def test_guard_injects_request_id_and_only_passes_guarded_opaque_invocation() -> None:
    request = _request()
    supplied_payload = _payload()
    host = DeterministicFakeHost(
        readiness=_readiness(),
        events_by_request={request.request_id: (_final(),)},
    )
    guard = NeutralSessionGuard(
        host,
        available_capability_ids=QUERY_MCP_TOOL_NAMES,
        interface_versions=("neutral.session.v1",),
        binding_kind="fake",
        binding_version="1",
    )
    assert guard.invoke(
        request,
        _profile(),
        _authority(),
        _context(),
        domain_payload=supplied_payload,
    ) == (_final(),)
    invocation = host.invocations[0]
    assert isinstance(invocation, NeutralInvocation)
    assert invocation.request is request
    assert invocation.data_scope_ref == "scope:synthetic"
    assert invocation.capability_ids == QUERY_MCP_TOOL_NAMES
    assert invocation.domain_payload["request_id"] == request.request_id
    assert "request_id" not in supplied_payload
    assert host.readiness_call_count == 1
    assert host.invoke_call_count == 1

    with pytest.raises(ValidationError, match="guard"):
        NeutralInvocation.model_validate(invocation.model_dump())


def test_fake_rejects_raw_final_mapping_with_mismatched_domain_request_id() -> None:
    request = _request(request_id="request-fake-final")
    raw_final = {
        "request_id": request.request_id,
        "sequence": 1,
        "domain_envelope": {"request_id": "wrong-domain-request", "mode": "GROUNDED"},
        "provenance_ref": "prov:final",
    }
    host = DeterministicFakeHost(
        readiness=_readiness(),
        events_by_request={request.request_id: (raw_final,)},
    )
    guard = NeutralSessionGuard(
        host,
        available_capability_ids=QUERY_MCP_TOOL_NAMES,
        interface_versions=("neutral.session.v1",),
        binding_kind="fake",
        binding_version="1",
    )
    (error,) = guard.invoke(
        request,
        _profile(),
        _authority(),
        _context(),
        domain_payload=_payload(),
    )
    assert isinstance(error, ErrorEvent)
    assert error.code == "BINDING_FAILURE"
    assert host.invoke_call_count == 1


@pytest.mark.parametrize("supplied_request_id", ["different-request", None])
def test_domain_payload_request_id_mismatch_is_pre_dispatch_denial(
    supplied_request_id: str | None,
) -> None:
    request = _request()
    host = DeterministicFakeHost(
        readiness=_readiness(),
        events_by_request={request.request_id: (_final(),)},
    )
    guard = NeutralSessionGuard(
        host,
        available_capability_ids=QUERY_MCP_TOOL_NAMES,
        interface_versions=("neutral.session.v1",),
        binding_kind="fake",
        binding_version="1",
    )
    with pytest.raises(NeutralKernelError) as exc_info:
        guard.invoke(
            request,
            _profile(),
            _authority(),
            _context(),
            domain_payload={**_payload(), "request_id": supplied_request_id},
        )
    assert exc_info.value.code == "DOMAIN_REQUEST_MISMATCH"
    assert host.readiness_call_count == 0
    assert host.invoke_call_count == 0


def test_cancel_is_request_keyed_idempotent_and_validates_later_invoke() -> None:
    host = DeterministicFakeHost(readiness=_readiness(), events_by_request={"request-1": (_final(),)})
    guard = NeutralSessionGuard(
        host,
        available_capability_ids=QUERY_MCP_TOOL_NAMES,
        interface_versions=("neutral.session.v1",),
        binding_kind="fake",
        binding_version="1",
    )
    canceled = guard.cancel("request-1", provenance_ref="prov:cancel")
    duplicate = guard.cancel("request-1", provenance_ref="ignored")
    assert duplicate is canceled
    assert canceled == ErrorEvent(
        request_id="request-1",
        sequence=0,
        code="CANCELLED",
        layer="session",
        safe_message="Request canceled.",
        retryable=False,
        unchanged_provider_error_or_outcome=None,
        provenance_ref="prov:cancel",
        effect_known=False,
        presentation_state="canceled",
        provider_outcome="unknown",
    )
    assert host.invoke_call_count == 0

    invalid_later_request = _request(context=_context("wrong-context"))
    with pytest.raises(NeutralKernelError) as exc_info:
        guard.invoke(
            invalid_later_request,
            _profile(),
            _authority(),
            _context(),
            domain_payload=_payload(),
        )
    assert exc_info.value.code == "CONTEXT_MISMATCH"
    assert host.invoke_call_count == 0

    assert guard.invoke(
        _request(),
        _profile(),
        _authority(),
        _context(),
        domain_payload=_payload(),
    ) == (canceled,)
    assert host.invoke_call_count == 0


def test_cancel_after_terminal_returns_existing_terminal() -> None:
    request = _request()
    final = _final()
    host = DeterministicFakeHost(readiness=_readiness(), events_by_request={request.request_id: (final,)})
    guard = NeutralSessionGuard(
        host,
        available_capability_ids=QUERY_MCP_TOOL_NAMES,
        interface_versions=("neutral.session.v1",),
        binding_kind="fake",
        binding_version="1",
    )
    assert guard.invoke(
        request,
        _profile(),
        _authority(),
        _context(),
        domain_payload=_payload(),
    ) == (final,)
    assert guard.cancel(request.request_id, provenance_ref="prov:cancel") is final
    assert host.invoke_call_count == 1


def test_request_id_reuse_with_different_correlation_is_rejected_without_raw_call() -> None:
    request = _request()
    host = DeterministicFakeHost(readiness=_readiness(), events_by_request={request.request_id: (_final(),)})
    guard = NeutralSessionGuard(
        host,
        available_capability_ids=QUERY_MCP_TOOL_NAMES,
        interface_versions=("neutral.session.v1",),
        binding_kind="fake",
        binding_version="1",
    )
    guard.invoke(
        request,
        _profile(),
        _authority(),
        _context(),
        domain_payload=_payload(),
    )
    changed = request.model_copy(update={"tool_trace_ref": "trace:different"})
    with pytest.raises(NeutralKernelError) as exc_info:
        guard.invoke(
            changed,
            _profile(),
            _authority(),
            _context(),
            domain_payload=_payload(),
        )
    assert exc_info.value.code == "REQUEST_ID_REUSE"
    assert host.invoke_call_count == 1


def test_final_domain_request_id_must_match_event_request_id() -> None:
    with pytest.raises(ValidationError, match="domain envelope request_id"):
        FinalEvent(
            request_id="request-1",
            sequence=1,
            domain_envelope={"request_id": "request-other", "mode": "GROUNDED"},
            provenance_ref="prov:final",
        )


def test_post_dispatch_protocol_failure_is_one_stable_cached_binding_error() -> None:
    request = _request(request_id="request-late")
    rejected_final = _final(request.request_id)
    late = StatusEvent(
        request_id=request.request_id,
        sequence=2,
        phase="late",
        message="Must be rejected.",
    )
    host = DeterministicFakeHost(
        readiness=_readiness(),
        events_by_request={request.request_id: (rejected_final, late)},
    )
    guard = NeutralSessionGuard(
        host,
        available_capability_ids=QUERY_MCP_TOOL_NAMES,
        interface_versions=("neutral.session.v1",),
        binding_kind="fake",
        binding_version="1",
    )
    first = guard.invoke(
        request,
        _profile(),
        _authority(),
        _context(),
        domain_payload=_payload(),
    )
    assert len(first) == 1
    error = first[0]
    assert error == ErrorEvent(
        request_id=request.request_id,
        sequence=0,
        code="LATE_FRAME",
        layer="binding",
        safe_message="Binding returned an invalid event stream.",
        retryable=False,
        unchanged_provider_error_or_outcome=None,
        provenance_ref="prov:request",
        effect_known=False,
        presentation_state="failed",
        provider_outcome="unknown",
    )
    assert error is not rejected_final

    retry = guard.invoke(
        request,
        _profile(),
        _authority(),
        _context(),
        domain_payload=_payload(),
    )
    assert retry == first
    assert retry[0] is error
    assert host.readiness_call_count == 1
    assert host.invoke_call_count == 1


def test_binding_exception_after_dispatch_is_cached_as_safe_unknown_error() -> None:
    request = _request(request_id="request-binding-exception")
    host = DeterministicFakeHost(
        readiness=_readiness(),
        invoke_exception=RuntimeError("unsafe provider detail"),
    )
    guard = NeutralSessionGuard(
        host,
        available_capability_ids=QUERY_MCP_TOOL_NAMES,
        interface_versions=("neutral.session.v1",),
        binding_kind="fake",
        binding_version="1",
    )
    (error,) = guard.invoke(
        request,
        _profile(),
        _authority(),
        _context(),
        domain_payload=_payload(),
    )
    assert isinstance(error, ErrorEvent)
    assert error.code == "BINDING_FAILURE"
    assert error.layer == "binding"
    assert error.unchanged_provider_error_or_outcome is None
    assert error.provider_outcome == "unknown"
    assert error.effect_known is False
    assert "unsafe provider detail" not in error.safe_message


@pytest.mark.parametrize(
    ("events", "invoke_error"),
    [
        ((_final("request-cancel-race"),), None),
        ((), RuntimeError("unsafe late provider failure")),
        (
            (
                _final("request-cancel-race"),
                StatusEvent(
                    request_id="request-cancel-race",
                    sequence=2,
                    phase="late",
                    message="invalid late protocol frame",
                ),
            ),
            None,
        ),
    ],
    ids=("late-final", "late-binding-exception", "late-protocol-error"),
)
def test_cancel_is_first_terminal_winner_against_late_binding_completion(
    events: tuple[object, ...],
    invoke_error: Exception | None,
) -> None:
    request = _request(request_id="request-cancel-race")
    binding = _BlockingBinding(events=events, invoke_error=invoke_error)
    guard = _guard(binding)

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(_invoke, guard, request)
        assert binding.started.wait(5)
        canceled = guard.cancel(request.request_id, provenance_ref="prov:cancel")
        binding.release_invoke.set()
        returned = future.result(timeout=5)

    assert isinstance(canceled, ErrorEvent)
    assert canceled.code == "CANCELLED"
    assert returned == (canceled,)
    assert returned[0] is canceled
    assert guard.terminal_for(request.request_id) is canceled


def test_concurrent_identical_invokes_dispatch_once_and_replay_one_terminal() -> None:
    request = _request(request_id="request-duplicate-in-flight")

    class BlockingReadinessBinding:
        def __init__(self) -> None:
            self.lock = threading.Lock()
            self.readiness_call_count = 0
            self.first_readiness_started = threading.Event()
            self.second_readiness_started = threading.Event()
            self.release_readiness = threading.Event()
            self.invoke_call_count = 0

        def readiness(self) -> NeutralReadiness:
            with self.lock:
                self.readiness_call_count += 1
                count = self.readiness_call_count
            if count == 1:
                self.first_readiness_started.set()
            elif count == 2:
                self.second_readiness_started.set()
            assert self.release_readiness.wait(5), "test did not release readiness"
            return _readiness()

        def invoke(self, _invocation: NeutralInvocation):
            self.invoke_call_count += 1
            return (_final(request.request_id),)

    binding = BlockingReadinessBinding()
    guard = _guard(binding)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(_invoke, guard, request)
        assert binding.first_readiness_started.wait(5)
        second = pool.submit(_invoke, guard, request)
        binding.second_readiness_started.wait(1)
        binding.release_readiness.set()
        first_events = first.result(timeout=5)
        second_events = second.result(timeout=5)

    assert binding.readiness_call_count == 1
    assert binding.invoke_call_count == 1
    assert first_events[-1] is second_events[-1]


def test_release_cannot_remove_a_completed_generation_before_registered_waiter_consumes_it() -> None:
    request = _request(request_id="request-release-waiter-generation")

    class GenerationBinding:
        def __init__(self) -> None:
            self.lock = threading.Lock()
            self.invoke_call_count = 0
            self.first_started = threading.Event()
            self.release_first = threading.Event()

        def readiness(self) -> NeutralReadiness:
            return _readiness()

        def invoke(self, _invocation: NeutralInvocation):
            with self.lock:
                self.invoke_call_count += 1
                generation = self.invoke_call_count
            if generation == 1:
                self.first_started.set()
                assert self.release_first.wait(5), "test did not release generation one"
            return (
                FinalEvent(
                    request_id=request.request_id,
                    sequence=1,
                    domain_envelope={
                        "request_id": request.request_id,
                        "answer": f"generation-{generation}",
                    },
                    provenance_ref="prov:final",
                ),
            )

    class HoldAfterWakeEvent(threading.Event):
        def __init__(self) -> None:
            super().__init__()
            self.wait_entered = threading.Event()
            self.wake_received = threading.Event()
            self.allow_consume = threading.Event()

        def wait(self, timeout=None):
            self.wait_entered.set()
            received = super().wait(timeout)
            self.wake_received.set()
            assert self.allow_consume.wait(5), "test did not allow waiter consumption"
            return received

    binding = GenerationBinding()
    guard = _guard(binding)
    waiter_gate = HoldAfterWakeEvent()
    release_error_code = None

    with ThreadPoolExecutor(max_workers=2) as pool:
        owner = pool.submit(_invoke, guard, request)
        assert binding.first_started.wait(5)
        guard._records[request.request_id].wake = waiter_gate
        generation_one_record = guard._records[request.request_id]
        duplicate = pool.submit(_invoke, guard, request)
        assert waiter_gate.wait_entered.wait(5)
        assert generation_one_record.registered_waiters == 1

        binding.release_first.set()
        owner_events = owner.result(timeout=5)
        assert waiter_gate.wake_received.wait(5)

        try:
            guard.release(request.request_id)
        except NeutralKernelError as exc:
            release_error_code = exc.code

        same_id_events = _invoke(guard, request)
        waiter_gate.allow_consume.set()
        duplicate_events = duplicate.result(timeout=5)

    assert release_error_code == "REQUEST_IN_FLIGHT"
    assert owner_events[-1].domain_envelope["answer"] == "generation-1"
    assert same_id_events[-1] is owner_events[-1]
    assert duplicate_events[-1] is owner_events[-1]
    assert binding.invoke_call_count == 1
    assert generation_one_record.registered_waiters == 0
    assert guard.release(request.request_id) is True


def test_predispatch_failure_wakes_registered_waiter_to_retry_without_provider_dispatch() -> None:
    request = _request(request_id="request-predispatch-waiter-retry")

    class BlockingUnavailableBinding:
        def __init__(self) -> None:
            self.lock = threading.Lock()
            self.readiness_call_count = 0
            self.invoke_call_count = 0
            self.first_readiness_started = threading.Event()
            self.release_first_readiness = threading.Event()

        def readiness(self) -> NeutralReadiness:
            with self.lock:
                self.readiness_call_count += 1
                call_count = self.readiness_call_count
            if call_count == 1:
                self.first_readiness_started.set()
                assert self.release_first_readiness.wait(5), "test did not release readiness"
            return _readiness().model_copy(
                update={"available": False, "reason": "OFFLINE", "code": "OFFLINE"}
            )

        def invoke(self, _invocation: NeutralInvocation):
            self.invoke_call_count += 1
            return (_final(request.request_id),)

    class ObserveWaitEvent(threading.Event):
        def __init__(self) -> None:
            super().__init__()
            self.wait_entered = threading.Event()

        def wait(self, timeout=None):
            self.wait_entered.set()
            return super().wait(timeout)

    binding = BlockingUnavailableBinding()
    guard = _guard(binding)
    wait_event = ObserveWaitEvent()

    with ThreadPoolExecutor(max_workers=2) as pool:
        owner = pool.submit(_invoke, guard, request)
        assert binding.first_readiness_started.wait(5)
        released_record = guard._records[request.request_id]
        released_record.wake = wait_event
        duplicate = pool.submit(_invoke, guard, request)
        assert wait_event.wait_entered.wait(5)
        assert released_record.registered_waiters == 1
        binding.release_first_readiness.set()

        for future in (owner, duplicate):
            with pytest.raises(NeutralKernelError) as exc_info:
                future.result(timeout=5)
            assert exc_info.value.code == "UNAVAILABLE"

    assert released_record.registered_waiters == 0
    assert binding.readiness_call_count == 2
    assert binding.invoke_call_count == 0
    assert guard.terminal_for(request.request_id) is None
    assert guard.release(request.request_id) is False


def test_different_digest_is_rejected_while_original_request_is_in_flight() -> None:
    request = _request(request_id="request-in-flight-reuse")
    binding = _BlockingBinding(events=(_final(request.request_id),))
    guard = _guard(binding)

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(_invoke, guard, request)
        assert binding.started.wait(5)
        changed = request.model_copy(update={"tool_trace_ref": "trace:different"})
        with pytest.raises(NeutralKernelError) as exc_info:
            _invoke(guard, changed)
        binding.release_invoke.set()
        future.result(timeout=5)

    assert exc_info.value.code == "REQUEST_ID_REUSE"
    assert binding.invoke_call_count == 1


def test_guard_retains_only_digest_and_bounded_terminal_then_release_forgets_state() -> None:
    request_secret = "RAW_REQUEST_SECRET_MARKER"
    result_secret = "RAW_RESULT_SECRET_MARKER"
    request = _request(request_id="request-secret-retention").model_copy(
        update={"tool_trace_ref": request_secret}
    )
    final = FinalEvent(
        request_id=request.request_id,
        sequence=1,
        domain_envelope={"request_id": request.request_id, "answer": result_secret},
        provenance_ref="prov:final",
    )
    binding = _BlockingBinding(events=(final,))
    guard = _guard(binding)

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(_invoke, guard, request)
        assert binding.started.wait(5)
        record = guard._records[request.request_id]
        assert record.digest is not None
        assert len(record.digest) == 64
        assert set(record.digest).issubset(set("0123456789abcdef"))
        retained_while_active = repr({k: v for k, v in vars(guard).items() if k != "_raw_binding"})
        assert request_secret not in retained_while_active
        binding.release_invoke.set()
        assert future.result(timeout=5)[-1] is final

    assert guard.release(request.request_id) is True
    assert guard.release(request.request_id) is False
    assert guard.terminal_for(request.request_id) is None
    retained_after_release = repr({k: v for k, v in vars(guard).items() if k != "_raw_binding"})
    assert request_secret not in retained_after_release
    assert result_secret not in retained_after_release


def test_capacity_terminal_oversize_and_release_are_bounded_and_deterministic() -> None:
    first = _request(request_id="request-capacity-1")
    second = _request(request_id="request-capacity-2")
    large_final = FinalEvent(
        request_id=first.request_id,
        sequence=1,
        domain_envelope={"request_id": first.request_id, "answer": "x" * 4096},
        provenance_ref="prov:oversize",
    )
    host = DeterministicFakeHost(
        readiness=_readiness(),
        events_by_request={first.request_id: (large_final,), second.request_id: (_final(second.request_id),)},
    )
    guard = _guard(host, max_retained_requests=1, max_terminal_bytes=512)

    (oversize,) = _invoke(guard, first)
    assert isinstance(oversize, ErrorEvent)
    assert oversize.code == "TERMINAL_OVERSIZE"
    assert len(json.dumps(oversize.model_dump(mode="json"), sort_keys=True).encode("utf-8")) <= 512
    retry = _invoke(guard, first)
    assert retry == (oversize,)
    assert retry[0] is oversize
    with pytest.raises(NeutralKernelError) as exc_info:
        _invoke(guard, second)
    assert exc_info.value.code == "SESSION_CAPACITY"
    assert host.invoke_call_count == 1
    assert guard.release(first.request_id) is True
    assert isinstance(_invoke(guard, second)[-1], FinalEvent)


def test_release_rejects_in_flight_record_until_owner_completes() -> None:
    request = _request(request_id="request-release-active")
    binding = _BlockingBinding(events=(_final(request.request_id),))
    guard = _guard(binding)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(_invoke, guard, request)
        assert binding.started.wait(5)
        with pytest.raises(NeutralKernelError) as exc_info:
            guard.release(request.request_id)
        binding.release_invoke.set()
        future.result(timeout=5)
    assert exc_info.value.code == "REQUEST_IN_FLIGHT"
    assert guard.release(request.request_id) is True


@pytest.mark.parametrize("limit", [0, -1, True])
def test_guard_rejects_non_positive_or_boolean_retention_limits(limit) -> None:
    with pytest.raises(ValueError):
        _guard(DeterministicFakeHost(readiness=_readiness()), max_retained_requests=limit)
    with pytest.raises(ValueError):
        _guard(DeterministicFakeHost(readiness=_readiness()), max_terminal_bytes=limit)


def test_tiny_terminal_limit_fails_before_dispatch_without_leaving_a_record() -> None:
    request = _request(request_id="request-limit-too-small")
    host = DeterministicFakeHost(
        readiness=_readiness(), events_by_request={request.request_id: (_final(request.request_id),)}
    )
    guard = _guard(host, max_terminal_bytes=1)
    with pytest.raises(NeutralKernelError) as exc_info:
        _invoke(guard, request)
    assert exc_info.value.code == "TERMINAL_LIMIT_INVALID"
    assert host.readiness_call_count == 0
    assert host.invoke_call_count == 0
    assert guard.terminal_for(request.request_id) is None


def test_close_is_idempotent_clears_state_wakes_waiters_and_blocks_repopulation() -> None:
    request_secret = "CLOSED_REQUEST_SECRET_MARKER"
    request = _request(request_id="request-close-active").model_copy(
        update={"tool_trace_ref": request_secret}
    )
    result_secret = "CLOSED_RESULT_SECRET_MARKER"
    final = FinalEvent(
        request_id=request.request_id,
        sequence=1,
        domain_envelope={"request_id": request.request_id, "answer": result_secret},
        provenance_ref="prov:final",
    )
    binding = _BlockingBinding(events=(final,))
    guard = _guard(binding)
    second_entered = threading.Event()

    def duplicate_invoke():
        second_entered.set()
        return _invoke(guard, request)

    with ThreadPoolExecutor(max_workers=2) as pool:
        owner = pool.submit(_invoke, guard, request)
        assert binding.started.wait(5)

        class ObservableEvent(threading.Event):
            def __init__(self) -> None:
                super().__init__()
                self.wait_entered = threading.Event()

            def wait(self, timeout=None):
                self.wait_entered.set()
                return super().wait(timeout)

        waiter_event = ObservableEvent()
        active_record = guard._records[request.request_id]
        active_record.wake = waiter_event
        duplicate = pool.submit(duplicate_invoke)
        assert second_entered.wait(5)
        assert waiter_event.wait_entered.wait(5)
        guard.close()
        guard.close()
        binding.release_invoke.set()
        for future in (owner, duplicate):
            with pytest.raises(NeutralKernelError) as exc_info:
                future.result(timeout=5)
            assert exc_info.value.code == "SESSION_CLOSED"

    assert active_record.registered_waiters == 0
    assert guard.terminal_for(request.request_id) is None
    retained_after_close = repr({k: v for k, v in vars(guard).items() if k != "_raw_binding"})
    assert request_secret not in retained_after_close
    assert result_secret not in retained_after_close
    with pytest.raises(NeutralKernelError) as readiness_error:
        guard.readiness(_profile(), _authority())
    assert readiness_error.value.code == "SESSION_CLOSED"
    with pytest.raises(NeutralKernelError) as invoke_error:
        _invoke(guard, request)
    assert invoke_error.value.code == "SESSION_CLOSED"
    with pytest.raises(NeutralKernelError) as cancel_error:
        guard.cancel("request-after-close", provenance_ref=None)
    assert cancel_error.value.code == "SESSION_CLOSED"


def test_nested_json_is_defensively_copied_deeply_immutable_and_serializable() -> None:
    location = {"city": "Lagos", "coordinates": [6.45, 3.39]}
    context = _context(location=location)
    location["city"] = "mutated input"
    assert context.client_location.value["city"] == "Lagos"
    with pytest.raises(TypeError):
        context.client_location.value["city"] = "mutate frozen"  # type: ignore[index]
    with pytest.raises(TypeError):
        context.client_location.value["coordinates"][0] = 0  # type: ignore[index]

    envelope = {
        "request_id": "request-immutable",
        "mode": "GROUNDED",
        "nested": {"items": ["one", "two"]},
    }
    final = FinalEvent(
        request_id="request-immutable",
        sequence=1,
        domain_envelope=envelope,
        provenance_ref="prov:final",
    )
    envelope["nested"]["items"].append("input mutation")  # type: ignore[index,union-attr]
    assert final.domain_envelope["nested"]["items"] == ("one", "two")
    with pytest.raises(TypeError):
        final.domain_envelope["nested"]["items"] += ("frozen mutation",)  # type: ignore[index,operator]
    assert final.model_dump(mode="json")["domain_envelope"]["nested"]["items"] == ["one", "two"]

    replacement = {
        "request_id": "request-immutable",
        "mode": "PARTIAL",
        "nested": {"items": ["copy-one", "copy-two"]},
    }
    copied = final.model_copy(update={"domain_envelope": replacement})
    replacement["nested"]["items"].append("copy input mutation")  # type: ignore[index,union-attr]
    assert copied.domain_envelope["nested"]["items"] == ("copy-one", "copy-two")
    with pytest.raises(TypeError):
        copied.domain_envelope["nested"]["items"] += ("copy frozen mutation",)  # type: ignore[index,operator]


def test_one_immutable_executable_vector_set_runs_through_production_runner() -> None:
    vectors = EXECUTABLE_NEUTRAL_VECTORS
    assert isinstance(vectors, tuple)
    assert len(vectors) == 36
    assert len({vector.name for vector in vectors}) == len(vectors)
    harness = FakeNeutralVectorHarness(
        available_capability_ids=QUERY_MCP_TOOL_NAMES,
        binding_kind="fake-kernel-test",
        binding_version="fake-v1",
    )
    results = run_neutral_vectors(vectors, harness)
    assert len(results) == len(vectors)
    assert all(result.passed for result in results)
    covered = {tag for vector in vectors for tag in vector.coverage}
    assert {
        "readiness-ready",
        "readiness-unavailable",
        "readiness-version",
        "readiness-operation",
        "invoke-unavailable",
        "invoke-version",
        "invoke-operation",
        "exposure-subset",
        "context-facts",
        "context-authority",
        "query-final",
        "metadata-proposal",
        "error-independent-axes",
        "cancel-before",
        "cancel-duplicate",
        "cancel-after-terminal",
        "request-correlation",
        "session-correlation",
        "context-correlation",
        "profile-correlation",
        "binding-correlation",
        "capability-correlation",
        "event-correlation",
        "provenance",
        "duplicate-terminal",
        "late-frame",
        "invalid-event",
        "opaque-invocation",
        "domain-payload-correlation",
        "post-dispatch-stable-error",
        "deep-immutable-json",
        "cancel-symmetry",
    }.issubset(covered)
    for vector, result in zip(vectors, results, strict=True):
        assert result.expected_reason == vector.expected_reason
        assert result.expected_terminal == vector.expected_terminal
        assert result.readiness_call_count == vector.expected_readiness_calls
        assert result.invoke_call_count == vector.expected_invoke_calls


def test_same_binding_neutral_vector_objects_run_unchanged_on_alternate_identity() -> None:
    class AlternateRecordingHarness:
        def __init__(self) -> None:
            self.seen: list[NeutralVector] = []
            self.delegate = FakeNeutralVectorHarness(
                available_capability_ids=QUERY_MCP_TOOL_NAMES,
                binding_kind="alternate-recording-binding",
                binding_version="alternate-v7",
            )

        def execute(self, vector: NeutralVector) -> VectorObservation:
            self.seen.append(vector)
            return self.delegate.execute(vector)

    fake = FakeNeutralVectorHarness(
        available_capability_ids=QUERY_MCP_TOOL_NAMES,
        binding_kind="fake-primary-binding",
        binding_version="fake-v1",
    )
    alternate = AlternateRecordingHarness()

    primary_results = run_neutral_vectors(NEUTRAL_VECTORS, fake)
    alternate_results = run_neutral_vectors(NEUTRAL_VECTORS, alternate)

    expected_ids = [id(vector) for vector in NEUTRAL_VECTORS]
    assert [id(vector) for vector in fake.seen_vectors] == expected_ids
    assert [id(vector) for vector in alternate.seen] == expected_ids
    assert [id(vector) for vector in alternate.delegate.seen_vectors] == expected_ids
    assert primary_results == alternate_results
    assert set(fake.materialized_binding_identities) == {("fake-primary-binding", "fake-v1")}
    assert set(alternate.delegate.materialized_binding_identities) == {
        ("alternate-recording-binding", "alternate-v7")
    }
    assert all(not isinstance(vector.request, NeutralSessionRequest) for vector in NEUTRAL_VECTORS)
    assert all(not isinstance(vector.readiness, NeutralReadiness) for vector in NEUTRAL_VECTORS)
    assert all(not hasattr(vector.readiness, "binding_kind") for vector in NEUTRAL_VECTORS)
