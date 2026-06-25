#!/usr/bin/env node
// design-lint.mjs — Enforce design rules with ratchet baseline
// Zero dependencies. Node ≥22.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// --- CLI args ---
const args = process.argv.slice(2);
const writeBaseline = args.includes('--write-baseline');

// --- Load config ---
const configPath = resolve(root, 'scripts', 'design-lint.config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

// --- Load baseline (if not --write-baseline) ---
let baseline = {};
if (!writeBaseline) {
  try {
    const bp = resolve(root, 'scripts', 'design-lint.baseline.json');
    baseline = JSON.parse(readFileSync(bp, 'utf8'));
  } catch {
    console.error('design-lint: baseline file not found. Run with --write-baseline first.');
    process.exit(1);
  }
}

// --- Glob to regex ---
// Process glob tokens BEFORE escaping regex specials.
function globToRegex(pattern) {
  const segments = [];
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      segments.push({ type: 'globstar' });
      i += 2;
      if (pattern[i] === '/') i++;
    } else if (pattern[i] === '*') {
      segments.push({ type: 'star' });
      i++;
    } else if (pattern[i] === '?') {
      segments.push({ type: 'question' });
      i++;
    } else if (pattern[i] === '{') {
      const end = pattern.indexOf('}', i);
      if (end === -1) {
        segments.push({ type: 'literal', value: '{' });
        i++;
      } else {
        const inner = pattern.slice(i + 1, end);
        const options = inner.split(',').map(o => o.trim());
        segments.push({ type: 'alternation', options });
        i = end + 1;
      }
    } else {
      let lit = '';
      while (i < pattern.length && !'*?{'.includes(pattern[i])) {
        lit += pattern[i];
        i++;
      }
      segments.push({ type: 'literal', value: lit });
    }
  }

  let regexStr = '';
  for (const seg of segments) {
    switch (seg.type) {
      case 'globstar':
        regexStr += '(?:.*\\/)?';
        break;
      case 'star':
        regexStr += '[^/]*';
        break;
      case 'question':
        regexStr += '[^/]';
        break;
      case 'alternation':
        regexStr += '(' + seg.options.map(o => escapeRegex(o)).join('|') + ')';
        break;
      case 'literal':
        regexStr += escapeRegex(seg.value);
        break;
    }
  }
  return new RegExp('^' + regexStr + '$');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchSimple(str, pattern) {
  const p = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp('^' + p + '$').test(str);
}

// --- Collect files matching glob ---
function collectFiles(dir, pattern, excludePatterns) {
  const results = [];
  const regex = globToRegex(pattern);

  function walk(d) {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      const full = join(d, entry.name);
      const rel = relative(root, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && regex.test(rel)) {
        const excluded = excludePatterns.some(exc => {
          if (exc.includes('/')) {
            const norm = exc.replace(/\/?\*\*\/?/, '');
            return rel.startsWith(norm) || rel.includes(norm);
          }
          const base = rel.split('/').pop();
          return matchSimple(base, exc);
        });
        if (!excluded) {
          results.push(rel);
        }
      }
    }
  }

  walk(dir);
  return results.sort();
}

// --- Scan a file for a rule ---
function scanFile(filePath, rule, ruleId) {
  const fullPath = resolve(root, filePath);
  let content;
  try {
    content = readFileSync(fullPath, 'utf8');
  } catch { return { violations: [], escapes: 0 }; }

  const lines = content.split('\n');
  const re = new RegExp(rule.pattern, rule.flags || '');
  const violations = [];
  let escapes = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Check escape hatch first
    const escapePattern = `design-ok ${ruleId}`;
    if (line.includes(escapePattern)) {
      escapes++;
      continue;
    }
    // Check rule pattern
    if (re.test(line)) {
      violations.push({ file: filePath, line: i + 1, text: line.trim() });
    }
  }

  return { violations, escapes };
}

// --- Main scan ---
const allFiles = collectFiles(root, config.scanGlob, config.excludePatterns);
console.log(`design-lint: scanning ${allFiles.length} files`);

const rules = config.rules;
const ruleIds = Object.keys(rules);

// Per-file, per-rule counts
const fileViolations = {}; // { "relative/path.tsx": { "rule-id": count } }
let totalEscapes = 0;
const ruleTotals = {};     // { "rule-id": total_count }

for (const ruleId of ruleIds) {
  const rule = rules[ruleId];
  ruleTotals[ruleId] = 0;

  // Determine files to scan for this rule
  let filesToScan = allFiles;
  if (rule.scopeGlob) {
    const scopeRegex = globToRegex(rule.scopeGlob);
    filesToScan = allFiles.filter(f => scopeRegex.test(f));
  }

  for (const file of filesToScan) {
    // Check blur whitelist
    if (ruleId === 'blur-whitelist' && rule.whitelist) {
      const norm = file.replace(/\\/g, '/');
      if (rule.whitelist.includes(norm)) continue; // whitelisted file, skip entirely
    }

    const result = scanFile(file, rule, ruleId);
    if (result.violations.length > 0) {
      if (!fileViolations[file]) fileViolations[file] = {};
      fileViolations[file][ruleId] = result.violations.length;
      ruleTotals[ruleId] += result.violations.length;
    }
    totalEscapes += result.escapes;
  }
}

// --- --write-baseline mode ---
if (writeBaseline) {
  writeFileSync(
    resolve(root, 'scripts', 'design-lint.baseline.json'),
    JSON.stringify(fileViolations, null, 2) + '\n'
  );
  console.log(`design-lint: baseline written (${Object.keys(fileViolations).length} files)`);
  // Print first-scan statistics
  printStats();
  process.exit(0);
}

// --- Ratchet check ---
let excess = false;
const excessDetails = [];

for (const [file, rules_map] of Object.entries(fileViolations)) {
  const baseFile = baseline[file] || {};
  for (const [ruleId, count] of Object.entries(rules_map)) {
    const baseCount = baseFile[ruleId] || 0;
    if (count > baseCount) {
      excess = true;
      excessDetails.push({
        file,
        ruleId,
        baseline: baseCount,
        current: count,
      });
      console.error(
        `design-lint: EXCESS ${ruleId} in ${file}: baseline=${baseCount} current=${count}`
      );
    }
  }
}

// Check for files that lowered their count (ratchet hint)
for (const [file, rules_map] of Object.entries(fileViolations)) {
  const baseFile = baseline[file] || {};
  for (const [ruleId, count] of Object.entries(rules_map)) {
    const baseCount = baseFile[ruleId] || 0;
    if (count < baseCount) {
      console.log(
        `ratchet: you may lower baseline for ${file} ${ruleId}: ${baseCount} → ${count}`
      );
    }
  }
}

// Also check baseline files that now have 0 violations
for (const [file, rules_map] of Object.entries(baseline)) {
  if (!fileViolations[file]) {
    for (const ruleId of Object.keys(rules_map)) {
      console.log(
        `ratchet: you may remove ${file} from baseline (${ruleId}: ${rules_map[ruleId]} → 0)`
      );
    }
  }
}

// Print escape hatch count
console.log(`design-lint: ${totalEscapes} escape hatch(es) in use`);

if (excess) {
  console.error(`\ndesign-lint: ${excessDetails.length} excess violation(s) found`);
  process.exit(1);
}

console.log(`design-lint: all counts within baseline`);
process.exit(0);

// --- Stats printer ---
function printStats() {
  console.log('\n--- First-scan statistics ---');
  const totalAll = Object.values(ruleTotals).reduce((a, b) => a + b, 0);
  console.log(`Total violations: ${totalAll}`);
  for (const ruleId of ruleIds) {
    console.log(`  ${ruleId}: ${ruleTotals[ruleId]}`);
  }

  // Top 10 files by total violations
  const fileTotals = {};
  for (const [file, rules_map] of Object.entries(fileViolations)) {
    fileTotals[file] = Object.values(rules_map).reduce((a, b) => a + b, 0);
  }
  const sorted = Object.entries(fileTotals).sort((a, b) => b[1] - a[1]);
  console.log('\nTop 10 files by violation count:');
  for (let i = 0; i < Math.min(10, sorted.length); i++) {
    const [file, count] = sorted[i];
    const breakdown = Object.entries(fileViolations[file])
      .map(([r, c]) => `${r}=${c}`)
      .join(', ');
    console.log(`  ${count.toString().padStart(4)}  ${file}  (${breakdown})`);
  }
}
