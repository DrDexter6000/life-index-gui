import { afterEach, describe, expect, it } from 'vitest';
import type { AgentBridgeGatewayHealthResponse, AgentBridgeProbeResponse } from './api-client';
import {
  AI_PLUS_FEATURE_ENABLES,
  getHostAgentCapability,
  isSmartCapabilityUnavailable,
} from './health-status';

const readyProbe: AgentBridgeProbeResponse = {
  success: true,
  schema_version: 'm35.agent_bridge_probe.v0',
  command: 'agent-bridge probe',
  source: 'P1',
  mode: 'host_agent',
  transport: 'openai',
  endpoint: { configured: true, url: 'http://127.0.0.1:8642/v1' },
  model: { configured: true, name: 'hermes-agent' },
  ack: { data_exposure_ack: true, required_for: ['P1', 'P2'] },
  token: {
    configured: true,
    source: 'env:LIFE_INDEX_LLM_API_KEY',
    persisted_in_config: false,
  },
  checks: [{ name: 'models', status: 'pass', model_ids: ['hermes-agent'] }],
  sends_journal_evidence: false,
  ready_to_send_evidence: false,
};

const warmGateway: AgentBridgeGatewayHealthResponse = {
  running: true,
  degraded: false,
  gateway_status: 'warm',
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
  it('keeps all AI+ features frozen by default even when the gateway is warm', () => {
    const cap = getHostAgentCapability(readyProbe, { gatewayHealth: warmGateway });

    expect(cap.status).toBe('unavailable');
    expect(cap.canSendEvidence).toBe(false);
    expect(cap.reason).toBe('not-ready');
    expect(cap.features.groundedQuery).toMatchObject({ ready: true, enabled: false, available: false });
    expect(cap.features.smartMetadata).toMatchObject({ ready: true, enabled: false, available: false });
  });

  it('allows groundedQuery and smartMetadata to be enabled independently', () => {
    const groundedOnly = getHostAgentCapability(readyProbe, {
      gatewayHealth: warmGateway,
      features: { groundedQuery: true, smartMetadata: false },
    });
    expect(groundedOnly.features.groundedQuery.available).toBe(true);
    expect(groundedOnly.features.smartMetadata.available).toBe(false);

    const metadataOnly = getHostAgentCapability(readyProbe, {
      gatewayHealth: warmGateway,
      features: { groundedQuery: false, smartMetadata: true },
    });
    expect(metadataOnly.features.groundedQuery.available).toBe(false);
    expect(metadataOnly.features.smartMetadata.available).toBe(true);
  });

  it('blocks all features when gateway health is missing, degraded, or down', () => {
    expect(getHostAgentCapability(readyProbe, {
      features: { groundedQuery: true, smartMetadata: true },
    }).reason).toBe('health-check-failed');

    expect(getHostAgentCapability(readyProbe, {
      gatewayHealth: { running: true, degraded: true },
      features: { groundedQuery: true },
    }).features.groundedQuery.available).toBe(false);

    expect(getHostAgentCapability(readyProbe, {
      gatewayHealth: { running: false, degraded: false },
      features: { smartMetadata: true },
    }).features.smartMetadata.reason).toBe('health-check-failed');
  });

  it('ignores retired /v1/models probe failures when gateway health is warm', () => {
    const cap = getHostAgentCapability({
      ...readyProbe,
      checks: [{ name: 'models', status: 'fail', error: '401 provider diagnostic' }],
    }, {
      gatewayHealth: warmGateway,
      features: { groundedQuery: true },
    });

    expect(cap.features.groundedQuery.available).toBe(true);
    expect(cap.reason).toBe('ready');
  });

  it('keeps Host Agent handoff disabled while the probe or gateway health is loading', () => {
    expect(getHostAgentCapability(null, { isLoading: true })).toMatchObject({
      status: 'checking',
      canSendEvidence: false,
      reason: 'probe-loading',
    });

    expect(getHostAgentCapability(readyProbe, { isHealthLoading: true })).toMatchObject({
      status: 'checking',
      canSendEvidence: false,
      reason: 'probe-loading',
    });
  });

  it('keeps ack and no-evidence probe boundaries mandatory', () => {
    expect(getHostAgentCapability({
      ...readyProbe,
      ack: { data_exposure_ack: false, required_for: ['P1', 'P2'] },
    }, { gatewayHealth: warmGateway, features: { groundedQuery: true } }).reason).toBe('ack-required');

    expect(getHostAgentCapability({
      ...readyProbe,
      sends_journal_evidence: true,
    } as unknown as AgentBridgeProbeResponse, {
      gatewayHealth: warmGateway,
      features: { groundedQuery: true },
    }).reason).toBe('probe-contract-violation');
  });
});
