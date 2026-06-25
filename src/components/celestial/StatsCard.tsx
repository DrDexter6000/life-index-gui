import { memo } from 'react';
import { GlassCard } from './GlassCard';
import { motion } from 'motion/react';
import { useTranslation } from '@/hooks/useTranslation';

interface StatsCardProps {
  value: string | number;
  label: string;
  subLabel?: string;
  icon?: React.ReactNode;
  iconName?: string;
  color?: 'gold' | 'cyan' | 'coral';
  delay?: number;
}

// Custom easing as tuple for TypeScript compatibility
const customEase: [number, number, number, number] = [0.23, 1, 0.32, 1];

// Motion variants for tap feedback only (hover is owned by GlassCard / Ether Card)
const cardMotionVariants = {
  tap: {
    scale: 0.98,
    transition: {
      duration: 0.1,
      ease: customEase,
    },
  },
};

/**
 * StatsCard - 数碑卡片 (Stats Monument Card)
 * Displays a statistic with animated value and glassmorphism styling
 * Part of the Stats Bento Grid on The Core page
 * Includes tap feedback via motion variants (Round 6)
 */
export const StatsCard = memo(function StatsCard({
  value,
  label,
  subLabel,
  icon,
  iconName,
  color = 'gold',
  delay = 0,
}: StatsCardProps) {
  // Color map using CSS theme tokens for glow effects
  const colorMap = {
    gold: {
      text: 'var(--color-gold)',
      glow: 'var(--color-gold-glow-soft)',
      iconBg: 'var(--color-gold-icon-bg)',
    },
    cyan: {
      text: 'var(--color-cyan)',
      glow: 'var(--color-cyan-glow-soft)',
      iconBg: 'var(--color-cyan-icon-bg)',
    },
    coral: {
      text: 'var(--color-coral)',
      glow: 'var(--color-coral-glow-soft)',
      iconBg: 'var(--color-coral-icon-bg)',
    },
  };

  const colors = colorMap[color];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.23, 1, 0.32, 1] }}
      whileTap="tap"
      variants={cardMotionVariants}
      style={{ willChange: 'transform' }}
    >
      <GlassCard className="p-6 flex flex-col h-full relative" hoverable={true} glowEffect={true}>
        {/* Icon and Label Row */}
        <div className="flex items-center gap-2.5 mb-4">
          {(icon || iconName) && (
            <div
              className="w-9 h-9 rounded-[10px] flex items-center justify-center text-lg"
              style={{ background: colors.iconBg, color: colors.text }}
            >
              {iconName ? (
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{iconName}</span>
              ) : (
                icon
              )}
            </div>
          )}
          <h2 className="text-[var(--text-headline)] font-medium text-[var(--color-primary)]" style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.04em' }}>
            {label}
          </h2>
        </div>

        {/* Value */}
        <motion.span
          className="text-[3rem] font-extrabold leading-none mb-2"
          style={{ color: colors.text }}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: delay + 0.2, ease: [0.23, 1, 0.32, 1] }}
        >
          {value}
        </motion.span>

        {/* Sub Label */}
        {subLabel && (
          <p className="text-[var(--text-caption)] text-[var(--color-secondary)] leading-[1.5] font-normal" style={{ fontFamily: 'var(--font-order)' }}>
            {subLabel}
          </p>
        )}

        {/* Decorative glow line - positioned with bottom margin to avoid overflow clipping */}
        <div
          className="absolute bottom-3 left-6 right-6 h-[2px] rounded-full opacity-40"
          style={{
            background: `linear-gradient(90deg, transparent, ${colors.text}, transparent)`,
            boxShadow: `0 0 10px ${colors.glow}`,
          }}
        />
      </GlassCard>
    </motion.div>
  );
});

/**
 * StatsBentoGrid - 数碑网格
 * 2x2 grid layout for dashboard statistics
 */
interface StatsBentoGridProps {
  stats: {
    totalJournals: number;
    totalWords: number;
    activeDays: number;
    streakDays: number;
  };
  isDemo?: boolean;
}

// Demo stats for zero-data state
const DEMO_STATS = {
  totalJournals: 42,
  totalWords: 15800,
  activeDays: 28,
  streakDays: 7,
};

// Material Symbols icon names aligned with prototype
const STAT_ICONS = {
  totalJournals: 'auto_stories',
  totalWords: 'edit_note',
  activeDays: 'calendar_month',
  streakDays: 'local_fire_department',
};

export function StatsBentoGrid({ stats, isDemo = false }: StatsBentoGridProps) {
  const { t } = useTranslation();
  const formatNumber = (num: number): string => {
    if (num >= 10000) {
      return `${(num / 1000).toFixed(1)}k`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}k`;
    }
    return num.toString();
  };

  const displayStats = isDemo ? DEMO_STATS : stats;

  const statsData = [
    {
      value: formatNumber(displayStats.totalJournals),
      label: t('totalArticles'),
      subLabel: 'Total Entries',
      iconName: STAT_ICONS.totalJournals,
      color: 'gold' as const,
    },
    {
      value: formatNumber(displayStats.totalWords),
      label: t('totalWordsCount'),
      subLabel: 'Words Written',
      iconName: STAT_ICONS.totalWords,
      color: 'cyan' as const,
    },
    {
      value: displayStats.activeDays,
      label: t('activeDaysCount'),
      subLabel: 'Days Active',
      iconName: STAT_ICONS.activeDays,
      color: 'coral' as const,
    },
    {
      value: displayStats.streakDays,
      label: t('streakDaysCount'),
      subLabel: 'Day Streak',
      iconName: STAT_ICONS.streakDays,
      color: 'gold' as const,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
      {statsData.map((stat, index) => (
        <StatsCard
          key={stat.label}
          value={stat.value}
          label={stat.label}
          subLabel={stat.subLabel}
          iconName={stat.iconName}
          color={stat.color}
          delay={index * 0.1}
        />
      ))}
    </div>
  );
}
