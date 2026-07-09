import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import HealthCenter from './HealthCenter';

// Mock hooks — configured per test
const mockUseHealthCheck = vi.fn();
const mockUseDataAudit = vi.fn();
const mockUseIndexCheck = vi.fn();
const mockUseIndexVerify = vi.fn();
const mockUseIndexCacheDryRun = vi.fn();
const mockUseEntityStats = vi.fn();
const mockUseEntityList = vi.fn();
const mockUseEntityCheck = vi.fn();
const mockUseEntityAudit = vi.fn();
const mockUseEntityReview = vi.fn();
const mockUseEntityCandidateEdges = vi.fn();
const mockUseHostAgentCapability = vi.fn();
const mockInvalidateQueries = vi.fn();

vi.mock('@/hooks/useJournals', () => ({
  useHealthCheck: () => mockUseHealthCheck(),
  useDataAudit: () => mockUseDataAudit(),
  useIndexCheck: () => mockUseIndexCheck(),
  useIndexVerify: () => mockUseIndexVerify(),
  useIndexCacheDryRun: () => mockUseIndexCacheDryRun(),
  useEntityStats: () => mockUseEntityStats(),
  useEntityList: () => mockUseEntityList(),
  useEntityCheck: () => mockUseEntityCheck(),
  useEntityAudit: () => mockUseEntityAudit(),
  useEntityReview: () => mockUseEntityReview(),
  useEntityCandidateEdges: () => mockUseEntityCandidateEdges(),
}));

vi.mock('@/hooks/useHostAgent', () => ({
  useHostAgentCapability: () => mockUseHostAgentCapability(),
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

function renderHealthCenter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HealthCenter />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const healthyHealth = {
  data: {
    status: 'ok',
    cli_available: true,
    compatible: true,
    package_version: '1.2.1',
    repo_version: '1.2.1',
    health: { status: 'healthy', journal_count: 42 },
  },
  isLoading: false,
  isError: false,
  isFetching: false,
};

const degradedHealth = {
  data: {
    status: 'degraded',
    cli_available: true,
    compatible: true,
    package_version: '1.2.1',
    repo_version: '1.2.1',
    health: {
      status: 'degraded',
      warnings: ['stale_index_tree'],
      journal_count: 42,
    },
  },
  isLoading: false,
  isError: false,
  isFetching: false,
};

const entityProfilesStaleHealth = {
  data: {
    status: 'ok',
    cli_available: true,
    compatible: true,
    package_version: '1.4.1',
    repo_version: '1.4.1',
    health: {
      status: 'healthy',
      journal_count: 42,
      events: [
        {
          type: 'entity_profiles_stale',
          severity: 'info',
          message: 'Entity profile docs are stale.',
          suggested_command: 'life-index abstract --entities',
        },
      ],
      checks: [
        {
          name: 'entity_profiles_stale',
          status: 'warn',
          hint: 'life-index abstract --entities',
        },
      ],
    },
  },
  isLoading: false,
  isError: false,
  isFetching: false,
};

const entityProfilesStaleNestedDataHealth = {
  data: {
    status: 'ok',
    cli_available: true,
    compatible: true,
    package_version: '1.4.1',
    repo_version: '1.4.1',
    health: {
      status: 'healthy',
      journal_count: 42,
      data: {
        events: [
          {
            type: 'entity_profiles_stale',
            severity: 'info',
            message: 'Nested entity profile docs are stale.',
            suggested_command: 'life-index abstract --entities',
          },
        ],
      },
    },
  },
  isLoading: false,
  isError: false,
  isFetching: false,
};

const unavailableHealth = {
  data: {
    status: 'degraded',
    cli_available: false,
    compatible: false,
    package_version: null,
    repo_version: null,
    health: null,
    error: { returncode: -1, message: 'Command timed out' },
  },
  isLoading: false,
  isError: false,
  isFetching: false,
};

const cleanAudit = {
  data: {
    success: true,
    schema_version: 'm16.health.v0',
    data: { file_count: 100, anomalies: [], distribution: { normal: 100 } },
  },
  isLoading: false,
  isError: false,
};

const anomalyAudit = {
  data: {
    success: true,
    schema_version: 'm16.health.v0',
    data: {
      file_count: 100,
      anomalies: [
        { type: 'empty_file', path: '2026/01/example.md' },
        { type: 'missing_frontmatter', path: '2026/02/test.md' },
      ],
      distribution: { normal: 98, warning: 2 },
    },
  },
  isLoading: false,
  isError: false,
};

const failedAudit = {
  data: {
    success: false,
    error: 'data-audit-unavailable',
  },
  isLoading: false,
  isError: false,
};

const indexCheckWarning = {
  data: {
    healthy: false,
    fts_count: 12,
    vector_count: 10,
    file_count: 14,
    issues: ['manifest missing', 'vector index stale'],
  },
  isLoading: false,
  isError: false,
};

const indexVerifyWarning = {
  data: {
    success: false,
    total_journals: 14,
    checks: [{ name: 'journal_integrity', status: 'warn' }],
    issues_count: 1,
    suggestion: 'Run read-only diagnostics before repair.',
  },
  isLoading: false,
  isError: false,
};

const cacheDryRunWarning = {
  data: {
    success: true,
    dry_run: true,
    cache_version: {
      would_rebuild: true,
      reasons: ['no_existing_version'],
    },
  },
  isLoading: false,
  isError: false,
};

const cleanIndexCheck = {
  data: {
    healthy: true,
    fts_count: 14,
    vector_count: 14,
    file_count: 14,
    issues: [],
  },
  isLoading: false,
  isError: false,
};

const cleanIndexVerify = {
  data: {
    success: true,
    total_journals: 14,
    checks: [],
    issues_count: 0,
  },
  isLoading: false,
  isError: false,
};

const cleanCacheDryRun = {
  data: {
    success: true,
    dry_run: true,
    cache_version: {
      would_rebuild: false,
      reasons: [],
    },
  },
  isLoading: false,
  isError: false,
};

const hostAgentOffline = {
  status: 'unavailable',
  canSendEvidence: false,
  reason: 'health-check-failed',
  features: {
    groundedQuery: {
      status: 'unavailable',
      ready: false,
      enabled: true,
      available: false,
      reason: 'health-check-failed',
    },
    smartMetadata: {
      status: 'unavailable',
      ready: false,
      enabled: true,
      available: false,
      reason: 'health-check-failed',
    },
  },
};

const hostAgentOnline = {
  status: 'ready',
  canSendEvidence: true,
  reason: 'ready',
  features: {
    groundedQuery: {
      status: 'ready',
      ready: true,
      enabled: true,
      available: true,
      reason: 'ready',
    },
    smartMetadata: {
      status: 'ready',
      ready: true,
      enabled: true,
      available: true,
      reason: 'ready',
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseHealthCheck.mockReturnValue(healthyHealth);
  mockUseDataAudit.mockReturnValue(cleanAudit);
  mockUseIndexCheck.mockReturnValue(cleanIndexCheck);
  mockUseIndexVerify.mockReturnValue(cleanIndexVerify);
  mockUseIndexCacheDryRun.mockReturnValue(cleanCacheDryRun);
  mockUseHostAgentCapability.mockReturnValue(hostAgentOffline);
});

describe('HealthCenter', () => {
  it('renders healthy state with check_circle icon', () => {
    renderHealthCenter();
    expect(screen.getByTestId('health-status-icon').textContent).toContain('check_circle');
    expect(screen.getByTestId('health-status-title').textContent).toContain('一切正常');
  });

  it('keeps healthy copy scoped to the CLI core engine without promising every feature', () => {
    renderHealthCenter();

    expect(screen.getByText(/CLI 核心引擎运行正常/)).toBeInTheDocument();
    expect(screen.queryByText(/所有功能可用|All features are available/)).not.toBeInTheDocument();
  });

  it('renders host-agent AI+ as a neutral disconnected capability state', () => {
    renderHealthCenter();

    const card = screen.getByTestId('ai-plus-status-card');
    expect(card).toHaveTextContent('星轨 AI+ 连接');
    expect(card).toHaveTextContent('未连接');
    expect(card).toHaveTextContent('智能元数据');
    expect(card).toHaveTextContent('智能搜索');
    expect(within(card).getByRole('link', { name: /如何连接宿主 agent/i })).toHaveAttribute('href', '/maintenance/host-agent');
  });

  it('renders host-agent AI+ as connected from the shared capability state', () => {
    mockUseHostAgentCapability.mockReturnValue(hostAgentOnline);

    renderHealthCenter();

    const card = screen.getByTestId('ai-plus-status-card');
    expect(card).toHaveTextContent('星轨 AI+ 连接');
    expect(card).toHaveTextContent('已连接');
  });

  it('does not show an unqualified healthy headline when index diagnostics need attention', () => {
    mockUseIndexCheck.mockReturnValue(indexCheckWarning);
    mockUseIndexVerify.mockReturnValue(indexVerifyWarning);
    mockUseIndexCacheDryRun.mockReturnValue(cacheDryRunWarning);

    renderHealthCenter();

    expect(screen.getByTestId('index-health-state').textContent).toContain('需要关注');
    expect(screen.getByTestId('health-status-title').textContent).toContain('需要关注');
    expect(screen.getByTestId('health-status-title').textContent).not.toContain('一切正常');
  });

  it('renders degraded state with warning icon and warnings list', () => {
    mockUseHealthCheck.mockReturnValue(degradedHealth);
    renderHealthCenter();
    expect(screen.getByTestId('health-status-icon').textContent).toContain('warning');
    expect(screen.getByTestId('health-status-title').textContent).toContain('状态降级');
    expect(screen.getByText('stale_index_tree')).toBeInTheDocument();
  });

  it('renders entity profile stale maintenance hint as informational command', () => {
    mockUseHealthCheck.mockReturnValue(entityProfilesStaleHealth);
    renderHealthCenter();

    expect(screen.getByTestId('entity-profiles-stale-hint')).toHaveTextContent('实体档案需要重建');
    expect(screen.getByTestId('entity-profiles-stale-hint')).toHaveTextContent('life-index abstract --entities');
    expect(screen.getByTestId('health-status-icon').textContent).toContain('check_circle');
    expect(screen.queryByText('entity_profiles_stale')).not.toBeInTheDocument();
  });

  it('renders entity profile stale maintenance hint from nested health data events', () => {
    mockUseHealthCheck.mockReturnValue(entityProfilesStaleNestedDataHealth);
    renderHealthCenter();

    expect(screen.getByTestId('entity-profiles-stale-hint')).toHaveTextContent('实体档案需要重建');
    expect(screen.getByTestId('entity-profiles-stale-hint')).toHaveTextContent('life-index abstract --entities');
    expect(screen.getByTestId('entity-profiles-stale-hint')).toHaveTextContent('Nested entity profile docs are stale.');
  });

  it('does not render entity profile stale maintenance hint when health has no stale event', () => {
    renderHealthCenter();

    expect(screen.queryByTestId('entity-profiles-stale-hint')).not.toBeInTheDocument();
  });

  it('renders CLI unavailable state with cloud_off icon', () => {
    mockUseHealthCheck.mockReturnValue(unavailableHealth);
    renderHealthCenter();
    expect(screen.getByTestId('health-status-icon').textContent).toContain('cloud_off');
    expect(screen.getByTestId('health-status-title').textContent).toContain('CLI 不可达');
  });

  it('renders loading state', () => {
    mockUseHealthCheck.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: true,
    });
    renderHealthCenter();
    expect(screen.getByTestId('health-status-icon').textContent).toContain('hourglass_empty');
  });

  it('renders error state', () => {
    mockUseHealthCheck.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
    });
    renderHealthCenter();
    expect(screen.getByTestId('health-status-icon').textContent).toContain('error');
    expect(screen.getByTestId('health-status-title').textContent).toContain('加载失败');
  });

  it('shows clean data audit with no anomalies', () => {
    renderHealthCenter();
    expect(screen.getByTestId('audit-anomaly-count').textContent).toContain('0');
    expect(screen.getByTestId('audit-clean')).toBeInTheDocument();
  });

  it('shows data audit anomalies when present', () => {
    mockUseDataAudit.mockReturnValue(anomalyAudit);
    renderHealthCenter();
    expect(screen.getByTestId('audit-anomaly-count').textContent).toContain('2');
    expect(screen.getByTestId('audit-anomaly-warning')).toBeInTheDocument();
  });

  it('handles audit failure gracefully', () => {
    mockUseDataAudit.mockReturnValue(failedAudit);
    renderHealthCenter();
    expect(screen.getByText('无法获取健康状态，请稍后重试。')).toBeInTheDocument();
  });

  it('retry button invalidates health queries', () => {
    renderHealthCenter();
    const retryBtn = screen.getByTestId('health-retry-button');
    fireEvent.click(retryBtn);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['health'] });
  });

  it('shows version when CLI is available', () => {
    renderHealthCenter();
    expect(screen.getByText('1.2.1')).toBeInTheDocument();
  });

  it('does not block rendering when health is degraded — independent queries', () => {
    // Health is degraded but data audit still loads independently
    mockUseHealthCheck.mockReturnValue(degradedHealth);
    mockUseDataAudit.mockReturnValue(cleanAudit);
    renderHealthCenter();

    // Both health and audit sections render independently
    expect(screen.getByTestId('health-status-title').textContent).toContain('状态降级');
    expect(screen.getByTestId('audit-anomaly-count')).toBeInTheDocument();
  });

  it('renders index diagnostics from CLI-mediated payloads', () => {
    mockUseIndexCheck.mockReturnValue(indexCheckWarning);
    mockUseIndexVerify.mockReturnValue(indexVerifyWarning);
    mockUseIndexCacheDryRun.mockReturnValue(cacheDryRunWarning);

    renderHealthCenter();

    expect(screen.getByTestId('index-diagnostics-card')).toBeInTheDocument();
    expect(screen.getByTestId('index-health-state').textContent).toContain('需要关注');
    expect(screen.getByText('manifest missing')).toBeInTheDocument();
    expect(screen.getByText('vector index stale')).toBeInTheDocument();
    expect(screen.getByText('FTS: 12')).toBeInTheDocument();
    expect(screen.queryByText('Vector: 10')).not.toBeInTheDocument();
    expect(screen.getByText('Verify issues: 1')).toBeInTheDocument();
    expect(screen.getByText('Cache dry-run: would rebuild')).toBeInTheDocument();
  });

  it('keeps index repair controls disabled with the CLI capability request reference', () => {
    renderHealthCenter();

    expect(screen.getByText('CLI-REQ-2026-05-28-006')).toBeInTheDocument();
    expect(screen.getByTestId('index-rebuild-blocked')).toBeDisabled();
    expect(screen.getByTestId('index-tree-rebuild-blocked')).toBeDisabled();
  });

});
