import { memo } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { useTranslation } from '@/hooks/useTranslation';

interface FABProps {
  onClick?: () => void;
  to?: string;
}

// Custom easing as tuple for TypeScript compatibility
const customEase: [number, number, number, number] = [0.23, 1, 0.32, 1];

// Motion variants for press animation
const fabMotionVariants = {
  initial: {
    scale: 1,
    transition: {
      duration: 0.2,
      ease: customEase,
    },
  },
  hover: {
    scale: 1.05,
    transition: {
      duration: 0.3,
      ease: customEase,
    },
  },
  tap: {
    scale: 0.95,
    transition: {
      duration: 0.1,
      ease: customEase,
    },
  },
};

// Motion variants for icon rotation on hover
const iconMotionVariants = {
  initial: {
    rotate: 0,
    scale: 1,
    transition: {
      duration: 0.3,
      ease: customEase,
    },
  },
  hover: {
    rotate: 90,
    scale: 1.1,
    transition: {
      duration: 0.3,
      ease: customEase,
    },
  },
  tap: {
    scale: 0.9,
    transition: {
      duration: 0.1,
      ease: customEase,
    },
  },
};

// Motion variants for glow ring
const glowMotionVariants = {
  initial: {
    opacity: 0,
    scale: 1,
    transition: {
      duration: 0.3,
      ease: customEase,
    },
  },
  hover: {
    opacity: 1,
    scale: 1.1,
    transition: {
      duration: 0.3,
      ease: customEase,
    },
  },
};

/**
 * FAB - 执笔 (Floating Action Button)
 * Gold gradient button with plus icon
 * Fixed bottom-right with safe margin
 * Links to home page (editor is now on home)
 * Includes press animation via motion variants (Round 6)
 */
export const FAB = memo(function FAB({ onClick, to = '/' }: FABProps) {
  const { t } = useTranslation();
  const handleClick = () => {
    if (onClick) {
      onClick();
    }
  };

  return (
    <Link
      to={to}
      onClick={handleClick}
      className="fixed bottom-20 right-6 lg:bottom-10 lg:right-10 z-[90] group"
      aria-label={t('newJournal')}
    >
      <motion.div
        className="w-14 h-14 rounded-full flex items-center justify-center"
        style={{
          background: 'transparent',
          color: 'var(--color-gold)',
          border: '1px solid rgba(255, 231, 146, 0.4)',
          willChange: 'transform',
        }}
        initial="initial"
        whileHover="hover"
        whileTap="tap"
        variants={fabMotionVariants}
      >
        <motion.span
          className="material-symbols-outlined text-2xl lg:text-3xl"
          style={{ color: 'var(--color-gold)' }}
          variants={iconMotionVariants}
        >
          add
        </motion.span>
      </motion.div>

      {/* Hover glow ring */}
      <motion.div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          boxShadow: `
            0 0 0 2px var(--color-gold-30),
            0 8px 32px var(--color-gold-40)
          `,
        }}
        initial="initial"
        animate="initial"
        whileHover="hover"
        variants={glowMotionVariants}
      />
    </Link>
  );
});