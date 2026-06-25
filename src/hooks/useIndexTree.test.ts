import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import {
  indexTreeKeys,
  useIndexTreeNodes,
  useIndexTreeLens,
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
  it('returns stable keys for nodes, lens, and shadow diagnostics', () => {
    expect(indexTreeKeys.nodes('month')).toEqual(['index-tree', 'nodes', 'month']);
    expect(indexTreeKeys.lens('topic')).toEqual(['index-tree', 'lens', 'topic']);
    expect(indexTreeKeys.shadow('alpha beta')).toEqual(['index-tree', 'shadow', 'alpha beta']);
  });
});

describe('useIndexTreeNodes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches nodes with the selected level through the public backend route', async () => {
    let capturedUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      return mockFetchSuccess({
        success: true,
        schema_version: 'm31.index_tree.v1',
        command: 'index-tree.nodes',
        generated_at: '2026-05-31T00:00:00Z',
        data: {
          truth_source: 'journals',
          level: 'month',
          nodes: [],
        },
        errors: [],
      }) as Response;
    });

    const { result } = renderHook(() => useIndexTreeNodes('month'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toBe('/api/index-tree/nodes?level=month');
    expect(result.current.data?.data.level).toBe('month');
  });

  it('retries node diagnostics once before surfacing failure state', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('index tree unavailable'));

    const { result } = renderHook(() => useIndexTreeNodes('month'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3_000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('useIndexTreeLens', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches lens values as evidence navigation, not truth claims', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
      mockFetchSuccess({
        success: true,
        schema_version: 'm31.index_tree.v1',
        command: 'index-tree.lens',
        generated_at: '2026-05-31T00:00:00Z',
        data: {
          truth_source: 'journals',
          privacy_level: 'same_as_journals',
          signal: 'topic',
          coverage: { entries_in_scope: 1, present: 1, parseable: 1 },
          items: [
            {
              value: 'work',
              count: 1,
              node_refs: [{ type: 'month', node_id: 'month:2026-05' }],
              evidence_paths: ['Journals/2026/05/life-index_2026-05-01_001.md'],
              freshness: ['fresh'],
            },
          ],
        },
        errors: [],
      }) as Response
    ));

    const { result } = renderHook(() => useIndexTreeLens('topic'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.items[0].evidence_paths[0]).toContain('life-index_2026-05-01_001.md');
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
    expect(result.current.data?.data.default_search_mutated).toBe(false);
  });
});
