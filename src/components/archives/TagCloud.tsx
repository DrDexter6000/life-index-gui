import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { GlassCard } from '@/components/celestial/GlassCard';
import { useTopicDistribution } from '@/hooks/useJournals';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * TagCloud — 标签词云
 * Uses weighted topic distribution data.
 * Clicking a tag navigates to the Recall search page.
 *
 * DESIGN.md refs:
 * - The Panel Card Voice Rule
 * - The One Gold Rule: gold area <=10%
 * - tokens.json: gold, cyan, coral, lavender, amber, primary
 */
export function TagCloud() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data: topicData, isLoading } = useTopicDistribution();

  const chartData = useMemo(() => {
    if (!topicData || topicData.length === 0) return [];
    return topicData.map((item) => ({
      name: item.name,
      value: item.count,
    }));
  }, [topicData]);

  const palette = useMemo(
    () => [
      'var(--color-gold)',
      'var(--color-cyan)',
      'var(--color-coral)',
      'var(--color-lavender)',
      'var(--color-amber)',
      'var(--color-primary)',
    ],
    [],
  );

  const cloudItems = useMemo(() => {
    const maxValue = Math.max(...chartData.map((item) => item.value), 1);
    const rotations = [-8, 5, 0, -5, 8, 0];
    return chartData.map((item, index) => {
      const weight = item.value / maxValue;
      return {
        ...item,
        color: palette[index % palette.length],
        fontSize: 13 + Math.round(weight * 19),
        opacity: 0.72 + weight * 0.28,
        rotation: rotations[index % rotations.length],
      };
    });
  }, [chartData, palette]);

  const handleTagClick = (name: string) => {
    navigate(`/recall?q=${encodeURIComponent(name)}`);
  };

  if (isLoading) {
    return (
      <GlassCard className="p-5 min-h-[240px] flex items-center justify-center" hoverable={false}>
        <span className="text-sm text-[var(--color-secondary)] animate-pulse">{t('loadingData')}</span>
      </GlassCard>
    );
  }

  if (!chartData.length) {
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
          style={{ background: 'var(--color-lavender-10)' }}
        >
          <span className="material-symbols-outlined text-base" style={{ color: 'var(--color-lavender)' }}>
            cloud
          </span>
        </div>
        <div>
          <p className="li-panel-kicker">{t('tagCloudEn')}</p>
          <h3 className="li-panel-title text-[1rem]">{t('tagCloud')}</h3>
        </div>
      </div>

      <div className="min-h-[220px] rounded-[8px] border border-white/[0.05] bg-white/[0.02] p-4">
        <div className="flex h-full min-h-[188px] flex-wrap content-center items-center justify-center gap-x-3 gap-y-2">
          {cloudItems.map((item) => (
            <button
              key={item.name}
              type="button"
              className="rounded-full px-2 py-1 font-medium transition hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)]"
              style={{
                color: item.color,
                fontSize: item.fontSize,
                opacity: item.opacity,
                transform: `rotate(${item.rotation}deg)`,
                fontFamily: "'Plus Jakarta Sans', 'Noto Sans SC', ui-sans-serif, system-ui, sans-serif",
              }}
              title={`${item.name}: ${item.value}`}
              onClick={() => handleTagClick(item.name)}
            >
              {item.name}
            </button>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}
