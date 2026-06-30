import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createMobileAcceptanceServer } from './mobile-acceptance-server.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

const tempRoot = mkdtempSync(join(tmpdir(), 'life-index-mobile-acceptance-server-'));
const distRoot = join(tempRoot, 'dist');
mkdirSync(join(distRoot, 'assets'), { recursive: true });
writeFileSync(join(distRoot, 'index.html'), '<!doctype html><main id="root">Life Index</main>');
writeFileSync(join(distRoot, 'assets', 'app.js'), 'window.__mobileAcceptance = true;');

let apiRequestPath = '';
const backend = createServer((req, res) => {
  apiRequestPath = req.url ?? '';
  if (req.url === '/api/ping') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, via: 'backend' }));
    return;
  }
  if (req.url === '/attachments/photo.jpg') {
    res.writeHead(200, { 'content-type': 'image/jpeg' });
    res.end('image-bytes');
    return;
  }
  if (req.url === '/api/unstable-stream') {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.write('partial-bytes');
    setImmediate(() => res.destroy(new Error('upstream closed')));
    return;
  }
  // Auth exchange endpoint: sets a session cookie and redirects.
  if (req.url === '/auth/exchange' && req.method === 'POST') {
    res.writeHead(302, {
      'location': '/',
      'set-cookie': [
        'session_token=abc123; Path=/; HttpOnly; Secure; SameSite=Lax',
        'other_cookie=foo; Path=/',
      ],
    });
    res.end();
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

try {
  const backendPort = await listen(backend);
  const frontend = createMobileAcceptanceServer({
    distRoot,
    backendUrl: `http://127.0.0.1:${backendPort}`,
  });
  const frontendPort = await listen(frontend);
  const baseUrl = `http://127.0.0.1:${frontendPort}`;

  const indexResponse = await fetch(`${baseUrl}/`);
  assert.equal(indexResponse.status, 200);
  const indexHtml = await indexResponse.text();
  assert.match(indexHtml, /Life Index/);
  assert.doesNotMatch(indexHtml, /@vite\/client/);

  const assetResponse = await fetch(`${baseUrl}/assets/app.js`);
  assert.equal(assetResponse.status, 200);
  assert.match(await assetResponse.text(), /__mobileAcceptance/);

  const apiResponse = await fetch(`${baseUrl}/api/ping`);
  assert.equal(apiResponse.status, 200);
  assert.deepEqual(await apiResponse.json(), { ok: true, via: 'backend' });
  assert.equal(apiRequestPath, '/api/ping');

  const attachmentResponse = await fetch(`${baseUrl}/attachments/photo.jpg`);
  assert.equal(attachmentResponse.status, 200);
  assert.equal(await attachmentResponse.text(), 'image-bytes');

  // --- /auth/exchange is proxied and Set-Cookie survives ---
  const authResponse = await fetch(`${baseUrl}/auth/exchange`, { method: 'POST', redirect: 'manual' });
  assert.equal(authResponse.status, 302);
  assert.equal(authResponse.headers.get('location'), '/');
  // The backend sets two Set-Cookie headers; both must survive the proxy.
  const setCookieHeader = authResponse.headers.getSetCookie?.() ?? [];
  assert.ok(setCookieHeader.length >= 2, 'At least two Set-Cookie headers should survive');
  const cookieValues = setCookieHeader.map(String);
  assert.ok(cookieValues.some((c) => c.includes('session_token=abc123')),
    'session_token cookie should survive proxy');
  assert.ok(cookieValues.some((c) => c.includes('other_cookie=foo')),
    'other_cookie should survive proxy');
  assert.ok(cookieValues.some((c) => c.includes('HttpOnly')),
    'HttpOnly flag should be preserved');
  assert.ok(cookieValues.some((c) => c.includes('SameSite=Lax')),
    'SameSite=Lax should be preserved');

  // Unstable stream
  let uncaught = null;
  const onUncaught = (error) => {
    uncaught = error;
  };
  process.once('uncaughtException', onUncaught);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 250);
    await fetch(`${baseUrl}/api/unstable-stream`, { signal: controller.signal })
      .then((response) => response.text())
      .catch(() => null)
      .finally(() => clearTimeout(timeoutId));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(uncaught, null);
  } finally {
    process.removeListener('uncaughtException', onUncaught);
  }

  frontend.close();
  await once(frontend, 'close');
} finally {
  backend.close();
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('mobile acceptance server OK');
