import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { HostAgentStreamPanel } from './HostAgentStreamPanel';
import type { HostAgentStreamPhase } from '@/hooks/useHostAgent';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        hostAgentStreamThinking: 'Live reasoning',
        hostAgentStreamThinkingPending: 'Waiting for Host Agent reasoning...',
        hostAgentStreamWarming: 'Preparing answer',
        hostAgentStreamStageStatus: 'Preparing stream',
        hostAgentStreamStageScaffold: 'Planning query',
        hostAgentStreamStageCallingHostAgent: 'Calling Host Agent',
        hostAgentStreamStageEvidence: 'Searching evidence',
        hostAgentStreamStageAnswer: 'Writing answer',
        hostAgentStreamEvidenceFound: `Found ${values?.count ?? 0} evidence`,
        hostAgentStreamNoEvidence: 'No evidence yet',
        hostAgentStreamElapsed: `${values?.seconds ?? 0}s elapsed`,
        hostAgentThinkingToggle: 'Thinking process',
        hostAgentStreamErrorTitle: 'Stream failed',
        hostAgentStreamErrorBody: 'The Host Agent could not complete this request.',
      };
      return map[key] ?? key;
    },
  }),
}));

function renderPanel(overrides: Partial<ComponentProps<typeof HostAgentStreamPanel>> = {}) {
  render(
    <HostAgentStreamPanel
      status="streaming"
      phase="planning"
      statusMessage={null}
      evidencePreview={[]}
      evidenceCount={0}
      deltaText=""
      error={null}
      {...overrides}
    />,
  );
}

describe('HostAgentStreamPanel', () => {
  it('shows the calling-host-agent stage and status message before any delta arrives', () => {
    renderPanel({
      phase: 'calling_host_agent' as HostAgentStreamPhase,
      statusMessage: 'Calling configured host agent runtime.',
    });

    const panel = screen.getByTestId('host-agent-stream-panel');
    const phaseRail = screen.getByTestId('host-agent-stream-phase-rail');
    expect(within(panel).getByText('Calling Host Agent')).toBeInTheDocument();
    expect(within(phaseRail).getByText('Calling configured host agent runtime.')).toBeInTheDocument();
    expect(within(phaseRail).getByText('0s elapsed')).toBeInTheDocument();
    expect(screen.getByTestId('host-agent-stream-delta')).not.toHaveTextContent('Waiting for Host Agent reasoning...');
  });

  it('shows evidence progress while preserving live delta output', () => {
    renderPanel({
      phase: 'searching',
      statusMessage: 'Reading five cited journal entries.',
      evidenceCount: 5,
      deltaText: 'I have found the relevant entries.',
    });

    const panel = screen.getByTestId('host-agent-stream-panel');
    expect(within(panel).getByText('Searching evidence')).toBeInTheDocument();
    expect(within(panel).getByText('Found 5 evidence')).toBeInTheDocument();
    expect(screen.getByTestId('host-agent-stream-delta')).toHaveTextContent('I have found the relevant entries.');
  });
});
