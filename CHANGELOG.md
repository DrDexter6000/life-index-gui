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
