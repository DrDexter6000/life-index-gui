import { useEffect, useMemo, useRef, useState } from 'react';
import { GlassCard } from '@/components/celestial/GlassCard';
import { SimpleEditor } from '@/components/editor/SimpleEditor';
import { MetadataSidebar } from '@/components/editor/MetadataSidebar';
import { PhotoAttachmentGrid } from '@/components/import/PhotoAttachmentGrid';
import { useTranslation } from '@/hooks/useTranslation';
import { useVersionCheck } from '@/hooks/useJournals';
import {
  useBatchRun,
  useChildRollback,
  useConfirmEdit,
  useRebindReview,
  useReviewQueue,
  useReviewsList,
  useReviewStatus,
  useStageReview,
  useValidateSource,
} from '@/hooks/useImports';
import {
  APIClientError,
  type ImportReviewProposal,
  type ImportReviewState,
} from '@/lib/api-client';
import type { JournalMetadata } from '@/stores/journal-draft';

type ReviewAdvisory = NonNullable<ImportReviewProposal['warnings']>[number];

const REVIEW_STATES: readonly ImportReviewState[] = [
  'pending',
  'confirmed',
  'skipped',
  'stale',
  'batching',
  'imported',
];

const EMPTY_METADATA: JournalMetadata = {
  title: '',
  date: '',
  topics: [],
  moods: [],
  people: [],
  location: '',
  weather: '',
  project: '',
  abstract: '',
  tags: [],
  links: [],
};

function proposalMetadata(proposal?: ImportReviewProposal): JournalMetadata {
  const journal = proposal?.journal;
  return {
    ...EMPTY_METADATA,
    title: journal?.title ?? '',
    date: journal?.date ?? '',
    topics: journal?.topic ? [journal.topic] : [],
    tags: journal?.tags ?? [],
  };
}

function errorReason(error: unknown): string | null {
  if (!(error instanceof APIClientError)) return null;
  return typeof error.details?.reason === 'string' ? error.details.reason : null;
}

function existingImportId(error: unknown): string | null {
  if (
    !(error instanceof APIClientError)
    || error.code !== 'IMPORT_REVIEW_ALREADY_STAGED'
  ) {
    return null;
  }
  return typeof error.details?.existing_import_id === 'string'
    ? error.details.existing_import_id
    : null;
}

function isAuthorityBlockingError(error: unknown): boolean {
  if (!(error instanceof APIClientError)) return false;
  const reason = errorReason(error);
  return error.code === 'IMPORT_REVIEW_RECOVERY_REQUIRED'
    || error.code === 'IMPORT_RECOVERY_REQUIRED'
    || error.code === 'IMPORT_BATCH_ALREADY_ACTIVE'
    || reason === 'recovery_required'
    || reason === 'batch_active'
    || error.details?.recovery_required === true
    || typeof error.details?.active_child_id === 'string';
}

function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function safeAdvisoryParts(advisory: ReviewAdvisory): string[] {
  return [advisory.code, advisory.format, advisory.severity]
    .filter((part): part is string => typeof part === 'string' && part.length > 0);
}

function isHeicPreviewUnavailable(advisory: ReviewAdvisory): boolean {
  const format = advisory.format?.toUpperCase();
  const code = advisory.code?.toUpperCase();
  return advisory.preview_available === false
    && (
      format === 'HEIC'
      || format === 'HEIF'
      || code?.includes('HEIC') === true
      || code?.includes('HEIF') === true
    );
}

const PHOTO_IMPORT_MIN_CLI_VERSION = '1.6.2';

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
 * Historical-photo import is an import-only CLI surface with a higher floor
 * than the global GUI handshake. A CLI that is globally compatible (>=1.4.5)
 * but older than this floor still cannot start, resume, or operate an import,
 * so the workbench stays unmounted (no import hooks run) and the user sees an
 * honest upgrade prompt instead of surfacing the CLI's late
 * CLI_FEATURE_UNAVAILABLE as a misleading directory-unreadable failure.
 *
 * Other GUI routes keep using the unchanged global floor; this gate is local
 * to /import and adds no shared version framework.
 */
export default function ImportWorkflow() {
  const { t } = useTranslation();
  const versionQuery = useVersionCheck();

  if (versionQuery.isError) {
    return <PhotoImportGate t={t} />;
  }
  const versionData = versionQuery.data;
  if (!versionData) {
    return <PhotoImportLoading t={t} />;
  }
  const photoImportBlocked = versionData.compatible !== true
    || isVersionBelow(versionData.cli_package_version, PHOTO_IMPORT_MIN_CLI_VERSION);
  if (photoImportBlocked) {
    return <PhotoImportGate t={t} />;
  }
  return <ImportWorkbench />;
}

function PhotoImportLoading({ t }: { t: (key: string) => string }) {
  return (
    <main
      data-testid="import-cli-version-loading"
      className="mx-auto max-w-[640px] px-4 py-12 sm:px-6"
    >
      <p role="status" className="text-sm text-[var(--color-secondary)]">
        {t('importCliVersionLoading')}
      </p>
    </main>
  );
}

function PhotoImportGate({ t }: { t: (key: string) => string }) {
  return (
    <main
      data-testid="import-cli-version-gate"
      className="mx-auto max-w-[640px] space-y-4 px-4 py-12 sm:px-6"
    >
      <h1 className="text-2xl text-[var(--color-primary)]">
        {t('importCliVersionGateTitle')}
      </h1>
      <p className="text-sm leading-6 text-[var(--color-secondary)]">
        {t('importCliVersionGateBody')}
      </p>
      <p className="text-sm leading-6 text-[var(--color-secondary)]">
        {t('importCliVersionGateOthersAvailable')}
      </p>
    </main>
  );
}

/**
 * Historical-photo review is a coordinator over the frozen CLI review job.
 * The source path and editable form are intentionally component-memory only;
 * every durable queue, revision, count, batch, and recovery fact comes back
 * from the existing import hooks.
 */
function ImportWorkbench() {
  const { t } = useTranslation();
  const [sourcePath, setSourcePath] = useState('');
  const [activeParentId, setActiveParentId] = useState<string>();
  const [sourceBindingAvailable, setSourceBindingAvailable] = useState(false);
  const [filter, setFilter] = useState<ImportReviewState>('pending');
  const [offset, setOffset] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [revisionConflict, setRevisionConflict] = useState(false);
  const [metadata, setMetadata] = useState<JournalMetadata>(EMPTY_METADATA);
  const [content, setContent] = useState('');
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
  const [candidateHydrationEpoch, setCandidateHydrationEpoch] = useState(0);
  const [reviewCursorHistory, setReviewCursorHistory] = useState<string[]>([]);
  const [coordinatorPending, setCoordinatorPending] = useState(false);
  const viewIdentityRef = useRef({
    generation: 0,
    parentId: undefined as string | undefined,
    filter: 'pending' as ImportReviewState,
    offset: 0,
  });
  const mountedRef = useRef(false);
  const coordinatorPendingRef = useRef(false);

  const queuePage = useMemo(
    () => ({ offset, limit: 1, states: [filter] }),
    [filter, offset],
  );
  const reviewListParams = useMemo(() => {
    const after = reviewCursorHistory[reviewCursorHistory.length - 1];
    return after ? { limit: 20, after } : { limit: 20 };
  }, [reviewCursorHistory]);
  const reviews = useReviewsList(reviewListParams);
  const queue = useReviewQueue(activeParentId, queuePage);
  const status = useReviewStatus(activeParentId);
  const validateSource = useValidateSource();
  const stageReview = useStageReview();
  const rebindReview = useRebindReview();
  const confirmEdit = useConfirmEdit();
  const batchRun = useBatchRun();
  const childRollback = useChildRollback();
  const hookMutationPending =
    validateSource.isPending
    || stageReview.isPending
    || rebindReview.isPending
    || confirmEdit.isPending
    || batchRun.isPending
    || childRollback.isPending;
  const mutationPending = coordinatorPending || hookMutationPending;
  const authorityBlocked =
    status.data?.recovery_required === true
    || typeof status.data?.active_child_id === 'string';

  const candidate = queue.data?.proposals?.[0] ?? queue.data?.proposal;
  const candidateIdentity = activeParentId && candidate
    ? `${activeParentId}:${candidate.proposal_id}:${candidateHydrationEpoch}`
    : null;
  const [initializedCandidateIdentity, setInitializedCandidateIdentity] =
    useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      coordinatorPendingRef.current = false;
      viewIdentityRef.current = {
        ...viewIdentityRef.current,
        generation: viewIdentityRef.current.generation + 1,
      };
    };
  }, []);

  useEffect(() => {
    if (initializedCandidateIdentity === candidateIdentity) return;
    setMetadata(proposalMetadata(candidate));
    setContent(candidate?.journal?.content ?? '');
    setSelectedAttachmentIds(
      candidate?.available_attachments
        ?.filter((attachment) => attachment.selected)
        .map((attachment) => attachment.attachment_id)
        ?? [],
    );
    setRevisionConflict(false);
    setInitializedCandidateIdentity(candidateIdentity);
  }, [candidate, candidateIdentity, initializedCandidateIdentity]);

  const advanceViewIdentity = (
    patch: Partial<Omit<typeof viewIdentityRef.current, 'generation'>>,
  ): number => {
    const next = {
      ...viewIdentityRef.current,
      ...patch,
      generation: viewIdentityRef.current.generation + 1,
    };
    viewIdentityRef.current = next;
    return next.generation;
  };

  const beginCoordinatorOperation = (): number | null => {
    if (!mountedRef.current || coordinatorPendingRef.current || hookMutationPending) return null;
    coordinatorPendingRef.current = true;
    setCoordinatorPending(true);
    return viewIdentityRef.current.generation;
  };

  const finishCoordinatorOperation = () => {
    if (!mountedRef.current) return;
    coordinatorPendingRef.current = false;
    setCoordinatorPending(false);
  };

  const isCurrentOperation = (generation: number, parentId?: string): boolean =>
    mountedRef.current
    && viewIdentityRef.current.generation === generation
    && (parentId === undefined || viewIdentityRef.current.parentId === parentId);

  const activateParent = (parentId: string, bindingAvailable: boolean): number => {
    const generation = (
      viewIdentityRef.current.parentId === parentId
      && viewIdentityRef.current.offset === 0
    )
      ? viewIdentityRef.current.generation
      : advanceViewIdentity({ parentId, offset: 0 });
    setActiveParentId(parentId);
    setSourceBindingAvailable(bindingAvailable);
    setOffset(0);
    setNotice(null);
    setRevisionConflict(false);
    return generation;
  };

  const validateReadableSource = async (generation: number): Promise<string | null> => {
    const sourceRoot = sourcePath.trim();
    if (!sourceRoot) {
      if (isCurrentOperation(generation)) {
        setNotice(t('importSourceRequired'));
      }
      return null;
    }
    try {
      const validation = await validateSource.mutateAsync({ source_root: sourceRoot });
      if (!isCurrentOperation(generation)) return null;
      if (validation.readable !== true) {
        setNotice(t('importSourceUnreadable'));
        return null;
      }
      return sourceRoot;
    } catch {
      if (isCurrentOperation(generation)) {
        setNotice(t('importSourceUnreadable'));
      }
      return null;
    }
  };

  const bindSource = async (
    parentId: string,
    sourceRoot: string,
    generation: number,
  ): Promise<boolean> => {
    try {
      await rebindReview.mutateAsync({ parentId, sourceRoot });
      if (!isCurrentOperation(generation, parentId)) return false;
      setCandidateHydrationEpoch((current) => current + 1);
      setSourceBindingAvailable(true);
      setNotice(t('importBindingReady'));
      return true;
    } catch {
      if (!isCurrentOperation(generation, parentId)) return false;
      setSourceBindingAvailable(false);
      setNotice(t('importRebindGuidance'));
      return false;
    }
  };

  const handleStartReview = async () => {
    let generation = beginCoordinatorOperation();
    if (generation === null) return;
    let sourceRoot: string | null = null;
    try {
      setNotice(null);
      sourceRoot = await validateReadableSource(generation);
      if (!sourceRoot) return;

      const staged = await stageReview.mutateAsync({ source_root: sourceRoot });
      if (!isCurrentOperation(generation)) return;
      const parentId = staged.parent_id ?? staged.import_id;
      if (!parentId) {
        setNotice(t('importStageFailed'));
        return;
      }
      generation = activateParent(parentId, true);
    } catch (error) {
      if (!isCurrentOperation(generation)) return;
      const parentId = existingImportId(error);
      if (!parentId) {
        setNotice(t('importStageFailed'));
        return;
      }
      generation = activateParent(parentId, false);
      if (!sourceRoot) return;
      const rebound = await bindSource(parentId, sourceRoot, generation);
      if (rebound && isCurrentOperation(generation, parentId)) {
        setNotice(t('importAlreadyStagedResumed'));
      }
    } finally {
      finishCoordinatorOperation();
    }
  };

  const handleExplicitRebind = async () => {
    if (!activeParentId) return;
    const parentId = activeParentId;
    const generation = beginCoordinatorOperation();
    if (generation === null) return;
    try {
      const sourceRoot = await validateReadableSource(generation);
      if (!sourceRoot) return;
      await bindSource(parentId, sourceRoot, generation);
    } finally {
      finishCoordinatorOperation();
    }
  };

  const handleSelectParent = (parentId: string) => {
    if (viewIdentityRef.current.parentId === parentId) return;
    setSourcePath('');
    activateParent(parentId, false);
  };

  const handleReviewsNext = () => {
    const jobs = reviews.data?.jobs ?? [];
    const lastJob = jobs[jobs.length - 1];
    if (reviews.data?.has_more !== true || !lastJob) return;
    if (reviewCursorHistory[reviewCursorHistory.length - 1] === lastJob.import_id) return;
    advanceViewIdentity({});
    setReviewCursorHistory((current) => [...current, lastJob.import_id]);
  };

  const handleReviewsPrevious = () => {
    if (reviewCursorHistory.length === 0) return;
    advanceViewIdentity({});
    setReviewCursorHistory((current) => current.slice(0, -1));
  };

  const toggleAttachment = (attachmentId: string, selected: boolean) => {
    setSelectedAttachmentIds((current) => (
      selected
        ? current.includes(attachmentId) ? current : [...current, attachmentId]
        : current.filter((id) => id !== attachmentId)
    ));
  };

  const submitDecision = async (
    decision: 'pending' | 'confirmed' | 'skipped',
    includeJournal: boolean,
  ) => {
    const generation = beginCoordinatorOperation();
    if (generation === null) return;
    try {
      if (authorityBlocked) {
        setNotice(t('importAuthorityBlockedGuidance'));
        return;
      }
      if (
        !activeParentId
        || !candidate
        || typeof queue.data?.queue_revision !== 'number'
      ) {
        setNotice(t('importMissingRevision'));
        return;
      }

      const parentId = activeParentId;
      setNotice(null);
      setRevisionConflict(false);
      const variables = {
        parentId,
        expectedQueueRevision: queue.data.queue_revision,
        proposalId: candidate.proposal_id,
        decision,
        ...(includeJournal ? {
          journal: {
            title: metadata.title,
            date: metadata.date,
            topic: metadata.topics[0] ?? '',
            tags: metadata.tags ?? [],
            content,
          },
        } : {}),
        selectedAttachmentIds,
        queuePage,
      };

      const result = await confirmEdit.mutateAsync(variables);
      if (!isCurrentOperation(generation, parentId)) return;
      if (result.reason_code === 'IMPORT_REVIEW_DATE_REQUIRED') {
        setNotice(t('importDateRequired'));
      } else if (result.reason_code === 'IMPORT_REVIEW_EMPTY_SELECTION_SKIPPED') {
        setNotice(t('importNoPhotosSkipped'));
      } else {
        setNotice(
          decision === 'skipped' && selectedAttachmentIds.length === 0
            ? t('importNoPhotosSkipped')
            : t('importDecisionQueued'),
        );
      }
    } catch (error) {
      if (!isCurrentOperation(generation)) return;
      if (
        error instanceof APIClientError
        && error.code === 'IMPORT_REVIEW_REVISION_CONFLICT'
      ) {
        setRevisionConflict(true);
        setNotice(t('importRevisionConflict'));
        return;
      }
      if (errorReason(error) === 'rebind_required') {
        setSourceBindingAvailable(false);
        setNotice(t('importRebindGuidance'));
        return;
      }
      if (isAuthorityBlockingError(error)) {
        setNotice(t('importAuthorityBlockedGuidance'));
        return;
      }
      setNotice(t('importDecisionFailed'));
    } finally {
      finishCoordinatorOperation();
    }
  };

  const handleConfirm = async () => {
    if (selectedAttachmentIds.length === 0) {
      await submitDecision('skipped', false);
      return;
    }
    await submitDecision('confirmed', true);
  };

  const handleBatchRun = async () => {
    const generation = beginCoordinatorOperation();
    if (generation === null) return;
    try {
      if (authorityBlocked) {
        setNotice(t('importAuthorityBlockedGuidance'));
        return;
      }
      if (!activeParentId || !sourceBindingAvailable) {
        setNotice(t('importRebindGuidance'));
        return;
      }
      const parentId = activeParentId;
      await batchRun.mutateAsync(parentId);
      if (!isCurrentOperation(generation, parentId)) return;
      setNotice(t('importBatchStarted'));
    } catch (error) {
      if (!isCurrentOperation(generation)) return;
      if (errorReason(error) === 'rebind_required') {
        setSourceBindingAvailable(false);
        setNotice(t('importRebindGuidance'));
        return;
      }
      if (isAuthorityBlockingError(error)) {
        setNotice(t('importAuthorityBlockedGuidance'));
        return;
      }
      setNotice(t('importBatchFailed'));
    } finally {
      finishCoordinatorOperation();
    }
  };

  const handleRollback = async (childId: string) => {
    const generation = beginCoordinatorOperation();
    if (generation === null) return;
    const parentId = activeParentId;
    try {
      await childRollback.mutateAsync(childId);
      if (!isCurrentOperation(generation, parentId)) return;
      setNotice(t('importRollbackRequested'));
    } catch {
      if (!isCurrentOperation(generation, parentId)) return;
      setNotice(t('importRollbackFailed'));
    } finally {
      finishCoordinatorOperation();
    }
  };

  const candidateFrozen = candidate?.state === 'batching' || candidate?.state === 'imported';
  const candidateFormReady = initializedCandidateIdentity === candidateIdentity;
  const hasQueueRevision = typeof queue.data?.queue_revision === 'number';
  const dateConfirmationBlocked =
    candidate?.date_resolution?.status === 'unresolved'
    && !isValidCalendarDate(metadata.date);
  const confirmedCount =
    queue.data?.queue_counts?.confirmed
    ?? status.data?.queue_counts?.confirmed
    ?? 0;
  const advisories = [
    ...(queue.data?.warnings ?? []),
    ...(candidate?.conflicts ?? []),
    ...(candidate?.warnings ?? []),
  ];
  const currentServerOffset = queue.data?.offset ?? offset;

  return (
    <main
      data-testid="import-review-workbench"
      className="mx-auto max-w-[1280px] space-y-6 px-4 py-8 sm:px-6"
    >
      <header>
        <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]">
          {t('importTitle')} · {t('importTitleSecondary')}
        </p>
        <h1 className="mt-2 text-3xl text-[var(--color-primary)]">
          {t('importWorkbenchTitle')}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-secondary)]">
          {t('importWorkbenchDescription')}
        </p>
      </header>

      <GlassCard className="space-y-4 p-5" hoverable={false} glowEffect={false}>
        <label
          htmlFor="import-source-path"
          className="block text-sm text-[var(--color-primary)]"
        >
          {t('importSourcePathLabel')}
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="import-source-path"
            data-testid="import-source-path"
            type="text"
            value={sourcePath}
            onChange={(event) => setSourcePath(event.target.value)}
            placeholder={t('importSourcePathPlaceholder')}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[var(--color-ether-surface-ghost)] px-4 py-3 text-[var(--color-primary)]"
          />
          <button
            type="button"
            data-testid="import-start-review"
            disabled={mutationPending}
            onClick={() => void handleStartReview()}
            className="rounded-xl bg-[var(--color-gold)] px-5 py-3 text-sm text-black disabled:opacity-40"
          >
            {stageReview.isPending ? t('importStarting') : t('importStartReview')}
          </button>
          {activeParentId && (
            <button
              type="button"
              data-testid="import-rebind"
              disabled={mutationPending}
              onClick={() => void handleExplicitRebind()}
              className="rounded-xl border border-[var(--color-gold-20)] px-5 py-3 text-sm"
            >
              {rebindReview.isPending ? t('importRebinding') : t('importRebind')}
            </button>
          )}
        </div>
        <p className="text-sm leading-6 text-[var(--color-secondary)]">
          {t('importSourceReadOnly')}
        </p>
        {activeParentId && !sourceBindingAvailable && (
          <p
            data-testid="import-binding-required"
            role="status"
            className="rounded-lg border border-[var(--color-amber)]/30 p-3 text-sm text-[var(--color-amber)]"
          >
            {t('importBindingRequired')} · {t('importRebindGuidance')}
          </p>
        )}
        {notice && (
          <p data-testid="import-notice" role="status" className="text-sm text-[var(--color-secondary)]">
            {notice}
          </p>
        )}
        {revisionConflict && (
          <p
            data-testid="import-revision-conflict"
            role="alert"
            className="text-sm text-[var(--color-amber)]"
          >
            {t('importRevisionConflict')}
          </p>
        )}
      </GlassCard>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <GlassCard className="space-y-4 p-5" hoverable={false} glowEffect={false}>
          <h2 className="text-lg text-[var(--color-primary)]">{t('importReviewsTitle')}</h2>
          {reviews.isLoading ? (
            <p role="status">{t('importReviewsLoading')}</p>
          ) : reviews.isError ? (
            <p role="alert">{t('importReviewsError')}</p>
          ) : (reviews.data?.jobs.length ?? 0) === 0 ? (
            <p>{t('importReviewsEmpty')}</p>
          ) : (
            <ul className="space-y-2">
              {reviews.data?.jobs.map((job) => (
                <li key={job.import_id}>
                  <button
                    type="button"
                    data-testid={`review-job-${job.import_id}`}
                    aria-pressed={activeParentId === job.import_id}
                    onClick={() => handleSelectParent(job.import_id)}
                    className="w-full rounded-xl border border-white/10 p-3 text-left"
                  >
                    <span className="block break-all text-sm text-[var(--color-primary)]">
                      {job.import_id}
                    </span>
                    <span className="text-xs text-[var(--color-muted)]">
                      {job.state ?? t('importStateUnknown')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!reviews.isLoading
            && !reviews.isError
            && (reviews.data?.jobs.length ?? 0) > 0
            && (
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  data-testid="import-reviews-previous"
                  disabled={reviewCursorHistory.length === 0}
                  onClick={handleReviewsPrevious}
                >
                  {t('importReviewsPrevious')}
                </button>
                <span className="text-xs text-[var(--color-muted)]">
                  {t('importReviewsPage', { page: reviewCursorHistory.length + 1 })}
                </span>
                <button
                  type="button"
                  data-testid="import-reviews-next"
                  disabled={reviews.data?.has_more !== true}
                  onClick={handleReviewsNext}
                >
                  {t('importReviewsNext')}
                </button>
              </div>
            )}
        </GlassCard>

        <div className="min-w-0 space-y-6">
          {activeParentId ? (
            <>
              <GlassCard className="space-y-4 p-5" hoverable={false} glowEffect={false}>
                <div className="flex flex-wrap gap-2" aria-label={t('importQueueFilters')}>
                  {REVIEW_STATES.map((state) => (
                    <button
                      type="button"
                      key={state}
                      data-testid={`import-filter-${state}`}
                      aria-pressed={filter === state}
                      onClick={() => {
                        if (
                          viewIdentityRef.current.filter === state
                          && viewIdentityRef.current.offset === 0
                        ) {
                          return;
                        }
                        advanceViewIdentity({ filter: state, offset: 0 });
                        setFilter(state);
                        setOffset(0);
                      }}
                      className="rounded-full border border-white/10 px-3 py-1.5 text-sm"
                    >
                      {t(`importFilter${state[0].toUpperCase()}${state.slice(1)}`)}
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    data-testid="import-candidate-previous"
                    disabled={currentServerOffset <= 0}
                    onClick={() => {
                      const nextOffset = Math.max(0, currentServerOffset - 1);
                      if (viewIdentityRef.current.offset === nextOffset) return;
                      advanceViewIdentity({ offset: nextOffset });
                      setOffset(nextOffset);
                    }}
                  >
                    {t('importCandidatePrevious')}
                  </button>
                  <span className="text-sm text-[var(--color-muted)]">
                    {t('importCandidatePosition', {
                      current: (queue.data?.offset ?? offset) + 1,
                      total: queue.data?.total_filtered ?? 0,
                    })}
                  </span>
                  <button
                    type="button"
                    data-testid="import-candidate-next"
                    disabled={typeof queue.data?.next_offset !== 'number'}
                    onClick={() => {
                      if (typeof queue.data?.next_offset === 'number') {
                        if (viewIdentityRef.current.offset === queue.data.next_offset) return;
                        advanceViewIdentity({ offset: queue.data.next_offset });
                        setOffset(queue.data.next_offset);
                      }
                    }}
                  >
                    {t('importCandidateNext')}
                  </button>
                </div>
              </GlassCard>

              {queue.isLoading ? (
                <GlassCard className="p-5" hoverable={false} glowEffect={false}>
                  <p role="status">{t('importQueueLoading')}</p>
                </GlassCard>
              ) : queue.isError ? (
                <GlassCard className="p-5" hoverable={false} glowEffect={false}>
                  <p role="alert">{t('importQueueError')}</p>
                </GlassCard>
              ) : !candidate ? (
                <GlassCard className="p-5" hoverable={false} glowEffect={false}>
                  <p>{t('importQueueEmpty')}</p>
                </GlassCard>
              ) : !candidateFormReady ? (
                <GlassCard className="p-5" hoverable={false} glowEffect={false}>
                  <p role="status">{t('importQueueLoading')}</p>
                </GlassCard>
              ) : (
                <GlassCard className="space-y-5 p-5" hoverable={false} glowEffect={false}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg text-[var(--color-primary)]">
                      {candidate.proposal_id}
                    </h2>
                    <span className="rounded-full border border-white/10 px-2 py-1 text-xs">
                      {candidate.state}
                    </span>
                  </div>

                  {candidate.date_resolution?.status === 'unresolved' && (
                    <p data-testid="import-unresolved-date" role="alert">
                      {t('importUnresolvedDate')}
                    </p>
                  )}
                  {candidate.state === 'stale' && (
                    <p data-testid="import-stale-candidate" role="alert">
                      {t('importStaleCandidate')}
                    </p>
                  )}
                  {!hasQueueRevision && (
                    <p data-testid="import-missing-revision" role="alert">
                      {t('importMissingRevision')}
                    </p>
                  )}

                  {advisories.length > 0 && (
                    <section aria-label={t('importAdvisories')}>
                      <ul className="space-y-2">
                        {advisories.map((advisory, index) => (
                          <li key={`${safeAdvisoryParts(advisory).join('-')}-${index}`}>
                            <span>{safeAdvisoryParts(advisory).join(' · ')}</span>
                            {isHeicPreviewUnavailable(advisory) && (
                              <p data-testid="import-heic-limitation">
                                {t('importHeicLimitation')}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {candidateFrozen ? (
                    <section data-testid="import-candidate-readonly">
                      <p>{t('importCandidateReadOnly')}</p>
                      <h3>{metadata.title}</h3>
                      <p>{metadata.date}</p>
                      <div className="whitespace-pre-wrap">{content}</div>
                    </section>
                  ) : (
                    <fieldset
                      data-testid="import-candidate-edit-surface"
                      disabled={mutationPending}
                      className="contents"
                    >
                      <MetadataSidebar
                        metadata={metadata}
                        onUpdate={(patch) => setMetadata((current) => ({ ...current, ...patch }))}
                        fieldScope="import-review"
                        topicMode="single"
                        smartCapabilityAvailable={false}
                      />
                      <SimpleEditor content={content} onChange={setContent} minHeight="260px" />
                      {sourceBindingAvailable ? (
                        <PhotoAttachmentGrid
                          parentId={activeParentId}
                          proposalId={candidate.proposal_id}
                          attachments={candidate.available_attachments ?? []}
                          selectedAttachmentIds={selectedAttachmentIds}
                          onToggle={toggleAttachment}
                        />
                      ) : (
                        <p>{t('importRebindGuidance')}</p>
                      )}
                      <p className="text-sm text-[var(--color-muted)]">
                        {t('importConfirmQueuesOnly')}
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          data-testid="import-confirm-next"
                          disabled={
                            !hasQueueRevision
                            || authorityBlocked
                            || dateConfirmationBlocked
                            || mutationPending
                          }
                          onClick={() => void handleConfirm()}
                        >
                          {t('importConfirmNext')}
                        </button>
                        <button
                          type="button"
                          data-testid="import-skip-current"
                          disabled={
                            !hasQueueRevision
                            || authorityBlocked
                            || mutationPending
                          }
                          onClick={() => void submitDecision('skipped', false)}
                        >
                          {t('importSkipCurrent')}
                        </button>
                        {candidate.state !== 'pending' && (
                          <button
                            type="button"
                            data-testid="import-return-pending"
                            disabled={
                              !hasQueueRevision
                              || authorityBlocked
                              || mutationPending
                            }
                            onClick={() => void submitDecision('pending', false)}
                          >
                            {t('importReturnPending')}
                          </button>
                        )}
                      </div>
                    </fieldset>
                  )}
                </GlassCard>
              )}

              <GlassCard className="space-y-4 p-5" hoverable={false} glowEffect={false}>
                <button
                  type="button"
                  data-testid="import-batch-run"
                  disabled={
                    !sourceBindingAvailable
                    || confirmedCount <= 0
                    || authorityBlocked
                    || mutationPending
                  }
                  onClick={() => void handleBatchRun()}
                >
                  {batchRun.isPending
                    ? t('importBatching')
                    : t('importBatchConfirmed', { count: confirmedCount })}
                </button>

                {status.isLoading && <p role="status">{t('importStatusLoading')}</p>}
                {status.isError && <p role="alert">{t('importStatusError')}</p>}
                {status.data?.recovery_required === true && (
                  <p data-testid="import-recovery-required">{t('importRecoveryRequired')}</p>
                )}
                {status.data?.authority_status && (
                  <p data-testid="import-authority-status">
                    {t('importAuthorityStatus')}: {status.data.authority_status}
                  </p>
                )}
                {status.data?.active_child_id && (
                  <p data-testid="import-active-child">
                    {t('importActiveChild')}: {status.data.active_child_id}
                  </p>
                )}
                {authorityBlocked && (
                  <p data-testid="import-authority-blocked" role="alert">
                    {t('importAuthorityBlockedGuidance')}
                  </p>
                )}

                {status.data?.batches !== undefined && (
                  <section data-testid="import-batches">
                    <h2>{t('importBatchesTitle')}</h2>
                    {status.data.batches.length === 0 ? (
                      <p>{t('importBatchesEmpty')}</p>
                    ) : (
                      <ul className="space-y-2">
                        {status.data.batches.map((batch) => (
                          <li key={batch.import_id}>
                            <span>{batch.import_id} · {batch.state ?? t('importStateUnknown')}</span>
                            {batch.rollback_available === true && (
                              <button
                                type="button"
                                data-testid={`import-rollback-${batch.import_id}`}
                                disabled={mutationPending}
                                onClick={() => void handleRollback(batch.import_id)}
                              >
                                {childRollback.isPending
                                  ? t('importRollingBack')
                                  : t('importRollback')}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}
              </GlassCard>
            </>
          ) : (
            <GlassCard className="p-8 text-center" hoverable={false} glowEffect={false}>
              <p>{t('importSelectReview')}</p>
            </GlassCard>
          )}
        </div>
      </div>
    </main>
  );
}
