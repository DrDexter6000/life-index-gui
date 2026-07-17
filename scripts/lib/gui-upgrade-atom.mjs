import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolvePythonCommand } from './python-interpreter.mjs';

export const GUI_UPGRADE_SCHEMA_VERSION = 'gui.upgrade.v0';
export const GUI_UPGRADE_COMMAND = 'gui-upgrade';
const REQUIRED_DEV_DEPENDENCIES = ['vite', 'typescript', 'eslint', 'vitest'];
const NPM_INSTALL_COMMAND = 'npm ci --include=dev';
const BACKEND_PYTHON_SUPPORTED_RANGE = '3.11-3.13';
const BACKEND_PYTHON_MIN = { major: 3, minor: 11 };
const BACKEND_PYTHON_MAX = { major: 3, minor: 13 };
const REQUIRED_BACKEND_MODULES = ['fastapi', 'uvicorn', 'pydantic_core', 'PIL'];
const BACKEND_REQUIREMENTS_RELATIVE = 'backend/requirements.txt';
const CLI_MINIMUM_VERSION_FALLBACK = '1.4.5';
const CLI_VERSION_COMMAND = 'life-index --version';
const VERIFY_STACK_COMMAND = 'npm run verify-stack';
const SYNC_SKILL_COMMAND = 'npm run sync-skill';
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

function tryRunCommand(command, args, { cwd, commandRunner = defaultCommandRunner }) {
  try {
    const result = commandRunner(command, args, { cwd });
    if (typeof result === 'string' || Buffer.isBuffer(result)) {
      return { ok: true, stdout: normalizeCommandOutput(result), stderr: '', message: '' };
    }

    const status = typeof result?.status === 'number' ? result.status : (result?.ok === false ? 1 : 0);
    const output = {
      ok: status === 0 && !result?.error,
      stdout: normalizeCommandOutput(result?.stdout),
      stderr: normalizeCommandOutput(result?.stderr),
      message: result?.message || result?.error?.message || '',
    };
    if (!output.ok && !output.message) {
      output.message = `${formatCommand(command, args)} failed`;
    }
    return output;
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
  const dirtyResult = tryExecText('git', ['status', '--porcelain=v1'], { cwd: root, commandRunner });
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
    install_command: NPM_INSTALL_COMMAND,
    version: process.version,
    exec_path: process.execPath,
  };
}

function detectPython(repoRoot, env, commandRunner) {
  const command = resolvePythonCommand({ repoRoot, env });
  const requirementsFile = join(repoRoot, 'backend', 'requirements.txt');
  const installCommand = `${command} -m pip install -r ${BACKEND_REQUIREMENTS_RELATIVE}`;

  if (!existsSync(requirementsFile)) {
    return {
      command,
      version: null,
      supported_range: BACKEND_PYTHON_SUPPORTED_RANGE,
      supported: true,
      backend_requirements_present: true,
      missing_backend_modules: [],
      requirements_file: requirementsFile,
      install_command: installCommand,
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
    install_command: installCommand,
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
    safe_to_run: true,
    requires_human: false,
  };
}

function makeUnknownFreshnessAction() {
  return {
    id: 'resolve_unknown_git_freshness',
    description: 'Git freshness cannot be determined. Verify upstream, branch, and remote reachability.',
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
    description: 'Resolve local GUI worktree changes before running the upgrade atom.',
    side_effect: 'read',
    command: 'git status --porcelain',
    reason: `Dirty worktree blocks automated GUI upgrade apply: ${repo.dirty_files.join(', ')}`,
    safe_to_run: false,
    requires_human: true,
    suggested_manual_resolution: 'Commit, stash, or discard local changes before applying the upgrade.',
  };
}

function makeAheadAction() {
  return {
    id: 'resolve_ahead_branch',
    description: 'Local branch is ahead of upstream. Manual branch resolution is required before upgrade.',
    side_effect: 'read',
    command: 'git status --porcelain',
    reason: 'Local branch has commits not present on upstream.',
    safe_to_run: false,
    requires_human: true,
    suggested_manual_resolution:
      'Review local commits and decide whether to open a PR, push to the correct remote, or reset manually outside the upgrade atom.',
  };
}

function makeDivergedAction() {
  return {
    id: 'resolve_diverged_branch',
    description: 'Local and upstream branches have diverged. Manual resolution required.',
    side_effect: 'read',
    command: 'git status --porcelain',
    reason: 'Local branch has diverged from upstream with both local-only and remote-only commits.',
    safe_to_run: false,
    requires_human: true,
  };
}

function makePullFfOnlyAction() {
  return {
    id: 'git_pull_ff_only',
    description: 'Fast-forward local branch to match upstream.',
    side_effect: 'write',
    command: 'git pull --ff-only',
    reason: 'Local branch is behind upstream with no local-only commits.',
    safe_to_run: true,
    requires_human: false,
  };
}

function makeRefreshThenPullAction() {
  return {
    id: 'git_refresh_then_pull_ff_only',
    description: 'Refresh tracking information and fast-forward to upstream.',
    side_effect: 'write',
    command: 'git fetch --prune && git pull --ff-only',
    reason: 'Remote tracking information is stale; local counts show 0/0 but remote has moved.',
    safe_to_run: true,
    requires_human: false,
  };
}

function makeClearNodeEnvProductionAction() {
  return {
    id: 'clear_node_env_production',
    description: 'NODE_ENV=production is active; clear it before installing GUI devDependencies.',
    side_effect: 'read',
    command: null,
    reason: 'Production NODE_ENV can make npm omit devDependencies while still reporting install success.',
    safe_to_run: false,
    requires_human: true,
    suggested_manual_resolution: {
      posix: 'unset NODE_ENV && npm ci --include=dev',
      powershell: "$env:NODE_ENV=''; npm ci --include=dev",
    },
  };
}

function makeRestoreNpmOmitDevAction(node) {
  return {
    id: 'restore_npm_omit_dev',
    description: 'npm omit includes dev; restore npm configuration before installing GUI devDependencies.',
    side_effect: 'read',
    command: 'npm config get omit',
    reason: `npm omit is ${node.npm_omit.join(', ')}, so npm may skip devDependencies.`,
    safe_to_run: false,
    requires_human: true,
    suggested_manual_resolution: {
      posix: 'npm config delete omit || npm config set omit ""',
      powershell: 'npm config delete omit; if ($LASTEXITCODE -ne 0) { npm config set omit "" }',
    },
  };
}

function makeNpmCiIncludeDevAction(node) {
  return {
    id: 'npm_ci_include_dev',
    description: 'Install missing GUI Node devDependencies with npm including dev dependencies.',
    side_effect: 'write',
    command: NPM_INSTALL_COMMAND,
    reason: `Missing required GUI devDependencies: ${node.missing_dev_dependencies.join(', ')}`,
    safe_to_run: true,
    requires_human: false,
  };
}

function makeBackendPythonVersionAction(python) {
  return {
    id: 'resolve_backend_python_version',
    description: 'Resolve unsupported GUI backend Python before installing backend requirements.',
    side_effect: 'read',
    command: `${python.command} --version`,
    reason: `GUI backend supports Python ${BACKEND_PYTHON_SUPPORTED_RANGE}; detected ${python.version ?? 'unknown'}.`,
    safe_to_run: false,
    requires_human: true,
    suggested_manual_resolution: {
      posix:
        'python3.13 -m venv .venv && . .venv/bin/activate && python -m pip install -r backend/requirements.txt',
      powershell:
        'py -3.13 -m venv .venv; .venv\\Scripts\\python.exe -m pip install -r backend/requirements.txt',
    },
  };
}

function makePipInstallBackendRequirementsAction(python) {
  return {
    id: 'pip_install_backend_requirements',
    description: 'Install missing GUI backend Python runtime requirements.',
    side_effect: 'write',
    command: python.install_command,
    reason: `Missing backend Python modules: ${python.missing_backend_modules.join(', ')}`,
    safe_to_run: true,
    requires_human: false,
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

function makeResolveCliDependencyAction(cliDependency) {
  return {
    id: 'resolve_cli_dependency',
    description: 'Resolve Life Index CLI dependency before GUI upgrade apply.',
    side_effect: 'read',
    command: CLI_VERSION_COMMAND,
    reason: cliDependencyReason(cliDependency),
    safe_to_run: false,
    requires_human: true,
    suggested_manual_resolution: {
      posix:
        'Run life-index upgrade --plan --json to inspect CLI-owned upgrade steps, or manually install/upgrade the CLI outside the GUI atom, for example: python -m pip install --upgrade life-index. Then rerun npm run gui-upgrade:plan -- --json.',
      powershell:
        'Run life-index upgrade --plan --json to inspect CLI-owned upgrade steps, or manually install/upgrade the CLI outside the GUI atom, for example: py -m pip install --upgrade life-index. Then rerun npm run gui-upgrade:plan -- --json.',
    },
  };
}

function makeVerifyStackAction() {
  return {
    id: 'verify_stack',
    description: 'Run GUI stack verification after safe upgrade actions complete.',
    side_effect: 'write',
    command: VERIFY_STACK_COMMAND,
    reason: 'All upgrade dependency checks are safe; verify the local GUI stack before reporting success.',
    safe_to_run: true,
    requires_human: false,
  };
}

function makeSyncSkillAction() {
  return {
    id: 'sync_skill',
    description: 'Refresh the Life Index GUI host-agent skill after stack verification succeeds.',
    side_effect: 'write',
    command: SYNC_SKILL_COMMAND,
    reason: 'The GUI stack is verified; deliver the current launch/operation skill to the host agent registry.',
    safe_to_run: true,
    requires_human: false,
  };
}

function makeAppliedGitAction(id, command) {
  return { id, command };
}

function makeAppliedAction(id, command) {
  return { id, command };
}

function makeGitError(command, result) {
  return {
    command,
    stdout: result.stdout,
    stderr: result.stderr,
    message: result.message,
  };
}

function makeNpmError(command, result) {
  return {
    command,
    stdout: result.stdout,
    stderr: result.stderr,
    message: result.message,
  };
}

function makePipError(command, result) {
  return {
    command,
    stdout: result.stdout,
    stderr: result.stderr,
    message: result.message,
  };
}

function makeVerifyError(command, result) {
  return {
    command,
    stdout: result.stdout,
    stderr: result.stderr,
    message: result.message,
  };
}

function makeSkillError(command, result) {
  return {
    command,
    stdout: result.stdout,
    stderr: result.stderr,
    message: result.message,
  };
}

function makeVerificationData(verification = {}) {
  return {
    verify_stack_command: VERIFY_STACK_COMMAND,
    required: true,
    verified: Boolean(verification.verified),
    last_result: verification.lastResult ?? null,
  };
}

function makeSkillDeliveryData(skillDelivery = {}) {
  return {
    skill_name: 'life-index-gui',
    sync_command: SYNC_SKILL_COMMAND,
    delivered: Boolean(skillDelivery.delivered),
    last_result: skillDelivery.lastResult ?? null,
  };
}

function makeApplyFailure({ plan, code, message, appliedActions, gitError, npmError, pipError, verifyError, skillError }) {
  return {
    ...plan,
    success: false,
    mode: 'apply',
    data: {
      ...plan.data,
      applied_actions: appliedActions,
      ...(gitError ? { git_error: gitError } : {}),
      ...(npmError ? { npm_error: npmError } : {}),
      ...(pipError ? { pip_error: pipError } : {}),
      ...(verifyError ? { verify_error: verifyError } : {}),
      ...(skillError ? { skill_error: skillError } : {}),
    },
    error: {
      code,
      message,
    },
  };
}

function isCurrentRepo(repo) {
  return !repo.dirty
    && repo.upstream
    && repo.ahead === 0
    && repo.behind === 0
    && repo.freshness === 'current'
    && repo.remote_probe.status !== 'unreachable';
}

function isSafeFastForwardRepo(repo) {
  return !repo.dirty
    && repo.upstream
    && repo.ahead === 0
    && repo.behind > 0
    && repo.freshness === 'behind'
    && repo.remote_probe.status !== 'unreachable';
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
  verification,
  skillDelivery,
} = {}) {
  const repo = detectRepo(repoRoot, commandRunner);
  const node = detectNode(repo.path, env, commandRunner);
  const python = detectPython(repo.path, env, commandRunner);
  const cliDependency = detectCliDependency(repo.path, commandRunner);
  const verificationData = makeVerificationData(verification);
  const skillDeliveryData = makeSkillDeliveryData(skillDelivery);
  const actions = [];
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
      actions.push(makeRefreshThenPullAction());
    } else {
      actions.push(makePullFfOnlyAction());
    }
  }

  const hasUnsafeGitAction = actions.some((action) => !action.safe_to_run || action.requires_human);
  if (isNodeEnvProduction(env)) {
    actions.push(makeClearNodeEnvProductionAction());
  } else if (node.npm_omit.includes('dev')) {
    actions.push(makeRestoreNpmOmitDevAction(node));
  } else if (!hasUnsafeGitAction && !node.dev_dependencies_present) {
    actions.push(makeNpmCiIncludeDevAction(node));
  }

  if (!python.supported) {
    actions.push(makeBackendPythonVersionAction(python));
  } else if (!hasUnsafeGitAction && !python.backend_requirements_present) {
    actions.push(makePipInstallBackendRequirementsAction(python));
  }

  if (cliDependency.status !== 'ok') {
    actions.push(makeResolveCliDependencyAction(cliDependency));
    if (cliDependency.status === 'missing' || cliDependency.status === 'unknown') partial = true;
  }

  const hasUnsafeAction = actions.some((action) => !action.safe_to_run || action.requires_human);
  if (!hasUnsafeAction && !verificationData.verified) {
    actions.push(makeVerifyStackAction());
  }
  if (!hasUnsafeAction && !skillDeliveryData.delivered) {
    actions.push(makeSyncSkillAction());
  }

  return {
    repo,
    node,
    python,
    cli_dependency: cliDependency,
    verification: verificationData,
    skill_delivery: skillDeliveryData,
    actions,
    recommended_next_step: selectRecommendedNextStep(actions),
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
  const appliedActions = [];
  const verificationState = {
    verified: false,
    lastResult: null,
  };
  const skillDeliveryState = {
    delivered: false,
    lastResult: null,
  };
  const maxApplySteps = 8;

  for (let step = 0; step < maxApplySteps; step += 1) {
    const planOptions = { ...options, verification: verificationState, skillDelivery: skillDeliveryState };
    const plan = planGuiUpgrade(planOptions);
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
          message: 'GUI upgrade apply refused because the plan contains unsafe or human-required actions.',
          action_ids: blockedActions.map((action) => action.id),
        },
      };
    }

    if (plan.data.actions.length === 0) {
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

    const cwd = plan.data.repo.path;
    const action = plan.data.actions[0];

    if (action.id === 'git_pull_ff_only') {
      const result = tryExecText('git', ['pull', '--ff-only'], { cwd, commandRunner: options.commandRunner });
      if (!result.ok) {
        return makeApplyFailure({
          plan,
          code: 'GUI_UPGRADE_GIT_PULL_FAILED',
          message: 'git pull --ff-only failed; GUI upgrade apply stopped without recording the failed pull.',
          appliedActions,
          gitError: makeGitError('git pull --ff-only', result),
        });
      }
      appliedActions.push(makeAppliedGitAction('git_pull_ff_only', 'git pull --ff-only'));
      continue;
    } else if (action.id === 'git_refresh_then_pull_ff_only') {
      const fetchResult = tryExecText('git', ['fetch', '--prune'], { cwd, commandRunner: options.commandRunner });
      if (!fetchResult.ok) {
        return makeApplyFailure({
          plan,
          code: 'GUI_UPGRADE_GIT_FETCH_FAILED',
          message: 'git fetch --prune failed; GUI upgrade apply stopped before pull.',
          appliedActions,
          gitError: makeGitError('git fetch --prune', fetchResult),
        });
      }
      appliedActions.push(makeAppliedGitAction('git_fetch_prune', 'git fetch --prune'));

      const freshPlan = planGuiUpgrade(planOptions);
      const freshRepo = freshPlan.data.repo;

      if (isCurrentRepo(freshRepo)) {
        continue;
      }

      if (!isSafeFastForwardRepo(freshRepo)) {
        return makeApplyFailure({
          plan: freshPlan,
          code: 'GUI_UPGRADE_GIT_RECHECK_UNSAFE',
          message: 'GUI upgrade apply refused to pull because the post-fetch git state is no longer a safe fast-forward.',
          appliedActions,
        });
      }

      const pullResult = tryExecText('git', ['pull', '--ff-only'], { cwd, commandRunner: options.commandRunner });
      if (!pullResult.ok) {
        return makeApplyFailure({
          plan: freshPlan,
          code: 'GUI_UPGRADE_GIT_PULL_FAILED',
          message: 'git pull --ff-only failed after fetch; GUI upgrade apply stopped without recording the failed pull.',
          appliedActions,
          gitError: makeGitError('git pull --ff-only', pullResult),
        });
      }
      appliedActions.push(makeAppliedGitAction('git_pull_ff_only', 'git pull --ff-only'));
      continue;
    } else if (action.id === 'npm_ci_include_dev') {
      const npmResult = tryExecText('npm', ['ci', '--include=dev'], { cwd, commandRunner: options.commandRunner });
      if (!npmResult.ok) {
        return makeApplyFailure({
          plan,
          code: 'GUI_UPGRADE_NPM_CI_FAILED',
          message: 'npm ci --include=dev failed; GUI upgrade apply stopped without recording the failed install.',
          appliedActions,
          npmError: makeNpmError(NPM_INSTALL_COMMAND, npmResult),
        });
      }
      appliedActions.push(makeAppliedAction('npm_ci_include_dev', NPM_INSTALL_COMMAND));
      continue;
    } else if (action.id === 'pip_install_backend_requirements') {
      const python = plan.data.python;
      const pipResult = tryExecText(
        python.command,
        ['-m', 'pip', 'install', '-r', BACKEND_REQUIREMENTS_RELATIVE],
        { cwd, commandRunner: options.commandRunner },
      );
      if (!pipResult.ok) {
        return makeApplyFailure({
          plan,
          code: 'GUI_UPGRADE_PIP_INSTALL_FAILED',
          message: 'Python backend requirements install failed; GUI upgrade apply stopped without recording the failed install.',
          appliedActions,
          pipError: makePipError(python.install_command, pipResult),
        });
      }
      appliedActions.push(makeAppliedAction('pip_install_backend_requirements', python.install_command));
      continue;
    } else if (action.id === 'verify_stack') {
      const verifyResult = tryRunCommand('npm', ['run', 'verify-stack'], {
        cwd,
        commandRunner: options.commandRunner,
      });
      if (!verifyResult.ok) {
        verificationState.verified = false;
        verificationState.lastResult = {
          ok: false,
          stdout: verifyResult.stdout,
          stderr: verifyResult.stderr,
        };
        return makeApplyFailure({
          plan: {
            ...plan,
            data: {
              ...plan.data,
              verification: makeVerificationData(verificationState),
            },
          },
          code: 'GUI_UPGRADE_VERIFY_STACK_FAILED',
          message: 'npm run verify-stack failed; GUI upgrade apply stopped without recording the failed verification.',
          appliedActions,
          verifyError: makeVerifyError(VERIFY_STACK_COMMAND, verifyResult),
        });
      }
      verificationState.verified = true;
      verificationState.lastResult = {
        ok: true,
        stdout: verifyResult.stdout,
        stderr: verifyResult.stderr,
      };
      appliedActions.push(makeAppliedAction('verify_stack', VERIFY_STACK_COMMAND));
      continue;
    } else if (action.id === 'sync_skill') {
      const syncResult = tryRunCommand('npm', ['run', 'sync-skill'], {
        cwd,
        commandRunner: options.commandRunner,
      });
      let syncPayload = null;
      if (syncResult.ok) {
        try {
          syncPayload = JSON.parse(syncResult.stdout);
        } catch (error) {
          syncResult.ok = false;
          syncResult.message = `sync-skill stdout was not JSON: ${error.message}`;
        }
      }
      if (syncResult.ok && syncPayload?.delivered !== true) {
        syncResult.ok = false;
        syncResult.message = syncPayload?.message || 'sync-skill did not report delivered:true.';
      }
      if (!syncResult.ok) {
        skillDeliveryState.delivered = false;
        skillDeliveryState.lastResult = {
          ok: false,
          stdout: syncResult.stdout,
          stderr: syncResult.stderr,
        };
        return makeApplyFailure({
          plan: {
            ...plan,
            data: {
              ...plan.data,
              skill_delivery: makeSkillDeliveryData(skillDeliveryState),
            },
          },
          code: 'GUI_UPGRADE_SYNC_SKILL_FAILED',
          message: 'npm run sync-skill failed; GUI upgrade apply stopped without recording the failed skill sync.',
          appliedActions,
          skillError: makeSkillError(SYNC_SKILL_COMMAND, syncResult),
        });
      }
      skillDeliveryState.delivered = true;
      skillDeliveryState.lastResult = {
        ok: true,
        stdout: syncResult.stdout,
        stderr: syncResult.stderr,
      };
      appliedActions.push(makeAppliedAction('sync_skill', SYNC_SKILL_COMMAND));
      continue;
    }
  }

  const finalPlan = planGuiUpgrade({ ...options, verification: verificationState, skillDelivery: skillDeliveryState });
  return {
    ...finalPlan,
    success: false,
    mode: 'apply',
    data: {
      ...finalPlan.data,
      applied_actions: appliedActions,
    },
    error: {
      code: 'GUI_UPGRADE_APPLY_STEPS_EXHAUSTED',
      message: 'GUI upgrade apply stopped after too many replan/apply steps.',
    },
  };
}
