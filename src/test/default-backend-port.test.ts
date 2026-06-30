/**
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CANONICAL_BACKEND_PORT = '8000';
const CANONICAL_BACKEND_URL = `http://127.0.0.1:${CANONICAL_BACKEND_PORT}`;
const repoRoot = new URL('../../', import.meta.url);

function readRepoFile(relativePath: string) {
  return readFileSync(new URL(relativePath, repoRoot), 'utf8');
}

function countOccurrences(text: string, value: string) {
  return text.split(value).length - 1;
}

describe('default backend port contract', () => {
  it('keeps backend, Vite proxy, and mobile acceptance defaults aligned', () => {
    expect(readRepoFile('backend/config.py')).toContain(
      `PORT: int = int(os.environ.get("BACKEND_PORT", "${CANONICAL_BACKEND_PORT}"))`,
    );

    const viteConfig = readRepoFile('vite.config.ts');
    expect(countOccurrences(viteConfig, `process.env.BACKEND_URL || '${CANONICAL_BACKEND_URL}'`)).toBe(2);

    const mobileAcceptanceServer = readRepoFile('scripts/mobile-acceptance-server.mjs');
    expect(countOccurrences(
      mobileAcceptanceServer,
      `process.env.BACKEND_URL || '${CANONICAL_BACKEND_URL}'`,
    )).toBe(2);
    expect(mobileAcceptanceServer).not.toContain('http://127.0.0.1:8021');
  });

  it('keeps local development defaults on the canonical backend port', () => {
    const packageJson = JSON.parse(readRepoFile('package.json')) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.['dev:backend']).toContain(`--port ${CANONICAL_BACKEND_PORT}`);

    const envExample = readRepoFile('.env.example');
    expect(envExample).toContain(`BACKEND_PORT=${CANONICAL_BACKEND_PORT}`);
    expect(envExample).toContain(`BACKEND_URL=${CANONICAL_BACKEND_URL}`);
  });
});
