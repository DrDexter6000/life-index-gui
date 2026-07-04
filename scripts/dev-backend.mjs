#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePythonCommand } from './lib/python-interpreter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const pythonCommand = resolvePythonCommand({ repoRoot });

const child = spawn(pythonCommand, [
  '-m',
  'uvicorn',
  'backend.main:app',
  '--host',
  '127.0.0.1',
  '--port',
  '8000',
  '--reload',
], {
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
