import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import Recall from './Recall';
import { AI_PLUS_FEATURE_ENABLES } from '@/lib/health-status';
import type { HostAgentConversationTurn, HostAgentStreamPhase, HostAgentStreamStatus } from '@/hooks/useHostAgent';
import type { HostAgentHealthResponse, HostAgentQueryResponse } from '@/lib/api-client';

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-search">{location.search}</span>;
}

const mockJournalSearchReturn = {
  data: null as {
    results: Array<Record<string, unknown>>;
    total: number;
    entityExpansion?: Record<string, unknown>;
    meta?: Record<string, unknown>;
  } | null,
  isLoading: false,
  isError: false,
  error: null as Error | null,
  refetch: vi.fn(),
};

const readyHealth: HostAgentHealthResponse = {
  schema_version: 'gui.host_agent.health.v1',
  running: true,
  ready: true,
  degraded: false,
  mode: 'READY',
  reason: 'ready',
  runtime: { kind: 'external-host-agent', interface_version: 'v1' },
  checks: [],
};

const mockHostHealthReturn = {
  data: null as HostAgentHealthResponse | null,
  isLoading: false,
  isError: false,
};

const mockHostStreamReturn = {
  conversationId: 'host-conv-test',
  turns: [] as HostAgentConversationTurn[],
  status: 'idle' as HostAgentStreamStatus,
  phase: 'idle' as HostAgentStreamPhase,
  statusMessage: null as string | null,
  evidencePreview: [] as HostAgentQueryResponse['evidence'],
  evidenceCount: 0,
  deltaText: '',
  finalResponse: null as HostAgentQueryResponse | null,
  error: null as Error | null,
  events: [] as Array<Record<string, unknown>>,
  start: vi.fn(),
  cancel: vi.fn(),
  reset: vi.fn(),
};

function hostResponse(
  mode: string,
  summary: string,
  evidence: HostAgentQueryResponse['evidence'] = [],
  reason = 'host returned evidence status',
): HostAgentQueryResponse {
  return {
    schema_version: 'gui.host_agent.query_response.v1',
    request_id: 'req-1',
    conversation_id: 'host-conv-test',
    source: 'host-agent',
    mode,
    reason,
    query: 'host query',
    answer: {
      mode,
      reason,
      summary,
      insights: [],
      gap: mode === 'PARTIAL' ? 'not enough evidence for the full answer' : null,
      suggestions: [],
    },
    evidence,
    tool_trace: [{ tool: 'aggregate', status: 'ok' }],
  };
}

function completedTurn(
  id: string,
  query: string,
  finalResponse: HostAgentQueryResponse,
): HostAgentConversationTurn {
  return {
    id,
    query,
    status: 'complete',
    phase: 'complete',
    statusMessage: null,
    evidencePreview: finalResponse.evidence,
    deltaText: finalResponse.answer?.summary ?? '',
    finalResponse,
    error: null,
    events: [{ type: 'final', data: finalResponse }],
  };
}

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        recallSubtitle: 'Search by keyword, date, or mood',
        recallTitleCn: '穿梭至某个时空坐标...',
        recallTitleEn: 'Warp to a space-time coordinate',
        searchPlaceholder: 'Search keywords...',
        searchSubmit: 'Search',
        hostAgentQueryCancel: 'Cancel',
        noResults: 'No matching results found',
        noResultsHint: 'Try different keywords',
        loadFailed: 'Load Failed',
        checkNetwork: 'Check your network connection and retry',
        retry: 'Retry',
        searchModeKeyword: 'Keyword',
        searchModeAI: 'AI+',
        searchDateOptions: 'Date Options / 日期选项',
        searchDateStart: 'From / 起始日期',
        searchDateEnd: 'To / 结束日期',
        recallTabKeyword: 'Keyword',
        recallTabAI: 'AI+',
        hostAgentQueryPlaceholder: 'Ask about your journal...',
        hostAgentQuerySubmit: 'Ask',
        hostAgentQueryEmpty: 'Enter a question to ask the Host Agent',
        hostAgentHealthLoading: 'Connecting...',
        hostAgentUnavailable: 'Host agent unavailable',
        hostAgentTabUnavailable: 'AI+ unavailable - Host Agent not connected',
        hostAgentStreamThinking: 'Thinking through evidence',
        hostAgentStreamThinkingPending: 'Waiting for Host Agent reasoning...',
        hostAgentStreamThinkingUnavailable: 'Host Agent did not provide displayable reasoning for this turn.',
        hostAgentStreamWarming: 'Preparing answer',
        hostAgentStreamStageStatus: 'Preparing stream',
        hostAgentStreamStageEvidence: 'Searching evidence',
        hostAgentStreamStageScaffold: 'Planning query',
        hostAgentStreamStageCallingHostAgent: 'Calling Host Agent',
        hostAgentStreamStageAnswer: 'Writing answer',
        hostAgentStreamEvidenceFound: 'Found {{count}} evidence',
        hostAgentStreamNoEvidence: 'No evidence yet',
        hostAgentStreamElapsed: '{{seconds}}s elapsed',
        hostAgentStreamErrorTitle: 'Stream failed',
        hostAgentStreamErrorBody: 'The Host Agent could not complete this request.',
        hostAgentThinkingToggle: 'Thinking process',
        entityExpansionTitle: 'Entity graph expansion',
        entityExpansionAlias: 'Alias: {{from}} -> {{to}}',
        entityExpansionRelation: 'Relation: {{from}} -> {{to}}',
        entityExpansionGeneric: 'Entity graph expansion',
        entityExpansionMore: '+{{count}} more',
      };
      return (map[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name) => String(vars?.[name] ?? ''));
    },
    lang: 'en',
  }),
}));

vi.mock('@/hooks/useJournals', () => ({
  useJournalSearch: () => mockJournalSearchReturn,
}));

vi.mock('@/hooks/useHostAgent', () => ({
  useHostAgentHealth: () => mockHostHealthReturn,
  useHostAgentStream: () => mockHostStreamReturn,
}));

describe('Recall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    AI_PLUS_FEATURE_ENABLES.groundedQuery = true;
    AI_PLUS_FEATURE_ENABLES.smartMetadata = false;
    mockJournalSearchReturn.data = null;
    mockJournalSearchReturn.isLoading = false;
    mockJournalSearchReturn.isError = false;
    mockJournalSearchReturn.error = null;
    mockHostHealthReturn.data = null;
    mockHostHealthReturn.isLoading = false;
    mockHostHealthReturn.isError = false;
    mockHostStreamReturn.conversationId = 'host-conv-test';
    mockHostStreamReturn.turns = [];
    mockHostStreamReturn.status = 'idle';
    mockHostStreamReturn.phase = 'idle';
    mockHostStreamReturn.statusMessage = null;
    mockHostStreamReturn.evidencePreview = [];
    mockHostStreamReturn.evidenceCount = 0;
    mockHostStreamReturn.deltaText = '';
    mockHostStreamReturn.finalResponse = null;
    mockHostStreamReturn.error = null;
    mockHostStreamReturn.events = [];
    mockHostStreamReturn.start.mockReset();
    mockHostStreamReturn.cancel.mockReset();
    mockHostStreamReturn.reset.mockReset();
  });

  afterEach(() => {
    AI_PLUS_FEATURE_ENABLES.groundedQuery = false;
    AI_PLUS_FEATURE_ENABLES.smartMetadata = false;
  });

  it('keeps keyword tab as the default usable lane', () => {
    render(
      <MemoryRouter>
        <Recall />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('tab-keyword')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Search keywords...')).toBeInTheDocument();
  });

  it('keeps AI+ disabled until Host Agent handoff health is ready', () => {
    render(
      <MemoryRouter>
        <Recall />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('tab-agent')).toBeDisabled();
  });

  it('enables AI+ when Host Agent health is ready', () => {
    mockHostHealthReturn.data = readyHealth;

    render(
      <MemoryRouter>
        <Recall />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('tab-agent')).not.toBeDisabled();
  });

  it('shows unavailable state when Host Agent health reports not ready', () => {
    mockHostHealthReturn.data = {
      ...readyHealth,
      ready: false,
      degraded: true,
      mode: 'NOT_READY',
      reason: 'background_rebuild',
    };

    render(
      <MemoryRouter>
        <Recall />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('tab-agent')).toBeDisabled();
  });

  it('sends Host Agent queries through useHostAgentStream', () => {
    mockHostHealthReturn.data = readyHealth;

    render(
      <MemoryRouter>
        <Recall />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('tab-agent'));
    fireEvent.change(screen.getByTestId('agent-query-input'), {
      target: { value: '今年 SkyVision Africa 有几篇？' },
    });
    fireEvent.click(screen.getByTestId('agent-submit'));

    expect(mockHostStreamReturn.start).toHaveBeenCalledWith('今年 SkyVision Africa 有几篇？');
  });

  it('exposes an explicit cancel control while the Host Agent stream is active', () => {
    mockHostHealthReturn.data = readyHealth;
    mockHostStreamReturn.status = 'streaming';

    render(
      <MemoryRouter>
        <Recall />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('tab-agent'));
    fireEvent.click(screen.getByTestId('agent-cancel'));

    expect(mockHostStreamReturn.cancel).toHaveBeenCalledTimes(1);
  });

  it('renders live reasoning text without the retired stage harness', () => {
    mockHostHealthReturn.data = readyHealth;
    mockHostStreamReturn.status = 'streaming';
    mockHostStreamReturn.phase = 'answering';
    mockHostStreamReturn.statusMessage = 'Reading aggregate output';
    mockHostStreamReturn.deltaText = '今年 SkyVision Africa ';
    mockHostStreamReturn.evidencePreview = [
      {
        id: '2026/02/life-index_2026-02-22_002',
        rel_path: 'Journals/2026/02/life-index_2026-02-22_002.md',
        title: 'SkyVision 无人机项目周会',
        date: '2026-02-22',
      },
    ];
    mockHostStreamReturn.evidenceCount = 1;
    mockHostStreamReturn.turns = [
      {
        id: 'turn-streaming',
        query: '今年 SkyVision Africa 有几篇？',
        status: 'streaming',
        phase: 'answering',
        statusMessage: 'Reading aggregate output',
        evidencePreview: mockHostStreamReturn.evidencePreview,
        deltaText: mockHostStreamReturn.deltaText,
        finalResponse: null,
        error: null,
        events: [],
      },
    ];

    render(
      <MemoryRouter>
        <Recall />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('tab-agent'));
    expect(screen.getByTestId('host-agent-stream-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('host-agent-stream-stages')).not.toBeInTheDocument();
    expect(screen.getByTestId('host-agent-live-thinking')).toHaveTextContent('今年 SkyVision Africa');
    expect(screen.getByTestId('host-agent-stream-delta')).toHaveTextContent('今年 SkyVision Africa');
  });

  it('shows Host Agent stream status before any delta arrives', () => {
    mockHostHealthReturn.data = readyHealth;
    mockHostStreamReturn.status = 'streaming';
    mockHostStreamReturn.phase = 'calling_host_agent' as HostAgentStreamPhase;
    mockHostStreamReturn.statusMessage = 'Calling configured host agent runtime.';
    mockHostStreamReturn.deltaText = '';
    mockHostStreamReturn.turns = [
      {
        id: 'turn-status',
        query: '刚刚记录了什么？',
        status: 'streaming',
        phase: 'calling_host_agent' as HostAgentStreamPhase,
        statusMessage: 'Calling configured host agent runtime.',
        evidencePreview: [],
        deltaText: '',
        finalResponse: null,
        error: null,
        events: [],
      },
    ];

    render(
      <MemoryRouter>
        <Recall />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('tab-agent'));

    const panel = screen.getByTestId('host-agent-stream-panel');
    expect(panel).toHaveTextContent('Calling Host Agent');
    expect(panel).toHaveTextContent('Calling configured host agent runtime.');
    expect(screen.getByTestId('host-agent-stream-delta')).not.toHaveTextContent('Waiting for Host Agent reasoning');
  });

  it('renders a two-turn Host Agent conversation with badge, reason, and evidence links', () => {
    mockHostHealthReturn.data = readyHealth;
    const first = hostResponse('GROUNDED', '今年 SkyVision Africa 有 1 篇。', [
      {
        id: '2026/02/life-index_2026-02-22_002',
        rel_path: 'Journals/2026/02/life-index_2026-02-22_002.md',
        title: 'SkyVision 无人机项目周会',
        date: '2026-02-22',
      },
    ], 'aggregate counted cited journals');
    const second = hostResponse('GROUNDED', '后续动作是安排无人机样机讨论。', [
      {
        id: '2026/03/life-index_2026-03-05_001',
        rel_path: 'Journals/2026/03/life-index_2026-03-05_001.md',
        title: 'SkyVision follow-up',
        date: '2026-03-05',
      },
    ], 'cited evidence was read earlier in this conversation');
    mockHostStreamReturn.turns = [
      completedTurn('turn-1', '今年 SkyVision Africa 有几篇？', first),
      completedTurn('turn-2', '那后续做了什么？', second),
    ];
    mockHostStreamReturn.status = 'complete';
    mockHostStreamReturn.finalResponse = second;

    render(
      <MemoryRouter>
        <Recall />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('tab-agent'));

    const userTurns = screen.getAllByTestId('agent-turn-user');
    const agentTurns = screen.getAllByTestId('agent-turn-agent');
    expect(userTurns).toHaveLength(2);
    expect(agentTurns).toHaveLength(2);
    expect(userTurns[0]).toHaveTextContent('今年 SkyVision Africa 有几篇？');
    expect(userTurns[1]).toHaveTextContent('那后续做了什么？');
    expect(within(agentTurns[0]).getByTestId('host-agent-mode-badge')).toHaveTextContent('GROUNDED');
    expect(within(agentTurns[0]).getByTestId('host-agent-reason')).toHaveTextContent('aggregate counted cited journals');
    expect(within(agentTurns[1]).getByTestId('host-agent-reason')).toHaveTextContent(
      'cited evidence was read earlier in this conversation',
    );
    expect(screen.getByRole('link', { name: 'SkyVision 无人机项目周会' })).toHaveAttribute(
      'href',
      '/journal/2026/02/life-index_2026-02-22_002',
    );
  });

  it('folds completed thinking and wires related continuation queries back to Host Agent stream', () => {
    mockHostHealthReturn.data = readyHealth;
    const finalResponse = hostResponse('GROUNDED', '关于您的这个问题，建议继续追踪报价模型。', [
      {
        id: '2026/02/life-index_2026-02-22_002',
        rel_path: 'Journals/2026/02/life-index_2026-02-22_002.md',
        title: 'SkyVision 无人机项目周会',
        date: '2026-02-22',
        snippet: '会议讨论了 SkyVision Africa 的报价模型。',
      },
    ], 'journal evidence read');
    finalResponse.answer = {
      ...finalResponse.answer!,
      work_summary: '使用 aggregate 计数，读了 1 篇日志。',
      suggestions: ['继续查报价模型后续'],
    };
    mockHostStreamReturn.turns = [
      {
        ...completedTurn('turn-1', '今年 SkyVision Africa 有几篇？', finalResponse),
        deltaText: 'discover: 分类为 count\nnavigate: 读取日志证据\n',
      },
    ];

    render(
      <MemoryRouter>
        <Recall />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('tab-agent'));

    const thinking = screen.getByTestId('host-agent-thinking-collapsible');
    expect(thinking).toHaveClass('host-agent-thinking-collapsible');
    expect(screen.getByTestId('agent-query-results')).toHaveClass('host-agent-result-enter');
    expect(thinking).toHaveTextContent('Thinking process');
    expect(thinking).toHaveTextContent('discover: 分类为 count');
    expect(screen.getByTestId('host-agent-work-summary')).toHaveTextContent('使用 aggregate 计数');

    fireEvent.click(screen.getByRole('button', { name: '继续查报价模型后续' }));

    expect(mockHostStreamReturn.start).toHaveBeenCalledWith('继续查报价模型后续');
  });

  it('does not present transport status trace as completed reasoning', () => {
    mockHostHealthReturn.data = readyHealth;
    const finalResponse = hostResponse('GROUNDED', '关于您的这个问题，日志已找到。', [
      {
        id: '2026/06/life-index_2026-06-22_003.md',
        rel_path: 'Journals/2026/06/life-index_2026-06-22_003.md',
        title: 'GUI 智能层元数据体验整理与搜索验证',
        date: '2026-06-22',
        excerpt: '今天继续梳理 Life Index GUI 智能层。',
      },
    ]);
    mockHostStreamReturn.turns = [
      {
        ...completedTurn('turn-status-only', '刚刚记录了什么？', finalResponse),
        deltaText: '',
        events: [
          { type: 'status', data: { phase: 'calling_host_agent', message: 'Calling configured host agent runtime.' } },
          { type: 'final', data: finalResponse },
        ],
      },
    ];

    render(
      <MemoryRouter>
        <Recall />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('tab-agent'));

    const thinking = screen.getByTestId('host-agent-thinking-collapsible');
    expect(thinking).toHaveTextContent('Thinking process');
    expect(thinking).toHaveTextContent('Host Agent did not provide displayable reasoning');
    expect(thinking).not.toHaveTextContent('Calling configured host agent runtime.');
  });

  it('renders UNGROUNDED answers with text and reason instead of hiding the answer', () => {
    mockHostHealthReturn.data = readyHealth;
    mockHostStreamReturn.status = 'complete';
    mockHostStreamReturn.finalResponse = hostResponse(
      'UNGROUNDED',
      '宿主 agent 给出了答案，但不能标成 grounded。',
      [],
      'citation not read in this conversation',
    );

    render(
      <MemoryRouter>
        <Recall />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('tab-agent'));
    expect(screen.getByTestId('host-agent-answer')).toHaveTextContent('宿主 agent 给出了答案');
    expect(screen.getByTestId('host-agent-mode-badge')).toHaveTextContent('UNGROUNDED');
    expect(screen.getByTestId('host-agent-reason')).toHaveTextContent('citation not read in this conversation');
    expect(screen.getByTestId('host-agent-evidence-empty')).toHaveTextContent('No cited evidence');
  });

  it('keeps the AI+ query input above the conversation results', () => {
    mockHostHealthReturn.data = readyHealth;
    mockHostStreamReturn.turns = [
      completedTurn('turn-1', '最近晚睡趋势怎么样？', hostResponse('PARTIAL', '证据不足以判断趋势。')),
    ];

    render(
      <MemoryRouter>
        <Recall />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('tab-agent'));
    const thread = screen.getByTestId('agent-conversation-thread');
    const form = screen.getByTestId('agent-follow-up-form');
    expect(form.compareDocumentPosition(thread) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the AI+ query form constrained to the recall content width', () => {
    mockHostHealthReturn.data = readyHealth;

    render(
      <MemoryRouter>
        <Recall />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('tab-agent'));

    const form = screen.getByTestId('agent-follow-up-form');
    expect(form).toHaveClass('li-workbench');
    expect(form).toHaveClass('recall-query-workbench');
  });

  it('keeps English mobile search controls shrinkable inside the query cards', () => {
    mockHostHealthReturn.data = readyHealth;

    render(
      <MemoryRouter>
        <Recall />
      </MemoryRouter>,
    );

    const keywordForm = screen.getByTestId('keyword-query-form');
    const keywordCard = keywordForm.querySelector('.search-input-card');
    const keywordInput = screen.getByLabelText('Search keywords...');
    const keywordButton = screen.getByRole('button', { name: 'Search' });

    expect(keywordCard).toHaveClass('min-w-0');
    expect(keywordInput).toHaveClass('min-w-0');
    expect(keywordButton).toHaveClass('px-3');
    expect(keywordButton).toHaveClass('sm:px-5');
    expect(keywordButton).toHaveClass('whitespace-nowrap');

    fireEvent.click(screen.getByTestId('tab-agent'));

    const agentForm = screen.getByTestId('agent-follow-up-form');
    const agentCard = agentForm.querySelector('.search-input-card');
    const agentInput = screen.getByTestId('agent-query-input');
    const agentButton = screen.getByTestId('agent-submit');

    expect(agentCard).toHaveClass('min-w-0');
    expect(agentInput).toHaveClass('min-w-0');
    expect(agentButton).toHaveClass('px-3');
    expect(agentButton).toHaveClass('sm:px-5');
    expect(agentButton).toHaveClass('whitespace-nowrap');
  });

  it('pins the recall controls while the results pane owns hidden scrolling', () => {
    mockHostHealthReturn.data = readyHealth;
    mockHostStreamReturn.turns = [
      completedTurn('turn-1', '最近晚睡趋势怎么样？', hostResponse('PARTIAL', '证据不足以判断趋势。')),
    ];

    render(
      <MemoryRouter>
        <Recall />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('tab-agent'));
    expect(screen.getByTestId('recall-fixed-controls')).toHaveClass('recall-fixed-controls');
    expect(screen.getByTestId('recall-scroll-pane')).toHaveClass('recall-scroll-pane');
    expect(screen.getByTestId('agent-follow-up-form')).toHaveClass('recall-query-workbench');
    expect(screen.getByTestId('agent-conversation-thread')).toBeInTheDocument();
  });

  it('follows live Host Agent progress inside the recall scroll pane', async () => {
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    const scrollTo = vi.fn();
    mockHostHealthReturn.data = readyHealth;

    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    try {
      render(
        <MemoryRouter>
          <Recall />
        </MemoryRouter>,
      );

      fireEvent.click(screen.getByTestId('tab-agent'));
      fireEvent.change(screen.getByTestId('agent-query-input'), {
        target: { value: '过去几个月我有哪些心事？' },
      });
      fireEvent.click(screen.getByTestId('agent-submit'));

      await waitFor(() => {
        expect(scrollTo).toHaveBeenCalledWith({ top: expect.any(Number), behavior: 'smooth' });
      });
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
        configurable: true,
        value: originalScrollTo,
      });
      vi.stubGlobal('requestAnimationFrame', originalRequestAnimationFrame);
      vi.stubGlobal('cancelAnimationFrame', originalCancelAnimationFrame);
    }
  });

  it('preserves keyword URL query and date filters', () => {
    render(
      <MemoryRouter initialEntries={['/recall?q=foo']}>
        <Recall />
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('Date Options / 日期选项'));
    fireEvent.change(screen.getByLabelText('From / 起始日期'), {
      target: { value: '2026-05-01' },
    });

    const search = screen.getByTestId('location-search').textContent;
    expect(search).toContain('q=foo');
    expect(search).toContain('start=2026-05-01');
  });

  it('sorts keyword results by date descending and keeps journal links', () => {
    mockJournalSearchReturn.data = {
      results: [
        { id: 'older', title: 'Older', excerpt: 'o', date: '2026-05-01', topics: [], moods: [] },
        { id: 'newer', title: 'Newer', excerpt: 'n', date: '2026-05-03', topics: [], moods: [] },
      ],
      total: 2,
    };

    render(
      <MemoryRouter initialEntries={['/recall?q=test']}>
        <Recall />
      </MemoryRouter>,
    );

    const results = screen.getByTestId('keyword-results');
    const cards = results.querySelectorAll('a');
    expect(cards[0]).toHaveAttribute('href', '/journal/newer');
    expect(cards[1]).toHaveAttribute('href', '/journal/older');
  });

  it('shows entity graph attribution for keyword search alias and relation expansions', () => {
    mockJournalSearchReturn.data = {
      results: [
        { id: 'result', title: 'Entity Result', excerpt: 'e', date: '2026-05-01', topics: [], moods: [] },
      ],
      total: 1,
      entityExpansion: {
        applied: true,
        expansions: [
          { from: 'Ally', to: ['Alice'], via: 'alias', entity_id: 'actor-alice', primary_name: 'Alice' },
          { from: '女儿', to: ['Alice', 'Ally'], via: 'relation', entity_id: 'actor-alice', primary_name: 'Alice' },
          { from: 'field-note', to: ['Alice'], via: 'unknown', entity_id: 'actor-alice', primary_name: 'Alice' },
          { from: 'self', to: ['Alice'], via: 'self', entity_id: 'actor-alice', primary_name: 'Alice' },
        ],
      },
    };

    render(
      <MemoryRouter initialEntries={['/recall?q=Ally']}>
        <Recall />
      </MemoryRouter>,
    );

    const strip = screen.getByTestId('entity-expansion-strip');
    expect(strip).toHaveTextContent('Entity graph expansion');
    expect(strip).toHaveTextContent('Alias: Ally -> Alice');
    expect(strip).toHaveTextContent('Relation: 女儿 -> Alice, Ally');
    expect(strip).toHaveTextContent('+1 more');
    expect(screen.getAllByRole('link', { name: /Alice/ })[0]).toHaveAttribute(
      'href',
      '/entities/actor-alice',
    );
  });

  it('does not show entity graph attribution when keyword search has no expansion', () => {
    mockJournalSearchReturn.data = {
      results: [
        { id: 'result', title: 'Plain Result', excerpt: 'e', date: '2026-05-01', topics: [], moods: [] },
      ],
      total: 1,
    };

    render(
      <MemoryRouter initialEntries={['/recall?q=plain']}>
        <Recall />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('entity-expansion-strip')).not.toBeInTheDocument();
  });

  it('does not render legacy gateway or Agent Bridge user-facing language', () => {
    mockHostHealthReturn.data = readyHealth;
    mockHostStreamReturn.finalResponse = hostResponse('GROUNDED', '这是宿主 agent 的答案。');
    mockHostStreamReturn.status = 'complete';

    const { container } = render(
      <MemoryRouter>
        <Recall />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('tab-agent'));
    const html = container.innerHTML.toLowerCase();
    expect(html).not.toContain('gateway');
    expect(html).not.toContain('agent bridge');
    expect(html).not.toContain('llm');
    expect(html).not.toContain('api key');
  });
});
