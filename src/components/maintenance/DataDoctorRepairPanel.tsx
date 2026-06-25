import { GlassCard } from '@/components/celestial/GlassCard';
import { CelestialLoader } from '@/components/celestial/CelestialLoader';
import { useTranslation } from '@/hooks/useTranslation';

export interface AuditIssue {
  issue_id: string;
  domain: string;
  severity: string;
  summary?: string;
}

export interface RepairPlan {
  schema_version: string;
  issue_id: string;
  repairable: boolean;
  touched_paths: string[];
}

export interface DryRunResult {
  schema_version: string;
  issue_id: string;
  dry_run: boolean;
  planned_paths: string[];
  error?: string;
}

export interface ApplyResult {
  schema_version: string;
  issue_id: string;
  dry_run: boolean;
  applied: boolean;
  changed_paths: string[];
}

export interface PostCheckResult {
  passed: boolean;
  message: string;
}

export interface DataDoctorRepairPanelProps {
  auditLoading: boolean;
  auditError: boolean;
  issues: AuditIssue[];
  selectedIssue: AuditIssue | null;
  plan: RepairPlan | null;
  dryRun: DryRunResult | null;
  dryRunSuccess: boolean;
  confirmed: boolean;
  applyResult: ApplyResult | null;
  postCheck: PostCheckResult | null;
  onSelectIssue: (issue: AuditIssue) => void;
  onPlan: (issueId: string) => void;
  onDryRun: (issueId: string) => void;
  onConfirmationToggle: (value: boolean) => void;
  onApply: (issueId: string) => void;
  onRetry: () => void;
  onPostCheck: () => void;
}

const SEVERITY_ICON: Record<string, string> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
};

const SEVERITY_COLOR: Record<string, string> = {
  error: 'var(--color-coral)',
  warning: 'var(--color-amber)',
  info: 'var(--color-muted)',
};

/**
 * DataDoctorRepairPanel — standalone Data Doctor repair panel UI.
 *
 * UI-only component with mocked props. Does not call real API hooks.
 * Renders audit loading, empty, error, and issues states.
 * Supports plan preview, dry-run, confirmation, apply, and post-check flow.
 *
 * Safety rules:
 * - No direct rebuild controls.
 * - Apply button disabled until dry-run success AND explicit confirmation.
 * - Copy clearly distinguishes dry-run preview from apply.
 */
export function DataDoctorRepairPanel({
  auditLoading,
  auditError,
  issues,
  selectedIssue,
  plan,
  dryRun,
  dryRunSuccess,
  confirmed,
  applyResult,
  postCheck,
  onSelectIssue,
  onPlan,
  onDryRun,
  onConfirmationToggle,
  onApply,
  onRetry,
  onPostCheck,
}: DataDoctorRepairPanelProps) {
  const { t } = useTranslation();

  const applyEnabled = dryRunSuccess && confirmed && !applyResult;

  return (
    <section className="mb-6" aria-label={t('dataDoctorPanel')}>
      <GlassCard className="p-6 mb-6">
        <div className="flex items-start gap-4">
          <span
            className="material-symbols-outlined text-[24px] flex-shrink-0"
            style={{ color: 'var(--color-gold)' }}
          >
            medical_services
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-[var(--color-primary)]">
              {t('dataDoctorPanel')}
            </h2>
            <p className="text-sm text-[var(--color-secondary)] mt-1">
              {t('dataDoctorSubtitle')}
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Audit loading */}
      {auditLoading && (
        <GlassCard className="p-6 mb-6">
          <div data-testid="data-doctor-loading" className="flex items-center justify-center gap-2 text-[var(--color-muted)]">
            <CelestialLoader size="sm" />
            <span className="text-sm">{t('dataDoctorAuditLoading')}</span>
          </div>
        </GlassCard>
      )}

      {/* Audit error */}
      {!auditLoading && auditError && (
        <GlassCard className="p-6 mb-6">
          <div data-testid="data-doctor-error" className="flex items-start gap-4">
            <span
              className="material-symbols-outlined text-[24px] flex-shrink-0"
              style={{ color: 'var(--color-coral)' }}
            >
              error
            </span>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-[var(--color-primary)]">
                {t('dataDoctorAuditError')}
              </h2>
              <p className="text-sm text-[var(--color-secondary)] mt-1">
                {t('dataDoctorAuditErrorDesc')}
              </p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 px-4 py-2 rounded-lg text-sm border border-white/[0.08] text-[var(--color-secondary)] bg-[var(--color-ether-surface-ghost)] hover:bg-[var(--color-ether-control)] hover:text-[var(--color-primary)] transition-colors duration-300"
                data-testid="error-retry-button"
              >
                {t('dataDoctorRetry')}
              </button>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Empty state */}
      {!auditLoading && !auditError && issues.length === 0 && (
        <GlassCard className="p-6 mb-6">
          <div data-testid="data-doctor-empty" className="flex items-center gap-2">
            <span
              className="material-symbols-outlined text-lg"
              style={{ color: 'var(--color-gold)' }}
            >
              check_circle
            </span>
            <span className="text-sm text-[var(--color-secondary)]">
              {t('dataDoctorNoIssues')}
            </span>
          </div>
        </GlassCard>
      )}

      {/* Issues list */}
      {!auditLoading && !auditError && issues.length > 0 && (
        <GlassCard className="p-6 mb-6">
          <div data-testid="data-doctor-issues-list">
            <div className="flex items-center gap-2 mb-4">
            <span
              className="material-symbols-outlined text-lg"
              style={{ color: 'var(--color-amber)' }}
            >
              manage_search
            </span>
            <h2 className="text-base font-semibold text-[var(--color-primary)]">
              {t('dataDoctorIssues')}
            </h2>
            <span className="ml-auto text-xs text-[var(--color-muted)]">
              {issues.length}
            </span>
          </div>

          <ul className="space-y-2">
            {issues.map((issue) => {
              const isSelected = selectedIssue?.issue_id === issue.issue_id;
              const severity = issue.severity ?? 'info';
              const icon = SEVERITY_ICON[severity] ?? 'info';
              const color = SEVERITY_COLOR[severity] ?? 'var(--color-muted)';

              return (
                <li
                  key={issue.issue_id}
                  data-testid={`issue-row-${issue.issue_id}`}
                  data-selected={isSelected ? 'true' : 'false'}
                  className={`rounded-xl p-3 cursor-pointer transition-colors duration-200 min-w-0 break-words ${
                    isSelected
                      ? 'bg-[var(--color-ether-control)] border border-white/[0.12]'
                      : 'bg-[var(--color-ether-surface-ghost)] border border-transparent hover:bg-[var(--color-ether-surface-ghost)]'
                  }`}
                  onClick={() => onSelectIssue(issue)}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span
                      className="material-symbols-outlined text-base flex-shrink-0 mt-0.5"
                      style={{ color }}
                      data-testid={`issue-severity-${issue.issue_id}`}
                    >
                      {icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-xs px-2 py-0.5 rounded-md bg-[var(--color-ether-surface-ghost)] text-[var(--color-muted)]"
                          data-testid={`issue-domain-${issue.issue_id}`}
                        >
                          {issue.domain}
                        </span>
                        <span
                          className="text-xs font-mono text-[var(--color-muted)] truncate"
                          data-testid={`issue-id-${issue.issue_id}`}
                        >
                          {issue.issue_id}
                        </span>
                      </div>
                      {issue.summary && (
                        <p
                          className="text-sm text-[var(--color-secondary)] mt-1 break-words"
                          data-testid={`issue-summary-${issue.issue_id}`}
                        >
                          {issue.summary}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          </div>
        </GlassCard>
      )}

      {/* Plan section */}
      {selectedIssue && plan && (
        <GlassCard className="p-6 mb-6">
          <div data-testid="data-doctor-plan-section">
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-lg text-[var(--color-muted)]">
              assignment
            </span>
            <h2 className="text-base font-semibold text-[var(--color-primary)]">
              {t('dataDoctorPlanTitle')}
            </h2>
          </div>

          <div className="text-sm text-[var(--color-secondary)] mb-3">
            <span
              className="font-medium"
              data-testid="plan-repairable"
              style={{
                color: plan.repairable ? 'var(--color-gold)' : 'var(--color-coral)',
              }}
            >
              {plan.repairable ? t('dataDoctorRepairable') : t('dataDoctorNotRepairable')}
            </span>
          </div>

          {plan.touched_paths.length > 0 && (
            <div className="text-sm text-[var(--color-secondary)] mb-4">
              <div className="text-xs text-[var(--color-muted)] uppercase tracking-wider mb-1">
                {t('dataDoctorTouchedPaths')}
              </div>
              <ul className="space-y-1" data-testid="plan-touched-paths">
                {plan.touched_paths.map((path, i) => (
                  <li key={i} className="font-mono text-xs text-[var(--color-muted)]">
                    {path}
                  </li>
                ))}
              </ul>
            </div>
          )}
          </div>
        </GlassCard>
      )}

      {/* Dry-run section */}
      {selectedIssue && dryRun && (
        <GlassCard className="p-6 mb-6">
          <div data-testid="data-doctor-dryrun-section">
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-lg text-[var(--color-muted)]">
              preview
            </span>
            <h2 className="text-base font-semibold text-[var(--color-primary)]">
              {t('dataDoctorDryRunTitle')}
            </h2>
            <span
              className="ml-auto text-xs px-2 py-0.5 rounded-md bg-[var(--color-ether-surface-ghost)]"
              data-testid="dryrun-preview-label"
              style={{ color: dryRunSuccess ? 'var(--color-gold)' : 'var(--color-coral)' }}
            >
              {t('dataDoctorDryRunPreview')}
            </span>
          </div>

          {dryRun.planned_paths.length > 0 && (
            <div className="text-sm text-[var(--color-secondary)] mb-4">
              <div className="text-xs text-[var(--color-muted)] uppercase tracking-wider mb-1">
                {t('dataDoctorPlannedPaths')}
              </div>
              <ul className="space-y-1" data-testid="dryrun-planned-paths">
                {dryRun.planned_paths.map((path, i) => (
                  <li key={i} className="font-mono text-xs text-[var(--color-muted)]">
                    {path}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {dryRun.error && (
            <div className="text-sm text-[var(--color-coral)] mb-4">
              {dryRun.error}
            </div>
          )}
          </div>
        </GlassCard>
      )}

      {/* Apply result */}
      {applyResult && (
        <GlassCard className="p-6 mb-6">
          <div data-testid="apply-result-section">
          <div className="flex items-center gap-2 mb-4">
            <span
              className="material-symbols-outlined text-lg"
              style={{ color: applyResult.applied ? 'var(--color-gold)' : 'var(--color-coral)' }}
            >
              {applyResult.applied ? 'check_circle' : 'error'}
            </span>
            <h2 className="text-base font-semibold text-[var(--color-primary)]">
              {t('dataDoctorApplyTitle')}
            </h2>
          </div>

          <div
            className="text-sm mb-3"
            style={{ color: applyResult.applied ? 'var(--color-gold)' : 'var(--color-coral)' }}
          >
            {applyResult.applied ? t('dataDoctorApplySuccess') : t('dataDoctorApplyFailed')}
          </div>

          {applyResult.changed_paths.length > 0 && (
            <div className="text-sm text-[var(--color-secondary)]">
              <div className="text-xs text-[var(--color-muted)] uppercase tracking-wider mb-1">
                {t('dataDoctorChangedPaths')}
              </div>
              <ul className="space-y-1" data-testid="apply-changed-paths">
                {applyResult.changed_paths.map((path, i) => (
                  <li key={i} className="font-mono text-xs text-[var(--color-muted)]">
                    {path}
                  </li>
                ))}
              </ul>
            </div>
          )}
          </div>
        </GlassCard>
      )}

      {/* Post-check */}
      {postCheck && (
        <GlassCard className="p-6 mb-6">
          <div data-testid="postcheck-section">
          <div className="flex items-center gap-2 mb-4">
            <span
              className="material-symbols-outlined text-lg"
              style={{ color: postCheck.passed ? 'var(--color-gold)' : 'var(--color-coral)' }}
            >
              {postCheck.passed ? 'verified' : 'error'}
            </span>
            <h2 className="text-base font-semibold text-[var(--color-primary)]">
              {t('dataDoctorPostCheck')}
            </h2>
          </div>
          <p
            className="text-sm"
            style={{ color: postCheck.passed ? 'var(--color-gold)' : 'var(--color-coral)' }}
          >
            {postCheck.message}
          </p>
          </div>
        </GlassCard>
      )}

      {/* Action controls */}
      {selectedIssue && !applyResult && (
        <GlassCard className="p-6 mb-6" hoverable={false}>
          <div className="flex flex-col gap-4">
            {/* Plan / Dry-run buttons */}
            <div className="flex flex-wrap gap-3">
              {!plan && (
                <button
                  type="button"
                  onClick={() => onPlan(selectedIssue.issue_id)}
                  className="px-4 py-2 rounded-lg text-sm border border-white/[0.08] text-[var(--color-secondary)] bg-[var(--color-ether-surface-ghost)] hover:bg-[var(--color-ether-control)] hover:text-[var(--color-primary)] transition-colors duration-300"
                  data-testid="plan-button"
                >
                  {t('dataDoctorPlan')}
                </button>
              )}

              {plan && !dryRun && (
                <button
                  type="button"
                  onClick={() => onDryRun(selectedIssue.issue_id)}
                  className="px-4 py-2 rounded-lg text-sm border border-white/[0.08] text-[var(--color-secondary)] bg-[var(--color-ether-surface-ghost)] hover:bg-[var(--color-ether-control)] hover:text-[var(--color-primary)] transition-colors duration-300"
                  data-testid="dryrun-button"
                >
                  {t('dataDoctorDryRun')}
                </button>
              )}
            </div>

            {/* Confirmation + Apply */}
            {plan && (
              <div className="pt-4 border-t border-white/[0.06]">
                {dryRunSuccess && (
                  <label className="flex items-start gap-3 cursor-pointer mb-4">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => onConfirmationToggle(e.target.checked)}
                      className="mt-0.5 accent-[var(--color-gold)]"
                      data-testid="confirm-checkbox"
                    />
                    <span className="text-sm text-[var(--color-secondary)]">
                      {t('dataDoctorConfirmApply')}
                    </span>
                  </label>
                )}

                <button
                  type="button"
                  onClick={() => onApply(selectedIssue.issue_id)}
                  disabled={!applyEnabled}
                  className="px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-300
                    bg-[var(--color-ether-surface-ghost)] text-[var(--color-secondary)] border border-white/[0.08]
                    hover:bg-[var(--color-ether-control)] hover:text-[var(--color-primary)]
                    disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid="apply-button"
                >
                  {t('dataDoctorApply')}
                </button>

                {!applyEnabled && !dryRunSuccess && (
                  <p className="text-xs text-[var(--color-muted)] mt-2">
                    {t('dataDoctorApplyNeedDryRun')}
                  </p>
                )}

                {!applyEnabled && dryRunSuccess && !confirmed && (
                  <p className="text-xs text-[var(--color-muted)] mt-2">
                    {t('dataDoctorApplyNeedConfirm')}
                  </p>
                )}
              </div>
            )}
          </div>
        </GlassCard>
      )}

      {/* Post-check button after apply */}
      {applyResult && !postCheck && (
        <div className="flex justify-center mb-6">
          <button
            type="button"
            onClick={onPostCheck}
            className="px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-300
              bg-[var(--color-ether-surface-ghost)] text-[var(--color-secondary)] border border-white/[0.08]
              hover:bg-[var(--color-ether-control)] hover:text-[var(--color-primary)]"
            data-testid="postcheck-button"
          >
            {t('dataDoctorPostCheck')}
          </button>
        </div>
      )}

      {/* Retry button (always available when not loading) */}
      {!auditLoading && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onRetry}
            className="px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-300
              bg-[var(--color-ether-surface-ghost)] text-[var(--color-secondary)] border border-white/[0.08]
              hover:bg-[var(--color-ether-control)] hover:text-[var(--color-primary)]"
            data-testid="retry-button"
          >
            {t('dataDoctorRetry')}
          </button>
        </div>
      )}
    </section>
  );
}
