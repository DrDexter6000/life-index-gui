#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopAllProjectProcesses } from './lib/agent-ops-stack.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const result = await stopAllProjectProcesses({ repoRoot });
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
