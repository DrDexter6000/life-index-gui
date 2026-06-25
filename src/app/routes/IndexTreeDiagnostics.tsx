import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { GlassCard } from '@/components/celestial/GlassCard';
import { CelestialLoader } from '@/components/celestial/CelestialLoader';
import { useTranslation } from '@/hooks/useTranslation';
import {
  useIndexTreeNodes,
  useIndexTreeLens,
  useIndexTreeShadow,
} from '@/hooks/useIndexTree';
import type { IndexTreeSignal } from '@/lib/api-client';

const SIGNAL_OPTIONS: Array<{ value: IndexTreeSignal; labelKey: string }> = [
  { value: 'topic', labelKey: 'indexTreeLensSignalTopic' },
  { value: 'people', labelKey: 'indexTreeLensSignalPeople' },
  { value: 'project', labelKey: 'indexTreeLensSignalProject' },
];

function basename(path: string) {
  return path.split('/').filter(Boolean).pop() ?? path;
}

function coverageSummary(signal: string, coverage: { entries_in_scope?: number; present?: number }) {
  const present = coverage.present ?? 0;
  const total = coverage.entries_in_scope ?? 0;
  return `${signal}: ${present}/${total}`;
}

/**
 * Read-only Index Tree evidence navigation diagnostics.
 *
 * Lens and shadow output are navigation/diagnostics only, never truth claims
 * or search-ranking inputs.
 */
export default function IndexTreeDiagnostics() {
  const { t } = useTranslation();
  const [signal, setSignal] = useState<IndexTreeSignal>('topic');
  const [shadowDraft, setShadowDraft] = useState('');
  const [shadowQuery, setShadowQuery] = useState('');

  const nodesQuery = useIndexTreeNodes('month');
  const lensQuery = useIndexTreeLens(signal);
  const shadowDiagnosticsQuery = useIndexTreeShadow(shadowQuery);

  const nodes = nodesQuery.data?.data?.nodes ?? [];
  const lensItems = lensQuery.data?.data?.items ?? [];
  const shadowData = shadowDiagnosticsQuery.data?.data;

  function handleShadowSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShadowQuery(shadowDraft.trim());
  }

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
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-lg" style={{ color: 'var(--color-gold)' }}>
            account_tree
          </span>
          <h2 className="text-base font-semibold text-[var(--color-primary)]">{t('indexTreeNodes')}</h2>
        </div>

        {nodesQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <CelestialLoader size="sm" />
            <span>{t('indexTreeLoading')}</span>
          </div>
        )}

        {nodesQuery.isError && (
          <p className="text-sm text-[var(--color-muted)]">{t('indexTreeUnavailable')}</p>
        )}

        {!nodesQuery.isLoading && !nodesQuery.isError && (
          <div className="space-y-4">
            {nodes.map((node) => (
              <div
                key={node.node_id}
                className="rounded-lg border border-white/[0.08] p-4 bg-[var(--color-ether-surface-ghost)]"
                data-testid="index-tree-node-card"
              >
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <span className="font-mono text-sm text-[var(--color-primary)]">{node.node_id}</span>
                  {node.freshness && (
                    <span className="text-xs text-[var(--color-gold)]">
                      {t('indexTreeFreshness')}: {node.freshness}
                    </span>
                  )}
                  <span className="text-xs text-[var(--color-secondary)]">
                    {t('indexTreeEntryCount')}: {node.entry_count ?? 0}
                  </span>
                </div>

                {node.signal_coverage && (
                  <div className="mb-3">
                    <div className="text-xs uppercase tracking-[0.08em] text-[var(--color-muted)] mb-1">
                      {t('indexTreeSignalCoverage')}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(node.signal_coverage).map(([key, coverage]) => (
                        <span key={key} className="text-sm text-[var(--color-secondary)]">
                          {coverageSummary(key, coverage)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {node.entry_refs.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-[0.08em] text-[var(--color-muted)] mb-1">
                      {t('indexTreeEvidenceRefs')}
                    </div>
                    <div className="flex flex-col gap-1">
                      {node.entry_refs.map((entry) => (
                        <Link
                          key={entry.relative_path}
                          to={`/journal/${entry.relative_path}`}
                          className="text-sm text-[var(--color-cyan)] hover:text-[var(--color-gold)] transition-colors"
                        >
                          {basename(entry.relative_path)}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      <GlassCard className="p-6 mb-6">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="text-base font-semibold text-[var(--color-primary)]">{t('indexTreeLens')}</h2>
          <div className="flex gap-2">
            {SIGNAL_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSignal(option.value)}
                aria-pressed={signal === option.value}
                className="px-3 py-1 rounded-lg text-xs border border-white/[0.08] text-[var(--color-secondary)] aria-pressed:text-[var(--color-gold)]"
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-[var(--color-muted)] mb-4">{t('indexTreeLensDesc')}</p>

        {lensQuery.isError ? (
          <p className="text-sm text-[var(--color-muted)]">{t('indexTreeUnavailable')}</p>
        ) : (
          <div className="space-y-3">
            {lensItems.map((item) => (
              <div
                key={item.value}
                data-testid="index-tree-lens-item"
                className="rounded-lg border border-white/[0.08] p-4 bg-[var(--color-ether-surface-ghost)]"
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="text-sm font-medium text-[var(--color-primary)]">{item.value}</span>
                  <span className="text-xs text-[var(--color-secondary)]">{item.count}</span>
                </div>
                <div className="text-sm text-[var(--color-secondary)]">
                  {item.node_refs.map((ref) => ref.node_id ?? ref.id ?? ref.path ?? ref.type).filter(Boolean).join(', ')}
                </div>
                <div className="mt-2 flex flex-col gap-1">
                  {item.evidence_paths.map((path) => (
                    <span key={path} className="text-xs text-[var(--color-muted)]">{path}</span>
                  ))}
                </div>
              </div>
            ))}
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
