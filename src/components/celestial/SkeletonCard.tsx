import { motion } from 'motion/react';

interface SkeletonCardProps {
  /** Number of lines to show in the skeleton (default: 3) */
  lines?: number;
  /** Whether to show a header section with avatar/title placeholder */
  showHeader?: boolean;
  /** Whether to show footer tags placeholder */
  showFooter?: boolean;
  /** Animation delay in seconds for staggered effects */
  delay?: number;
  /** Custom className for the container */
  className?: string;
}

/**
 * SkeletonCard - Tiered loading skeleton for card components
 * Uses celestial color palette with subtle pulse animation
 * Part of the tiered loading system (100-300ms: skeleton, 300ms+: full loader)
 */
export function SkeletonCard({
  lines = 3,
  showHeader = true,
  showFooter = true,
  delay = 0,
  className = '',
}: SkeletonCardProps) {
  return (
    <div
      aria-hidden="true"
      className={`relative overflow-hidden rounded-[24px] p-5 flex flex-col gap-3 h-full ${className}`}
      style={{
        background: 'linear-gradient(135deg, var(--color-white-3) 0%, var(--color-white-1) 100%)',
        border: '1px solid var(--color-white-6)',
      }}
    >
      {/* Shimmer overlay */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, var(--color-gold-3) 50%, transparent 100%)',
        }}
        animate={{
          x: ['-100%', '100%'],
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: delay * 0.1,
        }}
      />

      {/* Header: Date + Mood placeholder */}
      {showHeader && (
        <div className="flex justify-between items-start">
          <SkeletonLine width="30%" delay={delay} />
          <SkeletonCircle size={28} delay={delay + 0.05} />
        </div>
      )}

      {/* Title placeholder */}
      <SkeletonLine width="70%" height={20} delay={delay + 0.1} />

      {/* Body lines */}
      {Array.from({ length: lines }).map((_, lineIndex) => {
        const isLastLine = lineIndex === lines - 1;
        const lineKey = isLastLine ? 'last-line' : `line-${lineIndex}`;
        return (
          <SkeletonLine
            key={lineKey}
            width={isLastLine ? '60%' : '100%'}
            delay={delay + 0.15 + lineIndex * 0.05}
          />
        );
      })}

      {/* Footer tags placeholder */}
      {showFooter && (
        <div className="flex flex-wrap gap-2 mt-auto pt-2">
          <SkeletonPill delay={delay + 0.3} />
          <SkeletonPill width={60} delay={delay + 0.35} />
        </div>
      )}
    </div>
  );
}

/**
 * SkeletonStatsCard - Specialized skeleton for StatsCard component
 */
export function SkeletonStatsCard({ delay = 0 }: { delay?: number }) {
  return (
    <div
      aria-hidden="true"
      className="relative overflow-hidden rounded-[24px] p-6 flex flex-col h-full"
      style={{
        background: 'linear-gradient(135deg, var(--color-white-3) 0%, var(--color-white-1) 100%)',
        border: '1px solid var(--color-white-6)',
      }}
    >
      {/* Shimmer overlay */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, var(--color-gold-3) 50%, transparent 100%)',
        }}
        animate={{
          x: ['-100%', '100%'],
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: delay * 0.1,
        }}
      />

      {/* Icon + Label row */}
      <div className="flex items-center gap-2.5 mb-4">
        <SkeletonCircle size={36} delay={delay} />
        <SkeletonLine width={80} height={20} delay={delay + 0.05} />
      </div>

      {/* Large value placeholder */}
      <SkeletonLine width="50%" height={48} delay={delay + 0.1} />

      {/* Sub-label placeholder */}
      <SkeletonLine width="40%" delay={delay + 0.15} />

      {/* Decorative line placeholder */}
      <div
        className="absolute bottom-3 left-6 right-6 h-[2px] rounded-full opacity-20"
        style={{
          background: 'linear-gradient(90deg, transparent, var(--color-gold-30), transparent)',
        }}
      />
    </div>
  );
}

/**
 * SkeletonBentoGrid - Loading skeleton for the StatsBentoGrid
 */
export function SkeletonBentoGrid() {
  const positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
  return (
    <div aria-hidden="true" className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
      {positions.map((position, index) => (
        <SkeletonStatsCard key={position} delay={index * 0.1} />
      ))}
    </div>
  );
}

/**
 * SkeletonJournalGrid - Loading skeleton for journal cards grid
 */
export function SkeletonJournalGrid({ count = 4 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
      {Array.from({ length: count }).map((_, cardIndex) => {
        const cardPosition = cardIndex < 2 ? 'top' : 'bottom';
        const cardSide = cardIndex % 2 === 0 ? 'left' : 'right';
        return (
          <SkeletonCard key={`journal-${cardPosition}-${cardSide}`} delay={cardIndex * 0.1} />
        );
      })}
    </div>
  );
}

// Internal components

function SkeletonLine({
  width,
  height = 14,
  delay = 0,
}: {
  width: string | number;
  height?: number;
  delay?: number;
}) {
  return (
    <motion.div
      className="rounded-md"
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: `${height}px`,
        background: 'var(--color-white-6)',
      }}
      animate={{
        opacity: [0.4, 0.7, 0.4],
      }}
      transition={{
        duration: 1.5,
        repeat: Infinity,
        ease: 'easeInOut',
        delay,
      }}
    />
  );
}

function SkeletonCircle({
  size,
  delay = 0,
}: {
  size: number;
  delay?: number;
}) {
  return (
    <motion.div
      className="rounded-full"
      style={{
        width: size,
        height: size,
        background: 'var(--color-white-6)',
      }}
      animate={{
        opacity: [0.4, 0.7, 0.4],
      }}
      transition={{
        duration: 1.5,
        repeat: Infinity,
        ease: 'easeInOut',
        delay,
      }}
    />
  );
}

function SkeletonPill({
  width = 50,
  delay = 0,
}: {
  width?: number;
  delay?: number;
}) {
  return (
    <motion.div
      className="rounded-full"
      style={{
        width,
        height: '22px',
        background: 'var(--color-white-6)',
      }}
      animate={{
        opacity: [0.4, 0.7, 0.4],
      }}
      transition={{
        duration: 1.5,
        repeat: Infinity,
        ease: 'easeInOut',
        delay,
      }}
    />
  );
}
