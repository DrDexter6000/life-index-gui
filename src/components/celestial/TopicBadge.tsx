import { memo } from 'react';
import { getTopicColor, getTopicName } from '@/lib/formatters';
import type { KeyboardEvent } from 'react';

interface TopicBadgeProps {
  topic: string;
  onClick?: () => void;
}

/**
 * TopicBadge - 题签 (Topic Label)
 * Small badge for topic categorization
 * Color-coded based on topic type
 */
export const TopicBadge = memo(function TopicBadge({ topic, onClick }: TopicBadgeProps) {
  const colorType = getTopicColor(topic);

  const colorMap: Record<string, { bg: string; text: string; border: string }> = {
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

  const colors = colorMap[colorType] || colorMap.cyan;

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <button
      type="button"
      className={`inline-flex items-center px-2 py-[0.125rem] rounded-full text-[0.6875rem] font-medium transition-all duration-300 ${
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
      {getTopicName(topic)}
    </button>
  );
});
