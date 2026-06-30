import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { GlassCard } from '@/components/celestial/GlassCard';
import { CelestialLoader } from '@/components/celestial/CelestialLoader';
import { useTranslation } from '@/hooks/useTranslation';
import {
  useIndexTreeDiscover,
  useIndexTreeEnsure,
  useIndexTreeNavigate,
  useIndexTreeShadow,
} from '@/hooks/useIndexTree';
import type { IndexTreeFacet } from '@/lib/api-client';

const FACET_OPTIONS: Array<{ value: IndexTreeFacet; labelKey: string }> = [
  { value: 'topic', labelKey: 'indexTreeFacetTopic' },
  { value: 'people', labelKey: 'indexTreeFacetPeople' },
  { value: 'project', labelKey: 'indexTreeFacetProject' },
];

function basename(path: string) {
  return path.split('/').filter(Boolean).pop() ?? path;
}

/**
 * Canonical Index Tree evidence navigation diagnostics.
 *
 * Discover presents deterministic facet menus. Navigate runs only after a user
 * picks values. Shadow stays diagnostic-only and never feeds search ranking.
 */
export default function IndexTreeDiagnostics() {
  const { t } = useTranslation();
  const [facet, setFacet] = useState<IndexTreeFacet>('topic');
  const [selectedValue, setSelectedValue] = useState('');
  const [shadowDraft, setShadowDraft] = useState('');
  const [shadowQuery, setShadowQuery] = useState('');

  const discoverQuery = useIndexTreeDiscover({ facets: [facet] });
  const isStale = discoverQuery.data?.data?.freshness?.fresh === false;
  const ensureQuery = useIndexTreeEnsure({}, isStale);
  const navigateQuery = useIndexTreeNavigate({
    filters: selectedValue ? [{ facet, values: [selectedValue] }] : [],
  });
  const shadowDiagnosticsQuery = useIndexTreeShadow(shadowQuery);

  const discoverData = discoverQuery.data?.data;
  const facetMenu = discoverData?.facets?.[facet];
  const navigateData = navigateQuery.data?.data;
  const ensureFallback = ensureQuery.data?.data?.fallback;
  const shadowData = shadowDiagnosticsQuery.data?.data;

  function handleFacetChange(nextFacet: IndexTreeFacet) {
    setFacet(nextFacet);
    setSelectedValue('');
  }

  function handleShadowSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShadowQuery(shadowDraft.trim());
  }

  const entries = navigateData?.entries ?? [];
  const entryPointers = navigateData?.entry_pointers ?? [];

  return (
    <div className="max-w-[900px] mx-auto px-6" data-testid="index-tree-diagnostics-page">
      <section className="text-center mb-10" aria-label={t('indexTreeDiagnostics')}>
        <h1
          className="text-[var(--text-display)] font-normal tracking-[0.08em] text-[var(--color-primary)] mb-2"
          style={{ fontFamily: 'var(--font-divine)' }}
        >
          {t('indexTreeDiagnostics')}
        </h1>
        <p className="text-[0.9375rem] text-[var(--color-secondary)]">
          {t('indexTreeDiagnosticsSubtitle')}
        </p>
      </section>

      <GlassCard className="p-6 mb-6">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="text-base font-semibold text-[var(--color-primary)]">{t('indexTreeDiscover')}</h2>
          <div className="flex gap-2">
            {FACET_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleFacetChange(option.value)}
                aria-pressed={facet === option.value}
                className="px-3 py-1 rounded-lg text-xs border border-white/[0.08] text-[var(--color-secondary)] aria-pressed:text-[var(--color-gold)]"
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-[var(--color-muted)] mb-4">{t('indexTreeDiscoverDesc')}</p>

        {discoverQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <CelestialLoader size="sm" />
            <span>{t('indexTreeLoading')}</span>
          </div>
        )}

        {discoverQuery.isError && (
          <p className="text-sm text-[var(--color-muted)]">{t('indexTreeUnavailable')}</p>
        )}

        {!discoverQuery.isLoading && !discoverQuery.isError && (
          <div className="space-y-3">
            {facetMenu?.values.map((value) => (
              <button
                key={value.value}
                type="button"
                data-testid="index-tree-discover-value"
                onClick={() => setSelectedValue(value.value)}
                aria-pressed={selectedValue === value.value}
                className="w-full text-left rounded-lg border border-white/[0.08] p-4 bg-[var(--color-ether-surface-ghost)] text-[var(--color-secondary)] transition-colors hover:border-[var(--color-gold)] aria-pressed:border-[var(--color-gold)]"
              >
                <span className="flex items-center justify-between gap-3 mb-2">
                  <span className="text-sm font-medium text-[var(--color-primary)]">{value.value}</span>
                  <span className="text-xs text-[var(--color-secondary)]">{value.count}</span>
                </span>
                <span className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">
                  {value.sample_entry_pointers.map((pointer) => (
                    <span key={pointer}>{pointer}</span>
                  ))}
                </span>
              </button>
            ))}
          </div>
        )}

        {isStale && ensureFallback && (
          <div
            data-testid="index-tree-fallback"
            className="mt-4 rounded-lg border border-[var(--color-gold)]/30 p-4 bg-[var(--color-ether-surface-ghost)] text-sm text-[var(--color-secondary)]"
          >
            <div className="font-medium text-[var(--color-primary)] mb-2">{t('indexTreeFallback')}</div>
            <div>{ensureFallback.reason ?? 'fallback'}</div>
            <div className="mt-2 flex flex-col gap-1">
              {ensureFallback.journal_fallback_pointers.map((pointer) => (
                <span key={pointer}>{pointer}</span>
              ))}
            </div>
          </div>
        )}
      </GlassCard>

      <GlassCard className="p-6 mb-6">
        <h2 className="text-base font-semibold text-[var(--color-primary)] mb-2">{t('indexTreeNavigate')}</h2>
        <p className="text-sm text-[var(--color-muted)] mb-4">{t('indexTreeNavigateDesc')}</p>

        {navigateQuery.isError && (
          <p className="text-sm text-[var(--color-muted)]">{t('indexTreeUnavailable')}</p>
        )}

        {selectedValue && navigateData && (
          <div
            data-testid="index-tree-navigate-result"
            className="rounded-lg border border-white/[0.08] p-4 bg-[var(--color-ether-surface-ghost)]"
          >
            {entries.length > 0 && (
              <div className="space-y-3">
                {entries.map((entry, index) => {
                  const pointer = entry.relative_path ?? entryPointers[index];
                  if (!pointer) return null;
                  return (
                    <div key={pointer} className="text-sm text-[var(--color-secondary)]">
                      {entry.title && (
                        <div className="font-medium text-[var(--color-primary)] mb-1">{entry.title}</div>
                      )}
                      <Link
                        to={`/journal/${pointer}`}
                        className="text-[var(--color-cyan)] hover:text-[var(--color-gold)] transition-colors"
                      >
                        {basename(pointer)}
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}

            {entries.length === 0 && (
              <div className="flex flex-col gap-1">
                {entryPointers.map((pointer) => (
                  <Link
                    key={pointer}
                    to={`/journal/${pointer}`}
                    className="text-sm text-[var(--color-cyan)] hover:text-[var(--color-gold)] transition-colors"
                  >
                    {basename(pointer)}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </GlassCard>

      <GlassCard className="p-6 mb-6">
        <h2 className="text-base font-semibold text-[var(--color-primary)] mb-2">{t('indexTreeShadow')}</h2>
        <p className="text-sm text-[var(--color-muted)] mb-4">{t('indexTreeShadowDesc')}</p>
        <form onSubmit={handleShadowSubmit} className="flex gap-2 mb-4">
          <input
            value={shadowDraft}
            onChange={(event) => setShadowDraft(event.target.value)}
            aria-label={t('indexTreeShadowPlaceholder')}
            placeholder={t('indexTreeShadowPlaceholder')}
            className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-[var(--color-ether-surface-ghost)] border border-white/[0.08] text-sm text-[var(--color-primary)]"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-lg text-sm bg-[var(--color-ether-surface-ghost)] text-[var(--color-secondary)] border border-white/[0.08]"
          >
            {t('indexTreeShadowRun')}
          </button>
        </form>

        {shadowData && (
          <div
            data-testid="index-tree-shadow-diagnostic"
            className="rounded-lg border border-white/[0.08] p-4 bg-[var(--color-ether-surface-ghost)] text-sm text-[var(--color-secondary)]"
          >
            <div>{shadowData.query}</div>
            <div>{t('indexTreeShadowRecallPreserved')}: {String(shadowData.recall_preserved)}</div>
            <div>{t('indexTreeShadowDroppedPaths')}: {shadowData.dropped_paths.length}</div>
            <div>default_search_mutated: {String(shadowData.default_search_mutated)}</div>
            <div>default_smart_search_mutated: {String(shadowData.default_smart_search_mutated)}</div>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
