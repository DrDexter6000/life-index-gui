import { afterEach, describe, expect, it } from 'vitest';
import type { HostAgentHealthResponse } from './api-client';
import {
  AI_PLUS_FEATURE_ENABLES,
  getHostAgentCapability,
  isSmartCapabilityUnavailable,
} from './health-status';

const readyHealth: HostAgentHealthResponse = {
  schema_version: 'gui.host_agent.health.v1',
  running: true,
  ready: true,
  degraded: false,
  reason: 'ready',
  runtime: { kind: 'external-host-agent', interface_version: 'v1' },
  checks: [],
};

afterEach(() => {
  AI_PLUS_FEATURE_ENABLES.groundedQuery = false;
  AI_PLUS_FEATURE_ENABLES.smartMetadata = false;
});

describe('isSmartCapabilityUnavailable', () => {
  it('does not block smart search for degraded-but-compatible CLI health', () => {
    expect(isSmartCapabilityUnavailable({
      status: 'degraded',
      cli_available: true,
      compatible: true,
    })).toBe(false);
  });

  it('blocks smart search when CLI is unavailable or incompatible', () => {
    expect(isSmartCapabilityUnavailable({
      status: 'error',
      cli_available: false,
      compatible: true,
    })).toBe(true);
    expect(isSmartCapabilityUnavailable({
      status: 'ok',
      cli_available: true,
      compatible: false,
    })).toBe(true);
  });
});

describe('getHostAgentCapability', () => {
  it('keeps all AI+ features frozen by default even when host-agent health is ready', () => {
    const cap = getHostAgentCapability(readyHealth);

    expect(cap.status).toBe('unavailable');
    expect(cap.canSendEvidence).toBe(false);
    expect(cap.reason).toBe('not-ready');
    expect(cap.features.groundedQuery).toMatchObject({ ready: true, enabled: false, available: false });
    expect(cap.features.smartMetadata).toMatchObject({ ready: true, enabled: false, available: false });
  });

  it('allows groundedQuery and smartMetadata to be enabled independently', () => {
    const groundedOnly = getHostAgentCapability(readyHealth, {
      features: { groundedQuery: true, smartMetadata: false },
    });
    expect(groundedOnly.features.groundedQuery.available).toBe(true);
    expect(groundedOnly.features.smartMetadata.available).toBe(false);

    const metadataOnly = getHostAgentCapability(readyHealth, {
      features: { groundedQuery: false, smartMetadata: true },
    });
    expect(metadataOnly.features.groundedQuery.available).toBe(false);
    expect(metadataOnly.features.smartMetadata.available).toBe(true);
  });

  it('blocks all features when host-agent health is missing, degraded, or down', () => {
    expect(getHostAgentCapability(null, {
      features: { groundedQuery: true, smartMetadata: true },
    }).reason).toBe('health-check-failed');

    expect(getHostAgentCapability({
      ...readyHealth,
      degraded: true,
    }, {
      features: { groundedQuery: true },
    }).features.groundedQuery.available).toBe(false);

    expect(getHostAgentCapability({
      ...readyHealth,
      running: false,
      ready: false,
    }, {
      features: { smartMetadata: true },
    }).features.smartMetadata.reason).toBe('health-check-failed');
  });

  it('ignores non-gating health diagnostics when host-agent health is ready', () => {
    const cap = getHostAgentCapability({
      ...readyHealth,
      checks: [{ name: 'runtime-note', status: 'warn', error: 'diagnostic only' }],
    }, {
      features: { groundedQuery: true },
    });

    expect(cap.features.groundedQuery.available).toBe(true);
    expect(cap.reason).toBe('ready');
  });

  it('keeps Host Agent handoff disabled while host-agent health is loading', () => {
    expect(getHostAgentCapability(null, { isLoading: true })).toMatchObject({
      status: 'checking',
      canSendEvidence: false,
      reason: 'health-loading',
    });
  });

  it('requires ready=true from host-agent health before exposing feature availability', () => {
    expect(getHostAgentCapability({
      ...readyHealth,
      ready: false,
      reason: 'host-agent-not-ready',
    }, {
      features: { groundedQuery: true },
    }).reason).toBe('health-check-failed');
  });
});
