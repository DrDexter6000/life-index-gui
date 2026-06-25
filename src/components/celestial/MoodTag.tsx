import { memo } from 'react';
import { getMoodConfig, type MoodType } from '@/lib/formatters';
import type { KeyboardEvent } from 'react';

interface MoodTagProps {
  mood: string;
  showEmoji?: boolean;
  onClick?: () => void;
}

/**
 * MoodTag - 心绪签 (Mood Label)
 * Tag for mood/emotion display with emoji support
 * Color-coded: gold (happy/excited), cyan (calm/focused), coral (anxious/sad)
 */
export const MoodTag = memo(function MoodTag({ mood, showEmoji = false, onClick }: MoodTagProps) {
  const config = getMoodConfig(mood);
  const colorType: MoodType = config.color;

  const colorMap: Record<MoodType, { bg: string; text: string; border: string }> = {
    gold: {
      bg: 'var(--color-gold-15)',
      text: 'var(--color-gold)',
      border: 'var(--color-gold-20)',
    },
    cyan: {
      bg: 'var(--color-cyan-15)',
      text: 'var(--color-cyan)',
      border: 'var(--color-cyan-20)',
    },
    coral: {
      bg: 'var(--color-coral-15)',
      text: 'var(--color-coral)',
      border: 'var(--color-coral-20)',
    },
  };

  const colors = colorMap[colorType];

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 px-2 py-[0.125rem] rounded-full text-[0.6875rem] font-medium transition-all duration-300 ${
        onClick ? 'cursor-pointer hover:opacity-80' : ''
      }`}
      style={{
        fontFamily: 'var(--font-control)',
        background: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      {showEmoji && <span>{config.emoji}</span>}
      <span>{config.label}</span>
    </button>
  );
});
