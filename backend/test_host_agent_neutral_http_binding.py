"""Focused tests for the current HTTP/SSE neutral Host Agent binding."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
from typing import Any

import pytest

from host_agent_bridge import conformance
from host_agent_bridge.codex_cli_adapter import QUERY_MCP_TOOL_NAMES
from host_agent_bridge.http_sse_driver import (
    HTTP_SSE_BINDING_KIND,
    HTTP_SSE_BINDING_VERSION,
    MAX_BODY_BYTES,
    MAX_SSE_FRAME_BYTES,
    MAX_SSE_FRAMES,
    NEUTRAL_INTERFACE_VERSION,
    HttpSseBindingDriver,
)
from host_agent_bridge.http_sse_conformance import HttpNeutralVectorHarness
from host_agent_bridge.neutral_contract import (
    ClientContextSnapshot,
    ContextFact,
    ErrorEvent,
    EvidenceEvent,
    FinalEvent,
    NeutralSessionRequest,
    SessionAuthority,
    SessionExposureProfile,
    StatusEvent,
)
from host_agent_bridge.neutral_vectors import NEUTRAL_VECTORS, run_neutral_vectors
from host_agent_bridge.session_guard import NeutralSessionGuard


def _fact(value: object) -> ContextFact:
    return ContextFact(
        value=value,
        source="test-client",
        observed_at_or_freshness="fresh",
        manual_override=False,
        provenance="prov:test-client",
    )


def _context() -> ClientContextSnapshot:
    return ClientContextSnapshot(
        context_id="context-http-test",
        locale="en-NG",
        timezone=_fact("Africa/Lagos"),
        client_location=_fact({"city": "Synthetic City"}),
        weather=_fact({"condition": "synthetic-rain"}),
    )


def _profile() -> SessionExposureProfile:
    return SessionExposureProfile(
        profile_id="profile-http-test",
        capability_ids=QUERY_MCP_TOOL_NAMES,
        allowed_session_operations=("query", "metadata.propose"),
    )


def _authority() -> SessionAuthority:
    return SessionAuthority(
        session_id="session-http-test",
        data_scope_ref="scope:synthetic",
        allowed_session_operations=("query", "metadata.propose"),
        exposure_profile_ref="profile-http-test",
        explicit_user_confirmation_state="not_required",
        explicit_user_confirmation_ref=None,
    )


def _request(request_id: str, operation: str = "query") -> NeutralSessionRequest:
    context = _context()
    return NeutralSessionRequest(
        request_id=request_id,
        operation=operation,
        session_id="session-http-test",
        context_id=context.context_id,
        exposure_profile_ref="profile-http-test",
        binding_kind=HTTP_SSE_BINDING_KIND,
        binding_version=HTTP_SSE_BINDING_VERSION,
        requested_capability_ids=(QUERY_MCP_TOOL_NAMES[2],) if operation == "query" else (),
        cli_package_version_ref="cli:test",
        cli_schema_version_ref="schema:test",
        tool_trace_ref="trace:test",
        provenance_ref="prov:test-request",
        context_snapshot=context,
    )


def _ready_health() -> dict[str, Any]:
    return {
        "schema_version": "gui.host_agent.health.v1",
        "running": True,
        "ready": True,
        "degraded": False,
        "mode": "READY",
        "reason": "configured",
        "runtime": {"kind": "host-agent-reference-bridge", "interface_version": "v1"},
        "checks": [],
    }


def _offline_health() -> dict[str, Any]:
    return {
        "schema_version": "gui.host_agent.health.v1",
        "running": False,
        "ready": False,
        "degraded": True,
        "mode": "UNAVAILABLE",
        "reason": "host-agent-runtime-unconfigured",
        "runtime": {"kind": "host-agent-reference-bridge", "interface_version": "v1"},
        "checks": [],
    }


def _grounded_query(request_id: str) -> dict[str, Any]:
    return {
        "schema_version": "gui.host_agent.query_response.v1",
        "request_id": request_id,
        "conversation_id": "conversation-test",
        "source": "host-agent",
        "mode": "GROUNDED",
        "reason": "synthetic-grounded",
        "query": "Synthetic query",
        "answer": {
            "mode": "GROUNDED",
            "reason": "synthetic-grounded",
            "summary": "Synthetic cited answer.",
            "insights": [],
            "gap": None,
            "suggestions": [],
        },
        "evidence": [
            {
                "id": "demo/entry.md",
                "rel_path": "Journals/demo/entry.md",
                "title": "Synthetic evidence",
                "date": "2026-07-03",
            }
        ],
        "tool_trace": [],
    }


def _unavailable_query(request_id: str) -> dict[str, Any]:
    return {
        "schema_version": "gui.host_agent.query_response.v1",
        "request_id": request_id,
        "conversation_id": "conversation-test",
        "source": "host-agent",
        "mode": "UNAVAILABLE",
        "reason": "host-agent-runtime-unconfigured",
        "query": "Synthetic query",
        "answer": {
            "mode": "UNAVAILABLE",
            "reason": "host-agent-runtime-unconfigured",
            "summary": "",
            "insights": [],
            "gap": "Runtime unavailable.",
            "suggestions": [],
        },
        "evidence": [],
        "tool_trace": [],
    }


def _metadata(request_id: str, *, available: bool = True) -> dict[str, Any]:
    return {
        "schema_version": "gui.host_agent.metadata_proposal.v1",
        "request_id": request_id,
        "mode": "PROPOSED" if available else "UNAVAILABLE",
        "reason": "synthetic-proposal" if available else "host-agent-runtime-unconfigured",
        "fields": {"title": {"value": "Synthetic title"}} if available else {},
        "warnings": [] if available else ["Runtime unavailable."],
        "policy": {"preserve_user_fields": True},
    }


class WireClient:
    def __init__(
        self,
        *,
        health: dict[str, Any] | None = None,
        query_frames: list[tuple[str, Any]] | None = None,
        metadata: dict[str, Any] | None = None,
        invoke_error: Exception | None = None,
    ) -> None:
        self.health = health or _ready_health()
        self.query_frames = query_frames or []
        self.metadata = metadata or _metadata("metadata-default")
        self.invoke_error = invoke_error
        self.calls: list[tuple[str, str, dict[str, Any] | None]] = []

    def get_json(self, path: str) -> dict[str, Any]:
        self.calls.append(("GET", path, None))
        assert path == "/health"
        return self.health

    def post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("POST", path, payload))
        if self.invoke_error is not None:
            raise self.invoke_error
        assert path == "/metadata/propose"
        return self.metadata

    def post_sse(self, path: str, payload: dict[str, Any]) -> list[tuple[str, Any]]:
        self.calls.append(("POST", path, payload))
        if self.invoke_error is not None:
            raise self.invoke_error
        assert path == "/query/stream"
        return self.query_frames


def _guard(client: WireClient) -> NeutralSessionGuard:
    return NeutralSessionGuard(
        HttpSseBindingDriver(client),
        available_capability_ids=QUERY_MCP_TOOL_NAMES,
        interface_versions=(NEUTRAL_INTERFACE_VERSION,),
        binding_kind=HTTP_SSE_BINDING_KIND,
        binding_version=HTTP_SSE_BINDING_VERSION,
    )


def test_readiness_projects_current_health_with_truthful_http_binding_identity() -> None:
    client = WireClient()
    readiness = HttpSseBindingDriver(client).readiness()

    assert readiness.interface_version == NEUTRAL_INTERFACE_VERSION
    assert readiness.supported_operations == ("query", "metadata.propose")
    assert readiness.binding_kind == HTTP_SSE_BINDING_KIND
    assert readiness.binding_version == HTTP_SSE_BINDING_VERSION
    assert readiness.available is True
    assert readiness.reason == "configured"
    assert readiness.code == "READY"
    assert client.calls == [("GET", "/health", None)]


def test_query_maps_status_evidence_and_final_while_validating_and_omitting_delta() -> None:
    request = _request("query-map")
    client = WireClient(
        query_frames=[
            ("status", {"phase": "retrieval", "message": "Searching."}),
            ("delta", {"text": "intermediate presentation only"}),
            (
                "evidence",
                {
                    "evidence": {"id": "demo/entry.md", "date": "2026-07-03"},
                    "provenance_ref": "prov:http-evidence",
                },
            ),
            ("final", {**_grounded_query(request.request_id), "provenance_ref": "prov:http-final"}),
        ]
    )

    events = _guard(client).invoke(
        request,
        _profile(),
        _authority(),
        _context(),
        domain_payload={"query": "Synthetic query", "context": {}},
    )

    assert [type(event) for event in events] == [StatusEvent, EvidenceEvent, FinalEvent]
    assert [event.sequence for event in events] == [0, 2, 3]
    assert events[1].provenance_ref == "prov:http-evidence"
    assert events[2].provenance_ref == "prov:http-final"
    assert events[2].domain_envelope["mode"] == "GROUNDED"
    assert all("delta" not in event.model_dump(mode="json") for event in events)
    assert client.calls[-1][0:2] == ("POST", "/query/stream")
    assert client.calls[-1][2] == {
        "query": "Synthetic query",
        "context": {},
        "request_id": request.request_id,
    }


def test_metadata_uses_current_path_and_zero_requested_capabilities() -> None:
    request = _request("metadata-map", "metadata.propose")
    client = WireClient(metadata=_metadata(request.request_id))

    events = _guard(client).invoke(
        request,
        _profile(),
        _authority(),
        _context(),
        domain_payload={"draft": {"content": "Synthetic draft"}, "policy": {}},
    )

    assert request.requested_capability_ids == ()
    assert len(events) == 1
    assert isinstance(events[0], FinalEvent)
    assert events[0].domain_envelope["mode"] == "PROPOSED"
    assert client.calls[-1][0:2] == ("POST", "/metadata/propose")


def test_error_projection_redacts_envelopes_and_keeps_independent_axes() -> None:
    request = _request("query-error")
    client = WireClient(
        query_frames=[
            (
                "error",
                {
                    "request_id": request.request_id,
                    "code": "PROVIDER_FAILED",
                    "reason": "provider-failed",
                    "retryable": True,
                    "provider_outcome": "succeeded",
                    "effect_known": False,
                    "presentation_state": "FAILED",
                    "provenance_ref": "prov:error",
                    "raw_detail": {"status": "rejected", "code": "E_SAFE"},
                    "query": "SECRET QUERY ENVELOPE",
                    "evidence": [{"title": "SECRET TITLE", "path": "SECRET PATH"}],
                    "snippet": "SECRET SNIPPET",
                    "prompt": "SECRET PROMPT",
                    "credentials": "SECRET CREDENTIALS",
                    "arbitrary_body": "SECRET BODY",
                },
            )
        ]
    )

    (event,) = _guard(client).invoke(
        request,
        _profile(),
        _authority(),
        _context(),
        domain_payload={"query": "Synthetic query"},
    )

    assert isinstance(event, ErrorEvent)
    assert event.layer == "binding"
    assert event.presentation_state == "failed"
    assert event.provider_outcome == "succeeded"
    assert event.effect_known is False
    assert event.unchanged_provider_error_or_outcome == {
        "code": "PROVIDER_FAILED",
        "reason": "provider-failed",
        "provider_outcome": "succeeded",
        "effect_known": False,
    }
    assert event.provenance_ref == request.provenance_ref
    serialized = json.dumps(event.model_dump(mode="json"), ensure_ascii=False)
    assert "SECRET" not in serialized


@pytest.mark.parametrize("raw_detail_key", ["status", "code", "reason", "outcome"])
def test_credential_shaped_error_metadata_never_survives_projection(raw_detail_key) -> None:
    request = _request(f"query-secret-{raw_detail_key}")
    secret_marker = f"CREDENTIAL_SECRET_{raw_detail_key.upper()}"
    client = WireClient(
        query_frames=[
            (
                "error",
                {
                    "request_id": request.request_id,
                    "code": f"api-key-{secret_marker}",
                    "reason": f"token-{secret_marker}",
                    "retryable": f"retry-{secret_marker}",
                    "provider_outcome": f"outcome-{secret_marker}",
                    "effect_known": f"effect-{secret_marker}",
                    "presentation_state": f"state-{secret_marker}",
                    "provenance_ref": f"credential-{secret_marker}",
                    "raw_detail": {raw_detail_key: f"secret-{secret_marker}"},
                },
            )
        ]
    )

    (event,) = _guard(client).invoke(
        request,
        _profile(),
        _authority(),
        _context(),
        domain_payload={"query": "Synthetic query"},
    )

    assert isinstance(event, ErrorEvent)
    assert event.code == "BINDING_ERROR"
    assert event.safe_message == "Host agent binding reported an error."
    assert event.provenance_ref == request.provenance_ref
    assert event.retryable is False
    assert event.provider_outcome == "unknown"
    assert event.effect_known is False
    assert event.unchanged_provider_error_or_outcome == {
        "code": "BINDING_ERROR",
        "provider_outcome": "unknown",
        "effect_known": False,
    }
    assert secret_marker not in json.dumps(event.model_dump(mode="json"), ensure_ascii=False)


def test_repeated_production_invokes_retain_no_invocation_or_payload_history() -> None:
    class DynamicWireClient(WireClient):
        def post_sse(self, path: str, payload: dict[str, Any]) -> list[tuple[str, Any]]:
            assert path == "/query/stream"
            return [
                ("status", {"phase": "complete", "message": "Complete."}),
                ("final", _grounded_query(payload["request_id"])),
            ]

    driver = HttpSseBindingDriver(DynamicWireClient())
    guard = NeutralSessionGuard(
        driver,
        available_capability_ids=QUERY_MCP_TOOL_NAMES,
        interface_versions=(NEUTRAL_INTERFACE_VERSION,),
        binding_kind=HTTP_SSE_BINDING_KIND,
        binding_version=HTTP_SSE_BINDING_VERSION,
    )

    for index in range(12):
        request = _request(f"query-no-retention-{index}")
        events = guard.invoke(
            request,
            _profile(),
            _authority(),
            _context(),
            domain_payload={"query": f"Synthetic query {index}"},
        )
        assert isinstance(events[-1], FinalEvent)

    retained = vars(driver)
    assert "invocations" not in retained
    assert all("invocation" not in name and "payload" not in name for name in retained)
    assert all(not isinstance(value, (list, dict, set)) for value in retained.values())


@pytest.mark.parametrize("request_id", ["", 7, None, False])
def test_present_malformed_event_request_id_fails_closed(request_id) -> None:
    request = _request("query-malformed-request-id")
    client = WireClient(
        query_frames=[
            (
                "status",
                {
                    "request_id": request_id,
                    "phase": "retrieval",
                    "message": "Searching.",
                },
            )
        ]
    )

    (event,) = _guard(client).invoke(
        request,
        _profile(),
        _authority(),
        _context(),
        domain_payload={"query": "Synthetic query"},
    )

    assert isinstance(event, ErrorEvent)
    assert event.code == "BINDING_FAILURE"


@pytest.mark.parametrize("sequence", [True, -1, "1", None])
def test_present_malformed_event_sequence_fails_closed(sequence) -> None:
    request = _request("query-malformed-sequence")
    client = WireClient(
        query_frames=[
            (
                "status",
                {
                    "sequence": sequence,
                    "phase": "retrieval",
                    "message": "Searching.",
                },
            )
        ]
    )

    (event,) = _guard(client).invoke(
        request,
        _profile(),
        _authority(),
        _context(),
        domain_payload={"query": "Synthetic query"},
    )

    assert isinstance(event, ErrorEvent)
    assert event.code == "BINDING_FAILURE"


def test_late_current_wire_frame_is_rejected_by_the_neutral_guard() -> None:
    request = _request("query-late")
    client = WireClient(
        query_frames=[
            ("final", _grounded_query(request.request_id)),
            ("status", {"phase": "late", "message": "Must be rejected."}),
        ]
    )

    first = _guard(client).invoke(
        request,
        _profile(),
        _authority(),
        _context(),
        domain_payload={"query": "Synthetic query"},
    )

    assert len(first) == 1
    assert isinstance(first[0], ErrorEvent)
    assert first[0].code == "LATE_FRAME"


def test_invalid_delta_shape_fails_closed_instead_of_becoming_a_neutral_event() -> None:
    request = _request("query-invalid-delta")
    client = WireClient(query_frames=[("delta", {"text": ["not", "text"]})])

    (event,) = _guard(client).invoke(
        request,
        _profile(),
        _authority(),
        _context(),
        domain_payload={"query": "Synthetic query"},
    )

    assert isinstance(event, ErrorEvent)
    assert event.code == "BINDING_FAILURE"


@pytest.mark.parametrize(
    "query_frames",
    [
        [("status", {"phase": "x", "message": "x" * MAX_SSE_FRAME_BYTES})],
        [("status", {"phase": "x", "message": "x"})] * (MAX_SSE_FRAMES + 1),
    ],
)
def test_driver_fails_closed_on_frame_or_count_bounds(query_frames) -> None:
    request = _request("query-bounds")
    client = WireClient(query_frames=query_frames)

    (event,) = _guard(client).invoke(
        request,
        _profile(),
        _authority(),
        _context(),
        domain_payload={"query": "Synthetic query"},
    )

    assert isinstance(event, ErrorEvent)
    assert event.code == "BINDING_FAILURE"


@pytest.mark.parametrize(
    ("method", "path", "raw"),
    [
        ("get_json", "/health", b"{}"),
        ("post_json", "/metadata/propose", b"{}"),
        ("post_sse", "/query/stream", b""),
    ],
)
def test_url_client_reads_at_most_max_body_plus_one(monkeypatch, method, path, raw) -> None:
    reads: list[int] = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, _exc_type, _exc, _tb):
            return None

        def read(self, size: int) -> bytes:
            reads.append(size)
            return raw

    monkeypatch.setattr(conformance.urllib_request, "urlopen", lambda *_args, **_kwargs: Response())
    client = conformance.UrlHostAgentClient("http://host-agent.invalid")

    if method == "get_json":
        client.get_json(path)
    elif method == "post_json":
        client.post_json(path, {})
    else:
        client.post_sse(path, {})

    assert reads == [MAX_BODY_BYTES + 1]


def test_url_client_rejects_oversized_response_without_second_read(monkeypatch) -> None:
    reads: list[int] = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, _exc_type, _exc, _tb):
            return None

        def read(self, size: int) -> bytes:
            reads.append(size)
            return b"x" * size

    monkeypatch.setattr(conformance.urllib_request, "urlopen", lambda *_args, **_kwargs: Response())

    with pytest.raises(conformance.ConformanceError, match="response body exceeded"):
        conformance.UrlHostAgentClient("http://host-agent.invalid").get_json("/health")
    assert reads == [MAX_BODY_BYTES + 1]


class ConformanceClient(WireClient):
    def __init__(self, mode: str) -> None:
        ready = mode != "unavailable"
        query_id = "conformance-query-1"
        metadata_id = "conformance-metadata-1"
        super().__init__(
            health=_ready_health() if ready else _offline_health(),
            query_frames=[
                ("status", {"phase": "calling_host_agent", "message": "Calling runtime."}),
                (
                    "final",
                    _grounded_query(query_id)
                    if mode == "ready"
                    else _unavailable_query(query_id),
                ),
            ],
            metadata=_metadata(metadata_id, available=mode == "ready"),
        )


@pytest.mark.parametrize(
    ("mode", "expected_invoke_count"),
    [("ready", 2), ("runtime-unavailable", 2), ("unavailable", 0)],
)
def test_conformance_routes_accepted_sessions_through_guard_and_characterizes_offline_directly(
    monkeypatch,
    mode,
    expected_invoke_count,
) -> None:
    calls: list[tuple[str, tuple[str, ...], tuple[str, ...]]] = []
    real_guard = NeutralSessionGuard

    class RecordingGuard(real_guard):
        def invoke(self, request, *args, **kwargs):
            profile = args[0]
            calls.append(
                (request.operation, request.requested_capability_ids, profile.capability_ids)
            )
            return super().invoke(request, *args, **kwargs)

    monkeypatch.setattr(conformance, "NeutralSessionGuard", RecordingGuard)
    result = conformance.run_conformance(
        ConformanceClient(mode),
        expected_mode=mode,
        capability_fixture=conformance.ConformanceCapabilityFixture(
            available_capability_ids=QUERY_MCP_TOOL_NAMES,
            selected_query_capability_ids=(QUERY_MCP_TOOL_NAMES[2],),
        ),
    )

    assert len(calls) == expected_invoke_count
    if mode == "unavailable":
        assert "direct current-wire query unavailable characterization" in result.passed
        assert "direct current-wire metadata unavailable characterization" in result.passed
    else:
        assert calls == [
            ("query", (QUERY_MCP_TOOL_NAMES[2],), QUERY_MCP_TOOL_NAMES),
            ("metadata.propose", (), QUERY_MCP_TOOL_NAMES),
        ]


@pytest.mark.parametrize("missing", ["guard", "version"])
def test_conformance_preflight_fails_deterministically_before_session_calls(monkeypatch, missing) -> None:
    client = ConformanceClient("ready")
    if missing == "guard":
        monkeypatch.setattr(conformance, "NeutralSessionGuard", None)
    else:
        monkeypatch.setattr(conformance, "NEUTRAL_INTERFACE_VERSION", "")

    with pytest.raises(conformance.ConformanceError, match=f"neutral conformance {missing}"):
        conformance.run_conformance(client, expected_mode="ready")
    assert client.calls == []


def test_conformance_accepts_injected_opaque_capabilities_without_count_name_or_order_assumptions(
    monkeypatch,
) -> None:
    fixture = conformance.ConformanceCapabilityFixture(
        available_capability_ids=("opaque.zeta", "opaque.alpha", "opaque.delta", "opaque.beta"),
        selected_query_capability_ids=("opaque.delta", "opaque.alpha"),
    )
    calls: list[tuple[str, tuple[str, ...], tuple[str, ...]]] = []
    real_guard = NeutralSessionGuard

    class RecordingGuard(real_guard):
        def invoke(self, request, *args, **kwargs):
            profile = args[0]
            calls.append((request.operation, request.requested_capability_ids, profile.capability_ids))
            return super().invoke(request, *args, **kwargs)

    monkeypatch.setattr(conformance, "NeutralSessionGuard", RecordingGuard)
    conformance.run_conformance(
        ConformanceClient("ready"),
        expected_mode="ready",
        capability_fixture=fixture,
    )

    assert calls == [
        ("query", ("opaque.delta", "opaque.alpha"), fixture.available_capability_ids),
        ("metadata.propose", (), fixture.available_capability_ids),
    ]


@pytest.mark.parametrize(
    ("available", "selected"),
    [
        (("",), ()),
        (("opaque.one", "opaque.one"), ("opaque.one",)),
        (("opaque.one",), ("opaque.missing",)),
        (("opaque.one",), ("",)),
    ],
)
def test_conformance_capability_fixture_rejects_only_invalid_opaque_identity_sets(
    available,
    selected,
) -> None:
    with pytest.raises(ValueError):
        conformance.ConformanceCapabilityFixture(
            available_capability_ids=available,
            selected_query_capability_ids=selected,
        )


def test_conformance_capability_fixture_does_not_require_a_capability_count() -> None:
    fixture = conformance.ConformanceCapabilityFixture(
        available_capability_ids=(),
        selected_query_capability_ids=(),
    )
    result = conformance.run_conformance(
        ConformanceClient("ready"), expected_mode="ready", capability_fixture=fixture
    )
    assert fixture.available_capability_ids == ()
    assert fixture.selected_query_capability_ids == ()
    assert "query stream grounded final" in result.passed


def test_production_driver_and_conformance_imports_are_runtime_and_harness_isolated() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    script = """
import json
import sys
import host_agent_bridge.http_sse_driver as driver
import host_agent_bridge.conformance
print(json.dumps({
    'fake_loaded': 'host_agent_bridge.fake_host' in sys.modules,
    'vectors_loaded': 'host_agent_bridge.neutral_vectors' in sys.modules,
    'codex_loaded': 'host_agent_bridge.codex_cli_adapter' in sys.modules,
    'harness_exposed': hasattr(driver, 'HttpNeutralVectorHarness'),
}))
"""
    completed = subprocess.run(
        [sys.executable, "-c", script],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    )

    assert json.loads(completed.stdout) == {
        "fake_loaded": False,
        "vectors_loaded": False,
        "codex_loaded": False,
        "harness_exposed": False,
    }


def test_same_36_neutral_vector_objects_execute_through_http_binding_harness() -> None:
    harness = HttpNeutralVectorHarness(available_capability_ids=QUERY_MCP_TOOL_NAMES)

    results = run_neutral_vectors(NEUTRAL_VECTORS, harness)

    assert len(results) == 36
    assert all(result.passed for result in results)
    assert [id(vector) for vector in harness.seen_vectors] == [id(vector) for vector in NEUTRAL_VECTORS]
    assert harness.not_applicable_reasons == {}
    synthetic = {vector.name for vector in NEUTRAL_VECTORS if vector.applicability.category == "synthetic-binding"}
    assert synthetic
    assert synthetic.issubset(harness.http_materialization_reasons)
    assert all(
        harness.http_materialization_reasons[name].startswith("applicable:")
        for name in synthetic
    )
    cancel_names = {vector.name for vector in NEUTRAL_VECTORS if vector.action.startswith("cancel")}
    assert cancel_names.issubset(harness.locally_executed_vectors)
