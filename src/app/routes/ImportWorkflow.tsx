import { useMemo, useState } from 'react';
import {
  useImportPlan,
  useImportRun,
  useImportStatus,
  useImportRollback,
} from '@/hooks/useImports';
import { GlassCard } from '@/components/celestial/GlassCard';
import { CelestialLoader } from '@/components/celestial/CelestialLoader';
import { useTranslation } from '@/hooks/useTranslation';
import type {
  ImportPlanResponse,
  ImportRollbackResponse,
  ImportStatusResponse,
} from '@/lib/api-client';

// ── Source adapters ──────────────────────────────────────────────────────────
// Fixture and photo timeline are CLI-owned import adapters. Social remains
// disabled until the CLI exposes a stable adapter handoff.

const SOURCES = [
  { id: 'fixture.import_records', enabled: true },
  { id: 'media.photo_timeline', enabled: true },
  { id: 'social', enabled: false },
] as const;

type ImportSourceId = (typeof SOURCES)[number]['id'];

// ── Error shape ──────────────────────────────────────────────────────────────
// In production, errors are APIClientError instances. In tests, plain objects.
// Access properties defensively to handle both shapes.

interface ImportDisplayError {
  code?: string;
  message?: string;
  user_message?: string;
  detail?: unknown;
  remediation?: string;
  details?: { reason?: string };
}

function getErrorMessage(error: ImportDisplayError): string | undefined {
  return error.user_message ?? error.message ?? error.remediation;
}

function formatErrorDetail(detail: unknown): string | undefined {
  if (detail == null) return undefined;
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

function issueCode(issue: Record<string, unknown>): string | undefined {
  return typeof issue.code === 'string'
    ? issue.code
    : typeof issue.type === 'string'
      ? issue.type
      : undefined;
}

function issueMessage(issue: Record<string, unknown>): string | undefined {
  return typeof issue.message === 'string'
    ? issue.message
    : typeof issue.resolution === 'string'
      ? issue.resolution
      : undefined;
}

function attachmentLabel(attachment: Record<string, unknown>): string {
  const candidates = [
    attachment.name,
    attachment.source_rel_path,
    attachment.target_rel_path,
    attachment.attachment_id,
    attachment.source_ref,
  ];
  const value = candidates.find((candidate): candidate is string => (
    typeof candidate === 'string' && candidate.length > 0
  ));
  return value ?? 'Attachment';
}

function attachmentTarget(attachment: Record<string, unknown>): string | undefined {
  return typeof attachment.target_rel_path === 'string'
    ? attachment.target_rel_path
    : undefined;
}

function IssueList({
  issues,
  tone,
  testId,
  title,
}: {
  issues: Array<Record<string, unknown>> | undefined;
  tone: 'warning' | 'conflict';
  testId: string;
  title: string;
}) {
  if (!issues || issues.length === 0) return null;

  const color = tone === 'conflict' ? 'var(--color-coral)' : 'var(--color-amber)';

  return (
    <div data-testid={testId} className="mt-3 space-y-2">
      <div className="flex items-center gap-1 text-xs font-medium" style={{ color }}>
        <span className="material-symbols-rounded text-sm">
          {tone === 'conflict' ? 'error' : 'warning'}
        </span>
        {title}
      </div>
      {issues.map((issue, index) => {
        const code = issueCode(issue);
        const message = issueMessage(issue);
        return (
          <div key={`${code ?? tone}-${index}`} className="text-xs">
            {code && (
              <span className="font-mono mr-2" style={{ color }}>
                {code}
              </span>
            )}
            {message && (
              <span className="text-[var(--color-text)]">{message}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function requiresReplan(error: ImportDisplayError): boolean {
  return (
    error.code === 'IMPORT_IDEMPOTENCY_CONFLICT' ||
    (error.code === 'VALIDATION_ERROR' && error.details?.reason === 'replan_required')
  );
}

function ImportErrorCard({
  error,
  onReplan,
  testIdPrefix,
  t,
}: {
  error: ImportDisplayError;
  onReplan?: () => void;
  testIdPrefix: string;
  t: (key: string) => string;
}) {
  const message = getErrorMessage(error);
  const detail = formatErrorDetail(error.detail);
  const showReplan = requiresReplan(error);

  return (
    <div
      data-testid={`${testIdPrefix}-card`}
      className="border border-[var(--color-coral)] rounded-lg p-4 bg-[var(--color-coral)]/10"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="material-symbols-rounded text-[var(--color-coral)]">
          error
        </span>
        <span
          data-testid={`${testIdPrefix}-code`}
          className="text-sm font-mono text-[var(--color-coral)]"
        >
          {error.code}
        </span>
      </div>
      {message && (
        <p className="text-sm text-[var(--color-text)]">{message}</p>
      )}
      {detail && (
        <p className="text-xs text-[var(--color-muted)] mt-2">{detail}</p>
      )}
      {showReplan && (
        <div
          data-testid={`${testIdPrefix}-replan`}
          className="mt-3 pt-3 border-t border-[var(--color-surface-dim)]"
        >
          <p className="text-xs text-[var(--color-amber)]">
            {t('importErrorReplan')}
          </p>
          {onReplan && (
            <button
              onClick={onReplan}
              className="mt-2 px-5 py-2 rounded-full text-[0.75rem] font-medium cursor-pointer transition-all"
              style={{
                background: 'transparent',
                color: 'var(--color-amber)',
                border: '1px solid rgba(249, 135, 62, 0.3)',
                fontFamily: 'var(--font-control)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {t('importReplan')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Step badge ───────────────────────────────────────────────────────────────
function StepBadge({
  active,
  label,
  en,
}: {
  active: boolean;
  label: string;
  en: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-medium"
        style={{
          background: active ? 'rgba(255, 231, 146, 0.12)' : 'rgba(255, 255, 255, 0.05)',
          color: active ? 'var(--color-gold)' : 'var(--color-muted)',
          border: `1px solid ${active ? 'rgba(255, 231, 146, 0.25)' : 'rgba(255, 255, 255, 0.08)'}`,
          fontFamily: 'var(--font-order)',
        }}
      >
        {active ? '●' : '○'}
      </span>
      <span
        className="text-xs"
        style={{
          color: active ? 'var(--color-primary)' : 'var(--color-muted)',
          fontFamily: 'var(--font-control)',
        }}
      >
        {label}
        <span
          className="ml-1 text-[10px] uppercase tracking-wider"
          style={{ color: 'var(--color-muted)', opacity: 0.6 }}
        >
          {en}
        </span>
      </span>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * ImportWorkflow — single-route import workflow page.
 *
 * Provides a compact, step-through flow for Tranche A fixture imports:
 * source selection → input path → plan preview → confirm run → status → rollback.
 *
 * DESIGN.md refs:
 * - The Fixed Page Incantation Rule: fixed bilingual title组合
 * - button-primary: transparent bg, gold text, gold border (opacity 0.3)
 * - input-focus: gold border corners + outer glow
 * - field-placeholder: Narrative voice, italic, --color-secondary
 * - Ether Card: rgba(0,0,0,0.39) bg, gradient-fade border, 24px radius
 */
export default function ImportWorkflow() {
  const { t, lang } = useTranslation();
  const [inputPath, setInputPath] = useState('');
  const [importId, setImportId] = useState<string | undefined>();
  const [selectedSource, setSelectedSource] = useState<ImportSourceId>(
    'fixture.import_records',
  );
  const [helpOpen, setHelpOpen] = useState(false);

  const planHook = useImportPlan();
  const runHook = useImportRun();
  const statusHook = useImportStatus(importId);
  const rollbackHook = useImportRollback();

  // Derived state
  const planData = planHook.data as ImportPlanResponse | undefined;
  const statusData = statusHook.data as ImportStatusResponse | undefined;
  const rollbackData = rollbackHook.data as ImportRollbackResponse | undefined;
  const planError = planHook.error as ImportDisplayError | null;
  const runError = runHook.error as ImportDisplayError | null;
  const statusError = statusHook.error as ImportDisplayError | null;
  const rollbackError = rollbackHook.error as ImportDisplayError | null;
  const statusLastError = statusData?.last_error as ImportDisplayError | undefined;
  const planHasConflicts = useMemo(() => {
    if (!planData) return false;
    const conflictCount = planData.summary?.conflict_count ?? 0;
    const planConflicts = planData.conflicts?.length ?? 0;
    const proposalConflicts = planData.proposals?.some(
      (proposal) => (proposal.conflicts?.length ?? 0) > 0,
    ) ?? false;
    return conflictCount > 0 || planConflicts > 0 || proposalConflicts;
  }, [planData]);

  // ── Handlers ────────────────────────────────────────────────────────────

  function handleGeneratePlan() {
    if (!inputPath.trim()) return;
    planHook.mutate({ source: selectedSource, input_path: inputPath });
  }

  function handleConfirmRun() {
    const id = planData?.import_id;
    if (!id) return;
    setImportId(id);
    runHook.mutate(id);
  }

  function handleRollback() {
    const id = statusData?.import_id ?? importId;
    if (!id) return;
    rollbackHook.mutate(id);
  }

  // ── Status counts (defensive cast) ──────────────────────────────────────

  const statusCounts = statusData?.counts as
    | { committed?: number; failed?: number; skipped?: number }
    | undefined;

  // ── Primary button style (button-primary per DESIGN.md) ─────────────────
  const primaryButtonStyle: React.CSSProperties = {
    background: 'transparent',
    color: 'var(--color-gold)',
    border: '1px solid rgba(255, 231, 146, 0.3)',
    fontFamily: 'var(--font-control)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  };

  const primaryButtonHoverClass =
    'hover:bg-[rgba(255,231,146,0.08)] hover:border-[rgba(255,231,146,0.5)]';

  // ── Render ──────────────────────────────────────────────────────────────

  const titlePrimary = lang === 'en' ? 'Import Data' : '导入数据';
  const titleSecondary = lang === 'en' ? '导入数据' : 'Import Data';

  return (
    <div
      data-testid="import-workflow-page"
      className="max-w-[800px] mx-auto px-6 py-8 space-y-6"
    >
      {/* ── Bilingual page header ──────────────────────────────────────── */}
      <header className="text-center mb-8">
        <h1
          className="text-[var(--color-primary)] font-normal"
          style={{
            fontFamily: 'var(--font-divine)',
            fontSize: 'clamp(1.75rem, 5vw, 2.25rem)',
            lineHeight: 1.3,
            letterSpacing: '0.08em',
          }}
        >
          {titlePrimary}
        </h1>
        <p
          className="mt-2"
          style={{
            color: 'var(--color-muted)',
            fontFamily: 'var(--font-order)',
            fontSize: 'clamp(0.75rem, 1vw, 0.875rem)',
            lineHeight: 1.6,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            opacity: 0.62,
          }}
        >
          {titleSecondary}
        </p>
      </header>

      {/* ── Step guidance ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <StepBadge active={true} label="选择来源" en="Source" />
        <span className="text-[var(--color-muted)] text-xs">→</span>
        <StepBadge active={inputPath.trim().length > 0} label="输入路径" en="Path" />
        <span className="text-[var(--color-muted)] text-xs">→</span>
        <StepBadge active={!!planData} label="生成计划" en="Plan" />
      </div>

      {/* ── Source selection chips ─────────────────────────────────────── */}
      <GlassCard>
        <label className="block text-xs text-[var(--color-muted)] uppercase tracking-wider mb-3" style={{ fontFamily: 'var(--font-order)' }}>
          {t('importSourceLabel')}
        </label>
        <div className="flex gap-2 flex-wrap">
          {SOURCES.map((source) => (
            <button
              key={source.id}
              data-testid={`source-chip-${source.id}`}
              disabled={!source.enabled}
              onClick={() => {
                if (!source.enabled) return;
                setSelectedSource(source.id);
                setImportId(undefined);
                planHook.reset();
                runHook.reset();
                rollbackHook.reset();
              }}
              className={`px-3 py-1.5 rounded-full text-sm border transition-all inline-flex items-center gap-1.5 ${
                source.enabled && selectedSource === source.id
                  ? 'border-[var(--color-gold)] text-[var(--color-gold)] cursor-pointer bg-[rgba(255,231,146,0.05)]'
                  : source.enabled
                    ? 'border-[var(--color-surface-dim)] text-[var(--color-text)] cursor-pointer hover:border-[rgba(255,231,146,0.25)]'
                    : 'border-dashed border-[rgba(255,180,166,0.25)] text-[var(--color-muted)] cursor-not-allowed'
              }`}
              style={{ fontFamily: 'var(--font-control)' }}
            >
              {t(`importSource_${source.id}`)}
              {!source.enabled && (
                <span
                  className="text-[10px] uppercase tracking-wider"
                  style={{ color: 'var(--color-coral)', opacity: 0.7 }}
                >
                  {t('comingSoon')}
                </span>
              )}
            </button>
          ))}
        </div>
      </GlassCard>

      {/* ── Collapsible import help panel (ISS-019) ────────────────────── */}
      <GlassCard className="overflow-hidden" hoverable={false}>
        <button
          type="button"
          data-testid="import-help-toggle"
          onClick={() => setHelpOpen((o) => !o)}
          className="w-full flex items-center justify-between cursor-pointer"
          aria-expanded={helpOpen}
        >
          <span
            className="text-xs font-medium uppercase tracking-wider"
            style={{ fontFamily: 'var(--font-order)', color: 'var(--color-muted)' }}
          >
            <span className="material-symbols-outlined text-sm align-text-bottom mr-1.5">help_outline</span>
            {t('importHelpTitle')}
          </span>
          <span
            className="material-symbols-outlined text-sm transition-transform duration-300"
            style={{ color: 'var(--color-muted)', transform: helpOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            expand_more
          </span>
        </button>

        {helpOpen && (
          <div data-testid="import-help-content" className="mt-4 space-y-4">
            {/* Supported sources */}
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wider mb-2" style={{ fontFamily: 'var(--font-order)', color: 'var(--color-secondary)' }}>
                {t('importHelpSources')}
              </p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-[var(--color-text)]">
                  <span className="material-symbols-outlined text-sm text-[var(--color-gold)]">database</span>
                  {t('importHelpSourceFixture')}
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--color-text)]">
                  <span className="material-symbols-outlined text-sm text-[var(--color-cyan)]">photo_library</span>
                  {t('importHelpSourcePhoto')}
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                  <span className="material-symbols-outlined text-sm text-[var(--color-coral)]">schedule</span>
                  {t('importHelpSourceSocial')}
                </div>
              </div>
            </div>

            {/* Path examples */}
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wider mb-2" style={{ fontFamily: 'var(--font-order)', color: 'var(--color-secondary)' }}>
                {t('importHelpPathTitle')}
              </p>
              <div className="space-y-1">
                <code className="block text-[11px] text-[var(--color-primary)] font-mono bg-[var(--color-ether-surface-ghost)] px-2 py-1 rounded">
                  {t('importHelpPathFixtureExample')}
                </code>
                <code className="block text-[11px] text-[var(--color-primary)] font-mono bg-[var(--color-ether-surface-ghost)] px-2 py-1 rounded">
                  {t('importHelpPathPhotoExample')}
                </code>
              </div>
            </div>

            {/* Flow */}
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wider mb-2" style={{ fontFamily: 'var(--font-order)', color: 'var(--color-secondary)' }}>
                {t('importHelpFlowTitle')}
              </p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {[
                  t('importHelpFlowPlan'),
                  t('importHelpFlowPreview'),
                  t('importHelpFlowConfirm'),
                  t('importHelpFlowExecute'),
                  t('importHelpFlowCheckStatus'),
                ].map((step, i, arr) => (
                  <span key={step} className="flex items-center gap-1.5">
                    <span className="text-[11px] px-2 py-0.5 rounded-full border" style={{ color: 'var(--color-gold)', borderColor: 'rgba(255,231,146,0.15)', fontFamily: 'var(--font-control)' }}>
                      {step}
                    </span>
                    {i < arr.length - 1 && (
                      <span className="text-[var(--color-muted)] text-[10px]">→</span>
                    )}
                  </span>
                ))}
              </div>
            </div>

            {/* Rollback */}
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,180,166,0.06)', border: '1px solid rgba(255,180,166,0.12)' }}>
              <p className="flex items-center gap-1.5 text-[0.6875rem] uppercase tracking-wider mb-1" style={{ fontFamily: 'var(--font-order)', color: 'var(--color-coral)' }}>
                <span className="material-symbols-outlined text-sm">undo</span>
                {t('importHelpRollbackTitle')}
              </p>
              <p className="text-[11px] text-[var(--color-text)] leading-relaxed">
                {t('importHelpRollbackDesc')}
              </p>
            </div>

            {/* Troubleshooting */}
            <div>
              <p className="text-[0.6875rem] uppercase tracking-wider mb-2" style={{ fontFamily: 'var(--font-order)', color: 'var(--color-secondary)' }}>
                {t('importHelpTroubleTitle')}
              </p>
              <ul className="space-y-1.5">
                <li className="flex items-start gap-1.5 text-[11px] text-[var(--color-text)]">
                  <span className="material-symbols-outlined text-[10px] text-[var(--color-amber)] mt-0.5">warning</span>
                  {t('importHelpTroubleStalePlan')}
                </li>
                <li className="flex items-start gap-1.5 text-[11px] text-[var(--color-text)]">
                  <span className="material-symbols-outlined text-[10px] text-[var(--color-amber)] mt-0.5">folder_off</span>
                  {t('importHelpTroublePathError')}
                </li>
                <li className="flex items-start gap-1.5 text-[11px] text-[var(--color-text)]">
                  <span className="material-symbols-outlined text-[10px] text-[var(--color-amber)] mt-0.5">error</span>
                  {t('importHelpTroubleConflict')}
                </li>
              </ul>
            </div>
          </div>
        )}
      </GlassCard>

      {/* ── Input field and generate-plan action ───────────────────────── */}
      <GlassCard>
        <div className="flex gap-3 focus-within:shadow-[0_0_30px_rgba(255,231,146,0.1)] transition-shadow duration-300 rounded-lg">
          <input
            data-testid="import-input-path"
            type="text"
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            placeholder={`${t('importInputPathPlaceholder')}  /path/to/data.json`}
            className="li-field-placeholder flex-1 bg-transparent border border-[var(--color-surface-dim)] rounded-lg px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-secondary)] focus:outline-none focus:border-[var(--color-gold-45)] hover:border-[var(--color-gold)]/30 transition-colors duration-300"
          />
          <button
            data-testid="import-generate-plan"
            onClick={handleGeneratePlan}
            disabled={planHook.isPending}
            className={`px-5 py-2 rounded-full text-[0.75rem] font-medium cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed ${primaryButtonHoverClass}`}
            style={primaryButtonStyle}
          >
            {planHook.isPending ? t('importGenerating') : t('importGeneratePlan')}
          </button>
        </div>
      </GlassCard>

      {/* ── Dry-run loading state ──────────────────────────────────────── */}
      {planHook.isPending && (
        <div className="flex justify-center py-4">
          <CelestialLoader />
        </div>
      )}

      {/* ── Empty state guidance ───────────────────────────────────────── */}
      {!planData && !planHook.isPending && !planHook.isError && !statusData && (
        <GlassCard className="p-6 text-center" hoverable={false}>
          <span className="material-symbols-outlined text-[var(--color-secondary)] text-3xl mb-3 block">upload_file</span>
          <p className="text-[var(--color-secondary)] text-sm">
            {lang === 'en'
              ? 'Select a source and enter a path to begin.'
              : '选择来源并输入路径以开始导入。'}
          </p>
        </GlassCard>
      )}

      {/* ── Structured error cards ─────────────────────────────────────── */}
      {planHook.isError && planError && (
        <ImportErrorCard
          error={planError}
          onReplan={() => {
            planHook.reset();
          }}
          testIdPrefix="import-error"
          t={t}
        />
      )}
      {runHook.isError && runError && (
        <ImportErrorCard
          error={runError}
          onReplan={() => {
            runHook.reset();
            planHook.reset();
            setImportId(undefined);
          }}
          testIdPrefix="import-run-error"
          t={t}
        />
      )}
      {statusHook.isError && statusError && (
        <ImportErrorCard
          error={statusError}
          testIdPrefix="import-status-error"
          t={t}
        />
      )}
      {rollbackHook.isError && rollbackError && (
        <ImportErrorCard
          error={rollbackError}
          testIdPrefix="import-rollback-error"
          t={t}
        />
      )}

      {/* ── Plan preview ───────────────────────────────────────────────── */}
      {planData && (
        <>
          {/* Plan summary */}
          <div data-testid="import-plan-summary">
            <GlassCard>
              <h3 className="text-sm font-medium text-[var(--color-text)] mb-3">
                {t('importPlanSummary')}
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-[var(--color-muted)]">
                    {t('importProposedEntries')}
                  </span>{' '}
                  <span className="text-[var(--color-text)]">
                    {planData.summary?.proposed_journal_count ?? 0}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--color-muted)]">
                    {t('importProposedAttachments')}
                  </span>{' '}
                  <span className="text-[var(--color-text)]">
                    {planData.summary?.proposed_attachment_count ?? 0}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--color-muted)]">
                    {t('importConflicts')}
                  </span>{' '}
                  <span className="text-[var(--color-text)]">
                    {planData.summary?.conflict_count ?? 0}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--color-muted)]">
                    {t('importWarnings')}
                  </span>{' '}
                  <span className="text-[var(--color-text)]">
                    {planData.summary?.warning_count ?? 0}
                  </span>
                </div>
              </div>
            </GlassCard>
          </div>

          {/* Proposal cards */}
          {planData.proposals?.map((proposal) => (
            <div
              key={proposal.proposal_id}
              data-testid={`import-proposal-${proposal.proposal_id}`}
            >
              <GlassCard>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text)]">
                      {proposal.journal?.title ?? proposal.source_record_id}
                    </p>
                    {proposal.journal?.date_time && (
                      <p className="text-xs text-[var(--color-muted)]">
                        {proposal.journal.date_time}
                      </p>
                    )}
                    {!proposal.journal?.date_time && proposal.journal?.date && (
                      <p className="text-xs text-[var(--color-muted)]">
                        {proposal.journal.date}
                      </p>
                    )}
                  </div>
                  {proposal.warnings && proposal.warnings.length > 0 && (
                    <span className="material-symbols-rounded text-[var(--color-amber)] text-sm">
                      warning
                    </span>
                  )}
                </div>
                {proposal.attachments && proposal.attachments.length > 0 && (
                  <div className="mt-2 text-xs text-[var(--color-muted)]">
                    {proposal.attachments.map((a, i) => (
                      <span key={i} className="inline-flex flex-col gap-1 mr-3">
                        <span className="inline-flex items-center gap-1">
                          <span className="material-symbols-rounded text-xs">
                            attach_file
                          </span>
                          {attachmentLabel(a as Record<string, unknown>)}
                        </span>
                        {attachmentTarget(a as Record<string, unknown>) && (
                          <span className="text-[var(--color-muted)]/80">
                            {attachmentTarget(a as Record<string, unknown>)}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                <IssueList
                  issues={proposal.warnings as Array<Record<string, unknown>> | undefined}
                  tone="warning"
                  testId={`import-proposal-${proposal.proposal_id}-warnings`}
                  title={t('importWarnings')}
                />
                <IssueList
                  issues={proposal.conflicts as Array<Record<string, unknown>> | undefined}
                  tone="conflict"
                  testId={`import-proposal-${proposal.proposal_id}-conflicts`}
                  title={t('importConflicts')}
                />
              </GlassCard>
            </div>
          ))}

          {/* Plan-level warnings */}
          {planData.warnings && planData.warnings.length > 0 && (
            <div data-testid="import-plan-warnings">
              <GlassCard>
                <h4 className="text-xs font-medium text-[var(--color-amber)] mb-2 flex items-center gap-1">
                  <span className="material-symbols-rounded text-sm">warning</span>
                  {t('importWarnings')}
                </h4>
                {planData.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-[var(--color-text)] mb-1">
                    <span className="font-mono text-[var(--color-amber)] mr-2">
                      {w.code}
                    </span>
                    {w.message}
                  </p>
                ))}
              </GlassCard>
            </div>
          )}

          <IssueList
            issues={planData.conflicts as Array<Record<string, unknown>> | undefined}
            tone="conflict"
            testId="import-plan-conflicts"
            title={t('importConflicts')}
          />

          {/* Confirm-run affordance */}
          <button
            data-testid="import-confirm-run"
            onClick={handleConfirmRun}
            disabled={runHook.isPending || planHasConflicts}
            className={`px-5 py-2 rounded-full text-[0.75rem] font-medium cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed ${primaryButtonHoverClass}`}
            style={primaryButtonStyle}
          >
            {runHook.isPending ? t('importRunning') : t('importConfirmRun')}
          </button>
        </>
      )}

      {/* ── Run status/result ──────────────────────────────────────────── */}
      {statusData && (
        <div data-testid="import-status-result">
          <GlassCard>
            <h3 className="text-sm font-medium text-[var(--color-text)] mb-3">
              {t('importStatusResult')}
            </h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div
                  data-testid="import-count-committed"
                  className="text-2xl font-light text-[var(--color-gold)]"
                >
                  {statusCounts?.committed ?? 0}
                </div>
                <div className="text-xs text-[var(--color-muted)]">
                  {t('importCommitted')}
                </div>
              </div>
              <div>
                <div
                  data-testid="import-count-failed"
                  className="text-2xl font-light text-[var(--color-coral)]"
                >
                  {statusCounts?.failed ?? 0}
                </div>
                <div className="text-xs text-[var(--color-muted)]">
                  {t('importFailed')}
                </div>
              </div>
              <div>
                <div
                  data-testid="import-count-skipped"
                  className="text-2xl font-light text-[var(--color-muted)]"
                >
                  {statusCounts?.skipped ?? 0}
                </div>
                <div className="text-xs text-[var(--color-muted)]">
                  {t('importSkipped')}
                </div>
              </div>
            </div>
            {statusLastError && (
              <div className="mt-4">
                <ImportErrorCard
                  error={statusLastError}
                  testIdPrefix="import-status-last-error"
                  t={t}
                />
              </div>
            )}
          </GlassCard>
        </div>
      )}

      {/* ── Rollback ───────────────────────────────────────────────────── */}
      {statusData?.rollback_available && (
        <button
          data-testid="import-rollback-btn"
          onClick={handleRollback}
          disabled={rollbackHook.isPending}
          className="px-5 py-2 rounded-full text-[0.75rem] font-medium cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[rgba(255,180,166,0.08)] hover:border-[rgba(255,180,166,0.25)]"
          style={{
            background: 'transparent',
            color: 'var(--color-coral)',
            border: '1px solid rgba(255, 180, 166, 0.3)',
            fontFamily: 'var(--font-control)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {rollbackHook.isPending ? t('importRollbackRunning') : t('importRollback')}
        </button>
      )}
      {rollbackData && (
        <div data-testid="import-rollback-result">
          <GlassCard>
            <h3 className="text-sm font-medium text-[var(--color-text)] mb-3">
              {t('importRollbackResult')}
            </h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-[var(--color-muted)]">
                  {t('importRollbackState')}
                </span>{' '}
                <span className="text-[var(--color-text)]">
                  {rollbackData.state}
                </span>
              </div>
              <div>
                <span className="text-[var(--color-muted)]">
                  {t('importRollbackDeleted')}
                </span>{' '}
                <span
                  data-testid="import-rollback-deleted-count"
                  className="text-[var(--color-text)]"
                >
                  {rollbackData.deleted_count ?? 0}
                </span>
              </div>
            </div>
            {rollbackData.errors?.map((error, index) => (
              <div key={index} className="mt-4">
                <ImportErrorCard
                  error={error as ImportDisplayError}
                  testIdPrefix={`import-rollback-result-error-${index}`}
                  t={t}
                />
              </div>
            ))}
          </GlassCard>
        </div>
      )}
    </div>
  );
}
