# Host Agent Handoff Contract

Life Index GUI does not contain an LLM, model router, or planner. AI+ is a handoff surface: the GUI/backend forwards bounded requests to a user-provided Host Agent runtime and renders the returned status, evidence, and answer.

This document is the public, runtime-neutral contract for that handoff.

## Roles

- Life Index CLI owns durable data and deterministic tools.
- Life Index GUI owns human-facing presentation.
- The Host Agent owns planning, retrieval choices, model choice, reasoning, and synthesis.
- The reference bridge is an adapter. It proves the protocol shape; it is not required for every runtime.

## Backend Relay

The GUI backend talks to one configured Host Agent endpoint:

```text
LIFE_INDEX_HOST_AGENT_URL=http://127.0.0.1:8791
```

If the URL is missing or unreachable, GUI AI+ must show an honest unavailable/offline state. The GUI must not fabricate answers or silently fall back to local intelligence.

## Interfaces

### GET /health

Returns Host Agent readiness.

```json
{
  "schema_version": "gui.host_agent.health.v1",
  "running": true,
  "ready": true,
  "degraded": false,
  "mode": "READY",
  "reason": "configured",
  "runtime": {
    "kind": "external-host-agent",
    "interface_version": "v1"
  },
  "checks": []
}
```

When unavailable, return `running=false`, `ready=false`, `mode="UNAVAILABLE"` or `mode="NOT_READY"`, and a clear `reason`.

### POST /query/stream

Consumes a grounded query request and returns Server-Sent Events.

Request:

```json
{
  "query": "What did I write about SkyVision Africa?",
  "conversation_id": "optional-conversation-id",
  "intent": "grounded_query",
  "context": {},
  "limits": {}
}
```

Event types:

- `status`: progress phase and message. Known phases include `connecting`, `planning`, `calling_host_agent`, `searching`, `answering`, `complete`, and `error`.
- `evidence`: bounded evidence preview array.
- `delta`: displayable runtime output, if the Host Agent chooses to stream it.
- `final`: one `gui.host_agent.query_response.v1` envelope.
- `error`: structured transport error. Prefer a final `UNAVAILABLE` envelope when possible.

Final response schema:

```json
{
  "schema_version": "gui.host_agent.query_response.v1",
  "request_id": "optional-request-id",
  "conversation_id": "optional-conversation-id",
  "source": "host-agent",
  "mode": "GROUNDED",
  "reason": "cited evidence was read",
  "query": "What did I write about SkyVision Africa?",
  "answer": {
    "mode": "GROUNDED",
    "reason": "cited evidence was read",
    "summary": "You wrote one note about the SkyVision Africa planning thread.",
    "insights": [],
    "gap": null,
    "suggestions": []
  },
  "evidence": [
    {
      "id": "demo/2026-02-22-skyvision.md",
      "rel_path": "Journals/demo/2026-02-22-skyvision.md",
      "title": "SkyVision Africa planning note",
      "date": "2026-02-22"
    }
  ],
  "tool_trace": []
}
```

`GROUNDED` requires evidence. `UNGROUNDED` must not include evidence. `PARTIAL` and `UNAVAILABLE` are valid honest states when evidence or runtime capability is insufficient.

### POST /metadata/propose

Consumes a draft and returns a `gui.host_agent.metadata_proposal.v1` envelope.

Request:

```json
{
  "request_id": "optional-request-id",
  "draft": {
    "title": "",
    "content": "Draft journal text",
    "date": "2026-07-02",
    "existing_metadata": {}
  },
  "policy": {
    "preserve_user_fields": true
  }
}
```

Response:

```json
{
  "schema_version": "gui.host_agent.metadata_proposal.v1",
  "request_id": "optional-request-id",
  "mode": "PROPOSED",
  "reason": "semantic-fields-proposed-by-host-agent",
  "fields": {
    "title": {
      "value": "Draft journal text",
      "field_source": "host-agent",
      "confidence": 0.5,
      "rationale": "Deterministic example proposal."
    }
  },
  "warnings": [],
  "policy": {
    "preserve_user_fields": true
  }
}
```

The Host Agent must respect `policy.preserve_user_fields=true`. The GUI should present proposals, not silently overwrite user-authored metadata.

## Reference Bridge

The optional bridge in `host_agent_bridge/server.py` adapts a local command runtime to the HTTP/SSE contract above.

Example with the provider-neutral deterministic runtime:

```bash
export LIFE_INDEX_HOST_AGENT_ARGV_JSON='["python","examples/host-agent-runtime/stdio-json-agent/stdio_json_agent.py"]'
python -m uvicorn host_agent_bridge.server:app --host 127.0.0.1 --port 8791
```

Then start the GUI backend with:

```bash
export LIFE_INDEX_HOST_AGENT_URL=http://127.0.0.1:8791
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

The example runtime uses no network, model, credentials, or private user data. It only demonstrates the handoff envelope shape.

## Failure Behavior

- Missing Host Agent URL: return structured `UNAVAILABLE`.
- Runtime timeout/failure: return structured `UNAVAILABLE` or `NOT_READY` with a clear reason.
- Invalid runtime JSON: return `UNAVAILABLE`; do not display terminal noise as final reasoning.
- Evidence mismatch: do not label the answer `GROUNDED`.
