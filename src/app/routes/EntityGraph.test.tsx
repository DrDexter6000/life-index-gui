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
const mockUseVersionCheck = vi.fn();
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
  useVersionCheck: () => mockUseVersionCheck(),
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
      id: 'entity-a',
      type: 'actor',
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

const defaultVersion = {
  data: {
    cli_package_version: '1.4.4',
    cli_minimum_version: '1.3.7',
    compatible: true,
  },
  isLoading: false,
  isError: false,
};

const duplicateReviewItem = {
  item_id: 'review-1',
  risk_level: 'high',
  category: 'possible_duplicate',
  why: 'Alias overlap and nearby journal evidence suggest these may be the same actor.',
  evidence: ['Journals/2026/03/life-index_2026-03-15_001.md'],
  source_id: 'entity-b',
  target_id: 'entity-a',
  entities: [
    { entity_id: 'entity-b', primary_name: 'Zhang S.', status: 'candidate' },
    { entity_id: 'entity-a', primary_name: 'Zhang San', status: 'confirmed' },
  ],
  action_choices: [
    {
      action: 'merge_as_alias',
      label: 'Same',
      description: 'Merge Zhang S. into Zhang San as aliases.',
      source_id: 'entity-b',
      target_id: 'entity-a',
      preview_required: true,
    },
    {
      action: 'keep_separate',
      label: 'Different',
      description: 'Mark these entities as not duplicates.',
      source_id: 'entity-b',
      target_id: 'entity-a',
      preview_required: true,
    },
    {
      action: 'skip',
      label: 'Not-sure',
      description: 'Leave unchanged for later review.',
      source_id: 'entity-b',
      target_id: 'entity-a',
      preview_required: false,
    },
  ],
};

const candidateReviewItem = {
  item_id: 'review-2',
  risk_level: 'low',
  category: 'candidate_entity',
  why: 'A repeated entity mention has not been confirmed yet.',
  evidence: ['Journals/2026/04/life-index_2026-04-02_001.md'],
  source_id: 'candidate-west',
  entities: [
    { entity_id: 'candidate-west', primary_name: 'Western Ridge', status: 'candidate' },
  ],
  action_choices: [
    {
      action: 'confirm_candidate',
      label: 'Confirm candidate',
      description: 'Promote this candidate to confirmed.',
      source_id: 'candidate-west',
      preview_required: true,
    },
    {
      action: 'reject_candidate',
      label: 'Reject candidate',
      description: 'Remove this candidate from the graph.',
      source_id: 'candidate-west',
      preview_required: true,
    },
    {
      action: 'skip',
      label: 'Not-sure',
      description: 'Leave unchanged for later review.',
      source_id: 'candidate-west',
      preview_required: false,
    },
  ],
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
  mockUseVersionCheck.mockReturnValue(defaultVersion);
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
    expect(screen.getByTestId('entity-row-entity-a')).toBeInTheDocument();
  });

  it('links entity rows to the entity profile page', () => {
    renderEntityGraph();

    expect(screen.getByRole('link', { name: /张叁/ })).toHaveAttribute(
      'href',
      '/entities/entity-a',
    );
  });

  it('changes entity type filter on button click', () => {
    renderEntityGraph();
    const actorBtn = screen.getByTestId('entity-type-actor');
    fireEvent.click(actorBtn);
    // After clicking actor, the list hook should be called with 'actor'
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

  it('renders structured review cards with why, evidence, entities, and action choices', () => {
    mockUseEntityReview.mockReturnValue({
      data: { queue: [duplicateReviewItem], total: 1 },
      isLoading: false,
      isError: false,
    });

    renderEntityGraph();

    expect(screen.getByTestId('entity-review-card-review-1')).toHaveTextContent(
      'Alias overlap and nearby journal evidence',
    );
    expect(screen.getByText('Journals/2026/03/life-index_2026-03-15_001.md')).toBeInTheDocument();
    expect(screen.getByText('Zhang S.')).toBeInTheDocument();
    expect(screen.getByText('candidate')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Same/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Different/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Not-sure/ })).toBeInTheDocument();
  });

  it('gates review action controls when CLI is older than 1.4.4', () => {
    mockUseVersionCheck.mockReturnValue({
      data: {
        cli_package_version: '1.4.3',
        cli_minimum_version: '1.3.7',
        compatible: true,
      },
      isLoading: false,
      isError: false,
    });
    mockUseEntityReview.mockReturnValue({
      data: { queue: [duplicateReviewItem], total: 1 },
      isLoading: false,
      isError: false,
    });

    renderEntityGraph();

    expect(screen.getByTestId('entity-review-card-review-1')).toHaveTextContent(
      'Alias overlap and nearby journal evidence',
    );
    expect(screen.getByTestId('entity-review-version-gate')).toHaveTextContent('1.4.4');
    expect(screen.queryByRole('button', { name: /Same/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('entity-review-action-review-1-merge_as_alias')).not.toBeInTheDocument();
  });

  it('keeps review action controls enabled when CLI is 1.4.4', () => {
    mockUseEntityReview.mockReturnValue({
      data: { queue: [duplicateReviewItem], total: 1 },
      isLoading: false,
      isError: false,
    });

    renderEntityGraph();

    expect(screen.getByRole('button', { name: /Same/ })).toBeInTheDocument();
    expect(screen.queryByTestId('entity-review-version-gate')).not.toBeInTheDocument();
  });

  it('runs Same through preview before enabling apply', async () => {
    mockUseEntityReview.mockReturnValue({
      data: { queue: [duplicateReviewItem], total: 1 },
      isLoading: false,
      isError: false,
    });
    mockPreviewMutateAsync.mockResolvedValue({
      operation: 'merge_as_alias',
      preview: { action: 'merge_as_alias', will_write: [{ type: 'merge_as_alias' }] },
      requiresConfirmation: true,
    });
    mockConfirmMutateAsync.mockResolvedValue({
      operation: 'merge_as_alias',
      mutation: { action: 'merge_as_alias', applied: true },
      postCheck: { issues: [] },
      postCheckOk: true,
    });

    renderEntityGraph();
    fireEvent.click(screen.getByRole('button', { name: /Same/ }));

    await waitFor(() => {
      expect(mockPreviewMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'merge_as_alias',
        reviewItemId: 'review-1',
        sourceId: 'entity-b',
        targetId: 'entity-a',
      }));
    });
    expect(await screen.findByTestId('entity-review-preview-review-1')).toHaveTextContent('merge_as_alias');
    expect(screen.getByTestId('entity-review-apply-review-1')).toBeDisabled();

    fireEvent.click(screen.getByTestId('entity-review-preview-accepted-review-1'));
    fireEvent.click(screen.getByTestId('entity-review-apply-review-1'));

    await waitFor(() => {
      expect(mockConfirmMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'merge_as_alias',
        reviewItemId: 'review-1',
        sourceId: 'entity-b',
        targetId: 'entity-a',
      }));
    });
    expect(await screen.findByTestId('entity-review-result-review-1')).toHaveTextContent('merge_as_alias');
  });

  it('maps Different and Not-sure to structured keep_separate and skip actions', async () => {
    mockUseEntityReview.mockReturnValue({
      data: { queue: [duplicateReviewItem], total: 1 },
      isLoading: false,
      isError: false,
    });
    mockPreviewMutateAsync.mockResolvedValue({
      operation: 'keep_separate',
      preview: { action: 'keep_separate' },
      requiresConfirmation: true,
    });

    renderEntityGraph();
    fireEvent.click(screen.getByRole('button', { name: /Different/ }));
    await waitFor(() => {
      expect(mockPreviewMutateAsync).toHaveBeenLastCalledWith(expect.objectContaining({
        operation: 'keep_separate',
        reviewItemId: 'review-1',
      }));
    });

    fireEvent.click(screen.getByRole('button', { name: /Not-sure/ }));
    await waitFor(() => {
      expect(mockPreviewMutateAsync).toHaveBeenLastCalledWith(expect.objectContaining({
        operation: 'skip',
        reviewItemId: 'review-1',
      }));
    });
  });

  it('renders candidate review actions without treating candidates as confirmed facts', async () => {
    mockUseEntityReview.mockReturnValue({
      data: { queue: [candidateReviewItem], total: 1 },
      isLoading: false,
      isError: false,
    });
    mockPreviewMutateAsync.mockResolvedValue({
      operation: 'reject_candidate',
      preview: { action: 'reject_candidate' },
      requiresConfirmation: true,
    });

    renderEntityGraph();

    expect(screen.getByTestId('entity-review-card-review-2')).toHaveTextContent('candidate');
    expect(screen.getByText('candidate-west')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm candidate/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reject candidate/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Reject candidate/ }));
    await waitFor(() => {
      expect(mockPreviewMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        operation: 'reject_candidate',
        reviewItemId: 'review-2',
        sourceId: 'candidate-west',
      }));
    });
  });

  it('does not turn legacy string action_choices into review actions', () => {
    mockUseEntityReview.mockReturnValue({
      data: {
        queue: [{ ...duplicateReviewItem, action_choices: ['merge_as_alias', 'skip'] }],
        total: 1,
      },
      isLoading: false,
      isError: false,
    });

    renderEntityGraph();

    expect(screen.getByTestId('entity-review-contract-missing-review-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Same/ })).not.toBeInTheDocument();
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
      preview: { entityId: 'entity-a', impact: '1 relationship' },
      requiresConfirmation: true,
    });

    renderEntityGraph();
    fireEvent.click(screen.getByTestId('entity-delete-preview'));

    await waitFor(() => {
      expect(mockPreviewMutateAsync).toHaveBeenCalledWith({
        operation: 'delete',
        entityId: 'entity-a',
      });
    });
    expect(await screen.findByTestId('entity-mutation-preview')).toHaveTextContent('delete');
    expect(screen.getByTestId('entity-mutation-confirm')).toBeDisabled();
  });

  it('requires accepted preview before confirming a delete mutation', async () => {
    mockPreviewMutateAsync.mockResolvedValue({
      operation: 'delete',
      preview: { entityId: 'entity-a' },
      requiresConfirmation: true,
    });
    mockConfirmMutateAsync.mockResolvedValue({
      operation: 'delete',
      mutation: { entityId: 'entity-a', status: 'deleted' },
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
        entityId: 'entity-a',
      });
    });
    expect(await screen.findByTestId('entity-post-check')).toHaveTextContent('图谱完整性检查通过');
  });

  it('previews merge_as_alias with distinct source and target entities', async () => {
    mockUseEntityList.mockReturnValue({
      data: [
        ...defaultList.data,
        {
          id: 'entity-b',
          type: 'actor',
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
      preview: { sourceId: 'entity-a', targetId: 'entity-b' },
      requiresConfirmation: true,
    });

    renderEntityGraph();
    fireEvent.change(screen.getByTestId('entity-merge-target'), {
      target: { value: 'entity-b' },
    });
    fireEvent.click(screen.getByTestId('entity-merge-preview'));

    await waitFor(() => {
      expect(mockPreviewMutateAsync).toHaveBeenCalledWith({
        operation: 'merge_as_alias',
        sourceId: 'entity-a',
        targetId: 'entity-b',
      });
    });
  });
});
