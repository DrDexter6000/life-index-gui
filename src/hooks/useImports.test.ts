import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import {
  useImportPlan,
  useImportRun,
  useImportStatus,
  useImportRollback,
  useReviewsList,
  useReviewQueue,
  useReviewStatus,
  useValidateSource,
  useStageReview,
  useRebindReview,
  useConfirmEdit,
  useBatchRun,
  useChildRollback,
  importKeys,
} from '@/hooks/useImports';

// ── Helpers ───────────────────────────────────────────────────────────────

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

// ── Query key stability tests ─────────────────────────────────────────────

describe('importKeys stability', () => {
  it('importKeys.plan returns stable key', () => {
    const key1 = importKeys.plan();
    const key2 = importKeys.plan();
    expect(key1).toEqual(key2);
    expect(key1).toEqual(['imports', 'plan']);
  });

  it('importKeys.run returns stable key', () => {
    const key1 = importKeys.run();
    expect(key1).toEqual(['imports', 'run']);
  });

  it('importKeys.status returns id-parametrized key', () => {
    const key = importKeys.status('abc-123');
    expect(key).toEqual(['imports', 'status', 'abc-123']);
  });

  it('importKeys.status with different ids produces different keys', () => {
    const key1 = importKeys.status('id-1');
    const key2 = importKeys.status('id-2');
    expect(key1).not.toEqual(key2);
  });

  it('importKeys.rollback returns stable key', () => {
    expect(importKeys.rollback()).toEqual(['imports', 'rollback']);
  });
});

// ── Hook tests ────────────────────────────────────────────────────────────

describe('useImportPlan', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls importAPI.plan with the correct arguments', async () => {
    const planResponse = {
      schema_version: 'import_plan.v1',
      import_id: 'plan-hook-1',
      dry_run: true,
    };

    let capturedBody: unknown = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = opts?.body ? JSON.parse(opts?.body as string) : null;
      return mockFetchSuccess(planResponse) as Response;
    });

    const { result } = renderHook(() => useImportPlan(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ source: 'fixture.import_records', input_path: '/tmp/test.json' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.import_id).toBe('plan-hook-1');
    expect(capturedBody).toEqual({ source: 'fixture.import_records', input_path: '/tmp/test.json' });
  });
});

describe('useImportRun', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends only import_id in the request body', async () => {
    const runResponse = {
      schema_version: 'import_run.v1',
      import_id: 'run-hook-1',
      state: 'committed',
    };

    let capturedBody: unknown = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = opts?.body ? JSON.parse(opts?.body as string) : null;
      return mockFetchSuccess(runResponse) as Response;
    });

    const { result } = renderHook(() => useImportRun(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('run-hook-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const body = capturedBody as Record<string, unknown>;
    expect(body).toEqual({ import_id: 'run-hook-1' });
    expect(body).not.toHaveProperty('plan_path');
  });
});

describe('useImportStatus', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is disabled when importId is undefined', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return mockFetchSuccess({
        schema_version: 'import_status.v1',
        import_id: 'x',
        state: 'planned',
      }) as Response;
    });

    const { result } = renderHook(() => useImportStatus(undefined), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('fetches status when importId is provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return mockFetchSuccess({
        schema_version: 'import_status.v1',
        import_id: 'status-hook-1',
        state: 'committed',
      }) as Response;
    });

    const { result } = renderHook(() => useImportStatus('status-hook-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.state).toBe('committed');
  });

  it('stops polling for terminal state committed', async () => {
    let fetchCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      fetchCount++;
      return mockFetchSuccess({
        schema_version: 'import_status.v1',
        import_id: 'terminal-test',
        state: 'committed',
      }) as Response;
    });

    const { result } = renderHook(() => useImportStatus('terminal-test'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Wait a bit to ensure no additional fetches
    await new Promise((r) => setTimeout(r, 200));
    expect(fetchCount).toBe(1);
  });

  it('stops polling for terminal state rolled_back', async () => {
    let fetchCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      fetchCount++;
      return mockFetchSuccess({
        schema_version: 'import_status.v1',
        import_id: 'rolled-test',
        state: 'rolled_back',
      }) as Response;
    });

    const { result } = renderHook(() => useImportStatus('rolled-test'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await new Promise((r) => setTimeout(r, 200));
    expect(fetchCount).toBe(1);
  });

  it('stops polling for terminal state failed', async () => {
    let fetchCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      fetchCount++;
      return mockFetchSuccess({
        schema_version: 'import_status.v1',
        import_id: 'failed-test',
        state: 'failed',
      }) as Response;
    });

    const { result } = renderHook(() => useImportStatus('failed-test'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await new Promise((r) => setTimeout(r, 200));
    expect(fetchCount).toBe(1);
  });

  it('stops polling for terminal state partially_committed', async () => {
    let fetchCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      fetchCount++;
      return mockFetchSuccess({
        schema_version: 'import_status.v1',
        import_id: 'partial-test',
        state: 'partially_committed',
      }) as Response;
    });

    const { result } = renderHook(() => useImportStatus('partial-test'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await new Promise((r) => setTimeout(r, 200));
    expect(fetchCount).toBe(1);
  });
});

describe('useImportRollback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls importAPI.rollback with importId', async () => {
    const rollbackResponse = {
      schema_version: 'import_rollback.v1',
      import_id: 'rollback-hook-1',
      state: 'rolled_back',
      deleted_count: 3,
    };

    let capturedUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      return mockFetchSuccess(rollbackResponse) as Response;
    });

    const { result } = renderHook(() => useImportRollback(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('rollback-hook-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toContain('/imports/rollback-hook-1/rollback');
    expect(result.current.data?.state).toBe('rolled_back');
  });
});

// ── M7 historical-photo review hooks ──────────────────────────────────────
// TanStack Query hooks over the CLI-authoritative review surface. The CLI
// import job stays the sole durable authority; counts/revision come from the
// server, conflicts refetch the SAME page, and no durable browser state is
// created.

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe('M7 review query hooks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('useReviewQueue fetches the page and returns server queue_counts verbatim (no local derivation)', async () => {
    let capturedUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      return mockFetchSuccess({
        schema_version: 'import_review.v1',
        import_id: 'p',
        queue_revision: 3,
        queue_counts: { pending: 0, confirmed: 3, skipped: 0, stale: 0, batching: 0, imported: 0 },
        total_all: 3, total_filtered: 3, offset: 0, limit: 20, has_more: false, next_offset: null,
        proposals: [{ proposal_id: 'prop_1', state: 'confirmed' }],
      }) as Response;
    });

    const { result } = renderHook(() => useReviewQueue('p', { offset: 0, limit: 20, states: ['confirmed'] }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toContain('/api/imports/reviews/p?');
    expect(capturedUrl).toContain('state=confirmed');
    // Server is the authority: confirmed count is read from queue_counts, never derived.
    expect(result.current.data?.queue_counts?.confirmed).toBe(3);
    expect((result.current.data as Record<string, unknown> | undefined)?.confirmedCount).toBeUndefined();
  });

  it('useReviewsList and useReviewStatus hit their routes', async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      urls.push(url as string);
      const u = url as string;
      if (u.endsWith('/status')) {
        return mockFetchSuccess({ schema_version: 'import_review.v1', state: 'confirmed' }) as Response;
      }
      return mockFetchSuccess({ schema_version: 'import_review.v1', jobs: [], has_more: false }) as Response;
    });

    const list = renderHook(() => useReviewsList({ limit: 5 }), { wrapper: createWrapper() });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    const status = renderHook(() => useReviewStatus('p'), { wrapper: createWrapper() });
    await waitFor(() => expect(status.result.current.isSuccess).toBe(true));

    expect(urls.some((u) => u === '/api/imports/reviews?limit=5')).toBe(true);
    expect(urls.some((u) => u === '/api/imports/reviews/p/status')).toBe(true);
  });

  it('useReviewQueue is disabled without a parent id', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockFetchSuccess({ schema_version: 'import_review.v1', proposals: [] }) as Response);
    const { result } = renderHook(() => useReviewQueue(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('M7 review mutation hooks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('useValidateSource / useStageReview / useRebindReview call the right API methods', async () => {
    const urls: string[] = [];
    const bodies: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      urls.push(url as string);
      bodies.push(opts?.body ? JSON.parse(opts.body as string) : null);
      return mockFetchSuccess({ schema_version: 'import_review.v1', readable: true }) as Response;
    });

    const validate = renderHook(() => useValidateSource(), { wrapper: createWrapper() });
    await act(async () => { validate.result.current.mutate({ source_root: '/photos' }); });
    await waitFor(() => expect(validate.result.current.isSuccess).toBe(true));

    const stage = renderHook(() => useStageReview(), { wrapper: createWrapper() });
    await act(async () => { stage.result.current.mutate({ source_root: '/photos' }); });
    await waitFor(() => expect(stage.result.current.isSuccess).toBe(true));

    const rebind = renderHook(() => useRebindReview(), { wrapper: createWrapper() });
    await act(async () => { rebind.result.current.mutate({ parentId: 'p', sourceRoot: '/photos' }); });
    await waitFor(() => expect(rebind.result.current.isSuccess).toBe(true));

    expect(urls).toContain('/api/imports/validate');
    expect(urls).toContain('/api/imports/reviews/stage');
    expect(urls).toContain('/api/imports/reviews/p/rebind');
    expect(bodies[2]).toEqual({ source_root: '/photos' });
  });

  it('useConfirmEdit posts the edit payload and invalidates the parent review scope', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockFetchSuccess({ schema_version: 'import_review.v1', queue_revision: 2 }) as Response);

    const { result } = renderHook(() => useConfirmEdit(), { wrapper: wrapperFor(client) });
    await act(async () => {
      result.current.mutate({
        parentId: 'p', expectedQueueRevision: 1, proposalId: 'prop_1', decision: 'confirmed',
        journal: { title: 'T' },
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalled();
    // Every post-success invalidation must be scoped to imports.reviews (preserve pages).
    for (const call of invalidateSpy.mock.calls) {
      const key = (call[0] as { queryKey?: unknown }).queryKey ?? call[0];
      expect(JSON.stringify(key)).toContain('reviews');
    }
  });

  it('treats a successful skip with reason_code null as success and refreshes CLI authority', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockFetchSuccess({
        schema_version: 'import_review.v1',
        parent_id: 'p',
        queue_revision: 2,
        reason_code: null,
        proposal: { proposal_id: 'prop_1', state: 'skipped' },
      }) as Response);

    const { result } = renderHook(() => useConfirmEdit(), { wrapper: wrapperFor(client) });
    await act(async () => {
      result.current.mutate({
        parentId: 'p',
        expectedQueueRevision: 1,
        proposalId: 'prop_1',
        decision: 'skipped',
        selectedAttachmentIds: [],
        queuePage: { offset: 0, limit: 1, states: ['pending'] },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.reason_code).toBeNull();
    const keys = invalidateSpy.mock.calls.map(keyOf);
    expect(keys.some((key) => key.includes('"offset":0'))).toBe(true);
    expect(keys.some((key) => key.includes('"list"'))).toBe(true);
    expect(keys.some((key) => key.includes('"status"'))).toBe(true);
  });

  it('useBatchRun and useChildRollback invalidate CLI-authoritative data without optimistic rewrite', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const setDataSpy = vi.spyOn(client, 'setQueryData');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = url as string;
      if (u === '/api/imports/rollback') {
        return mockFetchSuccess({ schema_version: 'import_rollback.v1', import_id: 'p#batch-1', state: 'rolled_back', deleted_count: 1 }) as Response;
      }
      return mockFetchSuccess({ schema_version: 'import_run.v1', import_id: 'p#batch-1', state: 'committed' }) as Response;
    });

    const batch = renderHook(() => useBatchRun(), { wrapper: wrapperFor(client) });
    await act(async () => { batch.result.current.mutate('p'); });
    await waitFor(() => expect(batch.result.current.isSuccess).toBe(true));

    const rollback = renderHook(() => useChildRollback(), { wrapper: wrapperFor(client) });
    await act(async () => { rollback.result.current.mutate('p#batch-1'); });
    await waitFor(() => expect(rollback.result.current.isSuccess).toBe(true));

    // Invalidate (refetch server truth), never optimistically rewrite proposal states.
    expect(invalidateSpy).toHaveBeenCalled();
    expect(setDataSpy).not.toHaveBeenCalled();
  });
});

describe('M7 revision-conflict refetch (same parent + filters + offset)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('on IMPORT_REVIEW_REVISION_CONFLICT refetches the SAME offset page, not page zero', async () => {
    const queueData = {
      schema_version: 'import_review.v1', import_id: 'p', queue_revision: 5,
      queue_counts: { pending: 0, confirmed: 1, skipped: 0, stale: 0, batching: 0, imported: 0 },
      total_all: 1, total_filtered: 1, offset: 20, limit: 10, has_more: false, next_offset: null,
      proposals: [],
    };
    const conflictEnvelope = {
      ok: false, data: null,
      error: {
        code: 'IMPORT_REVIEW_REVISION_CONFLICT', message: '审阅队列已更新，请刷新后重试',
        details: { current_queue_revision: 6, expected_queue_revision: 5, reason: 'revision_conflict' },
      },
    };
    const queueUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = url as string;
      if (u.includes('/confirm-edit')) {
        return { ok: true, status: 200, statusText: 'OK', json: async () => conflictEnvelope } as Response;
      }
      queueUrls.push(u);
      return mockFetchSuccess(queueData) as Response;
    });

    const client = makeClient();
    const queue = renderHook(
      () => useReviewQueue('p', { offset: 20, limit: 10, states: ['confirmed'] }),
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => expect(queue.result.current.isSuccess).toBe(true));
    expect(queueUrls.length).toBe(1);

    const confirm = renderHook(() => useConfirmEdit(), { wrapper: wrapperFor(client) });
    await act(async () => {
      confirm.result.current.mutate({
        parentId: 'p', expectedQueueRevision: 5, proposalId: 'prop_1', decision: 'confirmed',
        queuePage: { offset: 20, limit: 10, states: ['confirmed'] },
      });
    });
    await waitFor(() => expect(confirm.result.current.isError).toBe(true));

    // The SAME page (offset=20) must be refetched; no page-zero query is created.
    await waitFor(() => expect(queueUrls.length).toBe(2));
    expect(queueUrls.every((u) => u.includes('offset=20'))).toBe(true);
  });
});

describe('M7 hooks create no durable browser storage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('never calls localStorage / sessionStorage / IndexedDB during review read+write', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
    const idbSpy =
      typeof indexedDB !== 'undefined' && indexedDB
        ? vi.spyOn(indexedDB, 'open')
        : { mock: { calls: [] as unknown[] } };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = url as string;
      // batchRun returns an import_run.v1 shape (needs import_id + state);
      // every other call is a review read.
      if (u.includes('/batch-run')) {
        return mockFetchSuccess({
          schema_version: 'import_run.v1', import_id: 'p#batch-1', state: 'committed',
        }) as Response;
      }
      return mockFetchSuccess({
        schema_version: 'import_review.v1', proposals: [], queue_counts: { confirmed: 1 },
      }) as Response;
    });

    const queue = renderHook(() => useReviewQueue('p'), { wrapper: createWrapper() });
    await waitFor(() => expect(queue.result.current.isSuccess).toBe(true));

    const batch = renderHook(() => useBatchRun(), { wrapper: createWrapper() });
    await act(async () => { batch.result.current.mutate('p'); });
    await waitFor(() => expect(batch.result.current.isSuccess).toBe(true));

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect((idbSpy as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
  });
});

// ── Causal rework: cache invalidation scopes ──────────────────────────────
// Every visible authoritative surface must be kept fresh WITHOUT resetting
// the active review offset to page zero, and without optimistic setQueryData.

/** Stringify the queryKey of an invalidateQueries call for prefix matching. */
function keyOf(call: unknown[]): string {
  const arg = call[0] as { queryKey?: unknown } | unknown[];
  const key = (arg && typeof arg === 'object' && 'queryKey' in arg ? arg.queryKey : arg) ?? [];
  return JSON.stringify(key);
}

describe('M7 review invalidation scopes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('useStageReview success invalidates the reviews-list scope', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockFetchSuccess({ schema_version: 'import_review.v1', parent_id: 'p', queue_revision: 1 }) as Response);

    const { result } = renderHook(() => useStageReview(), { wrapper: wrapperFor(client) });
    await act(async () => { result.current.mutate({ source_root: '/photos' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidateSpy.mock.calls.map(keyOf);
    expect(keys.some((k) => k.includes('"list"'))).toBe(true);
  });

  it('useRebindReview success invalidates reviews-list, the parent queue pages, and the parent status', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockFetchSuccess({ schema_version: 'import_review.v1', rebound: true }) as Response);

    const { result } = renderHook(() => useRebindReview(), { wrapper: wrapperFor(client) });
    await act(async () => { result.current.mutate({ parentId: 'p', sourceRoot: '/photos' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidateSpy.mock.calls.map(keyOf);
    expect(keys.some((k) => k.includes('"list"'))).toBe(true);
    expect(keys.some((k) => k.includes('"queue"') && k.includes('"p"'))).toBe(true);
    expect(keys.some((k) => k.includes('"status"') && k.includes('"p"'))).toBe(true);
  });

  it('useRebindReview waits for authoritative list, parent queue, and status refreshes', async () => {
    const client = makeClient();
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const invalidateSpy = vi
      .spyOn(client, 'invalidateQueries')
      .mockReturnValue(refreshGate);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockFetchSuccess({ schema_version: 'import_review.v1', rebound: true }) as Response);

    const { result } = renderHook(() => useRebindReview(), { wrapper: wrapperFor(client) });
    let mutationPromise!: Promise<unknown>;
    act(() => {
      mutationPromise = result.current.mutateAsync({
        parentId: 'p',
        sourceRoot: '/photos',
      });
    });

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(3));
    expect(result.current.isPending).toBe(true);

    releaseRefresh();
    await act(async () => {
      await mutationPromise;
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('useChildRollback waits for authoritative list, parent queue, and status refreshes', async () => {
    const client = makeClient();
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const invalidateSpy = vi
      .spyOn(client, 'invalidateQueries')
      .mockReturnValue(refreshGate);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockFetchSuccess({
        schema_version: 'import_rollback.v1',
        import_id: 'p#batch-1',
        state: 'rolled_back',
        deleted_count: 1,
      }) as Response);

    const { result } = renderHook(() => useChildRollback(), { wrapper: wrapperFor(client) });
    let mutationPromise!: Promise<unknown>;
    act(() => {
      mutationPromise = result.current.mutateAsync('p#batch-1');
    });

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(3));
    expect(result.current.isPending).toBe(true);

    releaseRefresh();
    await act(async () => {
      await mutationPromise;
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidateSpy.mock.calls.map(keyOf);
    expect(keys.some((key) => key.includes('"list"'))).toBe(true);
    expect(keys.some((key) => key.includes('"queue"') && key.includes('"p"'))).toBe(true);
    expect(keys.some((key) => key.includes('"status"') && key.includes('"p"'))).toBe(true);
  });

  it('useRebindReview fails closed when the active authoritative queue cannot refetch', async () => {
    const client = makeClient();
    let queueFetchCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const requestUrl = url as string;
      if (requestUrl.endsWith('/rebind')) {
        return mockFetchSuccess({
          schema_version: 'import_review.v1',
          rebound: true,
        }) as Response;
      }
      if (requestUrl.includes('/api/imports/reviews/p?')) {
        queueFetchCount += 1;
        if (queueFetchCount === 1) {
          return mockFetchSuccess({
            schema_version: 'import_review.v1',
            import_id: 'p',
            queue_revision: 5,
            proposals: [],
          }) as Response;
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            ok: false,
            data: null,
            error: {
              code: 'INTERNAL_ERROR',
              message: 'authoritative queue unavailable',
              details: {},
            },
          }),
        } as Response;
      }
      return mockFetchSuccess({
        schema_version: 'import_review.v1',
        jobs: [],
        has_more: false,
      }) as Response;
    });

    const queueResult = renderHook(
      () => useReviewQueue('p', { offset: 0, limit: 1, states: ['pending'] }),
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => expect(queueResult.result.current.isSuccess).toBe(true));

    const rebindResult = renderHook(
      () => useRebindReview(),
      { wrapper: wrapperFor(client) },
    );
    await act(async () => {
      rebindResult.result.current.mutate({
        parentId: 'p',
        sourceRoot: '/photos',
      });
    });

    await waitFor(() => expect(queueFetchCount).toBe(2));
    await waitFor(() => expect(rebindResult.result.current.isError).toBe(true));
  });

  it('useConfirmEdit success with queuePage invalidates the exact page + list + status, never page zero', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockFetchSuccess({ schema_version: 'import_review.v1', queue_revision: 6 }) as Response);

    const { result } = renderHook(() => useConfirmEdit(), { wrapper: wrapperFor(client) });
    await act(async () => {
      result.current.mutate({
        parentId: 'p', expectedQueueRevision: 5, proposalId: 'prop_1', decision: 'confirmed',
        queuePage: { offset: 30, limit: 10, states: ['confirmed'] },
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidateSpy.mock.calls.map(keyOf);
    expect(keys.some((k) => k.includes('"offset":30'))).toBe(true);
    expect(keys.every((k) => !k.includes('"offset":0'))).toBe(true);
    expect(keys.some((k) => k.includes('"list"'))).toBe(true);
    expect(keys.some((k) => k.includes('"status"'))).toBe(true);
  });

  it('useConfirmEdit success without queuePage invalidates the parent queue prefix + list + status', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockFetchSuccess({ schema_version: 'import_review.v1', queue_revision: 6 }) as Response);

    const { result } = renderHook(() => useConfirmEdit(), { wrapper: wrapperFor(client) });
    await act(async () => {
      result.current.mutate({
        parentId: 'p', expectedQueueRevision: 5, proposalId: 'prop_1', decision: 'confirmed',
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidateSpy.mock.calls.map(keyOf);
    expect(keys.some((k) => k.includes('"queue"') && k.includes('"p"') && !k.includes('"list"'))).toBe(true);
    expect(keys.some((k) => k.includes('"list"'))).toBe(true);
    expect(keys.some((k) => k.includes('"status"'))).toBe(true);
  });

  it('on IMPORT_REVIEW_REVISION_CONFLICT invalidates the exact offset page + list + status, never page zero', async () => {
    const conflictEnvelope = {
      ok: false, data: null,
      error: {
        code: 'IMPORT_REVIEW_REVISION_CONFLICT', message: '审阅队列已更新，请刷新后重试',
        details: { current_queue_revision: 6, expected_queue_revision: 5, reason: 'revision_conflict' },
      },
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = url as string;
      if (u.includes('/confirm-edit')) {
        return { ok: true, status: 200, statusText: 'OK', json: async () => conflictEnvelope } as Response;
      }
      return mockFetchSuccess({
        schema_version: 'import_review.v1', import_id: 'p', queue_revision: 6, proposals: [],
      }) as Response;
    });

    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    // Mount the active page so the exact-key active refetch has a real target.
    const queue = renderHook(
      () => useReviewQueue('p', { offset: 40, limit: 10, states: ['confirmed'] }),
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => expect(queue.result.current.isSuccess).toBe(true));

    const confirm = renderHook(() => useConfirmEdit(), { wrapper: wrapperFor(client) });
    await act(async () => {
      confirm.result.current.mutate({
        parentId: 'p', expectedQueueRevision: 5, proposalId: 'prop_1', decision: 'confirmed',
        queuePage: { offset: 40, limit: 10, states: ['confirmed'] },
      });
    });
    await waitFor(() => expect(confirm.result.current.isError).toBe(true));

    const keys = invalidateSpy.mock.calls.map(keyOf);
    expect(keys.some((k) => k.includes('"offset":40'))).toBe(true);
    expect(keys.every((k) => !k.includes('"offset":0'))).toBe(true);
    expect(keys.some((k) => k.includes('"list"'))).toBe(true);
    expect(keys.some((k) => k.includes('"status"'))).toBe(true);
  });

  it('useConfirmEdit refreshes the exact authority surfaces after a recovery-blocked failure', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const setDataSpy = vi.spyOn(client, 'setQueryData');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        ok: false,
        data: null,
        error: {
          code: 'IMPORT_REVIEW_RECOVERY_REQUIRED',
          message: 'unsafe backend copy',
          details: {
            reason: 'recovery_required',
            recovery_required: true,
          },
        },
      }),
    }) as Response);

    const { result } = renderHook(() => useConfirmEdit(), { wrapper: wrapperFor(client) });
    await act(async () => {
      result.current.mutate({
        parentId: 'p',
        expectedQueueRevision: 5,
        proposalId: 'prop_1',
        decision: 'confirmed',
        queuePage: { offset: 12, limit: 1, states: ['pending'] },
      });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    const keys = invalidateSpy.mock.calls.map(keyOf);
    expect(keys.some((k) => k.includes('"offset":12'))).toBe(true);
    expect(keys.some((k) => k.includes('"list"'))).toBe(true);
    expect(keys.some((k) => k.includes('"status"') && k.includes('"p"'))).toBe(true);
    expect(setDataSpy).not.toHaveBeenCalled();
  });

  it('useBatchRun refreshes list, parent queue, and status after a failed batch', async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const setDataSpy = vi.spyOn(client, 'setQueryData');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        ok: false,
        data: null,
        error: {
          code: 'IMPORT_BATCH_ALREADY_ACTIVE',
          message: 'unsafe backend copy',
          details: {
            reason: 'batch_active',
            active_child_id: 'p#batch-2',
          },
        },
      }),
    }) as Response);

    const { result } = renderHook(() => useBatchRun(), { wrapper: wrapperFor(client) });
    await act(async () => {
      result.current.mutate('p');
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    const keys = invalidateSpy.mock.calls.map(keyOf);
    expect(keys.some((k) => k.includes('"list"'))).toBe(true);
    expect(keys.some((k) => k.includes('"queue"') && k.includes('"p"'))).toBe(true);
    expect(keys.some((k) => k.includes('"status"') && k.includes('"p"'))).toBe(true);
    expect(setDataSpy).not.toHaveBeenCalled();
  });
});
