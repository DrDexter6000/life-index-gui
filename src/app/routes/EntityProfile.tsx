import { Link, useNavigate, useParams } from 'react-router';
import type { ReactNode } from 'react';
import { GlassCard } from '@/components/celestial/GlassCard';
import { PageLoader } from '@/components/celestial/CelestialLoader';
import { useTranslation } from '@/hooks/useTranslation';
import { useEntityProfile } from '@/hooks/useJournals';
import { APIClientError, type EntityProfile as EntityProfileData } from '@/lib/api-client';

type ProfileRelationship = EntityProfileData['relationships'][number];
type ProfileMention = EntityProfileData['mentions'][number];

function journalPathToRoute(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/^Journals\//, '').replace(/\.md$/, '');
  return `/journal/${normalized}`;
}

function fieldText(value: unknown, fallback = '—'): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number') return String(value);
  return fallback;
}

function errorCode(error: unknown): string {
  return error instanceof APIClientError ? error.code : 'UNKNOWN_ERROR';
}

function errorDetails(error: unknown): Record<string, unknown> {
  return error instanceof APIClientError && error.details ? error.details : {};
}

function confirmedRelationships(relationships: ProfileRelationship[]): ProfileRelationship[] {
  return relationships.filter((relationship) => (
    String(relationship.status ?? 'confirmed').toLowerCase() === 'confirmed'
  ));
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: ReactNode;
}) {
  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="material-symbols-outlined text-lg text-[var(--color-gold)]">{icon}</span>
        <h2 className="text-base font-semibold text-[var(--color-primary)]">{title}</h2>
      </div>
      {children}
    </GlassCard>
  );
}

function ErrorState({
  code,
  details,
  onRetry,
}: {
  code: string;
  details: Record<string, unknown>;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const isCandidate = code === 'ENTITY_PROFILE_CANDIDATE';
  const isNotFound = code === 'ENTITY_PROFILE_NOT_FOUND' || code === 'NOT_FOUND';
  const command = fieldText(details.suggested_command, 'life-index entity --review');

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <GlassCard className="p-6 text-center">
        <span className="material-symbols-outlined mb-3 block text-3xl text-[var(--color-amber)]">
          {isCandidate ? 'pending_actions' : 'info'}
        </span>
        <h1 className="mb-2 text-xl text-[var(--color-primary)]">
          {isCandidate
            ? t('entityProfileCandidateTitle')
            : isNotFound
              ? t('entityProfileNotFoundTitle')
              : t('entityProfileUnavailableTitle')}
        </h1>
        <p className="mx-auto mb-4 max-w-xl text-sm leading-6 text-[var(--color-secondary)]">
          {isCandidate ? t('entityProfileCandidateDesc') : code}
        </p>
        {isCandidate && (
          <div className="mb-4 rounded-lg border border-white/[0.08] bg-[var(--color-ether-surface-ghost)] px-3 py-2 text-sm text-[var(--color-secondary)]">
            <div className="mb-1 text-xs uppercase tracking-wider text-[var(--color-muted)]">
              {t('entityProfileCliCommand')}
            </div>
            <code className="text-[var(--color-primary)]">{command}</code>
          </div>
        )}
        <div className="flex flex-wrap justify-center gap-3">
          {isCandidate && (
            <Link
              to="/maintenance/entities"
              className="rounded-full border border-white/[0.12] px-4 py-2 text-sm text-[var(--color-primary)]"
            >
              {t('entityProfileReviewLink')}
            </Link>
          )}
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full border border-white/[0.12] px-4 py-2 text-sm text-[var(--color-secondary)]"
          >
            {t('retry')}
          </button>
        </div>
      </GlassCard>
    </div>
  );
}

function Relationships({
  relationships,
}: {
  relationships: ProfileRelationship[];
}) {
  const { t } = useTranslation();
  if (relationships.length === 0) {
    return <p className="text-sm text-[var(--color-secondary)]">{t('entityProfileNoRelationships')}</p>;
  }

  return (
    <ul className="space-y-3">
      {relationships.map((relationship, index) => (
        <li
          key={`${relationship.target}-${relationship.relation ?? index}`}
          className="rounded-lg border border-white/[0.08] bg-[var(--color-ether-surface-ghost)] p-3"
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-xs text-[var(--color-gold)]">
              {fieldText(relationship.relation)}
            </span>
            <Link
              to={`/entities/${encodeURIComponent(relationship.target)}`}
              className="text-sm font-medium text-[var(--color-primary)]"
            >
              {fieldText(relationship.target_name, relationship.target)}
            </Link>
            <span className="font-mono text-xs text-[var(--color-muted)]">{relationship.target}</span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-[var(--color-muted)]">
            <span>{fieldText(relationship.source)}</span>
            <span>{fieldText(relationship.created_at)}</span>
            <span>{t('entityProfileEvidenceCount', { count: relationship.evidence.length })}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Mentions({ mentions }: { mentions: ProfileMention[] }) {
  const { t } = useTranslation();
  if (mentions.length === 0) {
    return <p className="text-sm text-[var(--color-secondary)]">{t('entityProfileNoMentions')}</p>;
  }

  return (
    <ul className="space-y-3">
      {mentions.map((mention) => (
        <li key={mention.rel_path}>
          <Link
            to={journalPathToRoute(mention.rel_path)}
            className="block rounded-lg border border-white/[0.08] bg-[var(--color-ether-surface-ghost)] p-3"
          >
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-[var(--color-primary)]">
                {fieldText(mention.title, mention.rel_path)}
              </span>
              <span className="text-xs text-[var(--color-muted)]">{fieldText(mention.date)}</span>
            </div>
            <div className="font-mono text-xs text-[var(--color-muted)]">{mention.rel_path}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function EntityProfile() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams();
  const entityId = params.entityId ? decodeURIComponent(params.entityId) : '';
  const profileQuery = useEntityProfile(entityId);
  const profile = profileQuery.data;

  if (profileQuery.isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20">
        <PageLoader />
      </div>
    );
  }

  if (profileQuery.isError || !profile) {
    return (
      <ErrorState
        code={errorCode(profileQuery.error)}
        details={errorDetails(profileQuery.error)}
        onRetry={() => profileQuery.refetch()}
      />
    );
  }

  const identity = profile.identity;
  const relationships = confirmedRelationships(profile.relationships);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-6 flex items-center gap-2 text-sm text-[var(--color-secondary)] transition-colors hover:text-[var(--color-primary)]"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        {t('back')}
      </button>

      <header className="mb-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
            {identity.entity_id}
          </span>
          {identity.is_self && (
            <span className="rounded-full border border-white/[0.12] px-2 py-0.5 text-xs text-[var(--color-gold)]">
              {t('entityProfileSelf')}
            </span>
          )}
        </div>
        <h1
          className="text-4xl leading-tight text-[var(--color-primary)]"
          style={{ fontFamily: 'var(--font-divine)' }}
        >
          {identity.primary_name}
        </h1>
        <p className="mt-2 text-sm text-[var(--color-secondary)]">{t('entityProfileTitle')}</p>
      </header>

      <div className="grid gap-4">
        <Section title={t('entityProfileStatus')} icon="badge">
          <div className="grid gap-3 sm:grid-cols-3">
            <InfoPill label={t('entityProfileType')} value={identity.type} />
            <InfoPill label={t('entityProfileKind')} value={identity.kind ?? '—'} />
            <InfoPill label={t('entityProfileStatus')} value={identity.status} />
          </div>
        </Section>

        <Section title={t('entityProfileAliases')} icon="alternate_email">
          {identity.aliases.length === 0 ? (
            <p className="text-sm text-[var(--color-secondary)]">{t('entityProfileNoAliases')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {identity.aliases.map((alias) => (
                <span
                  key={alias}
                  className="rounded-full border border-white/[0.08] px-3 py-1 text-xs text-[var(--color-secondary)]"
                >
                  {alias}
                </span>
              ))}
            </div>
          )}
        </Section>

        <Section title={t('entityProfileRelationships')} icon="hub">
          <Relationships relationships={relationships} />
        </Section>

        <Section title={t('entityProfileMentions')} icon="article">
          <Mentions mentions={profile.mentions} />
        </Section>

        <Section title={t('entityProfileEvidence')} icon="fact_check">
          {profile.evidence.length === 0 ? (
            <p className="text-sm text-[var(--color-secondary)]">{t('entityProfileNoEvidence')}</p>
          ) : (
            <ul className="space-y-2">
              {profile.evidence.map((item) => (
                <li key={item} className="font-mono text-xs text-[var(--color-muted)]">
                  {item}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t('entityProfileStats')} icon="monitoring">
          <div className="grid gap-3 sm:grid-cols-4">
            <InfoPill label={t('entityProfileMentionCount')} value={profile.stats.mention_count} />
            <InfoPill label={t('entityProfileRelationshipCount')} value={profile.stats.relationship_count} />
            <InfoPill label={t('entityProfileFirstMention')} value={profile.stats.first_mention ?? '—'} />
            <InfoPill label={t('entityProfileLatestMention')} value={profile.stats.latest_mention ?? '—'} />
          </div>
        </Section>
      </div>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-[var(--color-ether-surface-ghost)] p-3">
      <div className="mb-1 text-xs uppercase tracking-wider text-[var(--color-muted)]">{label}</div>
      <div className="text-sm text-[var(--color-primary)]">{fieldText(value)}</div>
    </div>
  );
}
