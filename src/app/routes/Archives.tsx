import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { GlassCard } from '@/components/celestial/GlassCard';
import { CelestialLoader } from '@/components/celestial/CelestialLoader';
import { useTranslation } from '@/hooks/useTranslation';
import { useArchivesDashboard } from '@/hooks/useArchivesDashboard';
import { FacetTopN } from '@/components/archives/FacetTopN';
import { MonthlyHeatmap } from '@/components/archives/MonthlyHeatmap';
import {
  getLocalCurrentMonth,
  isFutureLocalMonth,
  shiftLocalMonth,
} from './archives-contract';

/** Archives is a deterministic presentation of the GUI-owned dashboard v1 view. */
export default function Archives() {
  const { t, lang } = useTranslation();
  const navigate = useNavigate();
  const titlePrimary = lang === 'en' ? t('archivesTitleEn') : t('archivesTitleCn');
  const titleSecondary = lang === 'en' ? t('archivesTitleCn') : t('archivesTitleEn');
  const [selectedMonth, setSelectedMonth] = useState(() => getLocalCurrentMonth());
  const dashboardQuery = useArchivesDashboard(selectedMonth, 5);
  const dashboard = dashboardQuery.data;
  const currentMonth = dashboard?.period.current_month ?? getLocalCurrentMonth();
  const heatmapStatus = dashboardQuery.isLoading
    ? 'loading'
    : dashboardQuery.isError
      || !dashboard
      || dashboard.warnings.some((warning) => warning.source === 'month_active_day_count')
      ? 'unavailable'
      : 'ready';

  const changeMonth = (delta: number) => {
    const next = shiftLocalMonth(selectedMonth, delta);
    if (delta > 0 && isFutureLocalMonth(next, currentMonth)) return;
    setSelectedMonth(next);
  };

  const operationPortals = useMemo(() => [
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
  ], [t]);

  return (
    <div className="li-page-shell li-page-composition li-page-composition--dashboard">
      <section className="li-page-header" aria-label={t('archives')}>
        <h1 className="li-page-title" style={{ fontFamily: 'var(--font-divine)' }}>
          {titlePrimary}
        </h1>
        <p className="li-page-subtitle li-page-subtitle--code">{titleSecondary}</p>
      </section>

      {dashboardQuery.isLoading && (
        <div data-testid="archives-dashboard-loading" className="mb-6" aria-live="polite">
          <PanelLoading text={t('archivesLoading')} />
        </div>
      )}
      {dashboardQuery.isError && (
        <div data-testid="archives-dashboard-error" className="mb-6" role="alert">
          <PanelError text={t('archivesDashboardUnavailable')} />
        </div>
      )}

      <section
        aria-label={t('archivesMetricsTitle')}
        className="grid grid-cols-4 gap-4 mb-6 max-[1100px]:grid-cols-2 max-[640px]:grid-cols-1"
      >
        <MetricCard
          id="journal-count"
          label={t('archivesMetricJournalCount')}
          value={dashboard?.totals.journal_count}
          loading={dashboardQuery.isLoading}
        />
        <MetricCard
          id="month-entry-count"
          label={t('archivesMetricMonthEntryCount')}
          value={dashboard?.totals.month_entry_count}
          loading={dashboardQuery.isLoading}
        />
        <MetricCard
          id="month-active-day-count"
          label={t('archivesMetricMonthActiveDayCount')}
          value={dashboard?.totals.month_active_day_count}
          loading={dashboardQuery.isLoading}
        />
        <MetricCard
          id="today-entry-count"
          label={t('archivesMetricTodayEntryCount')}
          value={dashboard?.totals.today_entry_count}
          loading={dashboardQuery.isLoading}
        />
      </section>

      {dashboard && dashboard.warnings.length > 0 && (
        <section data-testid="archives-dashboard-warnings" className="mb-6" aria-label={t('archivesWarningsTitle')}>
          <div className="rounded-xl border border-[var(--color-amber)]/30 bg-[var(--color-amber)]/5 p-4">
            <p className="li-panel-kicker mb-2">{t('archivesWarningsTitle')}</p>
            <ul className="space-y-1 text-sm text-[var(--color-secondary)]">
              {dashboard.warnings.map((warning, index) => (
                <li key={`${warning.source}-${warning.code}-${index}`}>
                  <span className="text-[var(--color-amber)]">{warning.source}</span>: {warning.message}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="mb-6" aria-label={t('archivesHeatmapTitle')}>
        <MonthlyHeatmap
          month={selectedMonth}
          days={dashboard?.daily_activity ?? []}
          status={heatmapStatus}
          onPreviousMonth={() => changeMonth(-1)}
          onNextMonth={() => changeMonth(1)}
          nextDisabled={isFutureLocalMonth(shiftLocalMonth(selectedMonth, 1), currentMonth)}
          onDaySelect={(date) => {
            const encodedDate = encodeURIComponent(date);
            navigate(`/recall?start=${encodedDate}&end=${encodedDate}`);
          }}
        />
      </section>

      <section aria-label={t('archivesFacetsTitle')} className="grid grid-cols-3 gap-4 mb-10 max-[900px]:grid-cols-1">
        <FacetTopN
          facet="topics"
          title={t('archivesTopicsTitle')}
          items={dashboard?.facets.topics ?? []}
          emptyLabel={t('archivesFacetEmpty')}
        />
        <FacetTopN
          facet="tags"
          title={t('archivesTagsTitle')}
          items={dashboard?.facets.tags ?? []}
          emptyLabel={t('archivesFacetEmpty')}
        />
        <FacetTopN
          facet="people"
          title={t('archivesPeopleTitle')}
          items={dashboard?.facets.people ?? []}
          emptyLabel={t('archivesFacetEmpty')}
        />
      </section>

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
            <OperationPortal key={portal.path} {...portal} />
          ))}
        </div>
      </section>
    </div>
  );

}

function MetricCard({
  id,
  label,
  value,
  loading,
}: {
  id: string;
  label: string;
  value: number | null | undefined;
  loading: boolean;
}) {
  return (
    <GlassCard
      className="li-panel-card p-5"
      hoverable={false}
    >
      <section data-testid={`archives-metric-card-${id}`} aria-label={label} aria-busy={loading}>
        <p className="li-panel-kicker mb-2">{label}</p>
        {loading ? (
          <div data-testid={`archives-metric-${id}-loading`} className="li-panel-value text-[var(--color-muted)]">…</div>
        ) : (
          <div data-testid={`archives-metric-${id}`} className="li-panel-value" style={{ color: 'var(--color-cyan)' }}>
            {value ?? '—'}
          </div>
        )}
      </section>
    </GlassCard>
  );
}

function OperationPortal({
  title,
  titleEn,
  desc,
  icon,
  path,
  color,
}: {
  title: string;
  titleEn: string;
  desc: string;
  icon: string;
  path: string;
  color: string;
}) {
  const navigate = useNavigate();
  return (
    <GlassCard
      className="li-panel-card p-6 flex items-center gap-4 group"
      onClick={() => navigate(path)}
    >
      <div className="li-panel-icon transition-all duration-[400ms]" style={{ background: 'transparent', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <span className="material-symbols-outlined text-[28px] transition-colors duration-300" style={{ color }}>
          {icon}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="li-panel-kicker">{titleEn}</p>
        <h3 className="li-panel-title text-[1rem] group-hover:text-[var(--color-gold)] transition-colors duration-300">{title}</h3>
        <p className="li-panel-copy">{desc}</p>
      </div>
      <span className="material-symbols-outlined text-[var(--color-secondary)] text-lg transition-all duration-300 group-hover:translate-x-1 group-hover:text-[var(--color-gold)]">arrow_forward</span>
    </GlassCard>
  );
}

function PanelLoading({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
      <CelestialLoader size="sm" />
      <span>{text}</span>
    </div>
  );
}

function PanelError({ text }: { text: string }) {
  return <p className="text-sm text-[var(--color-coral)]">{text}</p>;
}
