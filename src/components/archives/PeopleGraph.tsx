import { GlassCard } from '@/components/celestial/GlassCard';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * PeopleGraph — confirmed relationship graph placeholder.
 *
 * DESIGN.md refs:
 * - The Panel Card Voice Rule
 * - tokens.json: colors gold #ffe792, cyan #85fff2, coral #ffb4a6, lavender #C4B6FE
 */
export function PeopleGraph() {
  const { t } = useTranslation();

  return (
    <GlassCard className="p-5 min-h-[260px] flex flex-col items-center justify-center text-center" hoverable={false}>
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center mb-3"
        style={{ background: 'rgba(133, 255, 242, 0.08)', border: '1px solid rgba(133, 255, 242, 0.15)' }}
      >
        <span className="material-symbols-outlined text-[var(--color-cyan)] text-xl">hub</span>
      </div>
      <p className="li-panel-kicker mb-2">{t('peopleGraphEn')}</p>
      <h3 className="li-panel-title text-[1rem] mb-2">{t('peopleGraph')}</h3>
      <p className="text-[var(--color-primary)] text-sm mb-1" style={{ fontFamily: 'var(--font-narrative)' }}>
        {t('peopleGraphConfirmedPending')}
      </p>
      <p className="text-[var(--color-secondary)] text-xs">
        {t('peopleGraphConfirmedPendingHint')}
      </p>
    </GlassCard>
  );
}
