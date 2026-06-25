import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { GlassCard } from '@/components/celestial/GlassCard';
import { JournalMetadataPanel } from '@/components/journal/JournalMetadataPanel';
import { RelatedJournals } from '@/components/journal/RelatedJournals';
import { useTranslation } from '@/hooks/useTranslation';
import { useJournal } from '@/hooks/useJournals';
import { PageLoader } from '@/components/celestial/CelestialLoader';
import { getTopicName } from '@/lib/formatters';
import { attachmentUrl } from '@/lib/attachments';
import { MarkdownRenderer } from '@/components/journal/MarkdownRenderer';

function isImageAttachment(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('image/');
}

function isVideoAttachment(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('video/');
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

/**
 * JournalDetail - 日志详情（展卷页）
 * Magazine-style reading layout with ceremonial entrance animation,
 * scroll progress, reading time estimate, and scroll-to-top.
 */
export default function JournalDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams();
  const id = params['*'] ?? '';
  const { data: journal, isLoading, error, refetch } = useJournal(id);
  const contentRef = useRef<HTMLDivElement>(null);

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
              {/* Title header */}
              <div className="mb-8">
                <div className="flex items-start justify-between gap-4">
                  <h1 className="text-[1.75rem] font-normal tracking-[0.06em] text-[var(--color-primary)] mb-5 leading-[1.35] flex-1" style={{ fontFamily: 'var(--font-divine)' }}>
                    {journal.title}
                  </h1>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <motion.button
                      type="button"
                      aria-label={t('continueWriting')}
                      onClick={() => navigate(`/?append=${encodeURIComponent(id)}`)}
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
                      onClick={() => navigate(`/?edit=${encodeURIComponent(id)}`)}
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
                  {journal.date && (
                    <div className="flex flex-col items-center gap-0.5 pr-5 border-r border-white/[0.08]">
                      <span className="text-[0.6875rem] tracking-[0.12em] uppercase" style={{ color: 'var(--color-gold)', fontFamily: 'var(--font-order)' }}>
                        {new Date(journal.date).toLocaleString('en', { month: 'short' }).toUpperCase()}
                      </span>
                      <span className="text-[1.75rem] font-light leading-none" style={{ fontFamily: 'var(--font-divine)', color: 'var(--color-primary)' }}>
                        {String(new Date(journal.date).getDate()).padStart(2, '0')}
                      </span>
                      <span className="text-[0.625rem] tracking-wider" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-order)' }}>
                        {new Date(journal.date).getFullYear()}
                      </span>
                    </div>
                  )}

                  {/* Meta row — location · weather */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2.5 flex-wrap text-[0.8125rem]" style={{ color: 'var(--color-secondary)' }}>
                      {journal.location && (
                        <span className="flex items-center gap-1">
                          <span className="material-symbols-outlined text-[0.875rem]">location_on</span>
                          <span>{journal.location}</span>
                        </span>
                      )}
                      {journal.weather && (
                        <>
                          <span style={{ color: 'var(--color-muted)', fontSize: '0.625rem' }}>·</span>
                          <span className="flex items-center gap-1">
                            <span className="material-symbols-outlined text-[0.875rem]">cloud</span>
                            <span>{journal.weather}</span>
                          </span>
                        </>
                      )}
                    </div>

                    {/* Moods | Tags */}
                    {(journal.moods.length > 0 || journal.topics.length > 0) && (
                      <div className="flex items-center gap-2 flex-wrap text-[0.8125rem]">
                        {journal.moods.length > 0 && (
                          <span className="flex items-center gap-1" style={{ color: 'var(--color-secondary)' }}>
                            <span className="material-symbols-outlined text-[0.875rem]">mood</span>
                            <span>{journal.moods.join(' · ')}</span>
                          </span>
                        )}
                        {journal.moods.length > 0 && journal.topics.length > 0 && (
                          <span style={{ color: 'var(--color-muted)' }}>|</span>
                        )}
                        {journal.topics.length > 0 && (
                          <div className="flex items-center gap-3 flex-wrap">
                            {journal.topics.map((topic) => (
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
                  <MarkdownRenderer content={journal.content} />
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* Attachments */}
          {journal.attachments.length > 0 && (
            <motion.div variants={itemVariants}>
              <GlassCard className="p-6 max-[640px]:p-4" hoverable={false} glowEffect={false}>
                <h2 className="text-base font-semibold text-[var(--color-primary)] mb-4">
                  {t('attachments')}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {journal.attachments.map((attachment) => {
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
            </motion.div>
          )}

          {/* Metadata Panel */}
          <motion.div variants={itemVariants}>
            <JournalMetadataPanel metadata={{
              date: journal.date,
              topics: journal.topics,
              moods: journal.moods,
              people: journal.people,
              location: journal.location ?? '',
              weather: journal.weather ?? '',
              project: journal.project ?? '',
              links: journal.links ?? [],
              wordCount: journal.wordCount,
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
