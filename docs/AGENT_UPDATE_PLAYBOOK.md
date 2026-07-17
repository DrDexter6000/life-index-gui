# Agent Update Playbook

This playbook is for a host agent updating a local Life Index stack. The CLI serves the agent; the GUI serves the human user. The GUI does not bundle a model, planner, or hidden orchestration layer.

## Order

Run the CLI update first, then the GUI upgrade atom. The GUI atom performs the
safe GUI dependency recovery sequence, runs stack verification, and refreshes
the GUI host-agent skill before it reports a successful apply.

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

Operations discipline: Never commit or push from an operations clone. Keep the clone at zero local changes. Write friction notes and operational notes to the Life Index data directory, not inside the cloned repository.

Host agents can first inspect the GUI checkout with the GUI upgrade atom:

```bash
npm run gui-upgrade:plan -- --json
npm run gui-upgrade:apply -- --json
```

The current GUI upgrade atom emits `gui.upgrade.v0` JSON for planning and
fail-closed apply checks. It covers git freshness/fast-forward, Node
devDependencies, `NODE_ENV` / npm omit guards, and Python backend dependency
preflight/install. It also checks the installed Life Index CLI dependency and
feature gates, including the global CLI `1.4.5+` floor used by review cards. After all safe
dependency and git actions are complete, apply runs `npm run verify-stack`, then
`npm run sync-skill`, and reports both results in JSON. The GUI requires CLI
`1.4.5+`; an older, missing, or unparseable CLI version is a fail-closed
dependency error. The atom still does not run public sync, tags, releases, or
CLI upgrade writes.

If the GUI atom reports `resolve_cli_dependency`, stop the GUI update and fix
the CLI first through the CLI-owned upgrade flow, for example
`life-index upgrade --plan --json`, or by manually upgrading the CLI install.
Then rerun the GUI atom. The GUI atom must not call `life-index upgrade --apply`
or install/upgrade the CLI itself.

```bash
cd /path/to/life-index-gui
git status --porcelain
git pull --ff-only
python --version
python3.13 -m venv .venv  # if the active Python is outside 3.11-3.13
source .venv/bin/activate # Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
echo $NODE_ENV
unset NODE_ENV             # if it printed production
npm ci --include=dev
npm run build
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

The GUI backend supports Python 3.11-3.13 until upstream `pydantic-core` / `Pillow` wheels cover Python 3.14. If the active interpreter is Python 3.14 or newer, create a Python 3.13 virtual environment before installing backend requirements.

Do not use bare `npm install` during upgrades. node_modules can be incomplete while npm reports "up to date"; `npm ci --include=dev` is the only supported dependency install path for upgrade recovery.

Before dependency recovery, print `NODE_ENV`. If it is `production`, clear it first; otherwise npm can omit devDependencies even when the lockfile contains them. On POSIX shells use `echo $NODE_ENV` and `unset NODE_ENV`; on Windows PowerShell use `$env:NODE_ENV` and `Remove-Item Env:NODE_ENV`.

If `npm ci --include=dev` finishes but critical devDependencies are still missing and the verify-stack preflight reports them, use this fallback: `pnpm install && pnpm run build`.

```bash
pnpm install && pnpm run build
```

Troubleshooting: if GUI dev, test, build, or verify commands report missing devDependencies or module-not-found errors, check `NODE_ENV` first and do not run development validation under `NODE_ENV=production`.

If `pnpm` is not installed yet:

```bash
npm i -g pnpm
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

GUI entity review cards use the global CLI `1.4.5+` compatibility floor because
they consume the structured review action contract. They do not have a lower
feature-level exception.

`/api/version` is the concise compatibility surface for agents. `/api/health` carries the same version fields plus detailed CLI health diagnostics for the human-facing GUI.

## 3. Verify the local stack manually

```bash
npm run verify-stack
```

This is the fallback when running manual recovery steps outside
`npm run gui-upgrade:apply -- --json`, or when an operator wants to re-run the
same verification after the atom has already succeeded.

Expected behavior:

- starts the backend on `127.0.0.1:8000`
- waits for `/api/health`
- runs the frontend build
- starts a Vite preview on `127.0.0.1:5173`
- prints one JSON result
- stops the backend and preview before exiting

If ports are occupied, the verifier only stops processes it can prove belong to this GUI checkout. Unknown processes are never killed.

After a manual verification path succeeds, refresh the GUI host-agent skill so
future host-agent sessions know this checkout's absolute path and launch
commands:

```bash
npm run sync-skill
```

The command writes `life-index-gui/SKILL.md` into exactly one detected host
skill registry. If no registry is present, or multiple possible targets are
present, it exits non-zero with `delivered:false` JSON instead of silently
claiming success.

On machines with multiple host skill registries, choose one explicitly:

```bash
npm run sync-skill -- --host-skill-dir ~/.hermes/skills
```

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

The CLI version must be an exact numeric `MAJOR.MINOR.PATCH`; short versions
and prerelease/build-suffixed versions fail closed. The backend adapter performs
the compatibility preflight before every non-handshake CLI feature call and
returns a structured upgrade error without invoking that feature command.

AI+ and metadata suggestions still come from the configured host agent. When no host agent is connected, the GUI should report an offline/unavailable state rather than pretending to provide built-in intelligence.
