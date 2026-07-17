import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { useArchivesDashboard } from './useArchivesDashboard';

const getDashboard = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  dashboardAPI: { getDashboard },
}));

const dashboard = {
  period: { selected_month: '2026-07', today: '2026-07-15', current_month: '2026-07' },
  totals: {
    journal_count: null,
    month_entry_count: 0,
    month_active_day_count: 0,
    today_entry_count: null,
  },
  daily_activity: [],
  facets: { topics: [], tags: [], people: [] },
  warnings: [{ source: 'health', code: 'HEALTH_UNAVAILABLE', message: 'offline' }],
};

describe('useArchivesDashboard', () => {
  beforeEach(() => {
    getDashboard.mockReset();
    getDashboard.mockResolvedValue(dashboard);
  });

  it('keeps a partial dashboard response honest and keyed by selected month', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useArchivesDashboard('2026-07', 5), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(dashboard));
    expect(getDashboard).toHaveBeenCalledWith({ month: '2026-07', top: 5 });
    expect(result.current.data?.totals.journal_count).toBeNull();
  });
});
