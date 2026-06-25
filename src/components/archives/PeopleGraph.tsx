import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import { GlassCard } from '@/components/celestial/GlassCard';
import { useEntityList, useEntityCandidateEdges } from '@/hooks/useJournals';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * PeopleGraph — 人物关系力导向图
 * Uses ECharts graph + force layout with entity data.
 * Clicking a node navigates to the Recall search page.
 *
 * DESIGN.md refs:
 * - The Panel Card Voice Rule
 * - tokens.json: colors gold #ffe792, cyan #85fff2, coral #ffb4a6, lavender #C4B6FE
 */
export function PeopleGraph() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data: entityData, isLoading: entitiesLoading } = useEntityList('person');
  const { data: edgesData, isLoading: edgesLoading } = useEntityCandidateEdges(50);

  const isLoading = entitiesLoading || edgesLoading;

  const { nodes, links } = useMemo(() => {
    const people = (entityData ?? []).filter(
      (e): e is typeof e & { primary_name: string } =>
        typeof e.primary_name === 'string' && e.primary_name.length > 0,
    );

    const nodeList = people.map((person, index) => ({
      id: person.id,
      name: person.primary_name,
      value: person.aliases?.length ?? 0,
      symbolSize: Math.max(20, 30 + (person.aliases?.length ?? 0) * 4),
      itemStyle: {
        color: getNodeColor(index),
        borderColor: 'rgba(255, 255, 255, 0.15)',
        borderWidth: 1,
        shadowBlur: 10,
        shadowColor: 'rgba(0, 0, 0, 0.3)',
      },
      label: {
        show: true,
        color: '#f0f2f8',
        textBorderColor: 'rgba(0,0,0,0.6)',
        textBorderWidth: 2,
        fontFamily: "'Plus Jakarta Sans', 'Noto Sans SC', ui-sans-serif, system-ui, sans-serif",
        fontSize: 11,
        fontWeight: 500,
      },
    }));

    const candidateEdges = edgesData?.candidates ?? [];
    const edgeList = candidateEdges
      .map((edge) => {
        const sourceId = typeof edge.source_id === 'string' ? edge.source_id : undefined;
        const targetId = typeof edge.target_id === 'string' ? edge.target_id : undefined;
        const weight = typeof edge.weight === 'number' ? edge.weight : 1;
        if (!sourceId || !targetId) return null;
        const sourceExists = nodeList.some((n) => n.id === sourceId);
        const targetExists = nodeList.some((n) => n.id === targetId);
        if (!sourceExists || !targetExists) return null;
        return {
          source: sourceId,
          target: targetId,
          value: weight,
          lineStyle: {
            color: 'rgba(255, 255, 255, 0.08)',
            width: Math.max(1, Math.min(3, weight)),
            curveness: 0.2,
          },
        };
      })
      .filter(Boolean) as Array<{ source: string; target: string; value: number; lineStyle: Record<string, unknown> }>;

    return { nodes: nodeList, links: edgeList };
  }, [entityData, edgesData]);

  const option = useMemo(() => {
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
        formatter: (params: { dataType?: string; name?: string; value?: number }) => {
          if (params.dataType === 'edge') {
            return `${params.name ?? ''}`;
          }
          return `${params.name ?? ''}<br/>${t('journalCount', { count: params.value ?? 0 })}`;
        },
      },
      series: [
        {
          type: 'graph',
          layout: 'force',
          data: nodes,
          links: links,
          roam: true,
          draggable: true,
          focusNodeAdjacency: true,
          force: {
            repulsion: 300,
            gravity: 0.05,
            edgeLength: [60, 120],
            layoutAnimation: true,
          },
          emphasis: {
            focus: 'adjacency',
            lineStyle: {
              width: 3,
              color: 'rgba(255, 231, 146, 0.35)',
            },
          },
          lineStyle: {
            color: 'source',
            curveness: 0.2,
            opacity: 0.4,
          },
        } as echarts.SeriesOption,
      ],
    };
  }, [nodes, links, t]);

  const handleChartClick = (params: unknown) => {
    const p = params as { dataType?: string; name?: string };
    if (p.dataType === 'node' && p.name) {
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

  if (nodes.length === 0) {
    return (
      <GlassCard className="p-5 min-h-[240px] flex items-center justify-center" hoverable={false}>
        <span className="text-sm text-[var(--color-secondary)]">{t('noData')}</span>
      </GlassCard>
    );
  }

  if (nodes.length < 8) {
    return (
      <GlassCard className="p-5 min-h-[260px] flex flex-col items-center justify-center text-center" hoverable={false}>
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center mb-3"
          style={{ background: 'rgba(133, 255, 242, 0.08)', border: '1px solid rgba(133, 255, 242, 0.15)' }}
        >
          <span className="material-symbols-outlined text-[var(--color-cyan)] text-xl">group</span>
        </div>
        <p className="text-[var(--color-primary)] text-sm mb-1" style={{ fontFamily: 'var(--font-narrative)' }}>
          {t('peopleGraphLowData')}
        </p>
        <p className="text-[var(--color-secondary)] text-xs">
          {t('peopleGraphLowDataHint')}
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-5" hoverable={false}>
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--color-coral-icon-bg)' }}
        >
          <span className="material-symbols-outlined text-base" style={{ color: 'var(--color-coral)' }}>
            hub
          </span>
        </div>
        <div>
          <p className="li-panel-kicker">{t('peopleGraphEn')}</p>
          <h3 className="li-panel-title text-[1rem]">{t('peopleGraph')}</h3>
        </div>
      </div>

      <div style={{ height: 260 }}>
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

function getNodeColor(index: number): string {
  const colors = ['#ffe792', '#85fff2', '#ffb4a6', '#C4B6FE', '#F9873E', '#e8eaf0'];
  return colors[index % colors.length];
}
