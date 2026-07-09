/**
 * Minimal real-browser E2E smoke runner.
 *
 * Starts the FastAPI backend and Vite dev server, waits for readiness, visits
 * a fixed set of SPA routes in Playwright Chromium, and fails on fatal page
 * errors. Screenshots are written to the git-ignored `.tmp/smoke-e2e/`.
 */

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { resolvePythonCommand } from './lib/python-interpreter.mjs';
import { requireDevEnvironment } from './lib/require-dev-env.mjs';

const devEnvExitCode = requireDevEnvironment({ command: 'npm run smoke:e2e' });
if (devEnvExitCode !== 0) {
  process.exit(devEnvExitCode);
}

const BACKEND_PORT = Number(process.env.BACKEND_PORT || 18000);
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 15173);
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
const READINESS_TIMEOUT_MS = 45_000;
const READINESS_INTERVAL_MS = 1_000;
const ARTIFACTS_DIR = resolve(process.cwd(), '.tmp', 'smoke-e2e');
const VITE_BIN = resolve(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
const PYTHON_BIN = resolvePythonCommand({ repoRoot: process.cwd() });

const ROUTES = [
  '/',
  '/recall',
  '/archives',
  '/maintenance/index-tree',
  '/import',
];

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function waitForUrl(url, timeoutMs, intervalMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 304) return;
    } catch {
      // The service is still starting.
    }
    await sleep(intervalMs);
  }
  throw new Error(`${url} did not become ready within ${timeoutMs / 1000}s`);
}

function writeProcessOutput(label, streamName) {
  return (chunk) => {
    const text = chunk.toString().trimEnd();
    if (!text) return;
    for (const line of text.split(/\r?\n/)) {
      process.stdout.write(`[smoke:e2e] [${label}:${streamName}] ${line}\n`);
    }
  };
}

function spawnLogged(label, command, args, options) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: 'pipe',
    ...options,
  });

  child.stdout?.on('data', writeProcessOutput(label, 'out'));
  child.stderr?.on('data', writeProcessOutput(label, 'err'));
  child.on('exit', (code, signal) => {
    if (code !== 0 && signal == null) {
      process.stdout.write(`[smoke:e2e] [${label}] exited with code ${code}\n`);
    }
  });

  return child;
}

async function cleanup(processes, browser) {
  await browser?.close().catch(() => {});

  for (const child of processes.reverse()) {
    if (child.exitCode !== null || child.killed) continue;
    child.kill('SIGTERM');
  }
}

async function main() {
  const processes = [];
  let browser;

  try {
    await mkdir(ARTIFACTS_DIR, { recursive: true });

    const backend = spawnLogged(
      'backend',
      PYTHON_BIN,
      [
        '-m',
        'uvicorn',
        'backend.main:app',
        '--host',
        '127.0.0.1',
        '--port',
        String(BACKEND_PORT),
      ],
      { env: process.env },
    );
    processes.push(backend);

    const vite = spawnLogged(
      'vite',
      process.execPath,
      [
        VITE_BIN,
        '--host',
        '127.0.0.1',
        '--port',
        String(FRONTEND_PORT),
        '--strictPort',
      ],
      {
        env: {
          ...process.env,
          BACKEND_URL,
        },
      },
    );
    processes.push(vite);

    process.stdout.write('[smoke:e2e] Waiting for backend...\n');
    await waitForUrl(`${BACKEND_URL}/api`, READINESS_TIMEOUT_MS, READINESS_INTERVAL_MS);
    process.stdout.write('[smoke:e2e] Backend ready.\n');

    process.stdout.write('[smoke:e2e] Waiting for Vite...\n');
    await waitForUrl(FRONTEND_URL, READINESS_TIMEOUT_MS, READINESS_INTERVAL_MS);
    process.stdout.write('[smoke:e2e] Vite ready.\n');

    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    const pageErrors = [];

    page.on('pageerror', (error) => pageErrors.push(error));

    for (const route of ROUTES) {
      const url = `${FRONTEND_URL}${route}`;
      process.stdout.write(`[smoke:e2e] Visiting ${route}...\n`);

      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });

      if (!response || !response.ok()) {
        throw new Error(`Route ${route} returned status ${response?.status() ?? 'no response'}`);
      }

      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
      await page.locator('body').waitFor({ state: 'visible', timeout: 5_000 });

      const safeName = route.replace(/[^a-z0-9]/gi, '-').replace(/^-|-$/g, '');
      const screenshotPath = join(ARTIFACTS_DIR, `${safeName || 'root'}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });

      process.stdout.write(`[smoke:e2e] OK ${route} (${response.status()}) ${screenshotPath}\n`);
    }

    if (pageErrors.length > 0) {
      const messages = pageErrors.map((error, index) => `  [${index + 1}] ${error.message}`);
      throw new Error(`Fatal page errors detected:\n${messages.join('\n')}`);
    }

    process.stdout.write(`[smoke:e2e] All ${ROUTES.length} routes passed.\n`);
  } finally {
    await cleanup(processes, browser);
  }
}

main().catch((error) => {
  process.stderr.write(`[smoke:e2e] FAILED: ${error.message}\n${error.stack}\n`);
  process.exit(1);
});
