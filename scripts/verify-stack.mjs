#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVerifyStack } from './lib/agent-ops-stack.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(__dirname, '..');

function parseArgs(argv) {
  const options = { repoRoot: defaultRepoRoot };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--repo-root' && next) {
      options.repoRoot = resolve(process.cwd(), next);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  return options;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const result = await runVerifyStack({ repoRoot: options.repoRoot });
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok && result.noOrphans ? 0 : 1);
