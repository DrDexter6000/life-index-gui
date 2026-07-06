import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyPortOwners,
  createLaunchCommands,
  parseSsPids,
  parseWindowsTcpPids,
  preflightVerifyStackDevDependencies,
} from './lib/agent-ops-stack.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const verifyStackScript = join(resolve(__dirname, '..'), 'scripts', 'verify-stack.mjs');

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

const unknownBackend = {
  pid: 303,
  commandLine: 'python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000',
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
        message: 'Missing required dev dependency: vite. Run npm ci --include=dev before npm run verify-stack.',
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
      assert.match(result.error.message, /Run npm ci --include=dev/);
      assert.equal(result.processes.length, 0);
      return true;
    },
    'verify-stack command must exit non-zero before spawning processes when vite is missing',
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('agent ops stack helpers OK');
