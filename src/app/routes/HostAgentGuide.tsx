import { Link } from 'react-router';
import { GlassCard } from '@/components/celestial/GlassCard';
import { useTranslation } from '@/hooks/useTranslation';

export default function HostAgentGuide() {
  const { t } = useTranslation();

  return (
    <GlassCard className="p-6">
      <div className="flex items-start gap-4">
        <span
          className="material-symbols-outlined text-3xl flex-shrink-0 text-[var(--color-cyan)]"
          aria-hidden="true"
        >
          hub
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-[var(--color-primary)]">
            {t('hostAgentGuideTitle')}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-secondary)]">
            {t('hostAgentGuideDesc')}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-3">
        <GuideStep icon="settings_ethernet" title={t('hostAgentGuideStepRuntimeTitle')} body={t('hostAgentGuideStepRuntimeBody')} />
        <GuideStep icon="link" title={t('hostAgentGuideStepUrlTitle')} body={t('hostAgentGuideStepUrlBody')} />
        <GuideStep icon="verified" title={t('hostAgentGuideStepCheckTitle')} body={t('hostAgentGuideStepCheckBody')} />
      </div>

      <div className="mt-6 rounded-xl border border-white/[0.08] bg-[var(--color-ether-surface-ghost)] p-4">
        <p className="text-sm leading-relaxed text-[var(--color-secondary)]">
          {t('hostAgentGuideContractDesc')}
        </p>
        <code className="mt-3 block rounded-lg border border-white/[0.08] px-3 py-2 text-xs text-[var(--color-primary)]">
          docs/HOST_AGENT_HANDOFF.md
        </code>
      </div>

      <Link
        to="/maintenance/health"
        className="mt-6 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-cyan)] hover:text-[var(--color-primary)]"
      >
        {t('hostAgentGuideBackToHealth')}
        <span className="material-symbols-outlined text-sm" aria-hidden="true">chevron_right</span>
      </Link>
    </GlassCard>
  );
}

function GuideStep({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-primary)]">
        <span className="material-symbols-outlined text-lg text-[var(--color-cyan)]" aria-hidden="true">
          {icon}
        </span>
        {title}
      </div>
      <p className="text-sm leading-relaxed text-[var(--color-secondary)]">
        {body}
      </p>
    </div>
  );
}
