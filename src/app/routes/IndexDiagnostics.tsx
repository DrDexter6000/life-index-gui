import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { GlassCard } from '@/components/celestial/GlassCard';
import { CelestialLoader } from '@/components/celestial/CelestialLoader';
import {
  DataDoctorRepairPanel,
  type ApplyResult,
  type AuditIssue,
  type DryRunResult,
  type RepairPlan,
  type PostCheckResult,
} from '@/components/maintenance/DataDoctorRepairPanel';
import { useTranslation } from '@/hooks/useTranslation';
import { useIndexCheck, useIndexVerify, useIndexCacheDryRun, indexDiagnosticsKeys } from '@/hooks/useJournals';
import {
  maintenanceKeys,
  useMaintenanceAudit,
  useMaintenanceDryRun,
  useMaintenancePlan,
  useMaintenanceRepairApply,
} from '@/hooks/useMaintenanceRepair';
import type { MaintenancePlanResponse, MaintenanceRepairResponse } from '@/lib/api-client';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: UnknownRecord, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return fallback;
}

function stringArrayField(record: UnknownRecord, keys: string[]) {
  const values: string[] = [];

  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      values.push(...value.map((item) => String(item)).filter((item) => item.length > 0));
    } else if (typeof value === 'string' && value.trim().length > 0) {
      values.push(value);
    }
  }

  return Array.from(new Set(values));
}

function normalizeAuditIssues(rawIssues: unknown[]): AuditIssue[] {
  const issues: AuditIssue[] = [];

  rawIssues.forEach((rawIssue, index) => {
    if (!isRecord(rawIssue)) {
      return;
    }

    const issueId = stringField(rawIssue, ['issue_id', 'id', 'code'], `issue-${index + 1}`);
    issues.push({
      issue_id: issueId,
      domain: stringField(rawIssue, ['domain', 'scope'], 'maintenance'),
      severity: stringField(rawIssue, ['severity', 'level'], 'info').toLowerCase(),
      summary: stringField(rawIssue, ['summary', 'description', 'message'], issueId),
    });
  });

  return issues;
}

function normalizePlan(plan: MaintenancePlanResponse | undefined): RepairPlan | null {
  if (!plan) {
    return null;
  }

  const record = plan as unknown as UnknownRecord;
  const touchedPaths = stringArrayField(record, ['touched_paths', 'planned_paths', 'changed_paths']);
  if (typeof plan.path === 'string' && plan.path.trim().length > 0) {
    touchedPaths.push(plan.path);
  }

  return {
    schema_version: plan.schema_version,
    issue_id: plan.issue_id,
    repairable: plan.repairable,
    touched_paths: Array.from(new Set(touchedPaths)),
  };
}

function normalizeDryRun(result: MaintenanceRepairResponse | undefined): DryRunResult | null {
  if (!result) {
    return null;
  }

  const record = result as unknown as UnknownRecord;
  const error = stringField(record, ['error', 'message']);

  return {
    schema_version: result.schema_version,
    issue_id: result.issue_id,
    dry_run: result.dry_run,
    planned_paths: result.planned_paths,
    ...(error ? { error } : {}),
  };
}

function normalizeApplyResult(result: MaintenanceRepairResponse): ApplyResult {
  return {
    schema_version: result.schema_version,
    issue_id: result.issue_id,
    dry_run: result.dry_run,
    applied: result.applied,
    changed_paths: result.changed_paths,
  };
}

/**
 * IndexDiagnostics — user-facing index health, integrity, and cache surface.
 *
 * S3 falsifiable exit:
 * - Index diagnostics are rendered from CLI-mediated payloads, or explicitly
 *   blocked when no GUI-safe payload exists.
 * - Repair controls are disabled with a capability request reference because
 *   the CLI has no preview/confirm/post-check contract for index rebuild.
 * - No direct SQLite/index import, directory scan, file read, or filesystem
 *   existence probe is used — all data comes through CLI adapter.
 */
export default function IndexDiagnostics() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const {
    data: checkData,
    isLoading: checkLoading,
    isError: checkError,
    isFetching: checkFetching,
  } = useIndexCheck();

  const {
    data: verifyData,
    isLoading: verifyLoading,
    isError: verifyError,
  } = useIndexVerify();

  const {
    data: cacheData,
    isLoading: cacheLoading,
    isError: cacheError,
  } = useIndexCacheDryRun();

  const maintenanceAudit = useMaintenanceAudit();
  const [selectedIssue, setSelectedIssue] = useState<AuditIssue | null>(null);
  const [planIssueId, setPlanIssueId] = useState<string | undefined>();
  const [dryRunIssueId, setDryRunIssueId] = useState<string | undefined>();
  const [confirmed, setConfirmed] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [postCheck, setPostCheck] = useState<PostCheckResult | null>(null);

  const planQuery = useMaintenancePlan(planIssueId);
  const dryRunQuery = useMaintenanceDryRun(dryRunIssueId);
  const repairApply = useMaintenanceRepairApply();

  const maintenanceIssues = useMemo(
    () => normalizeAuditIssues(maintenanceAudit.data?.issues ?? []),
    [maintenanceAudit.data],
  );

  const plan =
    selectedIssue?.issue_id === planIssueId
      ? normalizePlan(planQuery.data)
      : null;
  const dryRun =
    selectedIssue?.issue_id === dryRunIssueId
      ? normalizeDryRun(dryRunQuery.data)
      : null;
  const dryRunSuccess = dryRun?.dry_run === true && !dryRun.error;

  function handleRetry() {
    queryClient.invalidateQueries({ queryKey: indexDiagnosticsKeys.all });
    queryClient.invalidateQueries({ queryKey: maintenanceKeys.all });
  }

  function handleSelectIssue(issue: AuditIssue) {
    setSelectedIssue(issue);
    setPlanIssueId(undefined);
    setDryRunIssueId(undefined);
    setConfirmed(false);
    setApplyResult(null);
    setPostCheck(null);
  }

  function handlePlan(issueId: string) {
    setPlanIssueId(issueId);
    setDryRunIssueId(undefined);
    setConfirmed(false);
    setApplyResult(null);
    setPostCheck(null);
  }

  function handleDryRun(issueId: string) {
    setDryRunIssueId(issueId);
    setConfirmed(false);
    setApplyResult(null);
    setPostCheck(null);
  }

  function handleApply(issueId: string) {
    if (!dryRunSuccess || !confirmed) {
      return;
    }

    repairApply.mutate(
      { issueId, confirmed: true },
      {
        onSuccess: (result) => {
          setApplyResult(normalizeApplyResult(result));
          setPostCheck(null);
        },
      },
    );
  }

  async function handlePostCheck() {
    if (!applyResult) {
      return;
    }

    const result = await maintenanceAudit.refetch();
    const refreshedIssues = normalizeAuditIssues(result.data?.issues ?? []);
    const issueStillPresent = refreshedIssues.some((issue) => issue.issue_id === applyResult.issue_id);

    setPostCheck({
      passed: !issueStillPresent,
      message: t(
        issueStillPresent
          ? 'dataDoctorPostCheckIssueStillPresent'
          : 'dataDoctorPostCheckIssueResolved',
      ),
    });
  }

  const isHealthy = checkData?.healthy === true;
  const checkIssues: string[] = (checkData?.issues ?? []).map((i: string | Record<string, unknown>) => String(i));
  const verifyIssues = verifyData?.issues_count ?? 0;
  const cacheRebuild = cacheData?.cache_version?.would_rebuild === true;

  return (
    <div className="max-w-[800px] mx-auto px-6">
      {/* Header */}
      <section className="text-center mb-10" aria-label={t('indexDiagnostics')}>
        <h1
          className="text-[var(--text-display)] font-normal tracking-[0.08em] text-[var(--color-primary)] mb-2"
          style={{ fontFamily: 'var(--font-divine)' }}
        >
          {t('indexDiagnostics')}
        </h1>
        <p className="text-[0.9375rem] text-[var(--color-secondary)]">
          {t('indexDiagnosticsSubtitle')}
        </p>
      </section>

      {/* Index Health Card */}
      <IndexHealthCard
        loading={checkLoading}
        error={checkError}
        healthy={isHealthy}
        issues={checkIssues}
        ftsCount={checkData?.fts_count}
        fileCount={checkData?.file_count}
        t={t}
      />

      {/* Verify / Integrity Card */}
      <VerifyCard
        loading={verifyLoading}
        error={verifyError}
        data={verifyData}
        issueCount={verifyIssues}
        t={t}
      />

      {/* Cache Dry-Run Card */}
      <CacheCard
        loading={cacheLoading}
        error={cacheError}
        data={cacheData}
        rebuildNeeded={cacheRebuild}
        t={t}
      />

      <DataDoctorRepairPanel
        auditLoading={maintenanceAudit.isLoading}
        auditError={maintenanceAudit.isError}
        issues={maintenanceIssues}
        selectedIssue={selectedIssue}
        plan={plan}
        dryRun={dryRun}
        dryRunSuccess={dryRunSuccess}
        confirmed={confirmed}
        applyResult={applyResult}
        postCheck={postCheck}
        onSelectIssue={handleSelectIssue}
        onPlan={handlePlan}
        onDryRun={handleDryRun}
        onConfirmationToggle={setConfirmed}
        onApply={handleApply}
        onRetry={handleRetry}
        onPostCheck={handlePostCheck}
      />

      {/* Navigation link to index tree diagnostics */}
      <div className="flex justify-center mb-6">
        <Link
          to="/maintenance/index-tree"
          className="px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-300
            bg-[var(--color-ether-surface-ghost)] text-[var(--color-secondary)] border border-white/[0.08]
            hover:bg-[var(--color-ether-control)] hover:text-[var(--color-primary)]"
          data-testid="index-tree-nav-link"
        >
          {t('indexTreeDiagnostics')}
        </Link>
      </div>

      {/* Retry button */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={handleRetry}
          disabled={checkFetching}
          className="px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-300
            bg-[var(--color-ether-surface-ghost)] text-[var(--color-secondary)] border border-white/[0.08]
            hover:bg-[var(--color-ether-control)] hover:text-[var(--color-primary)]
            disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="index-retry-button"
        >
          {checkFetching ? t('indexRetrying') : t('indexRetry')}
        </button>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function IndexHealthCard({
  loading,
  error,
  healthy,
  issues,
  ftsCount,
  fileCount,
  t,
}: {
  loading: boolean;
  error: boolean;
  healthy: boolean;
  issues: string[];
  ftsCount?: number;
  fileCount?: number;
  t: (key: string) => string;
}) {
  if (loading) {
    return (
      <GlassCard className="p-6 mb-6">
        <div className="flex items-center justify-center gap-2 text-[var(--color-muted)]">
          <CelestialLoader size="sm" />
          <span className="text-sm">{t('indexDiagnostics')}</span>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-6 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <span
          className="material-symbols-outlined text-lg"
          style={{ color: error || !healthy ? 'var(--color-amber)' : 'var(--color-gold)' }}
          data-testid="index-health-icon"
        >
          {error ? 'error' : healthy ? 'check_circle' : 'warning'}
        </span>
        <h2 className="text-base font-semibold text-[var(--color-primary)]">
          {t('indexHealth')}
        </h2>
        <span
          className="ml-auto text-sm"
          style={{ color: error || !healthy ? 'var(--color-amber)' : 'var(--color-gold)' }}
          data-testid="index-health-status"
        >
          {error ? t('indexDiagnosticsUnavailable') : healthy ? t('indexHealthy') : t('indexNeedsAttention')}
        </span>
      </div>
      <p className="text-sm text-[var(--color-secondary)] mb-4">
        {t('indexCheckDesc')}
      </p>

      {/* Count summary */}
      {(ftsCount !== undefined || fileCount !== undefined) && (
        <div className="grid grid-cols-2 gap-4 mb-4" data-testid="index-counts">
          {ftsCount !== undefined && (
            <div>
              <div className="text-xs text-[var(--color-muted)] uppercase tracking-wider mb-1">FTS</div>
              <div className="text-lg text-[var(--color-primary)]">{ftsCount}</div>
            </div>
          )}
          {fileCount !== undefined && (
            <div>
              <div className="text-xs text-[var(--color-muted)] uppercase tracking-wider mb-1">{t('indexCounts')}</div>
              <div className="text-lg text-[var(--color-primary)]">{fileCount}</div>
            </div>
          )}
        </div>
      )}

      {/* Issues list */}
      {issues.length > 0 && (
        <div className="pt-4 border-t border-white/[0.06]" data-testid="index-issues-list">
          <h3 className="text-sm font-medium text-[var(--color-amber)] mb-2">{t('indexIssues')}</h3>
          <ul className="space-y-1">
            {issues.map((issue, i) => (
              <li key={i} className="text-sm text-[var(--color-secondary)] pl-4">{issue}</li>
            ))}
          </ul>
        </div>
      )}
    </GlassCard>
  );
}

function VerifyCard({
  loading,
  error,
  data,
  issueCount,
  t,
}: {
  loading: boolean;
  error: boolean;
  data: { success?: boolean; suggestion?: string; checks?: Array<Record<string, unknown>> } | undefined;
  issueCount: number;
  t: (key: string) => string;
}) {
  if (loading) return null;

  return (
    <GlassCard className="p-6 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <span
          className="material-symbols-outlined text-lg"
          style={{ color: error || issueCount > 0 ? 'var(--color-amber)' : 'var(--color-gold)' }}
          data-testid="verify-status-icon"
        >
          {error ? 'error' : issueCount > 0 ? 'warning' : 'verified'}
        </span>
        <h2 className="text-base font-semibold text-[var(--color-primary)]">
          {t('indexVerify')}
        </h2>
      </div>
      <p className="text-sm text-[var(--color-secondary)] mb-4">
        {t('indexVerifyDesc')}
      </p>

      {error && (
        <div className="text-sm text-[var(--color-muted)]" data-testid="verify-error">
          {t('indexDiagnosticsUnavailable')}
        </div>
      )}

      {!error && data && (
        <>
          <div className="text-sm" data-testid="verify-status" style={{ color: issueCount > 0 ? 'var(--color-amber)' : 'var(--color-gold)' }}>
            {issueCount > 0 ? `${t('indexVerifyIssues').replace('{{count}}', String(issueCount))}` : t('indexVerifyClean')}
          </div>
          {data.suggestion && (
            <div className="mt-3 text-sm text-[var(--color-secondary)] bg-[var(--color-ether-surface-ghost)] rounded-lg p-3" data-testid="verify-suggestion">
              {data.suggestion}
            </div>
          )}
        </>
      )}
    </GlassCard>
  );
}

function CacheCard({
  loading,
  error,
  data,
  rebuildNeeded,
  t,
}: {
  loading: boolean;
  error: boolean;
  data: { success?: boolean; cache_version?: { would_rebuild?: boolean; reasons?: string[] } } | undefined;
  rebuildNeeded: boolean;
  t: (key: string) => string;
}) {
  if (loading) return null;

  return (
    <GlassCard className="p-6 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <span
          className="material-symbols-outlined text-lg"
          style={{ color: error || rebuildNeeded ? 'var(--color-amber)' : 'var(--color-gold)' }}
          data-testid="cache-status-icon"
        >
          {error ? 'error' : rebuildNeeded ? 'sync_problem' : 'cloud_done'}
        </span>
        <h2 className="text-base font-semibold text-[var(--color-primary)]">
          {t('indexCacheDryRun')}
        </h2>
      </div>
      <p className="text-sm text-[var(--color-secondary)] mb-4">
        {t('indexCacheDryRunDesc')}
      </p>

      {error && (
        <div className="text-sm text-[var(--color-muted)]" data-testid="cache-error">
          {t('indexDiagnosticsUnavailable')}
        </div>
      )}

      {!error && data && (
        <div className="text-sm" data-testid="cache-status" style={{ color: rebuildNeeded ? 'var(--color-amber)' : 'var(--color-gold)' }}>
          {rebuildNeeded ? t('indexCacheRebuildNeeded') : t('indexCacheUpToDate')}
        </div>
      )}

      {!error && data?.cache_version?.reasons && data.cache_version.reasons.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/[0.06]">
          <ul className="space-y-1" data-testid="cache-reasons">
            {data.cache_version.reasons.map((reason, i) => (
              <li key={i} className="text-sm text-[var(--color-muted)] pl-4">{reason}</li>
            ))}
          </ul>
        </div>
      )}
    </GlassCard>
  );
}
