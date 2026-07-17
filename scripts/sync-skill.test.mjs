import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const syncSkillScript = join(repoRoot, 'scripts', 'sync-skill.mjs');

function makeHome() {
  return mkdtempSync(join(tmpdir(), 'life-index-gui-skill-home-'));
}

function runSyncSkill(home, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [syncSkillScript, '--repo-root', repoRoot, '--json', ...extraArgs],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        LIFE_INDEX_GUI_SKILL_HOME: home,
      },
    },
  );
}

function parseJson(result) {
  assert.doesNotThrow(() => JSON.parse(result.stdout), `stdout must be JSON only, got: ${result.stdout}`);
  return JSON.parse(result.stdout);
}

const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
assert.equal(packageJson.scripts['sync-skill'], 'node scripts/sync-skill.mjs');

{
  const result = spawnSync(process.execPath, [syncSkillScript, '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--host-skill-dir <path>/);
}

{
  const home = makeHome();
  try {
    mkdirSync(join(home, '.hermes', 'skills'), { recursive: true });

    const result = runSyncSkill(home);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const json = parseJson(result);

    assert.equal(json.delivered, true);
    assert.equal(json.skill, 'life-index-gui');
    assert.equal(json.reason, undefined);
    assert.equal(json.repo_path, repoRoot);
    assert.equal(json.action, 'created');
    assert.equal(json.preserved_triggers, false);
    assert.equal(json.target, join(home, '.hermes', 'skills', 'life-index-gui', 'SKILL.md'));
    assert.equal(existsSync(json.target), true);

    const skillText = readFileSync(json.target, 'utf8');
    assert.match(skillText, /^name: life-index-gui$/m);
    assert.match(skillText, new RegExp(`GUI installation path: \`${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\``));
    assert.doesNotMatch(skillText, /\{\{GUI_INSTALL_PATH\}\}/);
    assert.match(skillText, /npm run dev:all/);
    assert.match(skillText, /http:\/\/127\.0\.0\.1:5173/);
    assert.match(skillText, /\/api\/health/);
    assert.match(skillText, /scripts\/stop-all\.mjs/);
    assert.match(skillText, /docs\/AGENT_UPDATE_PLAYBOOK\.md/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

{
  const home = makeHome();
  try {
    const result = runSyncSkill(home);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    const json = parseJson(result);
    assert.equal(json.delivered, false);
    assert.equal(json.reason, 'host_skill_directory_not_found');
    assert.match(json.message, /No host skill directory found/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

{
  const home = makeHome();
  try {
    const skillDir = join(home, '.claude', 'skills', 'life-index-gui');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: life-index-gui',
        'description: user customized trigger list',
        'triggers:',
        '  - open life index gui',
        '  - write a journal',
        '---',
        '',
        'old body',
        '',
      ].join('\n'),
    );

    const first = runSyncSkill(home);
    assert.equal(first.status, 0, first.stderr);
    const firstJson = parseJson(first);
    assert.equal(firstJson.delivered, true);
    assert.equal(firstJson.action, 'updated');
    assert.equal(firstJson.preserved_triggers, true);
    const firstText = readFileSync(firstJson.target, 'utf8');
    assert.match(firstText, /triggers:\n  - open life index gui\n  - write a journal/);
    assert.doesNotMatch(firstText, /old body/);

    const second = runSyncSkill(home);
    assert.equal(second.status, 0, second.stderr);
    const secondJson = parseJson(second);
    assert.equal(secondJson.action, 'unchanged');
    assert.equal(readFileSync(secondJson.target, 'utf8'), firstText);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

{
  const home = makeHome();
  try {
    mkdirSync(join(home, '.hermes', 'skills'), { recursive: true });
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
    const explicitTargetRoot = join(home, '.claude', 'skills');

    const result = runSyncSkill(home, ['--host-skill-dir', explicitTargetRoot]);
    assert.equal(result.status, 0, result.stderr);
    const json = parseJson(result);
    assert.equal(json.delivered, true);
    assert.equal(json.action, 'created');
    assert.equal(json.target, join(explicitTargetRoot, 'life-index-gui', 'SKILL.md'));
    assert.equal(existsSync(json.target), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

{
  const home = makeHome();
  try {
    const missingTargetRoot = join(home, '.hermes', 'skills');
    const result = runSyncSkill(home, ['--host-skill-dir', missingTargetRoot]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    const json = parseJson(result);
    assert.equal(json.delivered, false);
    assert.equal(json.reason, 'host_skill_directory_invalid');
    assert.match(json.message, /Host skill directory does not exist or is not a directory/);
    assert.equal(json.host_skill_dir, missingTargetRoot);
    assert.equal(existsSync(missingTargetRoot), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

{
  const home = makeHome();
  try {
    const fileTargetRoot = join(home, 'not-a-directory');
    writeFileSync(fileTargetRoot, 'not a skill registry');
    const result = runSyncSkill(home, ['--host-skill-dir', fileTargetRoot]);
    assert.equal(result.status, 1);
    const json = parseJson(result);
    assert.equal(json.delivered, false);
    assert.equal(json.reason, 'host_skill_directory_invalid');
    assert.equal(json.host_skill_dir, fileTargetRoot);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

{
  const home = makeHome();
  try {
    mkdirSync(join(home, '.hermes', 'skills'), { recursive: true });
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true });

    const result = runSyncSkill(home);
    assert.equal(result.status, 1);
    const json = parseJson(result);
    assert.equal(json.delivered, false);
    assert.equal(json.reason, 'ambiguous_host_skill_directories');
    assert.equal(json.candidates.length, 2);
    assert.match(json.hint, /npm run sync-skill -- --host-skill-dir/);
    assert.match(json.hint, /\.hermes/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

{
  const home = makeHome();
  try {
    mkdirSync(join(home, '.hermes', 'skills', 'life-index-gui'), { recursive: true });
    mkdirSync(join(home, '.hermes', 'skills', 'team', 'life-index-gui'), { recursive: true });

    const result = runSyncSkill(home);
    assert.equal(result.status, 1);
    const json = parseJson(result);
    assert.equal(json.delivered, false);
    assert.equal(json.reason, 'ambiguous_existing_skill_targets');
    assert.equal(json.candidates.length, 2);
    assert.match(json.hint, /npm run sync-skill -- --host-skill-dir/);
    assert.match(json.hint, /\.hermes/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
