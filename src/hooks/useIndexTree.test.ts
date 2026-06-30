import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import {
  indexTreeKeys,
  useIndexTreeDiscover,
  useIndexTreeEnsure,
  useIndexTreeNavigate,
  useIndexTreeShadow,
} from '@/hooks/useIndexTree';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

function mockFetchSuccess(data: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({ ok: true, data, error: null }),
  } as Response;
}

describe('indexTreeKeys stability', () => {
  it('returns stable keys for canonical navigation and shadow diagnostics', () => {
    expect(indexTreeKeys.discover({ facets: ['topic'] })).toEqual(['index-tree', 'discover', 'topic', '', '']);
    expect(indexTreeKeys.navigate({ filters: [{ facet: 'topic', values: ['work'] }] })).toEqual([
      'index-tree',
      'navigate',
      'topic=work',
      '',
      '',
    ]);
    expect(indexTreeKeys.ensure({ dateFrom: '2026-05' })).toEqual(['index-tree', 'ensure', '2026-05', '']);
    expect(indexTreeKeys.shadow('alpha beta')).toEqual(['index-tree', 'shadow', 'alpha beta']);
  });
});

describe('useIndexTreeDiscover', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches discover menus through the canonical backend route', async () => {
    let capturedUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      return mockFetchSuccess({
        success: true,
        schema_version: 'm31.index_tree.v1',
        command: 'index-tree.discover',
        generated_at: '2026-05-31T00:00:00Z',
        data: {
          truth_source: 'journals',
          privacy_level: 'same_as_journals',
          selection_contract: 'host_agent_selects_values; tool_executes_only',
          facets: { topic: { facet: 'topic', value_count: 0, values: [] } },
          freshness: { fresh: true },
          fallback: { used: false, reason: null },
        },
        errors: [],
      }) as Response;
    });

    const { result } = renderHook(() => useIndexTreeDiscover({ facets: ['topic'] }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toBe('/api/index-tree/discover?facet=topic');
    expect(result.current.data?.data.selection_contract).toBe('host_agent_selects_values; tool_executes_only');
  });

  it('retries discover once before surfacing failure state', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('index tree unavailable'));

    const { result } = renderHook(() => useIndexTreeDiscover({ facets: ['topic'] }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3_000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('useIndexTreeNavigate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches deterministic navigation only after host/user selected values exist', async () => {
    let capturedUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      return mockFetchSuccess({
        success: true,
        schema_version: 'm31.index_tree.v1',
        command: 'index-tree.navigate',
        generated_at: '2026-05-31T00:00:00Z',
        data: {
          truth_source: 'journals',
          privacy_level: 'same_as_journals',
          entry_pointers: ['Journals/2026/05/life-index_2026-05-01_001.md'],
          entries: [],
          freshness: { fresh: true },
          fallback: { used: false, reason: null },
        },
        errors: [],
      }) as Response;
    });

    const { result } = renderHook(
      () => useIndexTreeNavigate({ filters: [{ facet: 'topic', values: ['work'] }] }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toBe('/api/index-tree/navigate');
    expect(result.current.data?.data.entry_pointers[0]).toContain('life-index_2026-05-01_001.md');
  });

  it('does not call navigate with no selected filters or entity neighbors', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
      mockFetchSuccess({}) as Response
    ));

    const { result } = renderHook(() => useIndexTreeNavigate({ filters: [] }), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useIndexTreeEnsure', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches ensure fallback state for stale index-b ranges', async () => {
    let capturedUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      return mockFetchSuccess({
        success: true,
        schema_version: 'm31.index_tree.v1',
        command: 'index-tree.ensure',
        generated_at: '2026-05-31T00:00:00Z',
        data: {
          truth_source: 'journals',
          freshness: { fresh: false },
          fallback: {
            used: true,
            reason: 'index_b_stale',
            journal_fallback_pointers: ['Journals/2026/05/life-index_2026-05-01_001.md'],
          },
        },
        errors: [],
      }) as Response;
    });

    const { result } = renderHook(() => useIndexTreeEnsure({ dateFrom: '2026-05' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toBe('/api/index-tree/ensure?from=2026-05');
    expect(result.current.data?.data.fallback.journal_fallback_pointers[0]).toContain('001.md');
  });
});

describe('useIndexTreeShadow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is disabled for blank queries', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
      mockFetchSuccess({
        success: true,
        schema_version: 'm31.index_tree.v1',
        command: 'index-tree.shadow',
        generated_at: '2026-05-31T00:00:00Z',
        data: null,
        errors: [],
      }) as Response
    ));

    const { result } = renderHook(() => useIndexTreeShadow('   '), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('fetches shadow as diagnostic-only data for a nonblank query', async () => {
    let capturedUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      return mockFetchSuccess({
        success: true,
        schema_version: 'm31.index_tree.v1',
        command: 'index-tree.shadow',
        generated_at: '2026-05-31T00:00:00Z',
        data: {
          query: 'alpha beta',
          enabled: true,
          diagnostic_only: true,
          baseline_paths: [],
          shadow_candidate_paths: [],
          recall_preserved: true,
          dropped_paths: [],
          default_search_mutated: false,
          default_smart_search_mutated: false,
        },
        errors: [],
      }) as Response;
    });

    const { result } = renderHook(() => useIndexTreeShadow('alpha beta'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toBe('/api/index-tree/shadow?query=alpha%20beta');
    expect(result.current.data?.data.diagnostic_only).toBe(true);
  });
});
