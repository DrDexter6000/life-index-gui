## [Unreleased]

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
