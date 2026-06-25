import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MonthlyHeatmap } from './MonthlyHeatmap';

const mockNavigate = vi.fn();
const mockUseHeatmapData = vi.fn();

vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/hooks/useJournals', () => ({
  useHeatmapData: (year: number, month: number) => mockUseHeatmapData(year, month),
}));

/** Captured props from the most recent ReactECharts render */
let lastEchartsOption: Record<string, unknown> | null = null;
let lastEchartsNotMerge: boolean | undefined = undefined;

vi.mock('echarts-for-react', () => ({
  __esModule: true,
  default: function MockReactECharts({
    option,
    notMerge,
    onEvents,
  }: {
    option?: Record<string, unknown>;
    notMerge?: boolean;
    onEvents?: { click?: (params: unknown) => void };
  }) {
    lastEchartsOption = option ?? null;
    lastEchartsNotMerge = notMerge;
    return (
      <div
        data-testid="echarts-mock"
        onClick={() => {
          // Simulate clicking a day cell with date 2026-04-02
          onEvents?.click?.({ value: ['2026-04-02', 2] });
        }}
      />
    );
  },
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'heatmapTitle') return `${opts?.month} ${opts?.year}`;
      if (key === 'journalCount') return `${opts?.count} journals`;
      if (key.startsWith('monthName_')) return `Month ${key.slice('monthName_'.length)}`;
      if (key.startsWith('weekdayShort_')) return key.slice('weekdayShort_'.length);
      const map: Record<string, string> = {
        prevMonth: 'Previous month',
        nextMonth: 'Next month',
        writingHeatmapEn: 'Writing heatmap',
        heatmapLess: 'Less',
        heatmapMore: 'More',
        loadingData: 'Loading',
        heatmapLabel_0: 'No entries',
        heatmapLabel_1: 'Low',
        heatmapLabel_2: 'Moderate',
        heatmapLabel_3: 'Active',
        heatmapLabel_4: 'High',
      };
      return map[key] ?? key;
    },
  }),
}));

describe('MonthlyHeatmap', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockUseHeatmapData.mockReset();
    mockUseHeatmapData.mockReturnValue({
      isLoading: false,
      data: [
        { date: '2026-04-02', count: 2, level: 2 },
      ],
    });
    lastEchartsOption = null;
    lastEchartsNotMerge = undefined;
  });

  it('refetches with the selected month when navigating between months', () => {
    render(<MonthlyHeatmap initialYear={2026} initialMonth={4} />);

    expect(mockUseHeatmapData).toHaveBeenLastCalledWith(2026, 4);

    fireEvent.click(screen.getByLabelText('Next month'));
    expect(mockUseHeatmapData).toHaveBeenLastCalledWith(2026, 5);

    fireEvent.click(screen.getByLabelText('Previous month'));
    expect(mockUseHeatmapData).toHaveBeenLastCalledWith(2026, 4);
  });

  it('keeps date drill-down tied to the visible month', () => {
    render(<MonthlyHeatmap initialYear={2026} initialMonth={4} />);

    fireEvent.click(screen.getByTestId('echarts-mock'));

    expect(mockNavigate).toHaveBeenCalledWith('/recall?q=2026-04-02');
  });

  it('passes the correct calendar range and series data for the current month', () => {
    render(<MonthlyHeatmap initialYear={2026} initialMonth={4} />);

    expect(lastEchartsOption).not.toBeNull();
    expect(lastEchartsOption?.calendar).toMatchObject({ range: '2026-04' });
    expect(lastEchartsOption?.series).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'heatmap',
          data: [['2026-04-02', 2]],
        }),
      ]),
    );
  });

  it('updates calendar range and series data when switching months', () => {
    mockUseHeatmapData
      .mockReturnValueOnce({
        isLoading: false,
        data: [{ date: '2026-04-02', count: 2, level: 2 }],
      })
      .mockReturnValueOnce({
        isLoading: false,
        data: [{ date: '2026-05-15', count: 3, level: 3 }],
      });

    render(<MonthlyHeatmap initialYear={2026} initialMonth={4} />);

    // Initial April render
    expect(lastEchartsOption?.calendar).toMatchObject({ range: '2026-04' });
    expect((lastEchartsOption?.series as Array<Record<string, unknown>>)?.[0]?.data).toEqual([
      ['2026-04-02', 2],
    ]);

    fireEvent.click(screen.getByLabelText('Next month'));

    // May render
    expect(lastEchartsOption?.calendar).toMatchObject({ range: '2026-05' });
    expect((lastEchartsOption?.series as Array<Record<string, unknown>>)?.[0]?.data).toEqual([
      ['2026-05-15', 3],
    ]);
  });

  it('replaces the entire ECharts option on month change (notMerge)', () => {
    render(<MonthlyHeatmap initialYear={2026} initialMonth={4} />);
    expect(lastEchartsNotMerge).toBe(true);
  });
});
