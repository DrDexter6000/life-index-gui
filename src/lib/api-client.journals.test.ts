import { describe, expect, it, vi, beforeEach } from 'vitest';
import { APIClientError, entityAPI, journalAPI } from '@/lib/api-client';

// ── Mock fetch for API method tests ────────────────────────────────────────

function mockFetchResponse(data: unknown, status = 200) {
  const envelope = {
    ok: status < 400 && data !== null,
    data: status < 400 ? data : null,
    error:
      status >= 400 || data === null
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

// ── API method tests ───────────────────────────────────────────────────────

/**
 * 机器护栏：create 必须以 multipart/form-data 提交、绝不退回 JSON。
 *
 * 这道测试守护 TA-3.1 修复的契约：后端 POST /journals 是 multipart-only，
 * 前端 create 无论是否带附件都必须走 FormData。若有人把 create 改回
 * apiClient.post('/journals', data) 发 application/json，本测试会立刻红掉。
 */
describe('journalAPI.create', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('submits as FormData (not JSON) when there are no attachments', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: unknown = null;
    const capturedHeaders = new Headers();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      capturedUrl = url as string;
      capturedMethod = opts?.method as string;
      capturedBody = opts?.body ?? null;
      const headers = opts?.headers as HeadersInit | undefined;
      if (headers) {
        new Headers(headers).forEach((value, key) => capturedHeaders.set(key, value));
      }
      return mockFetchResponse({ id: 'journal-no-attachment-001' }) as Response;
    });

    const result = await journalAPI.create({
      title: '无附件日志',
      content: '内容',
      date: '2026-06-11',
      location: 'Hangzhou, China',
      weather: 'Clear',
    });

    expect(capturedUrl).toBe('/api/journals');
    expect(capturedMethod).toBe('POST');
    expect(capturedBody).toBeInstanceOf(FormData);

    const body = capturedBody as FormData;
    expect(body.get('title')).toBe('无附件日志');
    expect(body.get('content')).toBe('内容');
    expect(body.get('date')).toBe('2026-06-11');
    expect(body.get('location')).toBe('Hangzhou, China');
    expect(body.get('weather')).toBe('Clear');
    expect(body.getAll('files')).toHaveLength(0);

    // Browser must set Content-Type with multipart boundary; do not send application/json.
    expect(capturedHeaders.get('content-type')).not.toBe('application/json');
    expect(capturedHeaders.get('accept')).toBe('application/json');

    expect(result.id).toBe('journal-no-attachment-001');
  });

  it('appends files to the same FormData body when attachments are provided', async () => {
    let capturedBody: unknown = null;

    const file = new File(['attachment bytes'], 'photo.jpg', { type: 'image/jpeg' });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = opts?.body ?? null;
      return mockFetchResponse({ id: 'journal-with-attachment-001' }) as Response;
    });

    const result = await journalAPI.create({
      title: '带附件日志',
      content: '内容',
      date: '2026-06-11',
      attachments: [file],
    });

    expect(capturedBody).toBeInstanceOf(FormData);
    const body = capturedBody as FormData;
    expect(body.get('title')).toBe('带附件日志');
    expect(body.getAll('files')).toHaveLength(1);
    expect(body.get('files')).toBeInstanceOf(File);

    expect(result.id).toBe('journal-with-attachment-001');
  });
});

describe('journalAPI.search', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('maps backend entityExpansion meta into the typed search response', async () => {
    const entityExpansion = {
      applied: true,
      expansions: [
        {
          from: 'Ally',
          to: ['Alice'],
          via: 'alias',
          entity_id: 'actor-alice',
          primary_name: 'Alice',
        },
        {
          from: '女儿',
          to: ['Alice', 'Ally'],
          via: 'relation',
          entity_id: 'actor-alice',
          primary_name: 'Alice',
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
      mockFetchResponse({
        results: [
          {
            id: '2026/04/life-index_2026-04-19_001',
            title: 'Entity Result',
            date: '2026-04-19',
            abstract: null,
            topics: [],
            moods: [],
            people: [],
            tags: [],
            location: null,
            project: null,
          },
        ],
        total: 1,
        meta: { entityExpansion },
      }) as Response
    ));

    const result = await journalAPI.search({ query: 'Ally' });

    expect(result.entityExpansion).toEqual(entityExpansion);
    expect(result.meta?.entityExpansion).toEqual(entityExpansion);
    expect(result.entityExpansion?.expansions[0]?.to).toEqual(['Alice']);
    expect(result.entityExpansion?.expansions[1]?.to).toEqual(['Alice', 'Ally']);
  });
});

describe('entityAPI.getProfile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses entity profile JSON and calls the id selector endpoint', async () => {
    let capturedUrl = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = String(url);
      return mockFetchResponse({
        identity: {
          entity_id: 'actor-alice',
          primary_name: 'Alice',
          aliases: ['Ally'],
          type: 'actor',
          kind: 'human',
          status: 'confirmed',
          is_self: true,
        },
        relationships: [
          {
            target: 'actor-bob',
            target_name: 'Bob',
            relation: 'friend_of',
            source: 'user',
            status: 'confirmed',
            evidence: ['Journals/2026/03/life-index_2026-03-15_001.md'],
          },
        ],
        mentions: [
          {
            rel_path: 'Journals/2026/03/life-index_2026-03-15_001.md',
            date: '2026-03-15',
            title: 'Primary Mention',
          },
        ],
        evidence: ['Journals/2026/03/life-index_2026-03-15_001.md'],
        stats: {
          first_mention: '2026-03-15',
          latest_mention: '2026-03-15',
          mention_count: 1,
          relationship_count: 1,
        },
        schemaVersion: 'v1.1.1',
        provenance: { generator: 'entity' },
      }) as Response;
    });

    const result = await entityAPI.getProfile({ id: 'actor-alice' });

    expect(capturedUrl).toBe('/api/entities/profile?id=actor-alice');
    expect(result.identity.primary_name).toBe('Alice');
    expect(result.identity.is_self).toBe(true);
    expect(result.relationships[0]?.target_name).toBe('Bob');
    expect(result.mentions[0]?.rel_path).toBe('Journals/2026/03/life-index_2026-03-15_001.md');
  });

  it('surfaces candidate profile errors without parsing profile content', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({
        ok: false,
        data: null,
        error: {
          code: 'ENTITY_PROFILE_CANDIDATE',
          message: 'candidate entities do not have confirmed profiles',
          details: {
            entity_id: 'actor-morgan',
            status: 'candidate',
            suggested_command: 'life-index entity --review',
          },
        },
      }),
    }) as Response);

    await expect(entityAPI.getProfile({ id: 'actor-morgan' })).rejects.toMatchObject({
      code: 'ENTITY_PROFILE_CANDIDATE',
      details: {
        suggested_command: 'life-index entity --review',
      },
    } satisfies Partial<APIClientError>);
  });
});
