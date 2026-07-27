import { GlassCard } from '@/components/celestial/GlassCard';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * Honest placeholder for the reserved /import route.
 *
 * Import APIs remain available to non-GUI consumers, but the public GUI does
 * not expose an unfinished plan/run/rollback workflow.
 */
export default function ImportWorkflow() {
  const { t } = useTranslation();

  return (
    <main
      data-testid="import-coming-soon-page"
      className="max-w-[800px] min-h-[70vh] mx-auto px-6 py-12 flex items-center justify-center"
    >
      <GlassCard
        className="w-full p-8 sm:p-12 text-center"
        hoverable={false}
        glowEffect={false}
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--color-gold-20)] bg-[var(--color-gold-10)]"
        >
          <span className="material-symbols-outlined text-3xl text-[var(--color-gold)]">
            upload_file
          </span>
        </div>

        <p
          className="mb-3 text-xs uppercase tracking-[0.16em] text-[var(--color-muted)]"
          style={{ fontFamily: 'var(--font-order)' }}
        >
          {t('importTitle')} · {t('importTitleSecondary')}
        </p>
        <span
          className="inline-flex rounded-full border border-[var(--color-gold-20)] bg-[var(--color-gold-10)] px-3 py-1 text-[0.6875rem] uppercase tracking-[0.12em] text-[var(--color-gold)]"
          style={{ fontFamily: 'var(--font-control)' }}
        >
          {t('comingSoon')}
        </span>
        <h1
          className="mt-5 text-2xl font-normal tracking-[0.06em] text-[var(--color-primary)]"
          style={{ fontFamily: 'var(--font-divine)' }}
        >
          {t('importComingSoonTitle')}
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-[var(--color-secondary)]">
          {t('importComingSoonDescription')}
        </p>
      </GlassCard>
    </main>
  );
}
