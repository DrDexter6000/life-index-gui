# Life Index GUI

Life Index GUI is the visual cockpit for a personal journal system: write a thread, search memory, and let the interface feel a little like stepping through a star map.

It is still early. The app is useful, but not finished; the visual language and the smart-agent handoff will keep getting sharper.

## What Works

- Deterministic journal writing through the Life Index CLI contract.
- Deterministic keyword search and journal browsing.
- AI+ surfaces that can call a bring-your-own host agent through the Host Agent Handoff Interface.
- Grounded search presentation with cited journal entries and media previews when a host agent returns evidence.

## Bring Your Own Host Agent

Life Index does not ship a SaaS brain, model provider, API key, or hidden LLM endpoint.

Smart behavior belongs to your own host agent: Hermes, Claude, Codex, OpenClaw, or another runtime that implements the handoff interface. That agent decides how to reason, which model to use, and where it runs. The GUI and backend only transport requests and present results.

If no host agent is configured, AI+ shows as offline. Deterministic writing and keyword search still work.

## Architecture

```text
GUI  ->  backend transport  ->  Life Index CLI
GUI  ->  backend transport  ->  optional host agent runtime
```

The backend must not read the journal data directory directly. Data access goes through the Life Index CLI contract, and smart answers come from the external host agent.

## Local Start

```bash
npm ci
npm run build
npm run dev
```

Run the backend separately:

```bash
pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Copy `.env.example` to `.env` if you need to change local ports or backend URLs.

## Safety

This public repository is a curated product snapshot. It intentionally excludes workshop reports, governance notes, real journals, private paths, and credentials.

## License

Apache-2.0.
