import type { AgentBridgeGatewayHealthResponse, AgentBridgeProbeResponse, HealthResponse } from './api-client';

export function isSmartCapabilityUnavailable(healthData?: HealthResponse | null): boolean {
  if (!healthData) return false;
  return Boolean(
    healthData.cli_available === false
    || healthData.compatible === false,
  );
}

export type HostAgentCapabilityStatus = 'checking' | 'ready' | 'unavailable';

export type HostAgentCapabilityReason =
  | 'ready'
  | 'probe-loading'
  | 'probe-unavailable'
  | 'probe-contract-violation'
  | 'ack-required'
  | 'health-check-failed'
  | 'check-failed'
  | 'not-ready';

export type AiPlusFeatureKey = 'groundedQuery' | 'smartMetadata';

export const AI_PLUS_FEATURE_KEYS: readonly AiPlusFeatureKey[] = ['groundedQuery', 'smartMetadata'];

export const AI_PLUS_FEATURE_ENABLES: Record<AiPlusFeatureKey, boolean> = {
  groundedQuery: import.meta.env.VITE_LIFE_INDEX_AI_PLUS_GROUNDED_QUERY === 'true',
  smartMetadata: import.meta.env.VITE_LIFE_INDEX_AI_PLUS_SMART_METADATA === 'true',
};

export interface FeatureCapability {
  status: HostAgentCapabilityStatus;
  ready: boolean;
  enabled: boolean;
  available: boolean;
  reason: HostAgentCapabilityReason;
}

export interface HostAgentCapability {
  status: HostAgentCapabilityStatus;
  features: Record<AiPlusFeatureKey, FeatureCapability>;
  /**
   * Aggregate summary for status indicators only. Feature surfaces must gate on
   * `features.<feature>.available`.
   */
  canSendEvidence: boolean;
  reason: HostAgentCapabilityReason;
}

export interface HostAgentCapabilityOptions {
  isLoading?: boolean;
  isError?: boolean;
  gatewayHealth?: AgentBridgeGatewayHealthResponse | null;
  isHealthLoading?: boolean;
  isHealthError?: boolean;
  features?: Partial<Record<AiPlusFeatureKey, boolean>>;
}

interface ReadinessBase {
  status: HostAgentCapabilityStatus;
  ready: boolean;
  reason: HostAgentCapabilityReason;
}

function deriveReadiness(
  probeData: AgentBridgeProbeResponse | null | undefined,
  options: HostAgentCapabilityOptions,
): ReadinessBase {
  const healthData = options.gatewayHealth;

  if ((options.isLoading && !probeData) || (options.isHealthLoading && !healthData)) {
    return { status: 'checking', ready: false, reason: 'probe-loading' };
  }

  if (options.isError || !probeData) {
    return { status: 'unavailable', ready: false, reason: 'probe-unavailable' };
  }

  if (probeData.sends_journal_evidence !== false) {
    return { status: 'unavailable', ready: false, reason: 'probe-contract-violation' };
  }

  if (probeData.ack?.data_exposure_ack !== true) {
    return { status: 'unavailable', ready: false, reason: 'ack-required' };
  }

  if (options.isHealthError || !healthData) {
    return { status: 'unavailable', ready: false, reason: 'health-check-failed' };
  }

  if (healthData.running === true && healthData.degraded !== true) {
    return { status: 'ready', ready: true, reason: 'ready' };
  }

  return { status: 'unavailable', ready: false, reason: 'health-check-failed' };
}

function resolveEnables(
  overrides: Partial<Record<AiPlusFeatureKey, boolean>> | undefined,
): Record<AiPlusFeatureKey, boolean> {
  return {
    groundedQuery: overrides?.groundedQuery ?? AI_PLUS_FEATURE_ENABLES.groundedQuery,
    smartMetadata: overrides?.smartMetadata ?? AI_PLUS_FEATURE_ENABLES.smartMetadata,
  };
}

function buildFeature(base: ReadinessBase, enabled: boolean): FeatureCapability {
  const available = base.ready && enabled;
  const status: HostAgentCapabilityStatus =
    base.status === 'checking' ? 'checking' : available ? 'ready' : 'unavailable';
  const reason: HostAgentCapabilityReason =
    base.status === 'checking'
      ? base.reason
      : available
        ? 'ready'
        : base.ready
          ? 'not-ready'
          : base.reason;
  return { status, ready: base.ready, enabled, available, reason };
}

export function getHostAgentCapability(
  probeData?: AgentBridgeProbeResponse | null,
  options: HostAgentCapabilityOptions = {},
): HostAgentCapability {
  const base = deriveReadiness(probeData ?? null, options);
  const enables = resolveEnables(options.features);

  const features = {
    groundedQuery: buildFeature(base, enables.groundedQuery),
    smartMetadata: buildFeature(base, enables.smartMetadata),
  };

  const anyAvailable = features.groundedQuery.available || features.smartMetadata.available;
  const status: HostAgentCapabilityStatus =
    base.status === 'checking' ? 'checking' : anyAvailable ? 'ready' : 'unavailable';
  const reason: HostAgentCapabilityReason =
    base.status === 'checking'
      ? base.reason
      : anyAvailable
        ? 'ready'
        : base.ready
          ? 'not-ready'
          : base.reason;

  return {
    status,
    features,
    canSendEvidence: anyAvailable,
    reason,
  };
}
