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
      archives: 'Archives',
      archivesTitleCn: '星图面板',
      archivesTitleEn: 'Constellation Panel',
      archivesLoading: 'Loading canonical data...',
      archivesDashboardUnavailable: 'Panel data unavailable',
      archivesMetricsTitle: 'Dashboard metrics',
      archivesMetricJournalCount: 'All journal entries',
      archivesMetricMonthEntryCount: 'Entries this month',
      archivesMetricMonthActiveDayCount: 'Active days this month',
      archivesMetricTodayEntryCount: 'Entries today',
      archivesWarningsTitle: 'Source warnings',
      archivesHeatmapTitle: 'Monthly activity',
      archivesFacetsTitle: 'Top facets',
      archivesTopicsTitle: 'Top topics',
      archivesTagsTitle: 'Top tags',
      archivesPeopleTitle: 'Top people',
      archivesFacetEmpty: 'No canonical values were returned.',
      archivesHeatmapKicker: 'Calendar',
      archivesHeatmapEmpty: 'No active days',
      archivesHeatmapHint: 'Select a day',
      previousMonth: 'Previous month',
      nextMonth: 'Next month',
      operationsPortal: 'Operations',
      operationsPortalEn: 'Operations',
      portalImportTitle: 'Import Data',
      portalImportEn: 'Import',
      portalImportDesc: 'Import external data.',
      portalMaintenanceTitle: 'Health Center',
      portalMaintenanceEn: 'Health Center',
      portalMaintenanceDesc: 'CLI health.',
      portalEntitiesTitle: 'Entity Graph',
      portalEntitiesEn: 'Entity Graph',
      portalEntitiesDesc: 'Browse entities.',
      portalIndexDiagTitle: 'Index Diagnostics',
      portalIndexDiagEn: 'Index Diagnostics',
      portalIndexDiagDesc: 'Inspect indexes.',
      monthName_7: 'July',
      monthName_6: 'June',
    }[key] ?? key),
  }),
}));

vi.mock('@/components/archives/MonthlyHeatmap', () => ({
  MonthlyHeatmap: ({
    month,
    days,
    status = 'ready',
    nextDisabled,
    onPreviousMonth,
    onNextMonth,
    onDaySelect,
  }: {
    month: string;
    days?: Array<{ date: string }>;
    status?: 'loading' | 'unavailable' | 'ready';
    nextDisabled?: boolean;
    onPreviousMonth: () => void;
    onNextMonth: () => void;
    onDaySelect?: (date: string) => void;
  }) => (
    <div data-testid="archives-heatmap-mock" data-month={month} data-status={status}>
      <button type="button" aria-label="Previous month" onClick={onPreviousMonth}>Previous</button>
      <button type="button" aria-label="Next month" disabled={nextDisabled} onClick={onNextMonth}>Next</button>
      {status === 'loading' && <p>Loading canonical data...</p>}
      {status === 'unavailable' && <p>Panel data unavailable</p>}
      {status === 'ready' && (
        <>
          <div role="grid">
            {days?.map(({ date }) => (
              <button key={date} type="button" data-testid={`archives-heatmap-day-${date}`} onClick={() => onDaySelect?.(date)}>
                {date}
              </button>
            ))}
          </div>
          {days?.length === 0 && <p>No active days</p>}
        </>
      )}
    </div>
  ),
}));

const dashboard = {
  period: { selected_month: '2026-07', today: '2026-07-15', current_month: '2026-07' },
  totals: { journal_count: 501, month_entry_count: 3, month_active_day_count: 2, today_entry_count: 1 },
  daily_activity: [{ date: '2026-07-02', count: 2 }],
  facets: {
    topics: [{ value: 'work', count: 3 }],
    tags: [{ value: 'urgent', count: 2 }],
    people: [{ value: 'Ada', count: 1 }],
  },
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

describe('Archives deterministic Panel', () => {
  it('renders exactly four metrics from gui.dashboard.v1 without fake or legacy cards', () => {
    renderArchives();

    expect(screen.getAllByTestId(/^archives-metric-card-/)).toHaveLength(4);
    expect(screen.getByTestId('archives-metric-journal-count')).toHaveTextContent('501');
    expect(screen.getByTestId('archives-metric-month-entry-count')).toHaveTextContent('3');
    expect(screen.getByTestId('archives-metric-month-active-day-count')).toHaveTextContent('2');
    expect(screen.getByTestId('archives-metric-today-entry-count')).toHaveTextContent('1');
    expect(screen.queryByText(/Coming Soon|Memory Gallery|Soul Slice|Mood Frequency/)).not.toBeInTheDocument();
  });

  it('keeps null source totals unknown and surfaces partial warnings', () => {
    mockUseArchivesDashboard.mockReturnValue({
      data: {
        ...dashboard,
        totals: { ...dashboard.totals, journal_count: null, today_entry_count: null },
        warnings: [{ source: 'health', code: 'HEALTH_UNAVAILABLE', message: 'offline' }],
      },
      isLoading: false,
      isError: false,
    });

    renderArchives();

    expect(screen.getByTestId('archives-metric-journal-count')).toHaveTextContent('—');
    expect(screen.getByTestId('archives-metric-today-entry-count')).toHaveTextContent('—');
    expect(screen.getByTestId('archives-dashboard-warnings')).toHaveTextContent('offline');
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });

  it('disables future navigation and keeps selected month owned by Archives', () => {
    renderArchives();

    expect(mockUseArchivesDashboard).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/), 5);
    expect(screen.getByLabelText('Next month')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Previous month'));
    expect(mockUseArchivesDashboard).toHaveBeenLastCalledWith('2026-06', 5);
  });

  it('keeps operations portals reachable on their existing routes', () => {
    renderArchives();
    fireEvent.click(screen.getByText('Import Data').closest('button')!);
    expect(mockNavigate).toHaveBeenCalledWith('/import');
    fireEvent.click(screen.getAllByText('Health Center')[0].closest('button')!);
    expect(mockNavigate).toHaveBeenCalledWith('/maintenance');
  });

  it('navigates a selected day to the canonical Recall date range', () => {
    renderArchives();

    fireEvent.click(screen.getByTestId('archives-heatmap-day-2026-07-02'));

    expect(mockNavigate).toHaveBeenCalledWith('/recall?start=2026-07-02&end=2026-07-02');
  });

  it('keeps the heatmap honest while dashboard data is loading', () => {
    mockUseArchivesDashboard.mockReturnValue({ data: undefined, isLoading: true, isError: false });

    renderArchives();

    expect(screen.getByTestId('archives-heatmap-mock')).toHaveAttribute('data-status', 'loading');
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.queryByText('No active days')).not.toBeInTheDocument();
  });

  it('keeps the heatmap unavailable when its source warns', () => {
    mockUseArchivesDashboard.mockReturnValue({
      data: {
        ...dashboard,
        warnings: [{ source: 'month_active_day_count', code: 'DASHBOARD_UNAVAILABLE', message: 'offline' }],
      },
      isLoading: false,
      isError: false,
    });

    renderArchives();

    expect(screen.getByTestId('archives-heatmap-mock')).toHaveAttribute('data-status', 'unavailable');
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.queryByText('No active days')).not.toBeInTheDocument();
  });

  it('labels a successful empty daily activity response as empty', () => {
    mockUseArchivesDashboard.mockReturnValue({
      data: { ...dashboard, daily_activity: [] },
      isLoading: false,
      isError: false,
    });

    renderArchives();

    expect(screen.getByTestId('archives-heatmap-mock')).toHaveAttribute('data-status', 'ready');
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.getByText('No active days')).toBeInTheDocument();
  });

  it('renders an honest error state with four unknown metric cards', () => {
    mockUseArchivesDashboard.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderArchives();
    expect(screen.getByTestId('archives-dashboard-error')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^archives-metric-card-/)).toHaveLength(4);
    expect(screen.getAllByText('—')).toHaveLength(4);
  });
});
