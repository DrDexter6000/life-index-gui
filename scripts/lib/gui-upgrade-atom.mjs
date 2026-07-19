import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolvePythonCommand } from './python-interpreter.mjs';

export const GUI_UPGRADE_SCHEMA_VERSION = 'gui.upgrade.v0';
export const GUI_UPGRADE_COMMAND = 'gui-upgrade';
const REQUIRED_DEV_DEPENDENCIES = ['vite', 'typescript', 'eslint', 'vitest'];
const BACKEND_PYTHON_SUPPORTED_RANGE = '3.11-3.13';
const BACKEND_PYTHON_MIN = { major: 3, minor: 11 };
const BACKEND_PYTHON_MAX = { major: 3, minor: 13 };
const REQUIRED_BACKEND_MODULES = ['fastapi', 'uvicorn', 'pydantic_core', 'PIL'];
const CLI_MINIMUM_VERSION_FALLBACK = '1.4.5';
const CLI_VERSION_COMMAND = 'life-index --version';
const REINSTALL_PLAYBOOK = 'docs/AGENT_UPDATE_PLAYBOOK.md';
const CLI_FEATURE_GATES = [
  {
    id: 'entity_review_cards',
    required_cli: '1.4.5',
    hard_required: true,
    label: 'Entity review cards',
  },
];

function needsWindowsShell(command) {
  return process.platform === 'win32' && (command === 'npm' || command === 'npx');
}

function quoteWindowsCommandArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) {
    return text;
  }
  return `"${text.replace(/(["^&|<>])/g, '^$1')}"`;
}

function defaultCommandRunner(command, args, { cwd }) {
  const commandArgs = needsWindowsShell(command)
    ? ['cmd.exe', ['/d', '/s', '/c', [command, ...args].map(quoteWindowsCommandArg).join(' ')]]
    : [command, args];

  return execFileSync(commandArgs[0], commandArgs[1], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function normalizeCommandOutput(value) {
  return String(value ?? '').trim();
}

function formatCommand(command, args) {
  return `${command} ${args.join(' ')}`;
}

function execText(command, args, { cwd, commandRunner = defaultCommandRunner }) {
  const result = commandRunner(command, args, { cwd });
  if (typeof result === 'string' || Buffer.isBuffer(result)) {
    return normalizeCommandOutput(result);
  }

  const status = typeof result?.status === 'number' ? result.status : (result?.ok === false ? 1 : 0);
  if (status !== 0 || result?.error) {
    const error = new Error(result?.message || result?.error?.message || `${formatCommand(command, args)} failed`);
    error.stdout = result?.stdout;
    error.stderr = result?.stderr;
    throw error;
  }

  return normalizeCommandOutput(result?.stdout);
}

function tryExecText(command, args, { cwd, commandRunner }) {
  try {
    return { ok: true, stdout: execText(command, args, { cwd, commandRunner }) };
  } catch (error) {
    return {
      ok: false,
      stdout: normalizeCommandOutput(error.stdout),
      stderr: normalizeCommandOutput(error.stderr),
      message: error.message,
    };
  }
}

function readPackageJson(repoRoot) {
  try {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    return {
      ok: true,
      name: packageJson.name ?? null,
      version: packageJson.version ?? null,
      raw: packageJson,
    };
  } catch (error) {
    return {
      ok: false,
      name: null,
      version: null,
      raw: null,
      error: String(error.message ?? error),
    };
  }
}

function normalizeOptionalEnvValue(value) {
  if (value == null) return null;
  const text = String(value);
  return text.trim() ? text : null;
}

function isNodeEnvProduction(env) {
  return String(env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
}

function packageDependencyPath(repoRoot, dependencyName) {
  return join(repoRoot, 'node_modules', ...dependencyName.split('/'), 'package.json');
}

function parseNpmOmit(text) {
  return String(text ?? '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item && item !== 'null' && item !== 'undefined');
}

function parseAheadBehind(text) {
  const [aheadRaw = '0', behindRaw = '0'] = text.split(/\s+/);
  return {
    ahead: Number.parseInt(aheadRaw, 10) || 0,
    behind: Number.parseInt(behindRaw, 10) || 0,
  };
}

function comparePythonVersion(version, boundary) {
  if (version.major !== boundary.major) return version.major - boundary.major;
  return version.minor - boundary.minor;
}

function parsePythonVersion(text) {
  const match = String(text ?? '').trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return {
    text: match[3] == null ? `${match[1]}.${match[2]}` : `${match[1]}.${match[2]}.${match[3]}`,
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
  };
}

function isSupportedBackendPython(version) {
  if (!version) return false;
  return comparePythonVersion(version, BACKEND_PYTHON_MIN) >= 0
    && comparePythonVersion(version, BACKEND_PYTHON_MAX) <= 0;
}

function parseVersionParts(value) {
  const normalized = String(value ?? '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) return null;
  return normalized.split('.').map((part) => Number.parseInt(part, 10));
}

function compareDottedVersion(actual, minimum) {
  const actualParts = parseVersionParts(actual);
  const minimumParts = parseVersionParts(minimum);
  if (!actualParts || !minimumParts) return null;
  const maxLength = Math.max(actualParts.length, minimumParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const actualPart = actualParts[index] ?? 0;
    const minimumPart = minimumParts[index] ?? 0;
    if (actualPart !== minimumPart) return actualPart - minimumPart;
  }
  return 0;
}

function versionGte(actual, minimum) {
  const comparison = compareDottedVersion(actual, minimum);
  return comparison == null ? false : comparison >= 0;
}

function readCliMinimumVersion(repoRoot) {
  try {
    const text = readFileSync(join(repoRoot, 'backend', 'adapter', 'cli_adapter.py'), 'utf8');
    const match = text.match(/MIN_SUPPORTED_CLI_VERSION\s*=\s*["']([^"']+)["']/);
    return match?.[1] ?? CLI_MINIMUM_VERSION_FALLBACK;
  } catch {
    return CLI_MINIMUM_VERSION_FALLBACK;
  }
}

function extractCliPackageVersion(stdout) {
  const text = normalizeCommandOutput(stdout);
  if (!text) return null;
  try {
    const payload = JSON.parse(text);
    return payload.package_version
      ?? payload.cli_package_version
      ?? payload.data?.cli_package_version
      ?? payload.data?.package_version
      ?? payload.bootstrap_manifest?.repo_version
      ?? null;
  } catch {
    const match = text.match(/(?:package_version|cli_package_version|life-index)\D+([^\s"'`,}]+)/i)
      ?? text.match(/^\s*(\S+)/);
    return match?.[1] ?? null;
  }
}

function buildCliFeatureGates(cliVersion) {
  return CLI_FEATURE_GATES.map((gate) => {
    const satisfied = versionGte(cliVersion, gate.required_cli);
    return {
      id: gate.id,
      required_cli: gate.required_cli,
      satisfied,
      reason: satisfied
        ? `${gate.label} requirement satisfied by CLI ${cliVersion}.`
        : `${gate.label} requires CLI ${gate.required_cli}+; detected ${cliVersion ?? 'unknown'}.`,
    };
  });
}

// Remote probe (git ls-remote, never fetches).

function probeRemote(repoRoot, upstream, commandRunner) {
  const slashIdx = upstream.indexOf('/');
  if (slashIdx === -1) return { status: 'unknown_upstream' };
  const remoteName = upstream.slice(0, slashIdx);
  const branchRef = upstream.slice(slashIdx + 1);

  const urlResult = tryExecText('git', ['remote', 'get-url', remoteName], { cwd: repoRoot, commandRunner });
  if (!urlResult.ok) return { status: 'unknown_upstream' };

  const lsResult = tryExecText(
    'git',
    ['ls-remote', '--exit-code', urlResult.stdout, `refs/heads/${branchRef}`],
    { cwd: repoRoot, commandRunner },
  );
  if (!lsResult.ok) {
    return { status: 'unreachable', error: lsResult.stderr || lsResult.message };
  }

  const remoteHead = lsResult.stdout.split(/\s+/)[0] || null;
  return { status: 'ok', remote_head: remoteHead };
}

// Repo detection.

function detectRepo(repoRoot, commandRunner) {
  const rootResult = tryExecText('git', ['rev-parse', '--show-toplevel'], { cwd: repoRoot, commandRunner });
  const root = rootResult.ok ? resolve(rootResult.stdout) : resolve(repoRoot);
  const packageInfo = readPackageJson(root);
  const dirtyResult = tryExecText('git', ['--no-optional-locks', 'status', '--porcelain=v1'], { cwd: root, commandRunner });
  const branchResult = tryExecText('git', ['branch', '--show-current'], { cwd: root, commandRunner });
  const headResult = tryExecText('git', ['rev-parse', 'HEAD'], { cwd: root, commandRunner });
  const upstreamResult = tryExecText(
    'git',
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    { cwd: root, commandRunner },
  );

  const isDetached = !(branchResult.ok && branchResult.stdout);
  const upstream = upstreamResult.ok ? upstreamResult.stdout : null;

  const countsResult = upstreamResult.ok
    ? tryExecText('git', ['rev-list', '--left-right', '--count', 'HEAD...@{u}'], { cwd: root, commandRunner })
    : { ok: false, stdout: '0 0' };
  const counts = countsResult.ok ? parseAheadBehind(countsResult.stdout) : { ahead: 0, behind: 0 };
  const dirtyFiles = dirtyResult.ok
    ? dirtyResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];

  let remoteProbe;
  if (!upstream || isDetached) {
    remoteProbe = { status: 'unknown_upstream' };
  } else {
    remoteProbe = probeRemote(root, upstream, commandRunner);
    if (remoteProbe.status === 'ok' && remoteProbe.remote_head && headResult.ok) {
      if (remoteProbe.remote_head !== headResult.stdout && counts.ahead === 0 && counts.behind === 0) {
        remoteProbe = { ...remoteProbe, status: 'stale_tracking' };
      }
    }
  }

  let freshness;
  if (!upstream || isDetached || remoteProbe.status === 'unreachable') {
    freshness = 'unknown';
  } else if (dirtyFiles.length > 0) {
    freshness = 'dirty';
  } else if (counts.ahead > 0 && counts.behind > 0) {
    freshness = 'diverged';
  } else if (counts.ahead > 0) {
    freshness = 'ahead';
  } else if (counts.behind > 0) {
    freshness = 'behind';
  } else if (remoteProbe.status === 'stale_tracking') {
    freshness = 'behind';
  } else {
    freshness = 'current';
  }

  return {
    path: root,
    package_name: packageInfo.name,
    package_version: packageInfo.version,
    branch: branchResult.ok && branchResult.stdout ? branchResult.stdout : null,
    head: headResult.ok ? headResult.stdout : null,
    upstream,
    dirty: dirtyFiles.length > 0,
    dirty_files: dirtyFiles,
    ahead: counts.ahead,
    behind: counts.behind,
    diverged: counts.ahead > 0 && counts.behind > 0,
    freshness,
    remote_probe: remoteProbe,
    checks: {
      git_root: rootResult.ok,
      package_json: packageInfo.ok,
      upstream: upstreamResult.ok,
    },
  };
}

// S1 detection helpers.

function detectNode(repoRoot, env, commandRunner) {
  const packageInfo = readPackageJson(repoRoot);
  const packageJson = packageInfo.raw ?? {};
  const declaredDevDeps = packageJson.devDependencies ?? {};
  const declaredDeps = packageJson.dependencies ?? {};
  const npmVersionResult = tryExecText('npm', ['--version'], { cwd: repoRoot, commandRunner });
  const npmOmitResult = tryExecText('npm', ['config', 'get', 'omit'], { cwd: repoRoot, commandRunner });
  const npmOmit = npmOmitResult.ok ? parseNpmOmit(npmOmitResult.stdout) : [];
  const missingDevDeps = REQUIRED_DEV_DEPENDENCIES.filter((name) => {
    const declared = Object.hasOwn(declaredDevDeps, name) || Object.hasOwn(declaredDeps, name);
    return !declared || !existsSync(packageDependencyPath(repoRoot, name));
  });

  return {
    node_version: process.version,
    npm_version: npmVersionResult.ok ? npmVersionResult.stdout : null,
    node_env: normalizeOptionalEnvValue(env.NODE_ENV),
    npm_omit: npmOmit,
    required_dev_dependencies: REQUIRED_DEV_DEPENDENCIES,
    missing_dev_dependencies: missingDevDeps,
    dev_dependencies_present: missingDevDeps.length === 0,
    package_lock_present: existsSync(join(repoRoot, 'package-lock.json')),
    version: process.version,
    exec_path: process.execPath,
  };
}

function detectPython(repoRoot, env, commandRunner) {
  const command = resolvePythonCommand({ repoRoot, env });
  const requirementsFile = join(repoRoot, 'backend', 'requirements.txt');

  if (!existsSync(requirementsFile)) {
    return {
      command,
      version: null,
      supported_range: BACKEND_PYTHON_SUPPORTED_RANGE,
      supported: true,
      backend_requirements_present: true,
      missing_backend_modules: [],
      requirements_file: requirementsFile,
      checked: false,
      skipped: true,
      reason: 'backend requirements file is not present in this fixture checkout.',
    };
  }

  const versionResult = tryExecText(
    command,
    ['-c', 'import sys; print(".".join(map(str, sys.version_info[:3])))'],
    { cwd: repoRoot, commandRunner },
  );
  const parsedVersion = versionResult.ok ? parsePythonVersion(versionResult.stdout) : null;
  const supported = isSupportedBackendPython(parsedVersion);
  const base = {
    command,
    version: parsedVersion?.text ?? (versionResult.ok ? versionResult.stdout : null),
    supported_range: BACKEND_PYTHON_SUPPORTED_RANGE,
    supported,
    backend_requirements_present: false,
    missing_backend_modules: [],
    requirements_file: requirementsFile,
    checked: true,
  };

  if (!versionResult.ok) {
    return {
      ...base,
      error: {
        code: 'GUI_UPGRADE_PYTHON_UNAVAILABLE',
        message: versionResult.stderr || versionResult.message,
      },
    };
  }

  if (!supported) {
    return base;
  }

  const importProbe = [
    'import importlib, json',
    `mods = ${JSON.stringify(REQUIRED_BACKEND_MODULES)}`,
    'missing = []',
    'for name in mods:',
    '    try:',
    '        importlib.import_module(name)',
    '    except Exception:',
    '        missing.append(name)',
    'print(json.dumps({"missing": missing}))',
  ].join('\n');
  const importResult = tryExecText(command, ['-c', importProbe], { cwd: repoRoot, commandRunner });
  if (!importResult.ok) {
    return {
      ...base,
      missing_backend_modules: REQUIRED_BACKEND_MODULES,
      import_error: importResult.stderr || importResult.message,
    };
  }

  let missing = REQUIRED_BACKEND_MODULES;
  try {
    const payload = JSON.parse(importResult.stdout);
    if (Array.isArray(payload.missing)) missing = payload.missing.map(String);
  } catch {
    missing = REQUIRED_BACKEND_MODULES;
  }

  return {
    ...base,
    backend_requirements_present: missing.length === 0,
    missing_backend_modules: missing,
  };
}

function detectCliDependency(repoRoot, commandRunner) {
  const cliMinimumVersion = readCliMinimumVersion(repoRoot);
  const versionResult = tryExecText('life-index', ['--version'], { cwd: repoRoot, commandRunner });

  if (!versionResult.ok) {
    return {
      checked: true,
      status: 'missing',
      cli_package_version: null,
      cli_minimum_version: cliMinimumVersion,
      compatible: false,
      feature_gates: buildCliFeatureGates(null),
      version_command: CLI_VERSION_COMMAND,
      error: {
        code: 'GUI_UPGRADE_CLI_MISSING',
        message: versionResult.stderr || versionResult.message,
      },
    };
  }

  const cliVersion = extractCliPackageVersion(versionResult.stdout);
  if (!cliVersion || parseVersionParts(cliVersion) == null) {
    return {
      checked: true,
      status: 'unknown',
      cli_package_version: cliVersion,
      cli_minimum_version: cliMinimumVersion,
      compatible: false,
      feature_gates: buildCliFeatureGates(cliVersion),
      version_command: CLI_VERSION_COMMAND,
      raw_version_output: versionResult.stdout,
      error: {
        code: 'GUI_UPGRADE_CLI_VERSION_UNKNOWN',
        message: `Could not parse CLI version from life-index --version output.`,
      },
    };
  }

  const compatible = versionGte(cliVersion, cliMinimumVersion);
  const featureGates = buildCliFeatureGates(cliVersion);
  const hardGateBlocked = featureGates.some((gate) => !gate.satisfied);

  return {
    checked: true,
    status: compatible && !hardGateBlocked ? 'ok' : 'incompatible',
    cli_package_version: cliVersion,
    cli_minimum_version: cliMinimumVersion,
    compatible,
    feature_gates: featureGates,
    version_command: CLI_VERSION_COMMAND,
  };
}

// Action constructors.

function makeNoopRecommendation() {
  return {
    id: 'none',
    description: 'GUI checkout is up to date; no git freshness action needed.',
    command: null,
    side_effect: 'read',
    reason: 'The dedicated GUI program environment is current and healthy.',
    safe_to_run: true,
    requires_human: false,
  };
}

function makeUnknownFreshnessAction() {
  return {
    id: 'resolve_unknown_git_freshness',
    description: 'Leave the existing checkout untouched; ask its owner to inspect upstream, branch, and remote reachability.',
    side_effect: 'read',
    command: 'git remote -v',
    reason: 'Upstream is missing, HEAD is detached, or the remote is unreachable.',
    safe_to_run: false,
    requires_human: true,
  };
}

function makeDirtyAction(repo) {
  return {
    id: 'resolve_dirty_worktree',
    description: 'Leave the dirty GUI checkout untouched; its owner must review the local changes.',
    side_effect: 'read',
    command: 'git --no-optional-locks status --porcelain',
    reason: `Dirty worktree blocks automated GUI upgrade apply: ${repo.dirty_files.join(', ')}`,
    safe_to_run: false,
    requires_human: true,
  };
}

function makeAheadAction() {
  return {
    id: 'resolve_ahead_branch',
    description: 'Leave the ahead GUI checkout untouched; its owner must review the local commits.',
    side_effect: 'read',
    command: 'git --no-optional-locks status --porcelain',
    reason: 'Local branch has commits not present on upstream.',
    safe_to_run: false,
    requires_human: true,
  };
}

function makeDivergedAction() {
  return {
    id: 'resolve_diverged_branch',
    description: 'Leave the diverged GUI checkout untouched; its owner must review the branch state.',
    side_effect: 'read',
    command: 'git --no-optional-locks status --porcelain',
    reason: 'Local branch has diverged from upstream with both local-only and remote-only commits.',
    safe_to_run: false,
    requires_human: true,
  };
}

function cliDependencyReason(cliDependency) {
  if (cliDependency.status === 'missing') {
    return 'Life Index CLI is not reachable from PATH.';
  }
  if (cliDependency.status === 'unknown') {
    return 'Life Index CLI version could not be parsed from the read-only version command.';
  }
  if (!cliDependency.compatible) {
    return `Detected CLI ${cliDependency.cli_package_version ?? 'unknown'} is below the GUI minimum CLI ${cliDependency.cli_minimum_version}.`;
  }
  const blockedGate = cliDependency.feature_gates.find((gate) => !gate.satisfied);
  if (blockedGate) {
    return `CLI feature gate ${blockedGate.id} is not satisfied: ${blockedGate.reason}`;
  }
  return 'Life Index CLI dependency requires manual resolution.';
}

function makeReinstallGuiAction(reasons) {
  return {
    id: 'reinstall_gui',
    description:
      `Leave the existing GUI checkout and shared/global environments untouched. Create a fresh dedicated install by following ${REINSTALL_PLAYBOOK}.`,
    side_effect: 'write',
    command: null,
    reason: reasons.join(' '),
    safe_to_run: false,
    requires_human: true,
  };
}

function selectRecommendedNextStep(actions) {
  return actions.find((action) => !action.safe_to_run || action.requires_human)
    ?? actions[0]
    ?? makeNoopRecommendation();
}

// Plan builder.

function buildPlanData({
  repoRoot = process.cwd(),
  env = process.env,
  commandRunner,
} = {}) {
  const repo = detectRepo(repoRoot, commandRunner);
  const node = detectNode(repo.path, env, commandRunner);
  const python = detectPython(repo.path, env, commandRunner);
  const cliDependency = detectCliDependency(repo.path, commandRunner);
  const actions = [];
  const reinstallReasons = [];
  let partial = false;

  if (repo.freshness === 'unknown') {
    actions.push(makeUnknownFreshnessAction());
    partial = true;
  } else if (repo.freshness === 'dirty') {
    actions.push(makeDirtyAction(repo));
  } else if (repo.freshness === 'ahead') {
    actions.push(makeAheadAction());
  } else if (repo.freshness === 'diverged') {
    actions.push(makeDivergedAction());
  } else if (repo.freshness === 'behind') {
    if (repo.remote_probe.status === 'stale_tracking') {
      reinstallReasons.push('GUI checkout tracking is stale and the remote has moved.');
    } else {
      reinstallReasons.push('The dedicated GUI checkout is behind upstream.');
    }
  }

  if (actions.length === 0) {
    if (isNodeEnvProduction(env)) {
      reinstallReasons.push('NODE_ENV=production makes this GUI program environment unsupported.');
    }
    if (node.npm_omit.includes('dev')) {
      reinstallReasons.push(`npm omit includes dev (${node.npm_omit.join(', ')}), so this GUI program environment is unsupported.`);
    }
    if (!node.dev_dependencies_present) {
      reinstallReasons.push(`Required GUI Node dependencies are missing: ${node.missing_dev_dependencies.join(', ')}.`);
    }
    if (!python.supported) {
      reinstallReasons.push(`GUI backend Python is unsupported; expected ${BACKEND_PYTHON_SUPPORTED_RANGE}, detected ${python.version ?? 'unknown'}.`);
    } else if (!python.backend_requirements_present) {
      reinstallReasons.push(`GUI backend dependencies are missing: ${python.missing_backend_modules.join(', ')}.`);
    }
    if (cliDependency.status !== 'ok') {
      reinstallReasons.push(`CLI dependency is inconsistent. ${cliDependencyReason(cliDependency)}`);
      if (cliDependency.status === 'missing' || cliDependency.status === 'unknown') partial = true;
    }
    if (reinstallReasons.length > 0) {
      actions.push(makeReinstallGuiAction(reinstallReasons));
    }
  }

  const reinstallRequired = actions.some((action) => action.id === 'reinstall_gui');

  return {
    repo,
    node,
    python,
    cli_dependency: cliDependency,
    actions,
    recommended_next_step: selectRecommendedNextStep(actions),
    reinstall_required: reinstallRequired,
    reinstall_playbook: REINSTALL_PLAYBOOK,
    partial,
  };
}

export function planGuiUpgrade(options = {}) {
  return {
    success: true,
    schema_version: GUI_UPGRADE_SCHEMA_VERSION,
    command: GUI_UPGRADE_COMMAND,
    mode: 'plan',
    data: buildPlanData(options),
  };
}

// Apply.

export function applyGuiUpgrade(options = {}) {
  const plan = planGuiUpgrade(options);
  const appliedActions = [];
  const reinstallAction = plan.data.actions.find((action) => action.id === 'reinstall_gui');
  if (reinstallAction) {
    return {
      ...plan,
      success: false,
      mode: 'apply',
      data: {
        ...plan.data,
        applied_actions: appliedActions,
      },
      error: {
        code: 'GUI_UPGRADE_REINSTALL_REQUIRED',
        message: `A fresh dedicated GUI install is required. Follow ${REINSTALL_PLAYBOOK}; leave the existing checkout and shared/global environments untouched.`,
        action_ids: [reinstallAction.id],
      },
    };
  }

  const blockedActions = plan.data.actions.filter(
    (action) => !action.safe_to_run || action.requires_human,
  );
  if (blockedActions.length > 0) {
    return {
      ...plan,
      success: false,
      mode: 'apply',
      data: {
        ...plan.data,
        applied_actions: appliedActions,
      },
      error: {
        code: 'GUI_UPGRADE_UNSAFE_ACTIONS',
        message: 'GUI upgrade apply refused because the plan contains human-owned diagnostics.',
        action_ids: blockedActions.map((action) => action.id),
      },
    };
  }

  return {
    ...plan,
    success: true,
    mode: 'apply',
    data: {
      ...plan.data,
      applied_actions: appliedActions,
    },
  };
}
