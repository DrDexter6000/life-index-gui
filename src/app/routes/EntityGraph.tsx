import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '@/components/celestial/GlassCard';
import { CelestialLoader } from '@/components/celestial/CelestialLoader';
import { useTranslation } from '@/hooks/useTranslation';
import {
  useEntityStats,
  useEntityList,
  useEntityCheck,
  useEntityAudit,
  useEntityReview,
  useEntityCandidateEdges,
  useEntityMutationPreview,
  useEntityMutationConfirm,
  useVersionCheck,
} from '@/hooks/useJournals';
import type {
  EntityStats,
  EntityItem,
  EntityCheckResponse,
  EntityAuditResponse,
  EntityReviewResponse,
  CandidateEdgesResponse,
  EntityMutationRequest,
  EntityMutationPreviewResponse,
  EntityMutationConfirmResponse,
} from '@/lib/api-client';

type EntityType = 'all' | 'actor' | 'place' | 'project' | 'event' | 'artifact' | 'concept';
type ReviewActionOperation = Exclude<EntityMutationRequest['operation'], 'delete'>;

type ReviewActionChoice = {
  action: ReviewActionOperation;
  label?: string;
  description?: string;
  source_id?: string | null;
  target_id?: string | null;
  relation?: string | null;
  preview_required?: boolean;
  evidence?: string[];
};

type ActiveReviewState = {
  itemId: string;
  request: EntityMutationRequest;
  preview: EntityMutationPreviewResponse | null;
  accepted: boolean;
  result: EntityMutationConfirmResponse | null;
  error: string | null;
};

const REVIEW_ACTION_OPERATIONS = new Set<ReviewActionOperation>([
  'merge_as_alias',
  'keep_separate',
  'undo_keep_separate',
  'add_relationship',
  'confirm_candidate',
  'reject_candidate',
  'skip',
]);

const REVIEW_CARDS_MIN_CLI_VERSION = '1.4.5';

const TYPE_OPTIONS: { value: EntityType; i18nKey: string }[] = [
  { value: 'all', i18nKey: 'entityTypeAll' },
  { value: 'actor', i18nKey: 'entityTypeActor' },
  { value: 'place', i18nKey: 'entityTypePlace' },
  { value: 'project', i18nKey: 'entityTypeProject' },
  { value: 'event', i18nKey: 'entityTypeEvent' },
  { value: 'artifact', i18nKey: 'entityTypeArtifact' },
  { value: 'concept', i18nKey: 'entityTypeConcept' },
];

function versionParts(version: string): number[] | null {
  const normalized = version.trim();
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) return null;
  return normalized.split('.').map((part) => Number.parseInt(part, 10));
}

function isVersionBelow(current: string | null | undefined, minimum: string): boolean {
  if (!current) return true;
  const currentParts = versionParts(current);
  const minimumParts = versionParts(minimum);
  if (!currentParts || !minimumParts) return true;
  for (let index = 0; index < Math.max(currentParts.length, minimumParts.length); index += 1) {
    const currentPart = currentParts[index] ?? 0;
    const minimumPart = minimumParts[index] ?? 0;
    if (currentPart < minimumPart) return true;
    if (currentPart > minimumPart) return false;
  }
  return false;
}

/**
 * EntityGraph — entity graph inspection and review queues surface.
 *
 * Shows entity statistics, entity listing with type filter, graph integrity
 * checks, quality audits, review queues, candidate relationship edges, and
 * guarded preview-first mutation controls.
 */
export default function EntityGraph() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [entityTypeFilter, setEntityTypeFilter] = useState<EntityType>('all');
  const previewMutation = useEntityMutationPreview();
  const confirmMutation = useEntityMutationConfirm();
  const versionQuery = useVersionCheck();
  const cliFeatureEnabled = versionQuery.data?.compatible === true;

  const {
    data: statsData,
    isLoading: statsLoading,
    isError: statsError,
    isFetching: statsFetching,
  } = useEntityStats(cliFeatureEnabled);

  const {
    data: listData,
    isLoading: listLoading,
    isError: listError,
  } = useEntityList(
    entityTypeFilter === 'all' ? undefined : entityTypeFilter,
    cliFeatureEnabled,
  );

  const {
    data: checkData,
    isLoading: checkLoading,
    isError: checkError,
  } = useEntityCheck(cliFeatureEnabled);

  const {
    data: auditData,
    isLoading: auditLoading,
    isError: auditError,
  } = useEntityAudit(cliFeatureEnabled);

  const {
    data: reviewData,
    isLoading: reviewLoading,
    isError: reviewError,
  } = useEntityReview(cliFeatureEnabled);

  const {
    data: candidateEdgesData,
    isLoading: candidateEdgesLoading,
    isError: candidateEdgesError,
  } = useEntityCandidateEdges(undefined, cliFeatureEnabled);

  const reviewActionsBlocked =
    !cliFeatureEnabled
    || isVersionBelow(versionQuery.data?.cli_package_version, REVIEW_CARDS_MIN_CLI_VERSION);

  function handleRetry() {
    queryClient.invalidateQueries({ queryKey: ['entities'] });
  }

  return (
    <div className="max-w-[800px] mx-auto px-6">
      {/* A. Header */}
      <section className="text-center mb-10" aria-label={t('entityGraph')}>
        <h1
          className="text-[var(--text-display)] font-normal tracking-[0.08em] text-[var(--color-primary)] mb-2"
          style={{ fontFamily: 'var(--font-divine)' }}
        >
          {t('entityGraph')}
        </h1>
        <p className="text-[0.9375rem] text-[var(--color-secondary)]">
          {t('entityGraphSubtitle')}
        </p>
      </section>

      {/* B. Stats Card */}
      <GlassCard className="p-6 mb-6">
        <StatsSection
          t={t}
          data={statsData}
          loading={statsLoading}
          error={statsError}
        />
      </GlassCard>

      {/* C. Entity List Card */}
      <GlassCard className="p-6 mb-6">
        <EntityListSection
          t={t}
          data={listData}
          loading={listLoading}
          error={listError}
          selectedType={entityTypeFilter}
          onTypeChange={setEntityTypeFilter}
        />
      </GlassCard>

      {/* D. Graph Check Card */}
      <GlassCard className="p-6 mb-6">
        <CheckSection
          t={t}
          data={checkData}
          loading={checkLoading}
          error={checkError}
        />
      </GlassCard>

      {/* E. Audit Card */}
      <GlassCard className="p-6 mb-6">
        <AuditSection
          t={t}
          data={auditData}
          loading={auditLoading}
          error={auditError}
        />
      </GlassCard>

      {/* F. Review Queue Card */}
      <GlassCard className="p-6 mb-6">
        <ReviewSection
          t={t}
          data={reviewData}
          loading={reviewLoading}
          error={reviewError}
          previewMutation={previewMutation}
          confirmMutation={confirmMutation}
          reviewActionsBlocked={reviewActionsBlocked}
          reviewMinCliVersion={REVIEW_CARDS_MIN_CLI_VERSION}
        />
      </GlassCard>

      {/* G. Candidate Edges Card */}
      <GlassCard className="p-6 mb-6">
        <CandidateEdgesSection
          t={t}
          data={candidateEdgesData}
          loading={candidateEdgesLoading}
          error={candidateEdgesError}
        />
      </GlassCard>

      {/* H. Guarded Mutation Card */}
      <GlassCard className="p-6 mb-6">
        <MutationSection
          t={t}
          entities={listData ?? []}
          previewMutation={previewMutation}
          confirmMutation={confirmMutation}
          featureCallsEnabled={cliFeatureEnabled}
        />
      </GlassCard>

      {/* I. Retry Button */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={handleRetry}
          disabled={statsFetching}
          className="px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-300
            bg-[var(--color-ether-surface-ghost)] text-[var(--color-secondary)] border border-white/[0.08]
            hover:bg-[var(--color-ether-control)] hover:text-[var(--color-primary)]
            disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="entity-retry-button"
        >
          {statsFetching ? t('entityRetrying') : t('entityRetry')}
        </button>
      </div>
    </div>
  );
}

/* ── Section Components ────────────────────────────────────────────────── */

function StatsSection({
  t,
  data,
  loading,
  error,
}: {
  t: (key: string) => string;
  data: EntityStats | undefined;
  loading: boolean;
  error: boolean;
}) {
  return (
    <div data-testid="entity-stats-section">
      <div className="flex items-center gap-2 mb-4">
        <span
          className="material-symbols-outlined text-lg"
          style={{ color: 'var(--color-gold)' }}
        >
          bar_chart
        </span>
        <h2 className="text-base font-semibold text-[var(--color-primary)]">
          {t('entityStats')}
        </h2>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <CelestialLoader size="sm" />
          <span>{t('entityLoading')}</span>
        </div>
      ) : error ? (
        <div className="text-sm text-[var(--color-muted)]" data-testid="entity-stats-error">
          {t('entityErrorHint')}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-[var(--color-muted)] uppercase tracking-wider mb-1">
              {t('entityStatsEntities')}
            </div>
            <div
              className="text-lg text-[var(--color-primary)]"
              data-testid="entity-stats-entities"
            >
              {data?.total_entities ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-muted)] uppercase tracking-wider mb-1">
              {t('entityStatsRelationships')}
            </div>
            <div
              className="text-lg text-[var(--color-primary)]"
              data-testid="entity-stats-relationships"
            >
              {data?.total_relationships ?? '—'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EntityListSection({
  t,
  data,
  loading,
  error,
  selectedType,
  onTypeChange,
}: {
  t: (key: string) => string;
  data: EntityItem[] | undefined;
  loading: boolean;
  error: boolean;
  selectedType: EntityType;
  onTypeChange: (type: EntityType) => void;
}) {
  return (
    <div data-testid="entity-list-section">
      <div className="flex items-center gap-2 mb-4">
        <span
          className="material-symbols-outlined text-lg"
          style={{ color: 'var(--color-gold)' }}
        >
          list
        </span>
        <h2 className="text-base font-semibold text-[var(--color-primary)]">
          {t('entityList')}
        </h2>
      </div>

      {/* Type filter buttons */}
      <div className="flex flex-wrap gap-2 mb-4" data-testid="entity-type-filter">
        {TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onTypeChange(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 border ${
              selectedType === opt.value
                ? 'bg-[var(--color-ether-control)] text-[var(--color-primary)] border-white/[0.16]'
                : 'bg-[var(--color-ether-surface-ghost)] text-[var(--color-secondary)] border-white/[0.06] hover:bg-[var(--color-ether-surface-ghost)]'
            }`}
            data-testid={`entity-type-${opt.value}`}
          >
            {t(opt.i18nKey)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <CelestialLoader size="sm" />
          <span>{t('entityLoading')}</span>
        </div>
      ) : error ? (
        <div className="text-sm text-[var(--color-muted)]">
          {t('entityListError')}
        </div>
      ) : !data || data.length === 0 ? (
        <div
          className="text-sm text-[var(--color-secondary)] py-3"
          data-testid="entity-list-empty"
        >
          {t('entityListEmpty')}
        </div>
      ) : (
        <div className="space-y-2">
          {data.map((entity) => (
            <div
              key={entity.id}
              className="flex items-center justify-between bg-[var(--color-ether-surface-ghost)] rounded-lg p-3"
              data-testid={`entity-row-${entity.id}`}
            >
              <div>
                <Link
                  to={`/entities/${encodeURIComponent(entity.id)}`}
                  className="text-sm text-[var(--color-primary)] font-medium"
                >
                  {entity.primary_name}
                </Link>
                <span className="ml-2 text-xs text-[var(--color-muted)] font-mono">
                  {entity.id}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-[var(--color-muted)] uppercase px-2 py-0.5 rounded-full bg-[var(--color-ether-surface-ghost)]">
                  {entity.type}
                </span>
                <span className="text-xs text-[var(--color-secondary)]">
                  {entity.aliases.length > 0 ? `${entity.aliases.length} aliases` : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CheckSection({
  t,
  data,
  loading,
  error,
}: {
  t: (key: string) => string;
  data: EntityCheckResponse | undefined;
  loading: boolean;
  error: boolean;
}) {
  const issues: Array<Record<string, unknown>> = (data?.issues ?? []).map((issue) =>
    typeof issue === 'string' ? { type: issue } : issue,
  );
  const hasIssues = issues.length > 0;

  return (
    <div data-testid="entity-check-section">
      <div className="flex items-center gap-2 mb-4">
        <span
          className="material-symbols-outlined text-lg"
          style={{ color: hasIssues ? 'var(--color-amber)' : 'var(--color-gold)' }}
        >
          {hasIssues ? 'warning' : 'verified'}
        </span>
        <h2 className="text-base font-semibold text-[var(--color-primary)]">
          {t('entityCheck')}
        </h2>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <CelestialLoader size="sm" />
          <span>{t('entityLoading')}</span>
        </div>
      ) : error ? (
        <div className="text-sm text-[var(--color-muted)]">
          {t('entityErrorHint')}
        </div>
      ) : hasIssues ? (
        <>
          <div className="text-sm text-[var(--color-amber)] mb-3" data-testid="entity-check-issues-count">
            {t('entityCheckIssues').replace('{{count}}', String(issues.length))}
          </div>
          <ul className="space-y-2">
            {issues.map((issue, i) => (
              <li
                key={i}
                className="text-sm text-[var(--color-secondary)] bg-[var(--color-ether-surface-ghost)] rounded-lg p-3"
              >
                <span className="text-[var(--color-amber)] font-medium">
                  {String(issue.type ?? 'unknown')}
                </span>
                {issue.entity_id && (
                  <span className="ml-2 font-mono text-xs text-[var(--color-muted)]">
                    {String(issue.entity_id)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div
          className="text-sm text-[var(--color-gold)]"
          data-testid="entity-check-clean"
        >
          {t('entityCheckClean')}
        </div>
      )}
    </div>
  );
}

function AuditSection({
  t,
  data,
  loading,
  error,
}: {
  t: (key: string) => string;
  data: EntityAuditResponse | undefined;
  loading: boolean;
  error: boolean;
}) {
  const issues: Array<Record<string, unknown>> = (data?.issues ?? []).map((issue) =>
    typeof issue === 'string' ? { type: issue } : issue,
  );
  const hasIssues = issues.length > 0;
  const summary = data?.summary ?? {};

  return (
    <div data-testid="entity-audit-section">
      <div className="flex items-center gap-2 mb-4">
        <span
          className="material-symbols-outlined text-lg"
          style={{ color: hasIssues ? 'var(--color-amber)' : 'var(--color-gold)' }}
        >
          {hasIssues ? 'assignment_late' : 'assignment_turned_in'}
        </span>
        <h2 className="text-base font-semibold text-[var(--color-primary)]">
          {t('entityAudit')}
        </h2>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <CelestialLoader size="sm" />
          <span>{t('entityLoading')}</span>
        </div>
      ) : error ? (
        <div className="text-sm text-[var(--color-muted)]">
          {t('entityErrorHint')}
        </div>
      ) : hasIssues ? (
        <>
          <div className="text-sm text-[var(--color-amber)] mb-3" data-testid="entity-audit-issues-count">
            {t('entityAuditIssues').replace('{{count}}', String(issues.length))}
          </div>
          {Object.keys(summary).length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-4">
              {Object.entries(summary).map(([severity, count]) => (
                <div
                  key={severity}
                  className="bg-[var(--color-ether-surface-ghost)] rounded-lg p-2 text-sm"
                >
                  <span className="text-[var(--color-muted)] capitalize">
                    {severity}:
                  </span>{' '}
                  <span className="text-[var(--color-primary)] font-medium">
                    {count}
                  </span>
                </div>
              ))}
            </div>
          )}
          <ul className="space-y-2">
            {issues.map((issue, i) => (
              <li
                key={i}
                className="text-sm text-[var(--color-secondary)] bg-[var(--color-ether-surface-ghost)] rounded-lg p-3"
              >
                <span className="text-[var(--color-amber)] font-medium">
                  {String(issue.type ?? 'unknown')}
                </span>
                {issue.severity && (
                  <span className="ml-2 text-xs text-[var(--color-muted)]">
                    ({String(issue.severity)})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div
          className="text-sm text-[var(--color-gold)]"
          data-testid="entity-audit-clean"
        >
          {t('entityAuditClean')}
        </div>
      )}
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function reviewActionOperation(value: unknown): ReviewActionOperation | null {
  const action = stringValue(value);
  return REVIEW_ACTION_OPERATIONS.has(action as ReviewActionOperation)
    ? (action as ReviewActionOperation)
    : null;
}

function reviewItemId(item: Record<string, unknown>, index: number): string {
  return stringValue(item.item_id) || `review-${index + 1}`;
}

function reviewActionChoices(item: Record<string, unknown>): ReviewActionChoice[] {
  const choices = Array.isArray(item.action_choices) ? item.action_choices : [];
  return choices
    .filter(isRecord)
    .map((choice): ReviewActionChoice | null => {
      const action = reviewActionOperation(choice.action);
      if (!action) return null;
      return {
        action,
        label: stringValue(choice.label) || action,
        description: stringValue(choice.description),
        source_id: stringValue(choice.source_id) || stringValue(item.source_id) || null,
        target_id: stringValue(choice.target_id) || stringValue(item.target_id) || null,
        relation: stringValue(choice.relation) || stringValue(item.relation) || null,
        preview_required: choice.preview_required !== false,
        evidence: stringList(choice.evidence).length > 0 ? stringList(choice.evidence) : stringList(item.evidence),
      };
    })
    .filter((choice): choice is ReviewActionChoice => choice !== null);
}

function reviewEntities(item: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(item.entities) ? item.entities.filter(isRecord) : [];
}

function buildReviewRequest(
  item: Record<string, unknown>,
  choice: ReviewActionChoice,
  index: number,
): EntityMutationRequest | null {
  const itemId = reviewItemId(item, index);
  const sourceId = choice.source_id || stringValue(item.source_id);
  if (!choice.action || !itemId || !sourceId) return null;
  const request: EntityMutationRequest = {
    operation: choice.action,
    reviewItemId: itemId,
    sourceId,
  };
  if (choice.target_id) request.targetId = choice.target_id;
  if (choice.relation) request.relation = choice.relation;
  return request;
}

function reviewCardTone(item: Record<string, unknown>): 'candidate' | 'confirmed' {
  const category = stringValue(item.category);
  const status = stringValue(item.status);
  return category.includes('candidate') || status === 'candidate' ? 'candidate' : 'confirmed';
}

function ReviewSection({
  t,
  data,
  loading,
  error,
  previewMutation,
  confirmMutation,
  reviewActionsBlocked,
  reviewMinCliVersion,
}: {
  t: (key: string) => string;
  data: EntityReviewResponse | undefined;
  loading: boolean;
  error: boolean;
  previewMutation: {
    mutateAsync: (request: EntityMutationRequest) => Promise<EntityMutationPreviewResponse>;
    isPending: boolean;
  };
  confirmMutation: {
    mutateAsync: (request: EntityMutationRequest) => Promise<EntityMutationConfirmResponse>;
    isPending: boolean;
  };
  reviewActionsBlocked: boolean;
  reviewMinCliVersion: string;
}) {
  const queue: Array<Record<string, unknown>> = data?.queue ?? [];
  const total = data?.total ?? 0;
  const isEmpty = queue.length === 0;
  const [activeReview, setActiveReview] = useState<ActiveReviewState | null>(null);

  async function handlePreview(item: Record<string, unknown>, choice: ReviewActionChoice, index: number) {
    const itemId = reviewItemId(item, index);
    const request = buildReviewRequest(item, choice, index);
    if (!request) {
      setActiveReview({
        itemId,
        request: { operation: choice.action, reviewItemId: itemId },
        preview: null,
        accepted: false,
        result: null,
        error: t('entityReviewContractMissing'),
      });
      return;
    }
    setActiveReview({ itemId, request, preview: null, accepted: false, result: null, error: null });
    try {
      const preview = await previewMutation.mutateAsync(request);
      setActiveReview({ itemId, request, preview, accepted: false, result: null, error: null });
    } catch (err) {
      setActiveReview({
        itemId,
        request,
        preview: null,
        accepted: false,
        result: null,
        error: err instanceof Error ? err.message : t('entityMutationError'),
      });
    }
  }

  async function handleApply() {
    if (!activeReview?.preview || !activeReview.accepted) return;
    try {
      const result = await confirmMutation.mutateAsync(activeReview.request);
      setActiveReview({ ...activeReview, result, error: null });
    } catch (err) {
      setActiveReview({
        ...activeReview,
        result: null,
        error: err instanceof Error ? err.message : t('entityMutationError'),
      });
    }
  }

  return (
    <div data-testid="entity-review-section">
      <div className="flex items-center gap-2 mb-4">
        <span
          className="material-symbols-outlined text-lg"
          style={{ color: isEmpty ? 'var(--color-gold)' : 'var(--color-cyan)' }}
        >
          {isEmpty ? 'checklist' : 'queue'}
        </span>
        <h2 className="text-base font-semibold text-[var(--color-primary)]">
          {t('entityReviewQueue')}
        </h2>
        {total > 0 && (
          <span className="ml-auto text-sm text-[var(--color-muted)]">
            {total}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <CelestialLoader size="sm" />
          <span>{t('entityLoading')}</span>
        </div>
      ) : error ? (
        <div className="text-sm text-[var(--color-muted)]">
          {t('entityErrorHint')}
        </div>
      ) : isEmpty ? (
        <div
          className="text-sm text-[var(--color-secondary)] py-3"
          data-testid="entity-review-empty"
        >
          {t('entityReviewEmpty')}
        </div>
      ) : (
        <ul className="space-y-3">
          {queue.map((item, i) => {
            const itemId = reviewItemId(item, i);
            const choices = reviewActionChoices(item);
            const entities = reviewEntities(item);
            const tone = reviewCardTone(item);
            const evidence = stringList(item.evidence);
            const active = activeReview?.itemId === itemId ? activeReview : null;
            return (
            <li
              key={itemId}
              className="text-sm text-[var(--color-secondary)] bg-[var(--color-ether-surface-ghost)] rounded-lg p-4"
              data-testid={`entity-review-item-${i}`}
            >
              <div data-testid={`entity-review-card-${itemId}`}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-[var(--color-muted)]">
                    {itemId}
                  </span>
                  <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-xs text-[var(--color-gold)]">
                    {String(item.risk_level ?? 'review')}
                  </span>
                  <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-xs text-[var(--color-secondary)]">
                    {tone === 'candidate' ? 'candidate' : 'confirmed'}
                  </span>
                  {item.category && (
                    <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-xs text-[var(--color-muted)]">
                      {String(item.category)}
                    </span>
                  )}
                </div>

                <p className="mb-3 leading-6 text-[var(--color-primary)]">
                  {String(item.why || item.description || item.suggested_action || '')}
                </p>

                {entities.length > 0 && (
                  <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {entities.map((entity) => (
                      <div
                        key={String(entity.entity_id ?? entity.id)}
                        className="rounded-lg border border-white/[0.08] px-3 py-2"
                      >
                        <div className="text-[var(--color-primary)]">
                          {String(entity.primary_name ?? entity.name ?? '')}
                        </div>
                        <div className="font-mono text-xs text-[var(--color-muted)]">
                          {String(entity.entity_id ?? entity.id ?? '')}
                        </div>
                        {entity.status && (
                          <div className="mt-1 text-xs text-[var(--color-muted)]">
                            {String(entity.status)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {evidence.length > 0 && (
                  <div className="mb-3">
                    <div className="mb-1 text-xs uppercase tracking-wider text-[var(--color-muted)]">
                      {t('entityReviewEvidence')}
                    </div>
                    <ul className="space-y-1">
                      {evidence.map((path) => (
                        <li key={path} className="font-mono text-xs text-[var(--color-muted)]">
                          {path}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {choices.length === 0 ? (
                  <div
                    className="rounded-lg border border-white/[0.08] px-3 py-2 text-xs text-[var(--color-amber)]"
                    data-testid={`entity-review-contract-missing-${itemId}`}
                  >
                    {t('entityReviewContractMissing')}
                  </div>
                ) : reviewActionsBlocked ? (
                  <div
                    className="rounded-lg border border-white/[0.08] px-3 py-2 text-xs text-[var(--color-amber)]"
                    data-testid="entity-review-version-gate"
                  >
                    {t('entityReviewVersionGate').replace('{version}', reviewMinCliVersion)}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    {choices.map((choice) => (
                      <button
                        key={`${itemId}-${choice.action}`}
                        type="button"
                        disabled={previewMutation.isPending || confirmMutation.isPending}
                        onClick={() => handlePreview(item, choice, i)}
                        className="rounded-lg border border-white/[0.08] px-3 py-2 text-left text-sm text-[var(--color-primary)] bg-[var(--color-ether-surface-ghost)] disabled:opacity-50 disabled:cursor-not-allowed"
                        data-testid={`entity-review-action-${itemId}-${choice.action}`}
                      >
                        <span className="block font-medium">{choice.label ?? choice.action}</span>
                        {choice.description && (
                          <span className="mt-1 block text-xs text-[var(--color-muted)]">
                            {choice.description}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {!reviewActionsBlocked && active?.preview && (
                  <div
                    className="mt-3 rounded-lg border border-white/[0.08] p-3"
                    data-testid={`entity-review-preview-${itemId}`}
                  >
                    <div className="mb-2 text-sm text-[var(--color-primary)]">
                      {active.preview.operation}
                    </div>
                    <pre className="text-xs text-[var(--color-secondary)] whitespace-pre-wrap break-words">
                      {JSON.stringify(active.preview.preview, null, 2)}
                    </pre>
                    <label className="mt-3 flex items-center gap-2 text-sm text-[var(--color-secondary)]">
                      <input
                        type="checkbox"
                        checked={active.accepted}
                        onChange={(event) =>
                          setActiveReview({ ...active, accepted: event.target.checked })
                        }
                        data-testid={`entity-review-preview-accepted-${itemId}`}
                      />
                      {t('entityMutationPreviewAccepted')}
                    </label>
                    <button
                      type="button"
                      disabled={!active.accepted || confirmMutation.isPending}
                      onClick={handleApply}
                      className="mt-3 rounded-lg border border-white/[0.08] px-4 py-2 text-sm text-[var(--color-primary)] bg-[var(--color-ether-surface-ghost)] disabled:opacity-50 disabled:cursor-not-allowed"
                      data-testid={`entity-review-apply-${itemId}`}
                    >
                      {t('entityReviewApply')}
                    </button>
                  </div>
                )}

                {active?.result && (
                  <div
                    className="mt-3 rounded-lg border border-white/[0.08] p-3"
                    data-testid={`entity-review-result-${itemId}`}
                  >
                    <span className={active.result.postCheckOk ? 'text-[var(--color-gold)]' : 'text-[var(--color-amber)]'}>
                      {active.result.operation}
                    </span>
                    <pre className="mt-2 text-xs text-[var(--color-secondary)] whitespace-pre-wrap break-words">
                      {JSON.stringify(active.result.mutation, null, 2)}
                    </pre>
                  </div>
                )}

                {active?.error && (
                  <div className="mt-3 text-sm text-[var(--color-coral)]">
                    {active.error}
                  </div>
                )}
              </div>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CandidateEdgesSection({
  t,
  data,
  loading,
  error,
}: {
  t: (key: string) => string;
  data: CandidateEdgesResponse | undefined;
  loading: boolean;
  error: boolean;
}) {
  const candidates: Array<Record<string, unknown>> = data?.candidates ?? [];
  const total = data?.total ?? 0;
  const isEmpty = candidates.length === 0;

  return (
    <div data-testid="entity-candidate-edges-section">
      <div className="flex items-center gap-2 mb-4">
        <span
          className="material-symbols-outlined text-lg"
          style={{ color: 'var(--color-cyan)' }}
        >
          share
        </span>
        <h2 className="text-base font-semibold text-[var(--color-primary)]">
          {t('entityCandidateEdges')}
        </h2>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <CelestialLoader size="sm" />
          <span>{t('entityLoading')}</span>
        </div>
      ) : error ? (
        <div className="text-sm text-[var(--color-muted)]">
          {t('entityErrorHint')}
        </div>
      ) : isEmpty ? (
        <div
          className="text-sm text-[var(--color-secondary)] py-3"
          data-testid="entity-candidate-edges-empty"
        >
          {t('entityCandidateEdgesEmpty')}
        </div>
      ) : (
        <>
          <div
            className="text-xs text-[var(--color-muted)] mb-3"
            data-testid="entity-candidate-edges-count"
          >
            {t('entityCandidateEdgesCount')
              .replace('{{shown}}', String(candidates.length))
              .replace('{{total}}', String(total))}
          </div>
          <ul className="space-y-2">
            {candidates.map((edge, i) => (
              <li
                key={i}
                className="flex items-center gap-2 text-sm text-[var(--color-secondary)] bg-[var(--color-ether-surface-ghost)] rounded-lg p-3"
                data-testid={`entity-candidate-edge-${i}`}
              >
                <span className="text-[var(--color-primary)]">
                  {String(edge.source ?? '?')}
                </span>
                <span className="text-[var(--color-muted)] text-xs">&rarr;</span>
                <span className="text-[var(--color-primary)]">
                  {String(edge.target ?? '?')}
                </span>
                {edge.relation && (
                  <span className="ml-auto text-xs text-[var(--color-muted)]">
                    {String(edge.relation)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function MutationSection({
  t,
  entities,
  previewMutation,
  confirmMutation,
  featureCallsEnabled,
}: {
  t: (key: string) => string;
  entities: EntityItem[];
  previewMutation: {
    mutateAsync: (request: EntityMutationRequest) => Promise<EntityMutationPreviewResponse>;
    isPending: boolean;
  };
  confirmMutation: {
    mutateAsync: (request: EntityMutationRequest) => Promise<EntityMutationConfirmResponse>;
    isPending: boolean;
  };
  featureCallsEnabled: boolean;
}) {
  const [deleteEntityId, setDeleteEntityId] = useState('');
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [pendingRequest, setPendingRequest] = useState<EntityMutationRequest | null>(null);
  const [preview, setPreview] = useState<EntityMutationPreviewResponse | null>(null);
  const [previewAccepted, setPreviewAccepted] = useState(false);
  const [confirmation, setConfirmation] = useState<EntityMutationConfirmResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstEntityId = entities[0]?.id ?? '';
  const selectedDeleteId = deleteEntityId || firstEntityId;
  const selectedSourceId = mergeSourceId || firstEntityId;
  const fallbackTargetId =
    entities.find((entity) => entity.id !== selectedSourceId)?.id ?? '';
  const selectedTargetId =
    mergeTargetId && mergeTargetId !== selectedSourceId ? mergeTargetId : fallbackTargetId;
  const canPreviewDelete = selectedDeleteId.length > 0;
  const canPreviewMerge =
    selectedSourceId.length > 0 &&
    selectedTargetId.length > 0 &&
    selectedSourceId !== selectedTargetId;
  const canConfirm =
    Boolean(pendingRequest && preview && previewAccepted) && !confirmMutation.isPending;

  async function handlePreview(request: EntityMutationRequest) {
    setError(null);
    setConfirmation(null);
    setPreviewAccepted(false);
    try {
      const result = await previewMutation.mutateAsync(request);
      setPendingRequest(request);
      setPreview(result);
    } catch (err) {
      setPendingRequest(null);
      setPreview(null);
      setError(err instanceof Error ? err.message : t('entityMutationError'));
    }
  }

  async function handleConfirm() {
    if (!pendingRequest || !previewAccepted) return;
    setError(null);
    try {
      const result = await confirmMutation.mutateAsync(pendingRequest);
      setConfirmation(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('entityMutationError'));
    }
  }

  return (
    <div data-testid="entity-mutation-section">
      <div className="flex items-center gap-2 mb-4">
        <span
          className="material-symbols-outlined text-lg"
          style={{ color: 'var(--color-amber)' }}
        >
          lock
        </span>
        <h2 className="text-base font-semibold text-[var(--color-primary)]">
          {t('entityMutations')}
        </h2>
      </div>
      <p className="text-sm text-[var(--color-secondary)] mb-4">
        {t('entityMutationsSubtitle')}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="bg-[var(--color-ether-surface-ghost)] rounded-lg p-3">
          <label className="block text-xs text-[var(--color-muted)] uppercase tracking-wider mb-2">
            {t('entityMutationDelete')}
          </label>
          <select
            value={selectedDeleteId}
            onChange={(event) => setDeleteEntityId(event.target.value)}
            data-testid="entity-delete-select"
            className="w-full mb-3 rounded-lg bg-[var(--color-ether-surface-ghost)] border border-white/[0.08] px-3 py-2 text-sm text-[var(--color-primary)]"
          >
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {formatEntityOption(entity)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!featureCallsEnabled || !canPreviewDelete || previewMutation.isPending}
            onClick={() => handlePreview({ operation: 'delete', entityId: selectedDeleteId })}
            data-testid="entity-delete-preview"
            className="px-4 py-2 rounded-lg text-sm border border-white/[0.08] text-[var(--color-primary)] bg-[var(--color-ether-surface-ghost)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('entityMutationPreview')}
          </button>
        </div>

        <div className="bg-[var(--color-ether-surface-ghost)] rounded-lg p-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <label className="block text-xs text-[var(--color-muted)] uppercase tracking-wider">
              {t('entityMutationSourceEntity')}
              <select
                value={selectedSourceId}
                onChange={(event) => setMergeSourceId(event.target.value)}
                data-testid="entity-merge-source"
                className="w-full mt-2 rounded-lg bg-[var(--color-ether-surface-ghost)] border border-white/[0.08] px-3 py-2 text-sm text-[var(--color-primary)]"
              >
                {entities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {formatEntityOption(entity)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-[var(--color-muted)] uppercase tracking-wider">
              {t('entityMutationTargetEntity')}
              <select
                value={selectedTargetId}
                onChange={(event) => setMergeTargetId(event.target.value)}
                data-testid="entity-merge-target"
                className="w-full mt-2 rounded-lg bg-[var(--color-ether-surface-ghost)] border border-white/[0.08] px-3 py-2 text-sm text-[var(--color-primary)]"
              >
                {entities
                  .filter((entity) => entity.id !== selectedSourceId)
                  .map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {formatEntityOption(entity)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled={!featureCallsEnabled || !canPreviewMerge || previewMutation.isPending}
            onClick={() =>
              handlePreview({
                operation: 'merge_as_alias',
                sourceId: selectedSourceId,
                targetId: selectedTargetId,
              })
            }
            data-testid="entity-merge-preview"
            className="px-4 py-2 rounded-lg text-sm border border-white/[0.08] text-[var(--color-primary)] bg-[var(--color-ether-surface-ghost)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('entityMutationPreview')}
          </button>
        </div>
      </div>

      <div
        className="text-sm text-[var(--color-muted)] bg-[var(--color-ether-surface-ghost)] rounded-lg p-3 mb-4"
        data-testid="entity-update-add-alias-blocked"
      >
        <div className="mb-1">
          <span className="text-[var(--color-amber)]">{t('entityMutationUpdateBlocked')}</span>
          <span className="ml-2">{t('entityMutationUpdateBlockedDesc')}</span>
        </div>
        <div>
          <span className="text-[var(--color-amber)]">{t('entityMutationAddAliasBlocked')}</span>
          <span className="ml-2">{t('entityMutationAddAliasBlockedDesc')}</span>
        </div>
      </div>

      {preview && (
        <div
          className="border border-white/[0.08] rounded-lg p-3 mb-4"
          data-testid="entity-mutation-preview"
        >
          <div className="text-sm text-[var(--color-primary)] mb-2">
            {preview.operation}
          </div>
          <pre className="text-xs text-[var(--color-secondary)] whitespace-pre-wrap break-words">
            {JSON.stringify(preview.preview, null, 2)}
          </pre>
          <label className="flex items-center gap-2 mt-3 text-sm text-[var(--color-secondary)]">
            <input
              type="checkbox"
              checked={previewAccepted}
              onChange={(event) => setPreviewAccepted(event.target.checked)}
              data-testid="entity-preview-accepted"
            />
            {t('entityMutationPreviewAccepted')}
          </label>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={handleConfirm}
            data-testid="entity-mutation-confirm"
            className="mt-3 px-4 py-2 rounded-lg text-sm border border-white/[0.08] text-[var(--color-primary)] bg-[var(--color-ether-surface-ghost)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('entityMutationConfirm')}
          </button>
        </div>
      )}

      {confirmation && (
        <div
          className="text-sm bg-[var(--color-ether-surface-ghost)] rounded-lg p-3"
          data-testid="entity-post-check"
        >
          <span className={confirmation.postCheckOk ? 'text-[var(--color-gold)]' : 'text-[var(--color-amber)]'}>
            {t('entityMutationPostCheck')}: {confirmation.postCheckOk ? t('entityMutationPostCheckOk') : t('entityMutationPostCheckFailed')}
          </span>
          <pre className="mt-2 text-xs text-[var(--color-secondary)] whitespace-pre-wrap break-words">
            {JSON.stringify(confirmation.postCheck, null, 2)}
          </pre>
        </div>
      )}

      {error && (
        <div className="text-sm text-[var(--color-coral)]" data-testid="entity-mutation-error">
          {error}
        </div>
      )}
    </div>
  );
}

function formatEntityOption(entity: EntityItem): string {
  return `${entity.primary_name} (${entity.id})`;
}
