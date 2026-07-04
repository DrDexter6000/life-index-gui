import { z } from 'zod';

// ── API envelope ───────────────────────────────────────────────────────────

export const APIErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const APIResponseSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().nullable(),
  error: APIErrorSchema.nullable(),
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
});

// ── Journal schemas ────────────────────────────────────────────────────────

export const JournalSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  date: z.string(),
  abstract: z.string().nullable().default(null),
  topics: z.array(z.string()).default([]),
  moods: z.array(z.string()).default([]),
  people: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  location: z.string().nullable().default(null),
  project: z.string().nullable().default(null),
});

export const JournalDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  date: z.string(),
  content: z.string(),
  abstract: z.string().nullable().default(null),
  topics: z.array(z.string()).default([]),
  moods: z.array(z.string()).default([]),
  people: z.array(z.string()).default([]),
  location: z.string().nullable().default(null),
  weather: z.string().nullable().default(null),
  project: z.string().nullable().default(null),
  links: z.array(z.string()).default([]),
  wordCount: z.number().default(0),
  attachments: z.array(z.object({
    relPath: z.string(),
    filename: z.string(),
    contentType: z.string().default('application/octet-stream'),
    sizeBytes: z.number().nullable().default(null),
  })).default([]),
});

// ── Dashboard schemas ──────────────────────────────────────────────────────

export const DashboardStatsSchema = z.object({
  totalJournals: z.number(),
  totalWords: z.number(),
  activeDays: z.number(),
  streakDays: z.number(),
  avgWordsPerDay: z.number(),
});

export const TopicDistributionSchema = z.object({
  name: z.string(),
  count: z.number(),
  color: z.string().default('#CBD5E1'),
});

export const MoodFrequencySchema = z.object({
  name: z.string(),
  count: z.number(),
});

export const HeatmapDaySchema = z.object({
  date: z.string(),
  count: z.number(),
  level: z.number(),
});

// ── Search schema ──────────────────────────────────────────────────────────

export const RawSearchResponseSchema = z.object({
  results: z.array(z.record(z.string(), z.unknown())).optional(),
  l2_results: z.array(z.record(z.string(), z.unknown())).optional(),
  l1_results: z.array(z.record(z.string(), z.unknown())).optional(),
  total: z.number().optional(),
  total_found: z.number().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

// ── Health schemas (S2 — Health Center) ────────────────────────────────────

export const HealthCheckSchema = z.object({
  status: z.string(),
  cli_available: z.boolean(),
  compatible: z.boolean(),
  package_version: z.string().nullable(),
  repo_version: z.string().nullable(),
  minimum_supported_version: z.string().optional(),
  health: z
    .object({
      status: z.string().optional(),
      checks: z.array(z.record(z.string(), z.unknown())).optional(),
      issues: z.array(z.string()).optional(),
      issue_count: z.number().optional(),
      warnings: z.array(z.string()).optional(),
      journal_count: z.number().optional(),
    })
    .passthrough()
    .nullable(),
  error: z
    .object({
      returncode: z.number(),
      message: z.string(),
    })
    .nullable()
    .optional(),
});

export const DataAuditSchema = z.object({
  success: z.boolean(),
  schema_version: z.string().optional(),
  data: z
    .object({
      file_count: z.number().optional(),
      anomalies: z.array(z.record(z.string(), z.unknown())).optional(),
      distribution: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough()
    .optional()
    .nullable(),
  error: z.string().optional(),
});

// ── Index diagnostics schemas (S3 — read-only maintenance) ────────────────

export const IndexCheckSchema = z
  .object({
    healthy: z.boolean().optional(),
    success: z.boolean().optional(),
    fts_count: z.number().optional(),
    vector_count: z.number().optional(),
    file_count: z.number().optional(),
    manifest: z.record(z.string(), z.unknown()).optional(),
    freshness: z.record(z.string(), z.unknown()).optional(),
    issues: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).optional(),
    error: z.string().optional(),
  })
  .passthrough();

export const VerifyDiagnosticsSchema = z
  .object({
    success: z.boolean().optional(),
    total_journals: z.number().optional(),
    checks: z.array(z.record(z.string(), z.unknown())).optional(),
    issues_count: z.number().optional(),
    suggestion: z.string().optional(),
    issues: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).optional(),
    error: z.string().optional(),
  })
  .passthrough();

export const CacheDryRunSchema = z
  .object({
    success: z.boolean().optional(),
    dry_run: z.boolean().optional(),
    cache_version: z
      .object({
        would_rebuild: z.boolean().optional(),
        reasons: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    error: z.string().optional(),
  })
  .passthrough();

// ── Index Tree schemas (canonical read-only evidence navigation) ──────────

export const IndexTreeErrorItemSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const IndexTreeEnvelopeBaseShape = {
  success: z.boolean(),
  schema_version: z.literal('m31.index_tree.v1'),
  generated_at: z.string(),
  errors: z.array(IndexTreeErrorItemSchema),
};

export const IndexTreeFacetValueSchema = z.object({
  value: z.string(),
  count: z.number(),
  sample_entry_pointers: z.array(z.string()).default([]),
  raw_values: z.array(z.string()).default([]),
}).passthrough();

export const IndexTreeFacetMenuSchema = z.object({
  facet: z.string(),
  value_count: z.number().optional(),
  values: z.array(IndexTreeFacetValueSchema).default([]),
}).passthrough();

export const IndexTreeFallbackSchema = z.object({
  used: z.boolean().default(false),
  reason: z.string().nullable().optional(),
  journal_fallback_pointers: z.array(z.string()).default([]),
}).passthrough();

export const IndexTreeFreshnessSchema = z.object({
  fresh: z.boolean().optional(),
  issues: z.array(z.string()).default([]),
}).passthrough();

export const IndexTreeDiscoverDataSchema = z.object({
  truth_source: z.string(),
  privacy_level: z.string(),
  selection_contract: z.string(),
  facets: z.record(z.string(), IndexTreeFacetMenuSchema).default({}),
  freshness: IndexTreeFreshnessSchema.optional(),
  fallback: IndexTreeFallbackSchema.optional(),
}).passthrough();

export const IndexTreeEntrySchema = z.object({
  relative_path: z.string().optional(),
  title: z.string().optional(),
}).passthrough();

export const IndexTreeNavigateDataSchema = z.object({
  truth_source: z.string(),
  privacy_level: z.string(),
  entry_pointers: z.array(z.string()).default([]),
  entries: z.array(IndexTreeEntrySchema).default([]),
  freshness: IndexTreeFreshnessSchema.optional(),
  fallback: IndexTreeFallbackSchema.optional(),
}).passthrough();

export const IndexTreeEnsureDataSchema = z.object({
  truth_source: z.string().optional(),
  freshness: IndexTreeFreshnessSchema.optional(),
  fallback: IndexTreeFallbackSchema,
}).passthrough();

export const IndexTreeShadowDataSchema = z.object({
  query: z.string(),
  enabled: z.boolean(),
  diagnostic_only: z.boolean(),
  baseline_paths: z.array(z.string()).default([]),
  shadow_candidate_paths: z.array(z.string()).default([]),
  recall_preserved: z.boolean().nullable(),
  dropped_paths: z.array(z.string()).default([]),
  default_search_mutated: z.boolean(),
  default_smart_search_mutated: z.boolean(),
}).passthrough();

export const IndexTreeDiscoverResponseSchema = z.object({
  ...IndexTreeEnvelopeBaseShape,
  command: z.literal('index-tree.discover'),
  data: IndexTreeDiscoverDataSchema,
}).passthrough();

export const IndexTreeNavigateResponseSchema = z.object({
  ...IndexTreeEnvelopeBaseShape,
  command: z.literal('index-tree.navigate'),
  data: IndexTreeNavigateDataSchema,
}).passthrough();

export const IndexTreeEnsureResponseSchema = z.object({
  ...IndexTreeEnvelopeBaseShape,
  command: z.literal('index-tree.ensure'),
  data: IndexTreeEnsureDataSchema,
}).passthrough();

export const IndexTreeShadowResponseSchema = z.object({
  ...IndexTreeEnvelopeBaseShape,
  command: z.literal('index-tree.shadow'),
  data: IndexTreeShadowDataSchema.nullable(),
}).passthrough();

// ── Rich query sub-schemas ──────────────────────────────────────────────────

const EvidenceItemSchema = z.object({
  id: z.string(),
  rel_path: z.string(),
  title: z.string(),
  date: z.string(),
  snippet: z.string().optional(),
  excerpt: z.string().optional(),
  metadata: z
    .object({
      location: z.string().optional(),
      topic: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(),
}).passthrough();

const InsightSchema = z.object({
  theme: z.string(),
  quote: z.string().optional(),
  date: z.string().optional(),
  interpretation: z.string().optional(),
  evidence_refs: z.array(z.string()).default([]),
}).passthrough();

// ── Host Agent handoff schemas ─────────────────────────────────────────────

export const HostAgentHealthResponseSchema = z.object({
  schema_version: z.string().optional(),
  running: z.boolean(),
  ready: z.boolean(),
  degraded: z.boolean().optional(),
  mode: z.string().min(1).optional(),
  reason: z.string().nullable().optional(),
  runtime: z.record(z.string(), z.unknown()).optional(),
  checks: z.array(z.record(z.string(), z.unknown())).default([]),
}).passthrough();

const HostAgentAnswerSchema = z.object({
  mode: z.string().min(1),
  reason: z.string().nullable().optional(),
  summary: z.string().optional(),
  insights: z.array(InsightSchema).default([]),
  gap: z.string().nullable().default(null),
  suggestions: z.array(z.string()).default([]),
}).passthrough();

export const HostAgentQueryResponseSchema = z.object({
  schema_version: z.string().default('gui.host_agent.query_response.v1'),
  request_id: z.string().nullable().optional(),
  conversation_id: z.string().nullable().optional(),
  source: z.string(),
  mode: z.string().min(1),
  reason: z.string().nullable().optional(),
  query: z.string(),
  answer: HostAgentAnswerSchema.optional(),
  evidence: z.array(EvidenceItemSchema).default([]),
  tool_trace: z.array(z.record(z.string(), z.unknown())).default([]),
}).passthrough().superRefine((payload, ctx) => {
  if (payload.answer && payload.answer.mode !== payload.mode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `top-level mode "${payload.mode}" must match answer.mode "${payload.answer.mode}".`,
      path: ['mode'],
    });
  }
  if (payload.mode === 'UNGROUNDED' && payload.evidence.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'UNGROUNDED response must not include evidence items.',
      path: ['evidence'],
    });
  }
});

const HostAgentMetadataFieldValueSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.null(),
]);

export const HostAgentMetadataFieldSchema = z.object({
  value: HostAgentMetadataFieldValueSchema.optional(),
  field_source: z.string().optional(),
  confidence: z.number().optional(),
  rationale: z.string().optional(),
  evidence_spans: z.array(z.string()).default([]),
}).passthrough();

export const HostAgentMetadataProposalSchema = z.object({
  schema_version: z.string().default('gui.host_agent.metadata_proposal.v1'),
  request_id: z.string().nullable().optional(),
  mode: z.string().min(1),
  reason: z.string().nullable().optional(),
  fields: z.record(z.string(), HostAgentMetadataFieldSchema).default({}),
  warnings: z.array(z.string()).default([]),
  policy: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const HostAgentStreamStatusEventSchema = z.object({
  type: z.literal('status'),
  data: z.object({
    phase: z.string().optional(),
    message: z.string().optional(),
  }).passthrough(),
});

export const HostAgentStreamEvidenceEventSchema = z.object({
  type: z.literal('evidence'),
  data: z.array(EvidenceItemSchema),
});

export const HostAgentStreamDeltaEventSchema = z.object({
  type: z.literal('delta'),
  data: z.union([
    z.object({ text: z.string() }).strict(),
    z.string().transform((text) => ({ text })),
  ]),
});

export const HostAgentStreamToolEventSchema = z.object({
  type: z.union([z.literal('tool_call'), z.literal('tool_result')]),
  data: z.record(z.string(), z.unknown()),
});

export const HostAgentStreamFinalEventSchema = z.object({
  type: z.literal('final'),
  data: HostAgentQueryResponseSchema,
});

export const HostAgentStreamErrorEventSchema = z.object({
  type: z.literal('error'),
  data: z.union([
    z.object({
      code: z.string(),
      message: z.string(),
    }),
    APIErrorSchema,
    z.object({
      ok: z.literal(false),
      error: APIErrorSchema,
    }),
  ]),
});

export const HostAgentStreamEventSchema = z.union([
  HostAgentStreamStatusEventSchema,
  HostAgentStreamEvidenceEventSchema,
  HostAgentStreamDeltaEventSchema,
  HostAgentStreamToolEventSchema,
  HostAgentStreamFinalEventSchema,
  HostAgentStreamErrorEventSchema,
]);

// ── Public link operations ────────────────────────────────────────────────

export const PublicLinkProcessSchema = z.object({
  name: z.string(),
  pid: z.number(),
}).passthrough();

export const PublicLinkErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
}).passthrough();

export const PublicLinkStatusSchema = z.object({
  schema_version: z.literal('gui.remote_link.v1').optional(),
  status: z.enum(['offline', 'starting', 'online', 'error']).optional(),
  url: z.string().nullable().optional(),
  one_time_code: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  code_expires_at: z.string().nullable().optional(),
  remaining_ttl_seconds: z.number().nullable().optional(),
  qr: z.string().nullable().optional(),
  running: z.boolean(),
  tunnelUrl: z.string().nullable(),
  oneTimeUrl: z.string().nullable().optional(),
  oneTimeCode: z.string().nullable().optional(),
  qrDataUrl: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  codeExpiresAt: z.string().nullable().optional(),
  remainingTtlSeconds: z.number().nullable().optional(),
  frontendUrl: z.string().nullable(),
  logDir: z.string().nullable(),
  processes: z.array(PublicLinkProcessSchema).default([]),
  startedAt: z.string().nullable().optional(),
  warnings: z.array(z.string()).default([]),
  starting: z.boolean().default(false),
  startJobId: z.string().nullable().optional(),
  phase: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  error: PublicLinkErrorSchema.nullable().optional(),
}).passthrough();

export const PublicLinkEventSchema = z.object({
  type: z.union([z.literal('status'), z.literal('ready'), z.literal('error')]),
  data: PublicLinkStatusSchema,
});

// ── Entity schemas (S4 — Entity Graph Inspection) ──────

export const EntityStatsSchema = z.object({
  total_entities: z.number(),
  total_relationships: z.number(),
}).passthrough();

export const EntityItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  primary_name: z.string(),
  aliases: z.array(z.string()).default([]),
  attributes: z.record(z.string(), z.unknown()).default({}),
  relationships: z.array(z.record(z.string(), z.unknown())).default([]),
}).passthrough();

export const EntityListSchema = z.union([
  z.array(EntityItemSchema),
  z
    .object({
      entities: z.array(EntityItemSchema).optional(),
      items: z.array(EntityItemSchema).optional(),
    })
    .passthrough(),
]);

export const EntityCheckSchema = z.object({
  issues: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).default([]),
  total_entities: z.number().optional(),
}).passthrough();

export const EntityAuditSchema = z.object({
  issues: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).default([]),
  summary: z.record(z.string(), z.number()).default({}),
}).passthrough();

export const EntityReviewSchema = z.object({
  queue: z.array(z.record(z.string(), z.unknown())).default([]),
  total: z.number().default(0),
}).passthrough();

export const CandidateEdgeSchema = z.record(z.string(), z.unknown());

export const CandidateEdgesResponseSchema = z.object({
  candidates: z.array(CandidateEdgeSchema).default([]),
  total: z.number().default(0),
  schemaVersion: z.string().optional(),
  provenance: z.unknown().optional(),
});

export const EntityCandidateEdgesSchema = CandidateEdgesResponseSchema;

// ── Entity mutation schemas (S5 — Guarded Entity Mutation UX) ─────────────

export const EntityMutationPreviewSchema = z.object({
  operation: z.string(),
  preview: z.record(z.string(), z.unknown()),
  requiresConfirmation: z.boolean(),
  schemaVersion: z.string().optional(),
  provenance: z.unknown().optional(),
}).passthrough();

export const EntityMutationConfirmSchema = z.object({
  operation: z.string(),
  mutation: z.record(z.string(), z.unknown()),
  postCheck: z.unknown(),
  postCheckOk: z.boolean(),
  schemaVersion: z.string().optional(),
  provenance: z.unknown().optional(),
}).passthrough();

// ── Import schemas (M3 — Tranche A fixture import) ────────────────────────
// All import schemas use .passthrough() so additive CLI fields are not stripped.
// Frontend types must not include backend temp file path fields.

// Nested record schemas

export const ImportProposalJournalSchema = z.object({
  date_time: z.string().optional(),
  date: z.string().optional(),
  title: z.string(),
  content: z.string().optional(),
}).passthrough();

export const ImportProposalAttachmentSchema = z.object({
  name: z.string().optional(),
  attachment_id: z.string().optional(),
  source_ref: z.string().optional(),
  source_sha256: z.string().optional(),
  source_rel_path: z.string().optional(),
  target_rel_path: z.string().optional(),
  media_type: z.string().optional(),
  size_bytes: z.number().optional(),
  copy_mode: z.string().optional(),
  conflict: z.unknown().optional(),
}).passthrough();

export const ImportConflictSchema = z.object({
  type: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  severity: z.string().optional(),
  runnable: z.boolean().optional(),
  existing_path: z.string().optional(),
  resolution: z.string().optional(),
}).passthrough();

export const ImportWarningSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
  severity: z.string().optional(),
  runnable: z.boolean().optional(),
}).passthrough();

export const ImportCreatedFileSchema = z.object({
  kind: z.string(),
  rel_path: z.string(),
  sha256_after: z.string().optional(),
  size_bytes: z.number().optional(),
  created_by_import: z.boolean().optional(),
}).passthrough();

export const ImportProposalSchema = z.object({
  proposal_id: z.string(),
  source_record_id: z.string().optional(),
  journal: ImportProposalJournalSchema.optional(),
  attachments: z.array(ImportProposalAttachmentSchema).optional(),
  conflicts: z.array(ImportConflictSchema).optional(),
  warnings: z.array(ImportWarningSchema).optional(),
  confidence: z.unknown().optional(),
  dedup_status: z.string().optional(),
}).passthrough();

export const ImportSourceSchema = z.object({
  adapter_id: z.string(),
  record_count: z.number().optional(),
}).passthrough();

export const ImportSummarySchema = z.object({
  proposed_journal_count: z.number().optional(),
  proposed_attachment_count: z.number().optional(),
  conflict_count: z.number().optional(),
  warning_count: z.number().optional(),
}).passthrough();

export const ImportWriteSetPreviewSchema = z.object({
  create_files: z.array(z.unknown()).optional(),
  update_files: z.array(z.unknown()).optional(),
  delete_files: z.array(z.unknown()).optional(),
}).passthrough();

export const ImportPostRunActionsSchema = z.object({
  index_rebuild_recommended: z.boolean().optional(),
}).passthrough();

export const ImportErrorSchema = z.object({
  code: z.string(),
  severity: z.string().optional(),
  scope: z.string().optional(),
  retryable: z.boolean().optional(),
  user_message: z.string().optional(),
  detail: z.unknown().optional(),
  remediation: z.string().optional(),
  phase: z.string().optional(),
}).passthrough();

// Top-level response schemas — one per CLI import command

export const ImportPlanResponseSchema = z.object({
  schema_version: z.string(),
  import_id: z.string(),
  dry_run: z.boolean(),
  plan_fingerprint: z.string().optional(),
  idempotency_key: z.string().optional(),
  source: ImportSourceSchema.optional(),
  summary: ImportSummarySchema.optional(),
  proposals: z.array(ImportProposalSchema).optional(),
  write_set_preview: ImportWriteSetPreviewSchema.optional(),
  conflicts: z.array(ImportConflictSchema).optional(),
  warnings: z.array(ImportWarningSchema).optional(),
  errors: z.array(ImportErrorSchema).optional(),
}).passthrough();

export const ImportRunResponseSchema = z.object({
  schema_version: z.string(),
  import_id: z.string(),
  state: z.string(),
  plan_fingerprint: z.string().optional(),
  idempotency_key: z.string().optional(),
  created_journal_count: z.number().optional(),
  created_attachment_count: z.number().optional(),
  created_files: z.array(ImportCreatedFileSchema).optional(),
  rollback_manifest_rel_path: z.string().optional(),
  post_run_actions: ImportPostRunActionsSchema.optional(),
  errors: z.array(ImportErrorSchema).optional(),
}).passthrough();

export const ImportStatusResponseSchema = z.object({
  schema_version: z.string(),
  import_id: z.string(),
  state: z.string(),
  counts: z.record(z.string(), z.unknown()).optional(),
  last_error: ImportErrorSchema.optional(),
  rollback_available: z.unknown().optional(),
  rollback_manifest_rel_path: z.string().optional(),
}).passthrough();

export const ImportRollbackResponseSchema = z.object({
  schema_version: z.string(),
  import_id: z.string(),
  state: z.string(),
  deleted_count: z.number().optional(),
  rollback_manifest_rel_path: z.string().optional(),
  errors: z.array(ImportErrorSchema).optional(),
}).passthrough();

// ── Maintenance schemas (M33 — Data Doctor Repair UI) ──────────────────────
// All maintenance schemas use .passthrough() so additive CLI envelope fields
// are not stripped. Frontend code must not assume fields beyond what is
// explicitly declared.

export const MaintenanceAuditIssueSchema = z.record(z.string(), z.unknown());

export const MaintenanceAuditResponseSchema = z.object({
  schema_version: z.string(),
  issues: z.array(MaintenanceAuditIssueSchema).default([]),
}).passthrough();

export const MaintenancePlanResponseSchema = z.object({
  schema_version: z.string(),
  issue_id: z.string(),
  repairable: z.boolean().default(false),
  path: z.string().optional(),
}).passthrough();

export const MaintenanceRepairResponseSchema = z.object({
  schema_version: z.string(),
  issue_id: z.string(),
  dry_run: z.boolean(),
  planned_paths: z.array(z.string()).default([]),
  changed_paths: z.array(z.string()).default([]),
  applied: z.boolean(),
}).passthrough();
