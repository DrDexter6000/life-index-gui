import React, { Suspense, useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { GlassCard } from '@/components/celestial/GlassCard';
import { SimpleEditor } from '@/components/editor/SimpleEditor';
import { MetadataSidebar } from '@/components/editor/MetadataSidebar';
import { CelestialLoader } from '@/components/celestial/CelestialLoader';
import { ChronologicalGreetings } from '@/components/celestial/ChronologicalGreetings';
import { MemoryFragments } from '@/components/celestial/MemoryFragments';
import { useCreateJournal, useDashboardStats, useJournal, useUpdateJournal, useHealthCheck } from '@/hooks/useJournals';
import { useJournalDraftStore } from '@/stores/journal-draft';
import { useUIStore } from '@/stores/ui';
import { useTranslation } from '@/hooks/useTranslation';
import { getErrorMessage } from '@/lib/error-messages';
import { isSmartCapabilityUnavailable } from '@/lib/health-status';
import {
  clearJournalDraft,
  clearJournalDraftAttachments,
  createJournalDraftScope,
  hasRecoverableJournalDraft,
  readJournalDraft,
  readJournalDraftAttachments,
  saveJournalDraftAttachments,
  writeJournalDraft,
} from '@/lib/journal-draft-cache';

const LazyEmptyState = React.lazy(() => import('@/app/routes/EmptyState'));

/** Placeholder ceremony duration for the save transition (≤ 1.5s per DoD P3). */
const SAVE_CEREMONY_MS = 700;

/**
 * TheCore - 写入 (Write)
 * Main entry point: write journal + recent journals
 * Zen mode auto-activates on editor focus, click-outside to exit
 */
export default function TheCore() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation();
  const draft = useJournalDraftStore();
  const setDraftContent = draft.setContent;
  const updateDraftMetadata = draft.updateMetadata;
  const createJournal = useCreateJournal();
  const updateJournal = useUpdateJournal();
  const { enterEtherDissolve, exitEtherDissolve, isEtherDissolve, homeActivated, setHomeActivated } = useUIStore();
  const [showMetadata, setShowMetadata] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [zenChromeAwake, setZenChromeAwake] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSaveTransition, setShowSaveTransition] = useState(false);
  const reduceMotion = useReducedMotion();
  const editorCardRef = useRef<HTMLDivElement>(null);
  const actionBarContentRef = useRef<HTMLDivElement>(null);
  const [actionBarHeight, setActionBarHeight] = useState(99);
  const editLoadedRef = useRef<string | null>(null);
  const recoveredDraftScopeRef = useRef<string | null>(null);
  const editId = searchParams.get('edit') ?? '';
  const isEditMode = Boolean(editId);
  const appendId = searchParams.get('append') ?? '';
  const isAppendMode = Boolean(appendId);
  const draftScope = createJournalDraftScope({ editId, appendId });
  const [draftCacheReady, setDraftCacheReady] = useState(false);
  const [attachmentCacheReady, setAttachmentCacheReady] = useState(false);

  // Data fetching
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: editJournal, isLoading: editJournalLoading } = useJournal(editId);
  const { data: appendJournal, isLoading: appendJournalLoading } = useJournal(appendId);
  const { data: healthData, isError: healthUnavailable } = useHealthCheck();
  const smartCapabilityAvailable = !healthUnavailable && !isSmartCapabilityUnavailable(healthData);

  const showEmptyState = !isEditMode && !statsLoading && stats?.totalJournals === 0;
  const isWriteBusy =
    createJournal.isPending ||
    updateJournal.isPending ||
    (isEditMode && editJournalLoading) ||
    (isAppendMode && appendJournalLoading);
  const showHeroScreen = !homeActivated && !showEmptyState && !isWriteBusy;
  const actionBarCollapsed = isEtherDissolve && !showMetadata && !showAttachments && !zenChromeAwake;

  useEffect(() => {
    if (!isEtherDissolve && zenChromeAwake) {
      setZenChromeAwake(false);
    }
  }, [isEtherDissolve, zenChromeAwake]);

  useEffect(() => {
    const actionBarContent = actionBarContentRef.current;
    if (!actionBarContent) return;

    const syncActionBarHeight = () => {
      const measuredHeight = actionBarContent.scrollHeight;
      if (measuredHeight > 0) {
        setActionBarHeight(measuredHeight);
      }
    };

    syncActionBarHeight();

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(syncActionBarHeight);
    observer.observe(actionBarContent);
    return () => observer.disconnect();
  }, [saveError]);

  // Click-outside to exit zen mode — must be before any conditional returns
  useEffect(() => {
    if (!isEtherDissolve) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const isInsideEditor = editorCardRef.current?.contains(target);
      const isInsideDrawer = target instanceof Element && target.closest('.write-drawer-slot');

      if (!isInsideEditor && !isInsideDrawer) {
        exitEtherDissolve();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isEtherDissolve, exitEtherDissolve]);
  // Reset zen mode when the write surface is deactivated
  useEffect(() => {
    if (!homeActivated && isEtherDissolve) {
      exitEtherDissolve();
    }
  }, [homeActivated, isEtherDissolve, exitEtherDissolve]);

  useEffect(() => {
    const root = document.documentElement;

    if (!showHeroScreen) {
      root.classList.remove('li-hero-scroll-lock');
      return;
    }

    if (import.meta.env.MODE !== 'test') {
      window.scrollTo({ top: 0, left: window.scrollX, behavior: 'auto' });
    }
    root.classList.add('li-hero-scroll-lock');
    return () => root.classList.remove('li-hero-scroll-lock');
  }, [showHeroScreen]);

  useEffect(() => {
    let cancelled = false;
    setDraftCacheReady(false);
    setAttachmentCacheReady(false);
    setAttachments([]);

    const cachedDraft = readJournalDraft(draftScope);
    if (cachedDraft) {
      setDraftContent(cachedDraft.content);
      updateDraftMetadata(cachedDraft.metadata);
      recoveredDraftScopeRef.current = draftScope;
      setHomeActivated(true);
    } else {
      recoveredDraftScopeRef.current = null;
    }
    setDraftCacheReady(true);

    readJournalDraftAttachments(draftScope)
      .then((cachedAttachments) => {
        if (!cancelled && cachedAttachments.length > 0) {
          setAttachments(cachedAttachments);
          setHomeActivated(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAttachmentCacheReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [draftScope, setDraftContent, setHomeActivated, updateDraftMetadata]);

  useEffect(() => {
    if (!draftCacheReady) return;

    if (hasRecoverableJournalDraft(draft.content, draft.metadata)) {
      writeJournalDraft(draftScope, {
        content: draft.content,
        metadata: draft.metadata,
      });
      return;
    }

    clearJournalDraft(draftScope);
  }, [draftCacheReady, draftScope, draft.content, draft.metadata]);

  useEffect(() => {
    if (!attachmentCacheReady) return;
    void saveJournalDraftAttachments(draftScope, attachments);
  }, [attachmentCacheReady, attachments, draftScope]);

  useEffect(() => {
    if (!editId) {
      editLoadedRef.current = null;
      return;
    }

    if (!editJournal || editLoadedRef.current === editId) return;
    if (recoveredDraftScopeRef.current === draftScope) {
      editLoadedRef.current = editId;
      return;
    }

    setDraftContent(editJournal.content);
    updateDraftMetadata({
      title: editJournal.title,
      date: editJournal.date,
      topics: editJournal.topics,
      moods: editJournal.moods,
      people: editJournal.people,
      location: editJournal.location ?? '',
      weather: editJournal.weather ?? '',
      project: editJournal.project ?? '',
    });
    editLoadedRef.current = editId;
    setHomeActivated(true);
  }, [draftScope, editId, editJournal, setDraftContent, setHomeActivated, updateDraftMetadata]);

  // Activate the write surface when entering continuation mode, but do NOT load old content
  useEffect(() => {
    if (!appendId || !appendJournal) return;
    setHomeActivated(true);
  }, [appendId, appendJournal, setHomeActivated]);

  // Show EmptyState when user has zero journals
  if (showEmptyState) {
    return (
      <Suspense fallback={null}>
        <LazyEmptyState
          onWriteClick={() => {
            const el = document.querySelector<HTMLInputElement>('[data-editor-title]');
            el?.focus();
          }}
        />
      </Suspense>
    );
  }

  const finishSaveAndNavigate = async (id: string) => {
    clearJournalDraft(draftScope);
    await clearJournalDraftAttachments(draftScope);
    draft.reset();
    setShowMetadata(false);
    setAttachments([]);
    setSearchParams({});

    if (reduceMotion) {
      navigate(`/journal/${id}`);
      return;
    }

    // Placeholder: CelestialLoader is reused as a temporary save-transition
    // ceremony. Replace with the P3-designed "completion" motion when ready.
    setShowSaveTransition(true);
    await new Promise((resolve) => {
      setTimeout(resolve, SAVE_CEREMONY_MS);
    });
    navigate(`/journal/${id}`);
  };

  const handleSave = async () => {
    if (!draft.metadata.title?.trim() && !draft.content.trim()) return;
    setSaveError(null);

    try {
      if (isAppendMode) {
        if (!draft.content.trim()) return;

        await updateJournal.mutateAsync({
          id: appendId,
          data: {
            contentAppend: draft.content,
          },
        });

        await finishSaveAndNavigate(appendId);
        return;
      }

      if (isEditMode) {
        await updateJournal.mutateAsync({
          id: editId,
          data: {
            title: draft.metadata.title || t('untitled'),
            contentReplace: draft.content,
            topic: draft.metadata.topics?.join(','),
            mood: draft.metadata.moods?.join(','),
            people: draft.metadata.people?.join(','),
            location: draft.metadata.location,
            weather: draft.metadata.weather,
            project: draft.metadata.project,
            abstract: draft.metadata.abstract,
            tags: draft.metadata.tags?.join(','),
            links: draft.metadata.links?.join(','),
          },
        });

        await finishSaveAndNavigate(editId);
        return;
      }

      const result = await createJournal.mutateAsync({
        title: draft.metadata.title || t('untitled'),
        content: draft.content,
        date: new Date().toISOString().split('T')[0],
        topic: draft.metadata.topics?.join(','),
        mood: draft.metadata.moods?.join(','),
        people: draft.metadata.people?.join(','),
        location: draft.metadata.location,
        weather: draft.metadata.weather,
        project: draft.metadata.project,
        abstract: draft.metadata.abstract,
        tags: draft.metadata.tags?.join(','),
        links: draft.metadata.links?.join(','),
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      await finishSaveAndNavigate(result.id);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to save journal:', error);
      }
      const message = getErrorMessage(
        error instanceof Error && 'code' in error
          ? (error as { code?: string; message?: string })
          : { code: 'WRITE_ERROR' },
      );
      setSaveError(message);
    }
  };

  const handleEditorFocus = () => {
    if (!isEtherDissolve) {
      enterEtherDissolve();
    }
  };

  const wakeZenChrome = () => {
    if (isEtherDissolve && !showMetadata && !showAttachments) {
      setZenChromeAwake(true);
    }
  };

  const settleZenChrome = () => {
    if (!showMetadata && !showAttachments) {
      setZenChromeAwake(false);
    }
  };

  const persistDraftNow = (content: string, metadata = draft.metadata) => {
    if (hasRecoverableJournalDraft(content, metadata)) {
      writeJournalDraft(draftScope, { content, metadata });
      return;
    }

    clearJournalDraft(draftScope);
  };

  const handleDraftContentChange = (content: string) => {
    setDraftContent(content);
    persistDraftNow(content);
  };

  const handleMetadataUpdate = (metadata: Parameters<typeof updateDraftMetadata>[0]) => {
    const nextMetadata = { ...draft.metadata, ...metadata };
    updateDraftMetadata(metadata);
    persistDraftNow(draft.content, nextMetadata);
  };

  // Toggle metadata panel (mutually exclusive with attachments)
  const toggleMetadata = () => {
    setShowMetadata(prev => {
      const next = !prev;
      if (next) setShowAttachments(false);
      setZenChromeAwake(false);
      return next;
    });
  };

  // Toggle attachments panel (mutually exclusive with metadata)
  const toggleAttachments = () => {
    setShowAttachments(prev => {
      const next = !prev;
      if (next) setShowMetadata(false);
      setZenChromeAwake(false);
      return next;
    });
  };

  if (isWriteBusy || showSaveTransition) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <CelestialLoader />
      </div>
    );
  }

  return (
    <div className={`li-page-shell ${showHeroScreen ? 'li-page-shell--hero' : ''}`}>
      {/* Header — fades out in zen mode */}
      <header
        className={`transition-opacity duration-[800ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${
          isEtherDissolve ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        {/* TopNav content would go here */}
      </header>

      {/* Hero Screen — shown before the write surface is activated */}
      {showHeroScreen && (
        <div
          className="hero-screen-layer"
          onClick={() => setHomeActivated(true)}
        >
          <MemoryFragments enabled={true} />
          <div className="hero-welcome-copy text-center">
            <p
              className="text-[0.75rem] max-sm:text-[1.275rem] text-[var(--color-gold)] tracking-[0.35em] uppercase mb-4"
              style={{
                fontFamily: 'var(--font-divine)',
                textShadow: '0 0 40px rgba(0,0,0,0.9), 0 0 80px rgba(0,0,0,0.6)',
              }}
            >
              Welcome Back
            </p>
            <p
              className="text-[clamp(1.5rem,5vw,2.75rem)] max-sm:text-[clamp(2.55rem,8vw,2.75rem)] font-normal tracking-[0.15em] uppercase text-[var(--color-primary)]"
              style={{
                fontFamily: 'var(--font-divine)',
                textShadow: '0 0 40px rgba(0,0,0,0.9), 0 0 80px rgba(0,0,0,0.6), 0 0 120px rgba(0,0,0,0.3), 0 0 20px rgba(0,0,0,0.9)',
              }}
            >
              Starweaver
            </p>
          </div>
          <p
            className="hero-weave-prompt text-[0.75rem] text-[var(--color-gold)] tracking-[0.1em] uppercase animate-pulse"
            style={{
              fontFamily: 'var(--font-order)',
              textShadow: '0 0 30px rgba(0,0,0,0.9), 0 0 60px rgba(0,0,0,0.6), 0 0 90px rgba(0,0,0,0.3)',
            }}
          >
            Click anywhere to weave
          </p>
        </div>
      )}

      <section
        className={`li-page-composition the-core-composition ${
          !homeActivated ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
        aria-label={t('remember')}
      >
        {/* Greeting Section — fades out in zen mode, but keeps layout slot stable */}
        <div className={`li-page-header home-greeting-slot transition-opacity duration-[1200ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${
          isEtherDissolve ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}>
          <ChronologicalGreetings />
        </div>

        {/* Editor Section — hidden before the write surface is activated */}
        <div className={`li-workbench home-editor-stage transition-[opacity,transform] duration-[1200ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${
          isEtherDissolve ? 'home-editor-stage--zen' : ''
        }`}>
          <div ref={editorCardRef} className="relative" onPointerLeave={settleZenChrome}>
            <GlassCard
              className={`ether-editor-card p-8 max-[640px]:p-6 ${
                isEtherDissolve ? 'ether-dissolve-bottle' : ''
              }`}
              glowEffect={false}
              style={{ '--ether-action-collapse-height': `${actionBarHeight}px` } as React.CSSProperties}
            >
            <div className="zen-glow-layer" />
            <div
              className={`mb-5 text-[0.625rem] uppercase tracking-[0.2em] text-[var(--color-muted)] transition-opacity duration-[1200ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${
                isEtherDissolve ? 'opacity-75' : 'opacity-100'
              }`}
              style={{ fontFamily: 'var(--font-control)' }}
            >
              {isAppendMode && appendJournal?.title
                ? t('continueWritingBanner', { title: appendJournal.title })
                : t('newThreadLabel')}
            </div>
            {/* Editor — always visible, no grid collapse */}
            <SimpleEditor
              content={draft.content}
              onChange={handleDraftContentChange}
              placeholder={t('quickWritePlaceholder')}
              minHeight="var(--write-editor-min-height)"
              showToolbar={false}
              onFocus={handleEditorFocus}
              etherDissolve={isEtherDissolve}
            />

            {isEtherDissolve && !showMetadata && !showAttachments && (
              <div
                aria-hidden="true"
                className="h-6 cursor-default"
                data-testid="zen-drawer-wake-zone"
                onClick={wakeZenChrome}
                onPointerDown={wakeZenChrome}
                onPointerEnter={wakeZenChrome}
              />
            )}

            {/* Action Bar — dissolves in zen, then returns while a drawer is open */}
            <div className={`grid ether-action-bar ${
              actionBarCollapsed
                ? 'grid-rows-[0fr] opacity-0 pointer-events-none'
                : 'grid-rows-[1fr] opacity-100'
            }`}>
              <div ref={actionBarContentRef} className="min-h-0 overflow-hidden">
                <div className="flex items-center justify-between border-t border-[var(--color-white-6)] pt-6 mt-6">
                  <div className="flex items-center gap-4">
                    {/* Metadata toggle */}
                    <button
                      type="button"
                      onClick={toggleMetadata}
                      aria-label={showMetadata ? t('collapse') : t('metadataToggle')}
                      aria-expanded={showMetadata}
                      className="flex items-center justify-center gap-2 px-4 py-2 rounded-full text-xs max-sm:h-12 max-sm:w-12 max-sm:px-0 max-sm:py-0 max-sm:text-[0.8rem] text-[var(--color-muted)] bg-transparent border border-white/[0.08] uppercase tracking-[0.08em] cursor-pointer hover:bg-[var(--color-ether-surface-ghost)]"
                      style={{ fontFamily: 'var(--font-control)' }}
                    >
                      <span className="material-symbols-outlined text-base max-sm:text-[1.0rem]">tune</span>
                      <span className="max-sm:sr-only">{showMetadata ? t('collapse') : t('metadataToggle')}</span>
                    </button>

                    {/* Attachment toggle */}
                    <button
                      type="button"
                      onClick={toggleAttachments}
                      aria-label={showAttachments ? t('collapse') : t('attachments')}
                      aria-expanded={showAttachments}
                      className="flex items-center justify-center gap-2 px-4 py-2 rounded-full text-xs max-sm:h-12 max-sm:w-12 max-sm:px-0 max-sm:py-0 max-sm:text-[0.8rem] text-[var(--color-muted)] bg-transparent border border-white/[0.08] uppercase tracking-[0.08em] cursor-pointer hover:bg-[var(--color-ether-surface-ghost)]"
                      style={{ fontFamily: 'var(--font-control)' }}
                    >
                      <span className="material-symbols-outlined text-base max-sm:text-[1.0rem]">attach_file</span>
                      <span className="max-sm:sr-only">{showAttachments ? t('collapse') : t('attachments')}</span>
                    </button>
                  </div>

                  {/* Save Button */}
                  <motion.button
                    type="button"
                    onClick={handleSave}
                    aria-label={t('castToSea')}
                    disabled={
                      isAppendMode
                        ? !draft.content.trim()
                        : !draft.metadata.title?.trim() && !draft.content.trim()
                    }
                    className="flex items-center justify-center gap-2 px-8 py-3 rounded-full font-medium text-sm max-sm:h-12 max-sm:w-14 max-sm:px-0 max-sm:py-0 max-sm:text-[0.8rem] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      background: 'transparent',
                      color: 'var(--color-gold)',
                      border: '1px solid rgba(255, 231, 146, 0.3)',
                      fontFamily: 'var(--font-control)',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                    }}
                    whileHover={{
                      backgroundColor: 'rgba(255, 231, 146, 0.08)',
                      borderColor: 'rgba(255, 231, 146, 0.5)',
                    }}
                    transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                  >
                    <span className="max-sm:sr-only">{t('castToSea')}</span>
                    <span className="material-symbols-outlined text-lg">send</span>
                  </motion.button>
                </div>

                {/* Save Error Banner */}
                {saveError && (
                  <div className="mt-3 text-sm text-[var(--color-coral)]" aria-live="polite">
                    {saveError}
                  </div>
                )}
              </div>
            </div>
            </GlassCard>
          </div>
        </div>

        {/* Metadata Sidebar — drawer animation */}
        <AnimatePresence>
          {showMetadata && (
            <motion.div
              className="write-drawer-slot"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.8, ease: [0.23, 1, 0.32, 1] }}
            >
              <MetadataSidebar
                metadata={draft.metadata}
                draftContent={draft.content}
                onUpdate={handleMetadataUpdate}
                smartCapabilityAvailable={smartCapabilityAvailable}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Attachment Panel — drawer animation */}
        <AnimatePresence>
          {showAttachments && (
            <motion.div
              className="write-drawer-slot"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.8, ease: [0.23, 1, 0.32, 1] }}
            >
              <GlassCard className="p-6 no-hover" hoverable={false} glowEffect={false}>
                <h3 className="text-base font-semibold text-[var(--color-primary)] mb-5">{t('attachments')}</h3>
                <div className="space-y-4">
                  <input
                    type="file"
                    multiple
                    aria-label={t('uploadAttachment')}
                    onChange={(e) => {
                      const files = e.target.files;
                      if (files && files.length > 0) {
                        const newFiles = Array.from(files);
                        setAttachments(prev => {
                          const nextFiles = [...prev, ...newFiles];
                          void saveJournalDraftAttachments(draftScope, nextFiles);
                          return nextFiles;
                        });
                      }
                    }}
                    className="w-full px-4 py-2.5 bg-[var(--color-ether-surface-ghost)] border border-white/[0.06] rounded-xl text-[var(--color-primary)] text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-medium file:bg-[var(--color-gold)]/20 file:text-[var(--color-gold)] hover:file:bg-[var(--color-gold)]/30"
                  />
                  
                  {/* Attachment list */}
                  {attachments.length > 0 && (
                    <div className="space-y-2">
                      {attachments.map((file, index) => (
                        <div key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center justify-between px-3 py-2 bg-[var(--color-ether-surface-ghost)] rounded-lg">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="material-symbols-outlined text-sm text-[var(--color-muted)]">insert_drive_file</span>
                            <span className="text-sm text-[var(--color-primary)] truncate">{file.name}</span>
                            <span className="text-xs text-[var(--color-secondary)]">({(file.size / 1024).toFixed(1)} KB)</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAttachments(prev => {
                              const nextFiles = prev.filter((_, i) => i !== index);
                              void saveJournalDraftAttachments(draftScope, nextFiles);
                              return nextFiles;
                            })}
                            className="text-[var(--color-muted)] hover:text-[var(--color-coral)] transition-colors ml-2"
                            title={t('delete')}
                            aria-label={t('deleteAttachment')}
                          >
                            <span className="material-symbols-outlined text-base">close</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {attachments.length === 0 && (
                    <p className="text-xs text-[var(--color-secondary)]">{t('uploadHint')}</p>
                  )}
                </div>
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}
