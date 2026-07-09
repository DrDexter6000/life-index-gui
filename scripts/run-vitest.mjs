#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDevEnvironment } from './lib/require-dev-env.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), '..');
const vitestBin = resolve(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');

export function buildVitestEnv(baseEnv = process.env) {
  return {
    ...baseEnv,
    NODE_ENV: 'test',
  };
}

export function runVitest(argv = process.argv.slice(2), options = {}) {
  const env = options.env ?? process.env;
  const guard = checkDevEnvironment({ env, command: 'npm run test' });
  if (!guard.ok) {
    (options.stderr ?? console.error)(guard.error.message);
    return 1;
  }

  const exists = options.exists ?? existsSync;
  if (!exists(vitestBin)) {
    (options.stderr ?? console.error)('Vitest is not installed. Run `npm install --include=dev` or `npm ci` first.');
    return 1;
  }

  const spawn = options.spawnSync ?? spawnSync;
  const result = spawn(process.execPath, [vitestBin, 'run', ...argv], {
    cwd: options.cwd ?? repoRoot,
    env: buildVitestEnv(env),
    stdio: 'inherit',
  });

  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  process.exit(runVitest());
}
