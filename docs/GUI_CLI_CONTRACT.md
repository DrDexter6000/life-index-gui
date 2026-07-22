# GUI/CLI Contract

Status: active public contract for stable Life Index CLI consumption by the
GUI.

The Life Index CLI is the provider and source of truth. The GUI adapts through
its backend adapter and does not ask the stable CLI core to reshape itself for
GUI convenience unless a provider-side RFC or PRD accepts that change.

## Authority

| Layer | Owner | Source |
|---|---|---|
| CLI provider behavior | `life-index` | `life-index/CHARTER.md`, `life-index/docs/API.md`, `life-index/docs/ENTITY_GRAPH.md`, `life-index/docs/VERSIONING.md` |
| GUI consumer behavior | Life Index GUI | this file and backend/frontend code |
| Unmet provider needs | CLI provider planning or ignored local workpacks | not public GUI SSOT |

This file records stable consumed contracts and intentionally blocked
assumptions. It is not a request queue, roadmap, sprint board, or closure log.

Cross-layer roles, CURRENT/TARGET topology, and delivery sequence are normative in the **Authority, Roles, And Delivery State** block of `docs/ARCHITECTURE.md`. This contract owns only consumed GUI/CLI shapes and the L1 data boundary.

**CURRENT production route:** GUI frontend → GUI backend/BFF → direct CLI/Core contracts. Gateway is optional future work, not a GUI dependency.

## Data Boundary

| Read class | Meaning | GUI/backend rule |
|---|---|---|
| R0 | No user-data access | UI layout, view state, visual transforms |
| R1 | CLI-mediated read | Default for journals, metadata, search, stats, timeline, attachments, entity graph, imports, and indexes |
| R2 | Constrained direct read exception | Requires explicit documentation, CLI-provided path provenance, path guard, no parsing/scanning, no durable cache, and retirement plan |
| R3 | Forbidden direct structural read | Direct journal/frontmatter parsing, directory scans, SQLite/index queries, entity graph file parsing, attachment file serving, stats computation from L1 |

Hard rules:

- GUI/backend must not mutate L1 user data directly.
- GUI/backend must not perform R3 direct structural reads.
- GUI/backend must not read `entity_graph.yaml` or `Entities/*.md` directly for
  entity consumption surfaces; entity graph facts, profile data, and stale
  state must flow through CLI JSON contracts.
- Attachment bytes are user data and must be accessed through the CLI media
  contract, not direct file serving or a legacy JSON/base64 export fallback.
- Backend adapters may compose supported CLI calls, but composition must remain
  stateless and must not create a second source of truth.

`backend/test_l1_boundary.py` enforces this boundary for production backend
Python code.

## Runtime Handshake

The backend must establish CLI compatibility before treating data features as
healthy.

1. Resolve the executable from configuration, defaulting to `life-index`.
2. Run `life-index version`.
3. Run `life-index health`.
4. Surface degraded CLI health honestly instead of hiding it behind fallback
   data.
5. Cache handshake state only with a short TTL.

Current known baseline:

**CURRENT — D2:** GUI `0.3.x` requires CLI `1.4.5+`. `/api/version` is the
single machine-readable source for this requirement via
`cli_minimum_version` and `compatible`.

- The backend checks the CLI version before health. Only an exact numeric
  `MAJOR.MINOR.PATCH` version is parseable; pre-`1.4.5`, short, prerelease,
  build-suffixed, missing, or otherwise unparseable versions are incompatible.
- The adapter preflights every non-handshake CLI call and returns a structured
  compatibility error before invoking the protected feature command.
- Entity review cards use the same global floor; there is no lower route-level
  compatibility exception.
- `gui-upgrade --plan --json` reports the same read-only CLI dependency floor.
  It may recommend manual CLI resolution, but the GUI atom does not upgrade or
  install the CLI.
- Earlier route-level minimums such as journal/Data Doctor `1.2.4` and Index
  Tree Evidence Navigation `1.2.2` are covered by the global `1.4.5+`
  handshake requirement.

### Optional Codex AI+ projection floor

The global CLI compatibility floor remains `1.4.5` for the GUI’s ordinary
deterministic data route and `/api/version` handshake. It is not raised by the
optional AI+ bridge.

The AI+ Codex projection floor is `1.5.1`: its explicitly configured,
isolated projection virtual environment must install `life-index[mcp]>=1.5.1`
and exactly `mcp==1.27.2`. This is a separate installed-runtime preflight for
the optional three-tool projection (`health`, `journal.get`, `search`), not a
new global GUI CLI floor, a new data authority, or an install/upgrade action by
the GUI.

Configuration:

| Name | Purpose |
|---|---|
| `LIFE_INDEX_CLI` | Optional executable override |
| `LIFE_INDEX_DATA_DIR` | Optional sandbox/data-dir override for tests or development |
| `CLI_TIMEOUT` | General CLI subprocess timeout for ordinary backend calls |
| `CLI_HEALTH_TIMEOUT` | Longer timeout for CLI health/handshake paths; must not silently increase `CLI_TIMEOUT` |

## Backend Envelope

New and changed backend routes should converge on this shape:

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "meta": {
    "cliVersion": "1.4.5",
    "command": ["life-index", "search"],
    "schemaVersion": "optional CLI schema_version",
    "provenance": "optional CLI provenance",
    "events": []
  }
}
```

Rules:

- Preserve CLI `schema_version`, provenance, structured errors, and meaningful
  events when present.
- Normalize per command; do not assume all CLI commands return the same top-level
  JSON shape.
- Do not expose absolute local filesystem paths to frontend views except behind
  explicit developer diagnostics.
- Preserve route-like journal identifiers such as `journal_route_path` and
  `rel_path` with `/` separators.
- Prefer deterministic/lightweight CLI paths for browsing. `/search` is the
  keyword search surface; grounded retrieval belongs to the Host Agent handoff.
  The backend `/api/smart-search` contract remains active and unchanged for
  deterministic backend consumers, but it is not a direct Recall lane.

### Attachment media contract

The attachment route invokes `life-index attachment media` with raw bytes on
stdout and a metadata sidecar. A successful sidecar is the exact
`m17.attachment-media.v1` envelope with `success: true` and a `data` object
containing response headers and stream status. A non-zero CLI exit is mapped
only from the same schema with `success: false`, `data: null`, and a structured
`error` object on stderr or stdout. Missing or malformed envelopes return a
contract error; the GUI never infers capability from human-readable wording
and never falls back to the legacy JSON/base64 attachment export.

### Journal structured-input authority

Visible GUI `location` and `weather` fields, whether browser auto-filled or manually edited, are explicit authoritative structured arguments to Core.
Empty-string GUI fields are omitted before the Core call; whitespace-only values may be forwarded, and CLI Core trims them to missing before applying its configured location default or automatic weather lookup.
GUI/backend must not ask Core to infer either field from journal body marker
lines; those lines remain verbatim ordinary content. This consumes the CLI
contract without changing the Host Agent metadata proposal's exact-eight field
boundary or adding any GUI runtime, AI+, provenance, or schema surface.

## Stable Command Matrix

| Capability | CLI surface | GUI use | Status |
|---|---|---|---|
| Runtime version | `life-index version` | compatibility handshake | locked |
| Runtime health | `life-index health`, `life-index health --data-audit`; event/check `entity_profiles_stale` with command `life-index abstract --entities` | health banner, diagnostics, degraded mode, actionable maintenance hints | locked; stale entity profiles are informational and must not block write/search |
| Journal search/list | `life-index search --query <q> --level 3 --limit <n>`; `life-index journal list --recent [--limit <n>] [--offset <n>] --json` (schema `m16.journal.v0`) | recall, recent entries, browsing, search attribution | active; recent list consumes `journal list --recent`; `/search` is keyword-only from the GUI perspective; CLI `entity_expansion` is preserved as `meta.entityExpansion` for attribution display |
| Journal detail | `life-index journal get --path <rel-path> --json` | detail page content lookup | active; consumes schema `m16.journal.v0` |
| Journal write | `life-index write write --data <json>` plus confirmation when required | create entry | active |
| Journal edit | `life-index edit --journal <rel-path> ...` | edit metadata/content | active |
| Attachment media | `life-index attachment media <path> --variant <variant> --output - --metadata-output <path>` | preview/download links through backend | active; raw bytes plus `m17.attachment-media.v1` metadata; no direct file serving or legacy export fallback |
| Dashboard stats | GUI-owned `GET /api/dashboard` composition from supported read-only CLI surfaces | Archives counts, daily activity, and facet summaries | active; no Core `dashboard` command or `stats` command assumption |
| Timeline | `life-index timeline --range <start> <end>` | archive/timeline views | available when route consumes it |
| Smart search | `life-index smart-search --query <q>` / `/api/smart-search` | deterministic backend contract; no direct Recall lane | active and unchanged; not exposed by Recall |
| Integrity/index diagnostics | `health --data-audit`, `verify --json`, `index --check --json`, `index --cache-dry-run`; Data Doctor `maintenance audit/plan/repair --json` for derived-artifact repair | diagnostics and repair for derived artifacts | read-only active; direct `index --rebuild` and `generate-index --rebuild` remain blocked; GUI-safe derived-artifact repair provided by Data Doctor (see dedicated section) |
| Data Doctor maintenance repair | `maintenance audit --json`, `maintenance plan --issue-id <id> --json`, `maintenance repair --issue-id <id> --dry-run --json`, `maintenance repair --issue-id <id> --apply --json` | derived-artifact integrity repair with preview/confirm/post-check flow | active on CLI `1.2.4`, schema family `m33.maintenance_*.v0` |
| Index Tree Evidence Navigation | `life-index index-tree ensure/discover/navigate --json` | `/archives` selected-month/month-scoped facet discovery via canonical `index-tree discover` (which internally ensures freshness) and `/maintenance/index-tree` diagnostics; no `nodes`/`lens`/`shadow` or capped search | active, schema `m31.index_tree.v1` |
| Host Agent Handoff Interface | GUI backend `/api/host-agent/health`, `/api/host-agent/query/stream`, `/api/host-agent/metadata/propose` | runtime-neutral smart-layer handoff to a user-provided host agent | active GUI contract; backend relays/validates envelopes only and returns `UNAVAILABLE` when no host-agent endpoint is configured |
| Agent Bridge handoff | historical CLI smart-layer experiment | none for current GUI v1 | historical; current CLI main no longer exposes this as the GUI smart contract |
| Entity read/review | `entity --stats`, `--list`, `--check`, `--audit`, `entity --review --json`, `--candidate-edges` | entity maintenance center and review queues | active; `--review --json` queue items must expose structured `action_choices[]` payloads plus `source_id`/`target_id`; candidate edges are maintenance/review data only, not consumer graph edges |
| Entity profile consumption | `entity profile --id <id> --json`, optional backend support for `entity profile --name <name> --json` | `/api/entities/profile` and `/entities/:entityId` profile page; links from search attribution and entity maintenance list | active Phase 1; GUI consumes CLI profile JSON only, filters display to confirmed relationships, and does not read `entity_graph.yaml` or generated `Entities/*.md` files |
| Entity mutate/review consent | `entity maintain --delete --id <id> --preview --json`, `entity maintain --delete --id <id> --apply --backup --json`, `entity --review --action preview --review-action <action> --id <review_item_id> --source-id <source_id> [--target-id <target_id>] [--relation <relation>] --json`, `entity --review --action <action> --id <review_item_id> --source-id <source_id> [--target-id <target_id>] [--relation <relation>] --json` | guarded delete plus review cards Same/Different/Not-sure and candidate confirm/reject/skip | review cards require the global CLI `1.4.5+` floor and consume structured review action payloads. GUI gates this surface through `/api/version`, consumes structured action payloads only, previews before apply, then runs post-check; update/add-alias remain blocked |
| Import jobs | `import plan/run/status/rollback --json` | dry-run preview, confirmed run, status, rollback | active for consumed fixture and photo timeline envelopes |

Unsupported assumptions:

- There is no locked `life-index stats` command.
- There is no locked `life-index get` command.
- `life-index search --semantic*` flags are CLI-deprecated no-ops after the
  in-tool vector/semantic retrieval retirement; GUI no longer sends them.
- `index --rebuild` and `generate-index --rebuild` are mutating surfaces, not
  GUI-safe one-click repair contracts; they remain blocked for GUI use.
- GUI must not parse EXIF, social exports, media archives, journals, index
  files, `.life-index` caches, generated Markdown indexes, entity graph files,
  attachments, rollback manifests, cache databases, or user-data directories
  directly.

## Index Tree Evidence Navigation

Provider baseline:

- CLI `1.2.2`
- schema `m31.index_tree.v1`
- public read-only commands: `index-tree ensure`, `index-tree discover`, and
  `index-tree navigate`; `nodes`, `lens`, and `shadow` remain diagnostics-only

GUI consumption:

- Backend exposes `/api/index-tree/ensure`, `/api/index-tree/discover`,
  `/api/index-tree/navigate`, and diagnostic `/api/index-tree/shadow`.
- Frontend preserves CLI schema/version, command, success, data, and structured
  errors.
- `/maintenance/index-tree` is diagnostic/read-only.
- `shadow` is diagnostic-only and must not alter default `search` or
  `smart-search` ranking without a separate accepted contract.

Forbidden:

- reading CLI private manifests or dev tools;
- reading Index Markdown, `.life-index` caches, journal raw files, or private
  index-tree storage;
- adding index-tree repair/mutation controls without provider preview/confirm
  semantics.

## Archives dashboard presentation contract

The GUI-owned Archives provider is a stateless presentation view model. It is
not a Core command, does not read L1 data directly, and never writes a durable
dashboard cache or second source of truth.

### `GET /api/dashboard`

The route accepts optional `month=YYYY-MM` and `top=1..20` query parameters
(defaulting to the host-local current month and `top=5`). A future month or
invalid query is rejected with HTTP 400 before any CLI call. A valid response
uses the `gui.dashboard.v1` view model with exactly these top-level keys:

```json
{
  "period": {"selected_month": "YYYY-MM", "today": "YYYY-MM-DD", "current_month": "YYYY-MM"},
  "totals": {
    "journal_count": 0,
    "month_entry_count": 0,
    "month_active_day_count": 0,
    "today_entry_count": 0
  },
  "daily_activity": [],
  "facets": {"topics": [], "tags": [], "people": []},
  "warnings": []
}
```

Unknown or unavailable source values are `null` (never fabricated as zero),
and each source failure or malformed payload adds a structured warning with
`source`, `code`, and `message`. The host-local `today` value is independent
of the selected historical month.

The BFF uses one injected CLI adapter and only these calls, in the displayed
argument shapes:

```text
life-index health                         # via cli.handshake()
life-index aggregate --range YYYY-MM-01..YYYY-MM-last --unit entry --predicate journal_count --json
life-index aggregate --range YYYY-MM-01..YYYY-MM-last --unit day --predicate journal_count --json
life-index aggregate --range YYYY-MM-DD..YYYY-MM-DD --unit entry --predicate journal_count --json
life-index index-tree discover --from YYYY-MM --to YYYY-MM --facet topic --facet tag --facet people --json
```

The canonical `index-tree discover` command internally performs its freshness
ensure. The GUI must not issue a second `index-tree ensure` call. `nodes`,
`lens`, and `shadow` remain diagnostics-only and are forbidden as dashboard
fallbacks; old `/stats`, `/topics`, `/heatmap`, search scans, and capped client
aggregation are not dashboard sources.

## Data Doctor Maintenance Repair

Provider baseline:

- CLI `1.2.4`
- schema family `m33.maintenance_*.v0`
- commands: `maintenance audit`, `maintenance plan`, `maintenance repair`

Command chain:

1. `maintenance audit --json` — scan for derived-artifact issues.
2. `maintenance plan --issue-id <id> --json` — preview the proposed repair.
3. `maintenance repair --issue-id <id> --dry-run --json` — dry-run the repair
   without applying changes.
4. **Explicit user confirmation** — GUI must surface the dry-run result and
   require explicit user approval before proceeding to apply.
5. `maintenance repair --issue-id <id> --apply --json` — execute the repair.
6. **Post-check** — after apply, re-run `maintenance audit --json` (or an
   appropriate health check) to confirm the issue is resolved.

Rules:

- GUI-safe repair applies only to CLI-allowed derived artifacts. It must not
  mutate L1 user data, journals, or source content.
- `apply` must never be called without a preceding `dry-run` and explicit user
  confirmation.
- Post-check after apply is mandatory; surface the post-check result to the
  user.
- Schema family is `m33.maintenance_*.v0` — preserve `schema_version`,
  `success`, `data`, and structured `error` fields from CLI output.

## Host Agent Handoff Interface

GUI v1 smart surfaces use a runtime-neutral Host Agent Handoff Interface.
Life Index does not own the host agent internals. GUI/backend only define the
transport and envelope contract that a user-provided host agent can implement.

Agent Bridge is historical: it was a pre-v1 smart-layer experiment and is not
the current GUI smart API.

Supported GUI backend surfaces:

- `GET /api/host-agent/health` — no journal evidence; reports whether a
  handoff interface is reachable. When unset, returns `mode: "UNAVAILABLE"`
  with a first-class `reason`.
- `POST /api/host-agent/query/stream` — explicit user-triggered query stream.
  Returns SSE events from the host agent or an honest `UNAVAILABLE` final
  envelope when no host-agent endpoint is configured.
- `POST /api/host-agent/metadata/propose` — explicit user-triggered metadata
  proposal request. Returns host-agent field proposals or an honest
  `UNAVAILABLE` proposal with empty `fields`.

Backend rules:

- Backend may validate blank/oversized requests, relay SSE frames, normalize
  standard error envelopes, and preserve additive fields.
- For an explicitly marked native-Markdown query envelope, backend may extract
  only bounded, deduplicated canonical `/journal/<safe-id>` Markdown-link
  candidates and verify each through the existing stable
  `journal get --path Journals/<id>.md --json` contract. Final evidence is
  rebuilt only from matching CLI `rel_path`, `title`, and `date`; CLI content,
  Host labels, claimed evidence, traces, stderr, and runtime logs are not
  evidence sources.
- Backend must not classify intent, choose `aggregate`/`trajectory`/`search`,
  synthesize answers, repair host-agent output, or extract semantic metadata.
- Backend must not call LLM APIs or store model/provider credentials.
- If the handoff interface is unavailable, return `UNAVAILABLE` or a
  deterministic `SCAFFOLD`; never fake a grounded answer.

Frontend rules:

- Badges are labels, not gates. If the host agent returns answer text, render it
  and show `mode`/`reason` beside it.
- Unknown future modes must render with neutral styling and raw reason text.
- Evidence ids must become journal links only when a safe route id is present.
- Summary Markdown `/journal/...` links are clickable only when the same safe
  id appears in the response's CLI-verified evidence; other internal journal
  links render as text. External HTTP(S) links remain ordinary links and do not
  count as evidence.
- AI+ feature flags default on for the GUI surface, but Host Agent readiness is
  still the hard gate. Without a configured host agent, AI+ must render
  offline/unavailable rather than synthesizing or faking an answer.

Query final target:

```json
{
  "schema_version": "gui.host_agent.query_response.v1",
  "request_id": "uuid-or-null",
  "conversation_id": "uuid-or-null",
  "source": "host-agent",
  "mode": "GROUNDED",
  "reason": "aggregate exact count plus journal read verification",
  "query": "今年 SkyVision Africa 项目有多少篇日志？",
  "answer": {
    "mode": "GROUNDED",
    "reason": "aggregate exact count plus journal read verification",
    "summary": "今年 SkyVision Africa 项目共有 1 篇日志。",
    "insights": [],
    "gap": null,
    "suggestions": []
  },
  "evidence": [
    {
      "id": "2026/02/life-index_2026-02-22_002",
      "rel_path": "Journals/2026/02/life-index_2026-02-22_002.md",
      "title": "SkyVision 无人机项目周会",
      "date": "2026-02-22"
    }
  ],
  "tool_trace": []
}
```

Metadata proposal target:

After an explicit request succeeds, the GUI may place proposals into normal
editable draft inputs only when each target was empty at request time and is
still unchanged; existing or concurrently edited values win, and persistence
still requires the normal journal Save action.

```json
{
  "schema_version": "gui.host_agent.metadata_proposal.v1",
  "request_id": "uuid-or-null",
  "mode": "PROPOSED",
  "reason": "semantic-fields-proposed-by-host-agent",
  "fields": {
    "project": {
      "value": "SkyVision Africa",
      "field_source": "agent_semantic",
      "confidence": 0.9,
      "rationale": "正文提到 SkyVision 项目。"
    }
  },
  "warnings": []
}
```

Mode semantics:

| Mode | Meaning | Required GUI behavior |
|---|---|---|
| `GROUNDED` | Host agent says the answer is evidence-backed. | Show answer, reason, and clickable evidence. |
| `PARTIAL` | Host agent found useful but incomplete evidence. | Show answer and gap/reason prominently. |
| `SCAFFOLD` | Deterministic evidence/scaffold exists without host-agent synthesis. | Show scaffold label; do not style as grounded answer. |
| `UNGROUNDED` | Host agent cannot ground the answer. | Show answer text if present plus reason; evidence may be empty. |
| `UNAVAILABLE` | Handoff interface is unavailable. | Show unavailable state; no fake answer. |
| unknown string | Future verifier state. | Neutral badge; no crash. |

## Import Jobs

GUI may consume import envelopes only through backend-mediated CLI calls.

Stable top-level fields:

- `schema_version`
- `success`
- `command`
- `data`
- `error`

Supported nested schemas include `import_plan.v1`, `import_run.v1`,
`import_status.v1`, `import_rollback.v1`, `import_job_ledger.v1`, and
`import_rollback_manifest.v1`.

Rules:

- `import plan` is a dry run and must not be presented as committed.
- `import run` requires exact confirmation from the plan envelope.
- Backend may materialize temporary plan input outside `LIFE_INDEX_DATA_DIR` and
  may hold transient source-root mappings in memory.
- Backend must return a controlled re-plan error if required transient
  source-root state is missing.
- GUI must not create a durable import ledger, parse rollback manifests, parse
  media metadata, or resolve import conflicts locally.

## Entity Mutation Discipline

Every graph mutation must:

1. preview through CLI;
2. require explicit frontend confirmation;
3. execute through serialized backend CLI mutation path;
4. run an appropriate post-change check such as `entity --check`;
5. surface structured errors.

`update` and `add_alias` remain blocked until the provider exposes preview/dry
run semantics for those mutation paths.

## Contract Tests

Mocked CLI tests are useful unit tests, but they do not prove integration.
Contract coverage should include real CLI execution against isolated data for
provider-consumer behavior.

Minimum expectations for touched surfaces:

- handshake succeeds with `version` and `health`;
- search returns normalized entries and honors GUI limits;
- journal detail validates the selected journal;
- unsupported commands such as `stats` and `get` are not called by the adapter;
- write/edit/entity/import mutation tests run only against temp or explicit
  sandbox data;
- backend boundary tests prevent direct SQLite/index imports, user-data
  file reads/writes, static attachment serving, and embedded L1 storage
  filename assumptions.
