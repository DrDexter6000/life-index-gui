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

The GUI worktree must be clean before upgrading. If `git status --porcelain`
prints any path, stop and restore or commit that work before continuing; do not
try to upgrade over a dirty tree.

```bash
cd /path/to/life-index-gui
git status --porcelain
git pull --ff-only
npm ci --include=dev
npm run build
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Do not use bare `npm install` during upgrades. node_modules can be incomplete while npm reports "up to date"; `npm ci --include=dev` is the only supported dependency install path for upgrade recovery.

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

## 4. Start A Temporary Remote GUI Link

When the user asks for a phone or remote browser link, use the GUI-owned
remote-link primitive. It verifies the local GUI stack, starts the same
token-gated public-link backend logic that the desktop button uses, and prints
one JSON envelope:

```bash
npm run remote-link:start
```

Return only the `url` and `one_time_code` to the user. The envelope is
versioned as `gui.remote_link.v1` and includes `expires_at` for the tunnel TTL
and `code_expires_at` for the short-lived single-use code.

To inspect or stop the link:

```bash
npm run remote-link:status
npm run remote-link:stop
```

The tunnel exposes the token-gated GUI data plane only. Control operations such
as `remote-link:start`, `verify-stack`, and `/api/public-link/*` stay local and
must not be routed through the public URL. If `cloudflared` or the local stack is
missing, the command returns explicit JSON with `status: "error"` and does not
leave a half-open tunnel.

## Compatibility Rule

The GUI is compatible when:

1. `/api/version` returns `compatible: true`.
2. `/api/health` returns an HTTP 200 JSON envelope.
3. CLI health is not hiding an unresolved upgrade or unavailable runtime.

AI+ and metadata suggestions still come from the configured host agent. When no host agent is connected, the GUI should report an offline/unavailable state rather than pretending to provide built-in intelligence.
