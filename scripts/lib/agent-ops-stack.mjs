import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolvePythonCommand } from './python-interpreter.mjs';
import { checkDevEnvironment } from './require-dev-env.mjs';

export const DEFAULT_BACKEND_PORT = 8000;
export const DEFAULT_FRONTEND_PORT = 5173;
export const REFERENCE_BRIDGE_PORT = 8791;
export const REFERENCE_BRIDGE_URL = `http://127.0.0.1:${REFERENCE_BRIDGE_PORT}`;
const OWNERSHIP_ENV = 'LIFE_INDEX_GUI_AGENT_OPS';
const moduleRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKEND_PYTHON_SUPPORTED_RANGE = '3.11-3.13';
const BACKEND_PYTHON_MIN = { major: 3, minor: 11 };
const BACKEND_PYTHON_MAX = { major: 3, minor: 13 };

function isTrustedReferenceBridge(referenceBridge) {
  return referenceBridge?.bridgeReady === true
    && ['spawned-ready', 'reused-ready'].includes(referenceBridge.status);
}

export function createBackendChildEnv(callerEnv = {}, referenceBridge = null) {
  const childEnv = { ...callerEnv };
  if (String(callerEnv.LIFE_INDEX_HOST_AGENT_URL ?? '').trim()) {
    return childEnv;
  }

  delete childEnv.LIFE_INDEX_HOST_AGENT_URL;
  if (isTrustedReferenceBridge(referenceBridge)) {
    childEnv.LIFE_INDEX_HOST_AGENT_URL = REFERENCE_BRIDGE_URL;
  }
  return childEnv;
}

function commandName(name) {
  return process.platform === 'win32' && !name.endsWith('.cmd') ? `${name}.cmd` : name;
}

function normalizeText(value) {
  return String(value ?? '').replace(/\\/g, '/').toLowerCase();
}

function normalizePathForComparison(value, platform = process.platform) {
  const raw = String(value ?? '');
  const normalized = (platform === 'win32' ? raw.replace(/\\/g, '/') : raw)
    .replace(/\/+$/, '');
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function uniqueNumbers(values) {
  return [...new Set(values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasUniqueExactOptionPath(
  commandLine,
  option,
  expectedPath,
  platform = process.platform,
) {
  const rawCommandLine = String(commandLine ?? '');
  const text = platform === 'win32'
    ? rawCommandLine.replace(/\\/g, '/')
    : rawCommandLine;
  const path = normalizePathForComparison(expectedPath, platform);
  const optionPattern = escapeRegExp(String(option));
  const matcher = new RegExp(
    `(?:^|\\s)${optionPattern}(?:\\s+|=)(?:"([^"]*)"|'([^']*)'|(\\S+))(?=$|\\s)`,
    'gi',
  );
  const values = [...text.matchAll(matcher)].map(
    (match) => normalizePathForComparison(match[1] ?? match[2] ?? match[3], platform),
  );
  return values.length === 1 && values[0] === path;
}

function hasPort(commandLine, port) {
  const text = String(commandLine ?? '');
  return new RegExp(`(?:--port\\s+|:${port}\\b|\\b)${port}\\b`).test(text);
}

function isProjectOwnedProcess(processInfo, {
  repoRoot,
  role,
  port,
  platform = process.platform,
}) {
  const commandLine = processInfo?.commandLine ?? '';
  const text = normalizeText(commandLine);
  if (!hasPort(commandLine, port)) {
    return false;
  }
  if (role === 'backend') {
    return text.includes('uvicorn')
      && text.includes('backend.main:app')
      && hasUniqueExactOptionPath(commandLine, '--app-dir', repoRoot, platform);
  }
  if (role === 'frontend') {
    const frontendConfigPath = `${String(repoRoot).replace(/[\\/]+$/, '')}/vite.config.ts`;
    return text.includes('vite')
      && hasUniqueExactOptionPath(
        commandLine,
        '--config',
        frontendConfigPath,
        platform,
      );
  }
  if (role === 'reference-bridge') {
    return text.includes('uvicorn')
      && text.includes('host_agent_bridge.server:app')
      && hasUniqueExactOptionPath(commandLine, '--app-dir', repoRoot, platform);
  }
  return false;
}

export function classifyPortOwners({
  port,
  role,
  repoRoot,
  owners,
  platform = process.platform,
}) {
  const safeToStop = [];
  const blocked = [];
  for (const owner of owners) {
    if (isProjectOwnedProcess(owner, {
      repoRoot,
      role,
      port,
      platform,
    })) {
      safeToStop.push(owner);
    } else {
      blocked.push(owner);
    }
  }
  return { safeToStop, blocked };
}

export function parseWindowsTcpPids(text) {
  const pids = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const matches = line.match(/\d+/g);
    if (matches?.length) {
      pids.push(Number(matches.at(-1)));
    }
  }
  return uniqueNumbers(pids);
}

export function parseSsPids(text) {
  return uniqueNumbers([...String(text ?? '').matchAll(/pid=(\d+)/g)].map((match) => match[1]));
}

export function createLaunchCommands({
  repoRoot,
  backendPort = DEFAULT_BACKEND_PORT,
  frontendPort = DEFAULT_FRONTEND_PORT,
  pythonCommand,
} = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  return {
    backend: {
      command: pythonCommand ?? resolvePythonCommand({ repoRoot: root }),
      args: [
        '-m',
        'uvicorn',
        'backend.main:app',
        '--host',
        '127.0.0.1',
        '--port',
        String(backendPort),
        '--app-dir',
        root,
      ],
    },
    frontend: {
      command: process.execPath,
      args: [
        join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
        'preview',
        '--host',
        '127.0.0.1',
        '--port',
        String(frontendPort),
        '--strictPort',
        '--config',
        join(root, 'vite.config.ts'),
      ],
    },
  };
}

export function createReferenceBridgeLaunchCommand({
  repoRoot = moduleRepoRoot,
  port = REFERENCE_BRIDGE_PORT,
  pythonCommand,
} = {}) {
  const root = resolve(repoRoot);
  return {
    command: pythonCommand ?? resolvePythonCommand({ repoRoot: root }),
    args: [
      '-m',
      'uvicorn',
      'host_agent_bridge.server:app',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--app-dir',
      root,
    ],
  };
}

export function preflightVerifyStackDevDependencies({
  repoRoot = moduleRepoRoot,
  required = ['vite'],
  env = process.env,
  command = 'npm run verify-stack',
} = {}) {
  const guard = checkDevEnvironment({ env, command });
  if (!guard.ok) {
    return {
      ok: false,
      missing: [],
      error: {
        code: 'VERIFY_STACK_NODE_ENV_PRODUCTION',
        message: guard.error.message,
      },
    };
  }

  const root = resolve(repoRoot);
  const packageJsonPath = join(root, 'package.json');
  const requireFromRepo = createRequire(packageJsonPath);
  const missing = [];

  for (const dependencyName of required) {
    try {
      requireFromRepo.resolve(dependencyName);
    } catch {
      missing.push(dependencyName);
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      error: {
        code: 'VERIFY_STACK_DEVDEPS_MISSING',
        message: `Missing required dev dependency: ${missing.join(', ')}. Check NODE_ENV first; if it is production, clear it before running npm ci --include=dev. Run npm ci --include=dev before npm run verify-stack. If critical dev dependencies are still missing after npm ci, fallback: pnpm install && pnpm run build (install pnpm first with npm i -g pnpm).`,
      },
    };
  }

  return { ok: true, missing: [] };
}

function comparePythonVersion(version, boundary) {
  if (version.major !== boundary.major) {
    return version.major - boundary.major;
  }
  return version.minor - boundary.minor;
}

function backendPythonGuidance(versionText) {
  return `Life Index GUI backend supports Python ${BACKEND_PYTHON_SUPPORTED_RANGE} until upstream pydantic-core/Pillow wheels cover Python 3.14. Detected Python ${versionText}. Create a Python 3.13 virtual environment and reinstall backend dependencies: python3.13 -m venv .venv && . .venv/bin/activate && python -m pip install -r backend/requirements.txt. On Windows PowerShell: py -3.13 -m venv .venv; .venv\\Scripts\\python.exe -m pip install -r backend/requirements.txt.`;
}

export async function preflightBackendPythonVersion({
  pythonCommand = resolvePythonCommand({ repoRoot: moduleRepoRoot }),
  execPython = (command, args, options) => execFileAsync(command, args, options),
} = {}) {
  const result = await execPython(
    pythonCommand,
    ['-c', 'import sys; print(".".join(map(str, sys.version_info[:3])))'],
    { cwd: moduleRepoRoot },
  );
  if (!result.ok) {
    return {
      ok: false,
      supportedRange: BACKEND_PYTHON_SUPPORTED_RANGE,
      error: {
        code: 'VERIFY_STACK_PYTHON_UNAVAILABLE',
        message: `Could not run backend Python command "${pythonCommand}". Use Python ${BACKEND_PYTHON_SUPPORTED_RANGE}; for example: python3.13 -m venv .venv.`,
      },
    };
  }

  const versionText = String(result.stdout ?? '').trim();
  const match = versionText.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    return {
      ok: false,
      supportedRange: BACKEND_PYTHON_SUPPORTED_RANGE,
      error: {
        code: 'VERIFY_STACK_PYTHON_VERSION_UNKNOWN',
        message: `Could not parse backend Python version from "${versionText}". Use Python ${BACKEND_PYTHON_SUPPORTED_RANGE}; for example: python3.13 -m venv .venv.`,
      },
    };
  }

  const version = {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
  };
  const supported = comparePythonVersion(version, BACKEND_PYTHON_MIN) >= 0
    && comparePythonVersion(version, BACKEND_PYTHON_MAX) <= 0;

  if (!supported) {
    return {
      ok: false,
      version: versionText,
      supportedRange: BACKEND_PYTHON_SUPPORTED_RANGE,
      error: {
        code: 'VERIFY_STACK_PYTHON_UNSUPPORTED',
        message: backendPythonGuidance(versionText),
      },
    };
  }

  return { ok: true, version: versionText, supportedRange: BACKEND_PYTHON_SUPPORTED_RANGE };
}

export async function preflightWorktreeStatus({ repoRoot = moduleRepoRoot } = {}) {
  const root = resolve(repoRoot);
  const result = await execFileAsync('git', ['status', '--porcelain'], { cwd: root });
  if (!result.ok) {
    return {
      ok: true,
      dirty: false,
      dirtyFiles: [],
      skipped: true,
      reason: 'git-status-unavailable',
    };
  }

  const dirtyFiles = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (dirtyFiles.length === 0) {
    return { ok: true, dirty: false, dirtyFiles: [] };
  }

  const shownFiles = dirtyFiles.slice(0, 20).join('; ');
  const suffix = dirtyFiles.length > 20 ? `; ... ${dirtyFiles.length - 20} more` : '';
  return {
    ok: true,
    dirty: true,
    dirtyFiles,
    warning: {
      code: 'VERIFY_STACK_WORKTREE_DIRTY',
      message: `Working tree is dirty; git status --porcelain reported ${dirtyFiles.length} path(s): ${shownFiles}${suffix}. Keep operations clones at zero local changes. Restore tracked changes with git restore . and remove untracked files with git clean -fd before upgrading.`,
    },
  };
}

function execFileAsync(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    execFile(command, args, { encoding: 'utf8', windowsHide: true, ...options }, (error, stdout, stderr) => {
      resolvePromise({
        ok: !error,
        status: error?.code ?? 0,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
      });
    });
  });
}

export async function isPortListening(port, host = '127.0.0.1') {
  return new Promise((resolvePromise) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolvePromise(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolvePromise(false);
    });
    socket.once('error', () => resolvePromise(false));
  });
}

export async function getPortOwnerPids(port) {
  if (process.platform === 'win32') {
    const script = `$ErrorActionPreference='SilentlyContinue'; Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen | Select-Object LocalPort,OwningProcess | ConvertTo-Csv -NoTypeInformation`;
    const result = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script]);
    return result.ok ? parseWindowsTcpPids(result.stdout) : [];
  }

  const lsof = await execFileAsync('lsof', ['-nP', `-iTCP:${Number(port)}`, '-sTCP:LISTEN', '-t']);
  if (lsof.ok && lsof.stdout.trim()) {
    return uniqueNumbers(lsof.stdout.split(/\s+/));
  }

  const ss = await execFileAsync('ss', ['-ltnp']);
  if (!ss.ok) return [];
  const matchingLines = ss.stdout
    .split(/\r?\n/)
    .filter((line) => line.includes(`:${Number(port)} `) || line.includes(`:${Number(port)}\t`));
  return parseSsPids(matchingLines.join('\n'));
}

export async function getProcessInfo(pid) {
  if (!pid) {
    return { pid: null, commandLine: 'port is listening but process owner could not be identified' };
  }
  if (process.platform === 'win32') {
    const script = [
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}"`,
      'if ($p) { [pscustomobject]@{ pid = $p.ProcessId; commandLine = $p.CommandLine; executablePath = $p.ExecutablePath } | ConvertTo-Json -Compress }',
    ].join('; ');
    const result = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script]);
    if (result.ok && result.stdout.trim()) {
      return JSON.parse(result.stdout);
    }
    return { pid, commandLine: '' };
  }

  const result = await execFileAsync('ps', ['-p', String(pid), '-o', 'pid=', '-o', 'command=']);
  const commandLine = result.stdout.replace(/^\s*\d+\s*/, '').trim();
  return { pid, commandLine };
}

export async function getPortOwners(port) {
  const pids = await getPortOwnerPids(port);
  if (pids.length === 0 && await isPortListening(port)) {
    return [await getProcessInfo(null)];
  }
  return Promise.all(pids.map((pid) => getProcessInfo(pid)));
}

async function waitForExit(child, timeoutMs) {
  const timeout = new Promise((resolvePromise) => {
    setTimeout(() => resolvePromise('timeout'), timeoutMs);
  });
  const exit = once(child, 'exit').then(() => 'exit').catch(() => 'exit');
  return Promise.race([exit, timeout]);
}

export async function stopPid(pid, timeoutMs = 3000) {
  if (!pid) return { pid, stopped: false, reason: 'missing-pid' };
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (error.code === 'ESRCH') return { pid, stopped: true, alreadyExited: true };
    return { pid, stopped: false, reason: error.message };
  }

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      process.kill(pid, 0);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    } catch {
      return { pid, stopped: true };
    }
  }

  try {
    process.kill(pid, 'SIGKILL');
    return { pid, stopped: true, forced: true };
  } catch (error) {
    return { pid, stopped: error.code === 'ESRCH', reason: error.message };
  }
}

export async function ensurePortAvailable({ port, role, repoRoot }) {
  const owners = await getPortOwners(port);
  if (owners.length === 0) {
    return { port, role, status: 'free', stopped: [], blocked: [] };
  }
  const classified = classifyPortOwners({ port, role, repoRoot, owners });
  if (classified.blocked.length > 0) {
    return {
      port,
      role,
      status: 'blocked',
      stopped: [],
      blocked: classified.blocked,
      error: {
        code: `PORT_${port}_OCCUPIED_BY_UNKNOWN`,
        message: `Port ${port} is occupied by a process that cannot be confirmed as this project's ${role}. Run npm run stop-all to clean project-owned processes, then inspect the remaining process manually.`,
      },
    };
  }
  const stopped = [];
  for (const owner of classified.safeToStop) {
    stopped.push(await stopPid(owner.pid));
  }
  return { port, role, status: 'stopped-owned', stopped, blocked: [] };
}

function spawnTracked(command, args, { cwd, env, name }) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env, [OWNERSHIP_ENV]: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.output = { stdout: '', stderr: '' };
  child.once('error', (error) => {
    child.spawnError = error;
    child.output.stderr = tailText(`${child.output.stderr}\n${error?.message ?? String(error)}`);
  });
  child.stdout?.on('data', (chunk) => {
    child.output.stdout = tailText(child.output.stdout + chunk.toString());
  });
  child.stderr?.on('data', (chunk) => {
    child.output.stderr = tailText(child.output.stderr + chunk.toString());
  });
  return { name, pid: child.pid, command, args, child };
}

function needsCmdWrapper(command) {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
}

function commandForSpawn(command, args) {
  if (!needsCmdWrapper(command)) {
    return { command, args };
  }
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', command, ...args],
  };
}

function tailText(text, max = 4000) {
  return String(text ?? '').slice(-max);
}

export async function waitForUrl(
  url,
  timeoutMs = 30000,
  { fetchFn = fetch, retryDelayMs = 500 } = {},
) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetchFn(url, { method: 'GET' });
      if (response.ok) {
        return { ok: true, status: response.status, elapsedMs: Date.now() - started };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, retryDelayMs));
  }
  return { ok: false, error: lastError || 'timeout', elapsedMs: Date.now() - started };
}

export async function startReferenceBridge({
  repoRoot = moduleRepoRoot,
  port = REFERENCE_BRIDGE_PORT,
  healthTimeoutMs = 15000,
  getOwners = getPortOwners,
  spawnBridge,
  waitForHealth = (url, timeoutMs) => waitForUrl(url, timeoutMs),
  stopProcess = stopPid,
} = {}) {
  const root = resolve(repoRoot);
  const healthUrl = `http://127.0.0.1:${port}/health`;
  const owners = await getOwners(port);

  if (owners.length > 0) {
    const classified = classifyPortOwners({
      port,
      role: 'reference-bridge',
      repoRoot: root,
      owners,
    });
    if (classified.blocked.length > 0) {
      return {
        status: 'blocked',
        bridgeReady: false,
        startedByCall: false,
        process: null,
        owners,
        blocked: classified.blocked,
        error: {
          code: `PORT_${port}_OCCUPIED_BY_UNKNOWN`,
          message: `Port ${port} is occupied by a process that cannot be confirmed as this project's reference bridge.`,
        },
      };
    }

    const health = await waitForHealth(healthUrl, Math.min(healthTimeoutMs, 5000));
    if (health.ok) {
      const verifiedOwners = await getOwners(port);
      const verified = classifyPortOwners({
        port,
        role: 'reference-bridge',
        repoRoot: root,
        owners: verifiedOwners,
      });
      if (verified.blocked.length > 0 || verified.safeToStop.length === 0) {
        return {
          status: 'ownership-lost',
          bridgeReady: false,
          startedByCall: false,
          process: null,
          owners: verifiedOwners,
          blocked: verified.blocked,
          health,
          error: {
            code: 'REFERENCE_BRIDGE_OWNERSHIP_LOST',
            message: 'Reference bridge ownership changed while health was being checked.',
          },
        };
      }
    }
    return {
      status: health.ok ? 'reused-ready' : 'reused-unhealthy',
      bridgeReady: health.ok === true,
      startedByCall: false,
      process: null,
      owners,
      blocked: [],
      health,
    };
  }

  const launch = createReferenceBridgeLaunchCommand({ repoRoot: root, port });
  const processInfo = spawnBridge
    ? spawnBridge(launch)
    : spawnTracked(launch.command, launch.args, {
      cwd: root,
      name: 'reference-bridge',
    });
  const health = await waitForHealth(healthUrl, healthTimeoutMs);
  if (!health.ok) {
    const cleanup = await stopProcess(processInfo.pid);
    return {
      status: 'spawned-unhealthy',
      bridgeReady: false,
      startedByCall: true,
      process: processInfo,
      health,
      cleanup,
      cleanedUp: cleanup.stopped === true,
    };
  }

  const verifiedOwners = await getOwners(port);
  const verified = classifyPortOwners({
    port,
    role: 'reference-bridge',
    repoRoot: root,
    owners: verifiedOwners,
  });
  const spawnedPidIsOwner = verified.safeToStop.some(
    (owner) => Number(owner.pid) === Number(processInfo.pid),
  );
  if (verified.blocked.length > 0 || !spawnedPidIsOwner) {
    const cleanup = await stopProcess(processInfo.pid);
    return {
      status: 'spawned-ownership-lost',
      bridgeReady: false,
      startedByCall: true,
      process: processInfo,
      owners: verifiedOwners,
      blocked: verified.blocked,
      health,
      cleanup,
      cleanedUp: cleanup.stopped === true,
      error: {
        code: 'REFERENCE_BRIDGE_OWNERSHIP_LOST',
        message: 'The healthy listener could not be bound to the bridge process started by this call.',
      },
    };
  }

  return {
    status: 'spawned-ready',
    bridgeReady: true,
    startedByCall: true,
    process: processInfo,
    health,
    cleanedUp: false,
  };
}

export async function stopReferenceBridge(
  bridge,
  { stopProcess = stopPid } = {},
) {
  if (!bridge?.startedByCall) {
    return { stopped: false, reason: 'not-started-by-call' };
  }
  if (bridge.cleanedUp) {
    return { stopped: true, reason: 'already-cleaned' };
  }
  const result = await stopProcess(bridge.process?.pid);
  bridge.cleanedUp = result.stopped === true;
  return result;
}

export async function prepareHostAgentEndpoint({
  repoRoot = moduleRepoRoot,
  env = process.env,
  startBridge = startReferenceBridge,
} = {}) {
  const callerEnv = { ...env };
  const configuredUrl = String(callerEnv.LIFE_INDEX_HOST_AGENT_URL ?? '').trim();
  if (configuredUrl) {
    return {
      env: callerEnv,
      referenceBridge: {
        status: 'external-configured',
        bridgeReady: false,
        startedByCall: false,
        process: null,
        configuredUrl,
      },
      hostEndpointConfigured: true,
    };
  }

  let referenceBridge;
  try {
    referenceBridge = await startBridge({ repoRoot: resolve(repoRoot) });
  } catch (error) {
    referenceBridge = {
      status: 'unavailable',
      bridgeReady: false,
      startedByCall: false,
      process: null,
      error: {
        code: 'REFERENCE_BRIDGE_START_FAILED',
        message: error?.message ?? String(error),
      },
    };
  }

  return {
    env: callerEnv,
    referenceBridge,
    hostEndpointConfigured: isTrustedReferenceBridge(referenceBridge),
  };
}

export async function queryStructuredHostAgentHealth({
  backendPort = DEFAULT_BACKEND_PORT,
  fetchFn = fetch,
} = {}) {
  try {
    const response = await fetchFn(
      `http://127.0.0.1:${backendPort}/api/host-agent/health`,
      { method: 'GET' },
    );
    if (!response.ok) {
      return { ok: false, health: null, error: `HTTP ${response.status}` };
    }
    const envelope = await response.json();
    const health = envelope?.data;
    if (!health || typeof health !== 'object' || Array.isArray(health)) {
      return { ok: false, health: null, error: 'host-agent health envelope missing data object' };
    }
    return { ok: true, health };
  } catch (error) {
    return { ok: false, health: null, error: error?.message ?? String(error) };
  }
}

export function projectReadinessFacts({
  guiReady = false,
  bridgeReady = false,
  hostEndpointConfigured,
  hostHealth = null,
} = {}) {
  const endpointConfigured = hostEndpointConfigured === undefined
    ? bridgeReady === true
    : hostEndpointConfigured === true;
  const strictHostReady = endpointConfigured
    && hostHealth?.running === true
    && hostHealth?.ready === true
    && hostHealth?.degraded === false;
  return {
    guiReady: guiReady === true,
    referenceBridgeReady: bridgeReady === true,
    externalHostReady: strictHostReady,
    aiPlusReady: guiReady === true && strictHostReady,
  };
}

async function runCommand(command, args, options = {}) {
  const spawnTarget = commandForSpawn(command, args);
  const child = spawn(spawnTarget.command, spawnTarget.args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout = tailText(stdout + chunk.toString());
  });
  child.stderr?.on('data', (chunk) => {
    stderr = tailText(stderr + chunk.toString());
  });
  const [code, signal] = await once(child, 'exit');
  return { ok: code === 0, code, signal, stdout, stderr };
}

export async function runVerifyStack({
  repoRoot = moduleRepoRoot,
  backendPort = DEFAULT_BACKEND_PORT,
  frontendPort = DEFAULT_FRONTEND_PORT,
  healthTimeoutMs = 60000,
} = {}) {
  const root = resolve(repoRoot);
  const startedAt = new Date().toISOString();
  const result = {
    ok: false,
    startedAt,
    repoRoot: root,
    ports: [],
    steps: [],
    warnings: [],
    processes: [],
    cleanup: [],
    noOrphans: false,
  };
  const launched = [];
  let referenceBridge = null;
  let hostEndpointConfigured = false;
  let hostHealth = null;
  let guiReady = false;
  const ports = [
    { port: backendPort, role: 'backend' },
    { port: frontendPort, role: 'frontend' },
  ];

  try {
    const worktreeStatus = await preflightWorktreeStatus({ repoRoot: root });
    result.steps.push({ name: 'worktree-status', ...worktreeStatus });
    if (worktreeStatus.warning) {
      result.warnings.push(worktreeStatus.warning);
    }

    const preflight = preflightVerifyStackDevDependencies({ repoRoot: root });
    result.steps.push({ name: 'dev-dependencies', ...preflight });
    if (!preflight.ok) {
      result.error = preflight.error;
      return result;
    }

    const launch = createLaunchCommands({ repoRoot: root, backendPort, frontendPort });
    const pythonPreflight = await preflightBackendPythonVersion({ pythonCommand: launch.backend.command });
    result.steps.push({ name: 'backend-python', ...pythonPreflight });
    if (!pythonPreflight.ok) {
      result.error = pythonPreflight.error;
      return result;
    }

    for (const item of ports) {
      const check = await ensurePortAvailable({ ...item, repoRoot: root });
      result.ports.push(check);
      if (check.status === 'blocked') {
        result.error = check.error;
        return result;
      }
    }

    const hostEndpoint = await prepareHostAgentEndpoint({
      repoRoot: root,
      env: process.env,
    });
    referenceBridge = hostEndpoint.referenceBridge;
    hostEndpointConfigured = hostEndpoint.hostEndpointConfigured;
    result.steps.push({ name: 'reference-bridge', ...referenceBridge, process: undefined });
    if (!referenceBridge.bridgeReady && referenceBridge.error) {
      result.warnings.push(referenceBridge.error);
    }

    const backend = spawnTracked(launch.backend.command, launch.backend.args, {
      cwd: root,
      env: createBackendChildEnv(hostEndpoint.env, referenceBridge),
      name: 'backend',
    });
    launched.push(backend);
    result.processes.push({ name: backend.name, pid: backend.pid, command: backend.command, args: backend.args });

    const health = await waitForUrl(`http://127.0.0.1:${backendPort}/api/health`, healthTimeoutMs);
    result.steps.push({ name: 'backend-health', ...health });
    if (!health.ok) {
      result.error = { code: 'BACKEND_HEALTH_TIMEOUT', message: health.error };
      return result;
    }

    const hostAgentHealth = await queryStructuredHostAgentHealth({ backendPort });
    hostHealth = hostAgentHealth.health;
    result.steps.push({ name: 'host-agent-health', ...hostAgentHealth });

    const build = await runCommand(commandName('npm'), ['run', 'build'], { cwd: root });
    result.steps.push({ name: 'frontend-build', ...build });
    if (!build.ok) {
      result.error = { code: 'FRONTEND_BUILD_FAILED', message: build.stderr || build.stdout };
      return result;
    }

    if (!existsSync(join(root, 'dist', 'index.html'))) {
      result.error = { code: 'FRONTEND_DIST_MISSING', message: 'dist/index.html was not produced by npm run build.' };
      return result;
    }

    const frontend = spawnTracked(launch.frontend.command, launch.frontend.args, {
      cwd: root,
      name: 'frontend-preview',
    });
    launched.push(frontend);
    result.processes.push({ name: frontend.name, pid: frontend.pid, command: frontend.command, args: frontend.args });
    const preview = await waitForUrl(`http://127.0.0.1:${frontendPort}/`, 30000);
    result.steps.push({ name: 'frontend-preview', ...preview });
    if (!preview.ok) {
      result.error = { code: 'FRONTEND_PREVIEW_TIMEOUT', message: preview.error };
      return result;
    }

    guiReady = true;
    result.readiness = projectReadinessFacts({
      guiReady,
      bridgeReady: referenceBridge.bridgeReady,
      hostEndpointConfigured,
      hostHealth,
    });
    result.ok = true;
    return result;
  } catch (error) {
    result.error = {
      code: 'VERIFY_STACK_EXCEPTION',
      message: error?.message ?? String(error),
    };
    return result;
  } finally {
    for (const proc of launched.reverse()) {
      const stopped = await stopPid(proc.pid);
      result.cleanup.push({ name: proc.name, ...stopped });
      if (proc.child && !proc.child.killed) {
        await waitForExit(proc.child, 500);
      }
    }

    let referenceBridgeCleanup = { stopped: true, reason: 'not-acquired' };
    if (referenceBridge) {
      referenceBridgeCleanup = await stopReferenceBridge(referenceBridge);
      result.cleanup.push({
        name: 'reference-bridge',
        ...referenceBridgeCleanup,
      });
    }

    const remaining = [];
    for (const item of ports) {
      const owners = await getPortOwners(item.port);
      const classified = classifyPortOwners({ ...item, repoRoot: root, owners });
      for (const owner of classified.safeToStop) {
        result.cleanup.push({ name: `${item.role}-residual`, ...(await stopPid(owner.pid)) });
      }
      remaining.push(...classified.safeToStop);
    }
    const referenceBridgeClean = !referenceBridge?.startedByCall
      || referenceBridgeCleanup.stopped === true;
    result.noOrphans = remaining.length === 0 && referenceBridgeClean;
    result.readiness = projectReadinessFacts({
      guiReady,
      bridgeReady: referenceBridge?.bridgeReady === true,
      hostEndpointConfigured,
      hostHealth,
    });
    result.finishedAt = new Date().toISOString();
  }
}

export async function stopAllProjectProcesses({
  repoRoot = moduleRepoRoot,
  backendPort = DEFAULT_BACKEND_PORT,
  frontendPort = DEFAULT_FRONTEND_PORT,
  referenceBridgePort = REFERENCE_BRIDGE_PORT,
  getOwners = getPortOwners,
  stopProcess = stopPid,
} = {}) {
  const root = resolve(repoRoot);
  const result = {
    ok: true,
    repoRoot: root,
    ports: [],
    stopped: [],
    blocked: [],
  };
  for (const item of [
    { port: backendPort, role: 'backend' },
    { port: frontendPort, role: 'frontend' },
    { port: referenceBridgePort, role: 'reference-bridge' },
  ]) {
    const owners = await getOwners(item.port);
    const classified = classifyPortOwners({ ...item, repoRoot: root, owners });
    result.blocked.push(...classified.blocked.map((owner) => ({ ...item, ...owner })));
    const stopResults = [];
    for (const owner of classified.safeToStop) {
      const stopResult = { ...item, ...(await stopProcess(owner.pid)) };
      stopResults.push(stopResult);
      result.stopped.push(stopResult);
    }
    result.ports.push({
      ...item,
      owners: owners.length,
      stopped: stopResults.filter((entry) => entry.stopped === true).length,
      blocked: classified.blocked.length,
    });
  }
  result.stopFailures = result.stopped.filter((entry) => entry.stopped !== true);
  if (result.blocked.length > 0) {
    result.ok = false;
    result.error = {
      code: 'UNKNOWN_PORT_OWNERS_PRESENT',
      message: 'Some port owners could not be confirmed as Life Index GUI processes; no unknown process was killed.',
    };
  }
  if (result.stopFailures.length > 0) {
    result.ok = false;
    if (!result.error) {
      result.error = {
        code: 'PROJECT_PROCESS_STOP_FAILED',
        message: 'One or more project-owned processes could not be stopped.',
      };
    }
  }
  return result;
}
