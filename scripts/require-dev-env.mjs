#!/usr/bin/env node

import { requireDevEnvironment } from './lib/require-dev-env.mjs';

function parseArgs(argv) {
  const options = { command: 'this command' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--command' && next) {
      options.command = next;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/require-dev-env.mjs --command "npm run build"');
      process.exit(0);
    } else {
      console.error(`Unknown or incomplete argument: ${arg}`);
      process.exit(2);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
process.exit(requireDevEnvironment({ command: options.command }));
