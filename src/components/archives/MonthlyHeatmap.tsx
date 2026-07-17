import { useMemo } from 'react';
import type { DashboardDailyActivity } from '@/lib/api-client';
import { GlassCard } from '@/components/celestial/GlassCard';
import { useTranslation } from '@/hooks/useTranslation';

export interface MonthlyHeatmapProps {
  month: string;
  days: DashboardDailyActivity[];
  status?: MonthlyHeatmapStatus;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  nextDisabled?: boolean;
  onDaySelect?: (date: string) => void;
}

export type MonthlyHeatmapStatus = 'loading' | 'unavailable' | 'ready';

/** A data-source-free calendar presenter for the dashboard's selected month. */
export function MonthlyHeatmap({
  month,
  days,
  status = 'ready',
  onPreviousMonth,
  onNextMonth,
  nextDisabled = false,
  onDaySelect,
}: MonthlyHeatmapProps) {
  const { t } = useTranslation();
  const [year, monthNumber] = month.split('-').map(Number);
  const monthName = t(`monthName_${monthNumber}`);
  const dayCount = new Date(year, monthNumber, 0).getDate();
  const activityByDate = useMemo(
    () => new Map(days.map((day) => [day.date, day.count])),
    [days],
  );
  const cells = useMemo(
    () => Array.from({ length: dayCount }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      const date = `${month}-${day}`;
      return { date, count: activityByDate.get(date) ?? 0 };
    }),
    [activityByDate, dayCount, month],
  );

  return (
    <GlassCard className="li-panel-card p-6" hoverable={false}>
      <section data-testid="archives-heatmap" aria-label={t('archivesHeatmapTitle')}>
        <div className="flex items-center justify-between gap-3 mb-5">
          <button
            type="button"
            aria-label={t('previousMonth')}
            onClick={onPreviousMonth}
            className="min-h-11 min-w-11 p-3 rounded-xl bg-[var(--color-ether-surface-ghost)] text-[var(--color-primary)] hover:bg-[var(--color-ether-control)] transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-lg">chevron_left</span>
          </button>
          <div className="text-center">
            <p className="li-panel-kicker">{t('archivesHeatmapKicker')}</p>
            <h2 className="li-panel-title text-[1rem]">{monthName} {year}</h2>
          </div>
          <button
            type="button"
            aria-label={t('nextMonth')}
            onClick={onNextMonth}
            disabled={nextDisabled}
            className="min-h-11 min-w-11 p-3 rounded-xl bg-[var(--color-ether-surface-ghost)] text-[var(--color-primary)] hover:bg-[var(--color-ether-control)] transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-lg">chevron_right</span>
          </button>
        </div>

        {status === 'ready' && (
          <div
            role="grid"
            aria-label={`${monthName} ${year}`}
            className="grid grid-cols-7 gap-1.5 sm:gap-2"
          >
            {cells.map(({ date, count }) => (
              <button
                key={date}
                type="button"
                role="gridcell"
                aria-label={`${date}: ${count}`}
                data-testid={`heatmap-day-${date}`}
                onClick={() => onDaySelect?.(date)}
                className="min-h-9 rounded-md border border-white/5 text-xs text-[var(--color-secondary)] transition-colors hover:border-[var(--color-gold)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-gold)]"
                style={{ backgroundColor: heatmapColor(count) }}
              >
                {Number(date.slice(-2))}
              </button>
            ))}
          </div>
        )}
        <p className="mt-4 text-xs text-[var(--color-muted)]">
          {status === 'loading'
            ? t('archivesLoading')
            : status === 'unavailable'
              ? t('archivesDashboardUnavailable')
              : days.length === 0
                ? t('archivesHeatmapEmpty')
                : t('archivesHeatmapHint')}
        </p>
      </section>
    </GlassCard>
  );
}

function heatmapColor(count: number): string {
  if (count >= 7) return 'rgba(133, 255, 242, 0.70)';
  if (count >= 4) return 'rgba(133, 255, 242, 0.50)';
  if (count >= 2) return 'rgba(133, 255, 242, 0.30)';
  if (count === 1) return 'rgba(133, 255, 242, 0.15)';
  return 'rgba(255, 255, 255, 0.03)';
}
