# Agent Update Playbook

This playbook is for a host agent updating a local Life Index stack. The CLI serves the agent; the GUI serves the human user. The GUI does not bundle a model, planner, or hidden orchestration layer.

## Lifecycle Rule

Life Index user data is durable and lives outside the GUI repository. The
dedicated GUI checkout, its `node_modules`, checkout-owned backend virtual
environment, dependencies, and program caches are disposable program state.
When that state needs an update or becomes inconsistent, create a fresh
dedicated install. Do not surgically repair the old install.

Leave the existing GUI checkout untouched while preparing its replacement.
Never delete or mutate a shared/global Python environment or a developer- or
user-owned checkout on the GUI atom's behalf. This package intentionally has no
installer, repair helper, mixed-install detector, or rollback system.

## 1. Diagnose The Existing GUI Install

From the existing dedicated GUI checkout, run:

```bash
npm run gui-upgrade:plan -- --json
npm run gui-upgrade:apply -- --json
```

Both entry points preserve the `gui.upgrade.v0` JSON contract. `plan` performs
read-only diagnostics. `apply` may build the same read-only plan, but it never
runs git fetch/pull, npm or pip installation, virtual-environment creation,
`sync-skill`, or `verify-stack`.

Behavior is explicit:

- A healthy, current dedicated install returns success with
  `reinstall_required:false` and no applied actions.
- A behind or stale checkout, missing Node/backend dependencies, unsupported
  program environment, or inconsistent CLI dependency produces one
  human-required `reinstall_gui` action with `command:null`.
- Apply returns exit 1 with `GUI_UPGRADE_REINSTALL_REQUIRED`,
  `reinstall_required:true`, and `applied_actions:[]`.
- Dirty, ahead, diverged, detached, unreachable, or otherwise unknown git state
  remains a human-owned fail-closed diagnostic. The atom does not suggest
  deleting or rewriting that checkout.

The GUI requires a compatible Life Index CLI. If the diagnostic reports a CLI
dependency inconsistency, use the CLI's own public onboarding guidance to
create or select a compatible CLI environment; do not let this GUI package
modify a shared/global CLI or a developer checkout.

## 2. Create A Fresh Dedicated GUI Install

Choose a new, empty directory dedicated to the GUI. Keep it separate from the
existing install and from the external Life Index data directory.

```bash
git clone https://github.com/DrDexter6000/life-index-gui.git life-index-gui-fresh
cd life-index-gui-fresh
npm ci --include=dev
python -m venv .venv
source .venv/bin/activate   # Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
```

The checkout-owned `.venv` is part of this dedicated install. Do not target a
shared/global Python environment. The GUI backend supports Python 3.11-3.13
until the pinned dependency set supports Python 3.14.

The GUI upgrade atom does not execute these commands. They are the explicit
human-owned clean-install path. It also does not remove the prior install;
leave that checkout untouched while validating the new one.

After verification succeeds and the new launcher/path is active, the operator
who initiated replacement owns cleanup. Remove the old root as one directory
only after proving it is dedicated managed program state and the external Life
Index data root is outside it. Never retain versioned rollback directories.
Leave shared/global, developer-owned, user-owned, or ambiguous roots untouched
and report them to the owner.

## 3. Verify And Activate The Fresh Install

Run the verifier separately from upgrade planning:

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

If ports are occupied, the verifier only stops processes it can prove belong
to this fresh GUI checkout. Unknown processes are never killed.

After verification succeeds, explicitly deliver the fresh checkout path to the
host-agent skill registry:

```bash
npm run sync-skill
```

The command writes `life-index-gui/SKILL.md` into exactly one detected host
skill registry. If no registry is present, or multiple possible targets are
present, it exits non-zero with `delivered:false` JSON instead of silently
claiming success. On machines with multiple registries, choose the intended
target explicitly:

```bash
npm run sync-skill -- --host-skill-dir ~/.hermes/skills
```

The version authority for the fresh install is `/api/version`; `/api/health`
carries the same version fields plus detailed CLI health diagnostics. Confirm
`compatible:true` before using GUI features.

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
