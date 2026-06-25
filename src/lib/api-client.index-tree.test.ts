import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  IndexTreeNodesResponseSchema,
  IndexTreeLensResponseSchema,
  IndexTreeShadowResponseSchema,
} from '@/lib/schemas';
import { indexTreeAPI } from '@/lib/api-client';

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

const nodesEnvelope = {
  success: true,
  schema_version: 'm31.index_tree.v1',
  command: 'index-tree.nodes',
  generated_at: '2026-05-31T00:00:00Z',
  data: {
    truth_source: 'journals',
    level: 'month',
    nodes: [
      {
        node_id: 'month:2026-05',
        level: 'month',
        relative_path: 'Journals/2026/05/index_2026-05.md',
        entry_count: 1,
        freshness: 'fresh',
        entry_refs: [
          {
            relative_path: 'Journals/2026/05/life-index_2026-05-01_001.md',
            signals: { topic: ['work'] },
            node_ref: {
              type: 'month',
              node_id: 'month:2026-05',
              id: 'Journals/2026/05',
              path: 'Journals/2026/05/index_2026-05.md',
            },
          },
        ],
        signal_coverage: {
          topic: { entries_in_scope: 1, present: 1, parseable: 1 },
        },
        future_node_field: 'preserved',
      },
    ],
  },
  errors: [],
  future_envelope_field: 'preserved',
};

describe('Index Tree schema parsing', () => {
  it('IndexTreeNodesResponseSchema preserves envelope and node evidence refs', () => {
    const result = IndexTreeNodesResponseSchema.parse(nodesEnvelope);

    expect(result.schema_version).toBe('m31.index_tree.v1');
    expect(result.command).toBe('index-tree.nodes');
    expect(result.data.nodes[0].entry_refs[0].relative_path).toContain('life-index_2026-05-01_001.md');
    expect((result as Record<string, unknown>).future_envelope_field).toBe('preserved');
    expect((result.data.nodes[0] as Record<string, unknown>).future_node_field).toBe('preserved');
  });

  it('IndexTreeLensResponseSchema preserves privacy, node refs, and evidence paths', () => {
    const result = IndexTreeLensResponseSchema.parse({
      success: true,
      schema_version: 'm31.index_tree.v1',
      command: 'index-tree.lens',
      generated_at: '2026-05-31T00:00:00Z',
      data: {
        truth_source: 'journals',
        privacy_level: 'same_as_journals',
        signal: 'topic',
        coverage: { entries_in_scope: 2, present: 2, parseable: 2 },
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
    });

    expect(result.data.privacy_level).toBe('same_as_journals');
    expect(result.data.items[0].node_refs[0].node_id).toBe('month:2026-05');
    expect(result.data.items[0].evidence_paths[0]).toContain('Journals/2026/05');
  });

  it('IndexTreeShadowResponseSchema keeps shadow diagnostic-only flags visible', () => {
    const result = IndexTreeShadowResponseSchema.parse({
      success: true,
      schema_version: 'm31.index_tree.v1',
      command: 'index-tree.shadow',
      generated_at: '2026-05-31T00:00:00Z',
      data: {
        query: 'memories',
        enabled: true,
        diagnostic_only: true,
        baseline_paths: ['Journals/2026/05/life-index_2026-05-01_001.md'],
        shadow_candidate_paths: ['Journals/2026/05/life-index_2026-05-01_001.md'],
        recall_preserved: true,
        dropped_paths: [],
        default_search_mutated: false,
        default_smart_search_mutated: false,
      },
      errors: [],
    });

    expect(result.data.diagnostic_only).toBe(true);
    expect(result.data.default_search_mutated).toBe(false);
    expect(result.data.default_smart_search_mutated).toBe(false);
  });

  it('IndexTreeShadowResponseSchema accepts disabled shadow diagnostics with null recall preservation', () => {
    const result = IndexTreeShadowResponseSchema.parse({
      success: true,
      schema_version: 'm31.index_tree.v1',
      command: 'index-tree.shadow',
      generated_at: '2026-05-31T00:00:00Z',
      data: {
        query: 'memories',
        enabled: false,
        disabled_reason: 'index_tree_not_fresh',
        freshness_issues: [{ node_id: 'month:2026-04', freshness: 'stale' }],
        diagnostic_only: true,
        baseline_paths: [],
        shadow_candidate_paths: [],
        recall_preserved: null,
        dropped_paths: [],
        default_search_mutated: false,
        default_smart_search_mutated: false,
      },
      errors: [],
    });

    expect(result.data.enabled).toBe(false);
    expect(result.data.recall_preserved).toBeNull();
    expect(result.data.diagnostic_only).toBe(true);
    expect(result.data.default_search_mutated).toBe(false);
    expect(result.data.default_smart_search_mutated).toBe(false);
  });
});

describe('indexTreeAPI methods', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('getNodes calls GET /api/index-tree/nodes with the requested level', async () => {
    let capturedUrl = '';
    let capturedMethod = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      capturedUrl = url as string;
      capturedMethod = opts?.method as string ?? 'GET';
      return mockFetchResponse(nodesEnvelope) as Response;
    });

    const result = await indexTreeAPI.getNodes('month');

    expect(capturedUrl).toBe('/api/index-tree/nodes?level=month');
    expect(capturedMethod).toBe('GET');
    expect(result.command).toBe('index-tree.nodes');
    expect(result.data.level).toBe('month');
  });

  it('getLens calls GET /api/index-tree/lens with an encoded signal', async () => {
    let capturedUrl = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      return mockFetchResponse({
        success: true,
        schema_version: 'm31.index_tree.v1',
        command: 'index-tree.lens',
        generated_at: '2026-05-31T00:00:00Z',
        data: {
          truth_source: 'journals',
          privacy_level: 'same_as_journals',
          signal: 'people',
          coverage: { entries_in_scope: 1, present: 1, parseable: 1 },
          items: [],
        },
        errors: [],
      }) as Response;
    });

    const result = await indexTreeAPI.getLens('people');

    expect(capturedUrl).toBe('/api/index-tree/lens?signal=people');
    expect(result.data.signal).toBe('people');
  });

  it('getShadow calls GET /api/index-tree/shadow without mutating search ranking inputs', async () => {
    let capturedUrl = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      return mockFetchResponse({
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

    const result = await indexTreeAPI.getShadow('alpha beta');

    expect(capturedUrl).toBe('/api/index-tree/shadow?query=alpha%20beta');
    expect(result.data.diagnostic_only).toBe(true);
    expect(result.data.default_search_mutated).toBe(false);
  });
});
