# Life Index GUI Architecture

Status: active public architecture.

Life Index GUI is the presentation and interaction layer for Life Index. It is
rich at the user-experience layer and thin at the data-authority layer.

<!-- GUI_AUTHORITY_CONTRACT_START -->
## Authority, Roles, And Delivery State

This block is the normative GUI-side authority for cross-layer roles,
implemented topology, ratified targets, and delivery order. `CURRENT` describes
implemented production behavior. `TARGET` describes accepted work that remains
unimplemented until its named phase lands with evidence.

| Actor | Owns | Does not own |
|---|---|---|
| CLI Core | Deterministic tools, canonical Life Index data, and stable contracts. | Planning, reasoning, orchestration, interpretation, or synthesis. |
| Host Agent + installed Life Index Skill | Natural-language understanding, planning, multi-hop tool orchestration, interpretation, and answer synthesis. | Canonical data or stable Core contract authority. |
| GUI | A first-class human product entry and presentation/interaction shell. | Domain intelligence or semantics, and direct L1 reads or writes. |
| P2 Gateway target | An optional, read-only, deterministic typed 1:1 projection of canonical Core contracts. | Agent bridging, a second semantic API, intelligence, or required GUI infrastructure. |

**CURRENT — production route:** GUI frontend → GUI backend/BFF → direct CLI/Core contracts. The GUI does not depend on Gateway.

**CURRENT — reference bridge:** The GUI repository owns the reference Host Agent bridge; it remains outside Core and exposes the handoff contract documented in `docs/HOST_AGENT_HANDOFF.md`.

**CURRENT — D2 Package C3 correction:** Strict schema/stream semantics, the GUI
relay split, and the named Codex CLI adapter are accepted in the current GUI
contract. Each Codex request uses a unique run directory as both subprocess cwd
and `-C` root, the exact supported version/login/freshness preflight, and
configured query/metadata SHA-256 rechecks. Codex `0.144.1` completed
same-machine isolated real model/network/generated-schema and grounded
acceptance. A future Codex version, authentication mode, or permission-contract
change requires a new compatibility review.

**CURRENT — D3 deterministic GUI core:** Archives uses deterministic
health/aggregate/Index Tree contracts; an explicit metadata proposal request
may fill only draft targets that were empty at request time and remain
unchanged, while persistence still requires normal Save. Host Agent terminality
and safe evidence navigation are retained, and journal editing stays in detail
context through the existing write authority. The D3 product DoD is accepted
as `GO`.

**CURRENT — D4 corrected GO/accepted:** The accepted runtime includes the direct
GUI → CLI/Core production route plus the optional exact-three generic MCP
projection for Host Agent/Codex (`health`, `journal.get`, and `search`). MCP is
not a GUI route dependency, and the GUI does not migrate to it.

**CURRENT — D5 transport disposition:** The original newline-JSON-RPC second
transport is Human-Owner **DEFERRED / NOT NECESSARY NOW** absent a named non-MCP
consumer or verified MCP incompatibility.

**CURRENT — source and shipped-state boundary:** The GUI remains pre-1.0; see
[`docs/VERSIONING.md`](./VERSIONING.md). The bounded 0.5.1 friction package
exists in source. Actual shipped state must be verified from `package.json`,
`CHANGELOG.md`, and the public tag/release rather than frozen phase prose. The
CLI retains all Life Index data and write authority, direct L1 access remains
forbidden, and the runtime-neutral Host Agent handoff contract is unchanged.
This source package does not establish Hermes GUI AI+ compatibility; it remains
`NOT_SUPPORTED_NOT_PROVEN`.

**CURRENT D3 boundary:** A GUI-owned dashboard provider
may compose canonical contracts transiently, but it is not a Core dashboard
command, durable cache, L1 data path, or domain-intelligence layer. This public
architecture records only the current status and boundary.

The current Archives Panel uses the stateless `gui.dashboard.v1` view model
(`GET /api/dashboard`) and the direct CLI/Core route. Its source composition is
health, three validated `aggregate` reads (selected-month entry/day and the
host-local today range), and one canonical `index-tree discover` read. The CLI
discover command performs freshness ensure internally; the GUI does not add a
second ensure call or fall back to diagnostic nodes/lens/shadow surfaces.

**Shared program sequence:** The D4/D5 states above are one shared formal
program sequence, not separate GUI phase tracks. The optional MCP projection
does not create a GUI migration or route dependency.

**Future only:** P3/Addons—including memoir, letters, psychology, persona, and social/photo import—have no SDK, schema, placeholder UI, or current product promise.

**Authority status:** The CLI `CHARTER.md §1.10` owns the active closed C1–C7
Core admission domains and related non-Core/compatibility rules. GUI public
documents neither duplicate nor enumerate those domain descriptions; they
record only GUI roles, boundaries, and delivery state. Design memos and
execution-control packs are decision background, not parallel public SSOT.

**License rationale pointer:** The canonical non-constitutional rationale for
AGPL-3.0-only distribution is [Life Index CLI inline ADR-005](https://github.com/DrDexter6000/life-index/blob/main/docs/ARCHITECTURE.md#adr-005-agpl-30-only-distribution). This GUI document only points to that rationale; it does not create a second licensing ADR.
<!-- GUI_AUTHORITY_CONTRACT_END -->

## Product Shape

The GUI provides these durable surface groups:

- daily writing and continuation flows;
- journal reading, deterministic keyword search, Host Agent handoff, and
  attachment access;
- archive dashboards and maintenance views for health, index diagnostics,
  entity graph review, imports, and index-tree diagnostics;
- future advanced memory surfaces only after the CLI exposes stable contracts
  for the underlying capability.

Future capability direction belongs in product planning outside the public
active SSOT. This architecture records only stable product structure and
boundaries.

## Layer Model

| Layer | Responsibility | GUI rule |
|---|---|---|
| L1 data | Markdown journals, attachments, indexes, entity graph, caches | GUI never mutates or structurally reads these directly |
| L2 CLI core | Deterministic durable data capabilities | CLI owns user-data reads, writes, parsing, repair, and reusable contracts |
| L3 backend adapter | HTTP API and stateless CLI translation | May normalize CLI payloads and hold transient request state only |
| L4 frontend | Routes, components, view state, visual system | Owns interaction and presentation, not durable truth |

## Frontend

The frontend is a React/Vite application. Exact package versions live in
`package.json`.

Core routes and surfaces:

- The Core: write, recent entries, continuation, edit entry handoff.
- Recall: deterministic keyword search plus Host Agent grounded-query handoff.
- Archives: dashboard and entry points into maintenance/import surfaces.
- Journal Detail: CLI-mediated journal content and attachment links.
- Health, Index Diagnostics, Entity Graph, Import Workflow, and Index Tree
  Diagnostics: maintenance and review surfaces backed by stable CLI envelopes.

Frontend state is UI state. Browser storage can remember preferences or drafts
when product-approved, but it must not become a private durable source of truth
for Life Index data.

## Backend

The backend is a Python FastAPI adapter. It calls the `life-index` executable as
an external process and exposes normalized HTTP models to the frontend.

Backend responsibilities:

- resolve CLI executable and sandbox/data-dir configuration;
- run version/health handshake;
- call supported CLI commands with bounded timeouts;
- normalize command-specific JSON envelopes;
- preserve CLI provenance, schema versions, structured errors, and useful
  events;
- enforce GUI-side limits only on already-returned CLI payloads;
- hold transient request state only when needed to bridge CLI command shapes.

Backend routes must not directly open, read, write, stat, serve, scan, or query
Life Index user-data files, SQLite caches, attachments, index files, entity
graph files, or user-data directories.

## Contract Boundary

`docs/GUI_CLI_CONTRACT.md` is the authority for what CLI surfaces the GUI may
consume and which assumptions remain unsupported. Any backend or frontend change
that affects durable data behavior must be checked against that contract before
implementation.

Unmet CLI/L2 needs are not public GUI SSOT. They belong in CLI provider planning
or in ignored local workpacks until a stable CLI contract exists.

## Design Boundary

`DESIGN.md` is the human-readable design authority. `design/tokens.json` is its
machine-readable token projection. `src/styles/tailwind.css` is the
implementation layer.

UI work should cite the relevant named rule or token in local execution notes.
If a new durable visual value is introduced, update both `DESIGN.md` and
`design/tokens.json`, or explicitly state that existing tokens were consumed.
