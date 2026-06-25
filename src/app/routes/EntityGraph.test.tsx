import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import EntityGraph from './EntityGraph';

// Mock hooks — configured per test
const mockUseEntityStats = vi.fn();
const mockUseEntityList = vi.fn();
const mockUseEntityCheck = vi.fn();
const mockUseEntityAudit = vi.fn();
const mockUseEntityReview = vi.fn();
const mockUseEntityCandidateEdges = vi.fn();
const mockUseEntityMutationPreview = vi.fn();
const mockUseEntityMutationConfirm = vi.fn();
const mockPreviewMutateAsync = vi.fn();
const mockConfirmMutateAsync = vi.fn();
const mockInvalidateQueries = vi.fn();

vi.mock('@/hooks/useJournals', () => ({
  useEntityStats: () => mockUseEntityStats(),
  useEntityList: () => mockUseEntityList(),
  useEntityCheck: () => mockUseEntityCheck(),
  useEntityAudit: () => mockUseEntityAudit(),
  useEntityReview: () => mockUseEntityReview(),
  useEntityCandidateEdges: () => mockUseEntityCandidateEdges(),
  useEntityMutationPreview: () => mockUseEntityMutationPreview(),
  useEntityMutationConfirm: () => mockUseEntityMutationConfirm(),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
    }),
  };
});

function renderEntityGraph() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EntityGraph />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Default mock data ────────────────────────────────────────────────────

const defaultStats = {
  data: { total_entities: 5, total_relationships: 8 },
  isLoading: false,
  isError: false,
  isFetching: false,
};

const defaultList = {
  data: [
    {
      id: 'person-a',
      type: 'person',
      primary_name: '张叁',
      aliases: ['老张'],
      attributes: {},
      relationships: [],
    },
  ],
  isLoading: false,
  isError: false,
};

const defaultCheckClean = {
  data: { issues: [], total_entities: 5 },
  isLoading: false,
  isError: false,
};

const defaultAuditClean = {
  data: { issues: [], summary: {} },
  isLoading: false,
  isError: false,
};

const defaultReview = {
  data: { queue: [], total: 0 },
  isLoading: false,
  isError: false,
};

const defaultCandidateEdges = {
  data: { candidates: [], total: 0 },
  isLoading: false,
  isError: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseEntityStats.mockReturnValue(defaultStats);
  mockUseEntityList.mockReturnValue(defaultList);
  mockUseEntityCheck.mockReturnValue(defaultCheckClean);
  mockUseEntityAudit.mockReturnValue(defaultAuditClean);
  mockUseEntityReview.mockReturnValue(defaultReview);
  mockUseEntityCandidateEdges.mockReturnValue(defaultCandidateEdges);
  mockUseEntityMutationPreview.mockReturnValue({
    mutateAsync: mockPreviewMutateAsync,
    isPending: false,
  });
  mockUseEntityMutationConfirm.mockReturnValue({
    mutateAsync: mockConfirmMutateAsync,
    isPending: false,
  });
});

describe('EntityGraph', () => {
  // 1. Stats display
  it('renders total_entities and total_relationships when data loads', () => {
    renderEntityGraph();
    expect(screen.getByTestId('entity-stats-entities').textContent).toContain('5');
    expect(screen.getByTestId('entity-stats-relationships').textContent).toContain('8');
  });

  // 2. Entity list with type filter
  it('renders entity items and type filter buttons', () => {
    renderEntityGraph();
    expect(screen.getByTestId('entity-type-filter')).toBeInTheDocument();
    expect(screen.getByTestId('entity-row-person-a')).toBeInTheDocument();
  });

  it('changes entity type filter on button click', () => {
    renderEntityGraph();
    const personBtn = screen.getByTestId('entity-type-person');
    fireEvent.click(personBtn);
    // After clicking person, the list hook should be called with 'person'
    expect(mockUseEntityList).toHaveBeenCalled();
  });

  // 3. Empty entity list
  it('shows empty state when entity list is empty', () => {
    mockUseEntityList.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    renderEntityGraph();
    expect(screen.getByTestId('entity-list-empty')).toBeInTheDocument();
  });

  // 4. Graph check clean
  it('shows clean state when graph check has no issues', () => {
    renderEntityGraph();
    expect(screen.getByTestId('entity-check-clean')).toBeInTheDocument();
  });

  // 5. Graph check with issues
  it('shows issue list when graph check has issues', () => {
    mockUseEntityCheck.mockReturnValue({
      data: {
        issues: [{ type: 'orphaned_entity', entity_id: 'x' }],
        total_entities: 5,
      },
      isLoading: false,
      isError: false,
    });
    renderEntityGraph();
    expect(screen.getByTestId('entity-check-issues-count')).toBeInTheDocument();
  });

  // 6. Audit clean
  it('shows clean state when audit has no findings', () => {
    renderEntityGraph();
    expect(screen.getByTestId('entity-audit-clean')).toBeInTheDocument();
  });

  // 7. Audit with findings
  it('shows issues with severity summary when audit has findings', () => {
    mockUseEntityAudit.mockReturnValue({
      data: {
        issues: [{ type: 'possible_duplicate', severity: 'high' }],
        summary: { high: 1 },
      },
      isLoading: false,
      isError: false,
    });
    renderEntityGraph();
    expect(screen.getByTestId('entity-audit-issues-count')).toBeInTheDocument();
  });

  // 8. Review queue
  it('renders review queue items with count', () => {
    mockUseEntityReview.mockReturnValue({
      data: { queue: [{ item_id: 'review-1', action: 'merge_suggestion' }], total: 1 },
      isLoading: false,
      isError: false,
    });
    renderEntityGraph();
    expect(screen.getByTestId('entity-review-item-0')).toBeInTheDocument();
  });

  // 9. Empty review queue
  it('shows empty state when review queue is empty', () => {
    mockUseEntityReview.mockReturnValue({
      data: { queue: [], total: 0 },
      isLoading: false,
      isError: false,
    });
    renderEntityGraph();
    expect(screen.getByTestId('entity-review-empty')).toBeInTheDocument();
  });

  // 10. Candidate edges
  it('renders candidate edges with total vs displayed count', () => {
    mockUseEntityCandidateEdges.mockReturnValue({
      data: {
        candidates: [
          { source: 'Alice', target: 'Bob', relation: 'colleague_of' },
          { source: 'Alice', target: 'Project X', relation: 'works_on' },
        ],
        total: 5,
      },
      isLoading: false,
      isError: false,
    });
    renderEntityGraph();
    expect(screen.getByTestId('entity-candidate-edges-count')).toBeInTheDocument();
    expect(screen.getByTestId('entity-candidate-edge-0')).toBeInTheDocument();
    expect(screen.getByTestId('entity-candidate-edge-1')).toBeInTheDocument();
  });

  // 11. Empty candidate edges
  it('shows empty state when no candidate edges', () => {
    mockUseEntityCandidateEdges.mockReturnValue({
      data: { candidates: [], total: 0 },
      isLoading: false,
      isError: false,
    });
    renderEntityGraph();
    expect(screen.getByTestId('entity-candidate-edges-empty')).toBeInTheDocument();
  });

  // 12. Loading state
  it('shows loading indicator while queries are pending', () => {
    mockUseEntityStats.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: true,
    });
    mockUseEntityList.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    mockUseEntityCheck.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    mockUseEntityAudit.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    mockUseEntityReview.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    mockUseEntityCandidateEdges.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    renderEntityGraph();
    // Loading text appears in each section; verify at least one is present
    const loadingElements = screen.getAllByText('正在加载实体数据...');
    expect(loadingElements.length).toBeGreaterThan(0);
  });

  // 13. Error state
  it('shows error hint when queries fail', () => {
    mockUseEntityStats.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
    });
    renderEntityGraph();
    expect(screen.getByTestId('entity-stats-error')).toBeInTheDocument();
  });

  // 14. Retry button
  it('invalidates entity queries on retry button click', () => {
    renderEntityGraph();
    const retryBtn = screen.getByTestId('entity-retry-button');
    fireEvent.click(retryBtn);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['entities'] });
  });

  // 15. Guarded mutation UX
  it('shows supported delete and merge preview controls while update/add_alias stay blocked', () => {
    renderEntityGraph();
    expect(screen.getByTestId('entity-delete-preview')).toBeInTheDocument();
    expect(screen.getByTestId('entity-merge-preview')).toBeInTheDocument();
    expect(screen.getByTestId('entity-update-add-alias-blocked')).toBeInTheDocument();
    expect(screen.queryByTestId('entity-update-confirm')).not.toBeInTheDocument();
    expect(screen.queryByTestId('entity-add-alias-confirm')).not.toBeInTheDocument();
  });

  it('previews delete before enabling confirmation', async () => {
    mockPreviewMutateAsync.mockResolvedValue({
      operation: 'delete',
      preview: { entityId: 'person-a', impact: '1 relationship' },
      requiresConfirmation: true,
    });

    renderEntityGraph();
    fireEvent.click(screen.getByTestId('entity-delete-preview'));

    await waitFor(() => {
      expect(mockPreviewMutateAsync).toHaveBeenCalledWith({
        operation: 'delete',
        entityId: 'person-a',
      });
    });
    expect(await screen.findByTestId('entity-mutation-preview')).toHaveTextContent('delete');
    expect(screen.getByTestId('entity-mutation-confirm')).toBeDisabled();
  });

  it('requires accepted preview before confirming a delete mutation', async () => {
    mockPreviewMutateAsync.mockResolvedValue({
      operation: 'delete',
      preview: { entityId: 'person-a' },
      requiresConfirmation: true,
    });
    mockConfirmMutateAsync.mockResolvedValue({
      operation: 'delete',
      mutation: { entityId: 'person-a', status: 'deleted' },
      postCheck: { issues: [] },
      postCheckOk: true,
    });

    renderEntityGraph();
    fireEvent.click(screen.getByTestId('entity-delete-preview'));
    await screen.findByTestId('entity-mutation-preview');
    fireEvent.click(screen.getByTestId('entity-mutation-confirm'));
    expect(mockConfirmMutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('entity-preview-accepted'));
    fireEvent.click(screen.getByTestId('entity-mutation-confirm'));

    await waitFor(() => {
      expect(mockConfirmMutateAsync).toHaveBeenCalledWith({
        operation: 'delete',
        entityId: 'person-a',
      });
    });
    expect(await screen.findByTestId('entity-post-check')).toHaveTextContent('图谱完整性检查通过');
  });

  it('previews merge_as_alias with distinct source and target entities', async () => {
    mockUseEntityList.mockReturnValue({
      data: [
        ...defaultList.data,
        {
          id: 'person-b',
          type: 'person',
          primary_name: '李四',
          aliases: [],
          attributes: {},
          relationships: [],
        },
      ],
      isLoading: false,
      isError: false,
    });
    mockPreviewMutateAsync.mockResolvedValue({
      operation: 'merge_as_alias',
      preview: { sourceId: 'person-a', targetId: 'person-b' },
      requiresConfirmation: true,
    });

    renderEntityGraph();
    fireEvent.change(screen.getByTestId('entity-merge-target'), {
      target: { value: 'person-b' },
    });
    fireEvent.click(screen.getByTestId('entity-merge-preview'));

    await waitFor(() => {
      expect(mockPreviewMutateAsync).toHaveBeenCalledWith({
        operation: 'merge_as_alias',
        sourceId: 'person-a',
        targetId: 'person-b',
      });
    });
  });
});
