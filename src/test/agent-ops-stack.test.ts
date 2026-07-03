import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('agent ops stack script helpers', () => {
  it('keeps project-owned port detection semantics intact', () => {
    const output = execFileSync(
      process.execPath,
      [resolve(process.cwd(), 'scripts', 'agent-ops-stack.test.mjs')],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    expect(output).toMatch(/agent ops stack helpers OK/);
  });
});
