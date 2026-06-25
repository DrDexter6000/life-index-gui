import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  MaintenanceAuditResponseSchema,
  MaintenancePlanResponseSchema,
  MaintenanceRepairResponseSchema,
} from '@/lib/schemas';
import { maintenanceAPI } from '@/lib/api-client';

// ── Mock fetch for API method tests ────────────────────────────────────────

function mockFetchResponse(data: unknown, status = 200) {
  const envelope = {
    ok: status < 400 && data !== null,
    data: status < 400 ? data : null,
    error: status >= 400 || data === null
      ? { code: 'TEST_ERROR', message: 'test error' }
      : null,
  };
  return {
    ok: envelope.ok,
    status,
    statusText: 'OK',
    json: () => Promise.resolve(envelope),
  } as Response;
}

// ── Schema parsing tests ──────────────────────────────────────────────────

describe('MaintenanceAuditResponseSchema', () => {
  it('parses minimal audit response with issues array', () => {
    const data = {
      schema_version: 'm33.maintenance_audit.v0',
      issues: [
        { id: 'issue-1', severity: 'warning', domain: 'index', description: 'Stale index' },
      ],
    };
    const result = MaintenanceAuditResponseSchema.parse(data);
    expect(result.schema_version).toBe('m33.maintenance_audit.v0');
    expect(result.issues).toHaveLength(1);
  });

  it('preserves future-compatible additive CLI envelope fields', () => {
    const data = {
      schema_version: 'm33.maintenance_audit.v0',
      issues: [],
      future_cli_field: 'preserved',
      nested_future: { extra: [1, 2, 3] },
    };
    const result = MaintenanceAuditResponseSchema.parse(data);
    expect((result as Record<string, unknown>).future_cli_field).toBe('preserved');
    expect((result as Record<string, unknown>).nested_future).toEqual({ extra: [1, 2, 3] });
  });

  it('defaults issues to empty array when missing', () => {
    const data = {
      schema_version: 'm33.maintenance_audit.v0',
    };
    const result = MaintenanceAuditResponseSchema.parse(data);
    expect(result.issues).toEqual([]);
  });
});

describe('MaintenancePlanResponseSchema', () => {
  it('parses plan with repairable and path fields', () => {
    const data = {
      schema_version: 'm33.maintenance_plan.v0',
      issue_id: 'issue-1',
      repairable: true,
      path: 'Journals/2026/test.md',
      description: 'Reindex stale entry',
    };
    const result = MaintenancePlanResponseSchema.parse(data);
    expect(result.issue_id).toBe('issue-1');
    expect(result.repairable).toBe(true);
    expect(result.path).toBe('Journals/2026/test.md');
  });

  it('preserves future-compatible additive CLI envelope fields', () => {
    const data = {
      schema_version: 'm33.maintenance_plan.v0',
      issue_id: 'issue-2',
      repairable: false,
      future_plan_field: 'survives',
    };
    const result = MaintenancePlanResponseSchema.parse(data);
    expect((result as Record<string, unknown>).future_plan_field).toBe('survives');
  });

  it('defaults repairable to false when missing', () => {
    const data = {
      schema_version: 'm33.maintenance_plan.v0',
      issue_id: 'issue-3',
    };
    const result = MaintenancePlanResponseSchema.parse(data);
    expect(result.repairable).toBe(false);
  });
});

describe('MaintenanceRepairResponseSchema', () => {
  it('parses dry-run repair response', () => {
    const data = {
      schema_version: 'm33.maintenance_repair.v0',
      issue_id: 'issue-1',
      dry_run: true,
      planned_paths: ['Journals/2026/test.md'],
      changed_paths: [],
      applied: false,
    };
    const result = MaintenanceRepairResponseSchema.parse(data);
    expect(result.dry_run).toBe(true);
    expect(result.planned_paths).toEqual(['Journals/2026/test.md']);
    expect(result.changed_paths).toEqual([]);
    expect(result.applied).toBe(false);
  });

  it('parses applied repair response', () => {
    const data = {
      schema_version: 'm33.maintenance_repair.v0',
      issue_id: 'issue-1',
      dry_run: false,
      planned_paths: ['Journals/2026/test.md'],
      changed_paths: ['Journals/2026/test.md'],
      applied: true,
    };
    const result = MaintenanceRepairResponseSchema.parse(data);
    expect(result.applied).toBe(true);
    expect(result.changed_paths).toEqual(['Journals/2026/test.md']);
  });

  it('preserves future-compatible additive CLI envelope fields', () => {
    const data = {
      schema_version: 'm33.maintenance_repair.v0',
      issue_id: 'issue-4',
      dry_run: false,
      planned_paths: [],
      changed_paths: [],
      applied: true,
      future_repair_field: 42,
    };
    const result = MaintenanceRepairResponseSchema.parse(data);
    expect((result as Record<string, unknown>).future_repair_field).toBe(42);
  });

  it('defaults arrays to empty when missing', () => {
    const data = {
      schema_version: 'm33.maintenance_repair.v0',
      issue_id: 'issue-5',
      dry_run: true,
      applied: false,
    };
    const result = MaintenanceRepairResponseSchema.parse(data);
    expect(result.planned_paths).toEqual([]);
    expect(result.changed_paths).toEqual([]);
  });
});

// ── API method tests ──────────────────────────────────────────────────────

describe('maintenanceAPI methods', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('maintenanceAPI.getAudit calls GET /api/maintenance/audit', async () => {
    const auditResponse = {
      schema_version: 'm33.maintenance_audit.v0',
      issues: [
        { id: 'issue-1', severity: 'warning', domain: 'index', description: 'Stale index' },
      ],
    };
    let capturedUrl = '';
    let capturedMethod = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      capturedUrl = url as string;
      capturedMethod = opts?.method as string ?? 'GET';
      return mockFetchResponse(auditResponse) as Response;
    });

    const result = await maintenanceAPI.getAudit();
    expect(capturedUrl).toBe('/api/maintenance/audit');
    expect(capturedMethod).toBe('GET');
    expect(result.issues).toHaveLength(1);
  });

  it('maintenanceAPI.getAudit appends ?domain=... when domain provided', async () => {
    const auditResponse = {
      schema_version: 'm33.maintenance_audit.v0',
      issues: [],
    };
    let capturedUrl = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      return mockFetchResponse(auditResponse) as Response;
    });

    await maintenanceAPI.getAudit('index');
    expect(capturedUrl).toBe('/api/maintenance/audit?domain=index');
  });

  it('maintenanceAPI.getAudit omits query param when domain is undefined', async () => {
    const auditResponse = {
      schema_version: 'm33.maintenance_audit.v0',
      issues: [],
    };
    let capturedUrl = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      return mockFetchResponse(auditResponse) as Response;
    });

    await maintenanceAPI.getAudit(undefined);
    expect(capturedUrl).toBe('/api/maintenance/audit');
  });

  it('maintenanceAPI.getPlan calls GET /api/maintenance/plan?issueId=...', async () => {
    const planResponse = {
      schema_version: 'm33.maintenance_plan.v0',
      issue_id: 'plan-test-1',
      repairable: true,
      path: 'Journals/2026/test.md',
    };
    let capturedUrl = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      return mockFetchResponse(planResponse) as Response;
    });

    const result = await maintenanceAPI.getPlan('plan-test-1');
    expect(capturedUrl).toBe('/api/maintenance/plan?issueId=plan-test-1');
    expect(result.repairable).toBe(true);
  });

  it('maintenanceAPI.repairDryRun calls GET /api/maintenance/repair/dry-run?issueId=...', async () => {
    const dryRunResponse = {
      schema_version: 'm33.maintenance_repair.v0',
      issue_id: 'dry-run-1',
      dry_run: true,
      planned_paths: ['Journals/2026/test.md'],
      changed_paths: [],
      applied: false,
    };
    let capturedUrl = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      return mockFetchResponse(dryRunResponse) as Response;
    });

    const result = await maintenanceAPI.repairDryRun('dry-run-1');
    expect(capturedUrl).toBe('/api/maintenance/repair/dry-run?issueId=dry-run-1');
    expect(result.dry_run).toBe(true);
    expect(result.planned_paths).toEqual(['Journals/2026/test.md']);
  });

  it('maintenanceAPI.repairApply calls POST /api/maintenance/repair/apply with confirmed=true', async () => {
    const applyResponse = {
      schema_version: 'm33.maintenance_repair.v0',
      issue_id: 'apply-1',
      dry_run: false,
      planned_paths: ['Journals/2026/test.md'],
      changed_paths: ['Journals/2026/test.md'],
      applied: true,
    };
    let capturedUrl = '';
    let capturedBody: unknown = null;
    let capturedMethod = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      capturedUrl = url as string;
      capturedMethod = opts?.method as string ?? 'GET';
      capturedBody = opts?.body ? JSON.parse(opts?.body as string) : null;
      return mockFetchResponse(applyResponse) as Response;
    });

    const result = await maintenanceAPI.repairApply({ issueId: 'apply-1', confirmed: true });
    expect(capturedUrl).toBe('/api/maintenance/repair/apply');
    expect(capturedMethod).toBe('POST');
    expect(capturedBody).toEqual({ issueId: 'apply-1', confirmed: true });
    expect(result.applied).toBe(true);
  });
});
