# Host Agent Handoff Contract

Life Index GUI does not contain an LLM, model router, or planner. AI+ is a handoff surface: the GUI/backend forwards bounded requests to a user-provided Host Agent runtime and renders the returned status, evidence, and answer.

This document is the public, runtime-neutral contract for that handoff. Any
bridge implementation may be used if it exposes the interfaces below and passes
the conformance kit.

Cross-layer role ownership and delivery status are normative in the **Authority, Roles, And Delivery State** block of `docs/ARCHITECTURE.md`; this document owns the CURRENT v1 handoff wire contract only.

**CURRENT:** The GUI repository owns the reference bridge, which remains outside
CLI Core and exposes the HTTP/SSE handoff contract below. The production GUI
data route remains backend/BFF → direct CLI/Core contracts; Gateway is not
involved. The bridge and backend share the GUI-owned
`host_agent_bridge/contracts.py` models for the three existing v1 envelope
families. The named Codex CLI adapter is GUI-owned and projects into these
same envelopes; it does not add a provider-specific public schema.

**CURRENT — D2 C3 correction:** the explicitly named Codex CLI adapter is
GUI-owned and strict, without changing the runtime-neutral v1 envelopes or
introducing a generic runtime/output protocol. The current D2 contract accepts
the C3 trust boundary alongside the accepted A/B and prior C1/C2 work.

### Explicit adapter selection

The reference bridge selects its adapter only from the named configuration
below. It never infers a provider from an executable name, argv, or terminal
output.

```text
LIFE_INDEX_HOST_AGENT_ADAPTER_KIND=reference-command   # default
LIFE_INDEX_HOST_AGENT_ADAPTER_KIND=codex-cli
```

Any other value is invalid and fails closed as `UNAVAILABLE`. The
`reference-command` path remains the provider-neutral default used by the
stdio-json and command-json examples.

### Named Codex CLI support matrix

| Surface | D2 support | Boundary |
|---|---|---|
| Adapter selection | `codex-cli` only when explicitly selected | No argv/executable inference; invalid kind is unavailable |
| Invocation | `codex exec -C <run-dir> --skip-git-repo-check --ignore-user-config --output-schema <schema-inside-run-dir> --output-last-message <output-inside-run-dir> --ephemeral -` | Each request creates one unique run directory, passes it as subprocess `cwd` and the `-C` working root, and excludes unrelated user-configured MCP/hooks/settings; Codex authentication still uses `CODEX_HOME`; prompt is stdin; stdout/stderr are never domain output |
| Prompt assets | Caller/configuration-owned UTF-8 files plus exact configured SHA-256 | Set both file variables and `LIFE_INDEX_HOST_AGENT_QUERY_PROMPT_SHA256` / `LIFE_INDEX_HOST_AGENT_METADATA_PROMPT_SHA256`; no bundled domain fallback or Skill discovery |
| Output | One complete JSON object from the unique output file after exit `0` | Missing, stale, empty, malformed, fenced, prose-wrapped, or contradictory output fails closed |
| Synthetic CLI argv/cwd | Local synthetic assertions cover the exact safe argv and prove the child OS cwd equals `<run-dir>` | This does not prove that a real model or network invocation accepts `--output-schema` |

The adapter never adds authority-expanding or bypass flags such as
`--dangerously-bypass-approvals-and-sandbox`, `--add-dir`, or `--ignore-rules`;
approval and sandbox policy remain host/user authority.

Codex health is a bounded configuration and installed-runtime preflight: it
checks executable discoverability, exact supported Codex version `0.144.1`,
`codex login status`, freshness of both configured procedure assets, and the
configured projection Python. The projection child imports
`tools.mcp_projection` and `mcp`, reads installed distribution metadata, and
requires Life Index `1.5.1+` plus exactly `mcp==1.27.2`. It receives only the
configured isolated data/config/cache/tmp roots with bytecode and user-site
imports disabled. On Windows, its sole inherited OS compatibility variable is `SYSTEMROOT`;
it forwards no home/profile/PATH or ambient data/config/cache variables. It does
not start a server, call a model/network, invoke a journal/index command, or
write product data. Version output is bounded and
login terminal bodies are discarded; health reasons disclose no auth body,
terminal body, child body, or filesystem path. Missing, malformed, or
mismatched SHA-256 configuration is `NOT_READY`, and invocation rechecks the
same digest so a health/call freshness bypass is impossible. A healthy result
uses `configured-runtime-preflight-passed`; the live-model check remains the
advisory `live-model-invocation-advisory-unverified` because health never makes
a model or network call.

Prompt assembly is deterministic: the configured procedure prefix is retained
up to the adapter budget and marked with `[procedure truncated]` when shortened;
the canonical request JSON is kept intact up to its fixed cap and then the
adapter fails closed. Adapter diagnostics contain only a logical source ID,
input/retained lengths, truncation, assembly version/steps, schema family, and
bounded process metadata (return code, timeout/cancellation, output presence /
size, stdout/stderr lengths). They never include query, draft, journal,
procedure, credentials, filesystem paths, or terminal bodies.

## Roles

- Life Index CLI owns durable data and deterministic tools.
- Life Index GUI owns human-facing presentation.
- The Host Agent owns planning, retrieval choices, model choice, reasoning, and synthesis.
- Bridge implementations adapt user-provided host-agent runtimes to the
  versioned HTTP/SSE contract. The bundled bridge and examples are reference
  implementations, not required infrastructure.

## Backend Relay

The GUI backend talks to one configured Host Agent endpoint:

```text
LIFE_INDEX_HOST_AGENT_URL=http://127.0.0.1:8791
```

If the URL is missing or unreachable, GUI AI+ must show an honest unavailable/offline state. The GUI must not fabricate answers or silently fall back to local intelligence.

## Remote GUI Link For Host Agents

Remote browser access is a GUI capability, not a CLI data feature and not a
host-agent intelligence feature. If a user asks the host agent for a temporary
phone link, run the GUI command:

```bash
npm run remote-link:start
```

The command prints a `gui.remote_link.v1` JSON envelope. Relay `url` and
`one_time_code` to the user, then stop the link when the session is over:

```bash
npm run remote-link:stop
```

The command uses the same `/api/public-link/*` backend logic as the desktop GUI
button. The public tunnel exposes only the token-gated GUI data plane; control
operations stay local and are blocked inside the tunnel backend.

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

`GROUNDED` requires evidence. `UNGROUNDED` must not include evidence.
`PARTIAL`, `SCAFFOLD`, and `UNAVAILABLE` are valid honest states when evidence
or runtime capability is insufficient; they carry no additional evidence
requirement.

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

The metadata `fields` map accepts exactly these v1 keys: `title`, `abstract`,
`project`, `topics`, `moods`, `people`, `tags`, and `links`. `topics` and
`moods` are the envelope names; the existing journal draft/Core request shape
continues to use its `topic` and `mood` fields. Unknown field keys (including
`weather`) are protocol errors. Root envelope fields and additive fields on a
`MetadataField` remain forward-compatible and are preserved. `metadata_proposal.v2`
is not a supported family.

### Strict v1 envelope rules

The canonical Pydantic models in `host_agent_bridge/contracts.py` are the
single validator used by the reference bridge, backend relay, and conformance
kit. They preserve additive fields for forward compatibility, but do not
coerce or semantically repair values.

| Family | Enforced rule | Authority |
|---|---|---|
| `health.v1` | Exact `schema_version`; boolean `running`/`ready`; `mode`, non-empty `reason`, object `runtime`, and array `checks`. | This document's `/health` contract and conformance kit |
| `query_response.v1` | Exact family and `source="host-agent"`; structured `answer`; `answer.mode` equals top-level `mode`; evidence items have non-empty `id`, `rel_path`, `title`, and `date`. | This document's final schema and conformance kit |
| `query_response.v1` | `GROUNDED` has non-empty evidence; `UNGROUNDED` has empty evidence. `PARTIAL`, `SCAFFOLD`, and `UNAVAILABLE` carry no additional evidence requirement. | Existing GUI v1 mode table and conformance semantics |
| `metadata_proposal.v1` | Exact family; `PROPOSED` has one or more structured fields from the canonical eight-key map; `UNAVAILABLE` has no fields; non-empty `reason` and array `warnings`. Unknown map keys and `metadata_proposal.v2` are rejected. | This document's proposal schema and conformance kit |

At the final runtime boundary, output must be one complete JSON object. A
fenced object, prose prefix/suffix, substring extraction, quote repair, nested
envelope unwrap, alias, path-derived evidence, mode/evidence promotion, or
other semantic normalization is invalid. The bridge returns an honest
`UNAVAILABLE` envelope with reason `host-agent-envelope-invalid`; it does not
rewrite the host output. The backend relay applies the same validation to
`final` query and metadata envelopes before exposing them, while `status` and
`delta` events retain passthrough behavior.

## Bring Your Own Bridge

The GUI backend does not require a specific bridge implementation. It only needs
one configured Host Agent endpoint:

```text
LIFE_INDEX_HOST_AGENT_URL=http://127.0.0.1:8791
```

Your bridge may be the bundled reference bridge, a local service you maintain, or
another process that implements `GET /health`, `POST /query/stream`, and
`POST /metadata/propose` with the schema envelopes above. The GUI/backend must
not select models, inspect query semantics, or synthesize answers on behalf of
the Host Agent.

## Reference Bridge And Adapters

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

For an externally configured headless-agent command, use the second
provider-neutral adapter:

```bash
export LIFE_INDEX_HOST_AGENT_ARGV_JSON='["python","examples/host-agent-runtime/command-json-adapter/command_json_adapter.py"]'
export LIFE_INDEX_HOST_AGENT_ADAPTER_ARGV_JSON='["/path/to/your/headless-agent-json-command"]'
python -m uvicorn host_agent_bridge.server:app --host 127.0.0.1 --port 8791
```

The command JSON adapter extracts the bridge request JSON, spawns only the
command configured by the user, and accepts only the same
`gui.host_agent.query_response.v1` / `gui.host_agent.metadata_proposal.v1`
envelopes. It ships no model, SDK, API key, default provider, or bundled agent.

These two examples are explicitly provider-neutral adapters: the deterministic
`stdio-json-agent` reference runtime and the configurable
`command-json-adapter`. They are not Codex adapters and do not imply support
for any named runtime. Both emit the complete final envelope on their
machine-readable output channel; progress or diagnostic text is not final
data.

### Named Codex production setup

Use one absolute, dedicated projection root. The following Linux-style path is
an example of an isolated installation location, not a user-data location:

```bash
export PROJECTION_ROOT=/srv/life-index-codex-projection
mkdir -p "$PROJECTION_ROOT"/{data,config,cache,tmp,prompts}
python3 -m venv "$PROJECTION_ROOT/venv"
"$PROJECTION_ROOT/venv/bin/python" -m pip install --upgrade pip
"$PROJECTION_ROOT/venv/bin/python" -m pip install "life-index[mcp]==1.5.1"
```

On Windows PowerShell, the operator must provide an explicit absolute root;
the bridge never guesses a profile from a username, home directory, checkout,
or ambient Life Index configuration:

```powershell
$env:LIFE_INDEX_AI_ROOT = '<absolute-dedicated-projection-root>'
if (-not [System.IO.Path]::IsPathFullyQualified($env:LIFE_INDEX_AI_ROOT)) {
  throw 'LIFE_INDEX_AI_ROOT must be absolute'
}
$ProjectionRoot = (New-Item -ItemType Directory -Force -Path $env:LIFE_INDEX_AI_ROOT).FullName
foreach ($Name in 'data','config','cache','tmp','prompts') {
  New-Item -ItemType Directory -Force -Path (Join-Path $ProjectionRoot $Name) | Out-Null
}
py -3.12 -m venv (Join-Path $ProjectionRoot 'venv')
$ProjectionPython = Join-Path $ProjectionRoot 'venv\Scripts\python.exe'
& $ProjectionPython -m pip install --upgrade pip
& $ProjectionPython -m pip install 'life-index[mcp]==1.5.1'
```

Place the owner-approved UTF-8 query and metadata procedure assets under the
dedicated `prompts/` directory. They are caller/Skill/configuration data; the
bridge neither reads bundled provider-neutral examples for this path nor
discovers Skills. Then configure the named adapter, exact projection roots, and
asset digests:

```bash
export LIFE_INDEX_HOST_AGENT_ADAPTER_KIND=codex-cli
export LIFE_INDEX_CODEX_EXECUTABLE=codex
export LIFE_INDEX_CODEX_QUERY_PROJECTION_ROOT="$PROJECTION_ROOT"
export LIFE_INDEX_CODEX_QUERY_PROJECTION_PYTHON="$PROJECTION_ROOT/venv/bin/python"
export LIFE_INDEX_CODEX_QUERY_PROJECTION_DATA_DIR="$PROJECTION_ROOT/data"
export LIFE_INDEX_CODEX_QUERY_PROJECTION_CONFIG_DIR="$PROJECTION_ROOT/config"
export LIFE_INDEX_CODEX_QUERY_PROJECTION_CACHE_DIR="$PROJECTION_ROOT/cache"
export LIFE_INDEX_CODEX_QUERY_PROJECTION_TMPDIR="$PROJECTION_ROOT/tmp"
export LIFE_INDEX_HOST_AGENT_QUERY_PROMPT_FILE="$PROJECTION_ROOT/prompts/query-procedure.txt"
export LIFE_INDEX_HOST_AGENT_METADATA_PROMPT_FILE="$PROJECTION_ROOT/prompts/metadata-procedure.txt"
export LIFE_INDEX_HOST_AGENT_QUERY_PROMPT_SHA256="$(sha256sum "$LIFE_INDEX_HOST_AGENT_QUERY_PROMPT_FILE" | awk '{print $1}')"
export LIFE_INDEX_HOST_AGENT_METADATA_PROMPT_SHA256="$(sha256sum "$LIFE_INDEX_HOST_AGENT_METADATA_PROMPT_FILE" | awk '{print $1}')"
```

The equivalent PowerShell configuration is:

```powershell
$env:LIFE_INDEX_HOST_AGENT_ADAPTER_KIND = 'codex-cli'
$env:LIFE_INDEX_CODEX_EXECUTABLE = 'codex'
$env:LIFE_INDEX_CODEX_QUERY_PROJECTION_ROOT = $ProjectionRoot
$env:LIFE_INDEX_CODEX_QUERY_PROJECTION_PYTHON = $ProjectionPython
$env:LIFE_INDEX_CODEX_QUERY_PROJECTION_DATA_DIR = Join-Path $ProjectionRoot 'data'
$env:LIFE_INDEX_CODEX_QUERY_PROJECTION_CONFIG_DIR = Join-Path $ProjectionRoot 'config'
$env:LIFE_INDEX_CODEX_QUERY_PROJECTION_CACHE_DIR = Join-Path $ProjectionRoot 'cache'
$env:LIFE_INDEX_CODEX_QUERY_PROJECTION_TMPDIR = Join-Path $ProjectionRoot 'tmp'
$env:LIFE_INDEX_HOST_AGENT_QUERY_PROMPT_FILE = Join-Path $ProjectionRoot 'prompts\query-procedure.txt'
$env:LIFE_INDEX_HOST_AGENT_METADATA_PROMPT_FILE = Join-Path $ProjectionRoot 'prompts\metadata-procedure.txt'
$env:LIFE_INDEX_HOST_AGENT_QUERY_PROMPT_SHA256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $env:LIFE_INDEX_HOST_AGENT_QUERY_PROMPT_FILE).Hash.ToLowerInvariant()
$env:LIFE_INDEX_HOST_AGENT_METADATA_PROMPT_SHA256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $env:LIFE_INDEX_HOST_AGENT_METADATA_PROMPT_FILE).Hash.ToLowerInvariant()
```

Use Codex `0.144.1`, start the bridge from its configured GUI runtime in its
own process, and confirm it from a separate terminal before pointing the GUI
backend to it:

```bash
python -m uvicorn host_agent_bridge.server:app --host 127.0.0.1 --port 8791
```

```bash
curl -fsS http://127.0.0.1:8791/health
```

PowerShell equivalent: `Invoke-RestMethod http://127.0.0.1:8791/health`.

After that health response is ready, start the GUI backend in its own process:

```bash
export LIFE_INDEX_HOST_AGENT_URL=http://127.0.0.1:8791
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

From another terminal, verify the GUI backend at
`http://127.0.0.1:8000/api/health`. A non-ready health response must be
corrected before AI+ use; it is not safe to fall back to ambient Life Index,
config, cache, or temporary paths.

```bash
curl -fsS http://127.0.0.1:8000/api/health
```

PowerShell equivalent: `Invoke-RestMethod http://127.0.0.1:8000/api/health`.

The Codex adapter creates a unique run directory per request, passes it both as
the subprocess cwd and the exact `-C` working root, and invokes only:

```text
codex exec -C <run-dir> --skip-git-repo-check --ignore-user-config --output-schema <schema-inside-run-dir> --output-last-message <output-inside-run-dir> --ephemeral -
```

It passes the assembled prompt on stdin and accepts domain data only from the
output file after a successful child exit. Timeout, cancellation, non-zero exit,
and partial output all clean up the run directory and produce an honest
unavailable response. No real model or network call was part of the historical
D2 proof. Codex `0.144.1` has since completed same-machine isolated real
model/network/generated-schema and grounded acceptance. A future Codex version,
authentication mode, or permission-contract change requires a new compatibility
review.

## Conformance Kit

Run the reusable conformance kit against any bridge before pointing the GUI at
it:

The public export already stages `host_agent_bridge/` recursively. Within that
source surface, the neutral schemas, frozen vectors, fake binding,
provider-neutral runner, and HTTP conformance harness are intentionally reusable
conformance-kit assets; they are not production dependencies of
`http_sse_driver.py`.

```bash
python -m host_agent_bridge.conformance --base-url http://127.0.0.1:8791 --expect ready
```

For a bridge that is reachable but whose user-configured runtime is intentionally
absent during setup checks, use `--expect runtime-unavailable`.

The kit checks:

- `GET /health` returns `gui.host_agent.health.v1` readiness or honest
  unavailable state.
- `POST /query/stream` emits status and exactly one final
  `gui.host_agent.query_response.v1` envelope.
- Final query and metadata envelopes are validated by the canonical v1 models;
  invalid output produces `UNAVAILABLE` with
  `host-agent-envelope-invalid`.
- `GROUNDED` query responses contain structured `evidence[]`; `UNGROUNDED`
  responses do not.
- `POST /metadata/propose` returns a valid
  `gui.host_agent.metadata_proposal.v1` envelope.
- Missing or unavailable runtimes produce explicit `UNAVAILABLE` envelopes
  instead of fabricated answers.

## Failure Behavior

- Missing Host Agent URL: return structured `UNAVAILABLE`.
- Runtime timeout/failure: return structured `UNAVAILABLE` or `NOT_READY` with a clear reason.
- Invalid runtime JSON: return `UNAVAILABLE`; do not display terminal noise as final reasoning.
- Evidence mismatch: do not label the answer `GROUNDED`.
