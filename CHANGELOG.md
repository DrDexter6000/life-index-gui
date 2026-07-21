## [Unreleased]

## [0.5.2] - 2026-07-21

### What users get
- New journals use the device-local date. Re-entering a fresh blank journal or resetting the draft refreshes that date, and an empty date is blocked before Save.
- If browser location, city lookup, or weather lookup is unavailable, location and weather remain editable so they can be filled in manually and saved.
- With Life Index CLI 1.5.3 or later, explicit structured location and weather values from the GUI remain authoritative; CLI defaults or lookup apply only when the corresponding field is missing.

### Included in this release
- The public source snapshot now includes the focused The Core behavior tests alongside the implementation.
- Runtime-neutral validation and foundation for the existing Host Agent path. This does not add or prove support for a second Host Agent Runtime, Hermes, or ACP.

## [0.5.1] - 2026-07-19

- Removed runtime external font/CDN requests while retaining outlined and rounded icons through local Material Symbols icon fonts from exact `@fontsource` production dependencies.
- Replaced frozen D6 release-state prose in the exported GUI Skill with durable source-versus-shipped wording. Actual publication still requires verification against `package.json`, `CHANGELOG.md`, and the public tag/release; Hermes GUI AI+ compatibility is not claimed.
- Added always-visible, localized 20-character limit feedback to the title input without changing the existing write authority or schema.
- Corrected GUI program-environment lifecycle handling: the upgrade atom is now read-only planning plus fail-closed reinstall guidance, never in-place git/npm/pip/skill/verification mutation. Healthy current installs remain a truthful no-op; replacement leaves existing checkouts and shared/global environments untouched and points to a fresh dedicated GUI install.

## [0.5.0] - 2026-07-17

### What users get
- Start from a first-use empty state, then use the established CLI-backed write, save, search, journal-detail, and Panel paths as your library grows.
- AI+ is an optional host-agent integration in the production path. Its connection and health are shown honestly, while writing and keyword search remain usable when it is unavailable.
- Existing draft recovery, import outcomes, and search activation/result states make it clearer what completed and what needs attention.

### Included in this release
- First-use activation and the established CLI-backed write, search, journal-detail, and Panel workflows.
- Optional host-agent AI+ with visible availability and health states.
- Existing draft recovery, import workflow outcomes, and search activation/result states.
- Life Index GUI remains on its pre-1.0 version line.

## [0.4.0] - 2026-07-09

### What users get
- Entity graph returns are now visible in the GUI: search results can show entity-expansion attribution, entity links open profile pages, review cards let users preview and confirm CLI-backed entity decisions, and health surfaces point to entity maintenance signals.
- Host agents now have a deterministic GUI upgrade path: `npm run gui-upgrade:plan` and `npm run gui-upgrade:apply` inspect and safely repair local git freshness, Node dev dependencies, Python backend dependencies, CLI feature gates, and final `verify-stack` state with fail-closed JSON output.
- This release is licensed AGPL-3.0-only. Local personal use is unaffected; hosted derivative services must publish corresponding source and modifications.

### Included in this release
- Entity graph consumption: search attribution for CLI entity expansion, entity profile pages, entity review cards, and health/entity maintenance signals.
- GUI upgrade atom S1-S5: contract skeleton, git freshness/fail-closed apply, Node devDependency recovery, Python backend dependency checks, CLI feature gates, and verify-stack closure.
- Compatibility: baseline CLI remains `1.3.7+`; entity review cards require CLI `1.4.4+`; CLI `1.4.5` is recommended for this release.

## [0.3.0] - 2026-07-03

### What users get
- Remote access from your phone: open a one-time, token-gated link to your Life Index over a secure tunnel — start it from the GUI, or ask your host agent to run `remote-link:start` headless (e.g. relayed over Telegram). Links auto-expire (default 12h).
- Bring truly any agent: the host-agent handoff is now a versioned, conformance-tested protocol with a provider-neutral reference adapter, so AI+ can be powered by any headless agent you run — not just one.
- Smoother operation: one-command stack verification (`npm run verify-stack`), ownership-safe port self-heal, `/api/version`, and an agent update playbook.

### Included in this release
- Layered remote access: headless `remote-link:start|status|stop` sharing the desktop button's backend; versioned `gui.remote_link.v1` contract; configurable tunnel TTL; fail-closed provisioning; control plane never tunneled.
- Host-agent handoff conformance kit + a second provider-neutral adapter proving portability.
- `verify-stack` / `stop-all` with ownership-safe port self-heal; `/api/version` and version fields on `/api/health`; `docs/AGENT_UPDATE_PLAYBOOK.md`.
- Carried since v0.2.0: public-link fail-fast, honest AI+ wait-state, slim top nav + Starweave console, mobile menu polish, public-sync precheck, and export scan-gate hardening.
