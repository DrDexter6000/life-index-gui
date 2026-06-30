import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import IndexTreeDiagnostics from './IndexTreeDiagnostics';

const mockUseIndexTreeDiscover = vi.fn();
const mockUseIndexTreeNavigate = vi.fn();
const mockUseIndexTreeEnsure = vi.fn();
const mockUseIndexTreeShadow = vi.fn();

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        indexTreeDiagnostics: 'Index Tree Evidence Navigation',
        indexTreeDiagnosticsSubtitle: 'Canonical discover and navigate surface for evidence refs.',
        indexTreeDiscover: 'Discover facets',
        indexTreeDiscoverDesc: 'Host/user selects values; the tool only executes deterministic navigation.',
        indexTreeNavigate: 'Navigate evidence',
        indexTreeNavigateDesc: 'Selected facets return journal pointers without GUI-side routing intelligence.',
        indexTreeFacetTopic: 'Topic',
        indexTreeFacetPeople: 'People',
        indexTreeFacetProject: 'Project',
        indexTreeFreshness: 'Freshness',
        indexTreeEntryCount: 'Entries',
        indexTreeEvidenceRefs: 'Evidence refs',
        indexTreeFallback: 'Journal fallback',
        indexTreeUnavailable: 'Index tree diagnostics unavailable.',
        indexTreeLoading: 'Loading index tree diagnostics...',
        indexTreeShadow: 'Shadow diagnostics',
        indexTreeShadowDesc: 'Shadow is diagnostic-only and does not change default search or smart-search ranking.',
        indexTreeShadowPlaceholder: 'Diagnostic query',
        indexTreeShadowRun: 'Run diagnostic',
        indexTreeShadowRecallPreserved: 'Recall preserved',
        indexTreeShadowDroppedPaths: 'Dropped paths',
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock('@/hooks/useIndexTree', () => ({
  useIndexTreeDiscover: (request: unknown) => mockUseIndexTreeDiscover(request),
  useIndexTreeNavigate: (request: unknown) => mockUseIndexTreeNavigate(request),
  useIndexTreeEnsure: (request: unknown, enabled?: boolean) => mockUseIndexTreeEnsure(request, enabled),
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

const discoverQuery = {
  data: {
    success: true,
    schema_version: 'm31.index_tree.v1',
    command: 'index-tree.discover',
    generated_at: '2026-05-31T00:00:00Z',
    data: {
      truth_source: 'journals',
      privacy_level: 'same_as_journals',
      selection_contract: 'host_agent_selects_values; tool_executes_only',
      facets: {
        topic: {
          facet: 'topic',
          value_count: 1,
          values: [
            {
              value: 'work',
              count: 2,
              sample_entry_pointers: ['Journals/2026/05/life-index_2026-05-01_001.md'],
              raw_values: ['work'],
            },
          ],
        },
      },
      freshness: { fresh: true },
      fallback: { used: false, reason: null },
    },
    errors: [],
  },
  isLoading: false,
  isError: false,
};

function navigateQuery(request: { filters?: Array<{ facet: string; values: string[] }> }) {
  const selected = request.filters?.[0]?.values?.[0];
  return {
    data: selected
      ? {
          success: true,
          schema_version: 'm31.index_tree.v1',
          command: 'index-tree.navigate',
          generated_at: '2026-05-31T00:00:00Z',
          data: {
            truth_source: 'journals',
            privacy_level: 'same_as_journals',
            entry_pointers: ['Journals/2026/05/life-index_2026-05-01_001.md'],
            entries: [
              {
                relative_path: 'Journals/2026/05/life-index_2026-05-01_001.md',
                title: 'Work note',
              },
            ],
            freshness: { fresh: true },
            fallback: { used: false, reason: null },
          },
          errors: [],
        }
      : undefined,
    isLoading: false,
    isError: false,
  };
}

function ensureQuery() {
  return {
    data: {
      success: true,
      schema_version: 'm31.index_tree.v1',
      command: 'index-tree.ensure',
      generated_at: '2026-05-31T00:00:00Z',
      data: {
        truth_source: 'journals',
        freshness: { fresh: false },
        fallback: {
          used: true,
          reason: 'index_b_stale',
          journal_fallback_pointers: ['Journals/2026/05/life-index_2026-05-01_001.md'],
        },
      },
      errors: [],
    },
    isLoading: false,
    isError: false,
  };
}

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
  mockUseIndexTreeDiscover.mockReturnValue(discoverQuery);
  mockUseIndexTreeNavigate.mockImplementation(navigateQuery);
  mockUseIndexTreeEnsure.mockImplementation(ensureQuery);
  mockUseIndexTreeShadow.mockImplementation(shadowQuery);
});

describe('IndexTreeDiagnostics canonical surface', () => {
  it('renders discover facets as host/user-selected navigation values', () => {
    renderIndexTreeDiagnostics();

    expect(screen.getByTestId('index-tree-diagnostics-page')).toBeInTheDocument();
    expect(screen.getByText('Index Tree Evidence Navigation')).toBeInTheDocument();
    expect(screen.getByText('Host/user selects values; the tool only executes deterministic navigation.')).toBeInTheDocument();
    expect(screen.getByTestId('index-tree-discover-value').textContent).toContain('work');
    expect(screen.getByTestId('index-tree-discover-value').textContent).toContain('2');
    expect(screen.getByText('Journals/2026/05/life-index_2026-05-01_001.md')).toBeInTheDocument();
  });

  it('uses a discovered facet value to drive navigate and render real journal pointers', () => {
    renderIndexTreeDiagnostics();

    fireEvent.click(screen.getByRole('button', { name: /work/ }));

    expect(mockUseIndexTreeNavigate).toHaveBeenLastCalledWith({
      filters: [{ facet: 'topic', values: ['work'] }],
    });
    expect(screen.getByTestId('index-tree-navigate-result').textContent).toContain('Work note');
    expect(screen.getByRole('link', { name: /life-index_2026-05-01_001.md/ })).toHaveAttribute(
      'href',
      '/journal/Journals/2026/05/life-index_2026-05-01_001.md',
    );
  });

  it('shows ensure journal fallback when discover reports stale freshness', () => {
    mockUseIndexTreeDiscover.mockReturnValue({
      ...discoverQuery,
      data: {
        ...discoverQuery.data,
        data: {
          ...discoverQuery.data.data,
          freshness: { fresh: false },
        },
      },
    });

    renderIndexTreeDiagnostics();

    expect(mockUseIndexTreeEnsure).toHaveBeenCalledWith({}, true);
    expect(screen.getByTestId('index-tree-fallback').textContent).toContain('index_b_stale');
    expect(screen.getByTestId('index-tree-fallback').textContent).toContain('life-index_2026-05-01_001.md');
  });

  it('shows unavailable copy when discover fails', () => {
    mockUseIndexTreeDiscover.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    renderIndexTreeDiagnostics();

    expect(screen.getByText('Index tree diagnostics unavailable.')).toBeInTheDocument();
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
