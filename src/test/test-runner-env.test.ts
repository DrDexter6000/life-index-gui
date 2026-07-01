import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildVitestEnv } from '../../scripts/run-vitest.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('Vitest runner environment', () => {
  it('routes npm test through the environment-normalizing runner', () => {
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));

    expect(packageJson.scripts.test).toBe('node scripts/run-vitest.mjs');
  });

  it('forces NODE_ENV=test even when the caller has NODE_ENV=production', () => {
    const env = buildVitestEnv({
      NODE_ENV: 'production',
      LIFE_INDEX_TEST_MARKER: 'preserved',
    });

    expect(env.NODE_ENV).toBe('test');
    expect(env.LIFE_INDEX_TEST_MARKER).toBe('preserved');
  });
});
