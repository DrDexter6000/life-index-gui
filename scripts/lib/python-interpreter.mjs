import { existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';

export function resolvePythonCommand({
  repoRoot = process.cwd(),
  platform = process.platform,
  env = process.env,
  exists = existsSync,
} = {}) {
  if (typeof env.PYTHON === 'string' && env.PYTHON.trim()) {
    return env.PYTHON;
  }

  const root = platform === 'win32'
    ? win32.resolve(repoRoot)
    : posix.resolve(String(repoRoot).replace(/\\/g, '/'));
  const venvPython = platform === 'win32'
    ? win32.join(root, '.venv', 'Scripts', 'python.exe')
    : posix.join(root, '.venv', 'bin', 'python');

  if (exists(venvPython)) {
    return venvPython;
  }

  return platform === 'win32' ? 'python' : 'python3';
}
