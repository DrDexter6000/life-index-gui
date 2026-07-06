#!/usr/bin/env node

import { resolve } from 'node:path';
import { scanPublicSurfaceRoot } from './lib/public-surface-fingerprints.mjs';

function usage() {
  console.error('Usage: node scripts/public-surface-ci.mjs <repo-root>');
}

const targetArg = process.argv[2];
if (!targetArg) {
  usage();
  process.exit(2);
}

const result = scanPublicSurfaceRoot(resolve(process.cwd(), targetArg));
if (result.error) {
  console.error(`public-surface-ci FAIL: ${result.error}`);
  process.exit(2);
}

if (!result.ok) {
  console.error(`public-surface-ci FAIL: ${result.findings.length} finding(s)`);
  for (const finding of result.findings) {
    console.error(`${finding.code} ${finding.file} ${finding.marker}`);
  }
  process.exit(1);
}

console.log(`public-surface-ci PASS: ${result.filesChecked} text file(s) checked`);
