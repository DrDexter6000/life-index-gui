import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
  Tooltip,
} from 'recharts';
import { GlassCard } from '@/components/celestial/GlassCard';
import { useMoodFrequency } from '@/hooks/useJournals';
import { useTranslation } from '@/hooks/useTranslation';

const HEADER_ICON_BG_STYLE = { background: 'var(--color-lavender-10)' };
const HEADER_ICON_STYLE = { color: 'var(--color-lavender)' };

const TOOLTIP_CONTENT_STYLE = {
  background: 'var(--color-tooltip-bg)',
  backdropFilter: 'blur(8px)',
  border: '1px solid var(--color-glass-border)',
  borderRadius: '8px',
  fontSize: '12px',
  color: 'var(--color-primary)',
  boxShadow: 'none',
};

const TOOLTIP_LABEL_STYLE = { color: 'var(--color-muted)' };
const BAR_CELL_STYLE = { opacity: 0.7 };

/**
 * MoodBar — Horizontal bar chart showing top mood frequencies.
 * Uses Recharts with amber gradient bars matching Celestial palette.
 */
export function MoodBar() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data: moodData, isLoading } = useMoodFrequency();

  const chartData = useMemo(() => {
    if (!moodData || moodData.length === 0) return [];
    // Take top 8, reverse so highest is at top
    return moodData.slice(0, 8).reverse();
  }, [moodData]);

  if (isLoading) {
    return (
      <GlassCard className="p-5 min-h-[240px] flex items-center justify-center" hoverable={false}>
        <span className="text-sm text-[var(--color-secondary)]">{t('loadingData')}</span>
      </GlassCard>
    );
  }

  if (!moodData || moodData.length === 0) {
    return (
      <GlassCard className="p-5 min-h-[240px] flex items-center justify-center" hoverable={false}>
        <span className="text-sm text-[var(--color-secondary)]">{t('noData')}</span>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-5" hoverable={false}>
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={HEADER_ICON_BG_STYLE}
        >
          <span className="material-symbols-outlined text-base" style={HEADER_ICON_STYLE}>
            sentiment_satisfied
          </span>
        </div>
        <div>
          <p className="li-panel-kicker">{t('moodFrequencyEn')}</p>
          <h3 className="li-panel-title text-[1rem]">{t('moodFrequency')}</h3>
        </div>
      </div>

      {/* Horizontal bar chart */}
      <div className="h-[200px]" role="img" aria-label={t('moodChartAria')}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 0, right: 32, bottom: 0, left: 0 }}
            barCategoryGap="25%"
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={48}
              tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={false}
              contentStyle={TOOLTIP_CONTENT_STYLE}
              formatter={(value: number) => [t('timesCount', { value }), t('countLabel')]}
              labelStyle={TOOLTIP_LABEL_STYLE}
            />
            <Bar
              dataKey="count"
              radius={[0, 4, 4, 0]}
              maxBarSize={14}
              onClick={(data) => {
                if (data && typeof data === 'object' && 'name' in data) {
                  navigate(`/recall?q=${encodeURIComponent(String(data.name))}`);
                }
              }}
            >
              {chartData.map((entry) => (
                <Cell
                  key={entry.name}
                  fill="var(--color-gold-70)"
                  className="cursor-pointer transition-opacity duration-300 hover:opacity-100"
                  style={BAR_CELL_STYLE}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
}
