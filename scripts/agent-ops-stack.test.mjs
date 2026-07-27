import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyPortOwners,
  createBackendChildEnv,
  createLaunchCommands,
  createReferenceBridgeLaunchCommand,
  parseSsPids,
  parseWindowsTcpPids,
  prepareHostAgentEndpoint,
  preflightBackendPythonVersion,
  preflightWorktreeStatus,
  preflightVerifyStackDevDependencies,
  projectReadinessFacts,
  REFERENCE_BRIDGE_URL,
  startReferenceBridge,
  stopAllProjectProcesses,
  stopReferenceBridge,
  waitForUrl,
} from './lib/agent-ops-stack.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const verifyStackScript = join(resolve(__dirname, '..'), 'scripts', 'verify-stack.mjs');
const devBackendScript = join(resolve(__dirname, '..'), 'scripts', 'dev-backend.mjs');
const agentOpsStackModule = join(resolve(__dirname, '..'), 'scripts', 'lib', 'agent-ops-stack.mjs');

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const repoRoot = process.platform === 'win32'
  ? 'D:\\Work\\life-index-gui-public'
  : '/home/me/life-index-gui-public';

const safeBackend = {
  pid: 101,
  commandLine: process.platform === 'win32'
    ? 'python -m uvicorn backend.main:app --app-dir D:\\Work\\life-index-gui-public --host 127.0.0.1 --port 8000'
    : 'python -m uvicorn backend.main:app --app-dir /home/me/life-index-gui-public --host 127.0.0.1 --port 8000',
};

const safeFrontend = {
  pid: 202,
  commandLine: process.platform === 'win32'
    ? 'node .\\node_modules\\vite\\bin\\vite.js preview --host 127.0.0.1 --port 5173 --config D:\\Work\\life-index-gui-public\\vite.config.ts'
    : 'node ./node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5173 --config /home/me/life-index-gui-public/vite.config.ts',
};

const repoNodeForeignFrontend = {
  pid: 203,
  commandLine: process.platform === 'win32'
    ? '"D:\\Work\\life-index-gui-public\\node.exe" .\\node_modules\\vite\\bin\\vite.js preview --host 127.0.0.1 --port 5173 --config D:\\Other\\vite.config.ts'
    : '/home/me/life-index-gui-public/node ./node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5173 --config /other/vite.config.ts',
};

const unknownBackend = {
  pid: 303,
  commandLine: 'python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000',
};

const safeReferenceBridge = {
  pid: 404,
  commandLine: process.platform === 'win32'
    ? 'python -m uvicorn host_agent_bridge.server:app --app-dir D:\\Work\\life-index-gui-public --host 127.0.0.1 --port 8791'
    : 'python -m uvicorn host_agent_bridge.server:app --app-dir /home/me/life-index-gui-public --host 127.0.0.1 --port 8791',
};

const foreignReferenceBridge = {
  pid: 505,
  commandLine: 'python -m uvicorn host_agent_bridge.server:app --host 127.0.0.1 --port 8791',
};

const siblingReferenceBridge = {
  pid: 506,
  commandLine: process.platform === 'win32'
    ? 'python -m uvicorn host_agent_bridge.server:app --app-dir D:\\Work\\life-index-gui-public-copy --host 127.0.0.1 --port 8791'
    : 'python -m uvicorn host_agent_bridge.server:app --app-dir /home/me/life-index-gui-public-copy --host 127.0.0.1 --port 8791',
};

const repoInterpreterForeignBridge = {
  pid: 507,
  commandLine: process.platform === 'win32'
    ? '"D:\\Work\\life-index-gui-public\\.venv\\Scripts\\python.exe" -m uvicorn host_agent_bridge.server:app --app-dir D:\\Other\\foreign --host 127.0.0.1 --port 8791'
    : '/home/me/life-index-gui-public/.venv/bin/python -m uvicorn host_agent_bridge.server:app --app-dir /other/foreign --host 127.0.0.1 --port 8791',
};

const duplicateAppDirBridge = {
  pid: 508,
  commandLine: process.platform === 'win32'
    ? 'python -m uvicorn host_agent_bridge.server:app --app-dir D:\\Work\\life-index-gui-public --app-dir D:\\Other\\foreign --host 127.0.0.1 --port 8791'
    : 'python -m uvicorn host_agent_bridge.server:app --app-dir /home/me/life-index-gui-public --app-dir /other/foreign --host 127.0.0.1 --port 8791',
};

const posixCaseVariantBridge = {
  pid: 509,
  commandLine: 'python -m uvicorn host_agent_bridge.server:app --app-dir /home/me/LIFE-INDEX-GUI-PUBLIC --host 127.0.0.1 --port 8791',
};

const posixBackslashVariantBridge = {
  pid: 510,
  commandLine: 'python -m uvicorn host_agent_bridge.server:app --app-dir /home/me\\life-index-gui-public --host 127.0.0.1 --port 8791',
};

assert.deepEqual(
  classifyPortOwners({
    port: 8000,
    role: 'backend',
    repoRoot,
    owners: [safeBackend],
  }),
  { safeToStop: [safeBackend], blocked: [] },
  'backend process with repo-root app-dir is project-owned',
);

assert.deepEqual(
  classifyPortOwners({
    port: 8791,
    role: 'reference-bridge',
    repoRoot,
    owners: [safeReferenceBridge],
  }),
  { safeToStop: [safeReferenceBridge], blocked: [] },
  'only the repo-root reference bridge command is project-owned',
);

assert.deepEqual(
  classifyPortOwners({
    port: 8791,
    role: 'reference-bridge',
    repoRoot,
    owners: [foreignReferenceBridge],
  }),
  { safeToStop: [], blocked: [foreignReferenceBridge] },
  'a matching bridge module without repo-root authority is foreign',
);

assert.deepEqual(
  classifyPortOwners({
    port: 8791,
    role: 'reference-bridge',
    repoRoot,
    owners: [siblingReferenceBridge],
  }),
  { safeToStop: [], blocked: [siblingReferenceBridge] },
  'a sibling checkout whose path only starts with repoRoot is foreign',
);

assert.deepEqual(
  classifyPortOwners({
    port: 8791,
    role: 'reference-bridge',
    repoRoot,
    owners: [repoInterpreterForeignBridge],
  }),
  { safeToStop: [], blocked: [repoInterpreterForeignBridge] },
  'an interpreter under repoRoot cannot substitute for exact --app-dir ownership',
);

assert.deepEqual(
  classifyPortOwners({
    port: 8791,
    role: 'reference-bridge',
    repoRoot,
    owners: [duplicateAppDirBridge],
  }),
  { safeToStop: [], blocked: [duplicateAppDirBridge] },
  'duplicate ownership options fail closed instead of trusting an overridden value',
);

assert.deepEqual(
  classifyPortOwners({
    port: 8791,
    role: 'reference-bridge',
    repoRoot: '/home/me/life-index-gui-public',
    owners: [posixCaseVariantBridge],
    platform: 'linux',
  }),
  { safeToStop: [], blocked: [posixCaseVariantBridge] },
  'POSIX ownership paths remain case-sensitive even when tested on Windows',
);

assert.deepEqual(
  classifyPortOwners({
    port: 8791,
    role: 'reference-bridge',
    repoRoot: '/home/me/life-index-gui-public',
    owners: [posixBackslashVariantBridge],
    platform: 'linux',
  }),
  { safeToStop: [], blocked: [posixBackslashVariantBridge] },
  'POSIX keeps backslash as a literal path character instead of a separator',
);

assert.deepEqual(
  classifyPortOwners({
    port: 5173,
    role: 'frontend',
    repoRoot,
    owners: [safeFrontend],
  }),
  { safeToStop: [safeFrontend], blocked: [] },
  'vite preview process with repo-root config is project-owned',
);

assert.deepEqual(
  classifyPortOwners({
    port: 5173,
    role: 'frontend',
    repoRoot,
    owners: [repoNodeForeignFrontend],
  }),
  { safeToStop: [], blocked: [repoNodeForeignFrontend] },
  'a repo-local runtime cannot substitute for the exact Vite config ownership marker',
);

assert.deepEqual(
  classifyPortOwners({
    port: 8000,
    role: 'backend',
    repoRoot,
    owners: [unknownBackend],
  }),
  { safeToStop: [], blocked: [unknownBackend] },
  'uvicorn on the same port is not enough to prove ownership',
);

assert.deepEqual(parseWindowsTcpPids('8000,101\r\n8000,101\r\n5173,202\r\n'), [101, 202]);
assert.deepEqual(parseSsPids('LISTEN 0 511 127.0.0.1:8000 0.0.0.0:* users:(("python",pid=101,fd=3))\n'), [101]);

{
  const bridgePort = 48002;
  const ownedBridge = {
    pid: 707,
    commandLine: process.platform === 'win32'
      ? `python -m uvicorn host_agent_bridge.server:app --app-dir D:\\Work\\life-index-gui-public --host 127.0.0.1 --port ${bridgePort}`
      : `python -m uvicorn host_agent_bridge.server:app --app-dir /home/me/life-index-gui-public --host 127.0.0.1 --port ${bridgePort}`,
  };
  const unknownBridge = {
    pid: 808,
    commandLine: `python -m uvicorn host_agent_bridge.server:app --host 127.0.0.1 --port ${bridgePort}`,
  };
  const stoppedPids = [];
  const result = await stopAllProjectProcesses({
    repoRoot,
    backendPort: 48000,
    frontendPort: 48001,
    referenceBridgePort: bridgePort,
    getOwners: async (port) => (port === bridgePort ? [ownedBridge, unknownBridge] : []),
    stopProcess: async (pid) => {
      stoppedPids.push(pid);
      return { pid, stopped: true };
    },
  });

  assert.deepEqual(stoppedPids, [707], 'stop-all terminates only the project-owned bridge');
  assert.equal(result.ok, false, 'an unknown bridge owner remains a visible stop-all failure');
  assert.deepEqual(result.blocked.map((owner) => owner.pid), [808]);
  assert.ok(
    result.ports.some((item) => item.role === 'reference-bridge' && item.port === bridgePort),
    'stop-all inventories the reference bridge port',
  );
}

{
  const stopFailure = await stopAllProjectProcesses({
    repoRoot,
    backendPort: 48010,
    frontendPort: 48011,
    referenceBridgePort: 48012,
    getOwners: async (port) => (port === 48012
      ? [{
        pid: 909,
        commandLine: process.platform === 'win32'
          ? 'python -m uvicorn host_agent_bridge.server:app --app-dir D:\\Work\\life-index-gui-public --host 127.0.0.1 --port 48012'
          : 'python -m uvicorn host_agent_bridge.server:app --app-dir /home/me/life-index-gui-public --host 127.0.0.1 --port 48012',
      }]
      : []),
    stopProcess: async (pid) => ({ pid, stopped: false, reason: 'access-denied' }),
  });
  assert.equal(stopFailure.ok, false, 'stop-all cannot report success when an owned process remains');
  assert.equal(stopFailure.error.code, 'PROJECT_PROCESS_STOP_FAILED');
  assert.deepEqual(stopFailure.stopFailures.map((failure) => failure.pid), [909]);
}

const launch = createLaunchCommands({ repoRoot, backendPort: 8000, frontendPort: 5173 });
assert.ok(launch.backend.args.includes('--app-dir'));
assert.ok(launch.backend.args.includes(repoRoot));
assert.equal(
  createLaunchCommands({
    repoRoot,
    backendPort: 8000,
    frontendPort: 5173,
    pythonCommand: 'python-from-resolver',
  }).backend.command,
  'python-from-resolver',
  'verify-stack backend launch command must accept the shared python resolver output',
);
assert.ok(launch.frontend.args.includes('--config'));
assert.ok(launch.frontend.args.some((arg) => arg.endsWith('vite.config.ts')));

const referenceLaunch = createReferenceBridgeLaunchCommand({ repoRoot, pythonCommand: 'python-bridge' });
assert.equal(referenceLaunch.command, 'python-bridge');
assert.deepEqual(referenceLaunch.args.slice(0, 3), ['-m', 'uvicorn', 'host_agent_bridge.server:app']);
assert.ok(referenceLaunch.args.includes('--app-dir'));
assert.ok(referenceLaunch.args.includes(repoRoot));
assert.ok(referenceLaunch.args.includes('8791'));

{
  const callerEnv = {
    KEEP_ME: 'yes',
    LIFE_INDEX_HOST_AGENT_ARGV_JSON: '["runtime","--json"]',
    LIFE_INDEX_HOST_AGENT_URL: 'http://caller.example',
  };
  const childEnv = createBackendChildEnv(callerEnv);
  assert.deepEqual(childEnv, callerEnv, 'an explicitly configured Host bridge URL is preserved');
  assert.notEqual(childEnv, callerEnv);
  assert.equal(callerEnv.LIFE_INDEX_HOST_AGENT_URL, 'http://caller.example');

  const offlineEnv = createBackendChildEnv({ KEEP_ME: 'yes' }, {
    status: 'blocked',
    bridgeReady: false,
  });
  assert.deepEqual(
    offlineEnv,
    { KEEP_ME: 'yes' },
    'an unavailable or untrusted default bridge is not injected into the backend',
  );

  const bundledEnv = createBackendChildEnv({ KEEP_ME: 'yes' }, {
    status: 'spawned-ready',
    bridgeReady: true,
  });
  assert.deepEqual(bundledEnv, {
    KEEP_ME: 'yes',
    LIFE_INDEX_HOST_AGENT_URL: REFERENCE_BRIDGE_URL,
  });

  const untrustedReadyEnv = createBackendChildEnv({}, {
    status: 'blocked',
    bridgeReady: true,
  });
  assert.equal(
    Object.hasOwn(untrustedReadyEnv, 'LIFE_INDEX_HOST_AGENT_URL'),
    false,
    'bridgeReady without an owned ready status cannot authorize default URL injection',
  );
}

{
  let customStarts = 0;
  const custom = await prepareHostAgentEndpoint({
    repoRoot,
    env: {
      KEEP_ME: 'yes',
      LIFE_INDEX_HOST_AGENT_URL: 'http://caller.example',
    },
    startBridge: async () => {
      customStarts += 1;
      return { status: 'spawned-ready', bridgeReady: true };
    },
  });
  assert.equal(customStarts, 0, 'an explicit Host bridge URL skips bundled bridge startup');
  assert.equal(custom.referenceBridge.status, 'external-configured');
  assert.equal(custom.hostEndpointConfigured, true);
  assert.equal(
    createBackendChildEnv(custom.env, custom.referenceBridge).LIFE_INDEX_HOST_AGENT_URL,
    'http://caller.example',
  );

  const blocked = await prepareHostAgentEndpoint({
    repoRoot,
    env: { KEEP_ME: 'yes' },
    startBridge: async () => ({
      status: 'blocked',
      bridgeReady: false,
      startedByCall: false,
      error: { code: 'PORT_8791_OCCUPIED_BY_UNKNOWN' },
    }),
  });
  assert.equal(blocked.hostEndpointConfigured, false);
  assert.equal(
    Object.hasOwn(
      createBackendChildEnv(blocked.env, blocked.referenceBridge),
      'LIFE_INDEX_HOST_AGENT_URL',
    ),
    false,
    'an unknown default-port owner leaves the backend Host URL unconfigured',
  );

  const owned = await prepareHostAgentEndpoint({
    repoRoot,
    env: { KEEP_ME: 'yes' },
    startBridge: async () => ({
      status: 'reused-ready',
      bridgeReady: true,
      startedByCall: false,
    }),
  });
  assert.equal(owned.hostEndpointConfigured, true);
  assert.equal(
    createBackendChildEnv(owned.env, owned.referenceBridge).LIFE_INDEX_HOST_AGENT_URL,
    REFERENCE_BRIDGE_URL,
  );
}

{
  let attempts = 0;
  const health = await waitForUrl('http://127.0.0.1:8791/health', 100, {
    retryDelayMs: 0,
    fetchFn: async (_url, options) => {
      assert.equal(options.method, 'GET');
      attempts += 1;
      if (attempts === 1) {
        throw new Error('connection refused');
      }
      return { ok: true, status: 200 };
    },
  });
  assert.equal(health.ok, true);
  assert.equal(attempts, 2, 'new bridge health retries transient connection refusal');
}

{
  let spawned = 0;
  let stopped = 0;
  const reused = await startReferenceBridge({
    repoRoot,
    getOwners: async () => [safeReferenceBridge],
    spawnBridge: () => {
      spawned += 1;
      throw new Error('must not spawn');
    },
    stopProcess: async () => {
      stopped += 1;
      return { stopped: true };
    },
    waitForHealth: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(reused.status, 'reused-ready');
  assert.equal(reused.bridgeReady, true);
  assert.equal(reused.startedByCall, false);
  assert.equal(spawned, 0);
  await stopReferenceBridge(reused, { stopProcess: async () => {
    stopped += 1;
    return { stopped: true };
  } });
  assert.equal(stopped, 0, 'reused healthy project bridge is never stopped');
}

{
  let spawned = 0;
  let stopped = 0;
  let healthChecks = 0;
  const reused = await startReferenceBridge({
    repoRoot,
    getOwners: async () => [safeReferenceBridge],
    spawnBridge: () => {
      spawned += 1;
      throw new Error('must not spawn');
    },
    stopProcess: async () => {
      stopped += 1;
      return { stopped: true };
    },
    waitForHealth: async () => {
      healthChecks += 1;
      return { ok: false, error: 'HTTP 503' };
    },
  });
  assert.equal(reused.status, 'reused-unhealthy');
  assert.equal(reused.bridgeReady, false);
  assert.equal(reused.startedByCall, false);
  assert.equal(spawned, 0);
  assert.equal(stopped, 0);
  assert.equal(healthChecks, 1);
  assert.equal((await stopReferenceBridge(reused, { stopProcess: async () => {
    stopped += 1;
    return { stopped: true };
  } })).reason, 'not-started-by-call');
  assert.equal(stopped, 0, 'reused unhealthy project bridge is never stopped');
}

{
  let spawned = 0;
  let stopped = 0;
  let healthChecks = 0;
  const foreign = await startReferenceBridge({
    repoRoot,
    getOwners: async () => [foreignReferenceBridge],
    spawnBridge: () => {
      spawned += 1;
      throw new Error('must not spawn');
    },
    stopProcess: async () => {
      stopped += 1;
      return { stopped: true };
    },
    waitForHealth: async () => {
      healthChecks += 1;
      return { ok: true };
    },
  });
  assert.equal(foreign.status, 'blocked');
  assert.equal(foreign.bridgeReady, false);
  assert.equal(spawned, 0);
  assert.equal(stopped, 0);
  assert.equal(healthChecks, 0, 'foreign owners are blocked without probing their HTTP service');
}

{
  let ownerChecks = 0;
  let stopped = 0;
  const replaced = await startReferenceBridge({
    repoRoot,
    getOwners: async () => {
      ownerChecks += 1;
      return ownerChecks === 1 ? [safeReferenceBridge] : [foreignReferenceBridge];
    },
    spawnBridge: () => {
      throw new Error('must not spawn');
    },
    stopProcess: async () => {
      stopped += 1;
      return { stopped: true };
    },
    waitForHealth: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(replaced.status, 'ownership-lost');
  assert.equal(replaced.bridgeReady, false);
  assert.equal(replaced.startedByCall, false);
  assert.equal(ownerChecks, 2, 'reused listener ownership is revalidated after health');
  assert.equal(stopped, 0, 'a replacement listener is never stopped');
}

{
  let attempts = 0;
  let ownerChecks = 0;
  const stoppedPids = [];
  const spawnedReady = await startReferenceBridge({
    repoRoot,
    getOwners: async () => {
      ownerChecks += 1;
      return ownerChecks === 1
        ? []
        : [{ ...safeReferenceBridge, pid: 607 }];
    },
    spawnBridge: () => ({ pid: 607, child: { killed: false } }),
    waitForHealth: (url, timeoutMs) => waitForUrl(url, timeoutMs, {
      retryDelayMs: 0,
      fetchFn: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('connection refused');
        return { ok: true, status: 200 };
      },
    }),
    stopProcess: async (pid) => {
      stoppedPids.push(pid);
      return { pid, stopped: true };
    },
  });
  assert.equal(spawnedReady.status, 'spawned-ready');
  assert.equal(spawnedReady.bridgeReady, true);
  assert.equal(attempts, 2);
  assert.deepEqual(stoppedPids, []);
  await stopReferenceBridge(spawnedReady, {
    stopProcess: async (pid) => {
      stoppedPids.push(pid);
      return { pid, stopped: true };
    },
  });
  assert.deepEqual(stoppedPids, [607], 'only the same-call spawned bridge handle is stoppable');
}

{
  let ownerChecks = 0;
  const stoppedPids = [];
  const replaced = await startReferenceBridge({
    repoRoot,
    getOwners: async () => {
      ownerChecks += 1;
      return ownerChecks === 1 ? [] : [foreignReferenceBridge];
    },
    spawnBridge: () => ({ pid: 608, child: { killed: false } }),
    waitForHealth: async () => ({ ok: true, status: 200 }),
    stopProcess: async (pid) => {
      stoppedPids.push(pid);
      return { pid, stopped: true };
    },
  });
  assert.equal(replaced.status, 'spawned-ownership-lost');
  assert.equal(replaced.bridgeReady, false);
  assert.equal(replaced.startedByCall, true);
  assert.equal(ownerChecks, 2, 'spawned listener ownership is checked after health');
  assert.deepEqual(stoppedPids, [608], 'only the same-call spawned PID is cleaned after an ownership race');
}

{
  const fakeChild = { pid: 606, child: { killed: false } };
  const stoppedPids = [];
  const failedSpawn = await startReferenceBridge({
    repoRoot,
    getOwners: async () => [],
    spawnBridge: () => fakeChild,
    waitForHealth: async () => ({ ok: false, error: 'deadline' }),
    stopProcess: async (pid) => {
      stoppedPids.push(pid);
      return { pid, stopped: true };
    },
  });
  assert.equal(failedSpawn.status, 'spawned-unhealthy');
  assert.equal(failedSpawn.bridgeReady, false);
  assert.equal(failedSpawn.startedByCall, true);
  assert.deepEqual(stoppedPids, [606], 'spawned unhealthy bridge is cleaned at deadline');
  assert.equal(failedSpawn.cleanedUp, true);
}

{
  const strictReady = {
    running: true,
    ready: true,
    degraded: false,
  };
  assert.deepEqual(
    projectReadinessFacts({ guiReady: true, bridgeReady: true, hostHealth: strictReady }),
    {
      guiReady: true,
      referenceBridgeReady: true,
      externalHostReady: true,
      aiPlusReady: true,
    },
  );

  for (const hostHealth of [
    { ...strictReady, running: false },
    { ...strictReady, ready: false },
    { ...strictReady, degraded: true },
    { running: true, ready: true },
    { running: true, ready: true, degraded: null },
  ]) {
    const facts = projectReadinessFacts({ guiReady: true, bridgeReady: true, hostHealth });
    assert.equal(facts.externalHostReady, false);
    assert.equal(facts.aiPlusReady, false);
  }

  const bridgeOnly = projectReadinessFacts({
    guiReady: true,
    bridgeReady: true,
    hostHealth: null,
  });
  assert.equal(bridgeOnly.referenceBridgeReady, true);
  assert.equal(bridgeOnly.externalHostReady, false);
  assert.equal(bridgeOnly.aiPlusReady, false, 'bridge reachability alone never proves AI+');

  const hostWithoutGui = projectReadinessFacts({
    guiReady: false,
    bridgeReady: true,
    hostHealth: strictReady,
  });
  assert.equal(hostWithoutGui.externalHostReady, true);
  assert.equal(hostWithoutGui.aiPlusReady, false, 'AI+ also requires the GUI to be ready');

  const hostWithoutTrustedBridge = projectReadinessFacts({
    guiReady: true,
    bridgeReady: false,
    hostEndpointConfigured: false,
    hostHealth: strictReady,
  });
  assert.equal(hostWithoutTrustedBridge.externalHostReady, false);
  assert.equal(hostWithoutTrustedBridge.aiPlusReady, false);

  const customHost = projectReadinessFacts({
    guiReady: true,
    bridgeReady: false,
    hostEndpointConfigured: true,
    hostHealth: strictReady,
  });
  assert.equal(customHost.referenceBridgeReady, false);
  assert.equal(customHost.externalHostReady, true);
  assert.equal(customHost.aiPlusReady, true);
}

{
  const source = readFileSync(devBackendScript, 'utf8');
  assert.match(source, /prepareHostAgentEndpoint\(\{[\s\S]*repoRoot,[\s\S]*env: process\.env/);
  assert.match(source, /createBackendChildEnv\(hostEndpoint\.env, referenceBridge\)/);
  assert.match(source, /\/api\/host-agent\/health|queryStructuredHostAgentHealth/);
  assert.match(source, /waitForUrl\('http:\/\/127\.0\.0\.1:5173\/'/);
  assert.match(source, /guiReady: backendHealth\.ok && frontendHealth\.ok/);
  assert.match(source, /GUI ready/);
  assert.doesNotMatch(source, /GUI backend ready/);
  assert.match(source, /Reference bridge ready/);
  assert.match(source, /External Host ready/);
  assert.match(source, /AI\+ ready/);
  assert.match(source, /'8000'/, 'daily backend keeps the literal default-port contract');

  const stackSource = readFileSync(agentOpsStackModule, 'utf8');
  assert.match(stackSource, /env: createBackendChildEnv\(hostEndpoint\.env, referenceBridge\)/);
  assert.match(stackSource, /queryStructuredHostAgentHealth\(\{ backendPort \}\)/);
  assert.match(stackSource, /name: 'reference-bridge'/);
}

const tempRoot = mkdtempSync(join(tmpdir(), 'life-index-verify-stack-missing-vite-'));
try {
  writeFileSync(
    join(tempRoot, 'package.json'),
    `${JSON.stringify({ name: 'life-index-gui-fixture', type: 'module' }, null, 2)}\n`,
  );
  mkdirSync(join(tempRoot, 'node_modules'), { recursive: true });

  assert.deepEqual(
    preflightVerifyStackDevDependencies({ repoRoot: tempRoot }),
    {
      ok: false,
      missing: ['vite'],
      error: {
        code: 'VERIFY_STACK_DEVDEPS_MISSING',
        message: 'Missing required dev dependency: vite. Check NODE_ENV first; if it is production, clear it before running npm ci --include=dev. Run npm ci --include=dev before npm run verify-stack. If critical dev dependencies are still missing after npm ci, fallback: pnpm install && pnpm run build (install pnpm first with npm i -g pnpm).',
      },
    },
    'verify-stack must fail fast with npm ci --include=dev guidance when vite is missing',
  );

  assert.throws(
    () => execFileSync(process.execPath, [verifyStackScript, '--repo-root', tempRoot], { encoding: 'utf8' }),
    (error) => {
      const output = String(error.stdout ?? '');
      const result = JSON.parse(output);
      assert.equal(error.status, 1);
      assert.equal(result.error.code, 'VERIFY_STACK_DEVDEPS_MISSING');
      assert.match(result.error.message, /Check NODE_ENV/);
      assert.match(result.error.message, /NODE_ENV.*production/);
      assert.match(result.error.message, /Run npm ci --include=dev/);
      assert.match(result.error.message, /pnpm install && pnpm run build/);
      assert.match(result.error.message, /npm i -g pnpm/);
      assert.equal(result.processes.length, 0);
      return true;
    },
    'verify-stack command must exit non-zero before spawning processes when vite is missing',
  );

  const productionEnvPreflight = preflightVerifyStackDevDependencies({
    repoRoot: tempRoot,
    env: { ...process.env, NODE_ENV: 'production' },
  });
  assert.equal(productionEnvPreflight.ok, false);
  assert.deepEqual(productionEnvPreflight.missing, []);
  assert.equal(productionEnvPreflight.error.code, 'VERIFY_STACK_NODE_ENV_PRODUCTION');
  assert.match(productionEnvPreflight.error.message, /NODE_ENV=production/);
  assert.match(productionEnvPreflight.error.message, /requires devDependencies/);
  assert.match(productionEnvPreflight.error.message, /unset NODE_ENV/);
  assert.match(productionEnvPreflight.error.message, /\$env:NODE_ENV=''/);
  assert.match(productionEnvPreflight.error.message, /npm ci --include=dev/);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

assert.deepEqual(
  await preflightBackendPythonVersion({
    pythonCommand: process.execPath,
    execPython: async () => ({ ok: true, stdout: '3.13.6\n', stderr: '' }),
  }),
  { ok: true, version: '3.13.6', supportedRange: '3.11-3.13' },
  'verify-stack should accept backend Python 3.13',
);

const python314Preflight = await preflightBackendPythonVersion({
  pythonCommand: process.execPath,
  execPython: async () => ({ ok: true, stdout: '3.14.0\n', stderr: '' }),
});
assert.equal(python314Preflight.ok, false);
assert.equal(python314Preflight.version, '3.14.0');
assert.equal(python314Preflight.error.code, 'VERIFY_STACK_PYTHON_UNSUPPORTED');
assert.match(python314Preflight.error.message, /Python 3\.11-3\.13/);
assert.match(python314Preflight.error.message, /Python 3\.13/);
assert.match(python314Preflight.error.message, /python3\.13 -m venv \.venv/);
assert.match(python314Preflight.error.message, /\.venv\\Scripts\\python\.exe -m pip install -r backend\/requirements\.txt/);

const cleanGitRoot = mkdtempSync(join(tmpdir(), 'life-index-verify-stack-clean-git-'));
try {
  git(cleanGitRoot, ['init']);
  git(cleanGitRoot, ['config', 'user.email', 'test@example.invalid']);
  git(cleanGitRoot, ['config', 'user.name', 'Life Index Test']);
  writeFileSync(join(cleanGitRoot, 'package.json'), '{"name":"clean-fixture"}\n');
  git(cleanGitRoot, ['add', 'package.json']);
  git(cleanGitRoot, ['commit', '-m', 'fixture']);

  assert.deepEqual(
    await preflightWorktreeStatus({ repoRoot: cleanGitRoot }),
    { ok: true, dirty: false, dirtyFiles: [] },
    'verify-stack should not warn for a clean git worktree',
  );

  writeFileSync(join(cleanGitRoot, 'package.json'), '{"name":"dirty-fixture"}\n');
  writeFileSync(join(cleanGitRoot, 'friction-note.md'), 'write friction notes outside cloned repositories\n');

  const dirtyStatus = await preflightWorktreeStatus({ repoRoot: cleanGitRoot });
  assert.equal(dirtyStatus.ok, true);
  assert.equal(dirtyStatus.dirty, true);
  assert.match(dirtyStatus.warning.message, /Working tree is dirty/);
  assert.match(dirtyStatus.warning.message, /git status --porcelain/);
  assert.match(dirtyStatus.warning.message, /git restore \./);
  assert.match(dirtyStatus.warning.message, /git clean -fd/);
  assert.ok(dirtyStatus.dirtyFiles.some((line) => line.includes('package.json')));
  assert.ok(dirtyStatus.dirtyFiles.some((line) => line.includes('friction-note.md')));
} finally {
  rmSync(cleanGitRoot, { recursive: true, force: true });
}

console.log('agent ops stack helpers OK');
