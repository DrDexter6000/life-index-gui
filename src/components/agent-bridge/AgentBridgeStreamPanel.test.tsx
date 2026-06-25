import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AgentBridgeStreamPanel } from './AgentBridgeStreamPanel';
import type { AgentBridgeQueryResponse } from '@/lib/api-client';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        agentBridgeStreamThinking: 'Thinking through evidence',
        agentBridgeStreamWarming: 'Preparing answer',
        agentBridgeStreamStageStatus: 'Preparing stream',
        agentBridgeStreamStageScaffold: 'Planning query',
        agentBridgeStreamStageEvidence: 'Searching evidence',
        agentBridgeStreamStageAnswer: 'Writing answer',
        agentBridgeStreamIntentLabel: 'Intent',
        agentBridgeStreamQueriesLabel: 'Queries',
        agentBridgeStreamDateRangeLabel: 'Date range',
        agentBridgeStreamEvidenceFound: 'Found {{count}} evidence',
        agentBridgeStreamNoEvidence: 'No evidence yet',
        agentBridgeStreamThinkingCollapsed: 'Thinking folded',
        agentBridgeStreamDegraded: 'Service degraded',
        agentBridgeStreamFinalSummary: 'Final answer',
        agentBridgeStreamEvidenceTitle: 'Evidence',
        agentBridgeStreamErrorTitle: 'Stream failed',
        agentBridgeStreamErrorBody: 'The evidence service could not complete this request. Try again in a moment.',
      };
      return map[key] ?? key;
    },
  }),
}));

const finalResponse: AgentBridgeQueryResponse = {
  schema_version: 'm35.agent_bridge_query.v0',
  command: 'agent-bridge query',
  source: 'mock-gateway',
  query: 'Where did I go?',
  mode: 'GROUNDED',
  scaffold: { intent: 'location', queries: ['where'], filters: {} },
  evidence: [
    {
      id: '2026/06/e1',
      rel_path: 'Journals/2026/06/e1.md',
      title: 'Park visit',
      date: '2026-06-01',
      snippet: 'walked through the park',
    },
  ],
  answer: {
    mode: 'GROUNDED',
    summary: 'You visited the park.',
    insights: [],
    related_findings: [],
    gap: null,
    explanation: null,
    what_was_found: [],
    suggestions: [],
  },
  synthesis: 'You visited the park.',
};

describe('AgentBridgeStreamPanel', () => {
  it('shows progressive thinking stages, scaffold, evidence preview, and accumulated delta while streaming', () => {
    render(
      <AgentBridgeStreamPanel
        status="streaming"
        phase="answering"
        statusMessage="Warming gateway"
        scaffold={{
          intent: 'location',
          date_from: '2026-06-01',
          date_to: '2026-06-02',
          queries: ['where did I go', 'location'],
          filters: {},
        }}
        evidencePreview={finalResponse.evidence}
        evidenceCount={1}
        deltaText="You visited "
        finalResponse={null}
        error={null}
      />,
    );

    expect(screen.getByTestId('agent-stream-panel')).toBeInTheDocument();
    expect(screen.getByText('Thinking through evidence')).toBeInTheDocument();
    expect(screen.queryByText('Warming gateway')).not.toBeInTheDocument();
    expect(screen.getByText('Preparing stream')).toBeInTheDocument();
    expect(screen.getByText('Planning query')).toBeInTheDocument();
    expect(screen.getByText('Searching evidence')).toBeInTheDocument();
    expect(screen.getByText('Writing answer')).toBeInTheDocument();
    expect(within(screen.getByTestId('agent-stream-scaffold')).getAllByText('location')).toHaveLength(2);
    expect(screen.getByText('where did I go')).toBeInTheDocument();
    expect(screen.getByText('2026-06-01 → 2026-06-02')).toBeInTheDocument();
    expect(screen.getByText('Found 1 evidence')).toBeInTheDocument();
    expect(screen.getByText('Park visit')).toBeInTheDocument();
    expect(screen.getByTestId('agent-stream-delta')).toHaveTextContent('You visited');
  });

  it('renders the final answer collapsed with clickable evidence links', () => {
    render(
      <AgentBridgeStreamPanel
        status="complete"
        deltaText="You visited the park."
        finalResponse={finalResponse}
        error={null}
      />,
    );

    const details = screen.getByTestId('agent-stream-final');
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText('You visited the park.')).toBeInTheDocument();
    const evidenceLink = screen.getByRole('link', { name: /Park visit/ });
    expect(evidenceLink).toHaveAttribute('href', '/journal/2026/06/e1');
  });

  it('collapses thinking after completion even when the final answer is rendered elsewhere', () => {
    render(
      <AgentBridgeStreamPanel
        status="complete"
        phase="complete"
        deltaText="You visited the park."
        scaffold={finalResponse.scaffold}
        evidencePreview={finalResponse.evidence}
        evidenceCount={1}
        finalResponse={finalResponse}
        error={null}
        showSummary={false}
        showEvidence={false}
      />,
    );

    const thinking = screen.getByTestId('agent-stream-thinking-final');
    expect(thinking).not.toHaveAttribute('open');
    expect(screen.getByText('Thinking folded')).toBeInTheDocument();
    expect(screen.queryByText('Final answer')).not.toBeInTheDocument();
  });

  it('renders unsafe evidence identifiers as text instead of broken links', () => {
    const responseWithBlankEvidence = {
      ...finalResponse,
      evidence: [
        {
          id: '',
          rel_path: 'Journals/2026/06/missing.md',
          title: 'Missing id evidence',
          date: '2026-06-02',
        },
      ],
    } as AgentBridgeQueryResponse;

    render(
      <AgentBridgeStreamPanel
        status="complete"
        phase="complete"
        deltaText=""
        finalResponse={responseWithBlankEvidence}
        error={null}
      />,
    );

    expect(screen.getByTestId('agent-stream-evidence-text')).toHaveTextContent('Missing id evidence');
    expect(screen.queryByRole('link', { name: /Missing id evidence/ })).not.toBeInTheDocument();
  });

  it('shows degraded final responses honestly', () => {
    render(
      <AgentBridgeStreamPanel
        status="complete"
        phase="complete"
        deltaText=""
        finalResponse={{
          ...finalResponse,
          provenance: { degraded: true },
        } as AgentBridgeQueryResponse}
        error={null}
      />,
    );

    expect(screen.getByText('Service degraded')).toBeInTheDocument();
  });

  it('shows a standard error state when the stream fails', () => {
    render(
      <AgentBridgeStreamPanel
        status="error"
        deltaText=""
        finalResponse={null}
        error={new Error('mock failure')}
      />,
    );

    expect(screen.getByTestId('agent-stream-error')).toBeInTheDocument();
    expect(screen.getByText('Stream failed')).toBeInTheDocument();
    expect(screen.getByText('The evidence service could not complete this request. Try again in a moment.')).toBeInTheDocument();
    expect(screen.queryByText('mock failure')).not.toBeInTheDocument();
  });
});
