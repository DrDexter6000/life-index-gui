import { z, ZodError } from 'zod';
import {
  APIResponseSchema,
  JournalSummarySchema,
  JournalDetailSchema,
  DashboardStatsSchema,
  TopicDistributionSchema,
  MoodFrequencySchema,
  HeatmapDaySchema,
  RawSearchResponseSchema,
  HealthCheckSchema,
  DataAuditSchema,
  IndexCheckSchema,
  VerifyDiagnosticsSchema,
  CacheDryRunSchema,
  IndexTreeNodesResponseSchema,
  IndexTreeLensResponseSchema,
  IndexTreeShadowResponseSchema,
  AgentBridgeProbeResponseSchema,
  AgentBridgeGatewayHealthResponseSchema,
  AgentBridgeQueryResponseSchema,
  AgentBridgeStreamEventSchema,
  HostAgentHealthResponseSchema,
  HostAgentQueryResponseSchema,
  HostAgentMetadataProposalSchema,
  HostAgentStreamEventSchema,
  EntityStatsSchema,
  EntityItemSchema,
  EntityCheckSchema,
  EntityAuditSchema,
  EntityReviewSchema,
  EntityCandidateEdgesSchema,
  EntityMutationPreviewSchema,
  EntityMutationConfirmSchema,
  ImportPlanResponseSchema,
  ImportRunResponseSchema,
  ImportStatusResponseSchema,
  ImportRollbackResponseSchema,
  MaintenanceAuditResponseSchema,
  MaintenancePlanResponseSchema,
  MaintenanceRepairResponseSchema,
} from '@/lib/schemas';

const API_BASE_URL = '/api';

export interface APIError {
  message: string;
  code: string;
  status: number;
}

export class APIClientError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;

  constructor(message: string, code: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'APIClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Parse data with a Zod schema, mapping validation errors to friendly APIClientError. */
function parseData<T>(schema: z.ZodType<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      if (import.meta.env.DEV) {
        console.error('Schema validation failed:', issues);
      }
      throw new APIClientError(
        '遇到了一点小插曲，请稍后再试',
        'SCHEMA_ERROR',
        500,
      );
    }
    throw err;
  }
}

function parseSseFrame<T>(frame: string, schema: z.ZodType<T>): T | null {
  if (!frame.trim()) return null;

  const lines = frame.split('\n');
  let eventType = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7);
    } else if (line.startsWith('event:')) {
      eventType = line.slice(6);
    } else if (line.startsWith('data: ')) {
      dataLines.push(line.slice(6));
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5));
    }
  }
  if (dataLines.length === 0) return null;

  const parsedData = JSON.parse(dataLines.join('\n'));
  return parseData(schema, {
    type: eventType,
    data: parsedData,
  });
}

async function* parseSseStream<T>(response: Response, schema: z.ZodType<T>): AsyncGenerator<T> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const drainFrames = (flush = false): string[] => {
    buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const parts = buffer.split('\n\n');
    if (flush) {
      buffer = '';
      return parts;
    }
    buffer = parts.pop() ?? '';
    return parts;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (const frame of drainFrames()) {
      const event = parseSseFrame(frame, schema);
      if (event) yield event;
    }
  }

  buffer += decoder.decode();
  for (const frame of drainFrames(true)) {
    const event = parseSseFrame(frame, schema);
    if (event) yield event;
  }
}

/** Unwrap the backend envelope, validating shape and throwing on errors. */
async function unwrap(response: Response): Promise<unknown> {
  if (!response.ok) {
    // A response with a status code means the network worked and the server
    // replied with an error. Recover the structured error envelope so the
    // real backend code/message survives instead of being mislabeled as a
    // network failure. (Genuine network failures reject `fetch` and never
    // reach here.)
    const errorBody = await response.json().catch(() => null);
    const parsedError = errorBody ? APIResponseSchema.safeParse(errorBody) : null;
    if (parsedError?.success && parsedError.data.error) {
      throw new APIClientError(
        parsedError.data.error.message ?? 'Unknown error',
        parsedError.data.error.code ?? 'UNKNOWN_ERROR',
        response.status,
        parsedError.data.error.details as Record<string, unknown> | undefined,
      );
    }
    throw new APIClientError(
      `HTTP ${response.status}: ${response.statusText}`,
      'SERVER_ERROR',
      response.status,
    );
  }

  const body = await response.json();
  const parsed = APIResponseSchema.safeParse(body);
  if (!parsed.success) {
    if (import.meta.env.DEV) {
      console.error('Malformed API response envelope:', parsed.error.issues);
    }
    throw new APIClientError(
      '遇到了一点小插曲，请稍后再试',
      'MALFORMED_RESPONSE',
      response.status,
    );
  }

  const envelope = parsed.data;

  if (!envelope.ok || envelope.error) {
    throw new APIClientError(
      envelope.error?.message ?? 'Unknown error',
      envelope.error?.code ?? 'UNKNOWN_ERROR',
      response.status,
      envelope.error?.details as Record<string, unknown> | undefined,
    );
  }

  return envelope.data;
}

export const apiClient = {
  async get(path: string, options?: RequestInit): Promise<unknown> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        ...options?.headers,
      },
      ...options,
    });
    return unwrap(response);
  },

  async post(path: string, body: unknown, options?: RequestInit): Promise<unknown> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options?.headers,
      },
      body: JSON.stringify(body),
      ...options,
    });
    return unwrap(response);
  },

  async put(path: string, body: unknown, options?: RequestInit): Promise<unknown> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options?.headers,
      },
      body: JSON.stringify(body),
      ...options,
    });
    return unwrap(response);
  },

  async delete(path: string, options?: RequestInit): Promise<unknown> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'DELETE',
      headers: {
        'Accept': 'application/json',
        ...options?.headers,
      },
      ...options,
    });
    return unwrap(response);
  },
};

// ── Journal API ────────────────────────────────────────────────────────────

/** Map a validated journal summary to frontend shape (adds excerpt). */
function addExcerpt(summary: z.infer<typeof JournalSummarySchema>): JournalSummary {
  return {
    ...summary,
    excerpt: (summary.abstract ?? summary.title)?.slice(0, 100),
  };
}

export const journalAPI = {
  /** List recent journals */
  getAll: async (limit?: number): Promise<JournalSummary[]> => {
    const raw = await apiClient.get(`/journals${limit ? `?limit=${limit}` : ''}`);
    const list = parseData(z.array(JournalSummarySchema), raw);
    return list.map(addExcerpt);
  },

  /** Get a single journal by ID (e.g. "2026/01/life-index_2026-01-28_001") */
  getById: async (id: string): Promise<JournalDetail> => {
    const raw = await apiClient.get(`/journals/${id}`);
    return parseData(JournalDetailSchema, raw);
  },

  /** Create a new journal entry */
  create: async (data: CreateJournalRequest): Promise<CreateJournalResponse> => {
    const formData = new FormData();
    formData.append('title', data.title);
    formData.append('content', data.content);
    formData.append('date', data.date);
    if (data.location) formData.append('location', data.location);
    if (data.weather) formData.append('weather', data.weather);
    if (data.topic) formData.append('topic', data.topic);
    if (data.mood) formData.append('mood', data.mood);
    if (data.people) formData.append('people', data.people);
    if (data.project) formData.append('project', data.project);
    if (data.abstract) formData.append('abstract', data.abstract);
    if (data.tags) formData.append('tags', data.tags);
    if (data.links) formData.append('links', data.links);
    data.attachments?.forEach((file) => formData.append('files', file));

    const response = await fetch(`${API_BASE_URL}/journals`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData,
    });
    const raw = await unwrap(response);
    return parseData(CreateJournalResponseSchema, raw);
  },

  /** Edit an existing journal entry */
  update: async (id: string, data: UpdateJournalRequest): Promise<Record<string, string>> => {
    const raw = await apiClient.put(`/journals/${id}`, data);
    return parseData(z.record(z.string(), z.string()), raw);
  },

  /** Search journals */
  search: async (params: SearchParams): Promise<SearchResponse> => {
    const raw = await apiClient.post('/search', params);
    const envelope = parseData(RawSearchResponseSchema, raw);
    const rawResults =
      envelope.results ?? envelope.l2_results ?? envelope.l1_results ?? [];
    const results = rawResults.map((item) =>
      addExcerpt(parseData(JournalSummarySchema, item)),
    );
    return {
      results,
      total: envelope.total ?? envelope.total_found ?? results.length,
      page: 1,
      perPage: results.length,
      meta: envelope.meta,
    };
  },

  /** Smart-search via CLI deterministic scaffold/evidence */
  smartSearch: async (params: SmartSearchParams): Promise<SmartSearchResult> => {
    const raw = await apiClient.post('/smart-search', params);
    const data = parseData(
      z.object({
        scaffold: z.array(z.record(z.string(), z.unknown())).default([]),
        evidence: z.array(z.record(z.string(), z.unknown())).default([]),
        provenance: z.string().default('deterministic'),
        meta: z.record(z.string(), z.unknown()).optional(),
      }),
      raw,
    );
    const evidence = data.evidence.map((item) =>
      addExcerpt(parseData(JournalSummarySchema, item)),
    );
    return {
      scaffold: data.scaffold,
      evidence,
      provenance: data.provenance,
      meta: data.meta,
    };
  },
};

// ── Dashboard API ──────────────────────────────────────────────────────────

export const dashboardAPI = {
  getStats: async (): Promise<DashboardStats> => {
    const raw = await apiClient.get('/stats');
    return parseData(DashboardStatsSchema, raw);
  },

  getRecent: async (limit?: number): Promise<JournalSummary[]> => {
    const raw = await apiClient.get(`/journals${limit ? `?limit=${limit}` : ''}`);
    const list = parseData(z.array(JournalSummarySchema), raw);
    return list.map(addExcerpt);
  },

  getTopics: async (): Promise<TopicDistribution[]> => {
    const raw = await apiClient.get('/topics');
    return parseData(z.array(TopicDistributionSchema), raw);
  },

  getGeocode: async (lat: number, lng: number): Promise<string> => {
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
    });
    const raw = await apiClient.get(`/geocode?${params.toString()}`);
    return parseData(z.string(), raw);
  },

  getWeather: async (location: string, date?: string): Promise<string> => {
    const params = new URLSearchParams({ location });
    if (date) params.set('date', date);
    const raw = await apiClient.get(`/weather?${params.toString()}`);
    return parseData(z.string(), raw);
  },

  getHeatmap: async (year?: number, month?: number) => {
    const params = new URLSearchParams();
    if (year) params.set('year', String(year));
    if (month) params.set('month', String(month));
    const qs = params.toString();
    const raw = await apiClient.get(`/heatmap${qs ? `?${qs}` : ''}`);
    return parseData(z.array(HeatmapDaySchema), raw);
  },

  getMoods: async (): Promise<MoodFrequency[]> => {
    const raw = await apiClient.get('/moods');
    return parseData(z.array(MoodFrequencySchema), raw);
  },
};

// ── Types ─────────────────────────────────────────────────────────────────

export interface JournalSummary {
  id: string;
  title: string;
  date: string;
  abstract: string | null;
  /** Display excerpt — derived from abstract or title */
  excerpt?: string;
  topics: string[];
  moods: string[];
  people: string[];
  tags: string[];
  location: string | null;
  project: string | null;
}

export interface JournalDetail {
  id: string;
  title: string;
  date: string;
  content: string;
  abstract: string | null;
  topics: string[];
  moods: string[];
  people: string[];
  location: string | null;
  weather: string | null;
  project: string | null;
  links: string[];
  wordCount: number;
  attachments: JournalAttachment[];
}

export interface JournalAttachment {
  relPath: string;
  filename: string;
  contentType: string;
  sizeBytes: number | null;
}

export interface CreateJournalRequest {
  title: string;
  content: string;
  date: string;
  location?: string;
  weather?: string;
  topic?: string;
  mood?: string;
  people?: string;
  project?: string;
  abstract?: string;
  tags?: string;
  links?: string;
  attachments?: File[];
}

export const CreateJournalResponseSchema = z.object({
  id: z.string().optional(),
  raw: z.string().optional(),
  journalPath: z.string().optional(),
  needsConfirmation: z.boolean().optional(),
  confirmation: z
    .object({
      message: z.string().optional(),
      choices: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(),
}).passthrough();

export type CreateJournalResponse = z.infer<typeof CreateJournalResponseSchema>;

export interface UpdateJournalRequest {
  title?: string;
  contentAppend?: string;
  contentReplace?: string;
  location?: string;
  weather?: string;
  topic?: string;
  mood?: string;
  people?: string;
  project?: string;
  abstract?: string;
  tags?: string;
  links?: string;
}

export interface SearchParams {
  query?: string;
  topics?: string[];
  moods?: string[];
  people?: string[];
  dateStart?: string;
  dateEnd?: string;
  level?: number;
  limit?: number;
  noSemantic?: boolean;
}

export interface SearchResponse {
  results: JournalSummary[];
  total: number;
  page: number;
  perPage: number;
  meta?: Record<string, unknown>;
}

export interface SmartSearchResult {
  scaffold: Array<{ step?: string; description?: string }>;
  evidence: JournalSummary[];
  provenance: string;
  meta?: Record<string, unknown>;
}

export interface SmartSearchParams {
  query: string;
}

export interface DashboardStats {
  totalJournals: number;
  totalWords: number;
  activeDays: number;
  streakDays: number;
  avgWordsPerDay: number;
}

export interface TopicDistribution {
  name: string;
  count: number;
  color: string;
}

export interface MoodFrequency {
  name: string;
  count: number;
}

export interface HeatmapDay {
  date: string;
  count: number;
  level: number;
}

// ── Health API ────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: string;
  cli_available: boolean;
  compatible: boolean;
  package_version?: string | null;
  repo_version?: string | null;
  health?: {
    status?: string;
    [key: string]: unknown;
  } | null | undefined;
  error?: Record<string, unknown> | null;
}

export interface DataAuditResponse {
  success: boolean;
  schema_version?: string;
  data?: {
    file_count?: number;
    anomalies?: Array<Record<string, unknown>>;
    distribution?: Record<string, unknown>;
    [key: string]: unknown;
  } | null;
  error?: string;
}

export interface IndexCheckResponse {
  healthy?: boolean;
  success?: boolean;
  fts_count?: number;
  vector_count?: number;
  file_count?: number;
  manifest?: Record<string, unknown>;
  freshness?: Record<string, unknown>;
  issues?: Array<string | Record<string, unknown>>;
  error?: string;
}

export interface VerifyDiagnosticsResponse {
  success?: boolean;
  total_journals?: number;
  checks?: Array<Record<string, unknown>>;
  issues_count?: number;
  suggestion?: string;
  issues?: Array<string | Record<string, unknown>>;
  error?: string;
}

export interface CacheDryRunResponse {
  success?: boolean;
  dry_run?: boolean;
  cache_version?: {
    would_rebuild?: boolean;
    reasons?: string[];
    [key: string]: unknown;
  };
  error?: string;
}

// ── Index Tree types (M4 — read-only evidence navigation) ────────────────

export type IndexTreeLevel = 'all' | 'root' | 'year' | 'month';
export type IndexTreeSignal = 'topic' | 'people' | 'project';
export type IndexTreeNodesResponse = z.infer<typeof IndexTreeNodesResponseSchema>;
export type IndexTreeLensResponse = z.infer<typeof IndexTreeLensResponseSchema>;
export type IndexTreeShadowResponse = z.infer<typeof IndexTreeShadowResponseSchema>;
export type AgentBridgeProbeResponse = z.infer<typeof AgentBridgeProbeResponseSchema>;
export type AgentBridgeGatewayHealthResponse = z.infer<typeof AgentBridgeGatewayHealthResponseSchema>;
export type AgentBridgeQueryResponse = z.infer<typeof AgentBridgeQueryResponseSchema>;
export type AgentBridgeStreamEvent = z.infer<typeof AgentBridgeStreamEventSchema>;
export type HostAgentHealthResponse = z.infer<typeof HostAgentHealthResponseSchema>;
export type HostAgentQueryResponse = z.infer<typeof HostAgentQueryResponseSchema>;
export type HostAgentMetadataProposal = z.infer<typeof HostAgentMetadataProposalSchema>;
export type HostAgentStreamEvent = z.infer<typeof HostAgentStreamEventSchema>;

export interface HostAgentMetadataProposalRequest {
  request_id?: string;
  draft: {
    title: string;
    content: string;
    date: string;
    existing_metadata: Record<string, unknown>;
  };
  policy: {
    preserve_user_fields: boolean;
  };
}

/** Rich answer mode for Agent Bridge query responses. Future verifier modes must remain renderable. */
export type AgentBridgeMode = 'GROUNDED' | 'PARTIAL' | 'UNGROUNDED' | (string & {});

/** Evidence item referenced by Agent Bridge answer. */
export interface AgentBridgeEvidenceItem {
  id: string;
  rel_path: string;
  title: string;
  date: string;
  snippet?: string;
  excerpt?: string;
  metadata?: {
    location?: string;
    topic?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Insight within an Agent Bridge answer, grounded in evidence refs. */
export interface AgentBridgeInsight {
  theme: string;
  quote?: string;
  date?: string;
  interpretation?: string;
  evidence_refs: string[];
  [key: string]: unknown;
}

/** Structured answer within Agent Bridge rich query response. */
export interface AgentBridgeAnswer {
  mode: AgentBridgeMode;
  summary?: string;
  reason?: string | null;
  insights: AgentBridgeInsight[];
  related_findings: unknown[];
  gap: string | null;
  explanation: string | null;
  what_was_found: unknown[];
  suggestions: string[];
  [key: string]: unknown;
}

// ── Entity types (S4 — Entity Graph Inspection) ──────────────────────────

export interface EntityStats {
  total_entities: number;
  total_relationships: number;
  [key: string]: unknown;
}

export interface EntityItem {
  id: string;
  type: string;
  primary_name: string;
  aliases: string[];
  attributes: Record<string, unknown>;
  relationships: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface EntityCheckResponse {
  issues: Array<string | Record<string, unknown>>;
  total_entities?: number;
  [key: string]: unknown;
}

export interface EntityAuditResponse {
  issues: Array<string | Record<string, unknown>>;
  summary: Record<string, number>;
  [key: string]: unknown;
}

export interface EntityReviewResponse {
  queue: Array<Record<string, unknown>>;
  total: number;
  [key: string]: unknown;
}

export interface CandidateEdgesResponse {
  candidates: Array<Record<string, unknown>>;
  total: number;
  schemaVersion?: string;
  provenance?: unknown;
}

export type EntityRecord = Record<string, unknown>;
export type EntityStatsResponse = EntityStats;
export type EntityListResponse =
  | EntityItem[]
  | { entities?: EntityItem[]; items?: EntityItem[]; [key: string]: unknown };
export type EntityCandidateEdgesResponse = CandidateEdgesResponse;

// ── Entity mutation types (S5 — Guarded Entity Mutation UX) ───────────────

export interface EntityMutationRequest {
  operation: 'delete' | 'merge_as_alias';
  entityId?: string;
  sourceId?: string;
  targetId?: string;
}

export interface EntityMutationPreviewResponse {
  operation: string;
  preview: Record<string, unknown>;
  requiresConfirmation: boolean;
  schemaVersion?: string;
  provenance?: unknown;
}

export interface EntityMutationConfirmResponse {
  operation: string;
  mutation: Record<string, unknown>;
  postCheck: unknown;
  postCheckOk: boolean;
  schemaVersion?: string;
  provenance?: unknown;
}

// ── Health API ────────────────────────────────────────────────────────────

export const healthAPI = {
  /** Fetch CLI health status for degraded-state diagnostics */
  getHealth: async (options?: RequestInit): Promise<HealthResponse> => {
    const raw = await apiClient.get('/health', options);
    return parseData(HealthCheckSchema, raw);
  },

  /** Fetch CLI data-audit diagnostics for data cleanliness report */
  getDataAudit: async (): Promise<DataAuditResponse> => {
    const raw = await apiClient.get('/health/data-audit');
    return parseData(DataAuditSchema, raw);
  },
};

export const indexDiagnosticsAPI = {
  /** Fetch CLI index --check --json diagnostics */
  getIndexCheck: async (): Promise<IndexCheckResponse> => {
    const raw = await apiClient.get('/index/check');
    return parseData(IndexCheckSchema, raw);
  },

  /** Fetch CLI verify --json integrity diagnostics */
  getVerify: async (): Promise<VerifyDiagnosticsResponse> => {
    const raw = await apiClient.get('/index/verify');
    return parseData(VerifyDiagnosticsSchema, raw);
  },

  /** Fetch CLI index --cache-dry-run cache metadata diagnostics */
  getCacheDryRun: async (): Promise<CacheDryRunResponse> => {
    const raw = await apiClient.get('/index/cache-dry-run');
    return parseData(CacheDryRunSchema, raw);
  },
};

export const indexTreeAPI = {
  /** Fetch read-only Index Tree nodes through the backend CLI envelope wrapper */
  getNodes: async (level: IndexTreeLevel = 'all'): Promise<IndexTreeNodesResponse> => {
    const raw = await apiClient.get(`/index-tree/nodes?level=${encodeURIComponent(level)}`);
    return parseData(IndexTreeNodesResponseSchema, raw);
  },

  /** Fetch read-only Index Tree lens values for evidence navigation */
  getLens: async (signal: IndexTreeSignal): Promise<IndexTreeLensResponse> => {
    const raw = await apiClient.get(`/index-tree/lens?signal=${encodeURIComponent(signal)}`);
    return parseData(IndexTreeLensResponseSchema, raw);
  },

  /** Fetch shadow diagnostics only; this must not feed default search ranking */
  getShadow: async (query: string): Promise<IndexTreeShadowResponse> => {
    const raw = await apiClient.get(`/index-tree/shadow?query=${encodeURIComponent(query)}`);
    return parseData(IndexTreeShadowResponseSchema, raw);
  },
};

export const agentBridgeAPI = {
  /** Fetch safe Agent Bridge operator readiness. Probe sends no journal evidence. */
  getProbe: async (): Promise<AgentBridgeProbeResponse> => {
    const raw = await apiClient.get('/agent-bridge/probe');
    return parseData(AgentBridgeProbeResponseSchema, raw);
  },

  /** Fetch backend-mediated warm gateway liveness. Browser never calls gateway directly. */
  getHealth: async (): Promise<AgentBridgeGatewayHealthResponse> => {
    const raw = await apiClient.get('/agent-bridge/health');
    return parseData(AgentBridgeGatewayHealthResponseSchema, raw);
  },

  /** Trigger explicit host-agent handoff through CLI/L3, never direct endpoint calls. */
  query: async (query: string): Promise<AgentBridgeQueryResponse> => {
    const raw = await apiClient.post('/agent-bridge/query', {
      query: query.trim(),
    });
    return parseData(AgentBridgeQueryResponseSchema, raw);
  },

  /** Stream an Agent Bridge query over SSE and yield validated contract events. */
  stream: async function* (
    query: string,
    options?: { signal?: AbortSignal; conversationId?: string },
  ): AsyncGenerator<AgentBridgeStreamEvent> {
    const body: { query: string; conversation_id?: string } = {
      query: query.trim(),
    };
    if (options?.conversationId) {
      body.conversation_id = options.conversationId;
    }

    const response = await fetch(`${API_BASE_URL}/agent-bridge/query/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok || !response.body) {
      throw new APIClientError(
        `HTTP ${response.status}: ${response.statusText}`,
        'SERVER_ERROR',
        response.status,
      );
    }

    for await (const event of parseSseStream(response, AgentBridgeStreamEventSchema)) {
      if (event.type === 'error') {
        const errorData = event.data as
          | { code?: string; message?: string }
          | { error?: { code?: string; message?: string } };
        const code =
          ('error' in errorData && errorData.error?.code)
          || ('code' in errorData && errorData.code)
          || 'AGENT_GATEWAY_ERROR';
        const message =
          ('error' in errorData && errorData.error?.message)
          || ('message' in errorData && errorData.message)
          || 'Agent gateway error';
        throw new APIClientError(String(message), String(code), 200);
      }

      yield event;
    }
  },
};

export const hostAgentAPI = {
  /** Fetch runtime-neutral host-agent handoff health. */
  getHealth: async (): Promise<HostAgentHealthResponse> => {
    const raw = await apiClient.get('/host-agent/health');
    return parseData(HostAgentHealthResponseSchema, raw);
  },

  /** Request host-agent metadata proposals; GUI applies nothing automatically. */
  proposeMetadata: async (
    request: HostAgentMetadataProposalRequest,
  ): Promise<HostAgentMetadataProposal> => {
    const raw = await apiClient.post('/host-agent/metadata/propose', request);
    return parseData(HostAgentMetadataProposalSchema, raw);
  },

  /** Stream a host-agent query over the backend-mediated handoff interface. */
  stream: async function* (
    query: string,
    options?: { signal?: AbortSignal; conversationId?: string },
  ): AsyncGenerator<HostAgentStreamEvent> {
    const body: { query: string; conversation_id?: string } = {
      query: query.trim(),
    };
    if (options?.conversationId) {
      body.conversation_id = options.conversationId;
    }

    const response = await fetch(`${API_BASE_URL}/host-agent/query/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok || !response.body) {
      throw new APIClientError(
        `HTTP ${response.status}: ${response.statusText}`,
        'SERVER_ERROR',
        response.status,
      );
    }

    for await (const event of parseSseStream(response, HostAgentStreamEventSchema)) {
      if (event.type === 'error') {
        const errorData = event.data as
          | { code?: string; message?: string }
          | { error?: { code?: string; message?: string } };
        const code =
          ('error' in errorData && errorData.error?.code)
          || ('code' in errorData && errorData.code)
          || 'HOST_AGENT_ERROR';
        const message =
          ('error' in errorData && errorData.error?.message)
          || ('message' in errorData && errorData.message)
          || 'Host agent error';
        throw new APIClientError(String(message), String(code), 200);
      }

      yield event;
    }
  },
};

export const entityAPI = {
  /** Fetch entity graph statistics (total_entities, total_relationships) */
  getStats: async (): Promise<EntityStats> => {
    const raw = await apiClient.get('/entities/stats');
    return parseData(EntityStatsSchema, raw);
  },

  /** List entities, optionally filtered by type */
  listEntities: async (type?: string): Promise<EntityItem[]> => {
    const qs = type ? `?type=${encodeURIComponent(type)}` : '';
    const raw = await apiClient.get(`/entities${qs}`);
    return parseData(z.array(EntityItemSchema), raw);
  },

  /** Fetch entity graph integrity check results */
  getCheck: async (): Promise<EntityCheckResponse> => {
    const raw = await apiClient.get('/entities/check');
    return parseData(EntityCheckSchema, raw);
  },

  /** Fetch entity quality audit findings */
  getAudit: async (): Promise<EntityAuditResponse> => {
    const raw = await apiClient.get('/entities/audit');
    return parseData(EntityAuditSchema, raw);
  },

  /** Fetch entity review/curation queue */
  getReview: async (): Promise<EntityReviewResponse> => {
    const raw = await apiClient.get('/entities/review');
    return parseData(EntityReviewSchema, raw);
  },

  /** Fetch capped candidate relationship edges */
  getCandidateEdges: async (limit?: number): Promise<CandidateEdgesResponse> => {
    const qs = limit ? `?limit=${limit}` : '';
    const raw = await apiClient.get(`/entities/candidate-edges${qs}`);
    return parseData(EntityCandidateEdgesSchema, raw);
  },
};

export const entityMaintenanceAPI = {
  getStats: entityAPI.getStats,
  getList: entityAPI.listEntities,
  getCheck: entityAPI.getCheck,
  getAudit: entityAPI.getAudit,
  getReview: entityAPI.getReview,
  getCandidateEdges: entityAPI.getCandidateEdges,

  /** Preview a supported entity mutation (delete or merge_as_alias) without modifying the graph. */
  previewMutation: async (req: EntityMutationRequest): Promise<EntityMutationPreviewResponse> => {
    const raw = await apiClient.post('/entities/mutations/preview', {
      operation: req.operation,
      entityId: req.entityId,
      sourceId: req.sourceId,
      targetId: req.targetId,
    });
    return parseData(EntityMutationPreviewSchema, raw);
  },

  /** Confirm a previewed entity mutation, executing it through serialized CLI and running post-check. */
  confirmMutation: async (req: EntityMutationRequest): Promise<EntityMutationConfirmResponse> => {
    const raw = await apiClient.post('/entities/mutations/confirm', {
      operation: req.operation,
      entityId: req.entityId,
      sourceId: req.sourceId,
      targetId: req.targetId,
      previewAccepted: true,
    });
    return parseData(EntityMutationConfirmSchema, raw);
  },
};

// ── Import API (M3 — Tranche A fixture import) ────────────────────────────

export interface ImportPlanRequest {
  source: string;
  input_path: string;
}

export const importAPI = {
  /** Plan a fixture import: dry-run preview via POST /api/imports/plan */
  plan: async (req: ImportPlanRequest): Promise<ImportPlanResponse> => {
    const raw = await apiClient.post('/imports/plan', {
      source: req.source,
      input_path: req.input_path,
    });
    return parseData(ImportPlanResponseSchema, raw);
  },

  /** Run a confirmed import: sends only { import_id } via POST /api/imports/run */
  run: async (importId: string): Promise<ImportRunResponse> => {
    const raw = await apiClient.post('/imports/run', { import_id: importId });
    return parseData(ImportRunResponseSchema, raw);
  },

  /** Get import job status via GET /api/imports/{importId}/status */
  getStatus: async (importId: string): Promise<ImportStatusResponse> => {
    const raw = await apiClient.get(`/imports/${importId}/status`);
    return parseData(ImportStatusResponseSchema, raw);
  },

  /** Roll back an import job via POST /api/imports/{importId}/rollback */
  rollback: async (importId: string): Promise<ImportRollbackResponse> => {
    const raw = await apiClient.post(`/imports/${importId}/rollback`, {});
    return parseData(ImportRollbackResponseSchema, raw);
  },
};

export type ImportPlanResponse = z.infer<typeof ImportPlanResponseSchema>;
export type ImportRunResponse = z.infer<typeof ImportRunResponseSchema>;
export type ImportStatusResponse = z.infer<typeof ImportStatusResponseSchema>;
export type ImportRollbackResponse = z.infer<typeof ImportRollbackResponseSchema>;

// ── Maintenance API (M33 — Data Doctor Repair UI) ────────────────────────

export type MaintenanceAuditResponse = z.infer<typeof MaintenanceAuditResponseSchema>;
export type MaintenancePlanResponse = z.infer<typeof MaintenancePlanResponseSchema>;
export type MaintenanceRepairResponse = z.infer<typeof MaintenanceRepairResponseSchema>;

export const maintenanceAPI = {
  /** Fetch CLI maintenance audit diagnostics via GET /api/maintenance/audit */
  getAudit: async (domain?: string): Promise<MaintenanceAuditResponse> => {
    const qs = domain ? `?domain=${encodeURIComponent(domain)}` : '';
    const raw = await apiClient.get(`/maintenance/audit${qs}`);
    return parseData(MaintenanceAuditResponseSchema, raw);
  },

  /** Fetch CLI maintenance plan for a specific issue via GET /api/maintenance/plan?issueId=... */
  getPlan: async (issueId: string): Promise<MaintenancePlanResponse> => {
    const raw = await apiClient.get(`/maintenance/plan?issueId=${encodeURIComponent(issueId)}`);
    return parseData(MaintenancePlanResponseSchema, raw);
  },

  /** Fetch CLI maintenance repair dry-run preview via GET /api/maintenance/repair/dry-run?issueId=... */
  repairDryRun: async (issueId: string): Promise<MaintenanceRepairResponse> => {
    const raw = await apiClient.get(`/maintenance/repair/dry-run?issueId=${encodeURIComponent(issueId)}`);
    return parseData(MaintenanceRepairResponseSchema, raw);
  },

  /** Execute confirmed CLI maintenance repair via POST /api/maintenance/repair/apply */
  repairApply: async (req: { issueId: string; confirmed: true }): Promise<MaintenanceRepairResponse> => {
    const raw = await apiClient.post('/maintenance/repair/apply', {
      issueId: req.issueId,
      confirmed: req.confirmed,
    });
    return parseData(MaintenanceRepairResponseSchema, raw);
  },
};
