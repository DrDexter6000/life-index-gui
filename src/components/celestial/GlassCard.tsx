import { memo, useRef, useCallback, type ReactNode, type MouseEvent } from 'react';
import { motion } from 'motion/react';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  onMouseMove?: (e: MouseEvent<HTMLDivElement>) => void;
  hoverable?: boolean;
  /** @deprecated Not currently used — kept for backwards compatibility */
  glowEffect?: boolean;
}

// Custom easing as tuple for TypeScript compatibility
const customEase: [number, number, number, number] = [0.23, 1, 0.32, 1];

// Motion variants — no positional offset; only transition timing
const cardVariants = {
  hover: {
    transition: { duration: 0.4, ease: customEase },
  },
  tap: {
    transition: { duration: 0.1, ease: customEase },
  },
};

/**
 * GlassCard - BIS Ether Interface atomic component
 * Ether Interface card with fading border and minimal hover lift
 *
 * NOTE: Motion cannot interpolate rgba color values through variants.
 * borderColor is set directly in the border layer's style prop (static).
 * Shadow is animated via Motion initial/whileHover for smooth transition.
 */
export const GlassCard = memo(function GlassCard({
  children,
  className = '',
  style: customStyle,
  onClick,
  onMouseMove,
  hoverable = true,
}: GlassCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      onMouseMove?.(e);
    },
    [onMouseMove]
  );

  const cardStyles = {
    ...customStyle,
  } as React.CSSProperties;

  const baseClassName = `glass-card group relative overflow-hidden rounded-[24px] ${
    hoverable ? '' : 'no-hover'
  } ${className}`;

  // Border/shadow — borderColor set INLINE (static). Motion can't animate rgba colors.
  // Only boxShadow is animated via Motion.
  // BIS Ether Card: border/shadow handled by .glass-card::before CSS. No inline border needed.

  // If clickable, render as motion.button
  if (onClick) {
    return (
      <motion.button
        ref={cardRef as unknown as React.Ref<HTMLButtonElement>}
        type="button"
        className={`${baseClassName} group text-left cursor-pointer`}
        style={cardStyles}
        onClick={onClick}
        onMouseMove={handleMouseMove as unknown as React.MouseEventHandler<HTMLButtonElement>}
        whileHover={hoverable ? 'hover' : undefined}
        whileTap="tap"
        variants={cardVariants}
        data-testid="glasscard-button"
      >
        <div className="relative z-[3]">{children}</div>
      </motion.button>
    );
  }

  // Non-clickable version
  return (
    <motion.div
      ref={cardRef}
      className={baseClassName}
      style={cardStyles}
      onMouseMove={handleMouseMove}
      whileHover={hoverable ? 'hover' : undefined}
      variants={cardVariants}
      data-testid="glasscard-div"
    >
      <div className="relative z-[3]">{children}</div>
    </motion.div>
  );
});
