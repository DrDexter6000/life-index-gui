import { memo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from '@/hooks/useTranslation';
import { formatDateParts, getTopicColor, getTopicName, getMoodConfig } from '@/lib/formatters';

interface JournalCardProps {
  id: string;
  title: string;
  excerpt: string;
  date: string;
  topics: string[];
  moods: string[];
  moodEmoji?: string;
  /**
   * When true, renders as a demo card without link navigation.
   * Used for zero-data state preview cards.
   */
  isDemo?: boolean;
  /**
   * Callback when a tag (topic or mood) is clicked.
   */
  onTagClick?: (tag: string, type: 'topic' | 'mood') => void;
}

const tagColorMap: Record<string, { text: string; border: string }> = {
  gold: { text: 'var(--color-gold)', border: 'var(--color-gold-30)' },
  cyan: { text: 'var(--color-cyan)', border: 'var(--color-cyan-20)' },
  coral: { text: 'var(--color-coral)', border: 'var(--color-coral-20)' },
};

/**
 * JournalCard - 日志卡片 (search result row)
 * Horizontal layout with date pillar on the left and content on the right.
 * Gold accent line on the left edge glows on hover.
 */
export const JournalCard = memo(function JournalCard({
  id,
  title,
  excerpt,
  date,
  topics,
  moods,
  isDemo = false,
  onTagClick: _onTagClick,
}: JournalCardProps) {
  const { t } = useTranslation();
  const { monthAbbr, dayNum } = formatDateParts(date);
  const year = new Date(date).getFullYear();

  const inner = (
    <div className="flex items-stretch">
      {/* Date pillar */}
      <div className="relative flex-shrink-0 w-[72px] flex flex-col items-center justify-center py-5 px-2">
        {/* Gold accent line */}
        <div
          className="absolute left-0 top-5 bottom-5 w-[2px] rounded-full transition-all duration-300"
          style={{
            background: 'var(--color-gold)',
            opacity: 0.25,
            boxShadow: '0 0 0 rgba(255,231,146,0)',
          }}
        />
        <span
          className="text-[0.625rem] font-medium tracking-[0.12em] uppercase"
          style={{ color: 'var(--color-gold)', fontFamily: 'var(--font-order)' }}
        >
          {monthAbbr}
        </span>
        <span
          className="text-[2.5rem] font-light leading-none mt-0.5"
          style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-divine)' }}
        >
          {dayNum}
        </span>
        <span
          className="text-[0.625rem] tracking-wider mt-0.5"
          style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-order)' }}
        >
          {year}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 py-5 pr-5 flex flex-col gap-1.5">
        {/* Title with gold underline */}
        <h3
          className="text-[1.125rem] font-medium leading-[1.4] line-clamp-1"
          style={{
            fontFamily: 'var(--font-narrative)',
            color: 'var(--color-primary)',
            borderBottom: '1px solid var(--color-gold-20)',
            paddingBottom: '0.25rem',
            width: 'fit-content',
          }}
        >
          {title}
        </h3>

        {/* Excerpt */}
        <p
          className="text-[0.9375rem] leading-[1.7] line-clamp-2"
          style={{ fontFamily: 'var(--font-narrative)', color: 'var(--color-muted)' }}
        >
          {excerpt}
        </p>

        {/* Tags — outline style */}
        <div className="flex flex-wrap gap-2 mt-1">
          {topics.slice(0, 2).map((topic) => {
            const colorType = getTopicColor(topic);
            const colors = tagColorMap[colorType] || tagColorMap.cyan;
            return (
              <span
                key={topic}
                className="inline-flex items-center px-2 py-[0.125rem] rounded-full text-[0.6875rem] font-medium"
                style={{
                  fontFamily: 'var(--font-control)',
                  color: colors.text,
                  border: `1px solid ${colors.border}`,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                {getTopicName(topic)}
              </span>
            );
          })}
          {moods.slice(0, 1).map((mood) => {
            const config = getMoodConfig(mood);
            const colorType = config.color as string;
            const colors = tagColorMap[colorType] || tagColorMap.cyan;
            return (
              <span
                key={mood}
                className="inline-flex items-center gap-1 px-2 py-[0.125rem] rounded-full text-[0.6875rem] font-medium"
                style={{
                  fontFamily: 'var(--font-control)',
                  color: colors.text,
                  border: `1px solid ${colors.border}`,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                {config.emoji}
                <span>{config.label}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );

  if (isDemo) {
    return (
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'var(--color-ether-surface-light)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      to={`/journal/${id}`}
      className="block group"
      aria-label={title || t('journalEntry')}
    >
      <div
        className="rounded-2xl overflow-hidden transition-all duration-300"
        style={{
          background: 'var(--color-ether-surface-light)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* Hover glow on the gold line */}
        <style>{`
          .group:hover .journal-card-gold-line {
            opacity: 1 !important;
            box-shadow: 0 0 12px rgba(255,231,146,0.5), 0 0 24px rgba(255,231,146,0.2) !important;
          }
        `}</style>
        {/* Re-render inner with the gold line class */}
        <div className="flex items-stretch">
          <div className="relative flex-shrink-0 w-[72px] flex flex-col items-center justify-center py-5 px-2">
            <div
              className="journal-card-gold-line absolute left-0 top-5 bottom-5 w-[2px] rounded-full transition-all duration-300"
              style={{
                background: 'var(--color-gold)',
                opacity: 0.25,
              }}
            />
            <span
              className="text-[0.625rem] font-medium tracking-[0.12em] uppercase"
              style={{ color: 'var(--color-gold)', fontFamily: 'var(--font-order)' }}
            >
              {monthAbbr}
            </span>
            <span
              className="text-[2.5rem] font-light leading-none mt-0.5"
              style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-divine)' }}
            >
              {dayNum}
            </span>
            <span
              className="text-[0.625rem] tracking-wider mt-0.5"
              style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-order)' }}
            >
              {year}
            </span>
          </div>

          <div className="flex-1 min-w-0 py-5 pr-5 flex flex-col gap-1.5">
            <h3
              className="text-[1.125rem] font-medium leading-[1.4] line-clamp-1"
              style={{
                fontFamily: 'var(--font-narrative)',
                color: 'var(--color-primary)',
                borderBottom: '1px solid var(--color-gold-20)',
                paddingBottom: '0.25rem',
                width: 'fit-content',
              }}
            >
              {title}
            </h3>
            <p
              className="text-[0.9375rem] leading-[1.7] line-clamp-2"
              style={{ fontFamily: 'var(--font-narrative)', color: 'var(--color-muted)' }}
            >
              {excerpt}
            </p>
            <div className="flex flex-wrap gap-2 mt-1">
              {topics.slice(0, 2).map((topic) => {
                const colorType = getTopicColor(topic);
                const colors = tagColorMap[colorType] || tagColorMap.cyan;
                return (
                  <span
                    key={topic}
                    className="inline-flex items-center px-2 py-[0.125rem] rounded-full text-[0.6875rem] font-medium"
                    style={{
                      fontFamily: 'var(--font-control)',
                      color: colors.text,
                      border: `1px solid ${colors.border}`,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {getTopicName(topic)}
                  </span>
                );
              })}
              {moods.slice(0, 1).map((mood) => {
                const config = getMoodConfig(mood);
                const colorType = config.color as string;
                const colors = tagColorMap[colorType] || tagColorMap.cyan;
                return (
                  <span
                    key={mood}
                    className="inline-flex items-center gap-1 px-2 py-[0.125rem] rounded-full text-[0.6875rem] font-medium"
                    style={{
                      fontFamily: 'var(--font-control)',
                      color: colors.text,
                      border: `1px solid ${colors.border}`,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {config.emoji}
                    <span>{config.label}</span>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
});
