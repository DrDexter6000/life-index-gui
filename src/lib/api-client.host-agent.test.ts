import { describe, expect, it, vi } from 'vitest';
import { hostAgentAPI } from './api-client';

const finalResponse = {
  schema_version: 'gui.host_agent.query_response.v1',
  request_id: 'req-api-cleanup',
  conversation_id: null,
  source: 'host-agent',
  mode: 'PARTIAL',
  reason: 'partial evidence',
  query: 'What did I write?',
  answer: {
    mode: 'PARTIAL',
    reason: 'partial evidence',
    summary: 'Partial answer',
    insights: [],
    gap: 'more evidence needed',
    suggestions: [],
  },
  evidence: [],
  tool_trace: [],
};

describe('hostAgentAPI.stream', () => {
  it('passes the abort signal and cancels the reader when the consumer disconnects', async () => {
    const encoder = new TextEncoder();
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({
          done: false,
          value: encoder.encode(`event: final\ndata: ${JSON.stringify(finalResponse)}\n\n`),
        })
        .mockResolvedValue({ done: true, value: undefined }),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    const controller = new AbortController();
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      body: { getReader: () => reader },
    } as unknown as Response;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    try {
      const stream = hostAgentAPI.stream('What did I write?', {
        signal: controller.signal,
        conversationId: 'conv-api-cleanup',
      });
      const first = await stream.next();
      expect(first.value?.type).toBe('final');
      await stream.return?.(undefined);

      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/host-agent/query/stream',
        expect.objectContaining({ signal: controller.signal }),
      );
      expect(reader.cancel).toHaveBeenCalledTimes(1);
      expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('maps malformed SSE JSON to a structured transport error', async () => {
    const encoder = new TextEncoder();
    const reader = {
      read: vi.fn().mockResolvedValueOnce({
        done: false,
        value: encoder.encode('event: final\ndata: {not-json}\n\n'),
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: { getReader: () => reader },
    } as unknown as Response);

    try {
      const stream = hostAgentAPI.stream('malformed');
      await expect(stream.next()).rejects.toMatchObject({
        code: 'HOST_AGENT_MALFORMED_EVENT',
        status: 200,
      });
      expect(reader.cancel).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('hostAgentAPI.proposeMetadata', () => {
  it('preserves additive metadata root and nested fields through the API parser', async () => {
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          schema_version: 'gui.host_agent.metadata_proposal.v1',
          request_id: 'metadata-additive-api-1',
          mode: 'PROPOSED',
          reason: 'additive fixture',
          fields: {
            title: {
              value: 'Title',
              future_nested: { preserve: true },
            },
          },
          warnings: [],
          policy: { preserve_user_fields: true },
          future_root: { provider_neutral: true },
        },
        error: null,
      }),
    } as unknown as Response;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    try {
      const parsed = await hostAgentAPI.proposeMetadata({
        draft: { title: '', content: 'Draft', date: '2026-07-15', existing_metadata: {} },
        policy: { preserve_user_fields: true },
      });
      expect(parsed.future_root).toEqual({ provider_neutral: true });
      expect(parsed.fields.title.future_nested).toEqual({ preserve: true });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('rejects an unknown weather field instead of passing it to the UI', async () => {
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          schema_version: 'gui.host_agent.metadata_proposal.v1',
          request_id: 'metadata-weather-api-1',
          mode: 'PROPOSED',
          reason: 'third-party weather fixture',
          fields: {
            weather: { value: 'sunny' },
          },
          warnings: [],
          policy: { preserve_user_fields: true },
        },
        error: null,
      }),
    } as unknown as Response;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    try {
      await expect(
        hostAgentAPI.proposeMetadata({
          draft: { title: '', content: 'Draft', date: '2026-07-15', existing_metadata: {} },
          policy: { preserve_user_fields: true },
        }),
      ).rejects.toMatchObject({ code: 'SCHEMA_ERROR' });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('rejects metadata proposal v2 instead of inventing a second UI contract', async () => {
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          schema_version: 'gui.host_agent.metadata_proposal.v2',
          request_id: 'metadata-v2-api-1',
          mode: 'PROPOSED',
          reason: 'unsupported v2 fixture',
          fields: { title: { value: 'Title' } },
          warnings: [],
          policy: { preserve_user_fields: true },
        },
        error: null,
      }),
    } as unknown as Response;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    try {
      await expect(
        hostAgentAPI.proposeMetadata({
          draft: { title: '', content: 'Draft', date: '2026-07-15', existing_metadata: {} },
          policy: { preserve_user_fields: true },
        }),
      ).rejects.toMatchObject({ code: 'SCHEMA_ERROR' });
    } finally {
      vi.restoreAllMocks();
    }
  });
});
