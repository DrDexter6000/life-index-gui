import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import {
  DEFAULT_HOST_AGENT_STREAM_TIMEOUT_MS,
  hostAgentKeys,
  useHostAgentHealth,
  useHostAgentMetadataProposal,
  useHostAgentStream,
} from '@/hooks/useHostAgent';
import { hostAgentAPI, type HostAgentStreamEvent } from '@/lib/api-client';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
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

const unavailableHealth = {
  schema_version: 'gui.host_agent.health.v1',
  running: false,
  ready: false,
  degraded: true,
  mode: 'UNAVAILABLE',
  reason: 'host-agent-unconfigured',
  runtime: { kind: 'external-host-agent', interface_version: 'v1' },
  checks: [{ name: 'interface_reachable', status: 'unavailable' }],
};

const partialFinal = {
  schema_version: 'gui.host_agent.query_response.v1',
  request_id: 'req-1',
  conversation_id: 'conv-1',
  source: 'host-agent',
  mode: 'PARTIAL',
  reason: 'sleep trajectory has zero observations',
  query: '最近晚睡趋势怎么样？',
  answer: {
    mode: 'PARTIAL',
    reason: 'sleep trajectory has zero observations',
    summary: '没有足够证据确认晚睡趋势。',
    insights: [],
    gap: 'sleep observations missing',
    suggestions: [],
  },
  evidence: [],
  tool_trace: [{ tool: 'trajectory', status: 'ok' }],
};

async function* streamEvents(): AsyncGenerator<HostAgentStreamEvent> {
  yield { type: 'status', data: { phase: 'planning', message: 'Reading Skill' } };
  yield { type: 'delta', data: { text: '没有足够证据' } };
  yield { type: 'delta', data: { text: '确认晚睡趋势。' } };
  yield { type: 'final', data: partialFinal };
}

describe('hostAgentKeys', () => {
  it('uses host-agent scopes for runtime-neutral handoff state', () => {
    expect(hostAgentKeys.health()).toEqual(['host-agent', 'health']);
    expect(hostAgentKeys.metadataProposal()).toEqual(['host-agent', 'metadata-proposal']);
    expect(hostAgentKeys.stream()).toEqual(['host-agent', 'stream']);
  });
});

describe('useHostAgentHealth', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches runtime-neutral health through /api/host-agent/health', async () => {
    let capturedUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      return mockFetchSuccess(unavailableHealth);
    });

    const { result } = renderHook(() => useHostAgentHealth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toBe('/api/host-agent/health');
    expect(result.current.data?.mode).toBe('UNAVAILABLE');
    expect(result.current.data?.reason).toBe('host-agent-unconfigured');
  });
});

describe('useHostAgentMetadataProposal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('posts draft metadata requests through the host-agent handoff endpoint', async () => {
    let capturedUrl = '';
    let capturedBody: unknown = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      capturedUrl = url as string;
      capturedBody = init?.body ? JSON.parse(String(init.body)) : null;
      return mockFetchSuccess({
        schema_version: 'gui.host_agent.metadata_proposal.v1',
        request_id: 'req-1',
        mode: 'PROPOSED',
        reason: 'semantic-fields-proposed-by-host-agent',
        fields: {
          title: {
            value: 'SkyVision 项目周会',
            field_source: 'agent_semantic',
            confidence: 0.86,
          },
        },
        warnings: [],
      });
    });

    const { result } = renderHook(() => useHostAgentMetadataProposal(), {
      wrapper: createWrapper(),
    });

    let proposal;
    await act(async () => {
      proposal = await result.current.mutateAsync({
        draft: {
          title: '',
          content: '今天和 Morgan、David 讨论 SkyVision 项目。',
          date: '2026-06-21',
          existing_metadata: { project: 'Manual Project' },
        },
        policy: { preserve_user_fields: true },
      });
    });

    expect(capturedUrl).toBe('/api/host-agent/metadata/propose');
    expect(capturedBody).toEqual({
      draft: {
        title: '',
        content: '今天和 Morgan、David 讨论 SkyVision 项目。',
        date: '2026-06-21',
        existing_metadata: { project: 'Manual Project' },
      },
      policy: { preserve_user_fields: true },
    });
    expect(proposal?.fields.title.value).toBe('SkyVision 项目周会');
  });
});

describe('useHostAgentStream', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not start a stream until explicitly started', () => {
    const streamSpy = vi.spyOn(hostAgentAPI, 'stream').mockImplementation(streamEvents);

    const { result } = renderHook(() => useHostAgentStream(), {
      wrapper: createWrapper(),
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.turns).toEqual([]);
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it('reuses a conversation id across turns and keeps prior turn answers', async () => {
    const conversationIds: Array<string | undefined> = [];
    vi.spyOn(hostAgentAPI, 'stream').mockImplementation(async function* (_query, options) {
      conversationIds.push(options?.conversationId);
      yield* streamEvents();
    });

    const { result } = renderHook(() => useHostAgentStream(), {
      wrapper: createWrapper(),
    });
    const initialConversationId = result.current.conversationId;

    await act(async () => {
      await result.current.start('最近晚睡趋势怎么样？');
    });
    await act(async () => {
      await result.current.start('那跟上个月比呢？');
    });

    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(result.current.conversationId).toBe(initialConversationId);
    expect(conversationIds).toEqual([initialConversationId, initialConversationId]);
    expect(result.current.turns).toHaveLength(2);
    expect(result.current.turns[0].finalResponse?.mode).toBe('PARTIAL');
    expect(result.current.turns[0].finalResponse?.reason).toBe('sleep trajectory has zero observations');
    expect(result.current.turns[1].query).toBe('那跟上个月比呢？');
  });

  it('maps calling_host_agent status events to a visible UI phase while waiting for delta', async () => {
    let releaseStream!: () => void;
    const holdStream = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    vi.spyOn(hostAgentAPI, 'stream').mockImplementation(async function* () {
      yield {
        type: 'status',
        data: {
          phase: 'calling_host_agent',
          message: 'Calling configured host agent runtime.',
        },
      };
      await holdStream;
      yield { type: 'final', data: partialFinal };
    });

    const { result } = renderHook(() => useHostAgentStream(), {
      wrapper: createWrapper(),
    });

    let startPromise!: Promise<void>;
    act(() => {
      startPromise = result.current.start('刚刚记录了什么？');
    });

    await waitFor(() => expect(result.current.phase).toBe('calling_host_agent'));
    expect(result.current.status).toBe('streaming');
    expect(result.current.statusMessage).toBe('Calling configured host agent runtime.');
    expect(result.current.deltaText).toBe('');
    expect(result.current.turns[0].phase).toBe('calling_host_agent');

    await act(async () => {
      releaseStream();
      await startPromise;
    });
    await waitFor(() => expect(result.current.status).toBe('complete'));
  });

  it('accepts the first final as the only terminal event', async () => {
    vi.spyOn(hostAgentAPI, 'stream').mockImplementation(async function* () {
      yield { type: 'final', data: partialFinal };
      yield {
        type: 'error',
        data: { code: 'LATE_ERROR', message: 'late error must be ignored' },
      } as HostAgentStreamEvent;
      yield { type: 'delta', data: { text: 'late delta must be ignored' } };
    });

    const { result } = renderHook(() => useHostAgentStream(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.start('first final wins');
    });

    expect(result.current.status).toBe('complete');
    expect(result.current.finalResponse?.reason).toBe(partialFinal.reason);
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]?.type).toBe('final');
  });

  it('treats an upstream error as terminal and never accepts a later final', async () => {
    vi.spyOn(hostAgentAPI, 'stream').mockImplementation(async function* () {
      yield {
        type: 'error',
        data: { code: 'RUNTIME_UNAVAILABLE', message: 'runtime unavailable' },
      } as HostAgentStreamEvent;
      yield { type: 'final', data: partialFinal };
    });

    const { result } = renderHook(() => useHostAgentStream(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.start('error first');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.finalResponse).toBeNull();
    expect(result.current.error?.message).toContain('RUNTIME_UNAVAILABLE');
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]?.type).toBe('error');
  });

  it('does not report a clean disconnect without a final as success', async () => {
    vi.spyOn(hostAgentAPI, 'stream').mockImplementation(async function* () {
      yield { type: 'status', data: { phase: 'answering', message: 'partial' } };
    });

    const { result } = renderHook(() => useHostAgentStream(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.start('disconnect before final');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.finalResponse).toBeNull();
    expect(result.current.error?.message).toContain('final response');
  });

  it('ignores late events from an aborted prior request', async () => {
    let releaseOld!: () => void;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const oldFinal = { ...partialFinal, request_id: 'old', reason: 'old answer' };
    const newFinal = { ...partialFinal, request_id: 'new', reason: 'new answer' };
    let call = 0;
    vi.spyOn(hostAgentAPI, 'stream').mockImplementation(async function* () {
      call += 1;
      if (call === 1) {
        await oldGate;
        yield { type: 'final', data: oldFinal };
        return;
      }
      yield { type: 'final', data: newFinal };
    });

    const { result } = renderHook(() => useHostAgentStream(), {
      wrapper: createWrapper(),
    });

    let oldPromise!: Promise<void>;
    act(() => {
      oldPromise = result.current.start('old request');
    });
    await waitFor(() => expect(call).toBe(1));

    await act(async () => {
      await result.current.start('new request');
    });
    expect(result.current.finalResponse?.request_id).toBe('new');

    await act(async () => {
      releaseOld();
      await oldPromise;
    });

    expect(result.current.finalResponse?.request_id).toBe('new');
    expect(result.current.turns.at(-1)?.finalResponse?.request_id).toBe('new');
  });

  it('exposes explicit cancel that aborts the active request', async () => {
    let observedSignal: AbortSignal | undefined;
    vi.spyOn(hostAgentAPI, 'stream').mockImplementation(async function* (_query, options) {
      observedSignal = options?.signal;
      await new Promise<void>((resolve) => options?.signal?.addEventListener('abort', () => resolve(), { once: true }));
      yield* [] as HostAgentStreamEvent[];
    });

    const { result } = renderHook(() => useHostAgentStream(), {
      wrapper: createWrapper(),
    });

    let startPromise!: Promise<void>;
    act(() => {
      startPromise = result.current.start('cancel me');
    });
    await waitFor(() => expect(observedSignal).toBeDefined());

    act(() => {
      result.current.cancel();
    });
    await act(async () => {
      await startPromise;
    });

    expect(observedSignal?.aborted).toBe(true);
    expect(result.current.status).toBe('cancelled');
    expect(result.current.turns[0]?.status).toBe('cancelled');
  });

  it('ends an unfinished request honestly at the bounded timeout', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(hostAgentAPI, 'stream').mockImplementation(async function* (_query, options) {
        await new Promise<void>((resolve) => options?.signal?.addEventListener('abort', () => resolve(), { once: true }));
        yield* [] as HostAgentStreamEvent[];
      });

      const { result } = renderHook(() => useHostAgentStream(), {
        wrapper: createWrapper(),
      });

      let startPromise!: Promise<void>;
      act(() => {
        startPromise = result.current.start('timeout me');
      });
      await act(async () => {
        await Promise.resolve();
        vi.advanceTimersByTime(DEFAULT_HOST_AGENT_STREAM_TIMEOUT_MS);
        await startPromise;
      });

      expect(result.current.status).toBe('error');
      expect(result.current.finalResponse).toBeNull();
      expect(result.current.error?.message).toContain('timed out');
    } finally {
      vi.useRealTimers();
    }
  });
});
