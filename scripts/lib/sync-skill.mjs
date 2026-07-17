import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GUI_SKILL_NAME = 'life-index-gui';
export const SYNC_SKILL_COMMAND = 'npm run sync-skill';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(__dirname, '..', '..');

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function makeFailure(reason, message, extra = {}) {
  return {
    delivered: false,
    skill: GUI_SKILL_NAME,
    reason,
    message,
    ...extra,
  };
}

function commandPath(path) {
  return /\s/.test(path) ? `"${path}"` : path;
}

function disambiguationHint(candidate) {
  return `Run npm run sync-skill -- --host-skill-dir ${commandPath(candidate)} to choose this host skill registry.`;
}

function hostHome(env) {
  return resolve(
    env.LIFE_INDEX_GUI_SKILL_HOME
      || env.HOME
      || env.USERPROFILE
      || homedir(),
  );
}

function hostSkillRoots(homeDir) {
  return [
    join(homeDir, '.hermes', 'skills'),
    join(homeDir, '.claude', 'skills'),
  ];
}

function resolveExplicitHostSkillDir(hostSkillDir, env) {
  if (!hostSkillDir) return null;
  const homeDir = hostHome(env);
  if (hostSkillDir === '~') return homeDir;
  if (hostSkillDir.startsWith('~/') || hostSkillDir.startsWith('~\\')) {
    return resolve(homeDir, hostSkillDir.slice(2));
  }
  return resolve(hostSkillDir);
}

function findExistingTargets(root) {
  const targets = [];
  const direct = join(root, GUI_SKILL_NAME);
  if (isDirectory(direct)) targets.push(direct);

  if (!isDirectory(root)) return targets;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === GUI_SKILL_NAME) continue;
    const nested = join(root, entry.name, GUI_SKILL_NAME);
    if (isDirectory(nested)) targets.push(nested);
  }
  return targets;
}

function resolveSkillTarget(homeDir, { hostSkillDir } = {}) {
  if (hostSkillDir) {
    const explicitRoot = resolveExplicitHostSkillDir(hostSkillDir, { LIFE_INDEX_GUI_SKILL_HOME: homeDir });
    if (!isDirectory(explicitRoot)) {
      return makeFailure(
        'host_skill_directory_invalid',
        'Host skill directory does not exist or is not a directory; refusing to create the registry root.',
        { host_skill_dir: explicitRoot },
      );
    }
    return { delivered: true, targetDir: join(explicitRoot, GUI_SKILL_NAME) };
  }

  const roots = hostSkillRoots(homeDir).filter(isDirectory);
  const existingTargets = roots.flatMap(findExistingTargets);

  if (existingTargets.length > 1) {
    const targetRoots = existingTargets.map((target) => dirname(target));
    return makeFailure(
      'ambiguous_existing_skill_targets',
      `Multiple ${GUI_SKILL_NAME} skill targets were found; refusing to choose one.`,
      {
        candidates: existingTargets,
        hint: disambiguationHint(targetRoots[0]),
      },
    );
  }

  if (existingTargets.length === 1) {
    return { delivered: true, targetDir: existingTargets[0] };
  }

  if (roots.length === 0) {
    return makeFailure(
      'host_skill_directory_not_found',
      'No host skill directory found. Expected exactly one of ~/.hermes/skills or ~/.claude/skills.',
      { candidates: hostSkillRoots(homeDir) },
    );
  }

  if (roots.length > 1) {
    return makeFailure(
      'ambiguous_host_skill_directories',
      'Multiple host skill directories were found; refusing to choose one.',
      {
        candidates: roots,
        hint: disambiguationHint(roots[0]),
      },
    );
  }

  return { delivered: true, targetDir: join(roots[0], GUI_SKILL_NAME) };
}

function extractTriggersBlock(existingText) {
  if (!existingText.startsWith('---')) return '';
  const lines = existingText.split(/\r?\n/);
  if (lines[0] !== '---') return '';
  const closingIndex = lines.findIndex((line, index) => index > 0 && line === '---');
  if (closingIndex === -1) return '';

  const frontmatter = lines.slice(1, closingIndex);
  const start = frontmatter.findIndex((line) => /^triggers\s*:/.test(line));
  if (start === -1) return '';

  let end = start + 1;
  while (end < frontmatter.length) {
    const line = frontmatter[end];
    if (line.trim() === '') {
      end += 1;
      continue;
    }
    if (/^[A-Za-z0-9_-]+\s*:/.test(line)) break;
    end += 1;
  }

  return frontmatter.slice(start, end).join('\n');
}

function renderSkill({ template, repoRoot, triggersBlock }) {
  const triggerText = triggersBlock ? `${triggersBlock}\n` : '';
  return template
    .replaceAll('{{GUI_INSTALL_PATH}}', repoRoot)
    .replace('{{PRESERVED_TRIGGERS}}', triggerText);
}

export function syncGuiSkill({ repoRoot = defaultRepoRoot, env = process.env, hostSkillDir = null } = {}) {
  const resolvedRepoRoot = resolve(repoRoot);
  const homeDir = hostHome(env);
  const target = resolveSkillTarget(homeDir, { hostSkillDir });
  if (!target.delivered) return target;

  const templatePath = join(resolvedRepoRoot, 'skill', 'SKILL.md');
  if (!existsSync(templatePath)) {
    return makeFailure(
      'skill_template_not_found',
      `GUI skill template is missing: ${templatePath}`,
      { template: templatePath },
    );
  }

  const targetDir = target.targetDir;
  const targetPath = join(targetDir, 'SKILL.md');
  const existingText = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : null;
  const triggersBlock = existingText ? extractTriggersBlock(existingText) : '';
  const nextText = renderSkill({
    template: readFileSync(templatePath, 'utf8'),
    repoRoot: resolvedRepoRoot,
    triggersBlock,
  });

  mkdirSync(targetDir, { recursive: true });
  const action = existingText == null ? 'created' : (existingText === nextText ? 'unchanged' : 'updated');
  if (existingText !== nextText) writeFileSync(targetPath, nextText);

  return {
    delivered: true,
    skill: GUI_SKILL_NAME,
    repo_path: resolvedRepoRoot,
    target: targetPath,
    action,
    preserved_triggers: Boolean(triggersBlock),
  };
}
