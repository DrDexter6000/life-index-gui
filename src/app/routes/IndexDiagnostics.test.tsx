import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import IndexDiagnostics from './IndexDiagnostics';

// Mock hooks
const mockUseIndexCheck = vi.fn();
const mockUseIndexVerify = vi.fn();
const mockUseIndexCacheDryRun = vi.fn();
const mockUseMaintenanceAudit = vi.fn();
const mockUseMaintenancePlan = vi.fn();
const mockUseMaintenanceDryRun = vi.fn();
const mockUseMaintenanceRepairApply = vi.fn();
const mockInvalidateQueries = vi.fn();
const mockMaintenanceAuditRefetch = vi.fn();
const mockRepairApplyMutate = vi.fn();

vi.mock('@/hooks/useJournals', () => ({
  useIndexCheck: () => mockUseIndexCheck(),
  useIndexVerify: () => mockUseIndexVerify(),
  useIndexCacheDryRun: () => mockUseIndexCacheDryRun(),
  indexDiagnosticsKeys: { all: ['index-diagnostics'] },
}));

vi.mock('@/hooks/useMaintenanceRepair', () => ({
  useMaintenanceAudit: () => mockUseMaintenanceAudit(),
  useMaintenancePlan: (issueId?: string) => mockUseMaintenancePlan(issueId),
  useMaintenanceDryRun: (issueId?: string) => mockUseMaintenanceDryRun(issueId),
  useMaintenanceRepairApply: () => mockUseMaintenanceRepairApply(),
  maintenanceKeys: { all: ['maintenance'] },
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

function renderIndexDiagnostics() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <IndexDiagnostics />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Default healthy payloads ───────────────────────────────────────────────

const healthyCheck = {
  data: {
    healthy: true,
    fts_count: 50,
    vector_count: 50,
    file_count: 50,
    issues: [],
  },
  isLoading: false,
  isError: false,
  isFetching: false,
};

const unhealthyCheck = {
  data: {
    healthy: false,
    fts_count: 0,
    vector_count: 0,
    file_count: 50,
    issues: ['no_fts_index', 'no_vector_index'],
  },
  isLoading: false,
  isError: false,
  isFetching: false,
};

const cleanVerify = {
  data: {
    success: true,
    total_journals: 42,
    checks: [{ name: 'frontmatter', passed: true }],
    issues_count: 0,
    suggestion: null,
  },
  isLoading: false,
  isError: false,
};

const issuesVerify = {
  data: {
    success: true,
    total_journals: 42,
    issues_count: 2,
    suggestion: 'Review orphan references',
  },
  isLoading: false,
  isError: false,
};

const upToDateCache = {
  data: {
    success: true,
    dry_run: true,
    cache_version: { would_rebuild: false, reasons: [] },
  },
  isLoading: false,
  isError: false,
};

const rebuildNeededCache = {
  data: {
    success: true,
    dry_run: true,
    cache_version: { would_rebuild: true, reasons: ['no_existing_version'] },
  },
  isLoading: false,
  isError: false,
};

const maintenanceIssue = {
  issue_id: 'index.cache_stale:journal-index',
  domain: 'index',
  severity: 'warning',
  summary: 'Index cache is stale',
};

const maintenanceAuditWithIssue = {
  data: {
    schema_version: 'm33.maintenance_audit.v0',
    issues: [maintenanceIssue],
  },
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: mockMaintenanceAuditRefetch,
};

const maintenancePlan = {
  schema_version: 'm33.maintenance_plan.v0',
  issue_id: maintenanceIssue.issue_id,
  repairable: true,
  path: 'generated/index-cache.json',
};

const maintenanceDryRun = {
  schema_version: 'm33.maintenance_repair.v0',
  issue_id: maintenanceIssue.issue_id,
  dry_run: true,
  planned_paths: ['generated/index-cache.json'],
  changed_paths: [],
  applied: false,
};

const maintenanceApplyResult = {
  schema_version: 'm33.maintenance_repair.v0',
  issue_id: maintenanceIssue.issue_id,
  dry_run: false,
  planned_paths: ['generated/index-cache.json'],
  changed_paths: ['generated/index-cache.json'],
  applied: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseIndexCheck.mockReturnValue(healthyCheck);
  mockUseIndexVerify.mockReturnValue(cleanVerify);
  mockUseIndexCacheDryRun.mockReturnValue(upToDateCache);
  mockMaintenanceAuditRefetch.mockResolvedValue({
    data: {
      schema_version: 'm33.maintenance_audit.v0',
      issues: [],
    },
  });
  mockUseMaintenanceAudit.mockReturnValue(maintenanceAuditWithIssue);
  mockUseMaintenancePlan.mockImplementation((issueId?: string) => ({
    data: issueId ? maintenancePlan : undefined,
    isLoading: false,
    isError: false,
  }));
  mockUseMaintenanceDryRun.mockImplementation((issueId?: string) => ({
    data: issueId ? maintenanceDryRun : undefined,
    isLoading: false,
    isError: false,
  }));
  mockRepairApplyMutate.mockImplementation((_req, options) => {
    options?.onSuccess?.(maintenanceApplyResult);
  });
  mockUseMaintenanceRepairApply.mockReturnValue({
    mutate: mockRepairApplyMutate,
    isPending: false,
    isError: false,
    error: null,
  });
});

describe('IndexDiagnostics', () => {
  // ── Index health card ──────────────────────────────────────────────────

  it('renders healthy index state with check_circle icon', () => {
    renderIndexDiagnostics();
    expect(screen.getByTestId('index-health-icon').textContent).toContain('check_circle');
    expect(screen.getByTestId('index-health-status').textContent).toContain('正常');
  });

  it('renders unhealthy index state with warning icon and issues', () => {
    mockUseIndexCheck.mockReturnValue(unhealthyCheck);
    renderIndexDiagnostics();
    expect(screen.getByTestId('index-health-icon').textContent).toContain('warning');
    expect(screen.getByTestId('index-health-status').textContent).toContain('需要关注');
    expect(screen.getByTestId('index-issues-list')).toBeInTheDocument();
    expect(screen.getByText('no_fts_index')).toBeInTheDocument();
  });

  it('renders index check error state', () => {
    mockUseIndexCheck.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
    });
    renderIndexDiagnostics();
    expect(screen.getByTestId('index-health-icon').textContent).toContain('error');
  });

  it('shows index counts when available', () => {
    renderIndexDiagnostics();
    expect(screen.getByTestId('index-counts')).toBeInTheDocument();
    expect(screen.getByText('FTS')).toBeInTheDocument();
    expect(screen.queryByText('Vector')).not.toBeInTheDocument();
  });

  // ── Verify card ────────────────────────────────────────────────────────

  it('renders clean verify state', () => {
    renderIndexDiagnostics();
    expect(screen.getByTestId('verify-status-icon').textContent).toContain('verified');
    expect(screen.getByTestId('verify-status').textContent).toContain('完整性校验通过');
  });

  it('renders verify issues with suggestion', () => {
    mockUseIndexVerify.mockReturnValue(issuesVerify);
    renderIndexDiagnostics();
    expect(screen.getByTestId('verify-status-icon').textContent).toContain('warning');
    expect(screen.getByTestId('verify-suggestion').textContent).toContain('Review orphan references');
  });

  it('renders verify error gracefully', () => {
    mockUseIndexVerify.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    renderIndexDiagnostics();
    expect(screen.getByTestId('verify-status-icon').textContent).toContain('error');
    expect(screen.getByTestId('verify-error')).toBeInTheDocument();
  });

  // ── Cache dry-run card ─────────────────────────────────────────────────

  it('renders up-to-date cache state', () => {
    renderIndexDiagnostics();
    expect(screen.getByTestId('cache-status-icon').textContent).toContain('cloud_done');
    expect(screen.getByTestId('cache-status').textContent).toContain('缓存最新');
  });

  it('renders cache rebuild needed with reasons', () => {
    mockUseIndexCacheDryRun.mockReturnValue(rebuildNeededCache);
    renderIndexDiagnostics();
    expect(screen.getByTestId('cache-status-icon').textContent).toContain('sync_problem');
    expect(screen.getByTestId('cache-status').textContent).toContain('缓存需要重建');
    expect(screen.getByTestId('cache-reasons')).toBeInTheDocument();
    expect(screen.getByText('no_existing_version')).toBeInTheDocument();
  });

  it('renders cache error gracefully', () => {
    mockUseIndexCacheDryRun.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    renderIndexDiagnostics();
    expect(screen.getByTestId('cache-status-icon').textContent).toContain('error');
    expect(screen.getByTestId('cache-error')).toBeInTheDocument();
  });

  // ── Data Doctor repair workbench ───────────────────────────────────────

  it('renders Data Doctor repair workbench from maintenance audit issues', () => {
    renderIndexDiagnostics();
    expect(screen.getByText('数据医生')).toBeInTheDocument();
    expect(screen.getByTestId('data-doctor-issues-list')).toBeInTheDocument();
    expect(screen.getByTestId(`issue-row-${maintenanceIssue.issue_id}`)).toBeInTheDocument();
    expect(screen.queryByTestId('repair-blocked-card')).not.toBeInTheDocument();
  });

  it('requires explicit plan and dry-run actions after issue selection', () => {
    renderIndexDiagnostics();
    fireEvent.click(screen.getByTestId(`issue-row-${maintenanceIssue.issue_id}`));

    expect(screen.queryByTestId('data-doctor-plan-section')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('plan-button'));
    expect(screen.getByTestId('data-doctor-plan-section')).toBeInTheDocument();

    expect(screen.queryByTestId('data-doctor-dryrun-section')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('dryrun-button'));
    expect(screen.getByTestId('data-doctor-dryrun-section')).toBeInTheDocument();
  });

  it('sends apply only after dry-run success and explicit confirmation', () => {
    renderIndexDiagnostics();
    fireEvent.click(screen.getByTestId(`issue-row-${maintenanceIssue.issue_id}`));
    fireEvent.click(screen.getByTestId('plan-button'));
    fireEvent.click(screen.getByTestId('dryrun-button'));

    const applyButton = screen.getByTestId('apply-button');
    expect(applyButton).toBeDisabled();

    fireEvent.click(screen.getByTestId('confirm-checkbox'));
    expect(screen.getByTestId('apply-button')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('apply-button'));

    expect(mockRepairApplyMutate).toHaveBeenCalledWith(
      { issueId: maintenanceIssue.issue_id, confirmed: true },
      expect.any(Object),
    );
  });

  it('runs post-check from a refreshed maintenance audit after apply', async () => {
    renderIndexDiagnostics();
    fireEvent.click(screen.getByTestId(`issue-row-${maintenanceIssue.issue_id}`));
    fireEvent.click(screen.getByTestId('plan-button'));
    fireEvent.click(screen.getByTestId('dryrun-button'));
    fireEvent.click(screen.getByTestId('confirm-checkbox'));
    fireEvent.click(screen.getByTestId('apply-button'));

    expect(screen.getByTestId('apply-result-section')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('postcheck-button'));

    await waitFor(() => expect(mockMaintenanceAuditRefetch).toHaveBeenCalledTimes(1));
    expect(screen.getByText('后验检查未再发现该问题')).toBeInTheDocument();
  });

  it('does not expose direct rebuild controls on the repair surface', () => {
    renderIndexDiagnostics();
    expect(screen.queryByTestId('rebuild-blocked-item')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tree-rebuild-blocked-item')).not.toBeInTheDocument();
    expect(screen.queryByText('索引重建暂不可用')).not.toBeInTheDocument();
    expect(screen.queryByText('目录重建暂不可用')).not.toBeInTheDocument();
  });

  // ── Retry ──────────────────────────────────────────────────────────────

  it('retry button invalidates index diagnostics queries', () => {
    renderIndexDiagnostics();
    const retryBtn = screen.getByTestId('index-retry-button');
    fireEvent.click(retryBtn);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['index-diagnostics'] });
  });

  it('links to the read-only index tree diagnostics route', () => {
    renderIndexDiagnostics();
    expect(screen.getByTestId('index-tree-nav-link')).toHaveAttribute(
      'href',
      '/maintenance/index-tree',
    );
  });

  // ── Loading state ──────────────────────────────────────────────────────

  it('renders loading state for index check', () => {
    mockUseIndexCheck.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: true,
    });
    renderIndexDiagnostics();
    // The loading card shows a loader, health icon is not present yet
    expect(screen.queryByTestId('index-health-icon')).not.toBeInTheDocument();
  });
});
