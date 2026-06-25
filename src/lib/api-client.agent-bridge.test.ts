import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  AgentBridgeGatewayHealthResponseSchema,
  AgentBridgeProbeResponseSchema,
  AgentBridgeQueryResponseSchema,
  AgentBridgeStreamEventSchema,
} from '@/lib/schemas';
import { APIClientError, agentBridgeAPI, hostAgentAPI } from '@/lib/api-client';

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

function mockSseResponse(frames: string[]) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) {
          controller.enqueue(encoder.encode(frame));
        }
        controller.close();
      },
    }),
    headers: new Headers({ 'content-type': 'text/event-stream' }),
  } as Response;
}

const probeEnvelope = {
  success: true,
  schema_version: 'm35.agent_bridge_probe.v0',
  command: 'agent-bridge probe',
  source: 'P1',
  mode: 'host_agent',
  transport: 'openai',
  endpoint: { configured: true, url: 'http://127.0.0.1:8642/v1' },
  model: { configured: true, name: 'hermes-agent' },
  ack: { data_exposure_ack: true, required_for: ['P1', 'P2'] },
  token: {
    configured: true,
    source: 'env:LIFE_INDEX_LLM_API_KEY',
    persisted_in_config: false,
  },
  checks: [{ name: 'models', status: 'pass', model_ids: ['hermes-agent'] }],
  sends_journal_evidence: false,
  ready_to_send_evidence: true,
  future_probe_field: 'preserved',
};

const gatewayHealthEnvelope = {
  running: true,
  degraded: false,
  gateway_status: 'warm',
  gateway_url: 'http://127.0.0.1:8765',
  reconnects: 0,
};

// ── Rich query test fixtures ─────────────────────────────────────────────

const groundedQueryEnvelope = {
  schema_version: 'm35.agent_bridge_query.v0',
  command: 'agent-bridge query',
  source: 'host-agent',
  query: '过去三天我去过哪里？',
  mode: 'GROUNDED' as const,
  scaffold: {
    intent: 'location',
    date_from: '2026-06-03',
    date_to: '2026-06-06',
    queries: ['过去三天 去过 哪里', 'location'],
    filters: {},
  },
  evidence: [
    {
      id: '2026/06/life-index_2026-06-02_001',
      rel_path: 'Journals/2026/06/life-index_2026-06-02_001.md',
      title: '随笔',
      date: '2026-06-02',
      snippet: 'optional short excerpt',
      metadata: {
        location: 'optional',
        topic: ['optional'],
      },
    },
  ],
  answer: {
    mode: 'GROUNDED' as const,
    summary: 'short answer grounded in evidence',
    insights: [
      {
        theme: 'location',
        quote: 'optional short quote',
        date: '2026-06-02',
        interpretation: 'why this evidence matters',
        evidence_refs: ['2026/06/life-index_2026-06-02_001'],
      },
    ],
    related_findings: [],
    gap: null,
    explanation: null,
    what_was_found: [],
    suggestions: [],
  },
  synthesis: 'optional legacy human-readable mirror of answer.summary',
  provenance: {
    evidence_source: 'life-index search',
    host_agent: 'configured provider label',
  },
};

const hostAgentGroundedEnvelope = {
  schema_version: 'gui.host_agent.query_response.v1',
  request_id: 'req-host-1',
  conversation_id: 'conv-host-1',
  source: 'host-agent',
  mode: 'GROUNDED' as const,
  reason: 'host-agent-returned-grounded-with-path-evidence',
  query: '刚刚记录了什么？',
  answer: {
    mode: 'GROUNDED' as const,
    reason: 'host-agent-returned-grounded-with-path-evidence',
    work_summary: '读取 1 篇日志并核对正文。',
    summary: '关于您的这个问题，刚刚的日志记录了 GUI 智能层验收。',
    insights: [],
    gap: null,
    suggestions: ['继续搜索 GUI 智能层验收'],
  },
  evidence: [{
    id: '2026/06/life-index_2026-06-22_003.md',
    rel_path: 'Journals/2026/06/life-index_2026-06-22_003.md',
    title: 'GUI 智能层元数据体验整理与搜索验证',
    date: '2026-06-22',
    excerpt: '今天继续梳理 Life Index GUI 智能层。',
  }],
  tool_trace: [],
};

const partialQueryEnvelope = {
  schema_version: 'm35.agent_bridge_query.v0',
  command: 'agent-bridge query',
  source: 'host-agent',
  query: '我的情绪趋势如何？',
  mode: 'PARTIAL' as const,
  scaffold: {
    intent: 'mood',
    date_from: '2026-05-01',
    date_to: '2026-06-06',
    queries: ['情绪 趋势', 'mood'],
    filters: {},
  },
  evidence: [
    {
      id: '2026/06/life-index_2026-06-05_002',
      rel_path: 'Journals/2026/06/life-index_2026-06-05_002.md',
      title: '心情',
      date: '2026-06-05',
    },
  ],
  answer: {
    mode: 'PARTIAL' as const,
    summary: 'partial answer with gaps',
    insights: [],
    related_findings: [{ theme: 'mood', count: 1 }],
    gap: '缺少5月份的情绪数据',
    explanation: null,
    what_was_found: [],
    suggestions: ['检查5月份日志是否被正确索引'],
  },
  synthesis: 'partial legacy synthesis',
};

const ungroundedQueryEnvelope = {
  schema_version: 'm35.agent_bridge_query.v0',
  command: 'agent-bridge query',
  source: 'host-agent',
  query: '我的投资回报率是多少？',
  mode: 'UNGROUNDED' as const,
  reason: 'citation referenced entries that were not read in this conversation',
  scaffold: {
    intent: 'finance',
    queries: ['投资 回报率', 'finance'],
    filters: {},
  },
  evidence: [],
  answer: {
    mode: 'UNGROUNDED' as const,
    summary: '我不能把这段回答标为有日志证据支撑。',
    reason: 'citation referenced entries that were not read in this conversation',
    insights: [],
    related_findings: [],
    gap: null,
    explanation: '日志中没有投资相关记录，无法提供回答。',
    what_was_found: [{ type: 'mood', count: 3 }, { type: 'location', count: 2 }],
    suggestions: ['尝试询问与日记内容相关的问题，如地点或情绪。'],
  },
  synthesis: null,
};

const legacyQueryEnvelope = {
  source: 'deterministic_only',
  query: 'What changed this week?',
  scaffold: {
    query: 'What changed this week?',
    filtered_results: [],
  },
  synthesis: 'Evidence-backed synthesis.',
  future_query_field: 'preserved',
};

describe('Agent Bridge probe schema (existing tests)', () => {
  it('AgentBridgeProbeResponseSchema preserves safe probe readiness fields', () => {
    const result = AgentBridgeProbeResponseSchema.parse(probeEnvelope);

    expect(result.schema_version).toBe('m35.agent_bridge_probe.v0');
    expect(result.command).toBe('agent-bridge probe');
    expect(result.endpoint.configured).toBe(true);
    expect(result.ack.data_exposure_ack).toBe(true);
    expect(result.token.persisted_in_config).toBe(false);
    expect(result.sends_journal_evidence).toBe(false);
    expect(result.ready_to_send_evidence).toBe(true);
    expect((result as Record<string, unknown>).future_probe_field).toBe('preserved');
  });

  it('AgentBridgeProbeResponseSchema rejects probe payloads that claim to send journal evidence', () => {
    expect(() => AgentBridgeProbeResponseSchema.parse({
      ...probeEnvelope,
      sends_journal_evidence: true,
    })).toThrow();
  });

  it('AgentBridgeProbeResponseSchema rejects probe payloads with evidence or synthesis fields', () => {
    expect(() => AgentBridgeProbeResponseSchema.parse({
      ...probeEnvelope,
      scaffold: { filtered_results: [] },
    })).toThrow();

    expect(() => AgentBridgeProbeResponseSchema.parse({
      ...probeEnvelope,
      synthesis: 'probe must not synthesize',
    })).toThrow();
  });
});

describe('Agent Bridge gateway health schema', () => {
  it('accepts backend-mediated gateway health snapshots', () => {
    const result = AgentBridgeGatewayHealthResponseSchema.parse(gatewayHealthEnvelope);

    expect(result.running).toBe(true);
    expect(result.degraded).toBe(false);
    expect(result.gateway_status).toBe('warm');
    expect(result.gateway_url).toBe('http://127.0.0.1:8765');
  });
});

describe('Agent Bridge rich query schema - GROUNDED mode', () => {
  it('parses a GROUNDED query with answer, evidence, and insights', () => {
    const result = AgentBridgeQueryResponseSchema.parse(groundedQueryEnvelope);

    expect(result.mode).toBe('GROUNDED');
    expect(result.source).toBe('host-agent');
    expect(result.query).toBe('过去三天我去过哪里？');
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].id).toBe('2026/06/life-index_2026-06-02_001');
    expect(result.evidence[0].title).toBe('随笔');
    expect(result.evidence[0].date).toBe('2026-06-02');
    expect(result.answer).toBeDefined();
    expect(result.answer!.mode).toBe('GROUNDED');
    expect(result.answer!.summary).toBe('short answer grounded in evidence');
    expect(result.answer!.insights).toHaveLength(1);
    expect(result.answer!.insights[0].evidence_refs).toContain('2026/06/life-index_2026-06-02_001');
    expect(result.synthesis).toBe('optional legacy human-readable mirror of answer.summary');
  });

  it('preserves additive fields in GROUNDED payload via passthrough', () => {
    const result = AgentBridgeQueryResponseSchema.parse({
      ...groundedQueryEnvelope,
      future_query_field: 'preserved',
      events: [{ type: 'status', message: 'done' }],
    });
    expect((result as Record<string, unknown>).future_query_field).toBe('preserved');
  });
});

describe('Agent Bridge rich query schema - PARTIAL mode', () => {
  it('parses a PARTIAL query with gap and suggestions', () => {
    const result = AgentBridgeQueryResponseSchema.parse(partialQueryEnvelope);

    expect(result.mode).toBe('PARTIAL');
    expect(result.answer).toBeDefined();
    expect(result.answer!.mode).toBe('PARTIAL');
    expect(result.answer!.summary).toBe('partial answer with gaps');
    expect(result.answer!.gap).toBe('缺少5月份的情绪数据');
    expect(result.answer!.suggestions).toContain('检查5月份日志是否被正确索引');
    expect(result.answer!.related_findings).toHaveLength(1);
    expect(result.synthesis).toBe('partial legacy synthesis');
  });
});

describe('Agent Bridge rich query schema - UNGROUNDED mode', () => {
  it('parses an UNGROUNDED query with explanation and what_was_found', () => {
    const result = AgentBridgeQueryResponseSchema.parse(ungroundedQueryEnvelope);

    expect(result.mode).toBe('UNGROUNDED');
    expect(result.reason).toBe('citation referenced entries that were not read in this conversation');
    expect(result.answer).toBeDefined();
    expect(result.answer!.mode).toBe('UNGROUNDED');
    expect(result.answer!.reason).toBe('citation referenced entries that were not read in this conversation');
    expect(result.answer!.explanation).toBe('日志中没有投资相关记录，无法提供回答。');
    expect(result.answer!.what_was_found).toHaveLength(2);
    expect(result.answer!.suggestions).toHaveLength(1);
    expect(result.synthesis).toBeNull();
  });

  it('accepts UNGROUNDED answer text while keeping evidence empty', () => {
    const result = AgentBridgeQueryResponseSchema.parse(ungroundedQueryEnvelope);
    expect(result.answer!.summary).toBe('我不能把这段回答标为有日志证据支撑。');
    expect(result.evidence).toEqual([]);
  });
});

describe('Agent Bridge rich query schema - legacy compatibility', () => {
  it('accepts legacy synthesis: string | null without answer', () => {
    const result = AgentBridgeQueryResponseSchema.parse(legacyQueryEnvelope);

    expect(result.source).toBe('deterministic_only');
    expect(result.synthesis).toBe('Evidence-backed synthesis.');
    expect(result.answer).toBeUndefined();
    expect(result.mode).toBeUndefined();
    expect(result.evidence).toEqual([]);
    expect((result as Record<string, unknown>).future_query_field).toBe('preserved');
  });

  it('accepts synthesis: null for scaffold-only degradation', () => {
    const result = AgentBridgeQueryResponseSchema.parse({
      source: 'deterministic_only',
      query: 'What changed this week?',
      scaffold: { query: 'What changed this week?', filtered_results: [] },
      synthesis: null,
    });

    expect(result.synthesis).toBeNull();
    expect(result.answer).toBeUndefined();
  });

  it('prefers answer when both answer and legacy synthesis are present', () => {
    const result = AgentBridgeQueryResponseSchema.parse(groundedQueryEnvelope);

    expect(result.answer).toBeDefined();
    expect(result.answer!.summary).toBe('short answer grounded in evidence');
    expect(result.synthesis).toBeDefined();
    // Rich consumers should check answer first, synthesis as fallback
    const richSummary = result.answer?.summary ?? result.synthesis;
    expect(richSummary).toBe('short answer grounded in evidence');
  });

  it('accepts rich answer payloads without a legacy synthesis mirror', () => {
    const richWithoutSynthesis: Record<string, unknown> = { ...groundedQueryEnvelope };
    delete richWithoutSynthesis.synthesis;

    const result = AgentBridgeQueryResponseSchema.parse(richWithoutSynthesis);

    expect(result.answer?.summary).toBe('short answer grounded in evidence');
    expect(result.synthesis).toBeNull();
  });
});

describe('Agent Bridge rich query schema - mode validation', () => {
  it('preserves unknown future mode values for neutral UI rendering', () => {
    const result = AgentBridgeQueryResponseSchema.parse({
      ...groundedQueryEnvelope,
      mode: 'UNVERIFIABLE',
      answer: {
        ...groundedQueryEnvelope.answer,
        mode: 'UNVERIFIABLE',
      },
    });

    expect(result.mode).toBe('UNVERIFIABLE');
    expect(result.answer!.mode).toBe('UNVERIFIABLE');
  });

  it('rejects when mode is missing and answer.mode is present', () => {
    expect(() => AgentBridgeQueryResponseSchema.parse({
      ...groundedQueryEnvelope,
      mode: undefined,
    })).toThrow();
  });

  it('mode must match answer.mode when answer is present', () => {
    expect(() => AgentBridgeQueryResponseSchema.parse({
      ...groundedQueryEnvelope,
      answer: { ...groundedQueryEnvelope.answer, mode: 'UNGROUNDED' as const },
    })).toThrow();
  });
});

describe('Agent Bridge rich query schema - evidence validation', () => {
  it('parses evidence items with required fields', () => {
    const result = AgentBridgeQueryResponseSchema.parse({
      ...groundedQueryEnvelope,
      evidence: [
        { id: 'test/001', rel_path: 'test.md', title: 'Test', date: '2026-01-01' },
      ],
    });

    expect(result.evidence[0].id).toBe('test/001');
    expect(result.evidence[0].rel_path).toBe('test.md');
    expect(result.evidence[0].title).toBe('Test');
  });

  it('parses evidence with optional snippet, excerpt, and metadata', () => {
    const result = AgentBridgeQueryResponseSchema.parse({
      ...groundedQueryEnvelope,
      evidence: [
        {
          id: 'test/001',
          rel_path: 'test.md',
          title: 'Test',
          date: '2026-01-01',
          snippet: 'hello',
          excerpt: 'source excerpt',
          metadata: { topic: ['tech'], location: 'home' },
        },
      ],
    });

    expect(result.evidence[0].snippet).toBe('hello');
    expect(result.evidence[0].excerpt).toBe('source excerpt');
    expect(result.evidence[0].metadata).toEqual({ topic: ['tech'], location: 'home' });
  });

  it('defaults evidence to empty array when missing', () => {
    const result = AgentBridgeQueryResponseSchema.parse({
      source: 'test',
      query: 'test query',
      scaffold: {},
      synthesis: null,
    });

    expect(result.evidence).toEqual([]);
  });
});

describe('Agent Bridge streaming event schema', () => {
  it('accepts only contract event types and keeps delta limited to answer text', () => {
    const delta = AgentBridgeStreamEventSchema.parse({
      type: 'delta',
      data: { text: 'partial answer' },
    });

    expect(delta.type).toBe('delta');
    if (delta.type !== 'delta') throw new Error('expected delta');
    expect(delta.data.text).toBe('partial answer');
    const stringDelta = AgentBridgeStreamEventSchema.parse({
      type: 'delta',
      data: 'runtime string delta',
    });
    expect(stringDelta.type).toBe('delta');
    if (stringDelta.type !== 'delta') throw new Error('expected delta');
    expect(stringDelta.data.text).toBe('runtime string delta');
    expect(() => AgentBridgeStreamEventSchema.parse({
      type: 'chunk',
      data: { text: 'provider-native chunk' },
    })).toThrow();
    expect(() => AgentBridgeStreamEventSchema.parse({
      type: 'delta',
      data: { text: 'partial answer', evidence: [] },
    })).toThrow();
  });

  it('requires final events to carry a rich envelope with valid no-evidence guarantees', () => {
    const final = AgentBridgeStreamEventSchema.parse({
      type: 'final',
      data: groundedQueryEnvelope,
    });

    expect(final.type).toBe('final');
    if (final.type !== 'final') throw new Error('expected final');
    expect(final.data.schema_version).toBe('m35.agent_bridge_query.v0');
    expect(final.data.command).toBe('agent-bridge query');
    expect(() => AgentBridgeStreamEventSchema.parse({
      type: 'final',
      data: {
        ...ungroundedQueryEnvelope,
        evidence: [{ id: 'bad', rel_path: 'bad.md', title: 'Bad', date: '2026-01-01' }],
      },
    })).toThrow();
    expect(() => AgentBridgeStreamEventSchema.parse({
      type: 'final',
      data: {
        ...groundedQueryEnvelope,
        answer: {
          ...groundedQueryEnvelope.answer,
          insights: [{ ...groundedQueryEnvelope.answer.insights[0], evidence_refs: ['missing'] }],
        },
      },
    })).toThrow();
  });
});

describe('agentBridgeAPI methods with rich query', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('getProbe calls GET /api/agent-bridge/probe', async () => {
    let capturedUrl = '';
    let capturedMethod = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      capturedUrl = url as string;
      capturedMethod = opts?.method as string ?? 'GET';
      return mockFetchResponse(probeEnvelope) as Response;
    });

    const result = await agentBridgeAPI.getProbe();

    expect(capturedUrl).toBe('/api/agent-bridge/probe');
    expect(capturedMethod).toBe('GET');
    expect(result.sends_journal_evidence).toBe(false);
  });

  it('getHealth calls GET /api/agent-bridge/health', async () => {
    let capturedUrl = '';
    let capturedMethod = '';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      capturedUrl = url as string;
      capturedMethod = opts?.method as string ?? 'GET';
      return mockFetchResponse(gatewayHealthEnvelope) as Response;
    });

    const result = await agentBridgeAPI.getHealth();

    expect(capturedUrl).toBe('/api/agent-bridge/health');
    expect(capturedMethod).toBe('GET');
    expect(result.running).toBe(true);
  });

  it('query parses a rich GROUNDED response with answer and evidence', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, _opts) => {
      return mockFetchResponse(groundedQueryEnvelope) as Response;
    });

    const result = await agentBridgeAPI.query('过去三天我去过哪里？');

    expect(result.mode).toBe('GROUNDED');
    expect(result.source).toBe('host-agent');
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].id).toBe('2026/06/life-index_2026-06-02_001');
    expect(result.answer).toBeDefined();
    expect(result.answer!.summary).toBe('short answer grounded in evidence');
    expect(result.synthesis).toBe('optional legacy human-readable mirror of answer.summary');
  });

  it('query parses a legacy synthesis-only response (backward compatible)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, _opts) => {
      return mockFetchResponse(legacyQueryEnvelope) as Response;
    });

    const result = await agentBridgeAPI.query('What changed this week?');

    expect(result.synthesis).toBe('Evidence-backed synthesis.');
    expect(result.mode).toBeUndefined();
  });

  it('query posts the trimmed user query to /api/agent-bridge/query', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: unknown = null;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      capturedUrl = url as string;
      capturedMethod = opts?.method as string ?? 'GET';
      capturedBody = opts?.body ? JSON.parse(opts.body as string) : null;
      return mockFetchResponse(groundedQueryEnvelope) as Response;
    });

    await agentBridgeAPI.query('  过去三天我去过哪里？  ');

    expect(capturedUrl).toBe('/api/agent-bridge/query');
    expect(capturedMethod).toBe('POST');
    expect(capturedBody).toEqual({ query: '过去三天我去过哪里？' });
  });

  it('stream posts to the backend SSE endpoint and yields validated contract events', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedAccept = '';
    let capturedBody: unknown = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      capturedUrl = url as string;
      capturedMethod = opts?.method as string ?? 'GET';
      capturedAccept = String((opts?.headers as Record<string, string>).Accept);
      capturedBody = opts?.body ? JSON.parse(opts.body as string) : null;
      return mockSseResponse([
        'event: status\ndata: {"phase":"warming","message":"Mock gateway warming"}\n\n',
        'event: delta\ndata: "You visited "\n\n',
        `event: final\ndata: ${JSON.stringify(groundedQueryEnvelope)}\n\n`,
      ]);
    });

    const events = [];
    for await (const event of agentBridgeAPI.stream('  过去三天我去过哪里？  ')) {
      events.push(event);
    }

    expect(capturedUrl).toBe('/api/agent-bridge/query/stream');
    expect(capturedMethod).toBe('POST');
    expect(capturedAccept).toBe('text/event-stream');
    expect(capturedBody).toEqual({ query: '过去三天我去过哪里？' });
    expect(events.map((event) => event.type)).toEqual(['status', 'delta', 'final']);
    expect(events[1]).toEqual({ type: 'delta', data: { text: 'You visited ' } });
  });

  it('stream includes conversation_id only when provided', async () => {
    const capturedBodies: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBodies.push(opts?.body ? JSON.parse(opts.body as string) : null);
      return mockSseResponse([
        `event: final\ndata: ${JSON.stringify(groundedQueryEnvelope)}\n\n`,
      ]);
    });

    for await (const event of agentBridgeAPI.stream('first question')) {
      void event;
    }
    for await (const event of agentBridgeAPI.stream('follow up', { conversationId: 'conv-123' })) {
      void event;
    }

    expect(capturedBodies).toEqual([
      { query: 'first question' },
      { query: 'follow up', conversation_id: 'conv-123' },
    ]);
  });

  it('host-agent stream handles CRLF frames and flushes a final tail frame', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
      mockSseResponse([
        'event: status\r\ndata: {"phase":"calling_host_agent","message":"Calling configured host agent runtime."}\r\n\r\n',
        'event: delta\r\ndata: {"text":"读取日志。"}\r\n\r\n',
        `event: final\r\ndata: ${JSON.stringify(hostAgentGroundedEnvelope)}`,
      ])
    ));

    const events = [];
    for await (const event of hostAgentAPI.stream('刚刚记录了什么？', { conversationId: 'conv-host-1' })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual(['status', 'delta', 'final']);
    expect(events[1]).toEqual({ type: 'delta', data: { text: '读取日志。' } });
    expect(events[2]).toMatchObject({
      type: 'final',
      data: {
        mode: 'GROUNDED',
        answer: {
          work_summary: '读取 1 篇日志并核对正文。',
          suggestions: ['继续搜索 GUI 智能层验收'],
        },
      },
    });
  });

  it('stream maps backend error SSE envelopes to APIClientError', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
      mockSseResponse([
        'event: error\ndata: {"ok":false,"data":null,"error":{"code":"AGENT_GATEWAY_ERROR","message":"mock failure"},"meta":null}\n\n',
      ])
    ));

    await expect(async () => {
      for await (const event of agentBridgeAPI.stream('force error')) {
        void event;
      }
    }).rejects.toMatchObject({
      name: 'APIClientError',
      code: 'AGENT_GATEWAY_ERROR',
      message: 'mock failure',
    } satisfies Partial<APIClientError>);
  });
});
