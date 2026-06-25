import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * @vitest-environment node
 *
 * CSS contract test for DESIGN.md "The Panel Card Voice Rule".
 * Compact dashboard card titles should use the Control voice at about 1rem,
 * not the larger headline token.
 */

function readTailwindCss(): string {
  return readFileSync(resolve(import.meta.dirname, '..', 'styles', 'tailwind.css'), 'utf-8');
}

function getRuleBody(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) {
    throw new Error(`Missing CSS rule for ${selector}`);
  }
  return match[1];
}

describe('Panel card voice CSS contract', () => {
  it('keeps compact panel titles on the control typography level', () => {
    const ruleBody = getRuleBody(readTailwindCss(), '.li-panel-title');

    expect(ruleBody).toContain('font-family: var(--font-control);');
    expect(ruleBody).toContain('font-size: var(--text-control);');
    expect(ruleBody).not.toContain('font-size: var(--text-headline);');
  });
});
