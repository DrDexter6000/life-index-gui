import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from '@/hooks/useTranslation';
import { useJournalSearch } from '@/hooks/useJournals';
import { useHostAgentHealth, useHostAgentStream } from '@/hooks/useHostAgent';
import { AI_PLUS_FEATURE_ENABLES } from '@/lib/health-status';
import { saveScrollPosition, readScrollPosition } from '@/lib/scroll-restoration';
import type { HostAgentConversationTurn } from '@/hooks/useHostAgent';
import type { HostAgentQueryResponse } from '@/lib/api-client';
import { JournalCard } from '@/components/celestial/JournalCard';
import { CelestialLoader } from '@/components/celestial/CelestialLoader';
import { HostAgentAnswerPanel } from '@/components/host-agent/HostAgentAnswerPanel';
import { HostAgentStreamPanel } from '@/components/host-agent/HostAgentStreamPanel';
import type { LaneStatus } from './recallWorkbenchState';

type RecallTab = 'keyword' | 'agent';

function deriveLaneStatus(
  hasCriteria: boolean,
  isLoading: boolean,
  isError: boolean,
  resultCount: number,
): LaneStatus {
  if (!hasCriteria) return 'idle';
  if (isLoading) return 'loading';
  if (isError) return 'error';
  if (resultCount === 0) return 'empty';
  return 'success';
}

export default function Recall() {
  const { t, lang } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<RecallTab>('keyword');
  const [isFocused, setIsFocused] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [agentQueryText, setAgentQueryText] = useState('');
  const [isAgentFocused, setIsAgentFocused] = useState(false);
  const restoredKeyRef = useRef<string | null>(null);
  const ignoreScrollSaveRef = useRef(false);
  const recallScrollPaneRef = useRef<HTMLDivElement | null>(null);

  const query = searchParams.get('q') || '';
  const dateStart = searchParams.get('start') || '';
  const dateEnd = searchParams.get('end') || '';

  const hostHealth = useHostAgentHealth();
  const hostStream = useHostAgentStream();
  const agentChecking = AI_PLUS_FEATURE_ENABLES.groundedQuery && hostHealth.isLoading && !hostHealth.data;
  const agentReady = Boolean(
    AI_PLUS_FEATURE_ENABLES.groundedQuery
    && hostHealth.data?.running === true
    && hostHealth.data.ready === true
    && hostHealth.data.degraded !== true
    && !hostHealth.isError,
  );

  useEffect(() => {
    if (activeTab === 'agent' && !agentReady) {
      setActiveTab('keyword');
    }
  }, [activeTab, agentReady]);

  useEffect(() => {
    setInputValue(query.trim());
  }, [query]);

  useEffect(() => {
    const original = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    return () => {
      history.scrollRestoration = original;
    };
  }, []);

  useEffect(() => {
    let rafId = 0;
    let timeoutId: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      if (rafId || ignoreScrollSaveRef.current) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (ignoreScrollSaveRef.current) return;
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          saveScrollPosition(searchParams.toString(), window.scrollY);
        }, 150);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafId) cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
    };
  }, [searchParams]);

  const searchParamsForHook = useMemo(() => ({
    query: query.trim(),
    dateStart: dateStart || undefined,
    dateEnd: dateEnd || undefined,
  }), [query, dateStart, dateEnd]);

  const keywordQuery = useJournalSearch(searchParamsForHook);
  const keywordResults = useMemo(() => {
    const results = keywordQuery.data?.results ?? [];
    return [...results].sort((a, b) => new Date(String(b.date)).getTime() - new Date(String(a.date)).getTime());
  }, [keywordQuery.data]);
  const keywordHasCriteria = query.trim().length > 0 || dateStart.length > 0 || dateEnd.length > 0;
  const keywordStatus = deriveLaneStatus(
    keywordHasCriteria,
    keywordQuery.isLoading,
    keywordQuery.isError,
    keywordResults.length,
  );

  useEffect(() => {
    if (keywordStatus !== 'success') return;
    const key = searchParams.toString();
    if (restoredKeyRef.current === key) return;
    restoredKeyRef.current = key;
    const y = readScrollPosition(key);
    if (y != null) {
      ignoreScrollSaveRef.current = true;
      window.scrollTo({ top: y, behavior: 'auto' });
      saveScrollPosition(key, y);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          ignoreScrollSaveRef.current = false;
        });
      });
    }
  }, [keywordStatus, searchParams]);

  const titlePrimary = lang === 'en' ? t('recallTitleEn') : t('recallTitleCn');
  const titleSecondary = lang === 'en' ? t('recallTitleCn') : t('recallTitleEn');

  const handleSubmit = useCallback(() => {
    const q = inputValue.trim();
    const next: Record<string, string> = {};
    if (q) next.q = q;
    if (dateStart) next.start = dateStart;
    if (dateEnd) next.end = dateEnd;
    setSearchParams(next);
  }, [inputValue, dateStart, dateEnd, setSearchParams]);

  const handleKeywordRetry = useCallback(() => {
    keywordQuery.refetch();
  }, [keywordQuery]);

  const scrollRecallPaneToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const pane = recallScrollPaneRef.current;
    if (!pane) return;
    requestAnimationFrame(() => {
      if (typeof pane.scrollTo === 'function') {
        pane.scrollTo({ top: pane.scrollHeight, behavior });
      } else {
        pane.scrollTop = pane.scrollHeight;
      }
    });
  }, []);

  const handleAgentQuerySubmit = useCallback(() => {
    const q = agentQueryText.trim();
    if (!q || hostStream.status === 'connecting' || hostStream.status === 'streaming') return;
    hostStream.start(q);
    setAgentQueryText('');
    scrollRecallPaneToBottom();
  }, [agentQueryText, hostStream, scrollRecallPaneToBottom]);

  const handleAgentContinueSearch = useCallback((query: string) => {
    const q = query.trim();
    if (!q || hostStream.status === 'connecting' || hostStream.status === 'streaming') return;
    hostStream.start(q);
    scrollRecallPaneToBottom();
  }, [hostStream, scrollRecallPaneToBottom]);

  useEffect(() => {
    if (activeTab !== 'agent') return;
    const shouldFollowProgress = hostStream.status === 'connecting'
      || hostStream.status === 'streaming'
      || Boolean(hostStream.finalResponse)
      || hostStream.turns.some((turn) => turn.status === 'connecting' || turn.status === 'streaming');
    if (!shouldFollowProgress) return;
    scrollRecallPaneToBottom();
  }, [
    activeTab,
    hostStream.deltaText,
    hostStream.evidenceCount,
    hostStream.finalResponse,
    hostStream.phase,
    hostStream.status,
    hostStream.turns,
    scrollRecallPaneToBottom,
  ]);

  const hasAgentTurns = hostStream.turns.length > 0;

  const searchInputStyle = useMemo(() => ({
    background: 'transparent',
    border: 'none',
    outline: 'none',
  }), []);

  const renderJournalCard = useCallback((journal: typeof keywordResults[number], index: number) => (
    <motion.div
      key={String(journal.id)}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: index * 0.1,
        ease: [0.23, 1, 0.32, 1],
      }}
    >
      <JournalCard
        id={String(journal.id)}
        title={String(journal.title)}
        excerpt={typeof journal.excerpt === 'string' ? journal.excerpt : undefined}
        date={String(journal.date)}
        topics={Array.isArray(journal.topics) ? journal.topics.map(String) : []}
        moods={Array.isArray(journal.moods) ? journal.moods.map(String) : []}
      />
    </motion.div>
  ), []);

  const renderAgentResult = (data: HostAgentQueryResponse) => (
    <motion.div
      className="host-agent-result-enter"
      data-testid="agent-query-results"
      initial={{ opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.48, ease: [0.23, 1, 0.32, 1] }}
    >
      <HostAgentAnswerPanel response={data} onContinueSearch={handleAgentContinueSearch} />
    </motion.div>
  );

  const renderCompletedThinking = (turn: HostAgentConversationTurn) => {
    const thinking = turn.deltaText.trim();
    if (!turn.finalResponse) return null;
    return (
      <details
        className="host-agent-thinking-collapsible mb-3 rounded-2xl border border-white/[0.08] bg-[var(--color-ether-surface-ghost)] p-3"
        data-testid="host-agent-thinking-collapsible"
      >
        <summary
          className="cursor-pointer text-xs text-[var(--color-secondary)]"
          style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.08em', textTransform: 'uppercase' }}
        >
          {t('hostAgentThinkingToggle')}
        </summary>
        <pre
          className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-muted)]"
          style={{ fontFamily: 'var(--font-order)' }}
        >
          {thinking || t('hostAgentStreamThinkingUnavailable')}
        </pre>
      </details>
    );
  };

  const renderAgentProgress = (turn: HostAgentConversationTurn) => (
    <HostAgentStreamPanel
      status={turn.status}
      phase={turn.phase}
      statusMessage={turn.statusMessage}
      evidencePreview={turn.evidencePreview}
      evidenceCount={turn.evidencePreview.length}
      deltaText={turn.deltaText}
      error={turn.error}
    />
  );

  const renderAgentQueryForm = () => (
    <div className="li-workbench recall-query-workbench" role="search" data-testid="agent-follow-up-form">
      <div
        className={`glass-card no-hover search-input-card flex min-w-0 items-center gap-2 px-3 py-3 sm:gap-3 sm:px-5 ${isAgentFocused ? 'before:!bg-gradient-to-b before:from-[rgba(255,231,146,0.35)] before:via-transparent before:to-[rgba(255,231,146,0.35)]' : ''}`}
      >
        <input
          type="text"
          aria-label={t('hostAgentQueryPlaceholder')}
          className="li-field-placeholder min-w-0 flex-1 bg-transparent text-[var(--text-control)] text-[var(--color-primary)] outline-none"
          style={searchInputStyle}
          placeholder={t('hostAgentQueryPlaceholder')}
          value={agentQueryText}
          onFocus={() => setIsAgentFocused(true)}
          onBlur={() => setIsAgentFocused(false)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={(e) => {
            setIsComposing(false);
            setAgentQueryText((e.target as HTMLInputElement).value);
          }}
          onChange={(e) => setAgentQueryText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isComposing) handleAgentQuerySubmit();
          }}
          data-testid="agent-query-input"
        />
        <button
          type="button"
          aria-label={t('hostAgentQuerySubmit')}
          onClick={handleAgentQuerySubmit}
          disabled={!agentQueryText.trim() || hostStream.status === 'connecting' || hostStream.status === 'streaming'}
          className="shrink-0 cursor-pointer whitespace-nowrap rounded-full px-3 py-2 text-[0.75rem] font-medium transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-40 sm:px-5"
          style={{
            background: 'transparent',
            color: agentQueryText.trim() || isAgentFocused ? 'var(--color-gold)' : 'var(--color-muted)',
            border: `1px solid ${agentQueryText.trim() || isAgentFocused ? 'rgba(255, 231, 146, 0.3)' : 'rgba(255, 255, 255, 0.08)'}`,
            fontFamily: 'var(--font-control)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
          data-testid="agent-submit"
        >
          {t('hostAgentQuerySubmit')}
        </button>
      </div>
    </div>
  );

  const renderAgentTurn = (turn: HostAgentConversationTurn) => (
    <div key={turn.id} className="space-y-3" data-testid="agent-turn">
      <div className="flex justify-end">
        <p
          className="max-w-[85%] rounded-2xl px-4 py-3 text-sm text-[var(--color-primary)]"
          data-testid="agent-turn-user"
          style={{
            background: 'rgba(255,231,146,0.08)',
            border: '1px solid rgba(255,231,146,0.16)',
            fontFamily: 'var(--font-narrative)',
          }}
        >
          {turn.query}
        </p>
      </div>
      <div data-testid="agent-turn-agent">
        {turn.finalResponse ? (
          <>
            {renderCompletedThinking(turn)}
            {renderAgentResult(turn.finalResponse)}
          </>
        ) : renderAgentProgress(turn)}
      </div>
    </div>
  );

  const renderKeywordQueryForm = () => (
    <div className="li-workbench recall-query-workbench li-control-row" role="search" data-testid="keyword-query-form">
      <div
        className={`glass-card search-input-card flex min-w-0 items-center gap-2 px-3 py-3 sm:gap-3 sm:px-5 ${isFocused ? 'before:!bg-gradient-to-b before:from-[rgba(255,231,146,0.35)] before:via-transparent before:to-[rgba(255,231,146,0.35)]' : ''}`}
      >
        <span className="material-symbols-outlined flex-shrink-0 text-[var(--color-secondary)]">
          search
        </span>
        <input
          type="text"
          aria-label={t('searchPlaceholder')}
          className="li-field-placeholder min-w-0 flex-1 bg-transparent text-[var(--text-control)] text-[var(--color-primary)] outline-none"
          style={searchInputStyle}
          placeholder={t('searchPlaceholder')}
          value={inputValue}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={(e) => {
            setIsComposing(false);
            setInputValue((e.target as HTMLInputElement).value);
          }}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isComposing) handleSubmit();
          }}
        />
        <button
          type="button"
          aria-label={t('smartSearchSubmit')}
          onClick={handleSubmit}
          disabled={!inputValue.trim()}
          className="shrink-0 cursor-pointer whitespace-nowrap rounded-full px-3 py-2 text-[0.75rem] font-medium transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-40 sm:px-5"
          style={{
            background: 'transparent',
            color: inputValue.trim() || isFocused ? 'var(--color-gold)' : 'var(--color-muted)',
            border: `1px solid ${inputValue.trim() || isFocused ? 'rgba(255, 231, 146, 0.3)' : 'rgba(255, 255, 255, 0.08)'}`,
            fontFamily: 'var(--font-control)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {t('smartSearchSubmit')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="li-page-shell li-page-composition recall-composition">
      <div className="recall-fixed-controls" data-testid="recall-fixed-controls">
        <section className="li-page-header">
          <h1 className="li-page-title" style={{ fontFamily: 'var(--font-divine)' }}>
            {titlePrimary}
          </h1>
          <p className="li-page-subtitle li-page-subtitle--code">
            {titleSecondary}
          </p>
        </section>

        <div className="li-workbench li-control-row flex justify-center" role="tablist">
          <div
            className="inline-flex items-center gap-1 rounded-full border border-solid p-1"
            style={{
              background: 'var(--color-ether-surface-light)',
              borderColor: 'rgba(255,255,255,0.08)',
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'keyword'}
              data-testid="tab-keyword"
              className="cursor-pointer rounded-full px-4 py-2 text-[0.75rem] font-medium transition-all"
              style={{
                fontFamily: 'var(--font-control)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                background: activeTab === 'keyword' ? 'rgba(255,231,146,0.1)' : 'transparent',
                color: activeTab === 'keyword' ? 'var(--color-gold)' : 'var(--color-muted)',
              }}
              onClick={() => setActiveTab('keyword')}
            >
              {t('recallTabKeyword')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'agent'}
              data-testid="tab-agent"
              disabled={!agentReady}
              className="rounded-full px-4 py-2 text-[0.75rem] font-medium transition-all disabled:cursor-not-allowed"
              style={{
                fontFamily: 'var(--font-control)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                background: activeTab === 'agent' ? 'rgba(255,231,146,0.1)' : 'transparent',
                color: activeTab === 'agent' ? 'var(--color-gold)' : 'var(--color-muted)',
                opacity: !agentReady ? 0.4 : 1,
                cursor: !agentReady ? 'not-allowed' : 'pointer',
              }}
              onClick={() => { if (agentReady) setActiveTab('agent'); }}
            >
              {t('recallTabAI')}
            </button>
          </div>
        </div>

        {activeTab === 'keyword' ? renderKeywordQueryForm() : renderAgentQueryForm()}
      </div>

      <div className="recall-scroll-pane" data-testid="recall-scroll-pane" ref={recallScrollPaneRef}>
        {activeTab === 'keyword' && (
          <div data-testid="keyword-tab-content">
          <div className="li-workbench mb-7">
            <button
              type="button"
              className="flex cursor-pointer items-center gap-1.5 pl-5 text-[0.75rem] text-[var(--color-muted)] transition-colors duration-300 hover:text-[var(--color-primary)]"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
              style={{ fontFamily: 'var(--font-control)', letterSpacing: '0.08em', textTransform: 'uppercase' }}
            >
              <span className="material-symbols-outlined text-[1rem]">calendar_month</span>
              <span>{t('searchDateOptions')}</span>
              <span
                className="material-symbols-outlined text-[1rem] transition-transform duration-300"
                style={{ transform: filtersOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
              >
                expand_more
              </span>
            </button>

            <AnimatePresence initial={false}>
              {filtersOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0, y: -6 }}
                  animate={{ height: 'auto', opacity: 1, y: 0 }}
                  exit={{ height: 0, opacity: 0, y: -6 }}
                  transition={{ duration: 0.42, ease: [0.23, 1, 0.32, 1] }}
                  className="overflow-hidden"
                >
                  <div className="search-filter-card mt-3 p-4">
                    <div className="grid grid-cols-2 gap-3 max-[640px]:grid-cols-1">
                      <label className="block">
                        <span className="li-panel-kicker mb-2 block">{t('searchDateStart')}</span>
                        <input
                          className="search-date-input"
                          type="date"
                          value={dateStart}
                          onChange={(event) => {
                            const next = new URLSearchParams(searchParams);
                            if (event.target.value) next.set('start', event.target.value);
                            else next.delete('start');
                            setSearchParams(next);
                          }}
                        />
                      </label>
                      <label className="block">
                        <span className="li-panel-kicker mb-2 block">{t('searchDateEnd')}</span>
                        <input
                          className="search-date-input"
                          type="date"
                          value={dateEnd}
                          onChange={(event) => {
                            const next = new URLSearchParams(searchParams);
                            if (event.target.value) next.set('end', event.target.value);
                            else next.delete('end');
                            setSearchParams(next);
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="li-workbench" aria-live="polite">
            <section aria-label={t('searchModeKeyword')} data-testid="keyword-lane">
              {keywordStatus === 'error' && (
                <div className="py-10 text-center" data-testid="keyword-error">
                  <span className="material-symbols-outlined mb-3 block text-3xl text-[var(--color-coral)]">error_outline</span>
                  <p className="mb-2 text-sm text-[var(--color-primary)]">{t('loadFailed')}</p>
                  <p className="mb-4 text-xs text-[var(--color-secondary)]">{t('checkNetwork')}</p>
                  <button
                    type="button"
                    onClick={handleKeywordRetry}
                    className="cursor-pointer rounded-full px-5 py-2 text-[0.75rem] font-medium transition-all"
                    style={{
                      background: 'transparent',
                      color: 'var(--color-muted)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      fontFamily: 'var(--font-control)',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                    }}
                    data-testid="keyword-retry"
                  >
                    {t('retry')}
                  </button>
                </div>
              )}

              {keywordStatus === 'loading' && (
                <div className="py-10 text-center" data-testid="keyword-loading">
                  <div className="mb-3 flex justify-center">
                    <CelestialLoader size="md" />
                  </div>
                  <p className="text-sm text-[var(--color-secondary)]" style={{ fontFamily: 'var(--font-order)' }}>{t('loading')}</p>
                </div>
              )}

              {keywordStatus === 'empty' && (
                <div className="py-10 text-center" data-testid="keyword-empty">
                  <span className="material-symbols-outlined mb-3 block text-3xl text-[var(--color-secondary)]">explore_off</span>
                  <p className="mb-1 text-sm text-[var(--color-secondary)]">{t('noResults')}</p>
                  <p className="text-xs text-[var(--color-secondary)]">{t('noResultsHint')}</p>
                </div>
              )}

              {keywordStatus === 'idle' && (
                <div className="py-10 text-center" data-testid="keyword-idle">
                  <span className="material-symbols-outlined mb-3 block text-3xl text-[var(--color-secondary)]">search</span>
                  <p className="text-sm text-[var(--color-secondary)]" style={{ fontFamily: 'var(--font-order)' }}>{t('recallSubtitle')}</p>
                </div>
              )}

              {keywordStatus === 'success' && (
                <div className="grid grid-cols-1 gap-4" data-testid="keyword-results">
                  {keywordResults.map(renderJournalCard)}
                </div>
              )}
            </section>
          </div>
          </div>
        )}

        {activeTab === 'agent' && (
          <div className="li-workbench" data-testid="agent-tab-panel" aria-live="polite">
          {agentChecking && (
            <div className="py-12 text-center" data-testid="agent-probe-loading">
              <div className="mb-4 flex justify-center py-8">
                <CelestialLoader size="md" />
              </div>
              <p className="text-sm text-[var(--color-secondary)]" style={{ fontFamily: 'var(--font-order)' }}>
                {t('hostAgentHealthLoading')}
              </p>
            </div>
          )}

          {!agentChecking && !agentReady && (
            <div className="py-12 text-center" data-testid="agent-unavailable">
              <span className="material-symbols-outlined mb-3 block text-3xl text-[var(--color-secondary)]">cloud_off</span>
              <p className="mb-1 text-sm text-[var(--color-secondary)]">{t('hostAgentUnavailable')}</p>
              <p className="text-xs text-[var(--color-muted)]">{t('hostAgentTabUnavailable')}</p>
            </div>
          )}

          {agentReady && (
            <section aria-label={t('searchModeAI')} data-testid="agent-query-section">
              {hasAgentTurns && (
                <div className="mb-6 space-y-7" data-testid="agent-conversation-thread">
                  {hostStream.turns.map(renderAgentTurn)}
                </div>
              )}

              {!hasAgentTurns && hostStream.status !== 'idle' && !hostStream.finalResponse && (
                <HostAgentStreamPanel
                  status={hostStream.status}
                  phase={hostStream.phase}
                  statusMessage={hostStream.statusMessage}
                  evidencePreview={hostStream.evidencePreview}
                  evidenceCount={hostStream.evidenceCount}
                  deltaText={hostStream.deltaText}
                  error={hostStream.error}
                />
              )}

              {!hasAgentTurns && hostStream.finalResponse && renderAgentResult(hostStream.finalResponse)}

              {!hasAgentTurns && hostStream.status === 'idle' && !hostStream.finalResponse && (
                <div className="py-10 text-center" data-testid="agent-idle">
                  <span className="material-symbols-outlined mb-3 block text-3xl text-[var(--color-secondary)]">psychology</span>
                  <p className="text-sm text-[var(--color-secondary)]">{t('hostAgentQueryEmpty')}</p>
                </div>
              )}
            </section>
          )}
          </div>
        )}
      </div>
    </div>
  );
}
