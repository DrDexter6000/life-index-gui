import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import {
  useImportPlan,
  useImportRun,
  useImportStatus,
  useImportRollback,
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
