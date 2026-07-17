"""Provider-neutral Host Agent runtime example.

This deterministic stub reads the bridge prompt, extracts the request JSON, and
returns the public Host Agent handoff envelope. It uses no model, network,
credentials, or user data.
"""

from __future__ import annotations

import json
import sys
from typing import Any


def _read_prompt() -> str:
    if len(sys.argv) > 1:
        return sys.argv[-1]
    return sys.stdin.read()


def _extract_request(prompt: str) -> dict[str, Any]:
    marker = "Request JSON:"
    text = prompt.split(marker, 1)[1] if marker in prompt else prompt
    decoder = json.JSONDecoder()
    start = text.find("{")
    while start >= 0:
        chunk = text[start:].lstrip()
        try:
            value, _end = decoder.raw_decode(chunk)
        except json.JSONDecodeError:
            start = text.find("{", start + 1)
            continue
        if isinstance(value, dict):
            return value
        start = text.find("{", start + 1)
    return {}


def _metadata_response(request: dict[str, Any]) -> dict[str, Any]:
    policy = request.get("policy") if isinstance(request.get("policy"), dict) else {}
    return {
        "schema_version": "gui.host_agent.metadata_proposal.v1",
        "request_id": request.get("request_id"),
        "mode": "PROPOSED",
        "reason": "semantic-fields-proposed-by-host-agent",
        "fields": {
            "title": {
                "value": "Demo metadata proposal",
                "field_source": "host-agent",
                "confidence": 0.5,
                "rationale": "Provider-neutral reference runtime returned a deterministic proposal.",
            }
        },
        "warnings": [],
        "policy": {"preserve_user_fields": bool(policy.get("preserve_user_fields", True))},
    }


def _query_response(request: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": "gui.host_agent.query_response.v1",
        "request_id": request.get("request_id"),
        "conversation_id": request.get("conversation_id"),
        "source": "host-agent",
        "mode": "GROUNDED",
        "reason": "provider-neutral reference runtime cited deterministic demo evidence",
        "query": request.get("query") or "",
        "answer": {
            "mode": "GROUNDED",
            "reason": "provider-neutral reference runtime cited deterministic demo evidence",
            "summary": "This reference runtime returned a grounded demo answer with one cited journal pointer.",
            "insights": [
                {
                    "theme": "host-agent-handoff",
                    "summary": "The bridge can consume a provider-neutral runtime that only speaks JSON.",
                    "confidence": 0.5,
                }
            ],
            "gap": None,
            "suggestions": ["Replace this deterministic runtime with your own Host Agent command."],
        },
        "evidence": [
            {
                "id": "demo/2026-02-22-skyvision.md",
                "rel_path": "Journals/demo/2026-02-22-skyvision.md",
                "title": "SkyVision Africa planning note",
                "date": "2026-02-22",
            }
        ],
        "tool_trace": [{"tool": "stdio-json-agent", "status": "ok"}],
    }


def main() -> int:
    prompt = _read_prompt()
    request = _extract_request(prompt)
    is_metadata = "metadata_proposal.v1" in prompt or "draft" in request
    if is_metadata:
        payload = _metadata_response(request)
    else:
        print("Reading deterministic demo evidence through stdio-json-agent.", file=sys.stderr, flush=True)
        payload = _query_response(request)
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
