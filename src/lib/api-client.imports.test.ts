import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  ImportPlanResponseSchema,
  ImportRunResponseSchema,
  ImportStatusResponseSchema,
  ImportRollbackResponseSchema,
  ImportProposalSchema,
  ImportCreatedFileSchema,
  ImportReviewResponseSchema,
  ImportReviewProposalSchema,
  ImportReviewStateSchema,
  ImportPreviewMetadataSchema,
  ImportReviewBatchSchema,
  ImportReviewsListResponseSchema,
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

// ── M7 historical-photo review data plane ─────────────────────────────────
// Causal tests for the durable CLI-authoritative review surface: validate,
// stage, list reviews, paginated review queue, review status, confirm-edit,
// rebind, binary preview, batch-run, and child rollback. The frozen CLI import
// job is the sole durable authority; these tests assert the client preserves
// its shapes, optionality, recovery facts, and locator-free boundaries.

const REVIEW_STATES = ['pending', 'confirmed', 'skipped', 'stale', 'batching', 'imported'] as const;

/** A Response-like carrying raw preview bytes + headers (success or error body). */
function mockBinaryResponse(
  bytes: Uint8Array,
  opts: { status?: number; headers?: Record<string, string> } = {},
) {
  const status = opts.status ?? 200;
  const headerMap = new Map<string, string>();
  for (const [k, v] of Object.entries(opts.headers ?? {})) headerMap.set(k.toLowerCase(), v);
  const text = () => Promise.resolve(new TextDecoder().decode(bytes));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status < 400 ? 'OK' : 'Error',
    headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text,
    json: async () => JSON.parse(await text()),
  } as unknown as Response;
}

// ── Schema optionality: absent vs present-empty (never default to []) ──────

describe('Import review schema optionality', () => {
  it('preserves absent vs present-empty for warnings / batches / proposals on the review envelope', () => {
    const base = { schema_version: 'import_review.v1', parent_id: 'p' };
    const absent = ImportReviewResponseSchema.parse(base);
    expect(absent.warnings).toBeUndefined();
    expect(absent.batches).toBeUndefined();
    expect(absent.proposals).toBeUndefined();

    const presentEmpty = ImportReviewResponseSchema.parse({
      ...base, warnings: [], batches: [], proposals: [],
    });
    expect(presentEmpty.warnings).toEqual([]);
    expect(presentEmpty.batches).toEqual([]);
    expect(presentEmpty.proposals).toEqual([]);
  });

  it('preserves absent vs present-empty for proposal advisories and available_attachments', () => {
    const minimal = { proposal_id: 'prop_1', state: 'pending' };
    const absent = ImportReviewProposalSchema.parse(minimal);
    expect(absent.available_attachments).toBeUndefined();
    expect(absent.conflicts).toBeUndefined();
    expect(absent.warnings).toBeUndefined();

    const presentEmpty = ImportReviewProposalSchema.parse({
      ...minimal, available_attachments: [], conflicts: [], warnings: [],
    });
    expect(presentEmpty.available_attachments).toEqual([]);
    expect(presentEmpty.conflicts).toEqual([]);
    expect(presentEmpty.warnings).toEqual([]);
  });
});

// ── Six proposal states (no second state model) ───────────────────────────

describe('ImportReviewProposalSchema states & projection', () => {
  it('ImportReviewStateSchema accepts exactly the six review states and rejects others', () => {
    for (const s of REVIEW_STATES) expect(ImportReviewStateSchema.parse(s)).toBe(s);
    expect(() => ImportReviewStateSchema.parse('accept')).toThrow();
    expect(() => ImportReviewStateSchema.parse('import_plan')).toThrow();
  });

  it.each(REVIEW_STATES)('models proposal state %s', (state) => {
    const r = ImportReviewProposalSchema.parse({ proposal_id: 'prop_1', state });
    expect(r.state).toBe(state);
  });

  it('models available_attachments with selected flags, editable journal, and date resolution', () => {
    const proposal = {
      proposal_id: 'prop_1',
      state: 'confirmed',
      journal: {
        title: 'Beach day',
        date: '2024-01-01',
        topic: 'travel',
        tags: ['sun', 'sand'],
        content: 'A nice day.',
      },
      date_resolution: { status: 'user_confirmed', date: '2024-01-01' },
      conflicts: [{ code: 'PHOTO_CAPTURE_TIME_MISSING', severity: 'conflict', runnable: false }],
      warnings: [{ code: 'PHOTO_GPS_MISSING', severity: 'warning', runnable: true }],
      available_attachments: [
        { attachment_id: 'att_1', source_ref: 'source://media.photo_timeline/abc', media_type: 'image/jpeg', size: 1234, selected: true },
        { attachment_id: 'att_2', source_ref: 'source://media.photo_timeline/def', media_type: 'image/jpeg', size: 5678, selected: false },
      ],
    };
    const r = ImportReviewProposalSchema.parse(proposal);
    expect(r.journal?.title).toBe('Beach day');
    expect(r.journal?.tags).toEqual(['sun', 'sand']);
    expect(r.date_resolution?.status).toBe('user_confirmed');
    expect(r.available_attachments?.[0]).toMatchObject({ attachment_id: 'att_1', selected: true, size: 1234 });
    expect(r.available_attachments?.[1]?.selected).toBe(false);
    expect(r.conflicts?.[0]).toMatchObject({ code: 'PHOTO_CAPTURE_TIME_MISSING', runnable: false });
  });

  it('queue_counts carries server counts and queue_revision is authoritative', () => {
    const r = ImportReviewResponseSchema.parse({
      schema_version: 'import_review.v1',
      import_id: 'p',
      queue_revision: 7,
      plan_revision: 3,
      queue_counts: { pending: 2, confirmed: 3, skipped: 0, stale: 0, batching: 0, imported: 0 },
    });
    expect(r.queue_revision).toBe(7);
    expect(r.queue_counts?.confirmed).toBe(3);
  });
});

// ── Nested recovery details preserved through APIClientError ──────────────

describe('M7 recovery details preservation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves current_queue_revision + reason on IMPORT_REVIEW_REVISION_CONFLICT', async () => {
    const envelope = {
      ok: false, data: null,
      error: {
        code: 'IMPORT_REVIEW_REVISION_CONFLICT', message: '审阅队列已更新，请刷新后重试',
        details: { current_queue_revision: 7, expected_queue_revision: 5, reason: 'revision_conflict' },
      },
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true, status: 200, statusText: 'OK', json: async () => envelope,
    }) as Response);

    try {
      await importAPI.confirmEdit('p', { expected_queue_revision: 5, proposal_id: 'prop_1', decision: 'confirmed' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(APIClientError);
      const apiErr = err as APIClientError;
      expect(apiErr.code).toBe('IMPORT_REVIEW_REVISION_CONFLICT');
      expect(apiErr.details).toMatchObject({ current_queue_revision: 7, reason: 'revision_conflict' });
    }
  });

  it('preserves existing_import_id on IMPORT_REVIEW_ALREADY_STAGED', async () => {
    const envelope = {
      ok: false, data: null,
      error: {
        code: 'IMPORT_REVIEW_ALREADY_STAGED', message: 'x',
        details: { existing_import_id: 'imp_old', reason: 'already_staged' },
      },
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true, status: 200, statusText: 'OK', json: async () => envelope,
    }) as Response);

    try {
      await importAPI.stageReview({ source_root: '/photos' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as APIClientError).details).toMatchObject({ existing_import_id: 'imp_old' });
    }
  });
});

// ── Encoded ids, repeated state filters, endpoint shapes ──────────────────

describe('M7 review endpoint URLs & bodies', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reviewQueue encodes the parent path, repeats state filters, and carries offset/limit', async () => {
    let url = '';
    let method = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, opts) => {
      url = u as string;
      method = (opts?.method as string) ?? 'GET';
      return mockFetchResponse({ schema_version: 'import_review.v1', proposals: [] });
    });

    await importAPI.reviewQueue('imp parent/1', { offset: 20, limit: 10, states: ['pending', 'confirmed'] });
    expect(method).toBe('GET');
    expect(url.startsWith('/api/imports/reviews/imp%20parent%2F1?')).toBe(true);
    expect(url).toContain('offset=20');
    expect(url).toContain('limit=10');
    const states = (url.match(/(?:^|[?&])state=([^&]*)/g) ?? [])
      .map((s) => decodeURIComponent(s.split('=')[1]));
    expect(states).toEqual(['pending', 'confirmed']);
  });

  it('reviewStatus encodes the parent id in the path', async () => {
    let url = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u) => {
      url = u as string;
      return mockFetchResponse({ schema_version: 'import_review.v1', state: 'confirmed' });
    });
    await importAPI.reviewStatus('imp parent');
    expect(url).toBe('/api/imports/reviews/imp%20parent/status');
  });

  it('confirmEdit encodes the parent path and sends the exact edit payload (no source locator)', async () => {
    let url = '';
    let body: unknown = null;
    let method = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, opts) => {
      url = u as string;
      body = opts?.body ? JSON.parse(opts.body as string) : null;
      method = (opts?.method as string) ?? 'GET';
      return mockFetchResponse({ schema_version: 'import_review.v1', queue_revision: 2 });
    });
    await importAPI.confirmEdit('imp parent', {
      expected_queue_revision: 1,
      proposal_id: 'prop_1',
      decision: 'confirmed',
      journal: { title: 'T', date: '2024-01-01' },
      selected_attachment_ids: ['att_1'],
    });
    expect(method).toBe('POST');
    expect(url).toBe('/api/imports/reviews/imp%20parent/confirm-edit');
    expect(body).toEqual({
      expected_queue_revision: 1,
      proposal_id: 'prop_1',
      decision: 'confirmed',
      journal: { title: 'T', date: '2024-01-01' },
      selected_attachment_ids: ['att_1'],
    });
    expect((body as Record<string, unknown>)).not.toHaveProperty('source_root');
  });

  it('rebindReview encodes the parent path and sends only source_root', async () => {
    let url = '';
    let body: unknown = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, opts) => {
      url = u as string;
      body = opts?.body ? JSON.parse(opts.body as string) : null;
      return mockFetchResponse({ schema_version: 'import_review.v1', rebound: true });
    });
    await importAPI.rebindReview('imp parent', { source_root: '/photos' });
    expect(url).toBe('/api/imports/reviews/imp%20parent/rebind');
    expect(body).toEqual({ source_root: '/photos' });
  });

  it('batchRun encodes the parent path and sends no body', async () => {
    let url = '';
    let body: unknown = undefined;
    let method = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, opts) => {
      url = u as string;
      body = opts?.body;
      method = (opts?.method as string) ?? 'GET';
      return mockFetchResponse({ schema_version: 'import_run.v1', import_id: 'imp parent#batch-1', state: 'committed' });
    });
    const r = await importAPI.batchRun('imp parent');
    expect(method).toBe('POST');
    expect(url).toBe('/api/imports/reviews/imp%20parent/batch-run');
    expect(body).toBeUndefined();
    expect(r.import_id).toBe('imp parent#batch-1');
  });

  it('validate and listReviews hit the right routes with the right bodies/queries', async () => {
    const calls: string[] = [];
    const bodies: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, opts) => {
      const url = u as string;
      calls.push(url);
      bodies.push(opts?.body ?? null);
      const data = url.startsWith('/api/imports/reviews')
        ? { schema_version: 'import_review.v1', jobs: [], has_more: false }
        : { schema_version: 'import_review.v1', readable: true };
      return mockFetchResponse(data);
    });
    await importAPI.validate({ source_root: '/photos' });
    await importAPI.listReviews({ after: 'imp_a', limit: 5 });
    expect(calls[0]).toBe('/api/imports/validate');
    expect(JSON.parse(bodies[0] as string)).toEqual({ source_root: '/photos' });
    expect(calls[1]).toBe('/api/imports/reviews?after=imp_a&limit=5');
  });
});

// ── Child rollback: id with '#' travels in body only, never the path ──────

describe('M7 child rollback (body-only child id)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the child id (with #) only in the JSON body, never in the URL path', async () => {
    let url = '';
    let body: unknown = null;
    let method = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, opts) => {
      url = u as string;
      body = opts?.body ? JSON.parse(opts.body as string) : null;
      method = (opts?.method as string) ?? 'GET';
      return mockFetchResponse({
        schema_version: 'import_rollback.v1', import_id: 'imp_parent#batch-1',
        state: 'rolled_back', deleted_count: 3,
      });
    });
    const r = await importAPI.childRollback('imp_parent#batch-1');
    expect(method).toBe('POST');
    expect(url).toBe('/api/imports/rollback');
    expect(url).not.toContain('#');
    expect(url).not.toContain('batch-1');
    expect(body).toEqual({ import_id: 'imp_parent#batch-1' });
    expect(r.state).toBe('rolled_back');
    expect(r.deleted_count).toBe(3);
  });
});

// ── Binary preview: exact bytes + parsed metadata + structured error ──────

describe('M7 preview binary fetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns exact bytes + blob + parsed x-preview-metadata on success', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const meta = {
      schema_version: 'import_preview.v1', parent_id: 'p', proposal_id: 'prop',
      attachment_id: 'att', size_bytes: bytes.length, media_type: 'image/jpeg', available: true,
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => mockBinaryResponse(bytes, {
      status: 200, headers: { 'content-type': 'image/jpeg', 'x-preview-metadata': JSON.stringify(meta) },
    }));
    const r = await importAPI.preview('p', { attachment_id: 'att', proposal_id: 'prop' });
    expect(r.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(r.bytes)).toEqual([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    expect(r.blob).toBeInstanceOf(Blob);
    expect(r.metadata.media_type).toBe('image/jpeg');
    expect(r.metadata.size_bytes).toBe(bytes.length);
    expect(r.metadata.available).toBe(true);
    expect(r.metadata.attachment_id).toBe('att');
  });

  it('parses the structured backend error on non-2xx even when content-type is misleading', async () => {
    const errEnvelope = {
      ok: false, data: null,
      error: { code: 'IMPORT_PREVIEW_UNAVAILABLE', message: 'x', details: { reason: 'preview_unavailable' } },
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => mockBinaryResponse(
      new TextEncoder().encode(JSON.stringify(errEnvelope)),
      { status: 422, headers: { 'content-type': 'image/jpeg' } },
    ));
    try {
      await importAPI.preview('p', { attachment_id: 'att', proposal_id: 'prop' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(APIClientError);
      const apiErr = err as APIClientError;
      expect(apiErr.code).toBe('IMPORT_PREVIEW_UNAVAILABLE');
      expect(apiErr.details).toMatchObject({ reason: 'preview_unavailable' });
    }
  });

  it('strips any locator/hash from preview metadata and never logs them', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const meta = {
      schema_version: 'import_preview.v1', parent_id: 'p', proposal_id: 'prop',
      attachment_id: 'att', size_bytes: 3, media_type: 'image/jpeg', available: true,
      // locators/hashes must never surface to the UI even if a header slipped them in
      source_rel_path: 'photos/2024/IMG_0001.jpg', source_sha256: 'sha256:abc',
    };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => mockBinaryResponse(bytes, {
      status: 200, headers: { 'content-type': 'image/jpeg', 'x-preview-metadata': JSON.stringify(meta) },
    }));
    const r = await importAPI.preview('p', { attachment_id: 'att', proposal_id: 'prop' });
    expect((r.metadata as Record<string, unknown>).source_rel_path).toBeUndefined();
    expect((r.metadata as Record<string, unknown>).source_sha256).toBeUndefined();
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('ImportPreviewMetadataSchema models the safe sidecar fields only', () => {
    const meta = ImportPreviewMetadataSchema.parse({
      schema_version: 'import_preview.v1', parent_id: 'p', proposal_id: 'prop',
      attachment_id: 'att', size_bytes: 10, media_type: 'image/jpeg', available: true,
      source_rel_path: 'leak', source_sha256: 'leak',
    });
    expect(meta.schema_version).toBe('import_preview.v1');
    expect((meta as Record<string, unknown>).source_rel_path).toBeUndefined();
    expect((meta as Record<string, unknown>).source_sha256).toBeUndefined();
  });
});

// ── Causal rework: strict preview metadata + client-side verification ──────
// These tests fail against the loose rejected contract and drive the strict,
// fail-closed preview path: required proposal_id, exact safe sidecar fields,
// declared-size pre-cap, and identity/size/media verification before any byte
// is trusted.

const PREVIEW_META_BASE = {
  schema_version: 'import_preview.v1',
  parent_id: 'p',
  proposal_id: 'prop',
  attachment_id: 'att',
  size_bytes: 4,
  media_type: 'image/jpeg',
  available: true,
} as const;

describe('ImportPreviewMetadataSchema strict contract', () => {
  it('requires schema_version import_preview.v1 (literal) and rejects others', () => {
    expect(ImportPreviewMetadataSchema.parse(PREVIEW_META_BASE).schema_version).toBe('import_preview.v1');
    expect(() => ImportPreviewMetadataSchema.parse({ ...PREVIEW_META_BASE, schema_version: 'import_preview.v2' })).toThrow();
  });

  it('requires parent_id / proposal_id / attachment_id', () => {
    expect(() => ImportPreviewMetadataSchema.parse({ ...PREVIEW_META_BASE, parent_id: undefined })).toThrow();
    expect(() => ImportPreviewMetadataSchema.parse({ ...PREVIEW_META_BASE, proposal_id: undefined })).toThrow();
    expect(() => ImportPreviewMetadataSchema.parse({ ...PREVIEW_META_BASE, attachment_id: undefined })).toThrow();
  });

  it('requires a non-negative integer size_bytes', () => {
    expect(() => ImportPreviewMetadataSchema.parse({ ...PREVIEW_META_BASE, size_bytes: -1 })).toThrow();
    expect(() => ImportPreviewMetadataSchema.parse({ ...PREVIEW_META_BASE, size_bytes: 1.5 })).toThrow();
    expect(() => ImportPreviewMetadataSchema.parse({ ...PREVIEW_META_BASE, size_bytes: '4' })).toThrow();
  });

  it('requires media_type image/jpeg and available === true', () => {
    expect(() => ImportPreviewMetadataSchema.parse({ ...PREVIEW_META_BASE, media_type: 'image/png' })).toThrow();
    expect(() => ImportPreviewMetadataSchema.parse({ ...PREVIEW_META_BASE, available: false })).toThrow();
    expect(() => ImportPreviewMetadataSchema.parse({ ...PREVIEW_META_BASE, available: 'true' })).toThrow();
  });
});

describe('M7 preview client-side verification (fail-closed)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fails closed with preview_identity_mismatch when the sidecar identity differs', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const meta = { ...PREVIEW_META_BASE, proposal_id: 'OTHER', size_bytes: bytes.length };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => mockBinaryResponse(bytes, {
      status: 200, headers: { 'content-type': 'image/jpeg', 'x-preview-metadata': JSON.stringify(meta) },
    }));
    try {
      await importAPI.preview('p', { attachment_id: 'att', proposal_id: 'prop' });
      expect.fail('Should have thrown');
    } catch (err) {
      const apiErr = err as APIClientError;
      expect(apiErr).toBeInstanceOf(APIClientError);
      expect(apiErr.code).toBe('IMPORT_PREVIEW_UNAVAILABLE');
      expect((apiErr.details as Record<string, unknown>)?.reason).toBe('preview_identity_mismatch');
    }
  });

  it('fails closed with preview_size_mismatch when size_bytes != actual byte length', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const meta = { ...PREVIEW_META_BASE, size_bytes: 10 };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => mockBinaryResponse(bytes, {
      status: 200, headers: { 'content-type': 'image/jpeg', 'x-preview-metadata': JSON.stringify(meta) },
    }));
    try {
      await importAPI.preview('p', { attachment_id: 'att', proposal_id: 'prop' });
      expect.fail('Should have thrown');
    } catch (err) {
      const apiErr = err as APIClientError;
      expect(apiErr.code).toBe('IMPORT_PREVIEW_UNAVAILABLE');
      expect((apiErr.details as Record<string, unknown>)?.reason).toBe('preview_size_mismatch');
    }
  });

  it('fails closed with preview_media_unsupported when media_type is not image/jpeg', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const meta = { ...PREVIEW_META_BASE, media_type: 'image/png', size_bytes: bytes.length };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => mockBinaryResponse(bytes, {
      status: 200, headers: { 'content-type': 'image/png', 'x-preview-metadata': JSON.stringify(meta) },
    }));
    try {
      await importAPI.preview('p', { attachment_id: 'att', proposal_id: 'prop' });
      expect.fail('Should have thrown');
    } catch (err) {
      const apiErr = err as APIClientError;
      expect(apiErr.code).toBe('IMPORT_PREVIEW_UNAVAILABLE');
      expect((apiErr.details as Record<string, unknown>)?.reason).toBe('preview_media_unsupported');
    }
  });

  it('fails closed with preview_unavailable when available is not true or schema is wrong', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const unavailable = { ...PREVIEW_META_BASE, available: false };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => mockBinaryResponse(bytes, {
      status: 200, headers: { 'content-type': 'image/jpeg', 'x-preview-metadata': JSON.stringify(unavailable) },
    }));
    try {
      await importAPI.preview('p', { attachment_id: 'att', proposal_id: 'prop' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as APIClientError).code).toBe('IMPORT_PREVIEW_UNAVAILABLE');
      expect(((err as APIClientError).details as Record<string, unknown>)?.reason).toBe('preview_unavailable');
    }
  });

  it('rejects an oversized Content-Length before consuming the body (arrayBuffer untouched)', async () => {
    const arrayBufferSpy = vi.fn(async () => {
      throw new Error('arrayBuffer must not be called');
    });
    const headerMap = new Map<string, string>([
      ['content-length', String(32 * 1024 * 1024 + 1)],
      ['x-preview-metadata', '{}'],
    ]);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (n: string) => headerMap.get(n.toLowerCase()) ?? null },
      arrayBuffer: arrayBufferSpy,
      text: async () => '',
      json: async () => ({}),
    }) as unknown as Response);
    try {
      await importAPI.preview('p', { attachment_id: 'att', proposal_id: 'prop' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as APIClientError).code).toBe('IMPORT_PREVIEW_UNAVAILABLE');
      expect(((err as APIClientError).details as Record<string, unknown>)?.reason).toBe('preview_unavailable');
    }
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it('encodes proposal_id and attachment_id with spaces / slash / # / & so they round-trip safely', async () => {
    let capturedUrl = '';
    const bytes = new Uint8Array([1, 2, 3]);
    const proposalId = 'a b/c#d&e';
    const attachmentId = 'x y/z';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      const meta = { ...PREVIEW_META_BASE, proposal_id: proposalId, attachment_id: attachmentId, size_bytes: bytes.length };
      return mockBinaryResponse(bytes, {
        status: 200, headers: { 'content-type': 'image/jpeg', 'x-preview-metadata': JSON.stringify(meta) },
      });
    });
    await importAPI.preview('p', { attachment_id: attachmentId, proposal_id: proposalId });
    // query is URLSearchParams-encoded; decoding must reproduce the originals exactly.
    const decoded = Object.fromEntries(new URLSearchParams(capturedUrl.split('?')[1] ?? ''));
    expect(decoded.proposal_id).toBe(proposalId);
    expect(decoded.attachment_id).toBe(attachmentId);
  });
});

// ── Causal rework: exact safe child-batch projection for rollback gating ───

const FULL_BATCH = {
  import_id: 'imp_parent#batch-1',
  state: 'committed',
  proposal_ids: ['prop_a', 'prop_b'],
  proposal_count: 2,
  created_at: '2026-05-30T00:00:00Z',
  updated_at: '2026-05-30T00:00:00Z',
  rollback_available: true,
} as const;

describe('ImportReviewBatchSchema exact CLI child-batch projection', () => {
  it('parses a full batch and preserves every typed field', () => {
    const b = ImportReviewBatchSchema.parse(FULL_BATCH);
    expect(b.import_id).toBe('imp_parent#batch-1');
    expect(b.state).toBe('committed');
    expect(b.proposal_ids).toEqual(['prop_a', 'prop_b']);
    expect(b.proposal_count).toBe(2);
    expect(b.rollback_available).toBe(true);
  });

  it('keeps rollback_available false as false (never coerced or truthy)', () => {
    const b = ImportReviewBatchSchema.parse({ ...FULL_BATCH, rollback_available: false });
    expect(b.rollback_available).toBe(false);
  });

  it('rejects a non-boolean rollback_available (string / number / null / undefined)', () => {
    expect(() => ImportReviewBatchSchema.parse({ ...FULL_BATCH, rollback_available: 'false' })).toThrow();
    expect(() => ImportReviewBatchSchema.parse({ ...FULL_BATCH, rollback_available: 1 })).toThrow();
    expect(() => ImportReviewBatchSchema.parse({ ...FULL_BATCH, rollback_available: null })).toThrow();
    expect(() => ImportReviewBatchSchema.parse({ ...FULL_BATCH, rollback_available: undefined })).toThrow();
  });

  it('requires import_id', () => {
    expect(() => ImportReviewBatchSchema.parse({ ...FULL_BATCH, import_id: undefined })).toThrow();
  });

  it('requires rollback_available', () => {
    expect(() => ImportReviewBatchSchema.parse({ ...FULL_BATCH, rollback_available: undefined })).toThrow();
  });

  it('rejects a non-nonnegative-integer proposal_count', () => {
    expect(() => ImportReviewBatchSchema.parse({ ...FULL_BATCH, proposal_count: 1.5 })).toThrow();
    expect(() => ImportReviewBatchSchema.parse({ ...FULL_BATCH, proposal_count: '2' })).toThrow();
    expect(() => ImportReviewBatchSchema.parse({ ...FULL_BATCH, proposal_count: -1 })).toThrow();
  });

  it('preserves batches optional at the parent envelope level (absent != empty)', () => {
    const base = { schema_version: 'import_review.v1', import_id: 'p' };
    expect(ImportReviewResponseSchema.parse(base).batches).toBeUndefined();
    expect(ImportReviewResponseSchema.parse({ ...base, batches: [] }).batches).toEqual([]);
    expect(ImportReviewResponseSchema.parse({ ...base, batches: [FULL_BATCH] }).batches?.[0].rollback_available).toBe(true);
  });
});

describe('ImportReviewJobSummarySchema required import_id', () => {
  it('requires import_id on a list job', () => {
    const jobWithoutId = { state: 'confirmed', queue_counts: { confirmed: 1 }, queue_revision: 2 };
    expect(() =>
      ImportReviewsListResponseSchema.parse({
        schema_version: 'import_review.v1',
        jobs: [jobWithoutId],
        has_more: false,
      }),
    ).toThrow();
  });

  it('parses a well-formed job carrying import_id', () => {
    const r = ImportReviewsListResponseSchema.parse({
      schema_version: 'import_review.v1',
      jobs: [{ import_id: 'imp_parent', state: 'confirmed' }],
      has_more: false,
    });
    expect(r.jobs[0].import_id).toBe('imp_parent');
  });
});
