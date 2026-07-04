import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BACKEND_PORT,
  createLaunchCommands,
  runVerifyStack,
  stopPid,
  waitForUrl,
} from './agent-ops-stack.mjs';

export const REMOTE_LINK_SCHEMA_VERSION = 'gui.remote_link.v1';

const moduleRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTROL_STATE_PATH = join(moduleRepoRoot, '.tmp', 'remote-link-control.json');
const DEFAULT_BACKEND_BASE_URL = process.env.LIFE_INDEX_GUI_BACKEND_URL || `http://127.0.0.1:${DEFAULT_BACKEND_PORT}`;

function trimBaseUrl(url) {
  return String(url || DEFAULT_BACKEND_BASE_URL).replace(/\/+$/, '');
}

function parseOneTimeCode(status) {
  const direct = status?.one_time_code ?? status?.oneTimeCode;
  if (typeof direct === 'string' && direct) return direct;
  const oneTimeUrl = status?.oneTimeUrl;
  if (typeof oneTimeUrl !== 'string' || !oneTimeUrl) return null;
  try {
    return new URL(oneTimeUrl).searchParams.get('code');
  } catch {
    return null;
  }
}

function errorEnvelope(code, message, details) {
  return {
    schema_version: REMOTE_LINK_SCHEMA_VERSION,
    status: 'error',
    url: null,
    one_time_code: null,
    expires_at: null,
    code_expires_at: null,
    remaining_ttl_seconds: null,
    qr: null,
    error: {
      code: String(code || 'REMOTE_LINK_ERROR'),
      message: String(message || 'Remote link operation failed.'),
      ...(details ? { details } : {}),
    },
  };
}

export function normalizeRemoteLinkStatus(status) {
  const running = status?.running === true;
  const starting = status?.starting === true;
  const error = status?.error ?? null;
  const normalizedStatus = error ? 'error' : running ? 'online' : starting ? 'starting' : 'offline';
  return {
    schema_version: REMOTE_LINK_SCHEMA_VERSION,
    status: status?.status ?? normalizedStatus,
    url: status?.url ?? status?.tunnelUrl ?? null,
    one_time_code: parseOneTimeCode(status),
    expires_at: status?.expires_at ?? status?.expiresAt ?? null,
    code_expires_at: status?.code_expires_at ?? status?.codeExpiresAt ?? null,
    remaining_ttl_seconds: status?.remaining_ttl_seconds ?? status?.remainingTtlSeconds ?? null,
    qr: status?.qr ?? status?.qrDataUrl ?? null,
    error,
  };
}

async function fetchBackendJson(path, options = {}, backendBaseUrl = DEFAULT_BACKEND_BASE_URL) {
  const response = await fetch(`${trimBaseUrl(backendBaseUrl)}${path}`, {
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    ...options,
  });
  const envelope = await response.json().catch(() => null);
  if (!response.ok) {
    const error = envelope?.error ?? {};
    throw Object.assign(new Error(error.message || `HTTP ${response.status}`), {
      code: error.code || `HTTP_${response.status}`,
      status: response.status,
    });
  }
  if (!envelope?.ok && envelope?.error) {
    throw Object.assign(new Error(envelope.error.message || 'Backend returned an error.'), {
      code: envelope.error.code || 'BACKEND_ERROR',
      status: response.status,
    });
  }
  return envelope?.data ?? envelope;
}

async function ensureControlBackend({ repoRoot = moduleRepoRoot, backendBaseUrl = DEFAULT_BACKEND_BASE_URL } = {}) {
  const health = await waitForUrl(`${trimBaseUrl(backendBaseUrl)}/api/health`, 1500);
  if (health.ok) {
    return { ok: true, started: false };
  }

  const launch = createLaunchCommands({ repoRoot, backendPort: DEFAULT_BACKEND_PORT });
  const child = spawn(launch.backend.command, launch.backend.args, {
    cwd: repoRoot,
    env: { ...process.env, LIFE_INDEX_GUI_REMOTE_LINK_CONTROL: '1' },
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
    detached: false,
  });
  mkdirSync(dirname(CONTROL_STATE_PATH), { recursive: true });
  writeFileSync(
    CONTROL_STATE_PATH,
    JSON.stringify({ pid: child.pid, backendBaseUrl: trimBaseUrl(backendBaseUrl), startedAt: new Date().toISOString() }),
    'utf8',
  );

  const ready = await waitForUrl(`${trimBaseUrl(backendBaseUrl)}/api/health`, 60000);
  if (!ready.ok) {
    await stopPid(child.pid);
    rmSync(CONTROL_STATE_PATH, { force: true });
    return {
      ok: false,
      error: {
        code: 'REMOTE_LINK_CONTROL_BACKEND_UNAVAILABLE',
        message: ready.error || 'Control backend did not become healthy.',
      },
    };
  }
  return { ok: true, started: true, pid: child.pid };
}

async function stopControlBackendIfOwned() {
  let state = null;
  try {
    state = JSON.parse(readFileSync(CONTROL_STATE_PATH, 'utf8'));
  } catch {
    return { stopped: false };
  }
  rmSync(CONTROL_STATE_PATH, { force: true });
  if (!Number.isInteger(state?.pid)) {
    return { stopped: false, reason: 'missing-pid' };
  }
  return stopPid(state.pid);
}

async function pollRemoteLinkReady({ fetchJson, sleep, backendBaseUrl, timeoutMs = 150000 }) {
  const started = Date.now();
  let lastStatus = null;
  while (Date.now() - started < timeoutMs) {
    lastStatus = await fetchJson('/api/public-link/status', {}, backendBaseUrl);
    const normalized = normalizeRemoteLinkStatus(lastStatus);
    if (normalized.status === 'online' || normalized.status === 'error') {
      return normalized;
    }
    await sleep(1000);
  }
  return errorEnvelope('REMOTE_LINK_START_TIMEOUT', 'Timed out waiting for the remote link URL.', { lastStatus });
}

export async function runRemoteLinkCommand(action, deps = {}) {
  const backendBaseUrl = deps.backendBaseUrl ?? DEFAULT_BACKEND_BASE_URL;
  const repoRoot = deps.repoRoot ?? moduleRepoRoot;
  const injectedFetch = Boolean(deps.fetchJson);
  const fetchJson = deps.fetchJson ?? fetchBackendJson;
  const output = deps.output ?? ((payload) => console.log(JSON.stringify(payload, null, 2)));
  const sleep = deps.sleep ?? ((ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)));
  const verifyStack = deps.verifyStack ?? (() => runVerifyStack({ repoRoot }));
  const ensureBackend = deps.ensureBackend ?? (injectedFetch ? async () => ({ ok: true }) : ensureControlBackend);
  const cleanupControlBackend = deps.stopControlBackend ?? stopControlBackendIfOwned;

  try {
    if (action === 'start') {
      const verify = await verifyStack();
      if (!verify.ok || verify.noOrphans === false) {
        output(errorEnvelope(
          verify.error?.code || 'VERIFY_STACK_FAILED',
          verify.error?.message || 'verify-stack failed before remote-link start.',
          verify,
        ));
        return 1;
      }
      const backend = await ensureBackend({ repoRoot, backendBaseUrl });
      if (!backend.ok) {
        output(errorEnvelope(backend.error?.code, backend.error?.message, backend));
        return 1;
      }
      const started = await fetchJson('/api/public-link/start', {
        method: 'POST',
        body: JSON.stringify({ accept_risk: true }),
      }, backendBaseUrl);
      const normalized = normalizeRemoteLinkStatus(started);
      const finalStatus = normalized.status === 'online' || normalized.status === 'error'
        ? normalized
        : await pollRemoteLinkReady({ fetchJson, sleep, backendBaseUrl, timeoutMs: deps.timeoutMs });
      if (finalStatus.status === 'error') {
        await cleanupControlBackend();
      }
      output(finalStatus);
      return finalStatus.status === 'error' ? 1 : 0;
    }

    if (action === 'status') {
      output(normalizeRemoteLinkStatus(await fetchJson('/api/public-link/status', {}, backendBaseUrl)));
      return 0;
    }

    if (action === 'stop') {
      const stopped = normalizeRemoteLinkStatus(await fetchJson('/api/public-link/stop', {
        method: 'POST',
        body: JSON.stringify({}),
      }, backendBaseUrl));
      await cleanupControlBackend();
      output(stopped);
      return stopped.status === 'error' ? 1 : 0;
    }

    output(errorEnvelope('REMOTE_LINK_ACTION_INVALID', `Unsupported remote-link action: ${action}`));
    return 2;
  } catch (error) {
    output(errorEnvelope(error.code || 'REMOTE_LINK_EXCEPTION', error.message || String(error), { action }));
    return 1;
  }
}
