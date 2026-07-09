export const DEV_ENV_PRODUCTION_CODE = 'DEVDEPS_NODE_ENV_PRODUCTION';

export function isProductionNodeEnv(env = process.env) {
  return String(env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
}

export function buildDevEnvErrorMessage({ command = 'this command' } = {}) {
  return [
    `[dev-env] NODE_ENV=production is active, but ${command} requires devDependencies.`,
    'Production NODE_ENV can make npm omit devDependencies and later fail with module-not-found errors.',
    'Fix:',
    '  POSIX shell: unset NODE_ENV',
    "  Windows PowerShell: $env:NODE_ENV=''",
    '  Then reinstall without production omit: npm ci --include=dev',
    '  If npm still omits devDependencies, check npm config omit and rerun npm install/npm ci without production omit.',
  ].join('\n');
}

export function checkDevEnvironment({ env = process.env, command = 'this command' } = {}) {
  if (!isProductionNodeEnv(env)) {
    return { ok: true };
  }

  return {
    ok: false,
    error: {
      code: DEV_ENV_PRODUCTION_CODE,
      message: buildDevEnvErrorMessage({ command }),
    },
  };
}

export function requireDevEnvironment({ env = process.env, command = 'this command', stderr = console.error } = {}) {
  const result = checkDevEnvironment({ env, command });
  if (result.ok) {
    return 0;
  }
  stderr(result.error.message);
  return 1;
}
