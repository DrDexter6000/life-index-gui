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


ExpectedMode = Literal["ready", "unavailable", "runtime-unavailable"]

QUERY_SCHEMA = "gui.host_agent.query_response.v1"
METADATA_SCHEMA = "gui.host_agent.metadata_proposal.v1"
HEALTH_SCHEMA = "gui.host_agent.health.v1"


class ConformanceError(AssertionError):
    """Raised when a Host Agent endpoint violates the public contract."""


class HostAgentClient(Protocol):
    def get_json(self, path: str) -> dict[str, Any]:
        ...

    def post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        ...

    def post_sse(self, path: str, payload: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
        ...


@dataclass
class ConformanceResult:
    passed: list[str] = field(default_factory=list)

    def ok(self, label: str) -> None:
        self.passed.append(label)


class UrlHostAgentClient:
    """Small stdlib HTTP client used by `python -m host_agent_bridge.conformance`."""

    def __init__(self, base_url: str, timeout: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/") + "/"
        self.timeout = timeout

    def get_json(self, path: str) -> dict[str, Any]:
        return self._request_json("GET", path)

    def post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request_json("POST", path, payload)

    def post_sse(self, path: str, payload: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
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
                text = response.read().decode("utf-8")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise ConformanceError(f"{path} returned HTTP {exc.code}: {detail}") from exc
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
                body = response.read().decode("utf-8")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise ConformanceError(f"{path} returned HTTP {exc.code}: {detail}") from exc
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError as exc:
            raise ConformanceError(f"{path} did not return JSON") from exc
        _require(isinstance(parsed, dict), f"{path} JSON body must be an object")
        return parsed


def parse_sse(raw: str) -> list[tuple[str, dict[str, Any]]]:
    frames: list[tuple[str, dict[str, Any]]] = []
    for chunk in raw.strip().split("\n\n"):
        if not chunk.strip():
            continue
        event_type = "message"
        data_text = ""
        for line in chunk.splitlines():
            if line.startswith("event: "):
                event_type = line.removeprefix("event: ")
            elif line.startswith("data: "):
                data_text = line.removeprefix("data: ")
        if data_text:
            try:
                data = json.loads(data_text)
            except json.JSONDecodeError as exc:
                raise ConformanceError(f"SSE event {event_type} data is not JSON") from exc
            _require(isinstance(data, dict), f"SSE event {event_type} data must be an object")
            frames.append((event_type, data))
    return frames


def run_conformance(
    client: HostAgentClient | None = None,
    *,
    base_url: str = "http://127.0.0.1:8791",
    expected_mode: ExpectedMode = "ready",
    timeout: float = 30.0,
) -> ConformanceResult:
    target = client or UrlHostAgentClient(base_url, timeout=timeout)
    result = ConformanceResult()

    _check_health(target, expected_mode, result)
    _check_query_stream(target, expected_mode, result)
    _check_metadata(target, expected_mode, result)

    return result


def _check_health(client: HostAgentClient, expected_mode: ExpectedMode, result: ConformanceResult) -> None:
    payload = client.get_json("/health")
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

    if expected_mode == "ready":
        _require(payload.get("mode") == "PROPOSED", "ready metadata scenario must return PROPOSED")
        result.ok("metadata proposal envelope")
    else:
        _require(payload.get("mode") == "UNAVAILABLE", "unavailable metadata scenario must return UNAVAILABLE")
        _require(payload.get("fields") == {}, "unavailable metadata must not fabricate fields")
        result.ok("metadata unavailable proposal")


def validate_query_response(payload: dict[str, Any]) -> None:
    _require(payload.get("schema_version") == QUERY_SCHEMA, "query final schema_version mismatch")
    _require(payload.get("source") == "host-agent", "query final source must be host-agent")
    mode = payload.get("mode")
    _require(mode in {"GROUNDED", "UNGROUNDED", "PARTIAL", "UNAVAILABLE"}, "query final mode is invalid")
    answer = payload.get("answer")
    _require(isinstance(answer, dict), "query final answer must be an object")
    _require(answer.get("mode") == mode, "answer.mode must match top-level mode")
    _require(isinstance(answer.get("summary"), str), "answer.summary must be a string")
    evidence = payload.get("evidence")
    _require(isinstance(evidence, list), "query final evidence must be an array")
    if mode == "GROUNDED":
        _require(len(evidence) > 0, "GROUNDED query final requires evidence")
    if mode == "UNGROUNDED":
        _require(len(evidence) == 0, "UNGROUNDED query final must not include evidence")
    for item in evidence:
        _require(isinstance(item, dict), "each evidence item must be an object")
        for key in ("id", "rel_path", "title", "date"):
            _require(isinstance(item.get(key), str) and item[key], f"evidence item requires {key}")


def validate_metadata_proposal(payload: dict[str, Any]) -> None:
    _require(payload.get("schema_version") == METADATA_SCHEMA, "metadata schema_version mismatch")
    mode = payload.get("mode")
    _require(mode in {"PROPOSED", "UNAVAILABLE"}, "metadata mode is invalid")
    _require(isinstance(payload.get("reason"), str) and payload["reason"], "metadata reason must be non-empty")
    fields = payload.get("fields")
    _require(isinstance(fields, dict), "metadata fields must be an object")
    if mode == "PROPOSED":
        _require(len(fields) > 0, "PROPOSED metadata must include at least one field")
    else:
        _require(fields == {}, "UNAVAILABLE metadata must not fabricate fields")
    _require(isinstance(payload.get("warnings"), list), "metadata warnings must be an array")


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
