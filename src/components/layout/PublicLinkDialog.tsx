import { useCallback, useEffect, useRef, useState } from 'react';
import { publicLinkAPI, type PublicLinkStatus } from '@/lib/api-client';
import { useTranslation } from '@/hooks/useTranslation';

interface PublicLinkDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const EMPTY_STATUS: PublicLinkStatus = {
  running: false,
  tunnelUrl: null,
  oneTimeUrl: null,
  qrDataUrl: null,
  frontendUrl: null,
  logDir: null,
  processes: [],
  startedAt: null,
  warnings: [],
  starting: false,
  startJobId: null,
  phase: null,
  message: null,
  error: null,
};

export function PublicLinkDialog({ isOpen, onClose }: PublicLinkDialogProps) {
  const { t } = useTranslation();
  const [acknowledged, setAcknowledged] = useState(false);
  const [status, setStatus] = useState<PublicLinkStatus>(EMPTY_STATUS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventsControllerRef = useRef<AbortController | null>(null);

  const stopEventsStream = useCallback(() => {
    eventsControllerRef.current?.abort();
    eventsControllerRef.current = null;
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setError(null);
    publicLinkAPI.getStatus()
      .then((nextStatus) => {
        if (!cancelled) setStatus((current) => (current.running ? current : nextStatus));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : t('publicLinkStatusFailed');
        setError(message);
      });

    return () => {
      cancelled = true;
      stopEventsStream();
    };
  }, [isOpen, stopEventsStream, t]);

  if (!isOpen) return null;

  async function handleStart() {
    if (!acknowledged) return;
    stopEventsStream();
    setLoading(true);
    setError(null);
    try {
      const nextStatus = await publicLinkAPI.start({ acceptRisk: true });
      setStatus(nextStatus);
      if (!nextStatus.starting) {
        if (nextStatus.error) setError(nextStatus.error.message);
        return;
      }

      const controller = new AbortController();
      eventsControllerRef.current = controller;
      for await (const event of publicLinkAPI.events({ signal: controller.signal })) {
        setStatus(event.data);
        if (event.type === 'error' || event.data.error) {
          setError(event.data.error?.message ?? t('publicLinkStartFailed'));
          break;
        }
        if (event.type === 'ready' || event.data.running) {
          break;
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : t('publicLinkStartFailed'));
    } finally {
      eventsControllerRef.current = null;
      setLoading(false);
    }
  }

  async function handleStop() {
    stopEventsStream();
    setLoading(true);
    setError(null);
    try {
      const nextStatus = await publicLinkAPI.stop();
      setStatus(nextStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('publicLinkStopFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center px-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label={t('publicLinkClose')}
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('publicLinkTitle')}
        className="relative z-[181] w-full max-w-[480px] rounded-[8px] border border-white/[0.1] bg-[var(--color-ether-surface)] p-5 shadow-[0_22px_80px_rgba(0,0,0,0.45)]"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-primary)]">
              {t('publicLinkTitle')}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-secondary)]">
              {t('publicLinkSubtitle')}
            </p>
          </div>
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-secondary)] transition hover:bg-white/[0.06] hover:text-[var(--color-primary)]"
            aria-label={t('publicLinkClose')}
            onClick={onClose}
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="rounded-[8px] border border-[var(--color-amber)]/25 bg-[var(--color-amber)]/10 p-3 text-sm text-[var(--color-primary)]">
          {t('publicLinkRiskBody')}
        </div>

        <div className="mt-3 rounded-[8px] border border-white/[0.08] bg-white/[0.04] p-3 text-xs leading-relaxed text-[var(--color-secondary)]">
          {t('publicLinkPrerequisites')}
        </div>

        <label className="mt-4 flex items-start gap-3 text-sm text-[var(--color-secondary)]">
          <input
            type="checkbox"
            className="mt-1"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.currentTarget.checked)}
          />
          <span>{t('publicLinkRiskAck')}</span>
        </label>

        {status.tunnelUrl && (
          <div className="mt-4 rounded-[8px] border border-[var(--color-green)]/25 bg-[var(--color-green)]/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-green)]">
              {t('publicLinkReady')}
            </p>
            {status.oneTimeUrl && (
              <a
                href={status.oneTimeUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block break-all text-sm text-[var(--color-primary)] underline decoration-[var(--color-green)]/50 underline-offset-4"
              >
                {status.oneTimeUrl}
              </a>
            )}
            {status.qrDataUrl && (
              <img
                src={status.qrDataUrl}
                alt={t('publicLinkQrAlt')}
                className="mx-auto mt-3 h-48 w-48 rounded border border-[var(--color-green)]/20"
              />
            )}
          </div>
        )}

        {(status.starting || (loading && !status.running)) && (
          <div className="mt-4 rounded-[8px] border border-[var(--color-cyan)]/25 bg-[var(--color-cyan)]/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-cyan)]">
              {t('publicLinkProgressTitle')}
            </p>
            <p className="mt-2 text-sm text-[var(--color-primary)]">
              {status.message || t('publicLinkProgressWaiting')}
            </p>
          </div>
        )}

        {status.warnings.length > 0 && (
          <ul className="mt-4 space-y-2 text-xs text-[var(--color-muted)]">
            {status.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}

        {error && (
          <p className="mt-4 rounded-[8px] border border-[var(--color-coral)]/25 bg-[var(--color-coral)]/10 p-3 text-sm text-[var(--color-coral)]">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            className="rounded-full px-4 py-2 text-sm text-[var(--color-secondary)] transition hover:bg-white/[0.06] hover:text-[var(--color-primary)]"
            onClick={onClose}
          >
            {t('hostAgentDismiss')}
          </button>
          {status.running ? (
            <button
              type="button"
              className="rounded-full border border-[var(--color-coral)]/35 px-4 py-2 text-sm font-medium text-[var(--color-coral)] transition hover:bg-[var(--color-coral)]/10 disabled:opacity-50"
              onClick={handleStop}
              disabled={loading}
            >
              {loading ? t('publicLinkStopping') : t('publicLinkStop')}
            </button>
          ) : (
            <button
              type="button"
              className="rounded-full border border-[var(--color-gold)]/35 bg-[var(--color-gold)]/10 px-4 py-2 text-sm font-medium text-[var(--color-gold)] transition hover:bg-[var(--color-gold)]/15 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleStart}
              disabled={!acknowledged || loading || status.starting}
            >
              {loading || status.starting ? t('publicLinkGenerating') : t('publicLinkGenerate')}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
