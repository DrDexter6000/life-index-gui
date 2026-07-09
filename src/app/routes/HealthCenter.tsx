import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { GlassCard } from '@/components/celestial/GlassCard';
import { CelestialLoader } from '@/components/celestial/CelestialLoader';
import { useTranslation } from '@/hooks/useTranslation';
import { useHostAgentCapability } from '@/hooks/useHostAgent';
import {
  useHealthCheck,
  useDataAudit,
  useIndexCheck,
  useIndexVerify,
  useIndexCacheDryRun,
} from '@/hooks/useJournals';
import type {
  HealthResponse,
  IndexCheckResponse,
  VerifyDiagnosticsResponse,
  CacheDryRunResponse,
} from '@/lib/api-client';
import {
  getStarweaveConnectionState,
  type HostAgentCapability,
  type StarweaveConnectionState,
} from '@/lib/health-status';

type HealthState = 'healthy' | 'attention' | 'degraded' | 'unavailable' | 'loading' | 'error';

function classifyHealth(data: HealthResponse | undefined, isError: boolean): HealthState {
  if (isError) return 'error';
  if (!data) return 'loading';
  if (!data.cli_available) return 'unavailable';
  if (data.status === 'degraded') return 'degraded';
  return 'healthy';
}

const STATUS_ICON: Record<HealthState, string> = {
  healthy: 'check_circle',
  attention: 'warning',
  degraded: 'warning',
  unavailable: 'cloud_off',
  loading: 'hourglass_empty',
  error: 'error',
};

const STATUS_COLOR: Record<HealthState, string> = {
  healthy: 'var(--color-gold)',
  attention: 'var(--color-amber)',
  degraded: 'var(--color-amber)',
  unavailable: 'var(--color-coral)',
  loading: 'var(--color-muted)',
  error: 'var(--color-coral)',
};

const INDEX_REPAIR_CAPABILITY = 'CLI-REQ-2026-05-28-006';
const ENTITY_PROFILES_REBUILD_COMMAND = 'life-index abstract --entities';

type EntityProfilesStaleHint = {
  message?: string;
  command: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function hasEntityProfilesStaleName(record: Record<string, unknown>): boolean {
  return ['type', 'name', 'check', 'id'].some((key) => stringField(record, key) === 'entity_profiles_stale');
}

function extractEntityProfilesStaleHint(data: HealthResponse | undefined): EntityProfilesStaleHint | null {
  const health = data?.health;
  if (!isRecord(health)) return null;
  const nestedData = isRecord(health.data) ? health.data : null;
  const groups = [health.events, health.checks, nestedData?.events, nestedData?.checks];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      if (!isRecord(item) || !hasEntityProfilesStaleName(item)) continue;
      const command = stringField(item, 'suggested_command')
        ?? stringField(item, 'command')
        ?? (stringField(item, 'hint')?.includes(ENTITY_PROFILES_REBUILD_COMMAND)
          ? ENTITY_PROFILES_REBUILD_COMMAND
          : undefined)
        ?? ENTITY_PROFILES_REBUILD_COMMAND;
      return {
        command,
        message: stringField(item, 'message') ?? stringField(item, 'reason') ?? stringField(item, 'hint'),
      };
    }
  }
  return null;
}

function hasIndexDiagnosticsAttention({
  indexCheck,
  verify,
  cacheDryRun,
  error,
}: {
  indexCheck: IndexCheckResponse | undefined;
  verify: VerifyDiagnosticsResponse | undefined;
  cacheDryRun: CacheDryRunResponse | undefined;
  error: boolean;
}): boolean {
  const issues = normalizeIssues(indexCheck?.issues);
  const verifyIssues = verify?.issues_count ?? 0;
  const cacheWouldRebuild = cacheDryRun?.cache_version?.would_rebuild === true;
  return error || indexCheck?.healthy === false || issues.length > 0 || verifyIssues > 0 || cacheWouldRebuild;
}

function aggregateHealthState(baseState: HealthState, needsAttention: boolean): HealthState {
  if (baseState === 'healthy' && needsAttention) return 'attention';
  return baseState;
}

/**
 * HealthCenter — user-facing maintenance/health diagnostics surface.
 *
 * Shows healthy, degraded, CLI unavailable, data-audit warning,
 * loading, and retry/error states without hiding degraded health
 * and without blocking ordinary M1 write/search flows.
 */
export default function HealthCenter() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const {
    data: healthData,
    isLoading: healthLoading,
    isError: healthError,
    isFetching: healthFetching,
  } = useHealthCheck();

  const {
    data: auditData,
    isLoading: auditLoading,
    isError: auditError,
  } = useDataAudit();

  const {
    data: indexCheckData,
    isLoading: indexCheckLoading,
    isError: indexCheckError,
  } = useIndexCheck();

  const {
    data: verifyData,
    isLoading: verifyLoading,
    isError: verifyError,
  } = useIndexVerify();

  const {
    data: cacheDryRunData,
    isLoading: cacheDryRunLoading,
    isError: cacheDryRunError,
  } = useIndexCacheDryRun();

  const hostCapability = useHostAgentCapability();

  function handleRetry() {
    queryClient.invalidateQueries({ queryKey: ['health'] });
    queryClient.invalidateQueries({ queryKey: ['index-diagnostics'] });
  }

  const auditAnomalyCount = auditData?.data?.anomalies?.length ?? 0;
  const auditHasAnomalies = auditData?.success === true && auditAnomalyCount > 0;
  const entityProfilesStaleHint = extractEntityProfilesStaleHint(healthData);
  const indexDiagnosticsNeedsAttention = hasIndexDiagnosticsAttention({
    indexCheck: indexCheckData,
    verify: verifyData,
    cacheDryRun: cacheDryRunData,
    error: indexCheckError || verifyError || cacheDryRunError,
  });
  const baseState = healthLoading ? 'loading' : classifyHealth(healthData, healthError);
  const state = aggregateHealthState(baseState, auditHasAnomalies || indexDiagnosticsNeedsAttention);

  return (
    <>
      {/* Main Status Card */}
      <GlassCard className="p-6 mb-6">
        <div className="flex items-start gap-4">
          <span
            className="material-symbols-outlined text-[32px] flex-shrink-0"
            style={{ color: STATUS_COLOR[state] }}
            data-testid="health-status-icon"
          >
            {STATUS_ICON[state]}
          </span>
          <div className="flex-1 min-w-0">
            <StatusTitle state={state} t={t} />
            <StatusDescription state={state} t={t} data={healthData} />
          </div>
        </div>

        {/* Version info */}
        {healthData?.cli_available && healthData.package_version && (
          <div className="mt-4 pt-4 border-t border-white/[0.06]">
            <div className="flex items-center gap-2 text-sm text-[var(--color-secondary)]">
              <span className="material-symbols-outlined text-base">tag</span>
              <span>{t('healthVersion')}:</span>
              <span className="font-mono text-[var(--color-primary)]">
                {healthData.package_version}
              </span>
              {healthData.compatible ? (
                <span className="ml-1 text-xs text-green-400">✓</span>
              ) : (
                <span className="ml-1 text-xs text-[var(--color-coral)]">✗</span>
              )}
            </div>
          </div>
        )}

        {/* Warnings / Issues */}
        {healthData?.health?.warnings && Array.isArray(healthData.health.warnings) && healthData.health.warnings.length > 0 && (
          <div className="mt-4 pt-4 border-t border-white/[0.06]">
            <h3 className="text-sm font-medium text-[var(--color-amber)] mb-2 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">warning</span>
              {t('healthWarnings')}
            </h3>
            <ul className="space-y-1">
              {(healthData.health.warnings as unknown[]).map((w, i) => (
                <li key={i} className="text-sm text-[var(--color-secondary)] pl-6">
                  {String(w)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {healthData?.health?.issues && Array.isArray(healthData.health.issues) && healthData.health.issues.length > 0 && (
          <div className="mt-4 pt-4 border-t border-white/[0.06]">
            <h3 className="text-sm font-medium text-[var(--color-coral)] mb-2 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">error</span>
              {t('healthIssues')}
            </h3>
            <ul className="space-y-1">
              {(healthData.health.issues as unknown[]).map((issue, i) => (
                <li key={i} className="text-sm text-[var(--color-secondary)] pl-6">
                  {String(issue)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {entityProfilesStaleHint && (
          <div
            className="mt-4 rounded-2xl border border-white/[0.08] bg-[var(--color-ether-surface-ghost)] p-4"
            data-testid="entity-profiles-stale-hint"
          >
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--color-amber)]">
              <span className="material-symbols-outlined text-base">info</span>
              {t('entityProfilesStaleTitle')}
            </div>
            <p className="mb-3 text-sm text-[var(--color-secondary)]">
              {entityProfilesStaleHint.message ?? t('entityProfilesStaleDesc')}
            </p>
            <code className="block rounded-lg border border-white/[0.08] px-3 py-2 text-xs text-[var(--color-primary)]">
              {entityProfilesStaleHint.command}
            </code>
          </div>
        )}
      </GlassCard>

      <AiPlusConnectionCard capability={hostCapability} t={t} />

      {/* Data Audit Card */}
      {!auditLoading && (
        <GlassCard className="p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <span
              className="material-symbols-outlined text-lg"
              style={{ color: auditHasAnomalies ? 'var(--color-amber)' : 'var(--color-gold)' }}
              data-testid="audit-status-icon"
            >
              {auditHasAnomalies ? 'folder_off' : 'folder_verified'}
            </span>
            <h2 className="text-base font-semibold text-[var(--color-primary)]">
              {t('healthDataAudit')}
            </h2>
          </div>
          <p className="text-sm text-[var(--color-secondary)] mb-4">
            {t('healthDataAuditDesc')}
          </p>

          {auditError && (
            <div className="text-sm text-[var(--color-muted)]">
              {t('healthErrorHint')}
            </div>
          )}

          {auditData?.success === false && (
            <div className="text-sm text-[var(--color-muted)]">
              {t('healthErrorHint')}
            </div>
          )}

          {auditData?.success === true && auditData.data && (
            <>
              {/* Summary row */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="text-xs text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    {t('healthDataAuditFileCount')}
                  </div>
                  <div className="text-lg text-[var(--color-primary)]">
                    {auditData.data.file_count ?? '—'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[var(--color-muted)] uppercase tracking-wider mb-1">
                    {t('healthDataAuditAnomalies')}
                  </div>
                  <div
                    className="text-lg"
                    style={{ color: auditHasAnomalies ? 'var(--color-amber)' : 'var(--color-gold)' }}
                    data-testid="audit-anomaly-count"
                  >
                    {auditAnomalyCount}
                  </div>
                </div>
              </div>

              {/* Anomaly detail */}
              {auditHasAnomalies && auditData.data.anomalies && (
                <div className="pt-4 border-t border-white/[0.06]">
                  <div className="text-sm text-[var(--color-amber)] mb-2" data-testid="audit-anomaly-warning">
                    {t('healthDataAuditWarning')}
                  </div>
                  <ul className="space-y-2">
                    {auditData.data.anomalies.map((anomaly, i) => (
                      <li
                        key={i}
                        className="text-sm text-[var(--color-secondary)] bg-[var(--color-ether-surface-ghost)] rounded-lg p-3"
                      >
                        <span className="text-[var(--color-amber)] font-medium">
                          {String(anomaly.type ?? 'unknown')}
                        </span>
                        {anomaly.path && (
                          <span className="ml-2 font-mono text-xs text-[var(--color-muted)]">
                            {String(anomaly.path)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!auditHasAnomalies && (
                <div className="text-sm text-[var(--color-gold)]" data-testid="audit-clean">
                  {t('healthDataAuditClean')}
                </div>
              )}
            </>
          )}
        </GlassCard>
      )}

      {/* Audit loading state */}
      {auditLoading && (
        <GlassCard className="p-6 mb-6">
          <div className="flex items-center justify-center gap-2 text-[var(--color-muted)]">
            <CelestialLoader size="sm" />
            <span className="text-sm">{t('healthLoading')}</span>
          </div>
        </GlassCard>
      )}

      <IndexDiagnosticsCard
        t={t}
        indexCheck={indexCheckData}
        verify={verifyData}
        cacheDryRun={cacheDryRunData}
        loading={indexCheckLoading || verifyLoading || cacheDryRunLoading}
        error={indexCheckError || verifyError || cacheDryRunError}
      />

      {/* Retry button */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={handleRetry}
          disabled={healthFetching}
          className="px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-300
            bg-[var(--color-ether-surface-ghost)] text-[var(--color-secondary)] border border-white/[0.08]
            hover:bg-[var(--color-ether-control)] hover:text-[var(--color-primary)]
            disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="health-retry-button"
        >
          {healthFetching ? t('healthRetrying') : t('healthRetry')}
        </button>
      </div>
    </>
  );
}

function AiPlusConnectionCard({
  capability,
  t,
}: {
  capability: HostAgentCapability;
  t: (key: string) => string;
}) {
  const state = getStarweaveConnectionState(capability);
  const isConnected = state === 'online';
  const isChecking = state === 'checking';
  const statusKey = isConnected
    ? 'aiPlusConnectionConnected'
    : isChecking
      ? 'aiPlusConnectionChecking'
      : 'aiPlusConnectionDisconnected';
  const descriptionKey = isConnected
    ? 'aiPlusConnectionConnectedDesc'
    : isChecking
      ? 'aiPlusConnectionCheckingDesc'
      : 'aiPlusConnectionDisconnectedDesc';

  return (
    <div data-testid="ai-plus-status-card">
      <GlassCard className="p-6 mb-6">
        <div className="flex items-start gap-4">
          <span
            className="material-symbols-outlined text-3xl flex-shrink-0"
            style={{ color: getAiPlusStatusColor(state) }}
            aria-hidden="true"
          >
            {isConnected ? 'hub' : isChecking ? 'hourglass_empty' : 'radio_button_unchecked'}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-[var(--color-primary)]">
                {t('aiPlusConnectionTitle')}
              </h2>
              <span
                className="rounded-full border px-2 py-1 text-xs font-semibold uppercase tracking-[0.08em]"
                style={{
                  borderColor: getAiPlusStatusBorderColor(state),
                  color: getAiPlusStatusColor(state),
                }}
              >
                {t(statusKey)}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-secondary)]">
              {t(descriptionKey)}
            </p>
            {!isConnected && (
              <Link
                to="/maintenance/host-agent"
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-cyan)] hover:text-[var(--color-primary)]"
              >
                {t('starweaveConnectGuideLink')}
                <span className="material-symbols-outlined text-sm" aria-hidden="true">chevron_right</span>
              </Link>
            )}
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

function getAiPlusStatusColor(state: StarweaveConnectionState): string {
  if (state === 'online') return 'var(--color-green)';
  if (state === 'checking') return 'var(--color-muted)';
  return 'var(--color-secondary)';
}

function getAiPlusStatusBorderColor(state: StarweaveConnectionState): string {
  if (state === 'online') return 'var(--color-green-60)';
  if (state === 'checking') return 'rgba(255,255,255,0.16)';
  return 'rgba(255,255,255,0.14)';
}

function IndexDiagnosticsCard({
  t,
  indexCheck,
  verify,
  cacheDryRun,
  loading,
  error,
}: {
  t: (key: string) => string;
  indexCheck: IndexCheckResponse | undefined;
  verify: VerifyDiagnosticsResponse | undefined;
  cacheDryRun: CacheDryRunResponse | undefined;
  loading: boolean;
  error: boolean;
}) {
  const issues = normalizeIssues(indexCheck?.issues);
  const verifyIssues = verify?.issues_count ?? 0;
  const cacheWouldRebuild = cacheDryRun?.cache_version?.would_rebuild === true;
  const needsAttention = hasIndexDiagnosticsAttention({ indexCheck, verify, cacheDryRun, error });

  return (
    <div data-testid="index-diagnostics-card">
    <GlassCard className="p-6 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <span
          className="material-symbols-outlined text-lg"
          style={{ color: needsAttention ? 'var(--color-amber)' : 'var(--color-gold)' }}
        >
          {needsAttention ? 'manage_search' : 'verified'}
        </span>
        <h2 className="text-base font-semibold text-[var(--color-primary)]">
          {t('indexDiagnostics')}
        </h2>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <CelestialLoader size="sm" />
          <span>{t('healthLoading')}</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <div className="text-xs text-[var(--color-muted)] uppercase tracking-wider mb-1">
                {t('indexHealth')}
              </div>
              <div
                className="text-lg"
                style={{ color: needsAttention ? 'var(--color-amber)' : 'var(--color-gold)' }}
                data-testid="index-health-state"
              >
                {needsAttention ? t('indexNeedsAttention') : t('indexHealthy')}
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--color-muted)] uppercase tracking-wider mb-1">
                {t('indexCounts')}
              </div>
              <div className="text-sm text-[var(--color-secondary)]">
                <span>FTS: {indexCheck?.fts_count ?? '-'}</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="text-sm text-[var(--color-muted)] mb-4">
              {t('indexDiagnosticsUnavailable')}
            </div>
          )}

          {issues.length > 0 && (
            <div className="pt-4 border-t border-white/[0.06] mb-4">
              <div className="text-sm text-[var(--color-amber)] mb-2">
                {t('indexIssues')}
              </div>
              <ul className="space-y-2">
                {issues.map((issue, index) => (
                  <li
                    key={`${issue}-${index}`}
                    className="text-sm text-[var(--color-secondary)] bg-[var(--color-ether-surface-ghost)] rounded-lg p-3"
                  >
                    {issue}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-[var(--color-secondary)] mb-4">
            <div className="bg-[var(--color-ether-surface-ghost)] rounded-lg p-3">
              Verify issues: {verifyIssues}
            </div>
            <div className="bg-[var(--color-ether-surface-ghost)] rounded-lg p-3">
              Cache dry-run: {cacheWouldRebuild ? 'would rebuild' : 'no rebuild'}
            </div>
          </div>

          <div className="pt-4 border-t border-white/[0.06]">
            <div className="text-sm text-[var(--color-coral)] mb-2">
              {t('indexRepairBlocked')}
            </div>
            <p className="text-sm text-[var(--color-secondary)] mb-3">
              {t('indexRepairBlockedDesc')}{' '}
              <span className="font-mono text-[var(--color-primary)]">
                {INDEX_REPAIR_CAPABILITY}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled
                data-testid="index-rebuild-blocked"
                className="px-4 py-2 rounded-lg text-sm border border-white/[0.08] text-[var(--color-muted)] bg-[var(--color-ether-surface-ghost)] disabled:cursor-not-allowed"
              >
                {t('indexRebuildBlocked')}
              </button>
              <button
                type="button"
                disabled
                data-testid="index-tree-rebuild-blocked"
                className="px-4 py-2 rounded-lg text-sm border border-white/[0.08] text-[var(--color-muted)] bg-[var(--color-ether-surface-ghost)] disabled:cursor-not-allowed"
              >
                {t('indexTreeRebuildBlocked')}
              </button>
            </div>
          </div>
        </>
      )}
    </GlassCard>
    </div>
  );
}

function normalizeIssues(
  issues: Array<string | Record<string, unknown>> | undefined,
): string[] {
  if (!issues) return [];
  return issues.map((issue) => {
    if (typeof issue === 'string') return issue;
    const message = issue.message ?? issue.type ?? issue.name ?? JSON.stringify(issue);
    return String(message);
  });
}

function StatusTitle({
  state,
  t,
}: {
  state: HealthState;
  t: (key: string) => string;
}) {
  const titleKey: Record<HealthState, string> = {
    healthy: 'healthHealthy',
    attention: 'healthNeedsAttentionTitle',
    degraded: 'healthDegradedTitle',
    unavailable: 'healthUnavailable',
    loading: 'healthLoading',
    error: 'healthError',
  };
  return (
    <h2 className="text-lg font-semibold text-[var(--color-primary)]" data-testid="health-status-title">
      {t(titleKey[state])}
    </h2>
  );
}

function StatusDescription({
  state,
  t,
  data,
}: {
  state: HealthState;
  t: (key: string) => string;
  data: HealthResponse | undefined;
}) {
  const descKey: Record<HealthState, string> = {
    healthy: 'healthHealthyDesc',
    attention: 'healthNeedsAttentionDesc',
    degraded: 'healthDegradedDesc',
    unavailable: 'healthUnavailableDesc',
    loading: 'healthLoading',
    error: 'healthErrorHint',
  };

  return (
    <p className="text-sm text-[var(--color-secondary)] mt-1">
      {t(descKey[state])}
      {state === 'unavailable' && data?.error && (
        <span className="block mt-1 text-xs text-[var(--color-muted)] font-mono">
          {String(data.error.message ?? '')}
        </span>
      )}
    </p>
  );
}
