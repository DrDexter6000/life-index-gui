import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import Archives from './Archives';

// Mock hooks
const mockUseDashboardStats = vi.fn();
const mockUseTopicDistribution = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/hooks/useJournals', () => ({
  useDashboardStats: () => mockUseDashboardStats(),
  useTopicDistribution: () => mockUseTopicDistribution(),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const { mockFeatureFlags } = vi.hoisted(() => ({ mockFeatureFlags: { archivesDashboard: true } }));

vi.mock('@/lib/feature-flags', () => ({
  featureFlags: mockFeatureFlags,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        archives: '面板',
        archivesTitleCn: '星图面板',
        archivesTitleEn: 'Constellation Panel',
        totalEntries: '总记录数',
        totalWords: '总字数',
        activeDays: '活跃天数',
        threadsWoven: 'Threads Woven',
        wordsWritten: 'Words Written',
        daysStreak: 'Days Streak',
        statsLoadFailed: '加载统计数据失败',
        writingHeatmap: '写作热力图',
        writingHeatmapEn: 'Writing Heatmap',
        tagCloud: '标签词云',
        tagCloudEn: 'Tag Cloud',
        tagsLoadFailed: '加载标签数据失败',
        exploreMore: '继续探索...',
        inDevelopment: '即将推出',
        memoryGallery: '全部日志',
        memoryGalleryEn: 'Memory Gallery',
        memoryGalleryDesc: '按标签浏览所有日志。',
        soulSlice: '个人分析',
        soulSliceEn: 'Soul Slice',
        soulSliceDesc: 'AI 分析长期记录。',
        operationsPortal: '运维入口',
        operationsPortalEn: 'Operations',
        portalImportTitle: '导入数据',
        portalImportDesc: '将外部数据导入 Life Index。',
        portalMaintenanceTitle: '健康中心',
        portalMaintenanceDesc: 'CLI 核心引擎状态与数据完整性。',
        portalEntitiesTitle: '实体图谱',
        portalEntitiesDesc: '浏览实体和关系图谱。',
        portalIndexDiagTitle: '索引诊断',
        portalIndexDiagDesc: '索引健康检查与缓存状态。',
        comingSoonLabel: '即将到来',
        comingSoonDesc: '星图正在编织中。当核心织线稳固之后，这里将呈现你的人生面板。',
      };
      return map[key] ?? key;
    },
    lang: 'zh',
  }),
}));

function renderArchives() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Archives />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const healthyStats = {
  data: {
    totalJournals: 42,
    totalWords: 12000,
    activeDays: 30,
  },
  isLoading: false,
  isError: false,
};

const emptyTopics = {
  data: [],
  isLoading: false,
  isError: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFeatureFlags.archivesDashboard = true;
  mockUseDashboardStats.mockReturnValue(healthyStats);
  mockUseTopicDistribution.mockReturnValue(emptyTopics);
});

describe('Archives Entrypoints', () => {
  it('renders a clickable entry for import workflow pointing to /import', () => {
    renderArchives();

    const importEntry = screen.getByText('导入数据');
    expect(importEntry).toBeInTheDocument();

    // Find the clickable card containing the import entry
    const card = importEntry.closest('[data-testid="glasscard-button"]') ?? importEntry.closest('button');
    expect(card).toBeTruthy();
    fireEvent.click(card!);
    expect(mockNavigate).toHaveBeenCalledWith('/import');
  });

  it('renders a clickable entry for health/maintenance center pointing to /maintenance', () => {
    renderArchives();

    const maintenanceEntry = screen.getByText('健康中心');
    expect(maintenanceEntry).toBeInTheDocument();

    const card = maintenanceEntry.closest('[data-testid="glasscard-button"]') ?? maintenanceEntry.closest('button');
    expect(card).toBeTruthy();
    fireEvent.click(card!);
    expect(mockNavigate).toHaveBeenCalledWith('/maintenance');
  });

  it('renders a clickable entry for entity graph pointing to /maintenance/entities', () => {
    renderArchives();

    const entityEntry = screen.getByText('实体图谱');
    expect(entityEntry).toBeInTheDocument();

    const card = entityEntry.closest('[data-testid="glasscard-button"]') ?? entityEntry.closest('button');
    expect(card).toBeTruthy();
    fireEvent.click(card!);
    expect(mockNavigate).toHaveBeenCalledWith('/maintenance/entities');
  });

  it('renders a clickable entry for index diagnostics pointing to /maintenance/index', () => {
    renderArchives();

    const indexEntry = screen.getByText('索引诊断');
    expect(indexEntry).toBeInTheDocument();

    const card = indexEntry.closest('[data-testid="glasscard-button"]') ?? indexEntry.closest('button');
    expect(card).toBeTruthy();
    fireEvent.click(card!);
    expect(mockNavigate).toHaveBeenCalledWith('/maintenance/index');
  });
});

describe('Archives ComingSoon', () => {
  beforeEach(() => {
    mockFeatureFlags.archivesDashboard = false;
  });

  it('renders coming-soon copy when flag is off', () => {
    renderArchives();

    expect(screen.getByText('即将到来')).toBeInTheDocument();
    expect(
      screen.getByText('星图正在编织中。当核心织线稳固之后，这里将呈现你的人生面板。'),
    ).toBeInTheDocument();
  });

  it('does not render maintenance or import entry cards when flag is off', () => {
    renderArchives();

    expect(screen.queryByText('导入数据')).not.toBeInTheDocument();
    expect(screen.queryByText('健康中心')).not.toBeInTheDocument();
    expect(screen.queryByText('实体图谱')).not.toBeInTheDocument();
    expect(screen.queryByText('索引诊断')).not.toBeInTheDocument();
  });

  it('does not call useDashboardStats when flag is off', () => {
    renderArchives();

    expect(mockUseDashboardStats).not.toHaveBeenCalled();
  });
});
