# Life Index GUI

<p align="center">
  <strong>Life Index CLI serves your agent. Life Index GUI serves you.</strong><br />
  Let an agent manage the life archive. The GUI is the human experience layer built on top.<br />
  <a href="README.md">中文</a> · Apache-2.0 · React + FastAPI · Built on Life Index CLI
</p>

<p align="center">
  <img src="public/launch/life-index-gui-home-write.svg" alt="Life Index GUI home and writing demo screenshot" width="860" />
</p>

## Navigation

[Experience](#experience) · [Intelligence](#intelligence-ai-star-trail) · [Mobility](#mobility) · [Quick Start](#quick-start) · [Architecture](#architecture--cli-relationship)

## TL;DR

Life Index CLI is the native tool layer for agents. Life Index GUI is the experience layer for human users. The CLI owns durable data and deterministic capability boundaries; the GUI turns writing, search, review, mobile access, and AI+ results into an interface people can actually live with.

Three pillars:

- **A human-first experience layer**: human experience still matters in an agent-native world.
- **UI/UX with the ambition of an artful indie game**: visual rhythm, atmosphere, and readability matter when the archive is personal.
- **Mobility beyond the desk**: keep the agent running on the home machine while a temporary secure path lets the GUI travel with your phone.

## Experience

The Life Index core is useful to agents, but humans need a surface that is scannable, calm, and worth returning to. The GUI brings writing, search, archive review, maintenance, and AI+ answers into one visual space instead of leaving them as command output.

<p align="center">
  <img src="public/launch/life-index-gui-search-results.svg" alt="Life Index GUI search results demo screenshot" width="860" />
</p>

## UI/UX

Life Index GUI aims higher than a conventional admin form. Its visual system uses star trails, layered surfaces, light, and pacing to make a personal archive feel alive while staying usable and performant. More themes and customizable visual elements are planned.

## Intelligence: AI+ Star Trail

AI+ Star Trail sends your question to your host agent. The host agent uses the Life Index CLI to retrieve evidence and synthesize a grounded answer. The GUI only performs the handoff and presents status, evidence, citations, and output; it does not include a model, pick a provider, or pretend to have its own mind.

When no host agent is connected, AI+ honestly appears offline / unavailable. Deterministic writing, keyword search, and local browsing still work.

<p align="center">
  <img src="public/launch/life-index-gui-ai-grounded-panel.svg" alt="Life Index GUI AI+ grounded answer demo screenshot" width="860" />
</p>

<p align="center">
  <img src="public/launch/life-index-gui-ai-grounded-flow.gif" alt="Life Index GUI AI+ grounded flow demo GIF" width="860" />
</p>

## Mobility

Mobility keeps Life Index useful away from the desk. Your desktop host keeps running the CLI, GUI backend, and optional host agent; your phone can open the GUI through a temporary token-gated public link for travel notes, field observations, and everyday capture.

Public links are explicit risk operations. They currently support only `cloudflared` Quick Tunnel: the bundled `scripts/start-mobile-cloudflare-tunnel.ps1` starts the stable mobile server and creates a temporary one-time-code-protected link. SSH/ngrok/frp paths are not supported. Stop the link when you are done. If generation fails, the GUI fails closed instead of exposing a half-configured link.

## Quick Start

Prerequisites:

- Node.js 22+
- Python 3.12-3.13 (`pydantic-core` / `Pillow` wheels are not yet available for Python 3.14 in this pinned dependency set)
- Life Index CLI installed and runnable locally
- Optional: a host agent for AI+ grounded answers / smart metadata
- Optional: `cloudflared` for temporary phone access (the only supported public tunnel)

```bash
git clone https://github.com/DrDexter6000/life-index-gui.git
cd life-index-gui
npm ci --include=dev
python -m venv .venv
source .venv/bin/activate   # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
```

The local dev, test, and build tools (`vite` / `typescript` / `vitest` / `eslint` / `tailwindcss`) live in devDependencies. `npm ci --include=dev` overrides `NODE_ENV=production` or `npm config omit=dev`, avoiding `vite: not found` or build failures.

Terminal 1, start the backend:

```bash
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Terminal 2, start the frontend:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

Production build:

```bash
npm run build
```

## Architecture / CLI Relationship

```text
Human -> Life Index GUI -> FastAPI backend -> Life Index CLI -> local archive
Human -> Life Index GUI -> FastAPI backend -> optional host agent -> Life Index CLI
```

- **CLI** is the data and capability SSOT. It is built for agents and exposes deterministic writing, search, maintenance, and indexing tools.
- **Host agent** is the intelligence layer. It plans, retrieves, reasons, synthesizes, and chooses its own model/runtime.
- **GUI** is the experience layer. It presents CLI-backed data, relays AI+ handoff requests, and renders evidence and status.
- **Data stays separate from program code**. The GUI/backend must not directly read or write journals, attachments, indexes, SQLite caches, entity graph files, or user-data directories. Durable data access goes through the CLI contract.

## Design And Contributing

- Design tokens: [design/tokens.json](design/tokens.json)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- GUI/CLI contract: [docs/GUI_CLI_CONTRACT.md](docs/GUI_CLI_CONTRACT.md)
- Docs index: [docs/README.md](docs/README.md)

## License

Apache-2.0
