#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVerifyStack } from './lib/agent-ops-stack.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const result = await runVerifyStack({ repoRoot });
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok && result.noOrphans ? 0 : 1);
