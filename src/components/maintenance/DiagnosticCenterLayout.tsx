import { Link, useLocation, Outlet } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';

interface NavItem {
  path: string;
  labelKey: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/maintenance/health', labelKey: 'diagnosticNavHealth', icon: 'monitor_heart' },
  { path: '/maintenance/entities', labelKey: 'diagnosticNavEntities', icon: 'hub' },
  { path: '/maintenance/index', labelKey: 'diagnosticNavIndex', icon: 'manage_search' },
  { path: '/maintenance/index-tree', labelKey: 'diagnosticNavIndexTree', icon: 'account_tree' },
];

/**
 * DiagnosticCenterLayout — shared shell for the unified maintenance/diagnostics hub.
 *
 * Provides sub-navigation (tab-style) and global refresh/retry for all diagnostic pages.
 * Child routes render through <Outlet>.
 */
export default function DiagnosticCenterLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const queryClient = useQueryClient();

  const activePath = location.pathname;

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ['health'] });
    queryClient.invalidateQueries({ queryKey: ['index-diagnostics'] });
    queryClient.invalidateQueries({ queryKey: ['entities'] });
    queryClient.invalidateQueries({ queryKey: ['index-tree'] });
  }

  return (
    <div className="max-w-[900px] mx-auto px-6">
      {/* Header */}
      <section className="text-center mb-6" aria-label={t('diagnosticCenter')}>
        <h1
          className="text-[var(--text-display)] font-normal tracking-[0.08em] text-[var(--color-primary)] mb-2"
          style={{ fontFamily: 'var(--font-divine)' }}
        >
          {t('diagnosticCenter')}
        </h1>
        <p className="text-[0.9375rem] text-[var(--color-secondary)]">
          {t('diagnosticCenterSubtitle')}
        </p>
      </section>

      {/* Sub-navigation */}
      <nav
        className="flex flex-wrap items-center justify-center gap-2 mb-8"
        aria-label={t('diagnosticCenter')}
        data-testid="diagnostic-subnav"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activePath === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              data-testid={`diagnostic-nav-${item.labelKey}`}
              className={`
                flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium
                border transition-all duration-300
                ${isActive
                  ? 'border-[var(--color-gold)]/40 bg-[var(--color-gold)]/10 text-[var(--color-gold)]'
                  : 'border-white/[0.08] bg-[var(--color-ether-surface-ghost)] text-[var(--color-secondary)] hover:bg-[var(--color-ether-control)] hover:text-[var(--color-primary)]'}
              `}
            >
              <span className="material-symbols-outlined text-base">{item.icon}</span>
              <span>{t(item.labelKey)}</span>
            </Link>
          );
        })}

        {/* Global refresh */}
        <button
          type="button"
          onClick={handleRefresh}
          data-testid="diagnostic-refresh-button"
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium
            border border-white/[0.08] bg-[var(--color-ether-surface-ghost)] text-[var(--color-secondary)]
            hover:bg-[var(--color-ether-control)] hover:text-[var(--color-primary)] transition-all duration-300"
          title={t('healthRetry')}
        >
          <span className="material-symbols-outlined text-base">refresh</span>
          <span>{t('healthRetry')}</span>
        </button>
      </nav>

      {/* Child route content */}
      <Outlet />
    </div>
  );
}
