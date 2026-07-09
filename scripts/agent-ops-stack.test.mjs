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
  preflightBackendPythonVersion,
  preflightWorktreeStatus,
  preflightVerifyStackDevDependencies,
} from './lib/agent-ops-stack.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const verifyStackScript = join(resolve(__dirname, '..'), 'scripts', 'verify-stack.mjs');

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
