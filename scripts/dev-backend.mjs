#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBackendChildEnv,
  prepareHostAgentEndpoint,
  projectReadinessFacts,
  queryStructuredHostAgentHealth,
  stopReferenceBridge,
  waitForUrl,
} from './lib/agent-ops-stack.mjs';
import { resolvePythonCommand } from './lib/python-interpreter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const pythonCommand = resolvePythonCommand({ repoRoot });

const hostEndpoint = await prepareHostAgentEndpoint({
  repoRoot,
  env: process.env,
});
const referenceBridge = hostEndpoint.referenceBridge;

let cleanedUp = false;
async function cleanupReferenceBridge() {
  if (cleanedUp) return;
  cleanedUp = true;
  await stopReferenceBridge(referenceBridge);
}

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
  env: createBackendChildEnv(hostEndpoint.env, referenceBridge),
  stdio: 'inherit',
  windowsHide: true,
});

child.on('error', async (error) => {
  await cleanupReferenceBridge();
  console.error(error?.message ?? String(error));
  process.exit(1);
});

child.on('exit', async (code, signal) => {
  await cleanupReferenceBridge();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

const backendHealth = await waitForUrl('http://127.0.0.1:8000/api/health', 60000);
const frontendHealth = await waitForUrl('http://127.0.0.1:5173/', 10000);
const hostAgentHealth = backendHealth.ok
  ? await queryStructuredHostAgentHealth({ backendPort: 8000 })
  : { ok: false, health: null, error: 'backend unavailable' };
const readiness = projectReadinessFacts({
  guiReady: backendHealth.ok && frontendHealth.ok,
  bridgeReady: referenceBridge.bridgeReady,
  hostEndpointConfigured: hostEndpoint.hostEndpointConfigured,
  hostHealth: hostAgentHealth.health,
});

console.log(`GUI ready: ${readiness.guiReady}`);
console.log(`Reference bridge ready: ${readiness.referenceBridgeReady}`);
console.log(`External Host ready: ${readiness.externalHostReady}`);
console.log(`AI+ ready: ${readiness.aiPlusReady}`);
