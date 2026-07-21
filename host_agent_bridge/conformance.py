"""Reusable conformance checks for the Host Agent Handoff contract.

The checks are provider-neutral. They exercise only the public HTTP/SSE
contract and never assume a model, SDK, or specific host-agent runtime.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
import json
from typing import Any, Literal, Protocol
from urllib import request as urllib_request
from urllib.error import HTTPError
from urllib.parse import urljoin

from host_agent_bridge.contracts import (
    HEALTH_SCHEMA,
    METADATA_FIELD_KEYS,
    parse_exact_json_object,
    parse_exact_json_value,
    validate_health as validate_health_payload,
    validate_metadata_proposal as validate_metadata_payload,
    validate_query_response as validate_query_payload,
)
from host_agent_bridge.http_sse_driver import (
    HTTP_SSE_BINDING_KIND,
    HTTP_SSE_BINDING_VERSION,
    MAX_BODY_BYTES,
    MAX_SSE_FRAME_BYTES,
    MAX_SSE_FRAMES,
    NEUTRAL_INTERFACE_VERSION,
    HttpSseBindingDriver,
)
from host_agent_bridge.neutral_contract import (
    ClientContextSnapshot,
    ContextFact,
    ErrorEvent,
    FinalEvent,
    NeutralSessionRequest,
    SessionAuthority,
    SessionExposureProfile,
    StatusEvent,
)
from host_agent_bridge.session_guard import NeutralKernelError, NeutralSessionGuard

ExpectedMode = Literal["ready", "unavailable", "runtime-unavailable"]


class ConformanceError(AssertionError):
    """Raised when a Host Agent endpoint violates the public contract."""


class HostAgentClient(Protocol):
    def get_json(self, path: str) -> dict[str, Any]:
        ...

    def post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        ...

    def post_sse(self, path: str, payload: dict[str, Any]) -> list[tuple[str, Any]]:
        ...


@dataclass
class ConformanceResult:
    passed: list[str] = field(default_factory=list)

    def ok(self, label: str) -> None:
        self.passed.append(label)


@dataclass(frozen=True)
class ConformanceCapabilityFixture:
    """Provider-neutral opaque capability authority for conformance sessions."""

    available_capability_ids: tuple[str, ...]
    selected_query_capability_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        available = self.available_capability_ids
        selected = self.selected_query_capability_ids
        if any(not isinstance(value, str) or not value for value in available):
            raise ValueError("available capability IDs must be non-empty strings")
        if len(set(available)) != len(available):
            raise ValueError("available capability IDs must be distinct")
        if any(not isinstance(value, str) or not value for value in selected):
            raise ValueError("selected query capability IDs must be non-empty strings")
        if len(set(selected)) != len(selected):
            raise ValueError("selected query capability IDs must be distinct")
        if not set(selected).issubset(available):
            raise ValueError("selected query capability IDs must be available")


DEFAULT_CAPABILITY_FIXTURE = ConformanceCapabilityFixture(
    available_capability_ids=("conformance.capability.alpha", "conformance.capability.beta"),
    selected_query_capability_ids=("conformance.capability.beta",),
)


class UrlHostAgentClient:
    """Small stdlib HTTP client used by `python -m host_agent_bridge.conformance`."""

    def __init__(self, base_url: str, timeout: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/") + "/"
        self.timeout = timeout

    def get_json(self, path: str) -> dict[str, Any]:
        return self._request_json("GET", path)

    def post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request_json("POST", path, payload)

    def post_sse(self, path: str, payload: dict[str, Any]) -> list[tuple[str, Any]]:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib_request.Request(
            urljoin(self.base_url, path.lstrip("/")),
            data=body,
            method="POST",
            headers={
                "Accept": "text/event-stream",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib_request.urlopen(req, timeout=self.timeout) as response:
                text = _read_bounded(response, path).decode("utf-8")
        except HTTPError as exc:
            _read_bounded(exc, path)
            raise ConformanceError(f"{path} returned HTTP {exc.code}") from exc
        return parse_sse(text)

    def _request_json(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        data = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib_request.Request(
            urljoin(self.base_url, path.lstrip("/")),
            data=data,
            method=method,
            headers=headers,
        )
        try:
            with urllib_request.urlopen(req, timeout=self.timeout) as response:
                body = _read_bounded(response, path).decode("utf-8")
        except HTTPError as exc:
            _read_bounded(exc, path)
            raise ConformanceError(f"{path} returned HTTP {exc.code}") from exc
        try:
            parsed = parse_exact_json_object(body)
        except ValueError as exc:
            raise ConformanceError(f"{path} did not return JSON") from exc
        return parsed


def _read_bounded(stream: Any, path: str) -> bytes:
    """Read one response with a real MAX+1 bounded read before buffering."""

    try:
        body = stream.read(MAX_BODY_BYTES + 1)
    except TypeError:
        # Compatibility for the pre-existing tiny test double.  Real urllib
        # response and HTTPError objects accept the bounded size argument.
        body = stream.read()
    if len(body) > MAX_BODY_BYTES:
        raise ConformanceError(f"{path} response body exceeded the configured limit")
    return body


def parse_sse(raw: str) -> list[tuple[str, Any]]:
    frames: list[tuple[str, Any]] = []
    if len(raw.encode("utf-8")) > MAX_BODY_BYTES:
        raise ConformanceError("SSE response body exceeded the configured limit")
    normalized = raw.replace("\r\n", "\n").replace("\r", "\n")
    for chunk in normalized.strip().split("\n\n"):
        if not chunk.strip():
            continue
        if len(frames) >= MAX_SSE_FRAMES:
            raise ConformanceError("SSE response exceeded the frame-count limit")
        if len(chunk.encode("utf-8")) > MAX_SSE_FRAME_BYTES:
            raise ConformanceError("SSE response frame exceeded the frame limit")
        event_type = "message"
        data_text = ""
        for line in chunk.splitlines():
            if line.startswith("event: "):
                event_type = line.removeprefix("event: ")
            elif line.startswith("data: "):
                data_text = line.removeprefix("data: ")
        if data_text:
            try:
                data = parse_exact_json_value(data_text)
            except ValueError as exc:
                raise ConformanceError(f"SSE event {event_type} data is not JSON") from exc
            frames.append((event_type, data))
    return frames


def run_conformance(
    client: HostAgentClient | None = None,
    *,
    base_url: str = "http://127.0.0.1:8791",
    expected_mode: ExpectedMode = "ready",
    timeout: float = 30.0,
    capability_fixture: ConformanceCapabilityFixture = DEFAULT_CAPABILITY_FIXTURE,
) -> ConformanceResult:
    target = client or UrlHostAgentClient(base_url, timeout=timeout)
    result = ConformanceResult()

    _preflight_neutral_conformance(capability_fixture)
    context = _conformance_context()
    profile = _conformance_profile(capability_fixture)
    authority = _conformance_authority()
    driver = HttpSseBindingDriver(target)
    guard = NeutralSessionGuard(
        driver,
        available_capability_ids=capability_fixture.available_capability_ids,
        interface_versions=(NEUTRAL_INTERFACE_VERSION,),
        binding_kind=HTTP_SSE_BINDING_KIND,
        binding_version=HTTP_SSE_BINDING_VERSION,
    )
    try:
        readiness = guard.readiness(profile, authority)
    except NeutralKernelError as exc:
        raise ConformanceError(f"neutral readiness failed: {exc.code}") from exc

    if expected_mode == "unavailable":
        _require(readiness.available is False, "unavailable health must project neutral available=false")
        result.ok("health unavailable envelope")
        _check_query_stream(target, expected_mode, result)
        result.ok("direct current-wire query unavailable characterization")
        _check_metadata(target, expected_mode, result)
        result.ok("direct current-wire metadata unavailable characterization")
    else:
        _require(readiness.available is True, "ready health must project neutral available=true")
        result.ok("health ready envelope")
        _check_guarded_query(
            guard, profile, authority, context, expected_mode, result, capability_fixture
        )
        _check_guarded_metadata(
            guard, profile, authority, context, expected_mode, result, capability_fixture
        )

    return result


def _preflight_neutral_conformance(
    capability_fixture: ConformanceCapabilityFixture,
) -> None:
    if not isinstance(capability_fixture, ConformanceCapabilityFixture):
        raise ConformanceError("neutral conformance capability fixture is invalid")
    if not callable(NeutralSessionGuard):
        raise ConformanceError("neutral conformance guard is missing")
    if not all(
        isinstance(value, str) and value
        for value in (
            NEUTRAL_INTERFACE_VERSION,
            HTTP_SSE_BINDING_KIND,
            HTTP_SSE_BINDING_VERSION,
        )
    ):
        raise ConformanceError("neutral conformance version identity is missing")


def _conformance_context() -> ClientContextSnapshot:
    def fact(value: Any, provenance: str) -> ContextFact:
        return ContextFact(
            value=value,
            source="conformance-fixture",
            observed_at_or_freshness="synthetic-current",
            manual_override=False,
            provenance=provenance,
        )

    return ClientContextSnapshot(
        context_id="conformance-context-1",
        locale="en-NG",
        timezone=fact("Africa/Lagos", "prov:conformance-timezone"),
        client_location=fact(None, "prov:conformance-location"),
        weather=fact(None, "prov:conformance-weather"),
    )


def _conformance_profile(
    capability_fixture: ConformanceCapabilityFixture,
) -> SessionExposureProfile:
    return SessionExposureProfile(
        profile_id="conformance-profile-1",
        capability_ids=capability_fixture.available_capability_ids,
        allowed_session_operations=("query", "metadata.propose"),
    )


def _conformance_authority() -> SessionAuthority:
    return SessionAuthority(
        session_id="conformance-session-1",
        data_scope_ref="scope:conformance-fixture",
        allowed_session_operations=("query", "metadata.propose"),
        exposure_profile_ref="conformance-profile-1",
        explicit_user_confirmation_state="not_required",
        explicit_user_confirmation_ref=None,
    )


def _conformance_request(
    request_id: str,
    operation: str,
    context: ClientContextSnapshot,
    capability_fixture: ConformanceCapabilityFixture,
) -> NeutralSessionRequest:
    return NeutralSessionRequest(
        request_id=request_id,
        operation=operation,
        session_id="conformance-session-1",
        context_id=context.context_id,
        exposure_profile_ref="conformance-profile-1",
        binding_kind=HTTP_SSE_BINDING_KIND,
        binding_version=HTTP_SSE_BINDING_VERSION,
        requested_capability_ids=(
            capability_fixture.selected_query_capability_ids if operation == "query" else ()
        ),
        cli_package_version_ref=None,
        cli_schema_version_ref=None,
        tool_trace_ref="trace:conformance",
        provenance_ref="prov:conformance-request",
        context_snapshot=context,
    )


def _check_guarded_query(
    guard: NeutralSessionGuard,
    profile: SessionExposureProfile,
    authority: SessionAuthority,
    context: ClientContextSnapshot,
    expected_mode: ExpectedMode,
    result: ConformanceResult,
    capability_fixture: ConformanceCapabilityFixture,
) -> None:
    request = _conformance_request(
        "conformance-query-1", "query", context, capability_fixture
    )
    events = guard.invoke(
        request,
        profile,
        authority,
        context,
        domain_payload={
            "conversation_id": "conformance-conversation-1",
            "query": "What evidence can you cite from the demo archive?",
            "intent": "grounded_query",
            "context": {},
            "limits": {"max_evidence": 3},
        },
    )
    _require(any(isinstance(event, StatusEvent) for event in events), "query stream must emit a status event")
    finals = [event for event in events if isinstance(event, FinalEvent)]
    errors = [event for event in events if isinstance(event, ErrorEvent)]
    _require(not errors, "accepted query session returned a neutral error")
    _require(len(finals) == 1, "query stream must emit exactly one final event")
    final = finals[0].model_dump(mode="json")["domain_envelope"]
    validate_query_response(final)
    if expected_mode == "ready":
        _require(final.get("mode") == "GROUNDED", "ready query scenario must return GROUNDED")
        result.ok("query stream grounded final")
    else:
        _require(final.get("mode") == "UNAVAILABLE", "unavailable query scenario must return UNAVAILABLE")
        _require(isinstance(final.get("reason"), str) and final["reason"], "unavailable query needs a reason")
        result.ok("query unavailable final")


def _check_guarded_metadata(
    guard: NeutralSessionGuard,
    profile: SessionExposureProfile,
    authority: SessionAuthority,
    context: ClientContextSnapshot,
    expected_mode: ExpectedMode,
    result: ConformanceResult,
    capability_fixture: ConformanceCapabilityFixture,
) -> None:
    request = _conformance_request(
        "conformance-metadata-1", "metadata.propose", context, capability_fixture
    )
    events = guard.invoke(
        request,
        profile,
        authority,
        context,
        domain_payload={
            "draft": {
                "title": "",
                "content": "A short fictional entry for protocol conformance.",
                "date": "2026-07-03",
                "existing_metadata": {},
            },
            "policy": {"preserve_user_fields": True},
        },
    )
    finals = [event for event in events if isinstance(event, FinalEvent)]
    errors = [event for event in events if isinstance(event, ErrorEvent)]
    _require(not errors, "accepted metadata session returned a neutral error")
    _require(len(finals) == 1, "metadata session must emit exactly one final event")
    payload = finals[0].model_dump(mode="json")["domain_envelope"]
    validate_metadata_proposal(payload)
    _require(
        set(payload.get("fields", {})).issubset(set(METADATA_FIELD_KEYS)),
        "metadata fields must use the canonical v1 key map",
    )
    if expected_mode == "ready":
        _require(payload.get("mode") == "PROPOSED", "ready metadata scenario must return PROPOSED")
        result.ok("metadata proposal envelope")
    else:
        _require(payload.get("mode") == "UNAVAILABLE", "unavailable metadata scenario must return UNAVAILABLE")
        _require(payload.get("fields") == {}, "unavailable metadata must not fabricate fields")
        result.ok("metadata unavailable proposal")


def _check_health(client: HostAgentClient, expected_mode: ExpectedMode, result: ConformanceResult) -> None:
    payload = client.get_json("/health")
    _validate_contract(validate_health_payload, payload, "health")
    _require(payload.get("schema_version") == HEALTH_SCHEMA, "health schema_version must be gui.host_agent.health.v1")
    _require(isinstance(payload.get("running"), bool), "health running must be boolean")
    _require(isinstance(payload.get("ready"), bool), "health ready must be boolean")
    _require(isinstance(payload.get("reason"), str) and payload["reason"], "health reason must be non-empty")
    _require(isinstance(payload.get("runtime"), dict), "health runtime must be an object")

    if expected_mode in {"ready", "runtime-unavailable"}:
        _require(payload["running"] is True, "ready health must have running=true")
        _require(payload["ready"] is True, "ready health must have ready=true")
        _require(payload.get("mode") == "READY", "ready health must have mode=READY")
        result.ok("health ready envelope")
    else:
        _require(payload["running"] is False, "unavailable health must have running=false")
        _require(payload["ready"] is False, "unavailable health must have ready=false")
        _require(payload.get("mode") in {"UNAVAILABLE", "NOT_READY"}, "unavailable health mode must be honest")
        result.ok("health unavailable envelope")


def _check_query_stream(client: HostAgentClient, expected_mode: ExpectedMode, result: ConformanceResult) -> None:
    frames = client.post_sse(
        "/query/stream",
        {
            "request_id": "conformance-query-1",
            "conversation_id": "conformance-conversation-1",
            "query": "What evidence can you cite from the demo archive?",
            "intent": "grounded_query",
            "context": {},
            "limits": {"max_evidence": 3},
        },
    )
    _require(frames, "query stream must emit at least one SSE frame")
    _require(any(event == "status" for event, _data in frames), "query stream must emit a status event")
    final_events = [data for event, data in frames if event == "final"]
    _require(len(final_events) == 1, "query stream must emit exactly one final event")
    final = final_events[0]
    validate_query_response(final)

    if expected_mode == "ready":
        _require(final.get("mode") == "GROUNDED", "ready query scenario must return GROUNDED")
        result.ok("query stream grounded final")
    else:
        _require(final.get("mode") == "UNAVAILABLE", "unavailable query scenario must return UNAVAILABLE")
        _require(isinstance(final.get("reason"), str) and final["reason"], "unavailable query needs a reason")
        result.ok("query unavailable final")


def _check_metadata(client: HostAgentClient, expected_mode: ExpectedMode, result: ConformanceResult) -> None:
    payload = client.post_json(
        "/metadata/propose",
        {
            "request_id": "conformance-metadata-1",
            "draft": {
                "title": "",
                "content": "A short fictional entry for protocol conformance.",
                "date": "2026-07-03",
                "existing_metadata": {},
            },
            "policy": {"preserve_user_fields": True},
        },
    )
    validate_metadata_proposal(payload)
    _require(
        set(payload.get("fields", {})).issubset(set(METADATA_FIELD_KEYS)),
        "metadata fields must use the canonical v1 key map",
    )

    if expected_mode == "ready":
        _require(payload.get("mode") == "PROPOSED", "ready metadata scenario must return PROPOSED")
        result.ok("metadata proposal envelope")
    else:
        _require(payload.get("mode") == "UNAVAILABLE", "unavailable metadata scenario must return UNAVAILABLE")
        _require(payload.get("fields") == {}, "unavailable metadata must not fabricate fields")
        result.ok("metadata unavailable proposal")


def validate_query_response(payload: dict[str, Any]) -> None:
    _validate_contract(validate_query_payload, payload, "query final")


def validate_metadata_proposal(payload: dict[str, Any]) -> None:
    _validate_contract(validate_metadata_payload, payload, "metadata proposal")


def _validate_contract(validator: Any, payload: dict[str, Any], label: str) -> None:
    try:
        validator(payload)
    except ValueError as exc:
        raise ConformanceError(f"{label} envelope invalid") from exc


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ConformanceError(message)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check a Host Agent Handoff endpoint for protocol conformance.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8791")
    parser.add_argument("--expect", choices=["ready", "unavailable", "runtime-unavailable"], default="ready")
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args(argv)

    try:
        result = run_conformance(base_url=args.base_url, expected_mode=args.expect, timeout=args.timeout)
    except ConformanceError as exc:
        print(f"FAIL {exc}")
        return 1

    for label in result.passed:
        print(f"PASS {label}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
