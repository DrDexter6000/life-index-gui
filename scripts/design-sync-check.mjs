#!/usr/bin/env node
// design-sync-check.mjs — Verify CSS vars match design/tokens.json
// Zero dependencies. Node ≥22.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// --- Resolve a dot-separated path against a JSON object (supports array indices) ---
function resolvePath(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    // Try as object key first, then as array index
    if (typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      const idx = Number(part);
      if (Number.isInteger(idx) && Array.isArray(current)) {
        current = current[idx];
      } else {
        return undefined;
      }
    }
  }
  return current;
}

// --- Normalize a hex color for comparison (lowercase, strip whitespace) ---
function normalizeHex(value) {
  if (typeof value !== 'string') return String(value).trim().toLowerCase();
  return value.trim().toLowerCase();
}

// --- Extract CSS variable value from CSS text ---
function extractCssVar(cssText, varName) {
  // Match: --var-name: <value>;
  // The value may contain spaces, commas, etc. but ends at semicolon or newline.
  const re = new RegExp(`${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([^;\\n]+)`, 'm');
  const match = cssText.match(re);
  return match ? match[1].trim() : undefined;
}

// --- Main ---
const mapPath = resolve(root, 'scripts', 'design-sync.map.json');
const tokensPath = resolve(root, 'design', 'tokens.json');

const map = JSON.parse(readFileSync(mapPath, 'utf8'));
const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));

// Cache CSS file reads
const cssCache = new Map();

function getCssContent(filePath) {
  const absPath = resolve(root, filePath);
  if (!cssCache.has(absPath)) {
    cssCache.set(absPath, readFileSync(absPath, 'utf8'));
  }
  return cssCache.get(absPath);
}

let failures = 0;

for (const entry of map) {
  const tokenValue = resolvePath(tokens, entry.token);
  const cssContent = getCssContent(entry.expectIn);
  const cssValue = extractCssVar(cssContent, entry.cssVar);

  if (tokenValue === undefined) {
    console.error(`SYNC-FAIL ${entry.cssVar}: token path "${entry.token}" not found in tokens.json`);
    failures++;
    continue;
  }

  if (cssValue === undefined) {
    console.error(`SYNC-FAIL ${entry.cssVar}: CSS variable not found in ${entry.expectIn}`);
    failures++;
    continue;
  }

  if (normalizeHex(tokenValue) !== normalizeHex(cssValue)) {
    console.error(`SYNC-FAIL ${entry.cssVar}: tokens=${tokenValue} css=${cssValue}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\ndesign-sync: ${failures} mismatch(es) found`);
  process.exit(1);
}

console.log(`design-sync: ${map.length} tokens OK`);
process.exit(0);
