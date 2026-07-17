#!/usr/bin/env node
import { syncGuiSkill } from './lib/sync-skill.mjs';

function parseArgs(argv) {
  const options = {
    repoRoot: process.cwd(),
    hostSkillDir: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--repo-root' && next) {
      options.repoRoot = next;
      index += 1;
    } else if (arg === '--host-skill-dir' && next) {
      options.hostSkillDir = next;
      index += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/sync-skill.mjs [--repo-root <path>] [--host-skill-dir <path>] [--json]');
      process.exit(0);
    } else {
      const failure = {
        delivered: false,
        skill: 'life-index-gui',
        reason: 'invalid_argument',
        message: `Unknown or incomplete argument: ${arg}`,
      };
      console.log(JSON.stringify(failure, null, 2));
      process.exit(1);
    }
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));
const result = syncGuiSkill({
  repoRoot: options.repoRoot,
  hostSkillDir: options.hostSkillDir,
  env: process.env,
});
console.log(JSON.stringify(result, null, 2));
process.exit(result.delivered ? 0 : 1);
