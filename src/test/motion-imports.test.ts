import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC_DIR = path.resolve(__dirname, '..');
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', '.archive', 'prototype']);

function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        results.push(...collectSourceFiles(fullPath));
      }
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('motion import unification', () => {
  it('has zero imports from framer-motion — all should use motion/react', () => {
    const sourceFiles = collectSourceFiles(SRC_DIR);
    const violations: string[] = [];

    const selfPath = path.resolve(__dirname, 'motion-imports.test.ts');

    for (const filePath of sourceFiles) {
      // Skip this test file itself
      if (filePath === selfPath) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("from 'framer-motion'") || lines[i].includes('from "framer-motion"')) {
          const relativePath = path.relative(SRC_DIR, filePath);
          violations.push(`  ${relativePath}:${i + 1}: ${lines[i].trim()}`);
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} file(s) with 'framer-motion' imports:\n${violations.join('\n')}\n\nAll imports must use 'motion/react' instead.`
      );
    }
  });
});
