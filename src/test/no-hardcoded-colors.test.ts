import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { resolve, relative } from 'node:path';

/**
 * @vitest-environment node
 *
 * This test uses node:fs and node:path — it must run in a Node environment,
 * not jsdom, so that built-in modules resolve correctly.
 */

/**
 * Normalize Windows backslashes to forward slashes for consistent path matching.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Files that define CSS tokens (these contain hex by design)
 */
const TOKEN_DEFINITION_FILES = new Set([
  'src/styles/tailwind.css',
]);

/**
 * Files owned by other agents — not our responsibility.
 * Also covers their test files.
 */
const OTHER_AGENT_FILES = new Set([
  'src/app/routes/Recall.tsx',
  'src/components/editor/SimpleEditor.tsx',
  'src/components/editor/MetadataSidebar.tsx',
  'src/components/layout/BottomNavBar.tsx',
  'src/components/layout/HeroIntro.tsx',
  'src/components/layout/VideoBackground.tsx',
  'src/components/layout/ParticleCanvas.tsx',
  'src/components/journal/MarkdownRenderer.tsx',
  'src/App.tsx',
  'src/app/routes/Layout.tsx',
  // Test files for other agents' components
  'src/app/routes/Recall.test.tsx',
  'src/components/editor/SimpleEditor.test.tsx',
  'src/components/editor/MetadataSidebar.test.tsx',
  'src/components/layout/BottomNavBar.test.tsx',
  'src/components/journal/MarkdownRenderer.test.tsx',
]);

/**
 * Justified exceptions: hex values with no corresponding CSS var token,
 * or runtime data values used programmatically (not as CSS).
 *
 * Add file -> [line patterns] mapping for any justified hex.
 */
const JUSTIFIED_EXCEPTIONS: Record<string, string[]> = {
  // Zen-mode dim color — unique visual effect to blend text with dark background.
  // No token exists for this specific shade; --color-void (#0a0c12) is too dark.
  'src/app/routes/TheCore.tsx': ['#1a1f2c'],

  // FALLBACK_PALETTE for Nivo chart — runtime color data.
  // #67E8F9, #FF716C, #CBD5E1 have no design token equivalents.
  'src/components/archives/TopicPie.tsx': ['#67E8F9', '#FF716C', '#CBD5E1'],

  // Zod default value — runtime configuration, #CBD5E1 has no token.
  'src/lib/schemas.ts': ['#CBD5E1'],

  // ECharts canvas-rendered charts require concrete color values; CSS vars are not supported.
  // These hex values map directly to design tokens: gold #ffe792, cyan #85fff2, coral #ffb4a6,
  // lavender #C4B6FE, amber #F9873E, primary #e8eaf0, secondary #818695.
  'src/components/archives/MonthlyHeatmap.tsx': ['#ffe792', '#85fff2', '#ffb4a6', '#e8eaf0', '#818695'],
  'src/components/archives/PeopleGraph.tsx': ['#ffe792', '#85fff2', '#ffb4a6', '#C4B6FE', '#e8eaf0', '#F9873E', '#f0f2f8'],
};

/**
 * Regex to match hex color patterns: #RGB, #RRGGBB, #RRGGBBAA
 */
const HEX_COLOR_RE = /#[0-9a-fA-F]{3,8}\b/g;

function collectSourceFiles(): string[] {
  const projectRoot = resolve(import.meta.dirname, '..', '..');
  const files = globSync('src/**/*.{ts,tsx}', {
    cwd: projectRoot,
    exclude: ['src/test/**', 'node_modules/**'],
  });
  return files.map((f) => normalizePath(relative(projectRoot, resolve(projectRoot, f))));
}

function readFileLines(relativePath: string): string[] {
  const projectRoot = resolve(import.meta.dirname, '..', '..');
  const fullPath = resolve(projectRoot, relativePath);
  const content = readFileSync(fullPath, 'utf-8');
  return content.split('\n');
}

describe('No Hardcoded Hex Colors', () => {
  const files = collectSourceFiles();

  // Filter out files we should skip entirely
  const checkableFiles = files.filter((f) => {
    if (TOKEN_DEFINITION_FILES.has(f)) return false;
    if (OTHER_AGENT_FILES.has(f)) return false;
    return true;
  });

  for (const file of checkableFiles) {
    it(`${file} should contain no hardcoded hex colors`, () => {
      const lines = readFileLines(file);
      const exceptions = JUSTIFIED_EXCEPTIONS[file] ?? [];

      const violations: Array<{ line: number; hex: string }> = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let match: RegExpExecArray | null;
        const hexRE = new RegExp(HEX_COLOR_RE.source, 'g');
        while ((match = hexRE.exec(line)) !== null) {
          const hex = match[0];
          // Check if this hex is a justified exception
          if (!exceptions.includes(hex)) {
            violations.push({ line: i + 1, hex });
          }
        }
      }

      if (violations.length > 0) {
        const details = violations
          .map((v) => `  Line ${v.line}: ${v.hex}`)
          .join('\n');
        expect.fail(
          `Found ${violations.length} hardcoded hex color(s) in ${file}:\n${details}\n\n` +
            `Replace these with CSS var tokens (e.g. var(--color-primary), var(--color-muted)).\n` +
            `If truly justified, add to JUSTIFIED_EXCEPTIONS in this test file.`,
        );
      }
    });
  }

  it('should have at least some source files to check', () => {
    expect(checkableFiles.length).toBeGreaterThan(0);
  });
});
