import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolvePythonCommand } from './python-interpreter.mjs';

export const DEFAULT_BACKEND_PORT = 8000;
export const DEFAULT_FRONTEND_PORT = 5173;
const OWNERSHIP_ENV = 'LIFE_INDEX_GUI_AGENT_OPS';
const moduleRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function commandName(name) {
  return process.platform === 'win32' && !name.endsWith('.cmd') ? `${name}.cmd` : name;
}

function normalizeText(value) {
  return String(value ?? '').replace(/\\/g, '/').toLowerCase();
}

function uniqueNumbers(values) {
  return [...new Set(values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}

function hasRepoRoot(commandLine, repoRoot) {
  return normalizeText(commandLine).includes(normalizeText(repoRoot));
}

function hasPort(commandLine, port) {
  const text = String(commandLine ?? '');
  return new RegExp(`(?:--port\\s+|:${port}\\b|\\b)${port}\\b`).test(text);
}

function isProjectOwnedProcess(processInfo, { repoRoot, role, port }) {
  const commandLine = processInfo?.commandLine ?? '';
  const text = normalizeText(commandLine);
  if (!hasRepoRoot(commandLine, repoRoot) || !hasPort(commandLine, port)) {
    return false;
  }
  if (role === 'backend') {
    return text.includes('uvicorn') && text.includes('backend.main:app');
  }
  if (role === 'frontend') {
    return text.includes('vite') && (text.includes('vite.config.ts') || text.includes('/node_modules/vite/'));
  }
  return false;
}

export function classifyPortOwners({ port, role, repoRoot, owners }) {
  const safeToStop = [];
  const blocked = [];
  for (const owner of owners) {
    if (isProjectOwnedProcess(owner, { repoRoot, role, port })) {
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

export function preflightVerifyStackDevDependencies({
  repoRoot = moduleRepoRoot,
  required = ['vite'],
} = {}) {
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
        message: `Missing required dev dependency: ${missing.join(', ')}. Run npm ci --include=dev before npm run verify-stack. If critical dev dependencies are still missing after npm ci, fallback: pnpm install && pnpm run build (install pnpm first with npm i -g pnpm).`,
      },
    };
  }

  return { ok: true, missing: [] };
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

export async function waitForUrl(url, timeoutMs = 30000) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return { ok: true, status: response.status, elapsedMs: Date.now() - started };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  return { ok: false, error: lastError || 'timeout', elapsedMs: Date.now() - started };
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

    for (const item of ports) {
      const check = await ensurePortAvailable({ ...item, repoRoot: root });
      result.ports.push(check);
      if (check.status === 'blocked') {
        result.error = check.error;
        return result;
      }
    }

    const launch = createLaunchCommands({ repoRoot: root, backendPort, frontendPort });
    const backend = spawnTracked(launch.backend.command, launch.backend.args, {
      cwd: root,
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

    const remaining = [];
    for (const item of ports) {
      const owners = await getPortOwners(item.port);
      const classified = classifyPortOwners({ ...item, repoRoot: root, owners });
      for (const owner of classified.safeToStop) {
        result.cleanup.push({ name: `${item.role}-residual`, ...(await stopPid(owner.pid)) });
      }
      remaining.push(...classified.safeToStop);
    }
    result.noOrphans = remaining.length === 0;
    result.finishedAt = new Date().toISOString();
  }
}

export async function stopAllProjectProcesses({
  repoRoot = moduleRepoRoot,
  backendPort = DEFAULT_BACKEND_PORT,
  frontendPort = DEFAULT_FRONTEND_PORT,
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
  ]) {
    const owners = await getPortOwners(item.port);
    const classified = classifyPortOwners({ ...item, repoRoot: root, owners });
    result.blocked.push(...classified.blocked.map((owner) => ({ ...item, ...owner })));
    for (const owner of classified.safeToStop) {
      result.stopped.push({ ...item, ...(await stopPid(owner.pid)) });
    }
    result.ports.push({ ...item, owners: owners.length, stopped: classified.safeToStop.length, blocked: classified.blocked.length });
  }
  if (result.blocked.length > 0) {
    result.ok = false;
    result.error = {
      code: 'UNKNOWN_PORT_OWNERS_PRESENT',
      message: 'Some port owners could not be confirmed as Life Index GUI processes; no unknown process was killed.',
    };
  }
  return result;
}
