import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyGuiUpgrade, planGuiUpgrade } from './lib/gui-upgrade-atom.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const guiUpgradeScript = join(repoRoot, 'scripts', 'gui-upgrade.mjs');
const requiredDevDeps = ['vite', 'typescript', 'eslint', 'vitest'];
const requiredBackendModules = ['fastapi', 'uvicorn', 'pydantic_core', 'PIL'];
const forbiddenMutation = /git (?:fetch|pull)|npm ci|pip install|npm run (?:sync-skill|verify-stack)/i;
const playbookPath = 'docs/AGENT_UPDATE_PLAYBOOK.md';

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitCommandId(command, args) {
  return `${command} ${args.join(' ')}`;
}

function runRealCommand(command, args, { cwd }) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    message: result.error?.message ?? '',
  };
}

function makeCommandRunner({
  invoked,
  pythonVersion = '3.13.5',
  missingBackendModules = [],
  cliVersion = '1.4.5',
  cliStatus = 'ok',
  npmOmit = '',
} = {}) {
  return function commandRunner(command, args, context) {
    const id = gitCommandId(command, args);
    invoked?.push(id);

    if (command === 'git') return runRealCommand(command, args, context);
    if (id === 'npm --version') return { status: 0, stdout: '11.13.0\n', stderr: '' };
    if (id === 'npm config get omit') return { status: 0, stdout: `${npmOmit}\n`, stderr: '' };
    if (command === 'python-fixture' && args[0] === '-c' && args[1].includes('sys.version_info')) {
      return { status: 0, stdout: `${pythonVersion}\n`, stderr: '' };
    }
    if (command === 'python-fixture' && args[0] === '-c' && args[1].includes('importlib.import_module')) {
      return {
        status: 0,
        stdout: `${JSON.stringify({ missing: missingBackendModules })}\n`,
        stderr: '',
      };
    }
    if (id === 'life-index --version') {
      if (cliStatus === 'missing') {
        return { status: 1, stdout: '', stderr: 'life-index command not found', message: 'not found' };
      }
      if (cliStatus === 'unknown') {
        return { status: 0, stdout: 'not-a-version\n', stderr: '' };
      }
      return {
        status: 0,
        stdout: `${JSON.stringify({ package_version: cliVersion })}\n`,
        stderr: '',
      };
    }

    return { status: 99, stdout: '', stderr: `unexpected command: ${id}`, message: 'unexpected command' };
  };
}

function configureGitUser(cwd) {
  git(cwd, ['config', 'user.email', 'test@example.invalid']);
  git(cwd, ['config', 'user.name', 'Life Index Test']);
}

function packageDir(root, dependencyName) {
  return join(root, 'node_modules', ...dependencyName.split('/'));
}

function installFixtureDevDeps(root) {
  for (const dependencyName of requiredDevDeps) {
    mkdirSync(packageDir(root, dependencyName), { recursive: true });
    writeFileSync(
      join(packageDir(root, dependencyName), 'package.json'),
      `${JSON.stringify({ name: dependencyName, version: '0.0.0-test' })}\n`,
    );
  }
}

function writeFixtureExecutables(root) {
  const bin = join(root, '.fixture-bin');
  mkdirSync(bin, { recursive: true });
  const cliPayload = JSON.stringify({ package_version: '1.4.5' }).replace(/"/g, '\\"');
  const lifeIndex = join(bin, 'life-index');
  writeFileSync(lifeIndex, `#!/bin/sh\nprintf '%s\\n' "${cliPayload}"\n`);
  try { chmodSync(lifeIndex, 0o755); } catch { /* Windows uses the .cmd shim. */ }
  writeFileSync(join(bin, 'life-index.cmd'), '@echo off\r\necho {"package_version":"1.4.5"}\r\n');

  const npm = join(bin, 'npm');
  writeFileSync(
    npm,
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then printf \'%s\\n\' \'11.13.0\'; exit 0; fi',
      'if [ "$1" = "config" ]; then printf \'\\n\'; exit 0; fi',
      'echo "forbidden npm command" >&2',
      'exit 99',
      '',
    ].join('\n'),
  );
  try { chmodSync(npm, 0o755); } catch { /* Windows uses the .cmd shim. */ }
  writeFileSync(
    join(bin, 'npm.cmd'),
    [
      '@echo off',
      'if "%1"=="--version" (echo 11.13.0& exit /b 0)',
      'if "%1"=="config" (echo.& exit /b 0)',
      'echo forbidden npm command 1>&2',
      'exit /b 99',
      '',
    ].join('\r\n'),
  );
}

function writePackageFixture(root, { installDevDeps = true, backendRequirements = false } = {}) {
  const devDependencies = Object.fromEntries(requiredDevDeps.map((name) => [name, '0.0.0-test']));
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n.fixture-bin/\n');
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({
      name: 'life-index-gui-fixture',
      version: '0.5.0',
      type: 'module',
      devDependencies,
    }, null, 2)}\n`,
  );
  writeFileSync(join(root, 'package-lock.json'), `${JSON.stringify({ lockfileVersion: 3 })}\n`);
  mkdirSync(join(root, 'backend', 'adapter'), { recursive: true });
  writeFileSync(
    join(root, 'backend', 'adapter', 'cli_adapter.py'),
    'MIN_SUPPORTED_CLI_VERSION = "1.4.5"\n',
  );
  if (backendRequirements) {
    writeFileSync(join(root, 'backend', 'requirements.txt'), 'fastapi\nuvicorn\npydantic\nPillow\n');
  }
  if (installDevDeps) installFixtureDevDeps(root);
  writeFixtureExecutables(root);
}

function makeRemoteFixture(options = {}) {
  const base = mkdtempSync(join(tmpdir(), 'life-index-gui-reinstall-'));
  const remote = join(base, 'origin.git');
  const work = join(base, 'work');
  const peer = join(base, 'peer');
  git(base, ['init', '--bare', remote]);
  mkdirSync(work);
  git(work, ['init', '-b', 'master']);
  configureGitUser(work);
  writePackageFixture(work, options);
  git(work, ['add', '.gitignore', 'package.json', 'package-lock.json', 'backend/adapter/cli_adapter.py']);
  if (options.backendRequirements) git(work, ['add', 'backend/requirements.txt']);
  git(work, ['commit', '-m', 'fixture']);
  git(work, ['remote', 'add', 'origin', remote]);
  git(work, ['push', '-u', 'origin', 'master']);
  git(base, ['clone', remote, peer]);
  configureGitUser(peer);
  return { base, remote, work, peer };
}

function makeLocalFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'life-index-gui-reinstall-local-'));
  git(root, ['init', '-b', 'master']);
  configureGitUser(root);
  writePackageFixture(root, options);
  git(root, ['add', '.gitignore', 'package.json', 'package-lock.json', 'backend/adapter/cli_adapter.py']);
  if (options.backendRequirements) git(root, ['add', 'backend/requirements.txt']);
  git(root, ['commit', '-m', 'fixture']);
  return root;
}

function addRemoteCommit(fixture, path = 'remote-update.md') {
  writeFileSync(join(fixture.peer, path), `remote update ${Date.now()}\n`);
  git(fixture.peer, ['add', path]);
  git(fixture.peer, ['commit', '-m', `remote update ${path}`]);
  git(fixture.peer, ['push', 'origin', 'master']);
  return git(fixture.peer, ['rev-parse', 'HEAD']);
}

function addLocalCommit(fixture, path = 'local-update.md') {
  writeFileSync(join(fixture.work, path), `local update ${Date.now()}\n`);
  git(fixture.work, ['add', path]);
  git(fixture.work, ['commit', '-m', `local update ${path}`]);
  return git(fixture.work, ['rev-parse', 'HEAD']);
}

function plan(fixture, runnerOptions = {}, options = {}) {
  const invoked = [];
  const envelope = planGuiUpgrade({
    repoRoot: fixture.work ?? fixture,
    env: { PYTHON: 'python-fixture', ...(options.env ?? {}) },
    commandRunner: makeCommandRunner({ invoked, ...runnerOptions }),
  });
  return { envelope, invoked };
}

function apply(fixture, runnerOptions = {}, options = {}) {
  const invoked = [];
  const envelope = applyGuiUpgrade({
    repoRoot: fixture.work ?? fixture,
    env: { PYTHON: 'python-fixture', ...(options.env ?? {}) },
    commandRunner: makeCommandRunner({ invoked, ...runnerOptions }),
  });
  return { envelope, invoked };
}

function assertActionContract(action) {
  for (const field of ['id', 'description', 'side_effect', 'command', 'reason', 'safe_to_run', 'requires_human']) {
    assert.ok(Object.hasOwn(action, field), `action ${action.id ?? '<unknown>'} must include ${field}`);
  }
}

function assertReinstallPlan(envelope, expectedReason) {
  assert.equal(envelope.success, true);
  assert.equal(envelope.schema_version, 'gui.upgrade.v0');
  assert.equal(envelope.mode, 'plan');
  assert.equal(envelope.data.reinstall_required, true);
  assert.equal(envelope.data.reinstall_playbook, playbookPath);
  assert.equal(envelope.data.actions.length, 1, 'replacement reasons must deduplicate to one action');
  const [action] = envelope.data.actions;
  assertActionContract(action);
  assert.equal(action.id, 'reinstall_gui');
  assert.equal(action.command, null);
  assert.equal(action.side_effect, 'write');
  assert.equal(action.safe_to_run, false);
  assert.equal(action.requires_human, true);
  assert.match(action.reason, expectedReason);
  assert.match(action.description, /leave .*existing GUI checkout.*untouched/i);
  assert.match(action.description, /fresh dedicated install/i);
  assert.equal(envelope.data.recommended_next_step, action);
  assert.doesNotMatch(JSON.stringify(envelope), forbiddenMutation);
}

function assertReinstallApply(envelope) {
  assert.equal(envelope.success, false);
  assert.equal(envelope.schema_version, 'gui.upgrade.v0');
  assert.equal(envelope.mode, 'apply');
  assert.equal(envelope.error.code, 'GUI_UPGRADE_REINSTALL_REQUIRED');
  assert.equal(envelope.data.reinstall_required, true);
  assert.equal(envelope.data.reinstall_playbook, playbookPath);
  assert.deepEqual(envelope.data.applied_actions, []);
}

function assertNoForbiddenInvocations(invoked) {
  assert.doesNotMatch(invoked.join('\n'), forbiddenMutation);
}

// Healthy/current is a truthful no-op in both modes.
{
  const fixture = makeRemoteFixture();
  try {
    const planned = plan(fixture);
    assert.equal(planned.envelope.success, true);
    assert.equal(planned.envelope.data.repo.freshness, 'current');
    assert.equal(planned.envelope.data.reinstall_required, false);
    assert.deepEqual(planned.envelope.data.actions, []);
    assert.equal(planned.envelope.data.recommended_next_step.id, 'none');
    assert.deepEqual(
      planned.invoked.filter((command) => command.startsWith('git ') && command.includes(' status ')),
      ['git --no-optional-locks status --porcelain=v1'],
    );
    assertNoForbiddenInvocations(planned.invoked);

    const applied = apply(fixture);
    assert.equal(applied.envelope.success, true);
    assert.equal(applied.envelope.mode, 'apply');
    assert.equal(applied.envelope.data.reinstall_required, false);
    assert.deepEqual(applied.envelope.data.actions, []);
    assert.deepEqual(applied.envelope.data.applied_actions, []);
    assertNoForbiddenInvocations(applied.invoked);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

// Behind and stale-tracking checkouts require a fresh dedicated install, never fetch/pull.
for (const staleTracking of [false, true]) {
  const fixture = makeRemoteFixture();
  try {
    const localHead = git(fixture.work, ['rev-parse', 'HEAD']);
    addRemoteCommit(fixture, staleTracking ? 'stale.md' : 'behind.md');
    if (!staleTracking) git(fixture.work, ['fetch', 'origin']);
    const planned = plan(fixture);
    assert.equal(planned.envelope.data.repo.freshness, 'behind');
    assertReinstallPlan(planned.envelope, /behind|stale/i);
    assertNoForbiddenInvocations(planned.invoked);

    const applied = apply(fixture);
    assertReinstallApply(applied.envelope);
    assertNoForbiddenInvocations(applied.invoked);
    assert.equal(git(fixture.work, ['rev-parse', 'HEAD']), localHead);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

// Missing Node dependencies require replacement; apply must not run npm ci.
{
  const fixture = makeRemoteFixture({ installDevDeps: false });
  try {
    const planned = plan(fixture);
    assertReinstallPlan(planned.envelope, /missing.*dependencies|vite/i);
    const applied = apply(fixture);
    assertReinstallApply(applied.envelope);
    assertNoForbiddenInvocations([...planned.invoked, ...applied.invoked]);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

// Environment guards are replacement signals, not invitations to mutate npm or process configuration.
for (const scenario of [
  { runnerOptions: { npmOmit: 'dev' }, options: {}, reason: /npm omit/i },
  { runnerOptions: {}, options: { env: { NODE_ENV: 'production' } }, reason: /NODE_ENV=production/i },
]) {
  const fixture = makeRemoteFixture();
  try {
    const planned = plan(fixture, scenario.runnerOptions, scenario.options);
    assertReinstallPlan(planned.envelope, scenario.reason);
    const applied = apply(fixture, scenario.runnerOptions, scenario.options);
    assertReinstallApply(applied.envelope);
    assertNoForbiddenInvocations([...planned.invoked, ...applied.invoked]);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

// Missing backend modules and unsupported Python both require replacement; apply must not run pip/venv repair.
for (const runnerOptions of [
  { missingBackendModules: ['fastapi'] },
  { pythonVersion: '3.10.14' },
]) {
  const fixture = makeRemoteFixture({ backendRequirements: true });
  try {
    const planned = plan(fixture, runnerOptions);
    assertReinstallPlan(planned.envelope, /backend|python/i);
    const applied = apply(fixture, runnerOptions);
    assertReinstallApply(applied.envelope);
    assertNoForbiddenInvocations([...planned.invoked, ...applied.invoked]);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

// CLI dependency mismatch is part of the disposable GUI program-environment replacement decision.
for (const runnerOptions of [
  { cliVersion: '1.4.4' },
  { cliStatus: 'missing' },
  { cliStatus: 'unknown' },
]) {
  const fixture = makeRemoteFixture();
  try {
    const planned = plan(fixture, runnerOptions);
    assertReinstallPlan(planned.envelope, /CLI/i);
    const applied = apply(fixture, runnerOptions);
    assertReinstallApply(applied.envelope);
    assertNoForbiddenInvocations([...planned.invoked, ...applied.invoked]);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

// Multiple replacement reasons remain one human-required action.
{
  const fixture = makeRemoteFixture({ installDevDeps: false, backendRequirements: true });
  try {
    addRemoteCommit(fixture, 'dedupe.md');
    git(fixture.work, ['fetch', 'origin']);
    const planned = plan(fixture, { missingBackendModules: ['fastapi'], cliVersion: '1.4.4' });
    assertReinstallPlan(planned.envelope, /behind/i);
    assert.match(planned.envelope.data.actions[0].reason, /Node/i);
    assert.match(planned.envelope.data.actions[0].reason, /backend/i);
    assert.match(planned.envelope.data.actions[0].reason, /CLI/i);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

// Dirty/ahead/diverged/unknown remain human-owned diagnostics, not deletion or reinstall advice.
for (const state of ['dirty', 'ahead', 'diverged', 'unknown']) {
  const fixture = state === 'unknown' ? makeLocalFixture() : makeRemoteFixture();
  const root = fixture.work ?? fixture;
  const cleanup = fixture.base ?? fixture;
  try {
    if (state === 'dirty') writeFileSync(join(root, 'dirty.md'), 'keep this work\n');
    if (state === 'ahead') addLocalCommit(fixture, 'ahead.md');
    if (state === 'diverged') {
      addLocalCommit(fixture, 'local.md');
      addRemoteCommit(fixture, 'remote.md');
      git(root, ['fetch', 'origin']);
    }
    const planned = plan(fixture);
    assert.equal(planned.envelope.data.repo.freshness, state);
    assert.equal(planned.envelope.data.reinstall_required, false);
    assert.equal(planned.envelope.data.actions.length, 1);
    assert.notEqual(planned.envelope.data.actions[0].id, 'reinstall_gui');
    assert.equal(planned.envelope.data.actions[0].side_effect, 'read');
    if (state !== 'unknown') {
      assert.equal(planned.envelope.data.actions[0].command, 'git --no-optional-locks status --porcelain');
    }
    assert.equal(planned.envelope.data.actions[0].safe_to_run, false);
    assert.equal(planned.envelope.data.actions[0].requires_human, true);
    assert.doesNotMatch(JSON.stringify(planned.envelope), /discard|delete|reset|stash/i);
    assert.doesNotMatch(JSON.stringify(planned.envelope), forbiddenMutation);

    const applied = apply(fixture);
    assert.equal(applied.envelope.success, false);
    assert.equal(applied.envelope.error.code, 'GUI_UPGRADE_UNSAFE_ACTIONS');
    assert.equal(applied.envelope.data.reinstall_required, false);
    assert.deepEqual(applied.envelope.data.applied_actions, []);
    assertNoForbiddenInvocations([...planned.invoked, ...applied.invoked]);
  } finally {
    rmSync(cleanup, { recursive: true, force: true });
  }
}

// CLI wrapper preserves v0, JSON-only stdout, exit 1, and command:null on reinstall-required.
{
  const fixture = makeRemoteFixture();
  try {
    addRemoteCommit(fixture, 'wrapper-behind.md');
    git(fixture.work, ['fetch', 'origin']);
    const fixtureBin = join(fixture.work, '.fixture-bin');
    const result = spawnSync(process.execPath, [guiUpgradeScript, '--apply', '--json'], {
      cwd: fixture.work,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixtureBin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
      },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.doesNotThrow(() => JSON.parse(result.stdout), `stdout must be JSON only: ${result.stdout}`);
    const envelope = JSON.parse(result.stdout);
    assertReinstallApply(envelope);
    assert.equal(envelope.data.actions.length, 1);
    assert.equal(envelope.data.actions[0].id, 'reinstall_gui');
    assert.equal(envelope.data.actions[0].command, null);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

assert.deepEqual(requiredBackendModules, ['fastapi', 'uvicorn', 'pydantic_core', 'PIL']);
console.log('gui upgrade reinstall-required contract OK');
