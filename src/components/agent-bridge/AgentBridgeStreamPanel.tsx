import { useTranslation } from '@/hooks/useTranslation';
import type { AgentBridgeQueryResponse } from '@/lib/api-client';
import type {
  AgentBridgeStreamEvidencePreview,
  AgentBridgeStreamPhase,
  AgentBridgeStreamScaffold,
  AgentBridgeStreamStatus,
} from '@/hooks/useAgentBridge';

export interface AgentBridgeStreamPanelProps {
  status: AgentBridgeStreamStatus;
  phase?: AgentBridgeStreamPhase;
  statusMessage?: string | null;
  scaffold?: AgentBridgeStreamScaffold | null;
  evidencePreview?: AgentBridgeStreamEvidencePreview;
  evidenceCount?: number;
  deltaText: string;
  finalResponse: AgentBridgeQueryResponse | null;
  error: Error | null;
  showSummary?: boolean;
  showEvidence?: boolean;
}

type EvidenceItem = AgentBridgeQueryResponse['evidence'][number];

const phaseOrder: AgentBridgeStreamPhase[] = [
  'connecting',
  'warming',
  'planning',
  'searching',
  'answering',
  'complete',
];

function stageTone(stage: AgentBridgeStreamPhase, phase: AgentBridgeStreamPhase): 'done' | 'active' | 'pending' {
  const currentIndex = phaseOrder.indexOf(phase);
  const stageIndex = phaseOrder.indexOf(stage);
  if (currentIndex < 0 || stageIndex < 0) return 'pending';
  if (stageIndex < currentIndex || phase === 'complete') return 'done';
  return stageIndex === currentIndex ? 'active' : 'pending';
}

function formatCount(template: string, count: number): string {
  return template.replace('{{count}}', String(count));
}

function formatDateRange(scaffold: AgentBridgeStreamScaffold | null | undefined): string {
  if (!scaffold?.date_from && !scaffold?.date_to) return '';
  if (scaffold.date_from && scaffold.date_to) return `${scaffold.date_from} → ${scaffold.date_to}`;
  return scaffold.date_from ?? scaffold.date_to ?? '';
}

function evidenceHref(item: EvidenceItem): string | null {
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  return id ? `/journal/${id}` : null;
}

function isDegraded(response: AgentBridgeQueryResponse | null): boolean {
  const provenance = response && 'provenance' in response
    ? response.provenance
    : null;
  return (
    typeof provenance === 'object'
    && provenance !== null
    && 'degraded' in provenance
    && provenance.degraded === true
  );
}

function defaultPhaseForStatus(status: AgentBridgeStreamStatus): AgentBridgeStreamPhase {
  switch (status) {
    case 'idle':
      return 'idle';
    case 'connecting':
      return 'connecting';
    case 'streaming':
      return 'answering';
    case 'complete':
      return 'complete';
    case 'error':
      return 'error';
  }
}

export function AgentBridgeStreamPanel({
  status,
  phase = defaultPhaseForStatus(status),
  scaffold = null,
  evidencePreview = [],
  evidenceCount,
  deltaText,
  finalResponse,
  error,
  showSummary = true,
  showEvidence = true,
}: AgentBridgeStreamPanelProps) {
  const { t } = useTranslation();
  const displayedScaffold = finalResponse?.scaffold ?? scaffold;
  const displayedEvidence = finalResponse?.evidence?.length ? finalResponse.evidence : evidencePreview;
  const displayedEvidenceCount = evidenceCount ?? displayedEvidence.length;
  const dateRange = formatDateRange(displayedScaffold);
  const evidenceCountLabel = displayedEvidenceCount > 0
    ? formatCount(t('agentBridgeStreamEvidenceFound'), displayedEvidenceCount)
    : t('agentBridgeStreamNoEvidence');

  const renderStage = (
    stage: AgentBridgeStreamPhase,
    label: string,
    icon: string,
  ) => {
    const visualPhase = phase === 'connecting' ? 'warming' : phase;
    const tone = stageTone(stage, visualPhase);
    return (
      <li
        className="flex items-center gap-2"
        data-state={tone}
        data-testid={`agent-stream-stage-${stage}`}
      >
        <span
          className="material-symbols-outlined text-[1rem]"
          style={{
            color: tone === 'pending' ? 'var(--color-muted)' : 'var(--color-cyan)',
          }}
        >
          {icon}
        </span>
        <span
          className="text-[0.75rem]"
          style={{
            color: tone === 'pending' ? 'var(--color-muted)' : 'var(--color-primary)',
            fontFamily: 'var(--font-order)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </span>
      </li>
    );
  };

  const renderThinkingBody = () => (
    <div data-testid="agent-stream-thinking-body">
      <ol className="grid grid-cols-2 gap-2 mb-4 max-[520px]:grid-cols-1" data-testid="agent-stream-stages">
        {renderStage('warming', t('agentBridgeStreamStageStatus'), 'settings')}
        {renderStage('planning', t('agentBridgeStreamStageScaffold'), 'schema')}
        {renderStage('searching', t('agentBridgeStreamStageEvidence'), 'travel_explore')}
        {renderStage('answering', t('agentBridgeStreamStageAnswer'), 'edit_note')}
      </ol>

      {displayedScaffold && (
        <div
          className="rounded-2xl p-3 mb-3"
          data-testid="agent-stream-scaffold"
          style={{ background: 'var(--color-ether-surface-ghost)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {displayedScaffold.intent && (
            <p className="text-[var(--color-secondary)] text-xs mb-1" style={{ fontFamily: 'var(--font-order)' }}>
              {t('agentBridgeStreamIntentLabel')}: <span className="text-[var(--color-primary)]">{displayedScaffold.intent}</span>
            </p>
          )}
          {displayedScaffold.queries && displayedScaffold.queries.length > 0 && (
            <p className="text-[var(--color-secondary)] text-xs mb-1" style={{ fontFamily: 'var(--font-order)' }}>
              {t('agentBridgeStreamQueriesLabel')}:{' '}
              {displayedScaffold.queries.map((query, index) => (
                <span key={`${query}-${index}`} className="text-[var(--color-primary)]">
                  {index > 0 ? ' · ' : ''}
                  <span>{query}</span>
                </span>
              ))}
            </p>
          )}
          {dateRange && (
            <p className="text-[var(--color-secondary)] text-xs" style={{ fontFamily: 'var(--font-order)' }}>
              {t('agentBridgeStreamDateRangeLabel')}: <span className="text-[var(--color-primary)]">{dateRange}</span>
            </p>
          )}
        </div>
      )}

      <div
        className="rounded-2xl p-3 mb-3"
        data-testid="agent-stream-evidence-preview"
        style={{ background: 'var(--color-ether-surface-ghost)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <p className="text-[var(--color-secondary)] text-xs mb-2" style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {evidenceCountLabel}
        </p>
        {displayedEvidence.length > 0 && (
          <ul className="space-y-1">
            {displayedEvidence.slice(0, 3).map((item, index) => (
              <li key={item.id || `${item.title}-${index}`} className="text-[var(--color-primary)] text-sm" style={{ fontFamily: 'var(--font-narrative)' }}>
                {item.title}
              </li>
            ))}
          </ul>
        )}
      </div>

      {(status === 'connecting' || status === 'streaming') && (
        <div
          className="text-[var(--color-primary)] text-base leading-relaxed min-h-6"
          data-testid="agent-stream-delta"
          style={{ fontFamily: 'var(--font-narrative)' }}
        >
          {deltaText || t('agentBridgeStreamPlaceholder')}
        </div>
      )}
    </div>
  );

  const renderEvidenceItem = (item: EvidenceItem) => {
    const href = evidenceHref(item);
    if (!href) {
      return (
        <span className="text-[var(--color-primary)] text-sm" data-testid="agent-stream-evidence-text">
          {item.title}
        </span>
      );
    }
    return (
      <a className="text-[var(--color-cyan)] text-sm" href={href}>
        {item.title}
      </a>
    );
  };

  if (status === 'error' && error) {
    return (
      <div
        className="text-center py-10"
        data-testid="agent-stream-error"
        style={{ border: '1px solid rgba(255,180,166,0.15)', background: 'rgba(255,180,166,0.08)' }}
      >
        <span className="material-symbols-outlined text-[var(--color-coral)] text-3xl mb-3 block">error_outline</span>
        <h4 className="text-[var(--color-primary)] text-sm mb-2" style={{ fontFamily: 'var(--font-order)' }}>
          {t('agentBridgeStreamErrorTitle')}
        </h4>
        <p className="text-[var(--color-secondary)] text-xs">{t('agentBridgeStreamErrorBody')}</p>
      </div>
    );
  }

  return (
    <div
      className="p-5 rounded-3xl mb-5"
      data-testid="agent-stream-panel"
      style={{ background: 'var(--color-ether-panel)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      {(status === 'connecting' || status === 'streaming') && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[var(--color-cyan)] text-lg">psychology</span>
            <p className="text-[var(--color-secondary)] text-xs" style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {status === 'connecting' ? t('agentBridgeStreamWarming') : t('agentBridgeStreamThinking')}
            </p>
          </div>
          {renderThinkingBody()}
        </div>
      )}

      {status === 'complete' && (
        <details data-testid="agent-stream-thinking-final">
          <summary className="cursor-pointer text-[var(--color-primary)] text-sm" style={{ fontFamily: 'var(--font-order)' }}>
            <span>{t('agentBridgeStreamThinkingCollapsed')}</span> · <span>{evidenceCountLabel}</span>
          </summary>
          <div className="mt-3">
            {renderThinkingBody()}
          </div>
        </details>
      )}

      {isDegraded(finalResponse) && (
        <p
          className="text-[var(--color-coral)] text-xs mt-3"
          data-testid="agent-stream-degraded"
          style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.08em', textTransform: 'uppercase' }}
        >
          {t('agentBridgeStreamDegraded')}
        </p>
      )}

      {showSummary && status === 'complete' && finalResponse && (
        <details data-testid="agent-stream-final" className="mt-3">
          <summary className="cursor-pointer text-[var(--color-primary)] text-sm" style={{ fontFamily: 'var(--font-order)' }}>
            {t('agentBridgeStreamFinalSummary')}: {' '}
            <span>{finalResponse.answer?.summary ?? finalResponse.synthesis ?? ''}</span>
          </summary>
          {showEvidence && finalResponse.evidence.length > 0 && (
            <div className="mt-3">
              <h5 className="text-xs text-[var(--color-secondary)] mb-2" style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {t('agentBridgeStreamEvidenceTitle')}
              </h5>
              <ul className="space-y-2">
                {finalResponse.evidence.map((item) => (
                  <li key={item.id}>
                    {renderEvidenceItem(item)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </details>
      )}
    </div>
  );
}
