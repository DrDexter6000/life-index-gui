# Agent Update Playbook

This playbook is for a host agent updating a local Life Index stack. The CLI serves the agent; the GUI serves the human user. The GUI does not bundle a model, planner, or hidden orchestration layer.

## Order

Run the CLI update first, then the GUI update, then the stack verification.

## 1. Update Life Index CLI

```bash
cd /path/to/life-index
git pull --ff-only
python -m pip install -e .
sync-skill --install
life-index health --json
```

Read the health payload before moving on. If it exposes `upgrade_freshness`, treat that field as the CLI-side freshness signal. Stop here if CLI health is unavailable or reports an upgrade that has not been applied.

## 2. Update Life Index GUI

```bash
cd /path/to/life-index-gui
git pull --ff-only
npm ci --include=dev
npm run build
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In another shell:

```bash
curl http://127.0.0.1:8000/api/version
curl http://127.0.0.1:8000/api/health
```

The version authority is the backend JSON payload:

- `gui_version`: GUI package version from `package.json`
- `cli_minimum_version`: minimum CLI version this GUI supports
- `repo_version`: CLI repository/version marker surfaced by `life-index version`
- `compatible`: whether the detected CLI package version satisfies the GUI minimum

`/api/version` is the concise compatibility surface for agents. `/api/health` carries the same version fields plus detailed CLI health diagnostics for the human-facing GUI.

## 3. Verify the local stack

```bash
npm run verify-stack
```

Expected behavior:

- starts the backend on `127.0.0.1:8000`
- waits for `/api/health`
- runs the frontend build
- starts a Vite preview on `127.0.0.1:5173`
- prints one JSON result
- stops the backend and preview before exiting

If ports are occupied, the verifier only stops processes it can prove belong to this GUI checkout. Unknown processes are never killed.

To clean project-owned leftovers explicitly:

```bash
npm run stop-all
```

If `stop-all` reports an unknown port owner, inspect that process manually before retrying.

## Compatibility Rule

The GUI is compatible when:

1. `/api/version` returns `compatible: true`.
2. `/api/health` returns an HTTP 200 JSON envelope.
3. CLI health is not hiding an unresolved upgrade or unavailable runtime.

AI+ and metadata suggestions still come from the configured host agent. When no host agent is connected, the GUI should report an offline/unavailable state rather than pretending to provide built-in intelligence.
