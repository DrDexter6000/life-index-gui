import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyGuiUpgrade, planGuiUpgrade } from './lib/gui-upgrade-atom.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const guiUpgradeScript = join(repoRoot, 'scripts', 'gui-upgrade.mjs');
const requiredDevDeps = ['vite', 'typescript', 'eslint', 'vitest'];
const requiredBackendModules = ['fastapi', 'uvicorn', 'pydantic_core', 'PIL'];
const cliMinimumVersion = '1.3.7';
const entityReviewCardsCliVersion = '1.4.4';

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function runGitForInjection(command, args, { cwd }) {
  if (gitCommandId(command, args) === 'life-index --version') {
    return {
      status: 0,
      stdout: `${JSON.stringify({
        package_version: '1.4.5',
        bootstrap_manifest: { repo_version: '1.4.5' },
      })}\n`,
      stderr: '',
    };
  }
  if (gitCommandId(command, args) === 'npm run verify-stack') {
    return {
      status: 0,
      stdout: `${JSON.stringify({ status: 'ok', source: 'fixture verify-stack' })}\n`,
      stderr: '',
    };
  }
  if (gitCommandId(command, args) === 'npm run sync-skill') {
    return {
      status: 0,
      stdout: `${JSON.stringify({
        delivered: true,
        skill: 'life-index-gui',
        target: join(cwd, '.fixture-skills', 'life-index-gui', 'SKILL.md'),
        action: 'updated',
      })}\n`,
      stderr: '',
    };
  }

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

function gitCommandId(command, args) {
  return `${command} ${args.join(' ')}`;
}

function isPythonVersionProbe(args) {
  return args.length === 2
    && args[0] === '-c'
    && args[1].includes('sys.version_info');
}

function isPythonImportProbe(args) {
  return args.length === 2
    && args[0] === '-c'
    && args[1].includes('importlib.import_module');
}

function lifeIndexVersionStdout(version) {
  return `${JSON.stringify({
    package_version: version,
    bootstrap_manifest: { repo_version: version },
  })}\n`;
}

function makeBackendCommandRunner({
  pythonCommand = 'python-fixture',
  version = '3.13.5',
  missingModules = [],
  onPipInstall,
  npmOmit = '',
  npmVersion = '11.13.0',
} = {}) {
  return function commandRunner(command, args, context) {
    const id = gitCommandId(command, args);
    if (id === 'npm --version') return { status: 0, stdout: `${npmVersion}\n`, stderr: '' };
    if (id === 'npm config get omit') return { status: 0, stdout: `${npmOmit}\n`, stderr: '' };
    if (command === pythonCommand && isPythonVersionProbe(args)) {
      return { status: 0, stdout: `${version}\n`, stderr: '' };
    }
    if (command === pythonCommand && isPythonImportProbe(args)) {
      return { status: 0, stdout: `${JSON.stringify({ missing: missingModules })}\n`, stderr: '' };
    }
    if (command === pythonCommand && gitCommandId(command, args) === `${pythonCommand} -m pip install -r backend/requirements.txt`) {
      if (onPipInstall) return onPipInstall();
      return { status: 0, stdout: 'installed backend requirements\n', stderr: '' };
    }
    return runGitForInjection(command, args, context);
  };
}

function makeCliCommandRunner({
  version = '1.4.5',
  missing = false,
  stdout,
  stderr = '',
  status = 0,
  fallback = runGitForInjection,
} = {}) {
  return function commandRunner(command, args, context) {
    if (gitCommandId(command, args) === 'life-index --version') {
      if (missing) {
        return { status: 1, stdout: '', stderr, message: 'life-index command not found' };
      }
      return {
        status,
        stdout: stdout ?? lifeIndexVersionStdout(version),
        stderr,
        message: status === 0 ? '' : 'life-index --version failed',
      };
    }
    return fallback(command, args, context);
  };
}

function writeFixtureCli(root, version = '1.4.5') {
  const bin = join(root, '.fixture-bin');
  mkdirSync(bin, { recursive: true });
  const payload = JSON.stringify({
    package_version: version,
    bootstrap_manifest: { repo_version: version },
  }).replace(/"/g, '\\"');
  const posixPath = join(bin, 'life-index');
  writeFileSync(posixPath, `#!/bin/sh\nif [ "$1" = "--version" ]; then\n  printf '%s\\n' "${payload}"\n  exit 0\nfi\necho "unsupported fixture command" >&2\nexit 2\n`);
  try {
    chmodSync(posixPath, 0o755);
  } catch {
    // Windows does not need POSIX executable bits for the .cmd shim below.
  }
  writeFileSync(
    join(bin, 'life-index.cmd'),
    `@echo off\r\nif "%1"=="--version" (\r\n  echo ${JSON.stringify({
      package_version: version,
      bootstrap_manifest: { repo_version: version },
    })}\r\n  exit /b 0\r\n)\r\necho unsupported fixture command 1>&2\r\nexit /b 2\r\n`,
  );
}

function writeFixtureNpm(root) {
  const bin = join(root, '.fixture-bin');
  mkdirSync(bin, { recursive: true });
  const posixPath = join(bin, 'npm');
  writeFileSync(
    posixPath,
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      "  printf '%s\\n' '11.13.0'",
      '  exit 0',
      'fi',
      'if [ "$1" = "config" ] && [ "$2" = "get" ] && [ "$3" = "omit" ]; then',
      "  printf '\\n'",
      '  exit 0',
      'fi',
      'if [ "$1" = "run" ] && [ "$2" = "verify-stack" ]; then',
      '  node scripts/fixture-verify-stack.mjs',
      '  exit $?',
      'fi',
      'if [ "$1" = "run" ] && [ "$2" = "sync-skill" ]; then',
      "  printf '%s\\n' '{\"delivered\":true,\"skill\":\"life-index-gui\",\"target\":\"fixture-skill\",\"action\":\"updated\"}'",
      '  exit 0',
      'fi',
      'if [ "$1" = "ci" ] && [ "$2" = "--include=dev" ]; then',
      "  printf '%s\\n' 'installed dev dependencies'",
      '  exit 0',
      'fi',
      "printf '%s\\n' 'unsupported fixture npm command' >&2",
      'exit 2',
      '',
    ].join('\n'),
  );
  try {
    chmodSync(posixPath, 0o755);
  } catch {
    // Windows does not need POSIX executable bits for the .cmd shim below.
  }
  writeFileSync(
    join(bin, 'npm.cmd'),
    [
      '@echo off',
      'if "%1"=="--version" (',
      '  echo 11.13.0',
      '  exit /b 0',
      ')',
      'if "%1"=="config" if "%2"=="get" if "%3"=="omit" (',
      '  echo.',
      '  exit /b 0',
      ')',
      'if "%1"=="run" if "%2"=="verify-stack" (',
      '  node scripts\\fixture-verify-stack.mjs',
      '  exit /b %ERRORLEVEL%',
      ')',
      'if "%1"=="run" if "%2"=="sync-skill" (',
      '  echo {"delivered":true,"skill":"life-index-gui","target":"fixture-skill","action":"updated"}',
      '  exit /b 0',
      ')',
      'if "%1"=="ci" if "%2"=="--include=dev" (',
      '  echo installed dev dependencies',
      '  exit /b 0',
      ')',
      'echo unsupported fixture npm command 1>&2',
      'exit /b 2',
      '',
    ].join('\r\n'),
  );
}

function commandEnv(cwd, env = {}) {
  const fixtureBin = join(cwd, '.fixture-bin');
  return {
    ...process.env,
    PATH: `${fixtureBin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
    ...env,
  };
}

function runGuiUpgrade(args, { cwd }) {
  return spawnSync(process.execPath, [guiUpgradeScript, ...args], {
    cwd,
    encoding: 'utf8',
    env: commandEnv(cwd),
  });
}

function runGuiUpgradeWithEnv(args, { cwd, env }) {
  return spawnSync(process.execPath, [guiUpgradeScript, ...args], {
    cwd,
    encoding: 'utf8',
    env: commandEnv(cwd, env),
  });
}

function parseStdoutJson(result) {
  assert.doesNotThrow(() => JSON.parse(result.stdout), `stdout must be JSON only, got: ${result.stdout}`);
  return JSON.parse(result.stdout);
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

function writeBackendRequirementsFixture(root) {
  mkdirSync(join(root, 'backend'), { recursive: true });
  writeFileSync(
    join(root, 'backend', 'requirements.txt'),
    [
      'fastapi==0.135.2',
      'uvicorn==0.35.0',
      'pydantic==2.11.10',
      'Pillow==10.4.0',
      '',
    ].join('\n'),
  );
}

function writePackageFixture(root, { installDevDeps = true, backendRequirements = false } = {}) {
  const devDependencies = Object.fromEntries(requiredDevDeps.map((dependencyName) => [dependencyName, '0.0.0-test']));
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n.fixture-bin/\n');
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({
      name: 'life-index-gui-fixture',
      version: '0.3.0',
      type: 'module',
      scripts: {
        build: 'tsc -b && vite build',
        lint: 'eslint .',
        test: 'vitest',
        'verify-stack': 'node scripts/fixture-verify-stack.mjs',
      },
      devDependencies,
    }, null, 2)}\n`,
  );
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(
    join(root, 'scripts', 'fixture-verify-stack.mjs'),
    "console.log(JSON.stringify({ status: 'ok', source: 'fixture verify-stack' }));\n",
  );
  writeFileSync(
    join(root, 'package-lock.json'),
    `${JSON.stringify({
      name: 'life-index-gui-fixture',
      version: '0.3.0',
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'life-index-gui-fixture',
          version: '0.3.0',
          devDependencies,
        },
      },
    }, null, 2)}\n`,
  );
  if (installDevDeps) installFixtureDevDeps(root);
  if (backendRequirements) writeBackendRequirementsFixture(root);
  writeFixtureCli(root);
  writeFixtureNpm(root);
}

function commitFile(cwd, path, content, message) {
  writeFileSync(join(cwd, path), content);
  git(cwd, ['add', path]);
  git(cwd, ['commit', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

function makeRemoteFixture({ installDevDeps = true, backendRequirements = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'life-index-gui-upgrade-atom-'));
  const remote = join(base, 'origin.git');
  const work = join(base, 'work');
  const peer = join(base, 'peer');

  git(base, ['init', '--bare', remote]);
  mkdirSync(work);
  git(work, ['init', '-b', 'master']);
  configureGitUser(work);
  writePackageFixture(work, { installDevDeps, backendRequirements });
  git(work, ['add', '.gitignore', 'package.json', 'package-lock.json', 'scripts/fixture-verify-stack.mjs']);
  if (backendRequirements) git(work, ['add', 'backend/requirements.txt']);
  git(work, ['commit', '-m', 'fixture']);
  git(work, ['remote', 'add', 'origin', remote]);
  git(work, ['push', '-u', 'origin', 'master']);
  git(base, ['clone', remote, peer]);
  configureGitUser(peer);

  return { base, remote, work, peer };
}

function makeLocalFixture({ installDevDeps = true, backendRequirements = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'life-index-gui-upgrade-local-'));
  git(root, ['init', '-b', 'master']);
  configureGitUser(root);
  writePackageFixture(root, { installDevDeps, backendRequirements });
  git(root, ['add', '.gitignore', 'package.json', 'package-lock.json', 'scripts/fixture-verify-stack.mjs']);
  if (backendRequirements) git(root, ['add', 'backend/requirements.txt']);
  git(root, ['commit', '-m', 'fixture']);
  return root;
}

function addRemoteCommit(fixture, path = 'remote-note.md') {
  writeFileSync(join(fixture.peer, path), `remote update ${Date.now()}\n`);
  git(fixture.peer, ['add', path]);
  git(fixture.peer, ['commit', '-m', `remote update ${path}`]);
  git(fixture.peer, ['push', 'origin', 'master']);
  return git(fixture.peer, ['rev-parse', 'HEAD']);
}

function plan(cwd) {
  const result = runGuiUpgrade(['--plan', '--json'], { cwd });
  assert.equal(result.stderr, '', `plan stderr must stay empty: ${result.stderr}`);
  return { result, json: parseStdoutJson(result) };
}

function apply(cwd) {
  const result = runGuiUpgrade(['--apply', '--json'], { cwd });
  assert.equal(result.stderr, '', `apply stderr must stay empty: ${result.stderr}`);
  return { result, json: parseStdoutJson(result) };
}

function assertActionContract(action) {
  for (const field of ['id', 'description', 'side_effect', 'command', 'reason', 'safe_to_run', 'requires_human']) {
    assert.ok(Object.hasOwn(action, field), `action ${action.id ?? '<unknown>'} must include ${field}`);
  }
  assert.ok(['read', 'write'].includes(action.side_effect), 'side_effect must be read or write');
  assert.equal(typeof action.safe_to_run, 'boolean');
  assert.equal(typeof action.requires_human, 'boolean');
}

function assertActionContracts(envelope) {
  for (const action of envelope.data.actions) assertActionContract(action);
}

function assertNoForbiddenCommands(envelope) {
  const rendered = JSON.stringify(envelope);
  assert.doesNotMatch(rendered, /public:(export|precheck|drift)|public sync|tag|release/i);
  assert.doesNotMatch(rendered, /life-index\s+upgrade\s+--apply/i);
}

function assertGitRepoContract(repo) {
  for (const field of [
    'path',
    'branch',
    'head',
    'upstream',
    'dirty',
    'dirty_files',
    'ahead',
    'behind',
    'diverged',
    'freshness',
    'remote_probe',
  ]) {
    assert.ok(Object.hasOwn(repo, field), `repo must include ${field}`);
  }
  assert.ok(['current', 'dirty', 'ahead', 'behind', 'diverged', 'unknown'].includes(repo.freshness));
  assert.ok(Object.hasOwn(repo.remote_probe, 'status'), 'remote_probe must include status');
}

function assertNodeContract(node) {
  for (const field of [
    'node_version',
    'npm_version',
    'node_env',
    'npm_omit',
    'required_dev_dependencies',
    'missing_dev_dependencies',
    'dev_dependencies_present',
    'package_lock_present',
    'install_command',
  ]) {
    assert.ok(Object.hasOwn(node, field), `node must include ${field}`);
  }
  assert.ok(node.node_version.startsWith('v'), 'node_version should use process.version shape');
  assert.ok(Array.isArray(node.npm_omit), 'npm_omit must be an array');
  assert.deepEqual(node.required_dev_dependencies, requiredDevDeps);
  assert.equal(node.install_command, 'npm ci --include=dev');
}

function assertPythonContract(python) {
  for (const field of [
    'command',
    'version',
    'supported_range',
    'supported',
    'backend_requirements_present',
    'missing_backend_modules',
    'requirements_file',
    'install_command',
  ]) {
    assert.ok(Object.hasOwn(python, field), `python must include ${field}`);
  }
  assert.equal(python.supported_range, '3.11-3.13');
  assert.ok(Array.isArray(python.missing_backend_modules), 'missing_backend_modules must be an array');
}

function assertCliDependencyContract(cliDependency) {
  for (const field of [
    'checked',
    'status',
    'cli_package_version',
    'cli_minimum_version',
    'compatible',
    'feature_gates',
    'version_command',
  ]) {
    assert.ok(Object.hasOwn(cliDependency, field), `cli_dependency must include ${field}`);
  }
  assert.ok(['ok', 'missing', 'incompatible', 'unknown'].includes(cliDependency.status));
  assert.equal(typeof cliDependency.checked, 'boolean');
  assert.equal(cliDependency.cli_minimum_version, cliMinimumVersion);
  assert.equal(typeof cliDependency.compatible, 'boolean');
  assert.ok(Array.isArray(cliDependency.feature_gates), 'feature_gates must be an array');
  const reviewGate = cliDependency.feature_gates.find((gate) => gate.id === 'entity_review_cards');
  assert.ok(reviewGate, 'cli_dependency must include entity_review_cards feature gate');
  for (const field of ['id', 'required_cli', 'satisfied', 'reason']) {
    assert.ok(Object.hasOwn(reviewGate, field), `entity_review_cards gate must include ${field}`);
  }
  assert.equal(reviewGate.required_cli, entityReviewCardsCliVersion);
  assert.equal(typeof reviewGate.satisfied, 'boolean');
  assert.equal(cliDependency.version_command, 'life-index --version');
}

function assertVerificationContract(verification) {
  assert.ok(verification, 'plan data must include verification');
  for (const field of [
    'verify_stack_command',
    'required',
    'verified',
    'last_result',
  ]) {
    assert.ok(Object.hasOwn(verification, field), `verification must include ${field}`);
  }
  assert.equal(verification.verify_stack_command, 'npm run verify-stack');
  assert.equal(verification.required, true);
  assert.equal(typeof verification.verified, 'boolean');
  if (verification.last_result !== null) {
    assert.equal(typeof verification.last_result.ok, 'boolean');
    assert.ok(Object.hasOwn(verification.last_result, 'stdout'), 'last_result must include stdout');
    assert.ok(Object.hasOwn(verification.last_result, 'stderr'), 'last_result must include stderr');
  }
}

function assertSkillDeliveryContract(skillDelivery) {
  assert.ok(skillDelivery, 'plan data must include skill_delivery');
  for (const field of [
    'skill_name',
    'sync_command',
    'delivered',
    'last_result',
  ]) {
    assert.ok(Object.hasOwn(skillDelivery, field), `skill_delivery must include ${field}`);
  }
  assert.equal(skillDelivery.skill_name, 'life-index-gui');
  assert.equal(skillDelivery.sync_command, 'npm run sync-skill');
  assert.equal(typeof skillDelivery.delivered, 'boolean');
  if (skillDelivery.last_result !== null) {
    assert.equal(typeof skillDelivery.last_result.ok, 'boolean');
    assert.ok(Object.hasOwn(skillDelivery.last_result, 'stdout'), 'last_result must include stdout');
    assert.ok(Object.hasOwn(skillDelivery.last_result, 'stderr'), 'last_result must include stderr');
  }
}

function assertBlockedApply(cwd, expectedActionId) {
  const applyResult = apply(cwd);
  assert.equal(applyResult.result.status, 1);
  assert.equal(applyResult.json.success, false);
  assert.equal(applyResult.json.error.code, 'GUI_UPGRADE_UNSAFE_ACTIONS');
  assert.deepEqual(applyResult.json.data.applied_actions, []);
  assert.ok(applyResult.json.error.action_ids.includes(expectedActionId));
  assertNoForbiddenCommands(applyResult.json);
}

const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
assert.equal(packageJson.scripts['sync-skill'], 'node scripts/sync-skill.mjs');
assert.equal(packageJson.scripts['gui-upgrade:plan'], 'node scripts/gui-upgrade.mjs --plan --json');
assert.equal(packageJson.scripts['gui-upgrade:apply'], 'node scripts/gui-upgrade.mjs --apply --json');
assert.match(
  readFileSync(join(repoRoot, '.npmrc'), 'utf8'),
  /^loglevel=silent$/m,
  'npm-run GUI upgrade JSON entrypoints must not print lifecycle banners to stdout',
);

{
  const fixture = makeRemoteFixture();
  try {
    const { result, json: currentPlan } = plan(fixture.work);
    assert.equal(result.status, 0);
    assert.equal(currentPlan.success, true);
    assert.equal(currentPlan.schema_version, 'gui.upgrade.v0');
    assert.equal(currentPlan.command, 'gui-upgrade');
    assert.equal(currentPlan.mode, 'plan');
    assertGitRepoContract(currentPlan.data.repo);
    assert.equal(currentPlan.data.repo.branch, 'master');
    assert.equal(currentPlan.data.repo.upstream, 'origin/master');
    assert.equal(currentPlan.data.repo.dirty, false);
    assert.deepEqual(currentPlan.data.repo.dirty_files, []);
    assert.equal(currentPlan.data.repo.ahead, 0);
    assert.equal(currentPlan.data.repo.behind, 0);
    assert.equal(currentPlan.data.repo.diverged, false);
    assert.equal(currentPlan.data.repo.freshness, 'current');
    assert.equal(currentPlan.data.repo.remote_probe.status, 'ok');
    assert.equal(currentPlan.data.repo.remote_probe.remote_head, currentPlan.data.repo.head);
    assertNodeContract(currentPlan.data.node);
    assert.equal(currentPlan.data.node.node_env, null);
    assert.deepEqual(currentPlan.data.node.npm_omit, []);
    assert.equal(currentPlan.data.node.package_lock_present, true);
    assert.equal(currentPlan.data.node.dev_dependencies_present, true);
    assert.deepEqual(currentPlan.data.node.missing_dev_dependencies, []);
    assertCliDependencyContract(currentPlan.data.cli_dependency);
    assert.equal(currentPlan.data.cli_dependency.checked, true);
    assert.equal(currentPlan.data.cli_dependency.status, 'ok');
    assert.equal(currentPlan.data.cli_dependency.cli_package_version, '1.4.5');
    assert.equal(currentPlan.data.cli_dependency.compatible, true);
    assert.equal(
      currentPlan.data.cli_dependency.feature_gates.find((gate) => gate.id === 'entity_review_cards').satisfied,
      true,
    );
    assertVerificationContract(currentPlan.data.verification);
    assert.equal(currentPlan.data.verification.verified, false);
    assert.equal(currentPlan.data.verification.last_result, null);
    assertSkillDeliveryContract(currentPlan.data.skill_delivery);
    assert.equal(currentPlan.data.skill_delivery.delivered, false);
    assert.equal(currentPlan.data.skill_delivery.last_result, null);
    assert.equal(currentPlan.data.actions.some((action) => action.id === 'sync_skill'), true);
    assert.equal(currentPlan.data.recommended_next_step.id, 'verify_stack');
    assert.equal(currentPlan.data.recommended_next_step.command, 'npm run verify-stack');
    assert.equal(currentPlan.data.recommended_next_step.side_effect, 'write');
    assert.equal(currentPlan.data.recommended_next_step.safe_to_run, true);
    assert.equal(currentPlan.data.recommended_next_step.requires_human, false);
    assertActionContracts(currentPlan);
    assertNoForbiddenCommands(currentPlan);

    const applyResult = apply(fixture.work);
    assert.equal(applyResult.result.status, 0);
    assert.equal(applyResult.json.success, true);
    assert.equal(applyResult.json.mode, 'apply');
    assert.deepEqual(applyResult.json.data.applied_actions, [
      { id: 'verify_stack', command: 'npm run verify-stack' },
      { id: 'sync_skill', command: 'npm run sync-skill' },
    ]);
    assertVerificationContract(applyResult.json.data.verification);
    assert.equal(applyResult.json.data.verification.verified, true);
    assert.equal(applyResult.json.data.verification.last_result.ok, true);
    assert.match(applyResult.json.data.verification.last_result.stdout, /fixture verify-stack/);
    assertSkillDeliveryContract(applyResult.json.data.skill_delivery);
    assert.equal(applyResult.json.data.skill_delivery.delivered, true);
    assert.equal(applyResult.json.data.skill_delivery.last_result.ok, true);
    assert.match(applyResult.json.data.skill_delivery.last_result.stdout, /life-index-gui/);
    assert.equal(applyResult.json.data.recommended_next_step.id, 'none');
    assertNoForbiddenCommands(applyResult.json);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    writeFileSync(join(fixture.work, 'dirty-verify-blocker.md'), 'dirty blocks verify-stack\n');
    const invoked = [];
    const commandRunner = (command, args, context) => {
      const id = gitCommandId(command, args);
      invoked.push(id);
      return runGitForInjection(command, args, context);
    };
    const planResult = planGuiUpgrade({ repoRoot: fixture.work, commandRunner });
    assert.equal(planResult.data.repo.freshness, 'dirty');
    assert.equal(planResult.data.recommended_next_step.id, 'resolve_dirty_worktree');
    assert.equal(planResult.data.actions.some((action) => action.id === 'verify_stack'), false);
    assertActionContracts(planResult);
    assertNoForbiddenCommands(planResult);

    invoked.length = 0;
    const applyResult = applyGuiUpgrade({ repoRoot: fixture.work, commandRunner });
    assert.equal(applyResult.success, false);
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_UNSAFE_ACTIONS');
    assert.ok(applyResult.error.action_ids.includes('resolve_dirty_worktree'));
    assert.equal(invoked.includes('npm run verify-stack'), false);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    const invoked = [];
    const commandRunner = (command, args, context) => {
      const id = gitCommandId(command, args);
      invoked.push(id);
      return runGitForInjection(command, args, context);
    };
    const planResult = planGuiUpgrade({
      repoRoot: fixture.work,
      env: { NODE_ENV: 'production' },
      commandRunner,
    });
    assert.equal(planResult.data.recommended_next_step.id, 'clear_node_env_production');
    assert.equal(planResult.data.actions.some((action) => action.id === 'verify_stack'), false);
    assertActionContracts(planResult);
    assertNoForbiddenCommands(planResult);

    invoked.length = 0;
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      env: { NODE_ENV: 'production' },
      commandRunner,
    });
    assert.equal(applyResult.success, false);
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_UNSAFE_ACTIONS');
    assert.ok(applyResult.error.action_ids.includes('clear_node_env_production'));
    assert.equal(invoked.includes('npm run verify-stack'), false);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    const invoked = [];
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner(command, args, context) {
        const id = gitCommandId(command, args);
        invoked.push(id);
        if (id === 'npm run sync-skill') {
          return {
            status: 1,
            stdout: `${JSON.stringify({ delivered: false, reason: 'host_skill_directory_not_found' })}\n`,
            stderr: '',
            message: 'simulated sync-skill failure',
          };
        }
        return runGitForInjection(command, args, context);
      },
    });
    assert.equal(applyResult.success, false);
    assert.equal(applyResult.mode, 'apply');
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_SYNC_SKILL_FAILED');
    assert.match(applyResult.data.skill_error.stdout, /host_skill_directory_not_found/);
    assert.match(applyResult.data.skill_error.message, /simulated sync-skill failure/);
    assert.equal(invoked.includes('npm run verify-stack'), true);
    assert.equal(invoked.includes('npm run sync-skill'), true);
    assert.deepEqual(applyResult.data.applied_actions, [
      { id: 'verify_stack', command: 'npm run verify-stack' },
    ]);
    assertSkillDeliveryContract(applyResult.data.skill_delivery);
    assert.equal(applyResult.data.skill_delivery.delivered, false);
    assert.equal(applyResult.data.skill_delivery.last_result.ok, false);
    assert.match(applyResult.data.skill_delivery.last_result.stdout, /host_skill_directory_not_found/);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    const invoked = [];
    const commandRunner = (command, args, context) => {
      const id = gitCommandId(command, args);
      invoked.push(id);
      return makeCliCommandRunner({ version: '1.4.3' })(command, args, context);
    };
    const planResult = planGuiUpgrade({ repoRoot: fixture.work, commandRunner });
    assert.equal(planResult.data.cli_dependency.status, 'incompatible');
    assert.equal(planResult.data.recommended_next_step.id, 'resolve_cli_dependency');
    assert.equal(planResult.data.actions.some((action) => action.id === 'verify_stack'), false);
    assertActionContracts(planResult);
    assertNoForbiddenCommands(planResult);

    invoked.length = 0;
    const applyResult = applyGuiUpgrade({ repoRoot: fixture.work, commandRunner });
    assert.equal(applyResult.success, false);
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_UNSAFE_ACTIONS');
    assert.ok(applyResult.error.action_ids.includes('resolve_cli_dependency'));
    assert.equal(invoked.includes('npm run verify-stack'), false);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    const invoked = [];
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner(command, args, context) {
        const id = gitCommandId(command, args);
        invoked.push(id);
        if (id === 'npm run verify-stack') {
          return {
            status: 1,
            stdout: 'verify stdout\n',
            stderr: 'verify failed\n',
            message: 'simulated verify-stack failure',
          };
        }
        return runGitForInjection(command, args, context);
      },
    });
    assert.equal(applyResult.success, false);
    assert.equal(applyResult.mode, 'apply');
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_VERIFY_STACK_FAILED');
    assert.match(applyResult.data.verify_error.stdout, /verify stdout/);
    assert.match(applyResult.data.verify_error.stderr, /verify failed/);
    assert.match(applyResult.data.verify_error.message, /simulated verify-stack failure/);
    assert.equal(invoked.includes('npm run verify-stack'), true);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assertVerificationContract(applyResult.data.verification);
    assert.equal(applyResult.data.verification.verified, false);
    assert.equal(applyResult.data.verification.last_result.ok, false);
    assert.match(applyResult.data.verification.last_result.stdout, /verify stdout/);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    const invoked = [];
    const commandRunner = (command, args, context) => {
      invoked.push(gitCommandId(command, args));
      return makeCliCommandRunner({ missing: true })(command, args, context);
    };
    const planResult = planGuiUpgrade({ repoRoot: fixture.work, commandRunner });
    assertCliDependencyContract(planResult.data.cli_dependency);
    assert.equal(planResult.data.cli_dependency.checked, true);
    assert.equal(planResult.data.cli_dependency.status, 'missing');
    assert.equal(planResult.data.cli_dependency.cli_package_version, null);
    assert.equal(planResult.data.cli_dependency.compatible, false);
    assert.equal(planResult.data.recommended_next_step.id, 'resolve_cli_dependency');
    assert.equal(planResult.data.recommended_next_step.safe_to_run, false);
    assert.equal(planResult.data.recommended_next_step.requires_human, true);
    assert.equal(planResult.data.recommended_next_step.command, 'life-index --version');
    assert.match(planResult.data.recommended_next_step.suggested_manual_resolution.posix, /life-index upgrade --plan --json/);
    assert.match(planResult.data.recommended_next_step.suggested_manual_resolution.powershell, /life-index upgrade --plan --json/);
    assertActionContracts(planResult);
    assertNoForbiddenCommands(planResult);

    invoked.length = 0;
    const applyResult = applyGuiUpgrade({ repoRoot: fixture.work, commandRunner });
    assert.equal(applyResult.success, false);
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_UNSAFE_ACTIONS');
    assert.ok(applyResult.error.action_ids.includes('resolve_cli_dependency'));
    assert.equal(applyResult.data.recommended_next_step.id, 'resolve_cli_dependency');
    assert.equal(invoked.includes('life-index upgrade --apply'), false);
    assert.equal(invoked.some((id) => /pip .*life-index/i.test(id)), false);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    const planResult = planGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner: makeCliCommandRunner({ version: '1.2.9' }),
    });
    assertCliDependencyContract(planResult.data.cli_dependency);
    assert.equal(planResult.data.cli_dependency.status, 'incompatible');
    assert.equal(planResult.data.cli_dependency.cli_package_version, '1.2.9');
    assert.equal(planResult.data.cli_dependency.compatible, false);
    assert.equal(planResult.data.recommended_next_step.id, 'resolve_cli_dependency');
    assert.match(planResult.data.recommended_next_step.reason, /minimum CLI 1\.3\.7/);
    assertActionContracts(planResult);
    assertNoForbiddenCommands(planResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    const planResult = planGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner: makeCliCommandRunner({ version: '1.4.3' }),
    });
    assertCliDependencyContract(planResult.data.cli_dependency);
    assert.equal(planResult.data.cli_dependency.status, 'incompatible');
    assert.equal(planResult.data.cli_dependency.cli_package_version, '1.4.3');
    assert.equal(planResult.data.cli_dependency.compatible, true);
    const reviewGate = planResult.data.cli_dependency.feature_gates.find((gate) => gate.id === 'entity_review_cards');
    assert.equal(reviewGate.satisfied, false);
    assert.match(reviewGate.reason, /requires CLI 1\.4\.4/);
    assert.equal(planResult.data.recommended_next_step.id, 'resolve_cli_dependency');
    assert.match(planResult.data.recommended_next_step.reason, /entity_review_cards/);
    assertActionContracts(planResult);
    assertNoForbiddenCommands(planResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    const planResult = planGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner: makeCliCommandRunner({ version: '1.4.4' }),
    });
    assertCliDependencyContract(planResult.data.cli_dependency);
    assert.equal(planResult.data.cli_dependency.status, 'ok');
    assert.equal(planResult.data.cli_dependency.cli_package_version, '1.4.4');
    assert.equal(planResult.data.cli_dependency.compatible, true);
    assert.equal(
      planResult.data.cli_dependency.feature_gates.find((gate) => gate.id === 'entity_review_cards').satisfied,
      true,
    );
    assertVerificationContract(planResult.data.verification);
    assert.equal(planResult.data.recommended_next_step.id, 'verify_stack');
    assertActionContracts(planResult);
    assertNoForbiddenCommands(planResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    writeFileSync(join(fixture.work, 'dirty-bad-cli.md'), 'git blocker wins before CLI dependency\n');
    const planResult = planGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner: makeCliCommandRunner({ version: '1.2.9' }),
    });
    assert.equal(planResult.data.repo.freshness, 'dirty');
    assert.equal(planResult.data.cli_dependency.status, 'incompatible');
    assert.equal(planResult.data.recommended_next_step.id, 'resolve_dirty_worktree');
    assertActionContracts(planResult);
    assertNoForbiddenCommands(planResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture({ backendRequirements: true });
  try {
    const invoked = [];
    const backendRunner = makeBackendCommandRunner({ missingModules: ['fastapi'] });
    const commandRunner = (command, args, context) => {
      invoked.push(gitCommandId(command, args));
      return makeCliCommandRunner({
        version: '1.4.3',
        fallback: backendRunner,
      })(command, args, context);
    };
    const planResult = planGuiUpgrade({
      repoRoot: fixture.work,
      env: { PYTHON: 'python-fixture' },
      commandRunner,
    });
    assert.equal(planResult.data.python.backend_requirements_present, false);
    assert.equal(planResult.data.cli_dependency.status, 'incompatible');
    assert.equal(planResult.data.recommended_next_step.id, 'resolve_cli_dependency');
    assert.equal(planResult.data.actions.some((action) => action.id === 'pip_install_backend_requirements'), true);
    assertActionContracts(planResult);
    assertNoForbiddenCommands(planResult);

    invoked.length = 0;
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      env: { PYTHON: 'python-fixture' },
      commandRunner,
    });
    assert.equal(applyResult.success, false);
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_UNSAFE_ACTIONS');
    assert.ok(applyResult.error.action_ids.includes('resolve_cli_dependency'));
    assert.equal(invoked.includes('python-fixture -m pip install -r backend/requirements.txt'), false);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture({ backendRequirements: true });
  try {
    const planResult = planGuiUpgrade({
      repoRoot: fixture.work,
      env: { PYTHON: 'python-fixture' },
      commandRunner: makeBackendCommandRunner(),
    });
    assert.equal(planResult.success, true);
    assert.equal(planResult.data.repo.freshness, 'current');
    assertPythonContract(planResult.data.python);
    assert.equal(planResult.data.python.command, 'python-fixture');
    assert.equal(planResult.data.python.version, '3.13.5');
    assert.equal(planResult.data.python.supported, true);
    assert.equal(planResult.data.python.backend_requirements_present, true);
    assert.deepEqual(planResult.data.python.missing_backend_modules, []);
    assert.match(planResult.data.python.requirements_file, /backend[\\/]+requirements\.txt$/);
    assert.equal(planResult.data.python.install_command, 'python-fixture -m pip install -r backend/requirements.txt');
    assertVerificationContract(planResult.data.verification);
    assert.equal(planResult.data.recommended_next_step.id, 'verify_stack');
    assertActionContracts(planResult);
    assertNoForbiddenCommands(planResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture({ backendRequirements: true });
  try {
    const invoked = [];
    const commandRunner = (command, args, context) => {
      invoked.push(gitCommandId(command, args));
      return makeBackendCommandRunner({ version: '3.14.0' })(command, args, context);
    };
    const planResult = planGuiUpgrade({
      repoRoot: fixture.work,
      env: { PYTHON: 'python-fixture' },
      commandRunner,
    });
    assert.equal(planResult.data.python.supported, false);
    assert.equal(planResult.data.python.version, '3.14.0');
    assert.equal(planResult.data.recommended_next_step.id, 'resolve_backend_python_version');
    assert.equal(planResult.data.recommended_next_step.safe_to_run, false);
    assert.equal(planResult.data.recommended_next_step.requires_human, true);
    assert.match(planResult.data.recommended_next_step.suggested_manual_resolution.posix, /python3\.13 -m venv \.venv/);
    assert.match(planResult.data.recommended_next_step.suggested_manual_resolution.powershell, /py -3\.13 -m venv \.venv/);
    assertActionContracts(planResult);
    assertNoForbiddenCommands(planResult);

    invoked.length = 0;
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      env: { PYTHON: 'python-fixture' },
      commandRunner,
    });
    assert.equal(applyResult.success, false);
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_UNSAFE_ACTIONS');
    assert.ok(applyResult.error.action_ids.includes('resolve_backend_python_version'));
    assert.equal(applyResult.data.recommended_next_step.id, 'resolve_backend_python_version');
    assert.equal(invoked.includes('python-fixture -m pip install -r backend/requirements.txt'), false);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture({ backendRequirements: true });
  try {
    let missingModules = ['fastapi', 'PIL'];
    const invoked = [];
    const commandRunner = (command, args, context) => {
      invoked.push(gitCommandId(command, args));
      return makeBackendCommandRunner({
        missingModules,
        onPipInstall() {
          missingModules = [];
          return { status: 0, stdout: 'installed backend deps\n', stderr: '' };
        },
      })(command, args, context);
    };
    const planResult = planGuiUpgrade({
      repoRoot: fixture.work,
      env: { PYTHON: 'python-fixture' },
      commandRunner,
    });
    assertPythonContract(planResult.data.python);
    assert.equal(planResult.data.python.supported, true);
    assert.equal(planResult.data.python.backend_requirements_present, false);
    assert.deepEqual(planResult.data.python.missing_backend_modules, ['fastapi', 'PIL']);
    assert.equal(planResult.data.recommended_next_step.id, 'pip_install_backend_requirements');
    assert.equal(planResult.data.recommended_next_step.command, 'python-fixture -m pip install -r backend/requirements.txt');
    assert.equal(planResult.data.recommended_next_step.side_effect, 'write');
    assert.equal(planResult.data.recommended_next_step.safe_to_run, true);
    assert.equal(planResult.data.recommended_next_step.requires_human, false);
    assertActionContracts(planResult);
    assertNoForbiddenCommands(planResult);

    invoked.length = 0;
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      env: { PYTHON: 'python-fixture' },
      commandRunner,
    });
    assert.equal(applyResult.success, true);
    assert.ok(invoked.includes('python-fixture -m pip install -r backend/requirements.txt'));
    assert.ok(invoked.indexOf('npm run verify-stack') > invoked.indexOf('python-fixture -m pip install -r backend/requirements.txt'));
    assert.deepEqual(applyResult.data.applied_actions, [
      { id: 'pip_install_backend_requirements', command: 'python-fixture -m pip install -r backend/requirements.txt' },
      { id: 'verify_stack', command: 'npm run verify-stack' },
      { id: 'sync_skill', command: 'npm run sync-skill' },
    ]);
    assert.equal(applyResult.data.python.backend_requirements_present, true);
    assert.deepEqual(applyResult.data.python.missing_backend_modules, []);
    assert.equal(applyResult.data.recommended_next_step.id, 'none');
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture({ backendRequirements: true });
  try {
    const invoked = [];
    const commandRunner = (command, args, context) => {
      invoked.push(gitCommandId(command, args));
      return makeBackendCommandRunner({
        missingModules: ['uvicorn'],
        onPipInstall() {
          return {
            status: 1,
            stdout: 'pip stdout\n',
            stderr: 'pip failed\n',
            message: 'simulated pip failure',
          };
        },
      })(command, args, context);
    };
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      env: { PYTHON: 'python-fixture' },
      commandRunner,
    });
    assert.equal(applyResult.success, false);
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_PIP_INSTALL_FAILED');
    assert.match(applyResult.data.pip_error.stdout, /pip stdout/);
    assert.match(applyResult.data.pip_error.stderr, /pip failed/);
    assert.match(applyResult.data.pip_error.message, /simulated pip failure/);
    assert.equal(invoked.includes('python-fixture -m pip install -r backend/requirements.txt'), true);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture({ backendRequirements: true });
  try {
    const remoteHead = addRemoteCommit(fixture, 'behind-missing-backend-deps.md');
    git(fixture.work, ['fetch', 'origin']);
    let missingModules = ['pydantic_core'];
    const invoked = [];
    const commandRunner = (command, args, context) => {
      invoked.push(gitCommandId(command, args));
      return makeBackendCommandRunner({
        missingModules,
        onPipInstall() {
          missingModules = [];
          return { status: 0, stdout: 'installed after git\n', stderr: '' };
        },
      })(command, args, context);
    };
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      env: { PYTHON: 'python-fixture' },
      commandRunner,
    });

    assert.equal(applyResult.success, true);
    assert.equal(git(fixture.work, ['rev-parse', 'HEAD']), remoteHead);
    assert.ok(invoked.indexOf('git pull --ff-only') > -1);
    assert.ok(invoked.indexOf('python-fixture -m pip install -r backend/requirements.txt') > invoked.indexOf('git pull --ff-only'));
    assert.ok(invoked.indexOf('npm run verify-stack') > invoked.indexOf('python-fixture -m pip install -r backend/requirements.txt'));
    assert.deepEqual(applyResult.data.applied_actions, [
      { id: 'git_pull_ff_only', command: 'git pull --ff-only' },
      { id: 'pip_install_backend_requirements', command: 'python-fixture -m pip install -r backend/requirements.txt' },
      { id: 'verify_stack', command: 'npm run verify-stack' },
      { id: 'sync_skill', command: 'npm run sync-skill' },
    ]);
    assert.equal(applyResult.data.python.backend_requirements_present, true);
    assert.equal(applyResult.data.recommended_next_step.id, 'none');
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture({ backendRequirements: true });
  try {
    const invoked = [];
    const commandRunner = (command, args, context) => {
      invoked.push(gitCommandId(command, args));
      return makeBackendCommandRunner({ missingModules: ['fastapi'] })(command, args, context);
    };
    const planResult = planGuiUpgrade({
      repoRoot: fixture.work,
      env: { PYTHON: 'python-fixture', NODE_ENV: 'production' },
      commandRunner,
    });
    assert.equal(planResult.data.recommended_next_step.id, 'clear_node_env_production');
    assert.equal(planResult.data.actions.some((action) => action.id === 'pip_install_backend_requirements'), true);
    assertActionContracts(planResult);
    assertNoForbiddenCommands(planResult);

    invoked.length = 0;
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      env: { PYTHON: 'python-fixture', NODE_ENV: 'production' },
      commandRunner,
    });
    assert.equal(applyResult.success, false);
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_UNSAFE_ACTIONS');
    assert.ok(applyResult.error.action_ids.includes('clear_node_env_production'));
    assert.equal(applyResult.data.recommended_next_step.id, 'clear_node_env_production');
    assert.equal(invoked.includes('python-fixture -m pip install -r backend/requirements.txt'), false);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture({ backendRequirements: true });
  try {
    const invoked = [];
    const commandRunner = (command, args, context) => {
      invoked.push(gitCommandId(command, args));
      return makeBackendCommandRunner({ version: '3.14.1', missingModules: ['fastapi'] })(command, args, context);
    };
    const planResult = planGuiUpgrade({
      repoRoot: fixture.work,
      env: { PYTHON: 'python-fixture' },
      commandRunner,
    });
    assert.equal(planResult.data.recommended_next_step.id, 'resolve_backend_python_version');
    assert.equal(planResult.data.actions.some((action) => action.id === 'pip_install_backend_requirements'), false);
    assertActionContracts(planResult);
    assertNoForbiddenCommands(planResult);

    invoked.length = 0;
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      env: { PYTHON: 'python-fixture' },
      commandRunner,
    });
    assert.equal(applyResult.success, false);
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_UNSAFE_ACTIONS');
    assert.ok(applyResult.error.action_ids.includes('resolve_backend_python_version'));
    assert.equal(invoked.includes('python-fixture -m pip install -r backend/requirements.txt'), false);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture({ installDevDeps: false });
  try {
    const { result, json: missingPlan } = plan(fixture.work);
    assert.equal(result.status, 0);
    assertGitRepoContract(missingPlan.data.repo);
    assertNodeContract(missingPlan.data.node);
    assert.equal(missingPlan.data.repo.freshness, 'current');
    assert.equal(missingPlan.data.node.dev_dependencies_present, false);
    assert.deepEqual(missingPlan.data.node.missing_dev_dependencies, requiredDevDeps);
    assert.equal(missingPlan.data.recommended_next_step.id, 'npm_ci_include_dev');
    assert.equal(missingPlan.data.recommended_next_step.command, 'npm ci --include=dev');
    assert.equal(missingPlan.data.recommended_next_step.side_effect, 'write');
    assert.equal(missingPlan.data.recommended_next_step.safe_to_run, true);
    assert.equal(missingPlan.data.recommended_next_step.requires_human, false);
    assertActionContracts(missingPlan);
    assertNoForbiddenCommands(missingPlan);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture({ installDevDeps: false });
  try {
    const remoteHead = addRemoteCommit(fixture, 'behind-missing-devdeps.md');
    git(fixture.work, ['fetch', 'origin']);
    const invoked = [];
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner(command, args, context) {
        const id = gitCommandId(command, args);
        invoked.push(id);
        if (id === 'npm --version') return { status: 0, stdout: '11.13.0\n', stderr: '' };
        if (id === 'npm config get omit') return { status: 0, stdout: '\n', stderr: '' };
        if (id === 'npm ci --include=dev') {
          installFixtureDevDeps(fixture.work);
          return { status: 0, stdout: 'installed after git\n', stderr: '' };
        }
        return runGitForInjection(command, args, context);
      },
    });

    assert.equal(applyResult.success, true);
    assert.equal(git(fixture.work, ['rev-parse', 'HEAD']), remoteHead);
    assert.ok(invoked.indexOf('git pull --ff-only') > -1);
    assert.ok(invoked.indexOf('npm ci --include=dev') > invoked.indexOf('git pull --ff-only'));
    assert.ok(invoked.indexOf('npm run verify-stack') > invoked.indexOf('npm ci --include=dev'));
    assert.deepEqual(applyResult.data.applied_actions, [
      { id: 'git_pull_ff_only', command: 'git pull --ff-only' },
      { id: 'npm_ci_include_dev', command: 'npm ci --include=dev' },
      { id: 'verify_stack', command: 'npm run verify-stack' },
      { id: 'sync_skill', command: 'npm run sync-skill' },
    ]);
    assert.equal(applyResult.data.node.dev_dependencies_present, true);
    assert.equal(applyResult.data.recommended_next_step.id, 'none');
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    addRemoteCommit(fixture, 'behind-node-env-production.md');
    git(fixture.work, ['fetch', 'origin']);
    const localHead = git(fixture.work, ['rev-parse', 'HEAD']);
    const planResult = planGuiUpgrade({
      repoRoot: fixture.work,
      env: { ...process.env, NODE_ENV: 'production' },
      commandRunner(command, args, context) {
        const id = gitCommandId(command, args);
        if (id === 'npm --version') return { status: 0, stdout: '11.13.0\n', stderr: '' };
        if (id === 'npm config get omit') return { status: 0, stdout: '\n', stderr: '' };
        return runGitForInjection(command, args, context);
      },
    });
    assert.equal(planResult.data.repo.freshness, 'behind');
    assert.equal(planResult.data.actions.some((action) => action.id === 'git_pull_ff_only'), true);
    assert.equal(planResult.data.recommended_next_step.id, 'clear_node_env_production');
    assert.equal(planResult.data.recommended_next_step.safe_to_run, false);
    assert.equal(planResult.data.recommended_next_step.requires_human, true);
    assertActionContracts(planResult);
    assertNoForbiddenCommands(planResult);

    const invoked = [];
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      env: { ...process.env, NODE_ENV: 'production' },
      commandRunner(command, args, context) {
        const id = gitCommandId(command, args);
        invoked.push(id);
        if (id === 'npm --version') return { status: 0, stdout: '11.13.0\n', stderr: '' };
        if (id === 'npm config get omit') return { status: 0, stdout: '\n', stderr: '' };
        return runGitForInjection(command, args, context);
      },
    });
    assert.equal(applyResult.success, false);
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_UNSAFE_ACTIONS');
    assert.ok(applyResult.error.action_ids.includes('clear_node_env_production'));
    assert.equal(applyResult.data.recommended_next_step.id, 'clear_node_env_production');
    assert.equal(invoked.includes('git pull --ff-only'), false);
    assert.equal(invoked.includes('npm ci --include=dev'), false);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assert.equal(git(fixture.work, ['rev-parse', 'HEAD']), localHead);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    addRemoteCommit(fixture, 'behind-npm-omit-dev.md');
    git(fixture.work, ['fetch', 'origin']);
    const localHead = git(fixture.work, ['rev-parse', 'HEAD']);
    const planResult = planGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner(command, args, context) {
        const id = gitCommandId(command, args);
        if (id === 'npm --version') return { status: 0, stdout: '11.13.0\n', stderr: '' };
        if (id === 'npm config get omit') return { status: 0, stdout: 'dev\n', stderr: '' };
        return runGitForInjection(command, args, context);
      },
    });
    assert.equal(planResult.data.repo.freshness, 'behind');
    assert.equal(planResult.data.actions.some((action) => action.id === 'git_pull_ff_only'), true);
    assert.equal(planResult.data.recommended_next_step.id, 'restore_npm_omit_dev');
    assert.equal(planResult.data.recommended_next_step.safe_to_run, false);
    assert.equal(planResult.data.recommended_next_step.requires_human, true);
    assertActionContracts(planResult);
    assertNoForbiddenCommands(planResult);

    const invoked = [];
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner(command, args, context) {
        const id = gitCommandId(command, args);
        invoked.push(id);
        if (id === 'npm --version') return { status: 0, stdout: '11.13.0\n', stderr: '' };
        if (id === 'npm config get omit') return { status: 0, stdout: 'dev\n', stderr: '' };
        return runGitForInjection(command, args, context);
      },
    });
    assert.equal(applyResult.success, false);
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_UNSAFE_ACTIONS');
    assert.ok(applyResult.error.action_ids.includes('restore_npm_omit_dev'));
    assert.equal(applyResult.data.recommended_next_step.id, 'restore_npm_omit_dev');
    assert.equal(invoked.includes('git pull --ff-only'), false);
    assert.equal(invoked.includes('npm ci --include=dev'), false);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assert.equal(git(fixture.work, ['rev-parse', 'HEAD']), localHead);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture({ installDevDeps: false });
  try {
    const invoked = [];
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner(command, args, context) {
        const id = gitCommandId(command, args);
        invoked.push(id);
        if (id === 'npm --version') return { status: 0, stdout: '11.13.0\n', stderr: '' };
        if (id === 'npm config get omit') return { status: 0, stdout: '\n', stderr: '' };
        if (id === 'npm ci --include=dev') {
          installFixtureDevDeps(fixture.work);
          return { status: 0, stdout: 'installed dev dependencies\n', stderr: '' };
        }
        return runGitForInjection(command, args, context);
      },
    });

    assert.equal(applyResult.success, true);
    assert.equal(applyResult.mode, 'apply');
    assert.ok(invoked.includes('npm ci --include=dev'));
    assert.ok(invoked.indexOf('npm run verify-stack') > invoked.indexOf('npm ci --include=dev'));
    assert.deepEqual(applyResult.data.applied_actions, [
      { id: 'npm_ci_include_dev', command: 'npm ci --include=dev' },
      { id: 'verify_stack', command: 'npm run verify-stack' },
      { id: 'sync_skill', command: 'npm run sync-skill' },
    ]);
    assert.equal(applyResult.data.node.dev_dependencies_present, true);
    assert.deepEqual(applyResult.data.node.missing_dev_dependencies, []);
    assert.equal(applyResult.data.recommended_next_step.id, 'none');
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture({ installDevDeps: false });
  try {
    const invoked = [];
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner(command, args, context) {
        const id = gitCommandId(command, args);
        invoked.push(id);
        if (id === 'npm --version') return { status: 0, stdout: '11.13.0\n', stderr: '' };
        if (id === 'npm config get omit') return { status: 0, stdout: '\n', stderr: '' };
        if (id === 'npm ci --include=dev') {
          return {
            status: 1,
            stdout: 'npm ci stdout\n',
            stderr: 'npm ci failed\n',
            message: 'simulated npm ci failure',
          };
        }
        return runGitForInjection(command, args, context);
      },
    });

    assert.equal(applyResult.success, false);
    assert.equal(applyResult.mode, 'apply');
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_NPM_CI_FAILED');
    assert.match(applyResult.data.npm_error.stdout, /npm ci stdout/);
    assert.match(applyResult.data.npm_error.stderr, /npm ci failed/);
    assert.match(applyResult.data.npm_error.message, /simulated npm ci failure/);
    assert.equal(invoked.includes('npm ci --include=dev'), true);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture({ installDevDeps: false });
  try {
    const planResult = runGuiUpgradeWithEnv(['--plan', '--json'], {
      cwd: fixture.work,
      env: { NODE_ENV: 'production' },
    });
    assert.equal(planResult.stderr, '', `plan stderr must stay empty: ${planResult.stderr}`);
    const productionPlan = parseStdoutJson(planResult);
    assert.equal(productionPlan.success, true);
    assertNodeContract(productionPlan.data.node);
    assert.equal(productionPlan.data.node.node_env, 'production');
    assert.equal(productionPlan.data.recommended_next_step.id, 'clear_node_env_production');
    assert.equal(productionPlan.data.recommended_next_step.safe_to_run, false);
    assert.equal(productionPlan.data.recommended_next_step.requires_human, true);
    assert.match(productionPlan.data.recommended_next_step.suggested_manual_resolution.posix, /unset NODE_ENV/);
    assert.match(productionPlan.data.recommended_next_step.suggested_manual_resolution.powershell, /\$env:NODE_ENV/);
    assertActionContracts(productionPlan);
    assertNoForbiddenCommands(productionPlan);

    const invoked = [];
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      env: { ...process.env, NODE_ENV: 'production' },
      commandRunner(command, args, context) {
        const id = gitCommandId(command, args);
        invoked.push(id);
        if (id === 'npm --version') return { status: 0, stdout: '11.13.0\n', stderr: '' };
        if (id === 'npm config get omit') return { status: 0, stdout: '\n', stderr: '' };
        return runGitForInjection(command, args, context);
      },
    });
    assert.equal(applyResult.success, false);
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_UNSAFE_ACTIONS');
    assert.ok(applyResult.error.action_ids.includes('clear_node_env_production'));
    assert.equal(invoked.includes('npm ci --include=dev'), false);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture({ installDevDeps: false });
  try {
    const invoked = [];
    const omitPlan = planGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner(command, args, context) {
        const id = gitCommandId(command, args);
        invoked.push(id);
        if (id === 'npm --version') return { status: 0, stdout: '11.13.0\n', stderr: '' };
        if (id === 'npm config get omit') return { status: 0, stdout: 'dev\n', stderr: '' };
        return runGitForInjection(command, args, context);
      },
    });
    assert.equal(omitPlan.success, true);
    assertNodeContract(omitPlan.data.node);
    assert.deepEqual(omitPlan.data.node.npm_omit, ['dev']);
    assert.equal(omitPlan.data.recommended_next_step.id, 'restore_npm_omit_dev');
    assert.equal(omitPlan.data.recommended_next_step.safe_to_run, false);
    assert.equal(omitPlan.data.recommended_next_step.requires_human, true);
    assertActionContracts(omitPlan);
    assertNoForbiddenCommands(omitPlan);

    invoked.length = 0;
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner(command, args, context) {
        const id = gitCommandId(command, args);
        invoked.push(id);
        if (id === 'npm --version') return { status: 0, stdout: '11.13.0\n', stderr: '' };
        if (id === 'npm config get omit') return { status: 0, stdout: 'dev\n', stderr: '' };
        return runGitForInjection(command, args, context);
      },
    });
    assert.equal(applyResult.success, false);
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_UNSAFE_ACTIONS');
    assert.ok(applyResult.error.action_ids.includes('restore_npm_omit_dev'));
    assert.equal(invoked.includes('npm ci --include=dev'), false);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture({ installDevDeps: false });
  try {
    writeFileSync(join(fixture.work, 'dirty-missing-devdeps.md'), 'dirty must win\n');
    const invoked = [];
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner(command, args, context) {
        const id = gitCommandId(command, args);
        invoked.push(id);
        if (id === 'npm --version') return { status: 0, stdout: '11.13.0\n', stderr: '' };
        if (id === 'npm config get omit') return { status: 0, stdout: '\n', stderr: '' };
        return runGitForInjection(command, args, context);
      },
    });
    assert.equal(applyResult.success, false);
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_UNSAFE_ACTIONS');
    assert.deepEqual(applyResult.error.action_ids, ['resolve_dirty_worktree']);
    assert.equal(applyResult.data.recommended_next_step.id, 'resolve_dirty_worktree');
    assert.equal(invoked.includes('npm ci --include=dev'), false);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture({ installDevDeps: false });
  try {
    commitFile(fixture.work, 'ahead-missing-devdeps.md', 'ahead must win\n', 'ahead missing devdeps');
    const invoked = [];
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner(command, args, context) {
        const id = gitCommandId(command, args);
        invoked.push(id);
        if (id === 'npm --version') return { status: 0, stdout: '11.13.0\n', stderr: '' };
        if (id === 'npm config get omit') return { status: 0, stdout: '\n', stderr: '' };
        return runGitForInjection(command, args, context);
      },
    });
    assert.equal(applyResult.success, false);
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_UNSAFE_ACTIONS');
    assert.deepEqual(applyResult.error.action_ids, ['resolve_ahead_branch']);
    assert.equal(applyResult.data.recommended_next_step.id, 'resolve_ahead_branch');
    assert.equal(invoked.includes('npm ci --include=dev'), false);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture({ installDevDeps: false });
  try {
    commitFile(fixture.work, 'diverged-local-missing-devdeps.md', 'local must win\n', 'local missing devdeps');
    addRemoteCommit(fixture, 'diverged-remote-missing-devdeps.md');
    git(fixture.work, ['fetch', 'origin']);
    const invoked = [];
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner(command, args, context) {
        const id = gitCommandId(command, args);
        invoked.push(id);
        if (id === 'npm --version') return { status: 0, stdout: '11.13.0\n', stderr: '' };
        if (id === 'npm config get omit') return { status: 0, stdout: '\n', stderr: '' };
        return runGitForInjection(command, args, context);
      },
    });
    assert.equal(applyResult.success, false);
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_UNSAFE_ACTIONS');
    assert.deepEqual(applyResult.error.action_ids, ['resolve_diverged_branch']);
    assert.equal(applyResult.data.recommended_next_step.id, 'resolve_diverged_branch');
    assert.equal(invoked.includes('npm ci --include=dev'), false);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    writeFileSync(join(fixture.work, 'dirty-note.md'), 'dirty worktree must block apply\n');
    const { result, json: dirtyPlan } = plan(fixture.work);
    assert.equal(result.status, 0);
    assertGitRepoContract(dirtyPlan.data.repo);
    assert.equal(dirtyPlan.data.repo.dirty, true);
    assert.equal(dirtyPlan.data.repo.freshness, 'dirty');
    const dirtyAction = dirtyPlan.data.actions.find((action) => action.id === 'resolve_dirty_worktree');
    assert.ok(dirtyAction, 'dirty plan must include resolve_dirty_worktree');
    assert.equal(dirtyAction.side_effect, 'read');
    assert.equal(dirtyAction.command, 'git status --porcelain');
    assert.equal(dirtyAction.safe_to_run, false);
    assert.equal(dirtyAction.requires_human, true);
    assert.match(dirtyAction.suggested_manual_resolution, /commit, stash, or discard/i);
    assertActionContracts(dirtyPlan);
    assertNoForbiddenCommands(dirtyPlan);

    assertBlockedApply(fixture.work, 'resolve_dirty_worktree');
    assert.match(readFileSync(join(fixture.work, 'dirty-note.md'), 'utf8'), /dirty worktree/);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    const localHead = commitFile(fixture.work, 'local-ahead.md', 'local-only\n', 'local ahead');
    const { json: aheadPlan } = plan(fixture.work);
    assert.equal(aheadPlan.data.repo.ahead, 1);
    assert.equal(aheadPlan.data.repo.behind, 0);
    assert.equal(aheadPlan.data.repo.diverged, false);
    assert.equal(aheadPlan.data.repo.freshness, 'ahead');
    assert.equal(aheadPlan.data.recommended_next_step.id, 'resolve_ahead_branch');
    assert.equal(aheadPlan.data.recommended_next_step.command, 'git status --porcelain');
    assert.equal(aheadPlan.data.recommended_next_step.side_effect, 'read');
    assert.equal(aheadPlan.data.recommended_next_step.safe_to_run, false);
    assertActionContracts(aheadPlan);
    assertNoForbiddenCommands(aheadPlan);

    assertBlockedApply(fixture.work, 'resolve_ahead_branch');
    assert.equal(git(fixture.work, ['rev-parse', 'HEAD']), localHead);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    const remoteHead = addRemoteCommit(fixture, 'behind.md');
    git(fixture.work, ['fetch', 'origin']);
    const { json: behindPlan } = plan(fixture.work);
    assert.equal(behindPlan.data.repo.ahead, 0);
    assert.equal(behindPlan.data.repo.behind, 1);
    assert.equal(behindPlan.data.repo.diverged, false);
    assert.equal(behindPlan.data.repo.freshness, 'behind');
    assert.equal(behindPlan.data.recommended_next_step.id, 'git_pull_ff_only');
    assert.equal(behindPlan.data.recommended_next_step.side_effect, 'write');
    assert.equal(behindPlan.data.recommended_next_step.command, 'git pull --ff-only');
    assert.equal(behindPlan.data.recommended_next_step.safe_to_run, true);
    assert.equal(behindPlan.data.recommended_next_step.requires_human, false);
    assertActionContracts(behindPlan);
    assertNoForbiddenCommands(behindPlan);

    const applyResult = apply(fixture.work);
    assert.equal(applyResult.result.status, 0);
    assert.equal(applyResult.json.success, true);
    assert.ok(applyResult.json.data.applied_actions.some((action) => action.id === 'git_pull_ff_only'));
    assert.ok(applyResult.json.data.applied_actions.some((action) => action.id === 'verify_stack'));
    assert.equal(git(fixture.work, ['rev-parse', 'HEAD']), remoteHead);
    assert.equal(applyResult.json.data.repo.freshness, 'current');
    assert.equal(applyResult.json.data.recommended_next_step.id, 'none');
    assertNoForbiddenCommands(applyResult.json);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    const localHead = commitFile(fixture.work, 'local-diverged.md', 'local-only\n', 'local diverged');
    addRemoteCommit(fixture, 'remote-diverged.md');
    git(fixture.work, ['fetch', 'origin']);
    const { json: divergedPlan } = plan(fixture.work);
    assert.equal(divergedPlan.data.repo.ahead, 1);
    assert.equal(divergedPlan.data.repo.behind, 1);
    assert.equal(divergedPlan.data.repo.diverged, true);
    assert.equal(divergedPlan.data.repo.freshness, 'diverged');
    assert.equal(divergedPlan.data.recommended_next_step.id, 'resolve_diverged_branch');
    assert.equal(divergedPlan.data.recommended_next_step.command, 'git status --porcelain');
    assert.equal(divergedPlan.data.recommended_next_step.side_effect, 'read');
    assert.equal(divergedPlan.data.recommended_next_step.safe_to_run, false);
    assertActionContracts(divergedPlan);
    assertNoForbiddenCommands(divergedPlan);

    assertBlockedApply(fixture.work, 'resolve_diverged_branch');
    assert.equal(git(fixture.work, ['rev-parse', 'HEAD']), localHead);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const root = makeLocalFixture();
  try {
    const { json: noUpstreamPlan } = plan(root);
    assert.equal(noUpstreamPlan.data.partial, true);
    assert.equal(noUpstreamPlan.data.repo.upstream, null);
    assert.equal(noUpstreamPlan.data.repo.freshness, 'unknown');
    assert.equal(noUpstreamPlan.data.repo.remote_probe.status, 'unknown_upstream');
    assert.notEqual(noUpstreamPlan.data.recommended_next_step.id, 'none');
    assertActionContracts(noUpstreamPlan);
    assertNoForbiddenCommands(noUpstreamPlan);
    assertBlockedApply(root, 'resolve_unknown_git_freshness');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    git(fixture.work, ['checkout', '--detach', 'HEAD']);
    const { json: detachedPlan } = plan(fixture.work);
    assert.equal(detachedPlan.data.partial, true);
    assert.equal(detachedPlan.data.repo.branch, null);
    assert.equal(detachedPlan.data.repo.freshness, 'unknown');
    assert.equal(detachedPlan.data.repo.remote_probe.status, 'unknown_upstream');
    assert.notEqual(detachedPlan.data.recommended_next_step.id, 'none');
    assertActionContracts(detachedPlan);
    assertNoForbiddenCommands(detachedPlan);
    assertBlockedApply(fixture.work, 'resolve_unknown_git_freshness');
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    git(fixture.work, ['remote', 'set-url', 'origin', join(fixture.base, 'missing.git')]);
    const { json: unreachablePlan } = plan(fixture.work);
    assert.equal(unreachablePlan.data.partial, true);
    assert.equal(unreachablePlan.data.repo.freshness, 'unknown');
    assert.equal(unreachablePlan.data.repo.remote_probe.status, 'unreachable');
    assert.match(unreachablePlan.data.repo.remote_probe.error, /repository|does not appear|Could not read|not found/i);
    assert.notEqual(unreachablePlan.data.recommended_next_step.id, 'none');
    assertActionContracts(unreachablePlan);
    assertNoForbiddenCommands(unreachablePlan);
    assertBlockedApply(fixture.work, 'resolve_unknown_git_freshness');
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    addRemoteCommit(fixture, 'pull-failure.md');
    git(fixture.work, ['fetch', 'origin']);
    const localHead = git(fixture.work, ['rev-parse', 'HEAD']);
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner(command, args, context) {
        if (gitCommandId(command, args) === 'git pull --ff-only') {
          return {
            status: 1,
            stdout: 'simulated pull stdout\n',
            stderr: 'simulated pull failure\n',
            message: 'simulated pull failed',
          };
        }
        return runGitForInjection(command, args, context);
      },
    });

    assert.equal(applyResult.success, false);
    assert.equal(applyResult.mode, 'apply');
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_GIT_PULL_FAILED');
    assert.match(applyResult.data.git_error.stdout, /simulated pull stdout/);
    assert.match(applyResult.data.git_error.stderr, /simulated pull failure/);
    assert.match(applyResult.data.git_error.message, /simulated pull failed/);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assert.equal(git(fixture.work, ['rev-parse', 'HEAD']), localHead);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    addRemoteCommit(fixture, 'fetch-failure.md');
    const localHead = git(fixture.work, ['rev-parse', 'HEAD']);
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner(command, args, context) {
        if (gitCommandId(command, args) === 'git fetch --prune') {
          return {
            status: 1,
            stdout: 'simulated fetch stdout\n',
            stderr: 'simulated fetch failure\n',
            message: 'simulated fetch failed',
          };
        }
        return runGitForInjection(command, args, context);
      },
    });

    assert.equal(applyResult.success, false);
    assert.equal(applyResult.mode, 'apply');
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_GIT_FETCH_FAILED');
    assert.match(applyResult.data.git_error.stdout, /simulated fetch stdout/);
    assert.match(applyResult.data.git_error.stderr, /simulated fetch failure/);
    assert.match(applyResult.data.git_error.message, /simulated fetch failed/);
    assert.deepEqual(applyResult.data.applied_actions, []);
    assert.equal(git(fixture.work, ['rev-parse', 'HEAD']), localHead);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    addRemoteCommit(fixture, 'recheck-unsafe.md');
    const localHead = git(fixture.work, ['rev-parse', 'HEAD']);
    const invoked = [];
    const applyResult = applyGuiUpgrade({
      repoRoot: fixture.work,
      commandRunner(command, args, context) {
        const id = gitCommandId(command, args);
        invoked.push(id);
        const result = runGitForInjection(command, args, context);
        if (id === 'git fetch --prune' && result.status === 0) {
          writeFileSync(join(fixture.work, 'unsafe-after-fetch.md'), 'dirty after fetch\n');
        }
        return result;
      },
    });

    assert.equal(applyResult.success, false);
    assert.equal(applyResult.mode, 'apply');
    assert.equal(applyResult.error.code, 'GUI_UPGRADE_GIT_RECHECK_UNSAFE');
    assert.deepEqual(applyResult.data.applied_actions, [
      { id: 'git_fetch_prune', command: 'git fetch --prune' },
    ]);
    assert.equal(invoked.includes('git pull --ff-only'), false);
    assert.equal(git(fixture.work, ['rev-parse', 'HEAD']), localHead);
    assert.match(readFileSync(join(fixture.work, 'unsafe-after-fetch.md'), 'utf8'), /dirty after fetch/);
    assertNoForbiddenCommands(applyResult);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

{
  const fixture = makeRemoteFixture();
  try {
    const remoteHead = addRemoteCommit(fixture, 'stale-tracking.md');
    const { json: stalePlan } = plan(fixture.work);
    assert.equal(stalePlan.data.repo.ahead, 0);
    assert.equal(stalePlan.data.repo.behind, 0);
    assert.equal(stalePlan.data.repo.freshness, 'behind');
    assert.equal(stalePlan.data.repo.remote_probe.status, 'stale_tracking');
    assert.equal(stalePlan.data.repo.remote_probe.remote_head, remoteHead);
    assert.equal(stalePlan.data.recommended_next_step.id, 'git_refresh_then_pull_ff_only');
    assert.equal(stalePlan.data.recommended_next_step.side_effect, 'write');
    assert.equal(stalePlan.data.recommended_next_step.command, 'git fetch --prune && git pull --ff-only');
    assert.equal(stalePlan.data.recommended_next_step.safe_to_run, true);
    assert.equal(stalePlan.data.recommended_next_step.requires_human, false);
    assertActionContracts(stalePlan);
    assertNoForbiddenCommands(stalePlan);

    const applyResult = apply(fixture.work);
    assert.equal(applyResult.result.status, 0);
    assert.equal(applyResult.json.success, true);
    assert.deepEqual(applyResult.json.data.applied_actions, [
      { id: 'git_fetch_prune', command: 'git fetch --prune' },
      { id: 'git_pull_ff_only', command: 'git pull --ff-only' },
      { id: 'verify_stack', command: 'npm run verify-stack' },
      { id: 'sync_skill', command: 'npm run sync-skill' },
    ]);
    assert.equal(git(fixture.work, ['rev-parse', 'HEAD']), remoteHead);
    assert.equal(applyResult.json.data.repo.freshness, 'current');
    assert.equal(applyResult.json.data.recommended_next_step.id, 'none');
    assertNoForbiddenCommands(applyResult.json);
  } finally {
    rmSync(fixture.base, { recursive: true, force: true });
  }
}

console.log('gui upgrade atom S5 verify-stack closure OK');
