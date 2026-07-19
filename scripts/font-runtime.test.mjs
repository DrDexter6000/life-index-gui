import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (path) => readFileSync(join(repoRoot, path), 'utf8');

const packageJson = JSON.parse(readSource('package.json'));
const runtimeSources = [
  ['index.html', readSource('index.html')],
  ['src/main.tsx', readSource('src/main.tsx')],
  ['src/styles/tailwind.css', readSource('src/styles/tailwind.css')],
];

assert.equal(
  packageJson.dependencies?.['@fontsource/material-symbols-outlined'],
  '5.3.0',
  'outlined Material Symbols must be an exact production dependency',
);
assert.equal(
  packageJson.dependencies?.['@fontsource/material-symbols-rounded'],
  '5.3.0',
  'rounded Material Symbols must be an exact production dependency',
);

const main = readSource('src/main.tsx');
assert.match(main, /import ['"]@fontsource\/material-symbols-outlined\/400\.css['"]/);
assert.match(main, /import ['"]@fontsource\/material-symbols-rounded\/400\.css['"]/);

const styles = readSource('src/styles/tailwind.css');
const sharedIconRule = styles.match(
  /\.material-symbols-outlined,\s*\.material-symbols-rounded\s*\{([\s\S]*?)\}/,
);
assert.ok(sharedIconRule, 'both Material Symbols classes must share explicit display and ligature properties');
assert.match(sharedIconRule[1], /font-feature-settings:\s*['"]liga['"]/);
assert.match(sharedIconRule[1], /display:\s*inline-block/);

for (const [className, familyName] of [
  ['material-symbols-outlined', 'Material Symbols Outlined'],
  ['material-symbols-rounded', 'Material Symbols Rounded'],
]) {
  assert.match(
    styles,
    new RegExp(`\\.${className}\\s*\\{\\s*font-family:\\s*["']${familyName}["']`),
    `${className} must explicitly select its matching local icon font family`,
  );
}

for (const [path, source] of runtimeSources) {
  assert.doesNotMatch(
    source,
    /https?:\/\//i,
    `${path} must not contain an external runtime URL`,
  );
}

console.log('font runtime contract OK');
