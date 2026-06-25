import { Link } from 'react-router';
import { motion } from 'motion/react';
import { GlassCard } from '@/components/celestial/GlassCard';
import { formatDate } from '@/lib/formatters';
import { useTranslation } from '@/hooks/useTranslation';

interface RelatedJournal {
  id: string;
  title: string;
  excerpt: string;
  date: string;
  relevance: number;
}

interface RelatedJournalsProps {
  journals: RelatedJournal[];
}

/**
 * RelatedJournals - 相关推荐
 * Shows semantically related journal entries
 */
export function RelatedJournals({ journals }: RelatedJournalsProps) {
  const { t } = useTranslation();

  if (journals.length === 0) return null;

  return (
    <div className="mt-10">
      <h3 className="text-lg font-semibold text-[var(--color-primary)] mb-5 flex items-center gap-2">
        <span>🔗</span>
        {t('related')}
      </h3>

      <div className="grid grid-cols-3 gap-4 max-[900px]:grid-cols-2 max-[600px]:grid-cols-1">
        {journals.map((journal, index) => (
          <motion.div
            key={journal.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: index * 0.1,
              ease: [0.23, 1, 0.32, 1],
            }}
          >
            <Link to={`/journal/${journal.id}`} aria-label={journal.title || t('relatedJournal')}>
              <GlassCard className="p-5 h-full" hoverable={true} glowEffect={true}>
                {/* Relevance indicator */}
                <div className="flex items-center gap-1 mb-3">
                  <div className="flex-1 h-1 bg-[var(--color-ether-control)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[var(--color-gold)] to-[var(--color-gold-mid)] rounded-full"
                      style={{ width: `${Math.round(journal.relevance * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-[var(--color-secondary)]">
                    {Math.round(journal.relevance * 100)}%
                  </span>
                </div>

                {/* Date */}
                <div className="text-xs text-[var(--color-cyan)] uppercase tracking-wider mb-2">
                  {formatDate(journal.date)}
                </div>

                {/* Title */}
                <h4 className="text-sm font-semibold text-[var(--color-primary)] mb-2 line-clamp-2">
                  {journal.title}
                </h4>

                {/* Excerpt */}
                <p className="text-xs text-[var(--color-muted)] line-clamp-2">
                  {journal.excerpt}
                </p>
              </GlassCard>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
