import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { JournalAttachment } from '@/lib/api-client';
import { attachmentUrl } from '@/lib/attachments';
import { diagnoseMediaLoadFailure, type MediaLoadDiagnostic } from '@/lib/media-diagnostics';
import { useTranslation } from '@/hooks/useTranslation';

export type MediaLightboxAttachment = JournalAttachment & {
  kind: 'image' | 'video';
};

export interface MediaLightboxProps {
  attachment: MediaLightboxAttachment | null;
  onClose: () => void;
}

type LightboxDiagnostic = MediaLoadDiagnostic | {
  layer: 'checking';
  status: null;
  url: string;
};

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
    default:
      return 'hostAgentMediaDiagnosticUnknown';
  }
}

export function MediaLightbox({ attachment, onClose }: MediaLightboxProps) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [useOriginal, setUseOriginal] = useState(false);
  const [diagnostic, setDiagnostic] = useState<LightboxDiagnostic | null>(null);

  useEffect(() => {
    if (!attachment) return;
    setLoaded(false);
    setError(false);
    setRetryKey(0);
    setUseOriginal(false);
    setDiagnostic(null);
  }, [attachment]);

  useEffect(() => {
    if (!attachment) return undefined;

    const originalOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [attachment, onClose]);

  if (!attachment || typeof document === 'undefined') return null;

  const downloadUrl = attachmentUrl(attachment.relPath);
  const mediaUrl = attachment.kind === 'image' && !useOriginal
    ? attachmentUrl(attachment.relPath, { variant: 'preview', maxPx: 1400 })
    : downloadUrl;
  const errorTitle = attachment.kind === 'image' && !useOriginal
    ? t('hostAgentMediaPreviewFailed')
    : t('hostAgentMediaLoadFailed');

  const handleMediaError = () => {
    setLoaded(false);
    setError(true);
    const failedUrl = mediaUrl;
    setDiagnostic({ layer: 'checking', status: null, url: failedUrl });
    void diagnoseMediaLoadFailure(failedUrl).then((nextDiagnostic) => {
      setDiagnostic((current) => (current?.url === failedUrl ? nextDiagnostic : current));
    });
  };

  const retryMedia = () => {
    setLoaded(false);
    setError(false);
    setDiagnostic(null);
    setRetryKey((key) => key + 1);
  };

  const showOriginalImage = () => {
    setLoaded(false);
    setError(false);
    setDiagnostic(null);
    setUseOriginal(true);
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={attachment.filename}
      className="fixed inset-0 z-[9999] flex min-h-dvh items-center justify-center bg-black/85 p-3 sm:p-5"
      data-testid="host-agent-media-lightbox"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-[94vw] flex-col items-center sm:max-w-[720px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="relative flex min-h-[240px] w-full items-center justify-center sm:min-h-[320px]"
          data-testid="host-agent-media-lightbox-frame"
        >
          {!loaded && !error && (
            <div
              className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-black/45 text-xs text-[var(--color-primary)]"
              data-testid="host-agent-media-loading"
              style={{ fontFamily: 'var(--font-order)' }}
            >
              {t('hostAgentMediaLoading')}
            </div>
          )}
          {error && (
            <div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/60 px-5 text-center text-xs text-[var(--color-primary)]"
              data-testid="host-agent-media-error"
              style={{ fontFamily: 'var(--font-order)' }}
            >
              <span className="text-[0.84rem] text-[var(--color-primary)]">{errorTitle}</span>
              {diagnostic && (
                <>
                  <span className="max-w-[min(78vw,520px)] text-[var(--color-muted)]">
                    {t(diagnosticTextKey(diagnostic.layer), {
                      status: diagnostic.status ?? '',
                    })}
                  </span>
                  <span
                    className="max-w-[min(78vw,520px)] truncate text-[0.65rem] text-[var(--color-secondary)]"
                    data-testid="host-agent-media-diagnostic-url"
                  >
                    {t('hostAgentMediaDiagnosticUrl', { url: diagnostic.url })}
                  </span>
                </>
              )}
              <button
                type="button"
                className="rounded-full border border-[var(--color-cyan)]/35 px-3 py-1 text-[var(--color-cyan)]"
                aria-label={t('hostAgentMediaRetryAria')}
                onClick={retryMedia}
              >
                {t('hostAgentMediaRetry')}
              </button>
            </div>
          )}
          {attachment.kind === 'image' ? (
            <img
              key={`image-${useOriginal ? 'original' : 'preview'}-${retryKey}`}
              src={mediaUrl}
              alt={attachment.filename}
              data-testid="host-agent-media-lightbox-image"
              loading="eager"
              onLoad={() => setLoaded(true)}
              onError={handleMediaError}
              className={`max-h-[84dvh] max-w-full rounded-xl object-contain transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            />
          ) : (
            <video
              key={`video-${retryKey}`}
              controls
              autoPlay
              playsInline
              preload="metadata"
              data-testid="host-agent-media-lightbox-video"
              onLoadedData={() => setLoaded(true)}
              onError={handleMediaError}
              className={`max-h-[84dvh] max-w-full rounded-xl bg-black object-contain transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            >
              <source src={downloadUrl} type={attachment.contentType} />
            </video>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {attachment.kind === 'image' && !useOriginal && (
            <button
              type="button"
              aria-label={t('hostAgentMediaViewOriginalAria', { filename: attachment.filename })}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-gold)]/30 bg-[var(--color-gold)]/10 px-3 py-2 text-xs text-[var(--color-primary)] shadow-[0_0_22px_rgba(245,214,122,0.10)] transition-colors hover:border-[var(--color-gold)]/55 hover:bg-[var(--color-gold)]/15"
              onClick={showOriginalImage}
            >
              <span className="material-symbols-outlined text-[1rem] leading-none">open_in_full</span>
              <span>{t('hostAgentMediaViewOriginal')}</span>
            </button>
          )}
          <a
            href={downloadUrl}
            download={attachment.filename}
            aria-label={t('hostAgentMediaDownloadAria', { filename: attachment.filename })}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-cyan)]/35 bg-[var(--color-cyan)]/10 px-3 py-2 text-xs text-[var(--color-cyan)] shadow-[0_0_22px_rgba(106,255,246,0.10)] transition-colors hover:border-[var(--color-cyan)]/60 hover:bg-[var(--color-cyan)]/15"
          >
            <span className="material-symbols-outlined text-[1rem] leading-none">download</span>
            <span>{t('hostAgentMediaDownload')}</span>
          </a>
          <button
            type="button"
            className="rounded-full border border-white/[0.14] bg-black/40 px-4 py-2 text-xs text-[var(--color-primary)] transition-colors hover:border-white/[0.24] hover:bg-white/[0.06]"
            onClick={onClose}
          >
            {t('hostAgentMediaClose')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
