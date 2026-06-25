import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { ResponsivePie } from '@nivo/pie';
import { GlassCard } from '@/components/celestial/GlassCard';
import { getTopicName } from '@/lib/formatters';
import { useTopicDistribution } from '@/hooks/useJournals';
import { useTranslation } from '@/hooks/useTranslation';

/** Fallback palette for topics without a backend-assigned color */
const FALLBACK_PALETTE = ['var(--color-gold)', 'var(--color-cyan)', 'var(--color-amber)', 'var(--color-lavender)', 'var(--color-cyan)', 'var(--color-coral)', 'var(--color-muted)'];

const HEADER_ICON_BG_STYLE = { background: 'var(--color-coral-icon-bg)' };
const HEADER_ICON_STYLE = { color: 'var(--color-coral)' };

const TOOLTIP_STYLE = {
  background: 'var(--color-tooltip-bg)',
  backdropFilter: 'blur(8px)',
  borderRadius: '8px',
  padding: '6px 10px',
  fontSize: '12px',
  color: 'var(--color-primary)',
  border: '1px solid var(--color-glass-border)',
};

const TOOLTIP_COUNT_STYLE = { color: 'var(--color-muted)', marginLeft: 6 };

/**
 * TopicPie — Donut chart showing topic distribution across all journals.
 * Uses Nivo ResponsivePie with Celestial color palette.
 */
export function TopicPie() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data: topicData, isLoading } = useTopicDistribution();

  const chartData = useMemo(() => {
    if (!topicData || topicData.length === 0) return [];
    return topicData.map((item, i) => ({
      id: item.name,
      label: getTopicName(item.name),
      value: item.count,
      color: item.color ?? FALLBACK_PALETTE[i % FALLBACK_PALETTE.length],
    }));
  }, [topicData]);

  if (isLoading) {
    return (
      <GlassCard className="p-5 min-h-[240px] flex items-center justify-center" hoverable={false}>
        <span className="text-sm text-[var(--color-secondary)]">{t('loadingData')}</span>
      </GlassCard>
    );
  }

  if (!topicData || topicData.length === 0) {
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
            donut_large
          </span>
        </div>
        <div>
          <p className="li-panel-kicker">{t('topicDistributionEn')}</p>
          <h3 className="li-panel-title text-[1rem]">{t('topicDistribution')}</h3>
        </div>
      </div>

      {/* Donut chart */}
      <div className="h-[200px]" role="img" aria-label={t('topicPieAria')}>
        <ResponsivePie
          data={chartData}
          margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
          innerRadius={0.55}
          padAngle={1.5}
          cornerRadius={3}
          colors={{ datum: 'data.color' }}
          borderWidth={0}
          enableArcLinkLabels={false}
          enableArcLabels={false}
          tooltip={({ datum }) => (
            <div style={TOOLTIP_STYLE}>
              <span style={{ color: datum.data.color }}>{datum.data.label}</span>
              <span style={TOOLTIP_COUNT_STYLE}>{t('entriesCount', { value: datum.data.value })}</span>
            </div>
          )}
          theme={{
            background: 'transparent',
            tooltip: { container: { background: 'transparent', boxShadow: 'none' } },
          }}
          motionConfig="gentle"
          onClick={(datum) => {
            navigate(`/recall?q=${encodeURIComponent(String(datum.id))}`);
          }}
        />
      </div>

      {/* Legend — clickable horizontal pill row */}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-3">
        {chartData.map((item) => (
          <button
            key={item.id}
            type="button"
            className="flex items-center gap-1.5 cursor-pointer transition-all duration-300 hover:opacity-80 border-none bg-transparent"
            onClick={() => navigate(`/recall?q=${encodeURIComponent(item.id)}`)}
          >
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: item.color }}
            />
            <span className="text-[0.6875rem] text-[var(--color-muted)]">
              {getTopicName(item.id)}
              <span className="text-[var(--color-secondary)] ml-1">{item.value}</span>
            </span>
          </button>
        ))}
      </div>
    </GlassCard>
  );
}
