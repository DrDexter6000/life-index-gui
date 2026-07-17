import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import Archives from './Archives';

const mockUseArchivesDashboard = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/hooks/useArchivesDashboard', () => ({
  useArchivesDashboard: (month: string, top: number) => mockUseArchivesDashboard(month, top),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    lang: 'en',
    t: (key: string) => ({
      archives: 'Archives', archivesTitleCn: '星图面板', archivesTitleEn: 'Constellation Panel',
      archivesLoading: 'Loading', archivesDashboardUnavailable: 'Unavailable',
      archivesMetricsTitle: 'Metrics', archivesMetricJournalCount: 'All entries',
      archivesMetricMonthEntryCount: 'Month entries', archivesMetricMonthActiveDayCount: 'Active days',
      archivesMetricTodayEntryCount: 'Today entries', archivesWarningsTitle: 'Warnings',
      archivesHeatmapTitle: 'Heatmap', archivesFacetsTitle: 'Facets', archivesTopicsTitle: 'Topics',
      archivesTagsTitle: 'Tags', archivesPeopleTitle: 'People', archivesFacetEmpty: 'Empty',
      archivesHeatmapKicker: 'Calendar', archivesHeatmapEmpty: 'Empty', archivesHeatmapHint: 'Hint',
      previousMonth: 'Previous month', nextMonth: 'Next month', operationsPortal: 'Operations',
      operationsPortalEn: 'Operations', portalImportTitle: 'Import Data', portalImportEn: 'Import',
      portalImportDesc: 'Import', portalMaintenanceTitle: 'Health Center', portalMaintenanceEn: 'Health Center',
      portalMaintenanceDesc: 'Health', portalEntitiesTitle: 'Entity Graph', portalEntitiesEn: 'Entity Graph',
      portalEntitiesDesc: 'Entities', portalIndexDiagTitle: 'Index Diagnostics', portalIndexDiagEn: 'Index Diagnostics',
      portalIndexDiagDesc: 'Indexes', monthName_7: 'July', monthName_6: 'June',
    }[key] ?? key),
  }),
}));

vi.mock('@/components/archives/MonthlyHeatmap', () => ({
  MonthlyHeatmap: () => <div data-testid="archives-heatmap-mock" />,
}));

const dashboard = {
  period: { selected_month: '2026-07', today: '2026-07-15', current_month: '2026-07' },
  totals: { journal_count: 1, month_entry_count: 1, month_active_day_count: 1, today_entry_count: 1 },
  daily_activity: [],
  facets: { topics: [], tags: [], people: [] },
  warnings: [],
};

function renderArchives() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Archives />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseArchivesDashboard.mockReturnValue({ data: dashboard, isLoading: false, isError: false });
});

describe('Archives operations entrypoints', () => {
  it.each([
    ['Import Data', '/import'],
    ['Health Center', '/maintenance'],
    ['Entity Graph', '/maintenance/entities'],
    ['Index Diagnostics', '/maintenance/index'],
  ])('keeps %s reachable at %s', (label, path) => {
    renderArchives();
    fireEvent.click(screen.getAllByText(label)[0].closest('button')!);
    expect(mockNavigate).toHaveBeenCalledWith(path);
  });

  it('always presents the Panel even when the dashboard provider is unavailable', () => {
    mockUseArchivesDashboard.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderArchives();
    expect(screen.getByText('Constellation Panel')).toBeInTheDocument();
    expect(screen.getByTestId('archives-dashboard-error')).toBeInTheDocument();
    expect(screen.queryByText(/Coming Soon|即将到来/)).not.toBeInTheDocument();
  });
});
