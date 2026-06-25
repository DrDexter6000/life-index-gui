import { GlassCard } from '@/components/celestial/GlassCard';
import { TopicBadge } from '@/components/celestial/TopicBadge';
import { MoodTag } from '@/components/celestial/MoodTag';
import { formatDate, formatWordCount } from '@/lib/formatters';
import { useTranslation } from '@/hooks/useTranslation';

interface JournalMetadataPanelProps {
  metadata: {
    date: string;
    topics: string[];
    moods: string[];
    people: string[];
    location?: string;
    weather?: string;
    project?: string;
    links?: string[];
    wordCount: number;
  };
}

/** Thin divider line between metadata groups */
function Divider() {
  return <div className="h-px bg-white/[0.06] my-5" />;
}

/** Metadata row label with Material Symbols icon */
function MetaLabel({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[0.6875rem] text-[var(--color-secondary)] uppercase tracking-wider mb-2">
      <span className="material-symbols-outlined text-sm">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

/** Metadata value text */
function MetaValue({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-[var(--color-primary)] font-medium">{children}</div>;
}

/**
 * JournalMetadataPanel — 日志元数据面板
 * Compact two-column grid layout with visual grouping.
 */
export function JournalMetadataPanel({ metadata }: JournalMetadataPanelProps) {
  const { t } = useTranslation();
  const hasLocationOrWeather = metadata.location || metadata.weather;
  const hasPeople = metadata.people.length > 0;
  const hasProject = metadata.project;
  const hasLinks = metadata.links && metadata.links.length > 0;

  return (
    <GlassCard className="p-6" hoverable={false} glowEffect={false}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-5">
        <span className="material-symbols-outlined text-lg text-[var(--color-secondary)]">data_object</span>
        <h3 className="text-sm font-semibold text-[var(--color-primary)]">{t('metadata')}</h3>
      </div>

      <div className="space-y-0">
        {/* Row 1: Date + Word Count */}
        <div className="grid grid-cols-2 max-[640px]:grid-cols-1 gap-4">
          {metadata.date && (
            <div>
              <MetaLabel icon="calendar_today" text={t('date')} />
              <MetaValue>{formatDate(metadata.date)}</MetaValue>
            </div>
          )}
          {metadata.wordCount > 0 && (
            <div>
              <MetaLabel icon="edit_note" text={t('words')} />
              <MetaValue>{formatWordCount(metadata.wordCount)}</MetaValue>
            </div>
          )}
        </div>

        {/* Tags section */}
        {(metadata.topics.length > 0 || metadata.moods.length > 0) && <Divider />}

        {metadata.topics.length > 0 && (
          <div>
            <MetaLabel icon="label" text={t('topics')} />
            <div className="flex flex-wrap gap-2">
              {metadata.topics.map((topic) => (
                <TopicBadge key={topic} topic={topic} />
              ))}
            </div>
          </div>
        )}

        {metadata.moods.length > 0 && (
          <div className={metadata.topics.length > 0 ? 'mt-4' : ''}>
            <MetaLabel icon="mood" text={t('moods')} />
            <div className="flex flex-wrap gap-2">
              {metadata.moods.map((mood) => (
                <MoodTag key={mood} mood={mood} />
              ))}
            </div>
          </div>
        )}

        {/* People */}
        {hasPeople && <Divider />}
        {hasPeople && (
          <div>
            <MetaLabel icon="group" text={t('people')} />
            <div className="flex flex-wrap gap-2">
              {metadata.people.map((person) => (
                <span
                  key={person}
                    className="px-3 py-1 bg-[var(--color-ether-surface-ghost)] text-[var(--color-primary)] rounded-full text-xs border border-white/[0.06]"
                >
                  {person}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Context: Location + Weather + Project */}
        {hasLocationOrWeather && <Divider />}
        {hasLocationOrWeather && (
          <div className="grid grid-cols-2 max-[640px]:grid-cols-1 gap-4">
            {metadata.location && (
              <div>
                <MetaLabel icon="location_on" text={t('locationLabel')} />
                <MetaValue>{metadata.location}</MetaValue>
              </div>
            )}
            {metadata.weather && (
              <div>
                <MetaLabel icon="partly_cloudy_day" text={t('weatherLabel')} />
                <MetaValue>{metadata.weather}</MetaValue>
              </div>
            )}
          </div>
        )}

        {hasProject && (
          <div className={hasLocationOrWeather ? 'mt-4' : ''}>
            <MetaLabel icon="folder_open" text={t('project')} />
            <MetaValue>{metadata.project}</MetaValue>
          </div>
        )}

        {/* Links */}
        {hasLinks && <Divider />}
        {hasLinks && (
          <div>
            <MetaLabel icon="link" text={t('linksLabel')} />
            <div className="flex flex-col gap-1.5">
              {metadata.links!.map((link, i) => (
                <a
                  key={i}
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-cyan)] hover:text-[var(--color-gold)] text-xs underline underline-offset-2 transition-colors break-all line-clamp-2"
                >
                  {link}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </GlassCard>
  );
}
