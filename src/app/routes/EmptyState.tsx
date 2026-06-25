import { GlassCard } from '@/components/celestial/GlassCard';
import { motion } from 'motion/react';
import { useTranslation } from '@/hooks/useTranslation';

interface EmptyStateProps {
  /** Optional callback when "写第一篇" button is clicked. Defaults to navigating to /. */
  onWriteClick?: () => void;
}

/**
 * EmptyState - 初见 (Onboarding / Zero-data State)
 * Shown when user has no journal entries.
 * Renders as part of TheCore when totalJournals === 0.
 */
export default function EmptyState({ onWriteClick }: EmptyStateProps) {
  const { t } = useTranslation();
  return (
    <motion.div
      className="max-w-[800px] mx-auto px-6 flex flex-col items-center justify-center min-h-[70vh] text-center"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: [0.23, 1, 0.32, 1] }}
    >
      {/* Star animation */}
      <div className="relative w-24 h-24 mb-8">
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full"
          style={{
            background: 'var(--color-gold)',
            boxShadow: '0 0 24px var(--color-gold-40), 0 0 48px var(--color-gold-20)',
          }}
          animate={{
            scale: [1, 1.3, 1],
            boxShadow: [
              '0 0 24px var(--color-gold-40), 0 0 48px var(--color-gold-20)',
              '0 0 32px var(--color-gold-60), 0 0 64px var(--color-gold-30)',
              '0 0 24px var(--color-gold-40), 0 0 48px var(--color-gold-20)',
            ],
          }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full border border-[var(--color-gold-20)]"
          animate={{ rotate: 360 }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        />
      </div>

      <h1 className="text-2xl font-normal tracking-[0.08em] text-[var(--color-primary)] mb-3" style={{ fontFamily: 'var(--font-divine)' }}>
        {t('skyNotLit')}
      </h1>
      <p className="text-[0.9375rem] text-[var(--color-secondary)] mb-10 max-w-md">
        {t('firstEntryDesc')}
      </p>

      <div className="flex gap-4 flex-wrap justify-center">
        <button
          type="button"
          aria-label={t('writeFirst')}
          onClick={onWriteClick}
          className="flex items-center gap-2 px-8 py-4 rounded-full font-bold text-[0.9375rem] cursor-pointer transition-all duration-300 hover:shadow-lg"
          style={{
            background: 'linear-gradient(135deg, var(--color-gold), var(--color-gold-mid))',
            color: 'var(--color-void)',
            boxShadow: '0 4px 20px var(--color-gold-30)',
          }}
        >
          <span className="material-symbols-outlined">edit</span>
          {t('writeFirst')}
        </button>

        <GlassCard className="px-8 py-4 cursor-not-allowed opacity-50" hoverable={false}>
          <div className="flex items-center gap-2 text-[0.9375rem] font-medium text-[var(--color-muted)]">
            <span className="material-symbols-outlined">upload_file</span>
            {t('importHistory')}
            <span className="text-[0.6875rem] px-2 py-0.5 rounded-full" style={{
              background: 'var(--color-white-5)',
              color: 'var(--color-secondary)',
              border: '1px solid var(--color-white-6)',
            }}>
              {t('comingSoon')}
            </span>
          </div>
        </GlassCard>
      </div>
    </motion.div>
  );
}
