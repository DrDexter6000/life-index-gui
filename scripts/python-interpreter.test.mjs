import assert from 'node:assert/strict';
import { posix, win32 } from 'node:path';
import { resolvePythonCommand } from './lib/python-interpreter.mjs';

const posixRoot = '/workspace/life-index-gui';
const windowsRoot = 'D:\\Work\\life-index-gui-public';

assert.equal(
  resolvePythonCommand({
    repoRoot: posixRoot,
    platform: 'linux',
    env: { PYTHON: '/custom/python' },
    exists: () => false,
  }),
  '/custom/python',
  'PYTHON environment override wins on POSIX',
);

assert.equal(
  resolvePythonCommand({
    repoRoot: posixRoot,
    platform: 'linux',
    env: {},
    exists: (pathValue) => pathValue === posix.join(posixRoot, '.venv', 'bin', 'python'),
  }),
  posix.join(posixRoot, '.venv', 'bin', 'python'),
  'POSIX repo venv is preferred before PATH fallbacks',
);

assert.equal(
  resolvePythonCommand({
    repoRoot: posixRoot,
    platform: 'linux',
    env: {},
    exists: () => false,
  }),
  'python3',
  'POSIX without PYTHON or .venv falls back to python3 instead of bare python',
);

assert.equal(
  resolvePythonCommand({
    repoRoot: windowsRoot,
    platform: 'win32',
    env: {},
    exists: (pathValue) => pathValue === win32.join(windowsRoot, '.venv', 'Scripts', 'python.exe'),
  }),
  win32.join(windowsRoot, '.venv', 'Scripts', 'python.exe'),
  'Windows repo venv path is preserved',
);

assert.equal(
  resolvePythonCommand({
    repoRoot: windowsRoot,
    platform: 'win32',
    env: {},
    exists: () => false,
  }),
  'python',
  'Windows without PYTHON or .venv keeps python as the PATH fallback',
);

console.log('python interpreter resolver OK');
