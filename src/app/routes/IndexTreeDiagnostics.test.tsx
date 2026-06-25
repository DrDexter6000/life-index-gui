import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import IndexTreeDiagnostics from './IndexTreeDiagnostics';

const mockUseIndexTreeNodes = vi.fn();
const mockUseIndexTreeLens = vi.fn();
const mockUseIndexTreeShadow = vi.fn();

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        indexTreeDiagnostics: 'Index Tree Evidence Navigation',
        indexTreeDiagnosticsSubtitle: 'Read-only diagnostics for freshness, coverage, and evidence refs.',
        indexTreeNodes: 'Nodes',
        indexTreeFreshness: 'Freshness',
        indexTreeEntryCount: 'Entries',
        indexTreeSignalCoverage: 'Signal coverage',
        indexTreeEvidenceRefs: 'Evidence refs',
        indexTreeLens: 'Lens navigation',
        indexTreeLensDesc: 'Lens values are navigation aids with evidence refs, not truth claims.',
        indexTreeLensSignalTopic: 'Topic',
        indexTreeLensSignalPeople: 'People',
        indexTreeLensSignalProject: 'Project',
        indexTreeShadow: 'Shadow diagnostics',
        indexTreeShadowDesc: 'Shadow is diagnostic-only and does not change default search or smart-search ranking.',
        indexTreeShadowPlaceholder: 'Diagnostic query',
        indexTreeShadowRun: 'Run diagnostic',
        indexTreeShadowRecallPreserved: 'Recall preserved',
        indexTreeShadowDroppedPaths: 'Dropped paths',
        indexTreeUnavailable: 'Index tree diagnostics unavailable.',
        indexTreeLoading: 'Loading index tree diagnostics...',
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock('@/hooks/useIndexTree', () => ({
  useIndexTreeNodes: () => mockUseIndexTreeNodes(),
  useIndexTreeLens: (signal: string) => mockUseIndexTreeLens(signal),
  useIndexTreeShadow: (query: string) => mockUseIndexTreeShadow(query),
}));

function renderIndexTreeDiagnostics() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <IndexTreeDiagnostics />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const nodesQuery = {
  data: {
    success: true,
    schema_version: 'm31.index_tree.v1',
    command: 'index-tree.nodes',
    generated_at: '2026-05-31T00:00:00Z',
    data: {
      truth_source: 'journals',
      level: 'month',
      nodes: [
        {
          node_id: 'month:2026-05',
          level: 'month',
          relative_path: 'Journals/2026/05/index_2026-05.md',
          entry_count: 2,
          freshness: 'fresh',
          entry_refs: [
            {
              relative_path: 'Journals/2026/05/life-index_2026-05-01_001.md',
              signals: { topic: ['work'] },
            },
          ],
          signal_coverage: {
            topic: { entries_in_scope: 2, present: 2, parseable: 2 },
          },
        },
      ],
    },
    errors: [],
  },
  isLoading: false,
  isError: false,
};

const lensQuery = {
  data: {
    success: true,
    schema_version: 'm31.index_tree.v1',
    command: 'index-tree.lens',
    generated_at: '2026-05-31T00:00:00Z',
    data: {
      truth_source: 'journals',
      privacy_level: 'same_as_journals',
      signal: 'topic',
      coverage: { entries_in_scope: 2, present: 2, parseable: 2 },
      items: [
        {
          value: 'work',
          count: 2,
          node_refs: [{ type: 'month', node_id: 'month:2026-05' }],
          evidence_paths: ['Journals/2026/05/life-index_2026-05-01_001.md'],
          freshness: ['fresh'],
        },
      ],
    },
    errors: [],
  },
  isLoading: false,
  isError: false,
};

function shadowQuery(query: string) {
  return {
    data: query
      ? {
          success: true,
          schema_version: 'm31.index_tree.v1',
          command: 'index-tree.shadow',
          generated_at: '2026-05-31T00:00:00Z',
          data: {
            query,
            enabled: true,
            diagnostic_only: true,
            baseline_paths: ['Journals/2026/05/life-index_2026-05-01_001.md'],
            shadow_candidate_paths: ['Journals/2026/05/life-index_2026-05-01_001.md'],
            recall_preserved: true,
            dropped_paths: [],
            default_search_mutated: false,
            default_smart_search_mutated: false,
          },
          errors: [],
        }
      : undefined,
    isLoading: false,
    isError: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseIndexTreeNodes.mockReturnValue(nodesQuery);
  mockUseIndexTreeLens.mockReturnValue(lensQuery);
  mockUseIndexTreeShadow.mockImplementation(shadowQuery);
});

describe('IndexTreeDiagnostics', () => {
  it('renders node freshness, entry counts, signal coverage, and evidence refs', () => {
    renderIndexTreeDiagnostics();

    const nodeCard = screen.getByTestId('index-tree-node-card');
    expect(screen.getByTestId('index-tree-diagnostics-page')).toBeInTheDocument();
    expect(screen.getByText('Index Tree Evidence Navigation')).toBeInTheDocument();
    expect(nodeCard.textContent).toContain('month:2026-05');
    expect(nodeCard.textContent).toContain('fresh');
    expect(nodeCard.textContent).toContain('Entries: 2');
    expect(nodeCard.textContent).toContain('topic: 2/2');
    expect(screen.getByRole('link', { name: /life-index_2026-05-01_001.md/ })).toHaveAttribute(
      'href',
      '/journal/Journals/2026/05/life-index_2026-05-01_001.md',
    );
  });

  it('renders a stable nodes section for an empty nodes response', () => {
    mockUseIndexTreeNodes.mockReturnValue({
      ...nodesQuery,
      data: {
        ...nodesQuery.data,
        data: {
          ...nodesQuery.data.data,
          nodes: [],
        },
      },
    });

    renderIndexTreeDiagnostics();

    expect(screen.getByText('Nodes')).toBeInTheDocument();
    expect(screen.queryAllByTestId('index-tree-node-card')).toHaveLength(0);
    expect(screen.getByText('Lens navigation')).toBeInTheDocument();
  });

  it('shows loading and unavailable copy for node diagnostics states', () => {
    mockUseIndexTreeNodes.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    const { rerender } = renderIndexTreeDiagnostics();

    expect(screen.getByText('Loading index tree diagnostics...')).toBeInTheDocument();

    mockUseIndexTreeNodes.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <IndexTreeDiagnostics />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText('Index tree diagnostics unavailable.')).toBeInTheDocument();
  });

  it('labels lens values as navigation aids instead of truth claims', () => {
    renderIndexTreeDiagnostics();

    expect(screen.getByText('Lens values are navigation aids with evidence refs, not truth claims.')).toBeInTheDocument();
    expect(screen.getByTestId('index-tree-lens-item').textContent).toContain('work');
    expect(screen.getByTestId('index-tree-lens-item').textContent).toContain('month:2026-05');
    expect(screen.getByText('Journals/2026/05/life-index_2026-05-01_001.md')).toBeInTheDocument();
  });

  it('shows unavailable copy when lens diagnostics fail', () => {
    mockUseIndexTreeLens.mockReturnValue({
      data: {
        success: false,
        schema_version: 'm31.index_tree.v1',
        command: 'index-tree.lens',
        generated_at: '2026-05-31T00:00:00Z',
        data: null,
        errors: [{ code: 'CLI_ERROR', message: 'lens unavailable' }],
      },
      isLoading: false,
      isError: true,
    });

    renderIndexTreeDiagnostics();

    expect(screen.getByText('Index tree diagnostics unavailable.')).toBeInTheDocument();
    expect(screen.queryByTestId('index-tree-lens-item')).not.toBeInTheDocument();
  });

  it('shows shadow as diagnostic-only and preserves search ranking guardrails', () => {
    renderIndexTreeDiagnostics();

    fireEvent.change(screen.getByLabelText('Diagnostic query'), {
      target: { value: 'alpha beta' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostic' }));

    expect(screen.getByText('Shadow is diagnostic-only and does not change default search or smart-search ranking.')).toBeInTheDocument();
    expect(screen.getByTestId('index-tree-shadow-diagnostic').textContent).toContain('alpha beta');
    expect(screen.getByTestId('index-tree-shadow-diagnostic').textContent).toContain('Recall preserved');
    expect(screen.getByTestId('index-tree-shadow-diagnostic').textContent).toContain('true');
    expect(screen.getByTestId('index-tree-shadow-diagnostic').textContent).toContain('default_search_mutated: false');
    expect(screen.getByTestId('index-tree-shadow-diagnostic').textContent).toContain('default_smart_search_mutated: false');
  });
});
