import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardAPI } from './api-client';
import { DashboardResponseSchema } from './schemas';

const dashboard = {
  period: { selected_month: '2026-07', today: '2026-07-15', current_month: '2026-07' },
  totals: {
    journal_count: 501,
    month_entry_count: 3,
    month_active_day_count: 2,
    today_entry_count: 1,
  },
  daily_activity: [{ date: '2026-07-02', count: 2 }],
  facets: {
    topics: [{ value: 'work', count: 3 }],
    tags: [{ value: 'urgent', count: 2 }],
    people: [{ value: 'Ada', count: 1 }],
  },
  warnings: [],
};

describe('dashboardAPI.getDashboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and validates the GUI-owned dashboard v1 contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, data: dashboard, error: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await dashboardAPI.getDashboard({ month: '2026-07', top: 5 });

    expect(result).toEqual(dashboard);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dashboard?month=2026-07&top=5',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(DashboardResponseSchema.parse(result)).toEqual(dashboard);
  });

  it('rejects malformed dashboard data rather than inventing zero totals', async () => {
    const malformed = {
      ...dashboard,
      totals: { ...dashboard.totals, month_entry_count: '3' },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, data: malformed, error: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(dashboardAPI.getDashboard({ month: '2026-07' })).rejects.toMatchObject({
      code: 'SCHEMA_ERROR',
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Schema validation failed:',
      expect.stringContaining('totals.month_entry_count'),
    );
  });
});
