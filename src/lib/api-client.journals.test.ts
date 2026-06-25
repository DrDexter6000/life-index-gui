import { describe, expect, it, vi, beforeEach } from 'vitest';
import { journalAPI } from '@/lib/api-client';

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
