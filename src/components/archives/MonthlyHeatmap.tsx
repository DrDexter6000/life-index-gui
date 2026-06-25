import React, { useMemo } from 'react';
import { useNavigate } from 'react-router';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import { GlassCard } from '@/components/celestial/GlassCard';
import { useHeatmapData } from '@/hooks/useJournals';
import { useTranslation } from '@/hooks/useTranslation';

interface MonthlyHeatmapProps {
  /** Initial year (defaults to current year) */
  initialYear?: number;
  /** Initial month 1-12 (defaults to current month) */
  initialMonth?: number;
}

/**
 * MonthlyHeatmap — 月历式热力图 (ECharts calendar + heatmap)
 * Uses ECharts calendar coordinate system with heatmap series.
 * Clicking a day navigates to the Recall search page with that date as query.
 *
 * DESIGN.md refs:
 * - The Panel Card Voice Rule: kicker/title/value/copy language shared
 * - The No-Heavy-Glass Rule: no thick glass, ether film only
 * - tokens.json: colors gold #ffe792, cyan #85fff2, coral #ffb4a6
 */
export function MonthlyHeatmap({ initialYear, initialMonth }: MonthlyHeatmapProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const now = new Date();
  const [year, setYear] = React.useState(initialYear ?? now.getFullYear());
  const [month, setMonth] = React.useState(initialMonth ?? now.getMonth() + 1);

  const { data: heatmapDays, isLoading } = useHeatmapData(year, month);

  const monthNames = useMemo(() => Array.from({ length: 12 }, (_, i) => t(`monthName_${i + 1}`)), [t]);

  // Build ECharts data: [['YYYY-MM-DD', count], ...]
  const chartData = useMemo(() => {
    if (!heatmapDays) return [];
    return heatmapDays.map((d) => [d.date, d.count] as [string, number]);
  }, [heatmapDays]);

  const maxCount = useMemo(() => {
    if (!heatmapDays || heatmapDays.length === 0) return 1;
    return Math.max(...heatmapDays.map((d) => d.count), 1);
  }, [heatmapDays]);

  const calendarRange = useMemo(() => {
    const m = String(month).padStart(2, '0');
    return `${year}-${m}`;
  }, [year, month]);

  const option = useMemo(() => {
    const inPieces = [
      { min: 1, max: 1, color: 'rgba(133, 255, 242, 0.15)' },
      { min: 2, max: 3, color: 'rgba(133, 255, 242, 0.30)' },
      { min: 4, max: 6, color: 'rgba(133, 255, 242, 0.50)' },
      { min: 7, color: 'rgba(133, 255, 242, 0.70)' },
    ];

    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(18, 22, 30, 0.92)',
        borderColor: 'rgba(255, 255, 255, 0.08)',
        textStyle: {
          color: '#e8eaf0',
          fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
          fontSize: 12,
        },
        formatter: (params: { value: [string, number] }) => {
          const [date, count] = params.value;
          return `${date}<br/>${t('journalCount', { count })}`;
        },
      },
      visualMap: {
        show: false,
        min: 0,
        max: maxCount,
        type: 'piecewise',
        pieces: inPieces,
        inRange: {
          color: ['rgba(255,255,255,0.03)', 'rgba(133,255,242,0.15)', 'rgba(133,255,242,0.30)', 'rgba(133,255,242,0.50)', 'rgba(133,255,242,0.70)'],
        },
        outOfRange: {
          color: 'rgba(255,255,255,0.03)',
        },
      },
      calendar: {
        range: calendarRange,
        cellSize: ['auto', 28],
        splitLine: { show: false },
        itemStyle: {
          color: 'rgba(255,255,255,0.03)',
          borderColor: 'rgba(255,255,255,0.04)',
          borderWidth: 1,
          borderRadius: 4,
        },
        dayLabel: {
          color: '#818695',
          fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
          fontSize: 11,
          firstDay: 0,
        },
        monthLabel: { show: false },
        yearLabel: { show: false },
      },
      series: [
        {
          type: 'heatmap',
          coordinateSystem: 'calendar',
          data: chartData,
          emphasis: {
            itemStyle: {
              borderColor: 'rgba(255, 231, 146, 0.35)',
              borderWidth: 1,
              shadowBlur: 8,
              shadowColor: 'rgba(133, 255, 242, 0.25)',
            },
          },
        } as echarts.SeriesOption,
      ],
    };
  }, [chartData, maxCount, calendarRange, t]);

  const handleChartClick = (params: unknown) => {
    const p = params as { value?: [string, number] };
    if (p.value && Array.isArray(p.value)) {
      const [dateStr] = p.value;
      if (dateStr) {
        navigate(`/recall?q=${dateStr}`);
      }
    }
  };

  const handlePrevMonth = () => {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else {
      setMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else {
      setMonth((m) => m + 1);
    }
  };

  return (
    <GlassCard className="p-6" hoverable={false}>
      {/* Header: month navigation */}
      <div className="flex items-center justify-between mb-5">
        <button
          type="button"
          aria-label={t('prevMonth')}
          onClick={handlePrevMonth}
          className="p-3 rounded-xl bg-[var(--color-ether-surface-ghost)] text-[var(--color-primary)] hover:bg-[var(--color-ether-control)] transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-lg">chevron_left</span>
        </button>

        <div className="text-center">
          <p className="li-panel-kicker">{t('writingHeatmapEn')}</p>
          <h2 className="li-panel-title text-[1rem]">
            {t('heatmapTitle', { year, month: monthNames[month - 1] })}
          </h2>
        </div>

        <button
          type="button"
          aria-label={t('nextMonth')}
          onClick={handleNextMonth}
          className="p-3 rounded-xl bg-[var(--color-ether-surface-ghost)] text-[var(--color-primary)] hover:bg-[var(--color-ether-control)] transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-lg">chevron_right</span>
        </button>
      </div>

      {/* ECharts Calendar Heatmap */}
      <div className="relative" style={{ height: 220 }}>
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm text-[var(--color-secondary)] animate-pulse">{t('loadingData')}</span>
          </div>
        ) : (
          <ReactECharts
            option={option}
            notMerge
            style={{ height: '100%', width: '100%' }}
            onEvents={{
              click: handleChartClick,
            }}
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-4 justify-end">
        <span className="text-[10px] text-[var(--color-secondary)]">{t('heatmapLess')}</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: getLegendColor(level) }}
          />
        ))}
        <span className="text-[10px] text-[var(--color-secondary)]">{t('heatmapMore')}</span>
      </div>
    </GlassCard>
  );
}

function getLegendColor(level: number): string {
  const colors = [
    'rgba(255, 255, 255, 0.03)',
    'rgba(133, 255, 242, 0.15)',
    'rgba(133, 255, 242, 0.30)',
    'rgba(133, 255, 242, 0.50)',
    'rgba(133, 255, 242, 0.70)',
  ];
  return colors[Math.min(level, 4)] ?? colors[0];
}
