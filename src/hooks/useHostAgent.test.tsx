import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import {
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
});
