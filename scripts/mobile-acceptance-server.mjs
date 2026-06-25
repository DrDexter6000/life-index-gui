import { createReadStream, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function parseArgs(argv) {
  const options = {
    host: '127.0.0.1',
    port: 5173,
    backendUrl: process.env.BACKEND_URL || 'http://127.0.0.1:8021',
    distRoot: 'dist',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--host' && next) {
      options.host = next;
      i += 1;
    } else if (arg === '--port' && next) {
      options.port = Number(next);
      i += 1;
    } else if (arg === '--backend' && next) {
      options.backendUrl = next;
      i += 1;
    } else if (arg === '--dist' && next) {
      options.distRoot = next;
      i += 1;
    }
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  return options;
}

function writeText(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function responseHeaders(headers) {
  const copied = {};
  headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      copied[key] = value;
    }
  });
  return copied;
}

async function proxyRequest(req, res, backendUrl) {
  const target = new URL(req.url ?? '/', backendUrl);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase()) || value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }

  const init = {
    method: req.method,
    headers,
    redirect: 'manual',
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req;
    init.duplex = 'half';
  }

  const upstream = await fetch(target, init);
  res.writeHead(upstream.status, responseHeaders(upstream.headers));
  if (!upstream.body) {
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(upstream.body), res);
}

async function serveIndex(res, distRoot) {
  const indexPath = join(distRoot, 'index.html');
  try {
    const html = await readFile(indexPath);
    res.writeHead(200, { 'content-type': CONTENT_TYPES['.html'] });
    res.end(html);
  } catch {
    writeText(res, 503, `Built frontend not found: ${indexPath}`);
  }
}

function resolveStaticPath(distRoot, pathname) {
  const decoded = decodeURIComponent(pathname);
  const relativePath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const targetPath = resolve(distRoot, relativePath);
  const resolvedDistRoot = resolve(distRoot);
  if (targetPath !== resolvedDistRoot && !targetPath.startsWith(`${resolvedDistRoot}\\`) && !targetPath.startsWith(`${resolvedDistRoot}/`)) {
    return null;
  }
  return targetPath;
}

async function serveStatic(req, res, distRoot) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    writeText(res, 405, 'Method not allowed');
    return;
  }

  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const targetPath = resolveStaticPath(distRoot, requestUrl.pathname);
  if (!targetPath) {
    writeText(res, 403, 'Forbidden');
    return;
  }

  try {
    const stats = statSync(targetPath);
    if (!stats.isFile()) {
      await serveIndex(res, distRoot);
      return;
    }

    const contentType = CONTENT_TYPES[extname(targetPath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': contentType,
      'cache-control': targetPath.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(targetPath).pipe(res);
  } catch {
    await serveIndex(res, distRoot);
  }
}

export function createMobileAcceptanceServer({
  distRoot = 'dist',
  backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8021',
} = {}) {
  const resolvedDistRoot = resolve(distRoot);

  return createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (pathname.startsWith('/api') || pathname.startsWith('/attachments')) {
        await proxyRequest(req, res, backendUrl);
        return;
      }
      await serveStatic(req, res, resolvedDistRoot);
    } catch (error) {
      if (res.headersSent) {
        if (!res.destroyed) {
          res.destroy(error instanceof Error ? error : undefined);
        }
        return;
      }
      writeText(res, 502, error instanceof Error ? error.message : 'Mobile acceptance server error');
    }
  });
}

export function startMobileAcceptanceServer(options) {
  const server = createMobileAcceptanceServer(options);
  server.listen(options.port, options.host, () => {
    console.log(`Mobile acceptance server ready: http://${options.host}:${options.port}`);
    console.log(`Proxying /api and /attachments to ${options.backendUrl}`);
  });
  return server;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startMobileAcceptanceServer(parseArgs(process.argv.slice(2)));
}
