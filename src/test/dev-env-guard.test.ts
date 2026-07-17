import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

function runGuard(nodeEnv?: string) {
  const env = { ...process.env };
  if (nodeEnv === undefined) {
    delete env.NODE_ENV;
  } else {
    env.NODE_ENV = nodeEnv;
  }

  return spawnSync(
    process.execPath,
    ['scripts/require-dev-env.mjs', '--command', 'npm run build'],
    {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
    },
  );
}

describe('dev dependency NODE_ENV guard', () => {
  it('fails clearly when NODE_ENV=production', () => {
    const result = runGuard('production');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NODE_ENV=production');
    expect(result.stderr).toContain('npm run build');
    expect(result.stderr).toContain('requires devDependencies');
    expect(result.stderr).toContain('unset NODE_ENV');
    expect(result.stderr).toContain("$env:NODE_ENV=''");
    expect(result.stderr).toContain('npm ci --include=dev');
    expect(result.stderr).not.toMatch(/Cannot find module|MODULE_NOT_FOUND/i);
  });

  it('passes when NODE_ENV is not production', () => {
    const result = runGuard(undefined);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('guards package scripts that directly require devDependencies', () => {
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
    const scripts = packageJson.scripts as Record<string, string>;

    for (const scriptName of [
      'dev',
      'dev:all',
      'build',
      'preview',
      'lint',
      'mobile:acceptance',
      'test',
      'test:watch',
      'verify-stack',
      'smoke:e2e',
      'smoke:d3',
    ]) {
      const prescript = scripts[`pre${scriptName}`];
      expect(prescript, `pre${scriptName}`).toContain('node scripts/require-dev-env.mjs');
      expect(prescript, `pre${scriptName}`).toContain(`npm run ${scriptName}`);
    }
  });
});
