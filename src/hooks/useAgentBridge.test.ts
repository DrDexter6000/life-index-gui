import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import {
  agentBridgeKeys,
  useAgentBridgeHealth,
  useAgentBridgeProbe,
  useAgentBridgeQuery,
  useAgentBridgeStream,
} from '@/hooks/useAgentBridge';
import { agentBridgeAPI, type AgentBridgeStreamEvent } from '@/lib/api-client';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
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

const probePayload = {
  success: true,
  schema_version: 'm35.agent_bridge_probe.v0',
  command: 'agent-bridge probe',
  source: 'P1',
  endpoint: { configured: true },
  model: { configured: true },
  ack: { data_exposure_ack: true },
  token: { configured: true, persisted_in_config: false },
  checks: [],
  sends_journal_evidence: false,
  ready_to_send_evidence: true,
};

const healthPayload = {
  running: true,
  degraded: false,
  gateway_status: 'warm',
  gateway_url: 'http://127.0.0.1:8765',
  reconnects: 0,
  lifecycle: { mode: 'mock' },
};

const groundedFinal = {
  schema_version: 'm35.agent_bridge_query.v0' as const,
  command: 'agent-bridge query' as const,
  source: 'host-agent',
  query: 'Where did I go?',
  mode: 'GROUNDED' as const,
  scaffold: { intent: 'location', date_from: '2026-06-01', date_to: '2026-06-02', queries: ['where'], filters: {} },
  evidence: [
    { id: '2026/06/e1', rel_path: 'Journals/2026/06/e1.md', title: 'Park', date: '2026-06-01' },
  ],
  answer: {
    mode: 'GROUNDED' as const,
    summary: 'You visited the park.',
    insights: [
      {
        theme: 'location',
        interpretation: 'Park visit',
        evidence_refs: ['2026/06/e1'],
      },
    ],
    related_findings: [],
    gap: null,
    explanation: null,
    what_was_found: [],
    suggestions: [],
  },
  synthesis: 'You visited the park.',
};

async function* streamEvents(): AsyncGenerator<AgentBridgeStreamEvent> {
  yield { type: 'status' as const, data: { phase: 'warming', message: 'Warming gateway' } };
  yield { type: 'scaffold' as const, data: { intent: 'location', date_from: '2026-06-01', date_to: '2026-06-02', queries: ['where'], filters: {} } };
  yield {
    type: 'evidence' as const,
    data: [
      { id: '2026/06/e1', rel_path: 'Journals/2026/06/e1.md', title: 'Park', date: '2026-06-01' },
    ],
  };
  yield { type: 'delta' as const, data: { text: 'You visited ' } };
  yield { type: 'delta' as const, data: { text: 'the park.' } };
  yield { type: 'final' as const, data: groundedFinal };
}

describe('agentBridgeKeys stability', () => {
  it('returns stable keys for probe and query mutation scopes', () => {
    expect(agentBridgeKeys.probe()).toEqual(['agent-bridge', 'probe']);
    expect(agentBridgeKeys.health()).toEqual(['agent-bridge', 'health']);
    expect(agentBridgeKeys.query()).toEqual(['agent-bridge', 'query']);
    expect(agentBridgeKeys.stream()).toEqual(['agent-bridge', 'stream']);
  });
});

describe('useAgentBridgeProbe', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the no-journal-evidence probe through the backend route', async () => {
    let capturedUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      return mockFetchSuccess(probePayload) as Response;
    });

    const { result } = renderHook(() => useAgentBridgeProbe(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toBe('/api/agent-bridge/probe');
    expect(result.current.data?.sends_journal_evidence).toBe(false);
  });
});

describe('useAgentBridgeHealth', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches backend-mediated gateway health through the backend route', async () => {
    let capturedUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url as string;
      return mockFetchSuccess(healthPayload) as Response;
    });

    const { result } = renderHook(() => useAgentBridgeHealth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toBe('/api/agent-bridge/health');
    expect(result.current.data?.running).toBe(true);
    expect(result.current.data?.gateway_status).toBe('warm');
  });
});

describe('useAgentBridgeQuery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not send a handoff request until mutate is called', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
      mockFetchSuccess({
        source: 'P1',
        query: 'q',
        scaffold: {},
        synthesis: 'answer',
      }) as Response
    ));

    renderHook(() => useAgentBridgeQuery(), {
      wrapper: createWrapper(),
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the trimmed query when the user triggers synthesis', async () => {
    let capturedUrl = '';
    let capturedBody: unknown = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      capturedUrl = url as string;
      capturedBody = opts?.body ? JSON.parse(opts.body as string) : null;
      return mockFetchSuccess({
        source: 'P1',
        query: 'What changed this week?',
        scaffold: { query: 'What changed this week?', filtered_results: [] },
        synthesis: 'Evidence-backed synthesis.',
      }) as Response;
    });

    const { result } = renderHook(() => useAgentBridgeQuery(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('  What changed this week?  ');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toBe('/api/agent-bridge/query');
    expect(capturedBody).toEqual({ query: 'What changed this week?' });
    expect(result.current.data?.synthesis).toBe('Evidence-backed synthesis.');
  });
});

describe('useAgentBridgeStream', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not start the backend stream until start is called', () => {
    const streamSpy = vi.spyOn(agentBridgeAPI, 'stream').mockImplementation(streamEvents);

    const { result } = renderHook(() => useAgentBridgeStream(), {
      wrapper: createWrapper(),
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.phase).toBe('idle');
    expect(result.current.deltaText).toBe('');
    expect(result.current.scaffold).toBeNull();
    expect(result.current.evidencePreview).toEqual([]);
    expect(result.current.evidenceCount).toBe(0);
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it('tracks status, scaffold, evidence, delta, and final stream progress', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(agentBridgeAPI, 'stream').mockImplementation(async function* (_query, options) {
      capturedSignal = options?.signal;
      yield* streamEvents();
    });

    const { result } = renderHook(() => useAgentBridgeStream(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.start('  Where did I go?  ');
    });

    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);
    expect(result.current.phase).toBe('complete');
    expect(result.current.statusMessage).toBe('Warming gateway');
    expect(result.current.scaffold).toEqual({
      intent: 'location',
      date_from: '2026-06-01',
      date_to: '2026-06-02',
      queries: ['where'],
      filters: {},
    });
    expect(result.current.evidencePreview).toHaveLength(1);
    expect(result.current.evidencePreview[0].title).toBe('Park');
    expect(result.current.evidenceCount).toBe(1);
    expect(result.current.deltaText).toBe('You visited the park.');
    expect(result.current.finalResponse?.answer?.summary).toBe('You visited the park.');
    expect(result.current.events.map((event) => event.type)).toEqual([
      'status',
      'scaffold',
      'evidence',
      'delta',
      'delta',
      'final',
    ]);
  });

  it('reuses one conversation id across turns and accumulates turn state', async () => {
    const conversationIds: Array<string | undefined> = [];
    vi.spyOn(agentBridgeAPI, 'stream').mockImplementation(async function* (_query, options) {
      conversationIds.push(options?.conversationId);
      yield* streamEvents();
    });

    const { result } = renderHook(() => useAgentBridgeStream(), {
      wrapper: createWrapper(),
    });
    const initialConversationId = result.current.conversationId;

    await act(async () => {
      await result.current.start('Where did I go?');
    });
    await act(async () => {
      await result.current.start('What about after that?');
    });

    await waitFor(() => expect(result.current.status).toBe('complete'));
    expect(result.current.conversationId).toBe(initialConversationId);
    expect(conversationIds).toEqual([initialConversationId, initialConversationId]);
    expect(result.current.turns).toHaveLength(2);
    expect(result.current.turns.map((turn) => turn.query)).toEqual([
      'Where did I go?',
      'What about after that?',
    ]);
    expect(result.current.turns.every((turn) => turn.status === 'complete')).toBe(true);
  });

  it('reset starts a new conversation and clears prior turns', async () => {
    vi.spyOn(agentBridgeAPI, 'stream').mockImplementation(streamEvents);

    const { result } = renderHook(() => useAgentBridgeStream(), {
      wrapper: createWrapper(),
    });
    const initialConversationId = result.current.conversationId;

    await act(async () => {
      await result.current.start('Where did I go?');
    });
    await waitFor(() => expect(result.current.turns).toHaveLength(1));

    act(() => {
      result.current.reset();
    });

    expect(result.current.conversationId).not.toBe(initialConversationId);
    expect(result.current.turns).toEqual([]);
  });

  it('reset aborts stream state and returns to idle', async () => {
    vi.spyOn(agentBridgeAPI, 'stream').mockImplementation(streamEvents);

    const { result } = renderHook(() => useAgentBridgeStream(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.start('Where did I go?');
    });
    await waitFor(() => expect(result.current.status).toBe('complete'));

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.phase).toBe('idle');
    expect(result.current.deltaText).toBe('');
    expect(result.current.finalResponse).toBeNull();
    expect(result.current.statusMessage).toBeNull();
    expect(result.current.scaffold).toBeNull();
    expect(result.current.evidencePreview).toEqual([]);
    expect(result.current.evidenceCount).toBe(0);
    expect(result.current.error).toBeNull();
    expect(result.current.events).toEqual([]);
  });

  it('turns stream failures into error state without returning stale final data', async () => {
    vi.spyOn(agentBridgeAPI, 'stream').mockImplementation(async function* () {
      yield { type: 'status' as const, data: { phase: 'warming' } };
      throw new Error('mock stream failed');
    });

    const { result } = renderHook(() => useAgentBridgeStream(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.start('force failure');
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.message).toBe('mock stream failed');
    expect(result.current.finalResponse).toBeNull();
  });
});
