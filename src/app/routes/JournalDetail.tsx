import { useEffect, useRef, useState, useCallback } from 'react';
import {
  useBeforeUnload,
  useBlocker,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { GlassCard } from '@/components/celestial/GlassCard';
import { JournalMetadataPanel } from '@/components/journal/JournalMetadataPanel';
import { RelatedJournals } from '@/components/journal/RelatedJournals';
import { useTranslation } from '@/hooks/useTranslation';
import { useJournal, useUpdateJournal } from '@/hooks/useJournals';
import { PageLoader } from '@/components/celestial/CelestialLoader';
import { getTopicName } from '@/lib/formatters';
import { attachmentUrl } from '@/lib/attachments';
import { MarkdownRenderer } from '@/components/journal/MarkdownRenderer';
import { SimpleEditor } from '@/components/editor/SimpleEditor';
import type { JournalDetail as JournalDetailData, UpdateJournalRequest } from '@/lib/api-client';

function isImageAttachment(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('image/');
}

function isVideoAttachment(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('video/');
}

type JournalEditField =
  | 'title'
  | 'content'
  | 'abstract'
  | 'topics'
  | 'moods'
  | 'people'
  | 'location'
  | 'weather'
  | 'project'
  | 'links';

type JournalEditDraft = Record<JournalEditField, string>;

const journalEditFields: JournalEditField[] = [
  'title',
  'content',
  'abstract',
  'topics',
  'moods',
  'people',
  'location',
  'weather',
  'project',
  'links',
];

const journalEditRequestFields: Record<JournalEditField, keyof UpdateJournalRequest> = {
  title: 'title',
  content: 'contentReplace',
  abstract: 'abstract',
  topics: 'topic',
  moods: 'mood',
  people: 'people',
  location: 'location',
  weather: 'weather',
  project: 'project',
  links: 'links',
};

function normalizeJournalEditDraft(journal: JournalDetailData): JournalEditDraft {
  return {
    title: journal.title ?? '',
    content: journal.content ?? '',
    abstract: journal.abstract ?? '',
    topics: (journal.topics ?? []).join(', '),
    moods: (journal.moods ?? []).join(', '),
    people: (journal.people ?? []).join(', '),
    location: journal.location ?? '',
    weather: journal.weather ?? '',
    project: journal.project ?? '',
    links: (journal.links ?? []).join(', '),
  };
}

function buildJournalEditDiff(
  snapshot: JournalEditDraft,
  draft: JournalEditDraft,
): UpdateJournalRequest {
  const diff: UpdateJournalRequest = {};
  for (const field of journalEditFields) {
    if (draft[field] !== snapshot[field]) {
      const requestField = journalEditRequestFields[field];
      diff[requestField] = draft[field];
    }
  }
  return diff;
}



/* ── Staggered entrance variants ─────────────────────────────────── */
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.23, 1, 0.32, 1] },
  },
};

const cardRevealVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.6, ease: [0.23, 1, 0.32, 1] },
  },
};

/**
 * ScrollProgress — thin gold line at viewport top
 */
function ScrollProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = docHeight > 0 ? window.scrollY / docHeight : 0;
      setProgress(Math.min(1, Math.max(0, ratio)));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      className="fixed top-0 left-0 right-0 h-[2px] z-[200] pointer-events-none"
      style={{ opacity: progress > 0 ? 1 : 0, transition: 'opacity 0.15s' }}
    >
      <div
        className="h-full origin-left"
        style={{
          background: 'linear-gradient(90deg, var(--color-gold-40), var(--color-gold))',
          transform: `scaleX(${progress})`,
          transition: 'transform 0.15s linear',
        }}
      />
    </div>
  );
}

/**
 * ScrollToTop — floating button that appears after scrolling
 */
function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          onClick={scrollToTop}
          aria-label={t('backToTop')}
          className="fixed bottom-24 right-6 z-[90] w-11 h-11 rounded-full flex items-center justify-center cursor-pointer border"
          style={{
            background: 'var(--color-ether-surface)',
            borderColor: 'var(--color-glass-border)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px var(--color-glass-shadow)',
          }}
          whileHover={{ scale: 1.08, borderColor: 'var(--color-gold-25)' }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="material-symbols-outlined text-[var(--color-gold)] text-lg">arrow_upward</span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}

interface JournalEditFormProps {
  draft: JournalEditDraft;
  isPending: boolean;
  refreshFailed: boolean;
  canSave: boolean;
  error: string | null;
  onChange: (field: JournalEditField, value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onRetryRefresh: () => void;
  onContinue: () => void;
}

function JournalEditForm({
  draft,
  isPending,
  refreshFailed,
  canSave,
  error,
  onChange,
  onCancel,
  onSave,
  onRetryRefresh,
  onContinue,
}: JournalEditFormProps) {
  const { t } = useTranslation();
  const fields: Array<{ field: Exclude<JournalEditField, 'content'>; label: string }> = [
    { field: 'title', label: t('editTitle') },
    { field: 'abstract', label: t('editAbstract') },
    { field: 'topics', label: t('editTopics') },
    { field: 'moods', label: t('editMoods') },
    { field: 'people', label: t('editPeople') },
    { field: 'location', label: t('editLocation') },
    { field: 'weather', label: t('editWeather') },
    { field: 'project', label: t('editProject') },
    { field: 'links', label: t('editLinks') },
  ];

  return (
    <div data-testid="journal-detail-edit">
      <h2 className="text-xl font-semibold text-[var(--color-primary)] mb-6">
        {t('editJournal')}
      </h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
        className="space-y-5"
      >
        <div className="space-y-2">
          <label htmlFor="journal-detail-edit-title" className="text-xs uppercase tracking-[0.08em] text-[var(--color-muted)]">
            {t('editTitle')}
          </label>
          <input
            id="journal-detail-edit-title"
            aria-label={t('editTitle')}
            value={draft.title}
            onChange={(event) => onChange('title', event.target.value)}
            className="w-full rounded-xl border border-white/[0.08] bg-[var(--color-ether-surface-ghost)] px-4 py-3 text-[var(--color-primary)] outline-none focus:border-[var(--color-gold)]/40"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="editor-textarea" className="text-xs uppercase tracking-[0.08em] text-[var(--color-muted)]">
            {t('editContent')}
          </label>
          <SimpleEditor
            content={draft.content}
            onChange={(content) => onChange('content', content)}
            minHeight="260px"
            placeholder={t('editorRecordPlaceholder')}
          />
        </div>

        {fields.slice(1).map(({ field, label }) => (
          <div key={field} className="space-y-2">
            <label htmlFor={`journal-detail-edit-${field}`} className="text-xs uppercase tracking-[0.08em] text-[var(--color-muted)]">
              {label}
            </label>
            {field === 'abstract' ? (
              <textarea
                id={`journal-detail-edit-${field}`}
                aria-label={label}
                value={draft[field]}
                onChange={(event) => onChange(field, event.target.value)}
                rows={3}
                className="w-full resize-y rounded-xl border border-white/[0.08] bg-[var(--color-ether-surface-ghost)] px-4 py-3 text-sm text-[var(--color-primary)] outline-none focus:border-[var(--color-gold)]/40"
              />
            ) : (
              <input
                id={`journal-detail-edit-${field}`}
                aria-label={label}
                value={draft[field]}
                onChange={(event) => onChange(field, event.target.value)}
                className="w-full rounded-xl border border-white/[0.08] bg-[var(--color-ether-surface-ghost)] px-4 py-3 text-sm text-[var(--color-primary)] outline-none focus:border-[var(--color-gold)]/40"
              />
            )}
          </div>
        ))}

        {error && (
          <div role="alert" aria-live="polite" className="text-sm text-[var(--color-coral)]">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-white/[0.06] pt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-full border border-white/[0.08] px-5 py-2.5 text-sm text-[var(--color-muted)] transition-colors hover:border-[var(--color-gold)]/30 hover:text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('cancelEdit')}
          </button>
          <button
            type="submit"
            aria-label={t('saveChanges')}
            disabled={!canSave || isPending || refreshFailed}
            className="rounded-full border border-[var(--color-gold)]/30 px-5 py-2.5 text-sm text-[var(--color-gold)] transition-colors hover:border-[var(--color-gold)]/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('saveChanges')}
          </button>
          {refreshFailed && (
            <button
              type="button"
              onClick={onRetryRefresh}
              disabled={isPending}
              className="rounded-full border border-[var(--color-gold)]/30 px-5 py-2.5 text-sm text-[var(--color-gold)] transition-colors hover:border-[var(--color-gold)]/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('retryRefresh')}
            </button>
          )}
          <button
            type="button"
            aria-label={t('continueWriting')}
            data-testid="journal-detail-continue-edit"
            onClick={onContinue}
            disabled={isPending}
            className="rounded-full border border-white/[0.08] px-5 py-2.5 text-sm text-[var(--color-muted)] transition-colors hover:border-[var(--color-gold)]/30 hover:text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('continueWriting')}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * JournalDetail - 日志详情（展卷页）
 * Magazine-style reading layout with ceremonial entrance animation,
 * scroll progress, reading time estimate, and scroll-to-top.
 */
export default function JournalDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const id = params['*'] ?? '';
  const editModeRequested = searchParams.get('mode') === 'edit';
  const { data: journal, isLoading, error, refetch } = useJournal(id);
  const updateJournal = useUpdateJournal();
  const contentRef = useRef<HTMLDivElement>(null);
  const saveInFlightRef = useRef(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<JournalEditDraft | null>(null);
  const [editSnapshot, setEditSnapshot] = useState<JournalEditDraft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [canonicalOverride, setCanonicalOverride] = useState<JournalDetailData | null>(null);

  const displayedJournal = canonicalOverride ?? journal;
  const isMutationPending = isSaving || updateJournal.isPending;
  const isDirty = Boolean(
    editDraft
    && editSnapshot
    && Object.keys(buildJournalEditDiff(editSnapshot, editDraft)).length > 0,
  );
  const bypassBlockRef = useRef(false);
  const promptedBlockRef = useRef<string | null>(null);

  const shouldBlockNavigation = useCallback(() => isDirty && !bypassBlockRef.current, [isDirty]);
  const blocker = useBlocker(shouldBlockNavigation);

  useBeforeUnload(useCallback((event) => {
    if (!isDirty) return;
    event.preventDefault();
    event.returnValue = t('unsavedChangesPrompt');
  }, [isDirty, t]));

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      promptedBlockRef.current = null;
      return;
    }

    const transitionKey = `${blocker.location.key}:${blocker.location.pathname}${blocker.location.search}`;
    if (promptedBlockRef.current === transitionKey) return;
    promptedBlockRef.current = transitionKey;

    if (window.confirm(t('unsavedChangesPrompt'))) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker, t]);

  const resetEditState = useCallback(() => {
    setIsEditing(false);
    setEditDraft(null);
    setEditSnapshot(null);
    setEditError(null);
    setRefreshFailed(false);
  }, []);

  useEffect(() => {
    setCanonicalOverride(null);
    resetEditState();
    saveInFlightRef.current = false;
  }, [id, resetEditState]);

  const beginEditing = useCallback(() => {
    if (!displayedJournal || isMutationPending || saveInFlightRef.current) return;
    const snapshot = normalizeJournalEditDraft(displayedJournal);
    setEditSnapshot(snapshot);
    setEditDraft({ ...snapshot });
    setEditError(null);
    setRefreshFailed(false);
    setIsEditing(true);
  }, [displayedJournal, isMutationPending]);

  useEffect(() => {
    if (editModeRequested) {
      if (!isEditing && displayedJournal && !isMutationPending) beginEditing();
      return;
    }
    if (isEditing) resetEditState();
  }, [beginEditing, displayedJournal, editModeRequested, isEditing, isMutationPending, resetEditState]);

  useEffect(() => {
    if (!editModeRequested && bypassBlockRef.current) {
      bypassBlockRef.current = false;
    }
  }, [editModeRequested]);

  const navigateToContinue = useCallback(() => {
    navigate(`/?append=${encodeURIComponent(id)}`);
  }, [id, navigate]);

  const exitEditMode = useCallback(() => {
    bypassBlockRef.current = true;
    resetEditState();
    navigate(`/journal/${id}`, { replace: true });
  }, [id, navigate, resetEditState]);

  const cancelEditing = useCallback(() => {
    if (isMutationPending || saveInFlightRef.current) return;
    exitEditMode();
  }, [exitEditMode, isMutationPending]);

  const updateDraftField = useCallback((field: JournalEditField, value: string) => {
    setEditDraft((current) => (current ? { ...current, [field]: value } : current));
    if (!refreshFailed) setEditError(null);
  }, [refreshFailed]);

  const refreshCanonicalDetail = useCallback(async () => {
    const result = await refetch();
    if (!result || result.error || !result.data) {
      throw new Error('refresh failed');
    }
    setCanonicalOverride(result.data);
    exitEditMode();
  }, [exitEditMode, refetch]);

  const handleRefreshRetry = useCallback(async () => {
    if (isMutationPending || saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    setIsSaving(true);
    setEditError(null);
    try {
      await refreshCanonicalDetail();
    } catch {
      setRefreshFailed(true);
      setEditError(t('editRefreshFailed'));
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  }, [isMutationPending, refreshCanonicalDetail, t]);

  const handleSave = useCallback(async () => {
    if (
      !editDraft
      || !editSnapshot
      || isMutationPending
      || refreshFailed
      || saveInFlightRef.current
    ) {
      return;
    }

    const diff = buildJournalEditDiff(editSnapshot, editDraft);
    if (Object.keys(diff).length === 0) return;

    saveInFlightRef.current = true;
    setIsSaving(true);
    setEditError(null);
    let mutationCommitted = false;
    try {
      await updateJournal.mutateAsync({ id, data: diff });
      mutationCommitted = true;
      await refreshCanonicalDetail();
    } catch {
      setRefreshFailed(mutationCommitted);
      setEditError(t(mutationCommitted ? 'editRefreshFailed' : 'editSaveFailed'));
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  }, [editDraft, editSnapshot, id, isMutationPending, refreshCanonicalDetail, refreshFailed, t, updateJournal]);

  const canSave = Boolean(
    editDraft
    && editSnapshot
    && Object.keys(buildJournalEditDiff(editSnapshot, editDraft)).length > 0,
  );

  if (isLoading) {
    return (
      <div className="max-w-[800px] mx-auto px-6 py-20">
        <PageLoader />
      </div>
    );
  }

  if (error || !journal) {
    return (
      <div className="max-w-[800px] mx-auto px-6 py-20 text-center">
        <motion.button
          type="button"
          aria-label={t('back')}
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-[0.75rem] text-[var(--color-muted)] hover:text-[var(--color-primary)] transition-colors mb-10 cursor-pointer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          <span>{t('back')}</span>
        </motion.button>

        <motion.div
          className="py-16"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
        >
          <span className="material-symbols-outlined text-[var(--color-secondary)] text-5xl mb-4 block">
            {error ? 'cloud_off' : 'explore_off'}
          </span>
          <h2 className="text-xl font-semibold text-[var(--color-primary)] mb-2">
            {error ? t('loadFailed') : t('journalNotFound')}
          </h2>
          <p className="text-[var(--color-secondary)] text-sm mb-8">
            {error ? t('checkNetwork') : t('journalMoved')}
          </p>
          {error && (
            <button
              type="button"
              onClick={() => refetch()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium cursor-pointer transition-all duration-300 border"
              style={{
                background: 'var(--color-gold-10)',
                borderColor: 'var(--color-gold-25)',
                color: 'var(--color-gold)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-gold-20)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--color-gold-10)';
              }}
            >
              <span className="material-symbols-outlined text-base">refresh</span>
              {t('retry')}
            </button>
          )}
        </motion.div>
      </div>
    );
  }

  const viewJournal = displayedJournal ?? journal;

  return (
    <>
      <ScrollProgress />
      <ScrollToTop />

      <motion.div
        className="max-w-[1200px] mx-auto px-6"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <div className="max-w-[800px] mx-auto space-y-8 pb-20">
          {/* Back link */}
          <motion.div variants={itemVariants} className="pt-6">
            <button
              type="button"
              aria-label={t('back')}
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-2 text-[0.75rem] text-[var(--color-muted)] hover:text-[var(--color-primary)] transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">arrow_back</span>
              <span>{t('back')}</span>
            </button>
          </motion.div>

          {/* Journal Content — ceremonial glass card with enhanced thickness */}
          <motion.div variants={cardRevealVariants}>
            <GlassCard
              className="p-6 max-[640px]:p-4"
              hoverable={false}
              glowEffect={false}
            >
              <div className={isEditing ? 'hidden' : undefined}>
              {/* Title header */}
              <div className="mb-8">
                <div className="flex items-start justify-between gap-4">
                  <h1 className="text-[1.75rem] font-normal tracking-[0.06em] text-[var(--color-primary)] mb-5 leading-[1.35] flex-1" style={{ fontFamily: 'var(--font-divine)' }}>
                    {viewJournal.title}
                  </h1>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <motion.button
                      type="button"
                      aria-label={t('continueWriting')}
                      onClick={navigateToContinue}
                      className="p-3 rounded-xl bg-[var(--color-ether-surface-ghost)] text-[var(--color-muted)] hover:bg-[var(--color-ether-control)] hover:text-[var(--color-gold)] transition-colors cursor-pointer"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      title={t('continueWriting')}
                    >
                      <span className="material-symbols-outlined text-lg">edit_note</span>
                    </motion.button>
                    <motion.button
                      type="button"
                      aria-label={t('editJournal')}
                      onClick={() => navigate(`/journal/${id}?mode=edit`, { replace: true })}
                      className="p-3 rounded-xl bg-[var(--color-ether-surface-ghost)] text-[var(--color-muted)] hover:bg-[var(--color-ether-control)] hover:text-[var(--color-gold)] transition-colors cursor-pointer"
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      title={t('edit')}
                    >
                      <span className="material-symbols-outlined text-lg">edit</span>
                    </motion.button>
                  </div>
                </div>

                {/* Date + meta — magazine-style */}
                <div className="flex items-center gap-5">
                  {/* Date pillar */}
                  {viewJournal.date && (
                    <div className="flex flex-col items-center gap-0.5 pr-5 border-r border-white/[0.08]">
                      <span className="text-[0.6875rem] tracking-[0.12em] uppercase" style={{ color: 'var(--color-gold)', fontFamily: 'var(--font-order)' }}>
                        {new Date(viewJournal.date).toLocaleString('en', { month: 'short' }).toUpperCase()}
                      </span>
                      <span className="text-[1.75rem] font-light leading-none" style={{ fontFamily: 'var(--font-divine)', color: 'var(--color-primary)' }}>
                        {String(new Date(viewJournal.date).getDate()).padStart(2, '0')}
                      </span>
                      <span className="text-[0.625rem] tracking-wider" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-order)' }}>
                        {new Date(viewJournal.date).getFullYear()}
                      </span>
                    </div>
                  )}

                  {/* Meta row — location · weather */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2.5 flex-wrap text-[0.8125rem]" style={{ color: 'var(--color-secondary)' }}>
                      {viewJournal.location && (
                        <span className="flex items-center gap-1">
                          <span className="material-symbols-outlined text-[0.875rem]">location_on</span>
                          <span>{viewJournal.location}</span>
                        </span>
                      )}
                      {viewJournal.weather && (
                        <>
                          <span style={{ color: 'var(--color-muted)', fontSize: '0.625rem' }}>·</span>
                          <span className="flex items-center gap-1">
                            <span className="material-symbols-outlined text-[0.875rem]">cloud</span>
                            <span>{viewJournal.weather}</span>
                          </span>
                        </>
                      )}
                    </div>

                    {/* Moods | Tags */}
                    {(viewJournal.moods.length > 0 || viewJournal.topics.length > 0) && (
                      <div className="flex items-center gap-2 flex-wrap text-[0.8125rem]">
                        {viewJournal.moods.length > 0 && (
                          <span className="flex items-center gap-1" style={{ color: 'var(--color-secondary)' }}>
                            <span className="material-symbols-outlined text-[0.875rem]">mood</span>
                            <span>{viewJournal.moods.join(' · ')}</span>
                          </span>
                        )}
                        {viewJournal.moods.length > 0 && viewJournal.topics.length > 0 && (
                          <span style={{ color: 'var(--color-muted)' }}>|</span>
                        )}
                        {viewJournal.topics.length > 0 && (
                          <div className="flex items-center gap-3 flex-wrap">
                            {viewJournal.topics.map((topic) => (
                              <span
                                key={topic}
                                className="text-[0.75rem]"
                                style={{
                                  color: 'var(--color-cyan)',
                                  fontFamily: 'var(--font-order)',
                                  letterSpacing: '0.04em',
                                  opacity: 0.7,
                                }}
                              >
                                #{getTopicName(topic)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="border-t border-white/[0.06] pt-6">
                <div ref={contentRef}>
                  <MarkdownRenderer content={viewJournal.content} />
                </div>
              </div>
              </div>
              {isEditing && editDraft && (
                <JournalEditForm
                  draft={editDraft}
                  isPending={isMutationPending}
                  refreshFailed={refreshFailed}
                  canSave={canSave}
                  error={editError}
                  onChange={updateDraftField}
                  onCancel={cancelEditing}
                  onSave={handleSave}
                  onRetryRefresh={handleRefreshRetry}
                  onContinue={navigateToContinue}
                />
              )}
            </GlassCard>
          </motion.div>

          {/* Attachments */}
          {viewJournal.attachments.length > 0 && (
            <motion.div variants={itemVariants}>
              <div data-testid="journal-detail-attachments">
                <GlassCard className="p-6 max-[640px]:p-4" hoverable={false} glowEffect={false}>
                  <h2 className="text-base font-semibold text-[var(--color-primary)] mb-4">
                    {t('attachments')}
                  </h2>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {viewJournal.attachments.map((attachment) => {
                    const url = attachmentUrl(attachment.relPath);
                    if (isImageAttachment(attachment.contentType)) {
                      return (
                        <a
                          key={attachment.relPath}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`${t('attachmentImagePreview')}: ${attachment.filename}`}
                          className="block overflow-hidden rounded-xl border border-white/[0.06] bg-[var(--color-ether-surface-ghost)]"
                        >
                          <img
                            src={url}
                            alt={attachment.filename}
                            loading="lazy"
                            className="h-48 w-full object-cover"
                          />
                          <span className="block px-3 py-2 text-xs text-[var(--color-secondary)]">
                            {attachment.filename}
                          </span>
                        </a>
                      );
                    }
                    if (isVideoAttachment(attachment.contentType)) {
                      return (
                        <div
                          key={attachment.relPath}
                          className="overflow-hidden rounded-xl border border-white/[0.06] bg-[var(--color-ether-surface-ghost)]"
                        >
                          <video
                            aria-label={`${t('attachmentVideoPreview')}: ${attachment.filename}`}
                            controls
                            className="h-48 w-full bg-[var(--color-ether-surface)] object-contain"
                          >
                            <source src={url} type={attachment.contentType} />
                          </video>
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="block px-3 py-2 text-xs text-[var(--color-secondary)] hover:text-[var(--color-primary)]"
                          >
                            {attachment.filename}
                          </a>
                        </div>
                      );
                    }
                    return (
                      <a
                        key={attachment.relPath}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${t('attachmentOpen')}: ${attachment.filename}`}
                        className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-[var(--color-ether-surface-ghost)] px-4 py-3 text-sm text-[var(--color-primary)] hover:border-[var(--color-gold)]/30"
                      >
                        <span className="material-symbols-outlined text-[var(--color-gold)]">attach_file</span>
                        <span className="min-w-0 truncate">{attachment.filename}</span>
                      </a>
                    );
                    })}
                  </div>
                </GlassCard>
              </div>
            </motion.div>
          )}

          {/* Metadata Panel */}
          <motion.div variants={itemVariants}>
            <JournalMetadataPanel metadata={{
              date: viewJournal.date,
              topics: viewJournal.topics,
              moods: viewJournal.moods,
              people: viewJournal.people,
              location: viewJournal.location ?? '',
              weather: viewJournal.weather ?? '',
              project: viewJournal.project ?? '',
              links: viewJournal.links ?? [],
              wordCount: viewJournal.wordCount,
            }} />
          </motion.div>

          {/* Related Journals */}
          <motion.div variants={itemVariants}>
            <RelatedJournals journals={[]} />
          </motion.div>
        </div>
      </motion.div>
    </>
  );
}
