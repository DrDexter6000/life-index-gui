---
name: life-index-gui
description: Start, verify, open, stop, and maintain Life Index GUI from its installed checkout.
{{PRESERVED_TRIGGERS}}---

# Life Index GUI

GUI installation path: `{{GUI_INSTALL_PATH}}`

Life Index GUI is the human-facing experience layer for the Life Index CLI. Use these deterministic steps to start or reuse the local GUI without rediscovering the checkout.

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

Use the GUI upgrade atom before manual repair:

```bash
cd "{{GUI_INSTALL_PATH}}"
npm run gui-upgrade:plan
npm run gui-upgrade:apply
```

Full upgrade and operations guidance: `docs/AGENT_UPDATE_PLAYBOOK.md`.
