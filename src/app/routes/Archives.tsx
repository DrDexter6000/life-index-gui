import React, { lazy, Suspense, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { GlassCard } from '@/components/celestial/GlassCard';
import { CelestialLoader } from '@/components/celestial/CelestialLoader';
import { useTranslation } from '@/hooks/useTranslation';
import { useDashboardStats } from '@/hooks/useJournals';
import { featureFlags } from '@/lib/feature-flags';

const LazyMonthlyHeatmap = React.lazy(() =>
  import('@/components/archives/MonthlyHeatmap').then((m) => ({ default: m.MonthlyHeatmap }))
);
const TopicPie = lazy(() => import('@/components/archives/TopicPie').then((m) => ({ default: m.TopicPie })));
const MoodBar = lazy(() => import('@/components/archives/MoodBar').then((m) => ({ default: m.MoodBar })));
const TagCloud = lazy(() => import('@/components/archives/TagCloud').then((m) => ({ default: m.TagCloud })));
const PeopleGraph = lazy(() => import('@/components/archives/PeopleGraph').then((m) => ({ default: m.PeopleGraph })));

/**
 * Archives - 面板 (Dashboard / Panel)
 * Stats overview + visualizations + module entry portals
 * Layout: 2fr/1fr grid matching prototype sea-chart-grid
 *
 * DESIGN.md refs:
 * - The Panel Card Voice Rule: kicker/title/value/copy language shared
 * - The One Gold Rule: gold area ≤10%
 * - Ether Card: rgba(0,0,0,0.39) bg, gradient-fade border, 24px radius
 * - glass-card-hover: translateY(-2px), border gold rgba(255,231,146,0.15), bg rgba(0,0,0,0.46)
 * - duration-normal: 0.4s, ease-smooth: cubic-bezier(0.23, 1, 0.32, 1)
 */
export default function Archives() {
  const { t, lang } = useTranslation();

  const titlePrimary = lang === 'en' ? t('archivesTitleEn') : t('archivesTitleCn');
  const titleSecondary = lang === 'en' ? t('archivesTitleCn') : t('archivesTitleEn');

  if (!featureFlags.archivesDashboard) {
    return (
      <div className="li-page-shell li-page-composition">
        <section className="li-page-header" aria-label={t('archives')}>
          <h1 className="li-page-title" style={{ fontFamily: 'var(--font-divine)' }}>
            {titlePrimary}
          </h1>
          <p className="li-page-subtitle li-page-subtitle--code">
            {titleSecondary}
          </p>
        </section>
        <section className="flex flex-col items-center justify-center gap-6 mt-16">
          <p className="li-panel-kicker">{t('comingSoonLabel')}</p>
          <p className="li-panel-copy text-center max-w-lg">
            {t('comingSoonDesc')}
          </p>
        </section>
      </div>
    );
  }

  return <ArchivesDashboard />;
}

function ArchivesDashboard() {
  const navigate = useNavigate();
  const { t, lang } = useTranslation();

  const { data: stats, isLoading: statsLoading, error: statsError } = useDashboardStats();

  const statsItems = useMemo(() => [
    {
      labelCn: t('totalEntries'),
      labelEn: t('threadsWoven'),
      value: stats?.totalJournals ?? 0,
      icon: 'auto_stories',
      iconStyle: { background: 'var(--color-gold-icon-bg)', color: 'var(--color-gold)' },
      valueStyle: { color: 'var(--color-gold)' },
    },
    {
      labelCn: t('totalWords'),
      labelEn: t('wordsWritten'),
      value: stats?.totalWords ? `${(stats.totalWords / 1000).toFixed(1)}k` : '0',
      icon: 'edit_note',
      iconStyle: { background: 'var(--color-cyan-icon-bg)', color: 'var(--color-cyan)' },
      valueStyle: { color: 'var(--color-cyan)' },
    },
    {
      labelCn: t('activeDays'),
      labelEn: t('daysStreak'),
      value: stats?.activeDays ?? 0,
      icon: 'calendar_month',
      iconStyle: { background: 'var(--color-coral-icon-bg)', color: 'var(--color-coral)' },
      valueStyle: { color: 'var(--color-coral)' },
    },
  ], [stats, t]);

  // Operations portal — real entrypoints to already-registered routes
  const operationPortals = [
    {
      title: t('portalImportTitle'),
      titleEn: t('portalImportEn'),
      desc: t('portalImportDesc'),
      icon: 'upload_file',
      path: '/import',
      color: 'var(--color-cyan)',
    },
    {
      title: t('portalMaintenanceTitle'),
      titleEn: t('portalMaintenanceEn'),
      desc: t('portalMaintenanceDesc'),
      icon: 'monitor_heart',
      path: '/maintenance',
      color: 'var(--color-gold)',
    },
    {
      title: t('portalEntitiesTitle'),
      titleEn: t('portalEntitiesEn'),
      desc: t('portalEntitiesDesc'),
      icon: 'hub',
      path: '/maintenance/entities',
      color: 'var(--color-lavender)',
    },
    {
      title: t('portalIndexDiagTitle'),
      titleEn: t('portalIndexDiagEn'),
      desc: t('portalIndexDiagDesc'),
      icon: 'manage_search',
      path: '/maintenance/index',
      color: 'var(--color-amber)',
    },
  ];

  // Future portal cards — not yet implemented
  const futurePortals = [
    {
      title: t('memoryGallery'),
      titleEn: t('memoryGalleryEn'),
      desc: t('memoryGalleryDesc'),
      icon: 'grid_view',
      color: 'var(--color-cyan)',
    },
    {
      title: t('soulSlice'),
      titleEn: t('soulSliceEn'),
      desc: t('soulSliceDesc'),
      icon: 'psychology',
      color: 'var(--color-gold)',
    },
  ];

  const titlePrimary = lang === 'en' ? t('archivesTitleEn') : t('archivesTitleCn');
  const titleSecondary = lang === 'en' ? t('archivesTitleCn') : t('archivesTitleEn');

  return (
    <div className="li-page-shell li-page-composition li-page-composition--dashboard">
      {/* Header */}
      <section className="li-page-header" aria-label={t('archives')}>
        <h1 className="li-page-title" style={{ fontFamily: 'var(--font-divine)' }}>
          {titlePrimary}
        </h1>
        <p className="li-page-subtitle li-page-subtitle--code">
          {titleSecondary}
        </p>
      </section>

      {/* Stats Grid — 3 columns on desktop */}
      {statsError ? (
        <GlassCard className="p-6 mb-10">
          <div className="text-sm text-[var(--color-coral)]">{t('statsLoadFailed')}</div>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-3 gap-4 mb-10 max-[900px]:grid-cols-2 max-[640px]:grid-cols-1">
          {statsItems.map((stat) => (
            <GlassCard key={stat.labelCn} className="li-panel-card p-6" hoverable={false}>
              <div className="flex items-start gap-3 mb-5">
                <div
                  className="li-panel-icon"
                  style={stat.iconStyle}
                >
                  <span className="material-symbols-outlined text-lg">{stat.icon}</span>
                </div>
                <div>
                  <p className="li-panel-kicker">{stat.labelEn}</p>
                  <h3 className="li-panel-title text-[1rem]">{stat.labelCn}</h3>
                </div>
              </div>
              <div className="li-panel-value" style={stat.valueStyle}>
                {statsLoading ? '...' : stat.value}
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {/* Sea Chart Grid — 2fr/1fr layout matching prototype */}
      <section className="mb-4" aria-label={t('writingHeatmap')}>
        <div className="grid grid-cols-[2fr_1fr] gap-4 max-[900px]:grid-cols-1">
          {/* Heatmap takes 2/3 on desktop */}
          <div className="max-[900px]:col-span-1">
            <Suspense fallback={<div className="min-h-[300px]" />}>
              <LazyMonthlyHeatmap />
            </Suspense>
          </div>
          {/* Topic Pie + Mood Bar stacked in 1/3 column */}
          <div className="grid grid-cols-1 gap-4 max-[900px]:col-span-1">
            <Suspense fallback={<div className="h-[200px] flex items-center justify-center"><CelestialLoader size="sm" /></div>}>
              <TopicPie />
            </Suspense>
            <Suspense fallback={<div className="h-[200px] flex items-center justify-center"><CelestialLoader size="sm" /></div>}>
              <MoodBar />
            </Suspense>
          </div>
        </div>
      </section>

      {/* Tag Cloud — ECharts wordcloud */}
      <section className="mb-4" aria-label={t('tagCloud')}>
        <Suspense fallback={<div className="min-h-[240px]" />}>
          <TagCloud />
        </Suspense>
      </section>

      {/* People Graph — ECharts force-directed graph */}
      <section className="mb-4" aria-label={t('peopleGraph')}>
        <Suspense fallback={<div className="min-h-[260px]" />}>
          <PeopleGraph />
        </Suspense>
      </section>

      {/* Operations Portal — real entrypoints to registered routes */}
      <section className="mb-10" aria-label={t('operationsPortal')}>
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-base" style={{ color: 'var(--color-muted)' }}>settings</span>
          <div>
            <p className="li-panel-kicker">{t('operationsPortalEn')}</p>
            <h2 className="li-panel-title text-[1rem]">{t('operationsPortal')}</h2>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
          {operationPortals.map((portal) => (
            <GlassCard
              key={portal.path}
              className="li-panel-card p-6 flex items-center gap-4 group"
              onClick={() => navigate(portal.path)}
            >
              <div
                className="li-panel-icon transition-all duration-[400ms]"
                style={{ background: 'transparent', border: '1px solid rgba(255, 255, 255, 0.08)' }}
              >
                <span
                  className="material-symbols-outlined text-[28px] transition-colors duration-300"
                  style={{ color: portal.color }}
                >
                  {portal.icon}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="li-panel-kicker">{portal.titleEn}</p>
                <h3 className="li-panel-title text-[1rem] group-hover:text-[var(--color-gold)] transition-colors duration-300">
                  {portal.title}
                </h3>
                <p className="li-panel-copy">{portal.desc}</p>
              </div>
              <span className="material-symbols-outlined text-[var(--color-secondary)] text-lg transition-all duration-300 group-hover:translate-x-1 group-hover:text-[var(--color-gold)]">
                arrow_forward
              </span>
            </GlassCard>
          ))}
        </div>
      </section>

      {/* Future portal cards — 2-column grid, no section title */}
      <section className="mb-10" aria-label={t('exploreMore')}>
        <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
          {futurePortals.map((portal) => (
            <GlassCard
              key={portal.title}
              className="li-panel-card p-6 flex items-center gap-4 group"
            >
              <div
                className="li-panel-icon transition-all duration-[400ms]"
                style={{ background: 'transparent', border: '1px solid rgba(255, 255, 255, 0.08)' }}
              >
                <span
                  className="material-symbols-outlined text-[28px] text-[var(--color-muted)] group-hover:text-[var(--color-gold)] transition-colors duration-300"
                >
                  {portal.icon}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="li-panel-kicker">{portal.titleEn}</p>
                <h3 className="li-panel-title text-[1rem] group-hover:text-[var(--color-gold)] transition-colors duration-300">
                  {portal.title}
                </h3>
                <p className="li-panel-copy">
                  {portal.desc}
                  <span className="ml-1 text-xs text-[var(--color-muted)]">{t('inDevelopment')}</span>
                </p>
              </div>
              <span className="material-symbols-outlined text-[var(--color-secondary)] text-lg transition-all duration-300 group-hover:translate-x-1 group-hover:text-[var(--color-gold)]">
                arrow_forward
              </span>
            </GlassCard>
          ))}
        </div>
      </section>
    </div>
  );
}
