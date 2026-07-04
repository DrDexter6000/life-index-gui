import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('remote-link headless command helpers', () => {
  it('normalizes gui.remote_link.v1 and runs verify-stack before start', () => {
    const output = execFileSync(
      process.execPath,
      [resolve(process.cwd(), 'scripts', 'remote-link.test.mjs')],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    expect(output).toMatch(/remote-link helpers OK/);
  });
});
