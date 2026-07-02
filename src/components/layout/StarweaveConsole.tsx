import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from '@/hooks/useTranslation';
import type { HostAgentCapability } from '@/lib/health-status';

export type StarweaveConnectionState = 'online' | 'offline' | 'checking';

interface StarweaveConsoleProps {
  isOpen: boolean;
  onClose: () => void;
  capability: HostAgentCapability;
  lang: 'zh' | 'en';
  onToggleLang: () => void;
  onPublicLinkClick: () => void;
}

const CONSOLE_STYLE = {
  background: 'var(--color-nav-mobile-dropdown-bg)',
  border: '1px solid var(--color-glass-highlight)',
  boxShadow: '0 24px 70px rgba(0,0,0,0.42)',
  fontFamily: 'var(--font-control)',
} as const satisfies CSSProperties;

const ORB_DOT_STYLE = {
  background: 'var(--color-gold)',
  boxShadow: '0 0 18px var(--color-gold-60)',
} as const satisfies CSSProperties;

const ORB_RING_STYLE = {
  borderColor: 'var(--color-gold-25)',
} as const satisfies CSSProperties;

const ONLINE_DOT_STYLE = {
  background: 'var(--color-green)',
  boxShadow: '0 0 8px var(--color-green-60)',
} as const satisfies CSSProperties;

const OFFLINE_DOT_STYLE = {
  background: 'var(--color-amber)',
  boxShadow: '0 0 8px var(--color-amber)',
} as const satisfies CSSProperties;

const CHECKING_DOT_STYLE = {
  background: 'var(--color-muted)',
  boxShadow: '0 0 8px rgba(255,255,255,0.18)',
} as const satisfies CSSProperties;

const FOOTER_STYLE = {
  fontFamily: 'var(--font-voice)',
} as const satisfies CSSProperties;

const LANGUAGE_BUTTON_STYLE = {
  fontFamily: 'var(--font-control)',
  letterSpacing: '0.08em',
} as const satisfies CSSProperties;

export function getStarweaveConnectionState(capability: HostAgentCapability): StarweaveConnectionState {
  if (capability.status === 'checking') return 'checking';
  return capability.canSendEvidence ? 'online' : 'offline';
}

function getStateDotStyle(state: StarweaveConnectionState): CSSProperties {
  if (state === 'online') return ONLINE_DOT_STYLE;
  if (state === 'checking') return CHECKING_DOT_STYLE;
  return OFFLINE_DOT_STYLE;
}

export function StarweaveConsole({
  isOpen,
  onClose,
  capability,
  lang,
  onToggleLang,
  onPublicLinkClick,
}: StarweaveConsoleProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const state = getStarweaveConnectionState(capability);
  const isOnline = state === 'online';
  const stateDotStyle = useMemo(() => getStateDotStyle(state), [state]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest('[data-starweave-trigger="true"]')) return;
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>('a[href], button, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>('button, a[href]')?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const stateLabel = state === 'online'
    ? t('starweaveStatusOnline')
    : state === 'checking'
      ? t('starweaveStatusChecking')
      : t('starweaveStatusOffline');

  const subtitle = state === 'online'
    ? t('starweaveConnectedSubtitle')
    : state === 'checking'
      ? t('starweaveCheckingSubtitle')
      : t('starweaveOfflineSubtitle');

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-label={t('starweaveConsoleTitle')}
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          className="absolute right-0 top-[calc(100%+0.75rem)] z-[150] w-[360px] rounded-[20px] p-4"
          style={CONSOLE_STYLE}
          data-testid="starweave-console"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5 h-9 w-9 flex-shrink-0">
                <span
                  className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={ORB_DOT_STYLE}
                />
                <span
                  className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                  style={ORB_RING_STYLE}
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold tracking-[0.08em] text-[var(--color-primary)]">
                    {t('starweaveConsoleTitle')}
                  </h2>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[0.625rem] font-semibold tracking-[0.08em] ${
                      state === 'online'
                        ? 'border-[var(--color-green)]/30 text-[var(--color-green)]'
                        : state === 'checking'
                          ? 'border-white/15 text-[var(--color-muted)]'
                          : 'border-[var(--color-amber)]/30 text-[var(--color-amber)]'
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={stateDotStyle} />
                    {stateLabel}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-secondary)]">
                  {subtitle}
                </p>
              </div>
            </div>
            <button
              type="button"
              aria-label={t('starweaveConsoleClose')}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[var(--color-secondary)] transition hover:bg-white/[0.06] hover:text-[var(--color-primary)]"
              onClick={onClose}
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          <div className="mt-4 space-y-2">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-[12px] border border-white/[0.08] bg-white/[0.04] px-3 py-3 text-left transition hover:border-[var(--color-amber)]/30 hover:bg-[var(--color-amber)]/10"
              onClick={onPublicLinkClick}
            >
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-[var(--color-amber)]">public</span>
                <span>
                  <span className="block text-sm font-medium text-[var(--color-primary)]">
                    {t('starweavePublicLinkLabel')}
                  </span>
                  <span className="block text-[0.6875rem] uppercase tracking-[0.08em] text-[var(--color-secondary)]">
                    {t('starweavePublicLinkEn')}
                  </span>
                </span>
              </span>
              <span className="material-symbols-outlined text-[18px] text-[var(--color-secondary)]">chevron_right</span>
            </button>

            {!isOnline && (
              <div className="rounded-[12px] border border-white/[0.08] bg-white/[0.04] px-3 py-3">
                <p className="text-sm leading-relaxed text-[var(--color-primary)]">
                  {t('starweaveConnectGuideBody')}
                </p>
                <Link
                  to="/maintenance"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-cyan)] hover:text-[var(--color-primary)]"
                  onClick={onClose}
                >
                  {t('starweaveConnectGuideLink')}
                  <span className="material-symbols-outlined text-[15px]">chevron_right</span>
                </Link>
              </div>
            )}

            <div className="flex items-center justify-between rounded-[12px] border border-white/[0.08] bg-white/[0.04] px-3 py-3">
              <div>
                <span className="block text-sm font-medium text-[var(--color-primary)]">
                  {t('starweaveLanguageLabel')}
                </span>
                <span className="block text-[0.6875rem] uppercase tracking-[0.08em] text-[var(--color-secondary)]">
                  {t('starweaveLanguageEn')}
                </span>
              </div>
              <div className="flex items-center rounded-full border border-white/[0.08] p-1">
                <button
                  type="button"
                  aria-label={t('switchToZh')}
                  className={`rounded-full px-2.5 py-1.5 text-[0.75rem] font-semibold transition ${
                    lang === 'zh' ? 'bg-[var(--color-gold-10)] text-[var(--color-gold)]' : 'text-[var(--color-secondary)] hover:text-[var(--color-primary)]'
                  }`}
                  style={LANGUAGE_BUTTON_STYLE}
                  onClick={() => {
                    if (lang !== 'zh') onToggleLang();
                  }}
                >
                  中
                </button>
                <button
                  type="button"
                  aria-label={t('switchToEn')}
                  className={`rounded-full px-2.5 py-1.5 text-[0.75rem] font-semibold transition ${
                    lang === 'en' ? 'bg-[var(--color-gold-10)] text-[var(--color-gold)]' : 'text-[var(--color-secondary)] hover:text-[var(--color-primary)]'
                  }`}
                  style={LANGUAGE_BUTTON_STYLE}
                  onClick={() => {
                    if (lang !== 'en') onToggleLang();
                  }}
                >
                  EN
                </button>
              </div>
            </div>
          </div>

          <p className="mt-4 border-t border-white/[0.08] pt-3 text-xs leading-relaxed text-[var(--color-muted)]" style={FOOTER_STYLE}>
            {t('starweaveConsoleFooter')}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
