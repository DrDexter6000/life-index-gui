import assert from 'node:assert/strict';
import {
  REMOTE_LINK_SCHEMA_VERSION,
  normalizeRemoteLinkStatus,
  runRemoteLinkCommand,
} from './lib/remote-link.mjs';

const readyPublicStatus = {
  running: true,
  starting: false,
  tunnelUrl: 'https://phone-test.trycloudflare.com',
  oneTimeUrl: 'https://phone-test.trycloudflare.com/link?code=abc123',
  oneTimeCode: 'abc123',
  expiresAt: '2026-07-03T12:00:00.000Z',
  codeExpiresAt: '2026-07-03T00:02:00.000Z',
  qrDataUrl: 'data:image/png;base64,abc',
  remainingTtlSeconds: 43199,
  error: null,
};

assert.equal(REMOTE_LINK_SCHEMA_VERSION, 'gui.remote_link.v1');
assert.deepEqual(normalizeRemoteLinkStatus(readyPublicStatus), {
  schema_version: 'gui.remote_link.v1',
  status: 'online',
  url: 'https://phone-test.trycloudflare.com',
  one_time_code: 'abc123',
  expires_at: '2026-07-03T12:00:00.000Z',
  code_expires_at: '2026-07-03T00:02:00.000Z',
  remaining_ttl_seconds: 43199,
  qr: 'data:image/png;base64,abc',
  error: null,
});

const calls = [];
const emitted = [];
await runRemoteLinkCommand('start', {
  verifyStack: async () => {
    calls.push('verify-stack');
    return { ok: true, noOrphans: true };
  },
  fetchJson: async (path, options) => {
    calls.push(`${options?.method ?? 'GET'} ${path}`);
    if (path === '/api/public-link/start') {
      assert.equal(options.method, 'POST');
      assert.equal(JSON.parse(options.body).accept_risk, true);
      return { ...readyPublicStatus, running: false, starting: true };
    }
    if (path === '/api/public-link/status') {
      return readyPublicStatus;
    }
    throw new Error(`unexpected path ${path}`);
  },
  sleep: async () => {},
  output: (payload) => emitted.push(payload),
});

assert.deepEqual(calls, [
  'verify-stack',
  'POST /api/public-link/start',
  'GET /api/public-link/status',
]);
assert.equal(emitted.length, 1);
assert.equal(emitted[0].schema_version, 'gui.remote_link.v1');
assert.equal(emitted[0].status, 'online');
assert.equal(emitted[0].url, 'https://phone-test.trycloudflare.com');
assert.equal(emitted[0].one_time_code, 'abc123');

const failed = [];
const exitCode = await runRemoteLinkCommand('start', {
  verifyStack: async () => ({ ok: false, noOrphans: true, error: { code: 'BACKEND_HEALTH_TIMEOUT', message: 'health timeout' } }),
  fetchJson: async () => {
    throw new Error('must not call backend when verify-stack failed');
  },
  output: (payload) => failed.push(payload),
});

assert.equal(exitCode, 1);
assert.equal(failed[0].schema_version, 'gui.remote_link.v1');
assert.equal(failed[0].status, 'error');
assert.equal(failed[0].error.code, 'BACKEND_HEALTH_TIMEOUT');

let cleanupCalls = 0;
const startFailure = [];
const failedStartExitCode = await runRemoteLinkCommand('start', {
  verifyStack: async () => ({ ok: true, noOrphans: true }),
  fetchJson: async (path) => {
    if (path === '/api/public-link/start') {
      return {
        running: false,
        starting: false,
        error: {
          code: 'PUBLIC_LINK_CLOUDFLARED_MISSING',
          message: 'cloudflared is required.',
        },
      };
    }
    throw new Error(`unexpected path ${path}`);
  },
  stopControlBackend: async () => {
    cleanupCalls += 1;
  },
  output: (payload) => startFailure.push(payload),
});

assert.equal(failedStartExitCode, 1);
assert.equal(startFailure[0].status, 'error');
assert.equal(startFailure[0].error.code, 'PUBLIC_LINK_CLOUDFLARED_MISSING');
assert.equal(cleanupCalls, 1, 'failed start should clean up a remote-link-owned control backend');

let stopCleanupCalls = 0;
const stopped = [];
const stopExitCode = await runRemoteLinkCommand('stop', {
  fetchJson: async (path, options) => {
    assert.equal(path, '/api/public-link/stop');
    assert.equal(options.method, 'POST');
    return {
      running: false,
      starting: false,
      tunnelUrl: null,
      oneTimeUrl: null,
      expiresAt: null,
      codeExpiresAt: null,
      qrDataUrl: null,
      error: null,
    };
  },
  stopControlBackend: async () => {
    stopCleanupCalls += 1;
  },
  output: (payload) => stopped.push(payload),
});

assert.equal(stopExitCode, 0);
assert.equal(stopped[0].schema_version, 'gui.remote_link.v1');
assert.equal(stopped[0].status, 'offline');
assert.equal(stopCleanupCalls, 1, 'stop should clean up a remote-link-owned control backend');

console.log('remote-link helpers OK');
