import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { journalAPI, type HostAgentQueryResponse, type JournalAttachment } from '@/lib/api-client';
import { attachmentUrl } from '@/lib/attachments';
import { diagnoseMediaLoadFailure, type MediaLoadDiagnostic } from '@/lib/media-diagnostics';
import { MarkdownRenderer } from '@/components/journal/MarkdownRenderer';
import { useTranslation } from '@/hooks/useTranslation';

export interface HostAgentAnswerPanelProps {
  response: HostAgentQueryResponse;
  onContinueSearch?: (query: string) => void;
}

type BadgeTone = 'positive' | 'warning' | 'neutral' | 'disabled';
type EvidenceItem = HostAgentQueryResponse['evidence'][number];
type MediaAttachment = JournalAttachment & { kind: 'image' | 'video' };
type LightboxDiagnostic = MediaLoadDiagnostic | { layer: 'checking'; status: null; url: string };

const MODE_TONES: Record<string, BadgeTone> = {
  GROUNDED: 'positive',
  PARTIAL: 'warning',
  SCAFFOLD: 'neutral',
  UNGROUNDED: 'warning',
  UNAVAILABLE: 'disabled',
};

function toneForMode(mode: string): BadgeTone {
  return MODE_TONES[mode] ?? 'neutral';
}

function journalIdFromEvidenceId(id: string): string {
  return id.trim().replace(/^Journals\//i, '').replace(/\.md$/i, '');
}

function evidenceHref(id: string): string | null {
  const trimmed = journalIdFromEvidenceId(id);
  return trimmed ? `/journal/${trimmed}` : null;
}

function formatEvidenceDate(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return date;
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

function entryOrdinal(id: string): string | null {
  const match = id.match(/_(\d{3})(?:\.md)?$/);
  if (!match) return null;
  return `当日第${Number(match[1])}篇`;
}

function evidenceLabel(item: EvidenceItem): string {
  const ordinal = entryOrdinal(item.id);
  const prefix = [
    formatEvidenceDate(item.date),
    ordinal,
  ].filter(Boolean).join(' · ');
  return prefix ? `${prefix} ·《${item.title}》` : `《${item.title}》`;
}

function evidenceExcerpt(item: EvidenceItem): string {
  const extras = item as Record<string, unknown>;
  return String(item.snippet || extras.excerpt || '').trim();
}

function isImageAttachment(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('image/');
}

function isVideoAttachment(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('video/');
}

function mediaAttachmentKind(attachment: JournalAttachment): MediaAttachment['kind'] | null {
  if (isImageAttachment(attachment.contentType)) return 'image';
  if (isVideoAttachment(attachment.contentType)) return 'video';
  return null;
}

function splitWorkSummary(summary: string): string[] {
  return summary
    .split('·')
    .map((part) => part.trim())
    .filter(Boolean);
}

function sectionAnimationStyle(index: number): CSSProperties {
  return { '--host-agent-section-index': index } as CSSProperties;
}

function scrollToAnswerStart(panel: HTMLElement) {
  const scrollPane = panel.closest('.recall-scroll-pane');
  if (scrollPane instanceof HTMLElement && typeof scrollPane.scrollTo === 'function') {
    const paneRect = scrollPane.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const top = Math.max(0, scrollPane.scrollTop + panelRect.top - paneRect.top);
    scrollPane.scrollTo({ top, behavior: 'smooth' });
    return;
  }

  panel.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

function diagnosticTextKey(layer: LightboxDiagnostic['layer']): string {
  switch (layer) {
    case 'checking':
      return 'hostAgentMediaDiagnosticChecking';
    case 'backend':
      return 'hostAgentMediaDiagnosticBackend';
    case 'tunnel':
      return 'hostAgentMediaDiagnosticTunnel';
    case 'browser':
      return 'hostAgentMediaDiagnosticBrowser';
    case 'network':
      return 'hostAgentMediaDiagnosticNetwork';
    case 'http':
      return 'hostAgentMediaDiagnosticHttp';
    case 'unknown':
      return 'hostAgentMediaDiagnosticUnknown';
    default:
      return 'hostAgentMediaDiagnosticUnknown';
  }
}

function toneStyle(tone: BadgeTone): CSSProperties {
  switch (tone) {
    case 'positive':
      return {
        color: 'var(--color-cyan)',
        borderColor: 'rgba(133,255,242,0.35)',
        background: 'rgba(133,255,242,0.08)',
      };
    case 'warning':
      return {
        color: 'var(--color-gold)',
        borderColor: 'rgba(255,231,146,0.35)',
        background: 'rgba(255,231,146,0.08)',
      };
    case 'disabled':
      return {
        color: 'var(--color-muted)',
        borderColor: 'rgba(255,255,255,0.1)',
        background: 'var(--color-ether-surface-ghost)',
      };
    case 'neutral':
      return {
        color: 'var(--color-secondary)',
        borderColor: 'rgba(255,255,255,0.12)',
        background: 'var(--color-ether-surface-ghost)',
      };
  }
}

export function HostAgentAnswerPanel({ response, onContinueSearch }: HostAgentAnswerPanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLElement | null>(null);
  const [mediaByEvidenceId, setMediaByEvidenceId] = useState<Record<string, MediaAttachment[]>>({});
  const [lightboxAttachment, setLightboxAttachment] = useState<MediaAttachment | null>(null);
  const [lightboxLoaded, setLightboxLoaded] = useState(false);
  const [lightboxError, setLightboxError] = useState(false);
  const [lightboxRetryKey, setLightboxRetryKey] = useState(0);
  const [lightboxUseOriginal, setLightboxUseOriginal] = useState(false);
  const [lightboxDiagnostic, setLightboxDiagnostic] = useState<LightboxDiagnostic | null>(null);
  const [failedThumbnailPaths, setFailedThumbnailPaths] = useState<Set<string>>(() => new Set());
  const mode = response.mode || response.answer?.mode || 'UNKNOWN';
  const reason = response.reason || response.answer?.reason || '';
  const summary = response.answer?.summary || '';
  const insights = response.answer?.insights ?? [];
  const answerExtras = (response.answer ?? {}) as Record<string, unknown>;
  const workSummary = typeof answerExtras.work_summary === 'string'
    ? answerExtras.work_summary
    : '';
  const workSummaryStats = workSummary ? splitWorkSummary(workSummary) : [];
  const suggestions = response.answer?.suggestions ?? [];
  const tone = toneForMode(mode);
  const evidenceIds = useMemo(
    () => response.evidence.map((item) => item.id).filter(Boolean).join('|'),
    [response.evidence],
  );

  useEffect(() => {
    const scrollToAnswer = () => {
      const panel = panelRef.current;
      if (panel) scrollToAnswerStart(panel);
    };

    if (typeof requestAnimationFrame !== 'function') {
      const timeoutId = window.setTimeout(scrollToAnswer, 0);
      return () => window.clearTimeout(timeoutId);
    }

    let nestedRafId = 0;
    let timeoutId: number | undefined;
    const rafId = requestAnimationFrame(() => {
      nestedRafId = requestAnimationFrame(() => {
        scrollToAnswer();
        timeoutId = window.setTimeout(scrollToAnswer, 120);
      });
    });
    return () => {
      cancelAnimationFrame(rafId);
      if (nestedRafId) cancelAnimationFrame(nestedRafId);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [response.conversation_id, response.mode, response.query, response.reason, response.request_id]);

  useEffect(() => {
    let active = true;

    async function loadMedia() {
      const next: Record<string, MediaAttachment[]> = {};
      const uniqueEvidence = Array.from(
        new Map(response.evidence.map((item) => [item.id, item])).values(),
      );

      await Promise.all(uniqueEvidence.map(async (item) => {
        const journalId = journalIdFromEvidenceId(item.id);
        if (!journalId) return;

        try {
          const journal = await journalAPI.getById(journalId);
          const media = journal.attachments
            .map((attachment) => {
              const kind = mediaAttachmentKind(attachment);
              return kind ? { ...attachment, kind } : null;
            })
            .filter((attachment): attachment is MediaAttachment => attachment != null);
          if (media.length > 0) {
            next[item.id] = media;
          }
        } catch {
          // Media enrichment is best-effort; cited text remains the authority.
        }
      }));

      if (active) {
        setMediaByEvidenceId((current) => {
          if (Object.keys(next).length > 0) return next;
          return Object.keys(current).length > 0 ? {} : current;
        });
      }
    }

    if (response.evidence.length === 0) {
      setMediaByEvidenceId((current) => (Object.keys(current).length > 0 ? {} : current));
      return undefined;
    }

    void loadMedia();

    return () => {
      active = false;
    };
  }, [evidenceIds, response.evidence]);

  useEffect(() => {
    setFailedThumbnailPaths(new Set());
  }, [evidenceIds]);

  useEffect(() => {
    if (!lightboxAttachment) return undefined;
    setLightboxLoaded(false);
    setLightboxError(false);
    setLightboxDiagnostic(null);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [lightboxAttachment]);

  const openLightbox = (attachment: MediaAttachment) => {
    setLightboxLoaded(false);
    setLightboxError(false);
    setLightboxRetryKey(0);
    setLightboxUseOriginal(false);
    setLightboxDiagnostic(null);
    setLightboxAttachment(attachment);
  };

  const closeLightbox = () => {
    setLightboxAttachment(null);
    setLightboxLoaded(false);
    setLightboxError(false);
    setLightboxUseOriginal(false);
    setLightboxDiagnostic(null);
  };

  const handleLightboxMediaError = () => {
    setLightboxLoaded(false);
    setLightboxError(true);
    const failedUrl = lightboxMediaUrl;
    setLightboxDiagnostic({ layer: 'checking', status: null, url: failedUrl });
    void diagnoseMediaLoadFailure(failedUrl).then((diagnostic) => {
      setLightboxDiagnostic((current) => (current?.url === failedUrl ? diagnostic : current));
    });
  };

  const retryLightboxMedia = () => {
    setLightboxLoaded(false);
    setLightboxError(false);
    setLightboxDiagnostic(null);
    setLightboxRetryKey((key) => key + 1);
  };

  const showOriginalLightboxImage = () => {
    setLightboxLoaded(false);
    setLightboxError(false);
    setLightboxDiagnostic(null);
    setLightboxUseOriginal(true);
  };

  const markThumbnailFailed = (relPath: string) => {
    setFailedThumbnailPaths((current) => {
      const next = new Set(current);
      next.add(relPath);
      return next;
    });
  };

  const lightboxDownloadUrl = lightboxAttachment ? attachmentUrl(lightboxAttachment.relPath) : '';
  const lightboxMediaUrl = lightboxAttachment?.kind === 'image' && !lightboxUseOriginal
    ? attachmentUrl(lightboxAttachment.relPath, { variant: 'preview', maxPx: 1400 })
    : lightboxDownloadUrl;
  const lightboxErrorTitle = lightboxAttachment?.kind === 'image' && !lightboxUseOriginal
    ? t('hostAgentMediaPreviewFailed')
    : t('hostAgentMediaLoadFailed');

  const lightbox = lightboxAttachment && typeof document !== 'undefined'
    ? createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label={lightboxAttachment.filename}
        className="fixed inset-0 z-[9999] flex min-h-dvh items-center justify-center bg-black/85 p-3 sm:p-5"
        data-testid="host-agent-media-lightbox"
        onClick={closeLightbox}
      >
        <div
          className="flex max-h-[92dvh] w-full max-w-[94vw] flex-col items-center sm:max-w-[720px]"
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className="relative flex min-h-[240px] w-full items-center justify-center sm:min-h-[320px]"
            data-testid="host-agent-media-lightbox-frame"
          >
            {!lightboxLoaded && !lightboxError && (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-black/45 text-xs text-[var(--color-primary)]"
                data-testid="host-agent-media-loading"
                style={{ fontFamily: 'var(--font-order)' }}
              >
                {t('hostAgentMediaLoading')}
              </div>
            )}
            {lightboxError && (
              <div
                className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/60 px-5 text-center text-xs text-[var(--color-primary)]"
                data-testid="host-agent-media-error"
                style={{ fontFamily: 'var(--font-order)' }}
              >
                <span className="text-[0.84rem] text-[var(--color-primary)]">{lightboxErrorTitle}</span>
                {lightboxDiagnostic && (
                  <>
                    <span className="max-w-[min(78vw,520px)] text-[var(--color-muted)]">
                      {t(diagnosticTextKey(lightboxDiagnostic.layer), {
                        status: lightboxDiagnostic.status ?? '',
                      })}
                    </span>
                    <span
                      className="max-w-[min(78vw,520px)] truncate text-[0.65rem] text-[var(--color-secondary)]"
                      data-testid="host-agent-media-diagnostic-url"
                    >
                      {t('hostAgentMediaDiagnosticUrl', { url: lightboxDiagnostic.url })}
                    </span>
                  </>
                )}
                <button
                  type="button"
                  className="rounded-full border border-[var(--color-cyan)]/35 px-3 py-1 text-[var(--color-cyan)]"
                  aria-label={t('hostAgentMediaRetryAria')}
                  onClick={retryLightboxMedia}
                >
                  {t('hostAgentMediaRetry')}
                </button>
              </div>
            )}
            {lightboxAttachment.kind === 'image' ? (
              <img
                key={`image-${lightboxUseOriginal ? 'original' : 'preview'}-${lightboxRetryKey}`}
                src={lightboxMediaUrl}
                alt={lightboxAttachment.filename}
                data-testid="host-agent-media-lightbox-image"
                loading="eager"
                onLoad={() => setLightboxLoaded(true)}
                onError={handleLightboxMediaError}
                className={`max-h-[84dvh] max-w-full rounded-xl object-contain transition-opacity duration-200 ${lightboxLoaded ? 'opacity-100' : 'opacity-0'}`}
              />
            ) : (
              <video
                key={`video-${lightboxRetryKey}`}
                controls
                autoPlay
                playsInline
                preload="metadata"
                data-testid="host-agent-media-lightbox-video"
                onLoadedData={() => setLightboxLoaded(true)}
                onError={handleLightboxMediaError}
                className={`max-h-[84dvh] max-w-full rounded-xl bg-black transition-opacity duration-200 ${lightboxLoaded ? 'opacity-100' : 'opacity-0'}`}
              >
                <source src={lightboxDownloadUrl} type={lightboxAttachment.contentType} />
              </video>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {lightboxAttachment.kind === 'image' && !lightboxUseOriginal && (
              <button
                type="button"
                aria-label={t('hostAgentMediaViewOriginalAria', { filename: lightboxAttachment.filename })}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-gold)]/30 bg-[var(--color-gold)]/10 px-3 py-2 text-xs text-[var(--color-primary)] shadow-[0_0_22px_rgba(245,214,122,0.10)] transition-colors hover:border-[var(--color-gold)]/55 hover:bg-[var(--color-gold)]/15"
                onClick={showOriginalLightboxImage}
              >
                <span className="material-symbols-outlined text-[1rem] leading-none">open_in_full</span>
                <span>{t('hostAgentMediaViewOriginal')}</span>
              </button>
            )}
            <a
              href={lightboxDownloadUrl}
              download={lightboxAttachment.filename}
              aria-label={t('hostAgentMediaDownloadAria', { filename: lightboxAttachment.filename })}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-cyan)]/35 bg-[var(--color-cyan)]/10 px-3 py-2 text-xs text-[var(--color-cyan)] shadow-[0_0_22px_rgba(106,255,246,0.10)] transition-colors hover:border-[var(--color-cyan)]/60 hover:bg-[var(--color-cyan)]/15"
            >
              <span className="material-symbols-outlined text-[1rem] leading-none">download</span>
              <span>{t('hostAgentMediaDownload')}</span>
            </a>
            <button
              type="button"
              className="rounded-full border border-white/[0.14] bg-black/40 px-4 py-2 text-xs text-[var(--color-primary)] transition-colors hover:border-white/[0.24] hover:bg-white/[0.06]"
              onClick={closeLightbox}
            >
              {t('hostAgentMediaClose')}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )
    : null;

  return (
    <section
      ref={panelRef}
      className="host-agent-answer-panel--animated rounded-2xl p-4"
      data-testid="host-agent-answer-panel"
      style={{
        background: 'var(--color-ether-panel)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center rounded-full border px-2.5 py-1 text-[0.72rem]"
          data-testid="host-agent-mode-badge"
          data-tone={tone}
          style={{
            ...toneStyle(tone),
            fontFamily: 'var(--font-order)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {mode}
        </span>
        {reason && (
          <span
            className="text-xs"
            data-testid="host-agent-reason"
            style={{ color: 'var(--color-secondary)', fontFamily: 'var(--font-order)' }}
          >
            {reason}
          </span>
        )}
      </div>

      <section
        className="host-agent-answer-section mb-4"
        data-testid="host-agent-work-summary"
        style={sectionAnimationStyle(0)}
      >
        <h4 className="mb-2 text-sm text-[var(--color-primary)]" style={{ fontFamily: 'var(--font-control)' }}>
          搜索工作简述
        </h4>
        {workSummary ? (
          <div className="flex flex-wrap gap-2">
            {workSummaryStats.map((stat) => (
              <span
                key={stat}
                className="rounded-full border border-white/[0.08] bg-[var(--color-ether-surface-ghost)] px-3 py-1 text-xs text-[var(--color-secondary)]"
                data-testid="host-agent-work-summary-stat"
                style={{ fontFamily: 'var(--font-order)' }}
              >
                {stat}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--color-muted)]" style={{ fontFamily: 'var(--font-order)' }}>
            宿主 agent 未提供搜索工作简述。
          </p>
        )}
      </section>

      <section
        className="host-agent-answer-section mb-4"
        data-testid="host-agent-cited-journals"
        style={sectionAnimationStyle(1)}
      >
        <h4 className="mb-2 text-sm text-[var(--color-primary)]" style={{ fontFamily: 'var(--font-control)' }}>
          引用日志
        </h4>
        {response.evidence.length > 0 ? (
          <ul className="space-y-3">
            {response.evidence.map((item) => {
              const href = evidenceHref(item.id);
              const excerpt = evidenceExcerpt(item);
              const media = mediaByEvidenceId[item.id] ?? [];
              return (
                <li key={item.id || item.title}>
                  {href ? (
                    <a className="text-sm text-[var(--color-cyan)]" href={href} aria-label={item.title}>
                      {evidenceLabel(item)}
                    </a>
                  ) : (
                    <span className="text-sm text-[var(--color-primary)]">{evidenceLabel(item)}</span>
                  )}
                  {excerpt && (
                    <blockquote
                      className="mt-2 rounded-r-lg border-l-4 border-[var(--color-gold)] bg-[var(--color-ether-surface-ghost)] px-4 py-2 text-sm italic text-[var(--color-muted)]"
                      data-testid="host-agent-evidence-excerpt"
                    >
                      {excerpt}
                    </blockquote>
                  )}
                  {media.length > 0 && (
                    <div
                      className="mt-2 flex flex-wrap gap-2"
                      data-testid="host-agent-evidence-media"
                    >
                      {media.map((attachment) => {
                        const thumbnailUrl = attachment.kind === 'image'
                          ? attachmentUrl(attachment.relPath, { variant: 'thumbnail', maxPx: 160 })
                          : null;
                        const thumbnailFailed = failedThumbnailPaths.has(attachment.relPath);
                        return (
                          <button
                            key={attachment.relPath}
                            type="button"
                            aria-label={t('hostAgentOpenAttachment', { filename: attachment.filename })}
                            onClick={() => openLightbox(attachment)}
                            className="relative h-[62px] w-[62px] overflow-hidden rounded-lg border border-white/[0.08] bg-[var(--color-ether-surface-ghost)] text-[var(--color-primary)] transition-colors hover:border-[var(--color-cyan)]/40"
                          >
                            {thumbnailUrl && !thumbnailFailed ? (
                              <img
                                src={thumbnailUrl}
                                alt={attachment.filename}
                                loading="lazy"
                                onError={() => markThumbnailFailed(attachment.relPath)}
                                className="h-full w-full object-cover"
                              />
                            ) : thumbnailFailed ? (
                              <span
                                className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/25 px-1 text-center text-[0.62rem] leading-tight text-[var(--color-muted)]"
                                data-testid="host-agent-evidence-image-fallback"
                                style={{ fontFamily: 'var(--font-order)' }}
                              >
                                <span className="material-symbols-outlined text-base text-[var(--color-gold)]/80">
                                  broken_image
                                </span>
                                <span>{t('hostAgentMediaImageUnavailable')}</span>
                              </span>
                            ) : (
                              <>
                                <span
                                  className="absolute inset-0 flex items-center justify-center bg-black/20"
                                  data-testid="host-agent-evidence-video-thumbnail"
                                >
                                  <span className="material-symbols-outlined text-2xl text-[var(--color-cyan)]">
                                    play_circle
                                  </span>
                                </span>
                              </>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p
            className="text-xs"
            data-testid="host-agent-evidence-empty"
            style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-order)' }}
          >
            No cited evidence
          </p>
        )}
      </section>

      <section
        className="host-agent-answer-section mb-4"
        data-testid="host-agent-summary-advice"
        style={sectionAnimationStyle(2)}
      >
        <h4 className="mb-2 text-sm text-[var(--color-primary)]" style={{ fontFamily: 'var(--font-control)' }}>
          总结归纳·建议
        </h4>
        {summary ? (
          <div data-testid="host-agent-answer">
            <MarkdownRenderer content={summary} />
          </div>
        ) : (
          <p
            className="text-xs"
            data-testid="host-agent-answer"
            style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-order)' }}
          >
            宿主 agent 未提供总结建议。
          </p>
        )}

        {insights.length > 0 && (
          <div className={summary ? 'mt-4' : 'mt-3'} data-testid="host-agent-insights">
            <ul className="space-y-3">
              {insights.map((insight, index) => (
                <li key={`${insight.theme ?? 'insight'}-${index}`}>
                  {insight.theme && (
                    <p
                      className="mb-1 text-sm"
                      style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-control)' }}
                    >
                      {insight.theme}
                    </p>
                  )}
                  {insight.interpretation && (
                    <p
                      className="text-sm leading-relaxed"
                      style={{ color: 'var(--color-secondary)', fontFamily: 'var(--font-narrative)' }}
                    >
                      {insight.interpretation}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section
        className="host-agent-answer-section mt-4"
        data-testid="host-agent-related-extensions"
        style={sectionAnimationStyle(3)}
      >
        <h4 className="mb-2 text-sm text-[var(--color-primary)]" style={{ fontFamily: 'var(--font-control)' }}>
          相关话题延展
        </h4>
        {suggestions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onContinueSearch?.(suggestion)}
                className="rounded-full border border-[var(--color-cyan)]/25 px-3 py-1.5 text-xs text-[var(--color-cyan)] hover:border-[var(--color-cyan)]/45"
                style={{ fontFamily: 'var(--font-control)' }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--color-muted)]" style={{ fontFamily: 'var(--font-order)' }}>
            宿主 agent 未提供相关延展。
          </p>
        )}
      </section>

      {!summary && insights.length === 0 && response.evidence.length === 0 && (
        <p
          className="text-xs"
          data-testid="host-agent-evidence-empty"
          style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-order)' }}
        >
          No cited evidence
        </p>
      )}

      {lightbox}
    </section>
  );
}
