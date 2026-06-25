import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import 'echarts-wordcloud';
import { GlassCard } from '@/components/celestial/GlassCard';
import { useTopicDistribution } from '@/hooks/useJournals';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * TagCloud — 标签词云
 * Uses echarts-wordcloud with topic distribution data.
 * Clicking a tag navigates to the Recall search page.
 *
 * DESIGN.md refs:
 * - The Panel Card Voice Rule
 * - The One Gold Rule: gold area ≤10%
 * - tokens.json: colors gold #ffe792, cyan #85fff2, coral #ffb4a6, lavender #C4B6FE
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
    () => ['#ffe792', '#85fff2', '#ffb4a6', '#C4B6FE', '#F9873E', '#e8eaf0'],
    [],
  );

  const option = useMemo(() => {
    return {
      tooltip: {
        show: true,
        backgroundColor: 'rgba(18, 22, 30, 0.92)',
        borderColor: 'rgba(255, 255, 255, 0.08)',
        textStyle: {
          color: '#e8eaf0',
          fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
          fontSize: 12,
        },
        formatter: (params: { name: string; value: number }) => {
          return `${params.name}: ${params.value}`;
        },
      },
      series: [
        {
          type: 'wordCloud',
          shape: 'circle',
          left: 'center',
          top: 'center',
          width: '95%',
          height: '95%',
          right: null,
          bottom: null,
          sizeRange: [12, 36],
          rotationRange: [-30, 30],
          rotationStep: 15,
          gridSize: 10,
          drawOutOfBound: false,
          layoutAnimation: true,
          textStyle: {
            fontFamily: "'Plus Jakarta Sans', 'Noto Sans SC', ui-sans-serif, system-ui, sans-serif",
            fontWeight: 500,
            color: () => palette[Math.floor(Math.random() * palette.length)],
          },
          emphasis: {
            focus: 'self',
            textStyle: {
              textShadowBlur: 8,
              textShadowColor: 'rgba(255, 231, 146, 0.35)',
            },
          },
          data: chartData,
        } as echarts.SeriesOption,
      ],
    };
  }, [chartData, palette]);

  const handleChartClick = (params: unknown) => {
    const p = params as { name?: string };
    if (p.name) {
      navigate(`/recall?q=${encodeURIComponent(p.name)}`);
    }
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

      <div style={{ height: 220 }}>
        <ReactECharts
          option={option}
          style={{ height: '100%', width: '100%' }}
          onEvents={{
            click: handleChartClick,
          }}
        />
      </div>
    </GlassCard>
  );
}
