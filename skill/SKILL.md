---
name: life-index-gui
description: Start, verify, open, stop, and maintain Life Index GUI from its installed checkout.
{{PRESERVED_TRIGGERS}}---

# Life Index GUI

GUI installation path: `{{GUI_INSTALL_PATH}}`

Life Index GUI is the human-facing experience layer for the Life Index CLI. Use these deterministic steps to start or reuse the local GUI without rediscovering the checkout.

## Ownership Boundary

The normative cross-layer roles and CURRENT/TARGET delivery status live in the GUI checkout's `docs/ARCHITECTURE.md` **Authority, Roles, And Delivery State** block.

- CURRENT: the GUI is a first-class human entry and presentation/interaction shell; its backend uses direct CLI/Core contracts and never requires Gateway.
- Natural-language understanding, planning, multi-hop tool orchestration, interpretation, and answer synthesis belong to the Host Agent using the installed Life Index Skill; the GUI does not own domain intelligence or semantics.
- The GUI/backend never reads or writes L1 Life Index data directly.
- D2 Package C3's strict Codex adapter correction is accepted in the current
  contract. Every request uses a unique run directory as both subprocess cwd
  and the exact `-C` root with `--skip-git-repo-check --ignore-user-config`, so
  unrelated user-configured MCP/hooks/settings cannot enter the adapter request;
  Codex authentication still uses `CODEX_HOME`. Health checks executable
  discovery, exact supported version `0.144.1`, `codex login status`, and
  caller/configured query and metadata procedure SHA-256 freshness; invocation
  rechecks both digests. Codex `0.144.1` completed same-machine isolated real
  model/network/generated-schema and grounded acceptance. A future Codex
  version, authentication mode, or permission-contract change requires a new
  compatibility review.
- D3 deterministic GUI core is current: Archives uses deterministic contracts,
  and its product DoD is accepted (`GO`); metadata proposals require explicit
  consent and normal Save, AI+
  preserves Host Agent terminality and safe evidence navigation, and journal
  editing stays in detail context through the existing write authority.
- The bounded 0.5.1 friction package exists in source. Actual shipped state
  must be verified from `package.json`, `CHANGELOG.md`, and the public
  tag/release rather than frozen phase prose.
- D5 newline-JSON-RPC remains `DEFERRED / NOT NECESSARY NOW`.
- The CLI retains all Life Index data and write authority; direct L1 access
  remains forbidden.
- The runtime-neutral Host Agent handoff contract is unchanged. This source
  package does not establish Hermes GUI AI+ compatibility; it remains
  `NOT_SUPPORTED_NOT_PROVEN`.

## Before Starting

1. Check whether the GUI is already running.
   - Frontend: open or probe `http://127.0.0.1:5173`.
   - Backend: probe `http://127.0.0.1:8000/api/health`.
2. If both endpoints respond, reuse the existing session and provide `http://127.0.0.1:5173`.
3. If either endpoint is unavailable, start the stack from the installed checkout.

## Start

```bash
cd "{{GUI_INSTALL_PATH}}"
npm run dev:all
```

`npm run dev:all` is a long-running development stack. If the caller needs the agent session to continue, launch it in a separate terminal, process manager, or background job and preserve the logs for diagnosis.

PowerShell example:

```powershell
Set-Location "{{GUI_INSTALL_PATH}}"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run dev:all"
```

## Verify Ready

Use the lightweight readiness checks first:

```bash
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:5173
```

The backend is ready when `/api/health` returns JSON without a transport error. The frontend is ready when `http://127.0.0.1:5173` responds.

For a full local stack check, run:

```bash
cd "{{GUI_INSTALL_PATH}}"
npm run verify-stack
```

## Open

Default URL: `http://127.0.0.1:5173`

Windows:

```powershell
cmd.exe /c start http://127.0.0.1:5173
```

WSL:

```bash
wslview http://127.0.0.1:5173 || cmd.exe /c start http://127.0.0.1:5173
```

## Stop

```bash
cd "{{GUI_INSTALL_PATH}}"
npm run stop-all
```

Equivalent direct command:

```bash
node scripts/stop-all.mjs
```

## Upgrade And Operations

Upgrade rule: use the atom only for read-only diagnosis. It never repairs the
installed checkout in place. If it reports `reinstall_gui` or
`GUI_UPGRADE_REINSTALL_REQUIRED`, leave the existing checkout and any
shared/global Python environment untouched, then create a fresh dedicated GUI
install by following `docs/AGENT_UPDATE_PLAYBOOK.md`. Run `verify-stack`
separately after the clean install.

```bash
cd "{{GUI_INSTALL_PATH}}"
npm run gui-upgrade:plan
npm run gui-upgrade:apply
```
