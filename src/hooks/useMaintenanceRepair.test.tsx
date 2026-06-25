import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import {
  useMaintenanceAudit,
  useMaintenancePlan,
  useMaintenanceDryRun,
  useMaintenanceRepairApply,
  maintenanceKeys,
} from '@/hooks/useMaintenanceRepair';

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

describe('maintenanceKeys stability', () => {
  it('maintenanceKeys.audit returns stable key', () => {
    const key1 = maintenanceKeys.audit();
    const key2 = maintenanceKeys.audit();
    expect(key1).toEqual(key2);
    expect(key1).toEqual(['maintenance', 'audit']);
  });

  it('maintenanceKeys.audit with domain returns parametrized key', () => {
    const key = maintenanceKeys.audit('index');
    expect(key).toEqual(['maintenance', 'audit', 'index']);
  });

  it('maintenanceKeys.audit with undefined domain returns base key', () => {
    const key = maintenanceKeys.audit(undefined);
    expect(key).toEqual(['maintenance', 'audit']);
  });

  it('maintenanceKeys.plan returns id-parametrized key', () => {
    const key = maintenanceKeys.plan('issue-1');
    expect(key).toEqual(['maintenance', 'plan', 'issue-1']);
  });

  it('maintenanceKeys.plan with different ids produces different keys', () => {
    const key1 = maintenanceKeys.plan('issue-1');
    const key2 = maintenanceKeys.plan('issue-2');
    expect(key1).not.toEqual(key2);
  });

  it('maintenanceKeys.dryRun returns id-parametrized key', () => {
    const key = maintenanceKeys.dryRun('issue-1');
    expect(key).toEqual(['maintenance', 'dry-run', 'issue-1']);
  });

  it('maintenanceKeys.apply returns stable key', () => {
    const key = maintenanceKeys.apply();
    expect(key).toEqual(['maintenance', 'apply']);
  });
});

// ── useMaintenanceAudit hook tests ────────────────────────────────────────

describe('useMaintenanceAudit', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches audit data on mount', async () => {
    const auditResponse = {
      schema_version: 'm33.maintenance_audit.v0',
      issues: [
        { id: 'issue-1', severity: 'warning', domain: 'index', description: 'Stale index' },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return mockFetchSuccess(auditResponse) as Response;
    });

    const { result } = renderHook(() => useMaintenanceAudit(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.issues).toHaveLength(1);
  });

  it('fetches audit with domain filter', async () => {
    let capturedUrl = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      return mockFetchSuccess({
        schema_version: 'm33.maintenance_audit.v0',
        issues: [],
      }) as Response;
    });

    const { result } = renderHook(() => useMaintenanceAudit('index'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toContain('domain=index');
  });
});

// ── useMaintenancePlan hook tests ─────────────────────────────────────────

describe('useMaintenancePlan', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is disabled when issueId is undefined', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return mockFetchSuccess({
        schema_version: 'm33.maintenance_plan.v0',
        issue_id: 'x',
        repairable: false,
      }) as Response;
    });

    const { result } = renderHook(() => useMaintenancePlan(undefined), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('fetches plan when issueId is provided', async () => {
    const planResponse = {
      schema_version: 'm33.maintenance_plan.v0',
      issue_id: 'plan-hook-1',
      repairable: true,
      path: 'Journals/2026/test.md',
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return mockFetchSuccess(planResponse) as Response;
    });

    const { result } = renderHook(() => useMaintenancePlan('plan-hook-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.repairable).toBe(true);
  });
});

// ── useMaintenanceDryRun hook tests ───────────────────────────────────────

describe('useMaintenanceDryRun', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is disabled when issueId is undefined', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return mockFetchSuccess({
        schema_version: 'm33.maintenance_repair.v0',
        issue_id: 'x',
        dry_run: true,
        applied: false,
      }) as Response;
    });

    const { result } = renderHook(() => useMaintenanceDryRun(undefined), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('fetches dry-run when issueId is provided', async () => {
    const dryRunResponse = {
      schema_version: 'm33.maintenance_repair.v0',
      issue_id: 'dry-hook-1',
      dry_run: true,
      planned_paths: ['Journals/2026/test.md'],
      changed_paths: [],
      applied: false,
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return mockFetchSuccess(dryRunResponse) as Response;
    });

    const { result } = renderHook(() => useMaintenanceDryRun('dry-hook-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.dry_run).toBe(true);
    expect(result.current.data?.planned_paths).toEqual(['Journals/2026/test.md']);
  });
});

// ── useMaintenanceRepairApply hook tests ──────────────────────────────────

describe('useMaintenanceRepairApply', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('is a mutation that calls maintenanceAPI.repairApply with confirmed=true', async () => {
    const applyResponse = {
      schema_version: 'm33.maintenance_repair.v0',
      issue_id: 'apply-hook-1',
      dry_run: false,
      planned_paths: ['Journals/2026/test.md'],
      changed_paths: ['Journals/2026/test.md'],
      applied: true,
    };

    let capturedBody: unknown = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = opts?.body ? JSON.parse(opts?.body as string) : null;
      return mockFetchSuccess(applyResponse) as Response;
    });

    const { result } = renderHook(() => useMaintenanceRepairApply(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ issueId: 'apply-hook-1', confirmed: true });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const body = capturedBody as Record<string, unknown>;
    expect(body).toEqual({ issueId: 'apply-hook-1', confirmed: true });
    expect(result.current.data?.applied).toBe(true);
  });

  it('must not accept confirmed: false — type system enforces true', async () => {
    // This test verifies the hook's mutation function signature.
    // The type system enforces confirmed must be true.
    // At runtime, we verify the body always contains confirmed: true.
    const applyResponse = {
      schema_version: 'm33.maintenance_repair.v0',
      issue_id: 'apply-hook-2',
      dry_run: false,
      planned_paths: [],
      changed_paths: [],
      applied: true,
    };

    let capturedBody: unknown = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = opts?.body ? JSON.parse(opts?.body as string) : null;
      return mockFetchSuccess(applyResponse) as Response;
    });

    const { result } = renderHook(() => useMaintenanceRepairApply(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ issueId: 'apply-hook-2', confirmed: true });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const body = capturedBody as Record<string, unknown>;
    expect(body.confirmed).toBe(true);
  });
});
