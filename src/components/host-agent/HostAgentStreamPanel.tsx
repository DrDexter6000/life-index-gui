import { useTranslation } from '@/hooks/useTranslation';
import type { HostAgentQueryResponse } from '@/lib/api-client';
import type { HostAgentStreamPhase, HostAgentStreamStatus } from '@/hooks/useHostAgent';

export interface HostAgentStreamPanelProps {
  status: HostAgentStreamStatus;
  phase: HostAgentStreamPhase;
  statusMessage?: string | null;
  evidencePreview: HostAgentQueryResponse['evidence'];
  evidenceCount: number;
  deltaText: string;
  error: Error | null;
}

export function HostAgentStreamPanel({
  status,
  deltaText,
  error,
}: HostAgentStreamPanelProps) {
  const { t } = useTranslation();

  if (status === 'error') {
    return (
      <div
        className="rounded-3xl p-5 text-center"
        data-testid="host-agent-stream-error"
        style={{ border: '1px solid rgba(255,180,166,0.15)', background: 'rgba(255,180,166,0.08)' }}
      >
        <span className="material-symbols-outlined mb-3 block text-3xl text-[var(--color-coral)]">error_outline</span>
        <h4 className="mb-2 text-sm text-[var(--color-primary)]" style={{ fontFamily: 'var(--font-order)' }}>
          {t('hostAgentStreamErrorTitle')}
        </h4>
        <p className="text-xs text-[var(--color-secondary)]">
          {error?.message || t('hostAgentStreamErrorBody')}
        </p>
      </div>
    );
  }

  const liveThinking = deltaText.trim() || t('hostAgentStreamThinkingPending');

  return (
    <div
      className="mb-5 rounded-3xl p-5"
      data-testid="host-agent-stream-panel"
      style={{ background: 'var(--color-ether-panel)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="material-symbols-outlined text-lg text-[var(--color-cyan)]">psychology</span>
        <p
          className="text-xs text-[var(--color-secondary)]"
          style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.08em', textTransform: 'uppercase' }}
        >
          {status === 'connecting' ? t('hostAgentStreamWarming') : t('hostAgentStreamThinking')}
        </p>
      </div>

      <div
        className="rounded-2xl p-3"
        data-testid="host-agent-live-thinking"
        style={{ background: 'var(--color-ether-surface-ghost)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <p
          className="mb-2 text-xs text-[var(--color-secondary)]"
          style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.08em', textTransform: 'uppercase' }}
        >
          {t('hostAgentThinkingToggle')}
        </p>
        <pre
          className="min-h-6 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-primary)]"
          data-testid="host-agent-stream-delta"
          style={{ fontFamily: 'var(--font-narrative)' }}
        >
          {liveThinking}
        </pre>
      </div>
    </div>
  );
}
