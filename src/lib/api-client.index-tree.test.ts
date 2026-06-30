import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  IndexTreeDiscoverResponseSchema,
  IndexTreeEnsureResponseSchema,
  IndexTreeNavigateResponseSchema,
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

const discoverEnvelope = {
  success: true,
  schema_version: 'm31.index_tree.v1',
  command: 'index-tree.discover',
  generated_at: '2026-05-31T00:00:00Z',
  data: {
    truth_source: 'journals',
    privacy_level: 'same_as_journals',
    selection_contract: 'host_agent_selects_values; tool_executes_only',
    facets: {
      topic: {
        facet: 'topic',
        value_count: 1,
        values: [
          {
            value: 'work',
            count: 2,
            sample_entry_pointers: ['Journals/2026/05/life-index_2026-05-01_001.md'],
            raw_values: ['work'],
          },
        ],
      },
    },
    freshness: { fresh: true },
    fallback: { used: false, reason: null },
  },
  errors: [],
  future_envelope_field: 'preserved',
};

describe('Index Tree canonical schema parsing', () => {
  it('IndexTreeDiscoverResponseSchema preserves facet menus and selection contract', () => {
    const result = IndexTreeDiscoverResponseSchema.parse(discoverEnvelope);

    expect(result.command).toBe('index-tree.discover');
    expect(result.data.selection_contract).toBe('host_agent_selects_values; tool_executes_only');
    expect(result.data.facets.topic.values[0].sample_entry_pointers[0]).toContain('life-index_2026-05-01_001.md');
    expect((result as Record<string, unknown>).future_envelope_field).toBe('preserved');
  });

  it('IndexTreeNavigateResponseSchema preserves deterministic journal pointers', () => {
    const result = IndexTreeNavigateResponseSchema.parse({
      success: true,
      schema_version: 'm31.index_tree.v1',
      command: 'index-tree.navigate',
      generated_at: '2026-05-31T00:00:00Z',
      data: {
        truth_source: 'journals',
        privacy_level: 'same_as_journals',
        entry_pointers: ['Journals/2026/05/life-index_2026-05-01_001.md'],
        entries: [{ relative_path: 'Journals/2026/05/life-index_2026-05-01_001.md' }],
        freshness: { fresh: true },
        fallback: { used: false, reason: null },
      },
      errors: [],
    });

    expect(result.command).toBe('index-tree.navigate');
    expect(result.data.entry_pointers[0]).toContain('Journals/2026/05');
  });

  it('IndexTreeEnsureResponseSchema accepts stale fallback pointers', () => {
    const result = IndexTreeEnsureResponseSchema.parse({
      success: true,
      schema_version: 'm31.index_tree.v1',
      command: 'index-tree.ensure',
      generated_at: '2026-05-31T00:00:00Z',
      data: {
        truth_source: 'journals',
        freshness: { fresh: false, issues: ['index-b stale'] },
        fallback: {
          used: true,
          reason: 'index_b_stale',
          journal_fallback_pointers: ['Journals/2026/05/life-index_2026-05-01_001.md'],
        },
      },
      errors: [],
    });

    expect(result.command).toBe('index-tree.ensure');
    expect(result.data.fallback.used).toBe(true);
    expect(result.data.fallback.journal_fallback_pointers[0]).toContain('life-index_2026-05-01_001.md');
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
});

describe('indexTreeAPI canonical methods', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('discover calls GET /api/index-tree/discover with scoped facets and dates', async () => {
    let capturedUrl = '';
    let capturedMethod = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      capturedUrl = url as string;
      capturedMethod = opts?.method as string ?? 'GET';
      return mockFetchResponse(discoverEnvelope) as Response;
    });

    const result = await indexTreeAPI.discover({
      facets: ['topic', 'project'],
      dateFrom: '2026-03',
      dateTo: '2026-04',
    });

    expect(capturedUrl).toBe('/api/index-tree/discover?from=2026-03&to=2026-04&facet=topic&facet=project');
    expect(capturedMethod).toBe('GET');
    expect(result.command).toBe('index-tree.discover');
  });

  it('navigate posts selected facet values without GUI-side routing intelligence', async () => {
    let capturedUrl = '';
    let capturedBody = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      capturedUrl = url as string;
      capturedBody = opts?.body as string;
      return mockFetchResponse({
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

    const result = await indexTreeAPI.navigate({
      filters: [{ facet: 'topic', values: ['work'] }],
    });

    expect(capturedUrl).toBe('/api/index-tree/navigate');
    expect(JSON.parse(capturedBody)).toEqual({ filters: [{ facet: 'topic', values: ['work'] }] });
    expect(result.command).toBe('index-tree.navigate');
  });

  it('ensure calls GET /api/index-tree/ensure for stale fallback state', async () => {
    let capturedUrl = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      return mockFetchResponse({
        success: true,
        schema_version: 'm31.index_tree.v1',
        command: 'index-tree.ensure',
        generated_at: '2026-05-31T00:00:00Z',
        data: {
          truth_source: 'journals',
          freshness: { fresh: false },
          fallback: { used: true, reason: 'index_b_stale', journal_fallback_pointers: [] },
        },
        errors: [],
      }) as Response;
    });

    const result = await indexTreeAPI.ensure({ dateFrom: '2026-05' });

    expect(capturedUrl).toBe('/api/index-tree/ensure?from=2026-05');
    expect(result.command).toBe('index-tree.ensure');
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
  });
});
