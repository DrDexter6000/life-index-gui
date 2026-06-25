import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  ImportPlanResponseSchema,
  ImportRunResponseSchema,
  ImportStatusResponseSchema,
  ImportRollbackResponseSchema,
  ImportProposalSchema,
  ImportCreatedFileSchema,
} from '@/lib/schemas';
import { importAPI, APIClientError } from '@/lib/api-client';

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

describe('Import schema parsing', () => {
  it('ImportPlanResponseSchema preserves additive CLI fields', () => {
    const planData = {
      schema_version: 'import_plan.v1',
      import_id: 'plan-abc-123',
      dry_run: true,
      plan_fingerprint: 'sha256:abcd',
      idempotency_key: 'key-xyz',
      source: { adapter_id: 'fixture.import_records', record_count: 5 },
      summary: {
        proposed_journal_count: 3,
        proposed_attachment_count: 2,
        conflict_count: 0,
        warning_count: 1,
      },
      proposals: [],
      write_set_preview: { create_files: [], update_files: [], delete_files: [] },
      // Additive unknown fields must survive
      future_cli_field: 'preserved',
      nested_future: { extra: [1, 2, 3] },
    };
    const result = ImportPlanResponseSchema.parse(planData);
    expect(result.import_id).toBe('plan-abc-123');
    expect(result.dry_run).toBe(true);
    expect((result as Record<string, unknown>).future_cli_field).toBe('preserved');
    expect((result as Record<string, unknown>).nested_future).toEqual({ extra: [1, 2, 3] });
  });

  it('ImportRunResponseSchema preserves additive CLI fields', () => {
    const runData = {
      schema_version: 'import_run.v1',
      import_id: 'run-abc-123',
      state: 'committed',
      created_journal_count: 2,
      created_attachment_count: 1,
      created_files: [
        { kind: 'journal', rel_path: 'Journals/2026/test.md', created_by_import: true },
      ],
      rollback_manifest_rel_path: '.life-index/import-jobs/run-abc-123/rollback-manifest.json',
      post_run_actions: { index_rebuild_recommended: true },
      // Additive
      extra_run_field: 'survives',
    };
    const result = ImportRunResponseSchema.parse(runData);
    expect(result.state).toBe('committed');
    expect(result.created_journal_count).toBe(2);
    expect((result as Record<string, unknown>).extra_run_field).toBe('survives');
  });

  it('ImportStatusResponseSchema parses terminal state correctly', () => {
    const statusData = {
      schema_version: 'import_status.v1',
      import_id: 'run-abc-123',
      state: 'committed',
      counts: { total: 3, committed: 2, failed: 1 },
      rollback_available: true,
      rollback_manifest_rel_path: '.life-index/import-jobs/run-abc-123/rollback-manifest.json',
    };
    const result = ImportStatusResponseSchema.parse(statusData);
    expect(result.state).toBe('committed');
    expect(result.rollback_available).toBe(true);
  });

  it('ImportRollbackResponseSchema parses rolled_back state', () => {
    const rollbackData = {
      schema_version: 'import_rollback.v1',
      import_id: 'run-abc-123',
      state: 'rolled_back',
      deleted_count: 3,
      rollback_manifest_rel_path: '.life-index/import-jobs/run-abc-123/rollback-manifest.json',
    };
    const result = ImportRollbackResponseSchema.parse(rollbackData);
    expect(result.state).toBe('rolled_back');
    expect(result.deleted_count).toBe(3);
  });

  it('ImportProposalSchema preserves all nested fields', () => {
    const proposal = {
      proposal_id: 'prop-1',
      source_record_id: 'rec-1',
      journal: { date_time: '2026-05-30T10:00:00', title: 'Test', content: 'Body', future_field: true },
      attachments: [{ name: 'photo.jpg', media_type: 'image/jpeg', size_bytes: 1024 }],
      conflicts: [{ type: 'existing_path', existing_path: 'Journals/2026/test.md' }],
      warnings: [{ code: 'LOW_CONFIDENCE', message: 'Uncertain date' }],
      confidence: { score: 0.85, level: 'high' },
      dedup_status: 'new',
      extra_proposal_field: 42,
    };
    const result = ImportProposalSchema.parse(proposal);
    expect(result.proposal_id).toBe('prop-1');
    expect(result.journal?.title).toBe('Test');
    expect((result as Record<string, unknown>).extra_proposal_field).toBe(42);
    expect((result.journal as Record<string, unknown> | undefined)?.future_field).toBe(true);
  });

  it('ImportProposalSchema parses media.photo_timeline journal and attachment shape', () => {
    const proposal = {
      proposal_id: 'prop-photo-1',
      source_record_id: 'photo_2b28bd92fb47',
      journal: {
        target_rel_path: 'Journals/2020/01/life-index_2020-01-01_001.md',
        title: 'Photo import: 2020-01-01',
        date: '2020-01-01',
        topic: 'imported',
        tags: ['imported', 'photo'],
        content: 'Imported photo captured on 2020-01-01.',
      },
      attachments: [
        {
          attachment_id: 'att_2b28bd92fb47',
          source_ref: 'source://media.photo_timeline/2b28bd92fb47',
          source_sha256: 'sha256:2b28bd92fb47',
          source_rel_path: 'photo_with_exif.jpg',
          target_rel_path: 'attachments/2020/01/import_2b28bd92fb47.jpg',
          media_type: 'image/jpeg',
          size_bytes: 1574,
          copy_mode: 'copy',
        },
      ],
      conflicts: [
        {
          code: 'PHOTO_CAPTURE_TIME_MISSING',
          severity: 'conflict',
          runnable: false,
          message: 'No EXIF capture time found',
        },
      ],
      warnings: [
        {
          code: 'PHOTO_GPS_MISSING',
          severity: 'warning',
          runnable: true,
          message: 'No GPS data found',
        },
      ],
    };
    const result = ImportProposalSchema.parse(proposal);
    expect(result.journal?.title).toBe('Photo import: 2020-01-01');
    expect((result.journal as Record<string, unknown> | undefined)?.date).toBe('2020-01-01');
    expect((result.attachments?.[0] as Record<string, unknown>).source_rel_path).toBe('photo_with_exif.jpg');
    expect(result.conflicts?.[0]).toMatchObject({ code: 'PHOTO_CAPTURE_TIME_MISSING', runnable: false });
    expect(result.warnings?.[0]).toMatchObject({ code: 'PHOTO_GPS_MISSING', runnable: true });
  });

  it('ImportCreatedFileSchema preserves additive fields', () => {
    const file = {
      kind: 'journal',
      rel_path: 'Journals/2026/test.md',
      sha256_after: 'abc123',
      size_bytes: 500,
      created_by_import: true,
      future_checksum_algo: 'blake3',
    };
    const result = ImportCreatedFileSchema.parse(file);
    expect(result.kind).toBe('journal');
    expect((result as Record<string, unknown>).future_checksum_algo).toBe('blake3');
  });
});

// ── API method tests ──────────────────────────────────────────────────────

describe('importAPI methods', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('importAPI.plan calls POST /api/imports/plan with source and input_path', async () => {
    const planResponse = {
      schema_version: 'import_plan.v1',
      import_id: 'plan-test-1',
      dry_run: true,
    };
    let capturedUrl = '';
    let capturedBody: unknown = null;
    let capturedMethod = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      capturedUrl = url as string;
      capturedMethod = opts?.method as string ?? 'GET';
      capturedBody = opts?.body ? JSON.parse(opts?.body as string) : null;
      return mockFetchResponse(planResponse) as Response;
    });

    const result = await importAPI.plan({ source: 'fixture.import_records', input_path: '/tmp/test.json' });
    expect(capturedUrl).toBe('/api/imports/plan');
    expect(capturedMethod).toBe('POST');
    expect(capturedBody).toEqual({ source: 'fixture.import_records', input_path: '/tmp/test.json' });
    expect(result.import_id).toBe('plan-test-1');
  });

  it('importAPI.plan can request media.photo_timeline without private fields', async () => {
    let capturedBody: unknown = null;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = opts?.body ? JSON.parse(opts?.body as string) : null;
      return mockFetchResponse({
        schema_version: 'import_plan.v1',
        import_id: 'photo-plan-1',
        dry_run: true,
        source: { adapter_id: 'media.photo_timeline' },
      }) as Response;
    });

    const result = await importAPI.plan({
      source: 'media.photo_timeline',
      input_path: 'D:/photos',
    });
    expect(capturedBody).toEqual({
      source: 'media.photo_timeline',
      input_path: 'D:/photos',
    });
    expect(capturedBody as Record<string, unknown>).not.toHaveProperty('source_root');
    expect(capturedBody as Record<string, unknown>).not.toHaveProperty('plan_path');
    expect(result.source?.adapter_id).toBe('media.photo_timeline');
  });

  it('importAPI.run calls POST /api/imports/run with only import_id', async () => {
    const runResponse = {
      schema_version: 'import_run.v1',
      import_id: 'run-test-1',
      state: 'committed',
    };
    let capturedBody: unknown = null;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = opts?.body ? JSON.parse(opts?.body as string) : null;
      return mockFetchResponse(runResponse) as Response;
    });

    const result = await importAPI.run('run-test-1');
    expect(capturedBody).toEqual({ import_id: 'run-test-1' });
    expect(result.state).toBe('committed');
  });

  it('importAPI.run body never includes plan_path', async () => {
    let capturedBody: unknown = null;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = opts?.body ? JSON.parse(opts?.body as string) : null;
      return mockFetchResponse({
        schema_version: 'import_run.v1',
        import_id: 'run-1',
        state: 'committed',
      }) as Response;
    });

    await importAPI.run('run-1');
    const body = capturedBody as Record<string, unknown>;
    expect(body).not.toHaveProperty('plan_path');
    expect(Object.keys(body)).toEqual(['import_id']);
  });

  it('importAPI.getStatus calls GET /api/imports/{importId}/status', async () => {
    const statusResponse = {
      schema_version: 'import_status.v1',
      import_id: 'status-test-1',
      state: 'committed',
    };
    let capturedUrl = '';
    let capturedMethod = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      capturedUrl = url as string;
      capturedMethod = opts?.method as string ?? 'GET';
      return mockFetchResponse(statusResponse) as Response;
    });

    const result = await importAPI.getStatus('status-test-1');
    expect(capturedUrl).toBe('/api/imports/status-test-1/status');
    expect(capturedMethod).toBe('GET');
    expect(result.state).toBe('committed');
  });

  it('importAPI.rollback calls POST /api/imports/{importId}/rollback', async () => {
    const rollbackResponse = {
      schema_version: 'import_rollback.v1',
      import_id: 'rollback-test-1',
      state: 'rolled_back',
      deleted_count: 2,
    };
    let capturedUrl = '';
    let capturedMethod = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      capturedUrl = url as string;
      capturedMethod = opts?.method as string ?? 'GET';
      return mockFetchResponse(rollbackResponse) as Response;
    });

    const result = await importAPI.rollback('rollback-test-1');
    expect(capturedUrl).toBe('/api/imports/rollback-test-1/rollback');
    expect(capturedMethod).toBe('POST');
    expect(result.state).toBe('rolled_back');
    expect(result.deleted_count).toBe(2);
  });
});

// ── Error details tests ──────────────────────────────────────────────────

describe('APIClientError details preservation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('error details survive VALIDATION_ERROR with reason replan_required', async () => {
    // Backend returns HTTP 200 with ok:false in the body for application errors
    const errorEnvelope = {
      ok: false,
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: '导入计划已过期或不存在，请重新执行计划步骤',
        details: { reason: 'replan_required' },
      },
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(errorEnvelope),
    }) as Response);

    try {
      await importAPI.run('expired-plan-id');
      expect.fail('Should have thrown APIClientError');
    } catch (err) {
      expect(err).toBeInstanceOf(APIClientError);
      const apiErr = err as APIClientError;
      expect(apiErr.code).toBe('VALIDATION_ERROR');
      expect(apiErr.details).toEqual({ reason: 'replan_required' });
    }
  });

  it('error details are undefined when backend omits them', async () => {
    const errorEnvelope = {
      ok: false,
      data: null,
      error: {
        code: 'IMPORT_INTERNAL_ERROR',
        message: 'Something went wrong',
      },
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(errorEnvelope),
    }) as Response);

    try {
      await importAPI.plan({ source: 'fixture.import_records', input_path: '/tmp/test.json' });
      expect.fail('Should have thrown APIClientError');
    } catch (err) {
      expect(err).toBeInstanceOf(APIClientError);
      const apiErr = err as APIClientError;
      expect(apiErr.code).toBe('IMPORT_INTERNAL_ERROR');
      expect(apiErr.details).toBeUndefined();
    }
  });
});
