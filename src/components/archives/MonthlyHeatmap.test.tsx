import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MonthlyHeatmap } from './MonthlyHeatmap';

const mockPrevious = vi.fn();
const mockNext = vi.fn();
const mockDay = vi.fn();

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      archivesHeatmapTitle: 'Monthly activity', archivesHeatmapKicker: 'Calendar',
      archivesLoading: 'Loading canonical data...', archivesDashboardUnavailable: 'Panel data unavailable',
      archivesHeatmapEmpty: 'No active days', archivesHeatmapHint: 'Select a day',
      previousMonth: 'Previous month', nextMonth: 'Next month', monthName_4: 'April',
    }[key] ?? key),
  }),
}));

describe('MonthlyHeatmap presenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders supplied daily activity without calling a legacy data hook', () => {
    render(
      <MonthlyHeatmap
        month="2026-04"
        days={[{ date: '2026-04-02', count: 2 }]}
        onPreviousMonth={mockPrevious}
        onNextMonth={mockNext}
        onDaySelect={mockDay}
      />,
    );

    expect(screen.getByTestId('heatmap-day-2026-04-02')).toHaveTextContent('2');
    expect(screen.getByRole('grid')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('heatmap-day-2026-04-02'));
    expect(mockDay).toHaveBeenCalledWith('2026-04-02');
  });

  it('exposes keyboard-accessible month controls and disables future navigation', () => {
    render(
      <MonthlyHeatmap
        month="2026-04"
        days={[]}
        onPreviousMonth={mockPrevious}
        onNextMonth={mockNext}
        nextDisabled
      />,
    );

    const previous = screen.getByRole('button', { name: 'Previous month' });
    const next = screen.getByRole('button', { name: 'Next month' });
    expect(previous).toHaveAttribute('type', 'button');
    expect(next).toBeDisabled();
    fireEvent.click(previous);
    expect(mockPrevious).toHaveBeenCalledTimes(1);
  });

  it('does not fabricate a grid or empty claim while daily activity is loading', () => {
    render(
      <MonthlyHeatmap
        month="2026-04"
        days={[]}
        status="loading"
        onPreviousMonth={mockPrevious}
        onNextMonth={mockNext}
      />,
    );

    expect(screen.getByText('Loading canonical data...')).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.queryByText('No active days')).not.toBeInTheDocument();
  });

  it('does not fabricate a grid or empty claim when daily activity is unavailable', () => {
    render(
      <MonthlyHeatmap
        month="2026-04"
        days={[]}
        status="unavailable"
        onPreviousMonth={mockPrevious}
        onNextMonth={mockNext}
      />,
    );

    expect(screen.getByText('Panel data unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.queryByText('No active days')).not.toBeInTheDocument();
  });

  it('keeps a successful empty response truthful with a real empty state', () => {
    render(
      <MonthlyHeatmap
        month="2026-04"
        days={[]}
        status="ready"
        onPreviousMonth={mockPrevious}
        onNextMonth={mockNext}
      />,
    );

    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.getByText('No active days')).toBeInTheDocument();
  });
});
