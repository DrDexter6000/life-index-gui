import { useCallback, useEffect, useRef, useState } from 'react';
import { GlassCard } from '@/components/celestial/GlassCard';
import { useTranslation } from '@/hooks/useTranslation';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useHostAgentHealth, useHostAgentMetadataProposal } from '@/hooks/useHostAgent';
import { dashboardAPI } from '@/lib/api-client';
import { AI_PLUS_FEATURE_ENABLES } from '@/lib/health-status';
import type { JournalMetadata } from '@/stores/journal-draft';

interface MetadataSidebarProps {
  metadata: JournalMetadata;
  draftContent?: string;
  draftScope?: string;
  onUpdate: (metadata: Partial<JournalMetadata>) => void;
  smartCapabilityAvailable?: boolean;
}

type ProposalFieldValue = string | string[] | null | undefined;
type ProposalField = {
  value?: ProposalFieldValue;
  field_source?: string;
  confidence?: number;
  rationale?: string;
  evidence_spans?: string[];
};
type MetadataUnavailableEnvelope = {
  reason?: string | null;
  warnings?: string[];
  diagnostics?: unknown;
};
type MetadataAgentStatus = 'ready' | 'extracting' | 'filled' | 'partial' | 'reviewed' | 'stale' | 'failed' | 'timeout' | 'offline';
type ProposalTargetField = 'title' | 'abstract' | 'project' | 'topics' | 'moods' | 'people' | 'tags' | 'links';
type ProposalFieldOutcome = 'filled' | 'preserved' | 'not-filled';
type ProposalFieldStatus = ProposalFieldOutcome | 'stale';
type NormalizedProposalValue = string | string[];
type CachedMetadataProposal = {
  scope: string;
  contextIdentity: string;
  revisionIdentity: string;
  fields: Record<string, ProposalField>;
  baseValues: Record<ProposalTargetField, NormalizedProposalValue>;
  outcomes: Record<ProposalTargetField, ProposalFieldOutcome>;
  appliedTargets: ProposalTargetField[];
  responseWasFresh: boolean;
  requestId: string | null;
  requestedAt: number;
  savedAt: number;
};
type MetadataProposalReview = {
  record: CachedMetadataProposal;
};

let metadataProposalSequence = 0;
let lastConsumedMetadataProposalKey: string | null = null;
const METADATA_PROPOSAL_CACHE_TTL_MS = 5 * 60 * 1000;
const TITLE_MAX_LENGTH = 20;
const metadataProposalCache = new Map<string, CachedMetadataProposal>();

const PROPOSAL_FIELD_TARGETS: Record<string, ProposalTargetField> = {
  title: 'title',
  abstract: 'abstract',
  project: 'project',
  topics: 'topics',
  moods: 'moods',
  people: 'people',
  tags: 'tags',
  links: 'links',
};
const PROPOSAL_TARGET_FIELDS: readonly ProposalTargetField[] = [
  'title',
  'abstract',
  'project',
  'topics',
  'moods',
  'people',
  'tags',
  'links',
];
const PROPOSAL_FIELD_LABEL_KEYS: Record<ProposalTargetField, string> = {
  title: 'titleLabel',
  abstract: 'abstractLabel',
  project: 'project',
  topics: 'topics',
  moods: 'moods',
  people: 'people',
  tags: 'tagsLabel',
  links: 'linksLabel',
};

const TOPICS = [
  { key: 'work', labelKey: 'topicWork' as const, color: 'var(--color-gold)' },
  { key: 'learn', labelKey: 'topicLearn' as const, color: 'var(--color-cyan)' },
  { key: 'health', labelKey: 'topicHealth' as const, color: 'var(--color-coral)' },
  { key: 'relation', labelKey: 'topicRelation' as const, color: 'var(--color-gold)' },
  { key: 'think', labelKey: 'topicThink' as const, color: 'var(--color-cyan)' },
  { key: 'create', labelKey: 'topicCreate' as const, color: 'var(--color-coral)' },
  { key: 'life', labelKey: 'topicLife' as const, color: 'var(--color-primary)' },
];

function parseCoordinates(value: string): { lat: number; lng: number } | null {
  const match = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;

  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { lat, lng };
}

function formatProposalValue(value: ProposalFieldValue): string {
  if (Array.isArray(value)) return value.join(', ');
  return value ?? '';
}

function formatDraftValue(value: NormalizedProposalValue): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

function parseListProposal(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function proposalTargetField(fieldName: string): ProposalTargetField | null {
  return PROPOSAL_FIELD_TARGETS[fieldName] ?? null;
}

function proposalPatch(fieldName: string, field: ProposalField): Partial<JournalMetadata> {
  const target = proposalTargetField(fieldName);
  if (!target) return {};

  const value = normalizeProposalFieldValue(target, field.value);
  if (target === 'title') return { title: String(value) };
  if (target === 'abstract') return { abstract: String(value) };
  if (target === 'project') return { project: String(value) };
  if (target === 'topics') return { topics: Array.isArray(value) ? value : parseListProposal(value) };
  if (target === 'moods') return { moods: Array.isArray(value) ? value : parseListProposal(value) };
  if (target === 'people') return { people: Array.isArray(value) ? value : parseListProposal(value) };
  if (target === 'tags') return { tags: Array.isArray(value) ? value : parseListProposal(value) };
  if (target === 'links') return { links: Array.isArray(value) ? value : parseListProposal(value) };
  return {};
}

function normalizeProposalFieldValue(
  target: ProposalTargetField,
  value: ProposalFieldValue,
): NormalizedProposalValue {
  if (target === 'title' || target === 'abstract' || target === 'project') {
    return typeof value === 'string' ? value.trim() : '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }
  return parseListProposal(typeof value === 'string' ? value : '');
}

function metadataFieldValue(metadata: JournalMetadata, target: ProposalTargetField): NormalizedProposalValue {
  if (target === 'title') return normalizeProposalFieldValue(target, metadata.title);
  if (target === 'abstract') return normalizeProposalFieldValue(target, metadata.abstract);
  if (target === 'project') return normalizeProposalFieldValue(target, metadata.project);
  if (target === 'topics') return normalizeProposalFieldValue(target, metadata.topics);
  if (target === 'moods') return normalizeProposalFieldValue(target, metadata.moods);
  if (target === 'people') return normalizeProposalFieldValue(target, metadata.people);
  if (target === 'tags') return normalizeProposalFieldValue(target, metadata.tags);
  return normalizeProposalFieldValue(target, metadata.links);
}

function proposalValuesEqual(left: NormalizedProposalValue | undefined, right: NormalizedProposalValue | undefined): boolean {
  return JSON.stringify(left ?? '') === JSON.stringify(right ?? '');
}

function proposalValueIsEmpty(value: NormalizedProposalValue): boolean {
  return value.length === 0;
}

function proposalValueCanAutoFill(target: ProposalTargetField, value: NormalizedProposalValue): boolean {
  if (proposalValueIsEmpty(value)) return false;
  return target !== 'title' || (typeof value === 'string' && value.length <= TITLE_MAX_LENGTH);
}

function evaluateMetadataProposal(
  fields: Record<string, ProposalField>,
  baseValues: Record<ProposalTargetField, NormalizedProposalValue>,
  metadata: JournalMetadata,
): {
  patch: Partial<JournalMetadata>;
  outcomes: Record<ProposalTargetField, ProposalFieldOutcome>;
} {
  const patch: Partial<JournalMetadata> = {};
  const outcomes = {} as Record<ProposalTargetField, ProposalFieldOutcome>;

  for (const target of PROPOSAL_TARGET_FIELDS) {
    const baseValue = baseValues[target];
    const currentValue = metadataFieldValue(metadata, target);
    const field = fields[target];
    const proposedValue = normalizeProposalFieldValue(target, field?.value);
    const baseWasEmpty = proposalValueIsEmpty(baseValue);
    const currentStillMatchesBase = proposalValuesEqual(currentValue, baseValue);

    if (field && baseWasEmpty && currentStillMatchesBase && proposalValueCanAutoFill(target, proposedValue)) {
      Object.assign(patch, proposalPatch(target, field));
      outcomes[target] = 'filled';
    } else if (!baseWasEmpty || !currentStillMatchesBase) {
      outcomes[target] = 'preserved';
    } else {
      outcomes[target] = 'not-filled';
    }
  }

  return { patch, outcomes };
}

function supportedProposalFields(fields: Record<string, ProposalField> | undefined): Record<string, ProposalField> {
  const entries = Object.entries(fields ?? {});
  // The API parser rejects unknown field keys before this component receives a
  // proposal.  Keep this defensive boundary all-or-nothing for direct callers
  // so an unexpected key can never be silently dropped beside valid fields.
  if (entries.some(([fieldName]) => !proposalTargetField(fieldName))) return {};

  const supported: Record<string, ProposalField> = {};
  for (const [fieldName, field] of entries) {
    if (!isValidProposalField(field)) continue;
    supported[fieldName] = field;
  }
  return supported;
}

function createMetadataProposalRequestId(): string {
  metadataProposalSequence += 1;
  return `metadata-proposal-${Date.now().toString(36)}-${metadataProposalSequence}`;
}

function metadataProposalDraft(metadata: JournalMetadata, draftContent: string) {
  return {
    title: metadata.title || '',
    content: draftContent,
    date: metadata.date,
    existing_metadata: {
      topic: metadata.topics || [],
      mood: metadata.moods || [],
      people: metadata.people || [],
      project: metadata.project || '',
      location: metadata.location || '',
      weather: metadata.weather || '',
      abstract: metadata.abstract || '',
      tags: metadata.tags || [],
      links: metadata.links || [],
    },
  };
}

function metadataProposalContext(metadata: JournalMetadata, draftContent: string) {
  return {
    content: draftContent,
    date: metadata.date,
  };
}

function metadataProposalContextIdentity(metadata: JournalMetadata, draftContent: string): string {
  return JSON.stringify(metadataProposalContext(metadata, draftContent));
}

function metadataProposalRevisionIdentity(metadata: JournalMetadata, draftContent: string): string {
  // Proposal-controlled fields are intentionally excluded. Accepting one field
  // must not stale independent sibling fields from the same request.
  return JSON.stringify({ context: metadataProposalContext(metadata, draftContent) });
}

function metadataProposalCacheKey(record: Pick<CachedMetadataProposal, 'scope' | 'contextIdentity' | 'revisionIdentity'>): string {
  return JSON.stringify([record.scope, record.contextIdentity, record.revisionIdentity]);
}

function isValidProposalField(field: unknown): field is ProposalField {
  if (!field || typeof field !== 'object' || Array.isArray(field)) return false;
  const candidate = field as Record<string, unknown>;
  const value = candidate.value;
  if (!(value === undefined || value === null || typeof value === 'string'
    || (Array.isArray(value) && value.every((item) => typeof item === 'string')))) {
    return false;
  }
  if (candidate.field_source !== undefined && typeof candidate.field_source !== 'string') return false;
  if (candidate.confidence !== undefined
    && (typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence))) return false;
  if (candidate.rationale !== undefined && typeof candidate.rationale !== 'string') return false;
  if (candidate.evidence_spans !== undefined
    && (!Array.isArray(candidate.evidence_spans)
      || !candidate.evidence_spans.every((span) => typeof span === 'string'))) return false;
  return true;
}

function isValidNormalizedProposalValue(target: ProposalTargetField, value: unknown): value is NormalizedProposalValue {
  if (target === 'title' || target === 'abstract' || target === 'project') {
    return typeof value === 'string';
  }
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isValidCachedMetadataProposal(value: unknown): value is CachedMetadataProposal {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<CachedMetadataProposal>;
  if (typeof record.scope !== 'string' || typeof record.contextIdentity !== 'string'
    || typeof record.revisionIdentity !== 'string' || typeof record.requestId !== 'string' && record.requestId !== null
    || typeof record.requestedAt !== 'number' || !Number.isFinite(record.requestedAt)
    || typeof record.savedAt !== 'number' || !Number.isFinite(record.savedAt)
    || !record.fields || typeof record.fields !== 'object'
    || !record.outcomes || typeof record.outcomes !== 'object' || Array.isArray(record.outcomes)
    || !Array.isArray(record.appliedTargets)
    || !record.appliedTargets.every((target) => PROPOSAL_TARGET_FIELDS.includes(target))
    || typeof record.responseWasFresh !== 'boolean'
    || !record.baseValues || typeof record.baseValues !== 'object' || Array.isArray(record.baseValues)) return false;
  if (!PROPOSAL_TARGET_FIELDS.every((target) => (
    Object.prototype.hasOwnProperty.call(record.baseValues, target)
    && isValidNormalizedProposalValue(target, record.baseValues[target])
  ))) return false;
  if (!PROPOSAL_TARGET_FIELDS.every((target) => (
    record.outcomes?.[target] === 'filled'
    || record.outcomes?.[target] === 'preserved'
    || record.outcomes?.[target] === 'not-filled'
  ))) return false;
  return Object.entries(record.fields).every(([fieldName, field]) => Boolean(proposalTargetField(fieldName)) && isValidProposalField(field));
}

function purgeMetadataProposalCache(now = Date.now()): void {
  for (const [key, record] of metadataProposalCache.entries()) {
    if (!isValidCachedMetadataProposal(record) || metadataProposalExpired(record, now)) {
      metadataProposalCache.delete(key);
    }
  }
}

function metadataProposalExpired(record: CachedMetadataProposal, now = Date.now()): boolean {
  return now - record.savedAt > METADATA_PROPOSAL_CACHE_TTL_MS || now < record.savedAt;
}

function writeMetadataProposalCache(record: CachedMetadataProposal): void {
  purgeMetadataProposalCache();
  // The drawer is single-owner for a document; replace-on-write keeps this
  // disposable cache bounded to exactly one proposal record globally.
  metadataProposalCache.clear();
  metadataProposalCache.set(metadataProposalCacheKey(record), record);
}

function readMetadataProposalCache(scope: string, contextIdentity: string, revisionIdentity: string): {
  record: CachedMetadataProposal | null;
  contextMatches: boolean;
} {
  purgeMetadataProposalCache();
  const records = Array.from(metadataProposalCache.values()).filter((record) => record.scope === scope);
  if (records.length === 0) return { record: null, contextMatches: false };
  const record = records[0];
  return {
    record,
    contextMatches: record.contextIdentity === contextIdentity && record.revisionIdentity === revisionIdentity,
  };
}

function truncateDiagnostic(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}

function formatTimingValue(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

function metadataTimingSummary(timings: unknown): string | null {
  if (!timings || typeof timings !== 'object') return null;
  const record = timings as Record<string, unknown>;
  const timingParts = [
    ['宿主', record.runtime_ms],
    ['解析', record.parse_ms],
    ['桥接', record.bridge_total_ms],
    ['后端', record.backend_relay_ms],
  ]
    .map(([label, value]) => {
      const formatted = formatTimingValue(value);
      return formatted ? `${label} ${formatted}` : null;
    })
    .filter((part): part is string => Boolean(part));

  return timingParts.length > 0 ? timingParts.join(' · ') : null;
}

function metadataDiagnosticSummary(diagnostics: unknown): string | null {
  if (!diagnostics || typeof diagnostics !== 'object') return null;
  const record = diagnostics as Record<string, unknown>;
  const parts: string[] = [];

  if (typeof record.stage === 'string' && record.stage.trim()) {
    parts.push(truncateDiagnostic(record.stage));
  }
  if (typeof record.returncode === 'number') {
    parts.push(`exit ${record.returncode}`);
  }
  if (record.timed_out === true) {
    parts.push('timeout');
  }
  if (typeof record.error === 'string' && record.error.trim()) {
    parts.push(truncateDiagnostic(record.error));
  }
  const timings = metadataTimingSummary(record.timings);
  if (timings) {
    parts.push(timings);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

function metadataUnavailableReason(proposal: MetadataUnavailableEnvelope): string {
  const reason = proposal.reason
    ?? proposal.warnings?.find((warning) => warning.trim())
    ?? 'host-agent-metadata-unavailable';
  const diagnostics = metadataDiagnosticSummary(proposal.diagnostics);
  return diagnostics ? `${reason} · ${diagnostics}` : reason;
}

function metadataDiagnosticNeedle(proposal: MetadataUnavailableEnvelope): string {
  const parts: string[] = [];
  if (proposal.reason) parts.push(proposal.reason);
  if (proposal.warnings?.length) parts.push(...proposal.warnings);
  const diagnostics = proposal.diagnostics;
  if (diagnostics && typeof diagnostics === 'object') {
    const record = diagnostics as Record<string, unknown>;
    for (const key of ['stage', 'error', 'error_type', 'returncode']) {
      const value = record[key];
      if (typeof value === 'string' || typeof value === 'number') parts.push(String(value));
    }
    if (record.timed_out === true) parts.push('runtime-timeout');
  }
  return parts.join(' ').toLowerCase();
}

function metadataIssueStatus(proposal: MetadataUnavailableEnvelope): MetadataAgentStatus {
  const needle = metadataDiagnosticNeedle(proposal);
  if (needle.includes('runtime-timeout') || needle.includes('timed_out')) return 'timeout';
  if (needle.includes('runtime-failed') || needle.includes('parse') || needle.includes('relay')) return 'failed';
  if (needle.includes('unconfigured') || needle.includes('unavailable')) return 'offline';
  return 'failed';
}

/**
 * MetadataSidebar - metadata editor with transient location/weather enrichment.
 *
 * The browser only provides coordinates. Naming and weather lookup go through
 * backend adapter routes, and writing still happens through the journal save
 * contract. Smart metadata may fill only request-snapshot-empty fields that
 * remain empty; normal journal Save remains the only persistence boundary.
 */
export function MetadataSidebar({
  metadata,
  draftContent = '',
  draftScope = 'new',
  onUpdate,
  smartCapabilityAvailable = true,
}: MetadataSidebarProps) {
  const { t, lang } = useTranslation();
  const [newPerson, setNewPerson] = useState('');
  const [newMood, setNewMood] = useState('');
  const [locationStatus, setLocationStatus] = useState<string | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<string | null>(null);
  const [isResolvingLocation, setIsResolvingLocation] = useState(false);
  const [isResolvingWeather, setIsResolvingWeather] = useState(false);
  const [activeProposalRequestId, setActiveProposalRequestId] = useState<string | null>(null);
  const contextIdentity = metadataProposalContextIdentity(metadata, draftContent);
  const revisionIdentity = metadataProposalRevisionIdentity(metadata, draftContent);
  const [proposalReview, setProposalReview] = useState<MetadataProposalReview | null>(() => {
    const cached = readMetadataProposalCache(draftScope, contextIdentity, revisionIdentity);
    return cached.record ? { record: cached.record } : null;
  });
  const [statusDetailOpen, setStatusDetailOpen] = useState(false);
  const autoEnrichmentStarted = useRef(false);
  const seenProposalKey = useRef<string | null>(null);
  const requestSnapshotById = useRef(new Map<string, {
    scope: string;
    contextIdentity: string;
    revisionIdentity: string;
    baseValues: Record<ProposalTargetField, NormalizedProposalValue>;
    requestedAt: number;
  }>());
  const latestLocationRef = useRef(metadata.location ?? '');
  const geolocation = useGeolocation();

  const { data: hostAgentHealth } = useHostAgentHealth();
  const metadataProposal = useHostAgentMetadataProposal();

  const smartMetadataEnabled = AI_PLUS_FEATURE_ENABLES.smartMetadata && smartCapabilityAvailable;
  const smartMetadataReady = Boolean(
    smartMetadataEnabled
    && hostAgentHealth?.running === true
    && hostAgentHealth.ready === true
    && hostAgentHealth.degraded !== true,
  );

  const metadataProposalRequestId =
    typeof metadataProposal.data?.request_id === 'string' ? metadataProposal.data.request_id : null;
  const proposalBelongsToActiveRequest = !activeProposalRequestId
    || (metadataProposalRequestId != null && metadataProposalRequestId === activeProposalRequestId);
  const metadataIssueEnvelope: MetadataUnavailableEnvelope | null =
    proposalBelongsToActiveRequest
    && metadataProposal.data
    && Object.keys(metadataProposal.data.fields ?? {}).length === 0
    && !metadataProposal.isPending
      ? metadataProposal.data
      : metadataProposal.error
        ? { reason: metadataProposal.error.message, diagnostics: { error: metadataProposal.error.message } }
        : null;
  const metadataAgentIssueStatus = metadataIssueEnvelope ? metadataIssueStatus(metadataIssueEnvelope) : null;
  const metadataAgentCanRequest = smartMetadataReady && !metadataProposal.isPending;
  const metadataAgentHasDetails = Boolean(metadataIssueEnvelope || proposalReview);
  const metadataAgentDetailReason = metadataIssueEnvelope ? metadataUnavailableReason(metadataIssueEnvelope) : null;
  const metadataAgentTiming =
    metadataIssueEnvelope?.diagnostics && typeof metadataIssueEnvelope.diagnostics === 'object'
      ? metadataTimingSummary((metadataIssueEnvelope.diagnostics as Record<string, unknown>).timings)
      : null;

  const proposalContextStale = Boolean(
    proposalReview
    && (!proposalReview.record.responseWasFresh
      || metadataProposalExpired(proposalReview.record)
      || proposalReview.record.scope !== draftScope
      || proposalReview.record.contextIdentity !== contextIdentity
      || proposalReview.record.revisionIdentity !== revisionIdentity),
  );
  const unfilledProposalTargets = proposalReview && !proposalContextStale
    ? PROPOSAL_TARGET_FIELDS.filter((target) => proposalValueIsEmpty(metadataFieldValue(metadata, target)))
    : [];
  const appliedProposalCount = proposalReview && !proposalContextStale
    ? proposalReview.record.appliedTargets.length
    : 0;
  const metadataAgentStatus: MetadataAgentStatus = metadataProposal.isPending
    ? 'extracting'
    : metadataAgentIssueStatus
      ?? (proposalReview
        ? proposalContextStale
          ? 'stale'
          : appliedProposalCount > 0
            ? unfilledProposalTargets.length > 0 ? 'partial' : 'filled'
            : 'reviewed'
        : smartMetadataReady ? 'ready' : 'offline');

  const metadataStatusCopyKey = {
    ready: 'metadataAgentStatusReady',
    extracting: 'metadataAgentStatusExtracting',
    filled: 'metadataAgentStatusFilled',
    partial: 'metadataAgentStatusPartial',
    reviewed: 'metadataAgentStatusReviewed',
    stale: 'metadataAgentStatusStale',
    failed: 'metadataAgentStatusFailed',
    timeout: 'metadataAgentStatusTimeout',
    offline: 'metadataAgentStatusOffline',
  } satisfies Record<MetadataAgentStatus, string>;

  const metadataStatusIcon = {
    ready: '✦',
    extracting: 'progress_activity',
    filled: 'check',
    partial: 'pending_actions',
    reviewed: 'done_all',
    stale: 'history_toggle_off',
    failed: 'warning',
    timeout: 'timer_off',
    offline: 'power_off',
  } satisfies Record<MetadataAgentStatus, string>;

  const metadataStatusClass = 'border-[var(--color-cyan)]/30 bg-[var(--color-ether-surface-ghost)] text-[var(--color-cyan)] hover:border-[var(--color-cyan)]/45';

  const metadataDetailCopyKey = metadataAgentStatus === 'timeout'
    ? 'metadataAgentDetailTimeout'
    : metadataAgentStatus === 'offline'
      ? 'metadataAgentDetailOffline'
      : 'metadataAgentDetailFailure';

  useEffect(() => {
    const cached = readMetadataProposalCache(draftScope, contextIdentity, revisionIdentity);
    setProposalReview((current) => {
      if (cached.record) {
        if (current?.record.requestId === cached.record.requestId && current.record.savedAt === cached.record.savedAt) {
          return current;
        }
        return { record: cached.record };
      }
      if (current && current.record.scope === draftScope) return current;
      return null;
    });
  }, [contextIdentity, draftScope, revisionIdentity]);

  const handleRequestProposal = useCallback(() => {
    if (!smartMetadataReady || metadataProposal.isPending) return;
    setStatusDetailOpen(false);
    const cached = readMetadataProposalCache(draftScope, contextIdentity, revisionIdentity);
    if (cached.record && cached.contextMatches) {
      setProposalReview({ record: cached.record });
      return;
    }

    const requestId = createMetadataProposalRequestId();
    setActiveProposalRequestId(requestId);
    seenProposalKey.current = null;
    setProposalReview(null);
    requestSnapshotById.current.clear();
    requestSnapshotById.current.set(requestId, {
      scope: draftScope,
      contextIdentity,
      revisionIdentity,
      baseValues: {
        title: metadataFieldValue(metadata, 'title'),
        abstract: metadataFieldValue(metadata, 'abstract'),
        project: metadataFieldValue(metadata, 'project'),
        topics: metadataFieldValue(metadata, 'topics'),
        moods: metadataFieldValue(metadata, 'moods'),
        people: metadataFieldValue(metadata, 'people'),
        tags: metadataFieldValue(metadata, 'tags'),
        links: metadataFieldValue(metadata, 'links'),
      },
      requestedAt: Date.now(),
    });
    metadataProposal.mutate({
      request_id: requestId,
      draft: metadataProposalDraft(metadata, draftContent),
      policy: { preserve_user_fields: true },
    });
  }, [contextIdentity, draftContent, draftScope, metadata, metadataProposal, revisionIdentity, smartMetadataReady]);

  const handleStatusCapsuleClick = useCallback(() => {
    if (metadataProposal.isPending) return;
    if (metadataAgentHasDetails) {
      setStatusDetailOpen((isOpen) => !isOpen);
      return;
    }
    if (metadataAgentCanRequest) {
      handleRequestProposal();
    }
  }, [handleRequestProposal, metadataAgentCanRequest, metadataAgentHasDetails, metadataProposal.isPending]);

  const handleCopyMetadataDetails = useCallback(() => {
    if (!metadataAgentDetailReason) return;
    void navigator.clipboard?.writeText(metadataAgentDetailReason);
  }, [metadataAgentDetailReason]);

  const queryWeatherForLocation = useCallback(async (locationOverride?: string) => {
    const targetLocation = (locationOverride ?? latestLocationRef.current).trim();
    if (!targetLocation) return;

    setIsResolvingWeather(true);
    setWeatherStatus(t('weatherResolving'));

    try {
      const weather = await dashboardAPI.getWeather(targetLocation, metadata.date);
      if (weather.trim()) {
        onUpdate({ weather });
        setWeatherStatus(t('weatherReady'));
      } else {
        setWeatherStatus(t('weatherUnavailable'));
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('Weather enrichment failed:', error);
      }
      setWeatherStatus(t('weatherUnavailable'));
    } finally {
      setIsResolvingWeather(false);
    }
  }, [metadata.date, onUpdate, t]);

  const detectLocationAndWeather = useCallback(async () => {
    setIsResolvingLocation(true);
    setLocationStatus(t('locationResolving'));

    try {
      const detected = await geolocation.detect();
      if (!detected) {
        setLocationStatus(t('locationAutoHint'));
        return;
      }

      const coordinates = parseCoordinates(detected);
      const location = coordinates
        ? await dashboardAPI.getGeocode(coordinates.lat, coordinates.lng)
        : detected;

      if (location.trim()) {
        onUpdate({ location });
        setLocationStatus(t('locationReady'));
        await queryWeatherForLocation(location);
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('Location enrichment failed:', error);
      }
      setLocationStatus(t('locationAutoHint'));
    } finally {
      setIsResolvingLocation(false);
    }
  }, [geolocation, onUpdate, queryWeatherForLocation, t]);

  useEffect(() => {
    if (autoEnrichmentStarted.current) return;
    if (metadata.location?.trim()) return;

    autoEnrichmentStarted.current = true;
    void detectLocationAndWeather();
  }, [detectLocationAndWeather, metadata.location]);

  useEffect(() => {
    latestLocationRef.current = metadata.location ?? '';
  }, [metadata.location]);

  useEffect(() => {
    const proposal = metadataProposal.data;
    if (!proposal || proposal.mode !== 'PROPOSED') return;
    const proposalRequestId = typeof proposal.request_id === 'string' ? proposal.request_id : null;
    if (activeProposalRequestId && proposalRequestId !== activeProposalRequestId) return;

    const proposalKey = `${proposalRequestId ?? 'legacy'}:${JSON.stringify(proposal.fields ?? {})}`;
    if (seenProposalKey.current === proposalKey || lastConsumedMetadataProposalKey === proposalKey) return;

    const fields = supportedProposalFields(proposal.fields as Record<string, ProposalField>);
    if (Object.keys(fields).length === 0) return;

    const requestedAt = Date.now();
    const requestSnapshot = proposalRequestId ? requestSnapshotById.current.get(proposalRequestId) : undefined;
    if (proposalRequestId) requestSnapshotById.current.delete(proposalRequestId);
    const baseValues = requestSnapshot?.baseValues ?? {
      title: metadataFieldValue(metadata, 'title'),
      abstract: metadataFieldValue(metadata, 'abstract'),
      project: metadataFieldValue(metadata, 'project'),
      topics: metadataFieldValue(metadata, 'topics'),
      moods: metadataFieldValue(metadata, 'moods'),
      people: metadataFieldValue(metadata, 'people'),
      tags: metadataFieldValue(metadata, 'tags'),
      links: metadataFieldValue(metadata, 'links'),
    };
    const recordScope = requestSnapshot?.scope ?? draftScope;
    const recordContextIdentity = requestSnapshot?.contextIdentity ?? contextIdentity;
    const recordRevisionIdentity = requestSnapshot?.revisionIdentity ?? revisionIdentity;
    const recordRequestedAt = requestSnapshot?.requestedAt ?? requestedAt;
    const requestContextIsFresh = recordScope === draftScope
      && recordContextIdentity === contextIdentity
      && recordRevisionIdentity === revisionIdentity
      && requestedAt >= recordRequestedAt
      && requestedAt - recordRequestedAt <= METADATA_PROPOSAL_CACHE_TTL_MS;
    const evaluation = evaluateMetadataProposal(fields, baseValues, metadata);
    const patch = requestContextIsFresh ? evaluation.patch : {};
    const appliedTargets = requestContextIsFresh
      ? PROPOSAL_TARGET_FIELDS.filter((target) => evaluation.outcomes[target] === 'filled')
      : [];
    const record: CachedMetadataProposal = {
      scope: recordScope,
      contextIdentity: recordContextIdentity,
      revisionIdentity: recordRevisionIdentity,
      fields,
      baseValues,
      outcomes: evaluation.outcomes,
      appliedTargets,
      responseWasFresh: requestContextIsFresh,
      requestId: proposalRequestId,
      requestedAt: recordRequestedAt,
      savedAt: requestedAt,
    };

    seenProposalKey.current = proposalKey;
    lastConsumedMetadataProposalKey = proposalKey;
    writeMetadataProposalCache(record);
    setProposalReview({ record });
    if (Object.keys(patch).length > 0) {
      onUpdate(patch);
    }
  }, [activeProposalRequestId, contextIdentity, draftScope, metadata, metadataProposal.data, onUpdate, revisionIdentity]);

  const toggleTopic = (topic: string) => {
    const currentTopics = metadata.topics || [];
    if (currentTopics.includes(topic)) {
      onUpdate({
        topics: currentTopics.filter((t) => t !== topic),
      });
    } else {
      onUpdate({
        topics: [...currentTopics, topic],
      });
    }
  };

  const addMood = () => {
    if (newMood.trim() && !metadata.moods?.includes(newMood.trim())) {
      onUpdate({
        moods: [...(metadata.moods || []), newMood.trim()],
      });
      setNewMood('');
    }
  };

  const removeMood = (mood: string) => {
    onUpdate({
      moods: metadata.moods?.filter((m) => m !== mood) || [],
    });
  };

  const addPerson = () => {
    if (newPerson.trim() && !metadata.people?.includes(newPerson.trim())) {
      onUpdate({
        people: [...(metadata.people || []), newPerson.trim()],
      });
      setNewPerson('');
    }
  };

  const removePerson = (person: string) => {
    onUpdate({
      people: metadata.people?.filter((p) => p !== person) || [],
    });
  };

  const handleLocationChange = (value: string) => {
    latestLocationRef.current = value;
    onUpdate({ location: value });
  };

  const handleListChange = (
    key: 'topics' | 'moods' | 'people' | 'tags' | 'links',
    value: string,
  ) => {
    onUpdate({ [key]: parseListProposal(value) });
  };

  const locationHelperText = geolocation.error
    ? t('locationPermissionUnavailable')
    : locationStatus ?? t('locationAutoHint');
  const weatherHelperText = weatherStatus ?? t('weatherAutoHint');
  const unfilledProposalFields = unfilledProposalTargets
    .map((target) => t(PROPOSAL_FIELD_LABEL_KEYS[target]))
    .join(lang === 'zh' ? '、' : ', ');

  return (
    <GlassCard className="p-6 no-hover" hoverable={false} glowEffect={false}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-[var(--color-primary)]">
          {t('metadata')}
        </h3>
        <div className="relative ml-auto" data-testid="metadata-agent-action-cluster">
          <button
            type="button"
            data-testid="metadata-agent-propose-button"
            onClick={handleStatusCapsuleClick}
            disabled={metadataProposal.isPending || (!metadataAgentCanRequest && !metadataAgentHasDetails)}
            aria-expanded={metadataAgentHasDetails ? statusDetailOpen : undefined}
            aria-controls={metadataAgentHasDetails ? 'metadata-agent-status-detail' : undefined}
            title={metadataAgentCanRequest ? t('metadataAgentHint') : t('metadataAgentHintUnavailable')}
            className={`metadata-agent-status-capsule inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition-colors ${metadataStatusClass}`}
            style={{ fontFamily: 'var(--font-control)' }}
          >
            <span
              data-testid="metadata-agent-status-capsule"
              data-state={metadataAgentStatus}
              className="inline-flex items-center gap-2"
            >
              {metadataAgentStatus === 'ready' ? (
                <span
                  data-testid="metadata-agent-status-icon"
                  className="text-[1rem] leading-none"
                  aria-hidden="true"
                >
                  {metadataStatusIcon[metadataAgentStatus]}
                </span>
              ) : (
                <span
                  data-testid="metadata-agent-status-icon"
                  className={`material-symbols-outlined text-[1rem] leading-none ${metadataAgentStatus === 'extracting' ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                >
                  {metadataStatusIcon[metadataAgentStatus]}
                </span>
              )}
              <span className="font-semibold tracking-[0.02em]">
                {t('metadataAgentFill')}
              </span>
              <span className="h-4 w-px bg-current opacity-30" aria-hidden="true" />
              <span data-testid="metadata-agent-status-label" className="font-medium tracking-[0.02em]">
                {t(metadataStatusCopyKey[metadataAgentStatus])}
              </span>
            </span>
          </button>

          {statusDetailOpen && metadataIssueEnvelope && metadataAgentDetailReason && (
            <div
              id="metadata-agent-status-detail"
              data-testid="metadata-agent-status-detail"
              role="dialog"
              aria-label={t(metadataDetailCopyKey)}
              className="absolute right-0 top-[calc(100%+0.75rem)] z-30 max-h-[min(28rem,calc(100vh-8rem))] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-white/[0.08] bg-[var(--color-ether-panel)] p-4 text-left shadow-2xl backdrop-blur-md"
              style={{ fontFamily: 'var(--font-order)' }}
            >
              <p className="text-sm font-semibold text-[var(--color-primary)]" style={{ fontFamily: 'var(--font-control)' }}>
                {t(metadataDetailCopyKey)}
              </p>
              {metadataAgentTiming && (
                <p className="mt-2 text-xs text-[var(--color-muted)]">
                  {metadataAgentTiming}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="metadata-agent-status-retry"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleRequestProposal();
                  }}
                  className="rounded-full border border-[var(--color-cyan)]/30 px-3 py-1.5 text-xs text-[var(--color-cyan)] transition-colors hover:border-[var(--color-cyan)]/50 hover:bg-[var(--color-cyan-15)]"
                >
                  {t('metadataAgentStatusRetry')}
                </button>
                <button
                  type="button"
                  data-testid="metadata-agent-status-copy"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleCopyMetadataDetails();
                  }}
                  className="rounded-full border border-white/[0.08] px-3 py-1.5 text-xs text-[var(--color-muted)] transition-colors hover:border-white/[0.16] hover:text-[var(--color-primary)]"
                >
                  {t('metadataAgentStatusCopyDetails')}
                </button>
              </div>
            </div>
          )}

          {statusDetailOpen && !metadataIssueEnvelope && proposalReview && (
            <section
              id="metadata-agent-status-detail"
              data-testid="metadata-proposal-panel"
              role="dialog"
              aria-label={t('metadataProposalReviewTitle')}
              className="absolute right-0 top-[calc(100%+0.75rem)] z-30 max-h-[min(28rem,calc(100vh-8rem))] w-[min(26rem,calc(100vw-2rem))] space-y-3 overflow-y-auto rounded-2xl border border-white/[0.08] bg-[var(--color-ether-panel)] p-4 text-left shadow-2xl backdrop-blur-md"
              style={{ fontFamily: 'var(--font-order)' }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-[var(--color-cyan)]">
                  {t('metadataProposalReviewTitle')}
                </h4>
                <span
                  data-testid="metadata-proposal-context-status"
                  className={`text-xs ${proposalContextStale ? 'text-[var(--color-coral)]' : 'text-[var(--color-muted)]'}`}
                >
                  {proposalContextStale ? t('metadataProposalStale') : t('metadataProposalCached')}
                </span>
              </div>

              {Object.entries(proposalReview.record.fields).map(([fieldName, field]) => {
                const target = proposalTargetField(fieldName);
                if (!target) return null;
                const recordedStatus = proposalReview.record.outcomes[target];
                const currentValue = metadataFieldValue(metadata, target);
                const status: ProposalFieldStatus = proposalContextStale
                  ? 'stale'
                  : proposalValueIsEmpty(currentValue)
                    ? 'not-filled'
                    : recordedStatus === 'not-filled'
                      ? 'preserved'
                      : recordedStatus;
                const formattedCurrentValue = formatDraftValue(currentValue);
                const proposedValue = formatProposalValue(field.value);
                const statusCopy = status === 'stale'
                  ? t('metadataProposalStale')
                  : status === 'filled'
                    ? t('metadataProposalFilled')
                    : status === 'preserved'
                      ? t('metadataProposalPreserved')
                      : t('metadataProposalNotFilled');

                return (
                  <div
                    key={fieldName}
                    data-testid={`metadata-proposal-field-${fieldName}`}
                    className="rounded-xl border border-white/[0.08] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-primary)]">
                        {t(PROPOSAL_FIELD_LABEL_KEYS[target])}
                      </span>
                      <span
                        data-testid={`metadata-proposal-status-${fieldName}`}
                        className={`text-xs ${status === 'stale' ? 'text-[var(--color-coral)]' : status === 'filled' ? 'text-[var(--color-green)]' : 'text-[var(--color-muted)]'}`}
                      >
                        {statusCopy}
                      </span>
                    </div>
                    <div
                      data-testid={`metadata-proposal-diff-${fieldName}`}
                      className="mt-2 grid gap-2 text-xs text-[var(--color-secondary)] sm:grid-cols-2"
                    >
                      <div>
                        <span className="block text-[var(--color-muted)]">{t('metadataProposalCurrent')}</span>
                        <span className="break-words text-[var(--color-primary)]">{formattedCurrentValue || '—'}</span>
                      </div>
                      <div>
                        <span className="block text-[var(--color-muted)]">{t('metadataProposalProposed')}</span>
                        <span className="break-words text-[var(--color-cyan)]">{proposedValue || '—'}</span>
                      </div>
                    </div>
                    {(field.field_source || typeof field.confidence === 'number' || field.rationale) && (
                      <div className="mt-2 space-y-1 text-xs text-[var(--color-secondary)]">
                        {field.field_source && <p><span className="text-[var(--color-muted)]">{t('metadataProposalSource')}: </span>{field.field_source}</p>}
                        {typeof field.confidence === 'number' && Number.isFinite(field.confidence) && (
                          <p><span className="text-[var(--color-muted)]">{t('metadataProposalConfidence')}: </span>{Math.round(field.confidence * 100)}%</p>
                        )}
                        {field.rationale && <p><span className="text-[var(--color-muted)]">{t('metadataProposalRationale')}: </span>{field.rationale}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          )}
        </div>
      </div>

      {unfilledProposalFields && (
        <p
          data-testid="metadata-agent-unfilled-summary"
          role="status"
          className="mb-5 text-right text-xs text-[var(--color-muted)]"
        >
          {t('metadataAgentUnfilledSummary', { fields: unfilledProposalFields })}
        </p>
      )}

      <div className="space-y-5">
        {/* Title */}
        <div>
          <label htmlFor="metadata-title" className="text-[var(--text-label)] text-[var(--color-muted)] mb-2 block" style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.08em' }}>{t('titleLabel')}</label>
          <input
            id="metadata-title"
            type="text"
            value={metadata.title || ''}
            onChange={(e) => onUpdate({ title: e.target.value })}
            placeholder={t('recordPlaceholder')}
            maxLength={TITLE_MAX_LENGTH}
            aria-describedby="metadata-title-limit"
            data-editor-title
            className="li-field-placeholder w-full px-4 py-2.5 bg-[var(--color-ether-surface-ghost)] border border-white/[0.06] rounded-xl text-[var(--color-primary)] text-sm focus:outline-none focus:border-[var(--color-gold)]/50 hover:border-[var(--color-gold)]/30 transition-colors placeholder:text-[var(--color-secondary)]"
          />
          <p
            id="metadata-title-limit"
            className="mt-1.5 text-right text-[var(--text-caption)] text-[var(--color-muted)]"
          >
            {t('titleCharacterLimit', {
              current: (metadata.title || '').length,
              max: TITLE_MAX_LENGTH,
            })}
          </p>
        </div>

        {/* Abstract */}
        <div>
          <label htmlFor="metadata-abstract" className="text-[var(--text-label)] text-[var(--color-muted)] mb-2 block" style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.08em' }}>
            {t('abstractLabel')}
          </label>
          <textarea
            id="metadata-abstract"
            value={metadata.abstract || ''}
            onChange={(e) => onUpdate({ abstract: e.target.value })}
            rows={3}
            className="li-field-placeholder w-full resize-y px-4 py-2.5 bg-[var(--color-ether-surface-ghost)] border border-white/[0.06] rounded-xl text-[var(--color-primary)] text-sm focus:outline-none focus:border-[var(--color-gold)]/50 hover:border-[var(--color-gold)]/30 transition-colors placeholder:text-[var(--color-secondary)]"
          />
        </div>

        {/* Date */}
        <div>
          <label htmlFor="metadata-date" className="text-[var(--text-label)] text-[var(--color-muted)] mb-2 block" style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.08em' }}>{t('date')}</label>
          <input
            id="metadata-date"
            type="date"
            value={metadata.date}
            onChange={(e) => onUpdate({ date: e.target.value })}
            className="w-full px-4 py-2.5 bg-[var(--color-ether-surface-ghost)] border border-white/[0.06] rounded-xl text-[var(--color-primary)] text-sm focus:outline-none focus:border-[var(--color-gold)]/50 hover:border-[var(--color-gold)]/30 transition-colors"
          />
        </div>

        {/* Topics */}
        <div>
          <label htmlFor="metadata-topics-list" className="text-[var(--text-label)] text-[var(--color-muted)] mb-2 block" style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.08em' }}>{t('topics')}</label>
          <input
            id="metadata-topics-list"
            type="text"
            value={(metadata.topics || []).join(', ')}
            onChange={(e) => handleListChange('topics', e.target.value)}
            className="li-field-placeholder mb-2 w-full px-4 py-2 bg-[var(--color-ether-surface-ghost)] border border-white/[0.06] rounded-xl text-[var(--color-primary)] text-sm focus:outline-none focus:border-[var(--color-gold)]/50 hover:border-[var(--color-gold)]/30 transition-colors placeholder:text-[var(--color-secondary)]"
          />
          <div className="flex flex-wrap gap-2">
            {TOPICS.map((topic) => (
              <button
                key={topic.key}
                type="button"
                onClick={() => toggleTopic(topic.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  metadata.topics?.includes(topic.key)
                    ? 'bg-[var(--color-gold)]/20 text-[var(--color-gold)] border border-[var(--color-gold)]/30'
                    : 'bg-[var(--color-ether-surface-ghost)] text-[var(--color-muted)] border border-white/[0.06] hover:bg-[var(--color-ether-control)]'
                }`}
              >
                {t(topic.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Moods */}
        <div>
          <label htmlFor="metadata-mood" className="text-[var(--text-label)] text-[var(--color-muted)] mb-2 block" style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.08em' }}>
            {t('moods')}
          </label>
          <div className="flex gap-2 mb-2">
            <input
              id="metadata-mood"
              type="text"
              value={newMood}
              onChange={(e) => setNewMood(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addMood())}
              placeholder={t('moodInputPlaceholder')}
              className="li-field-placeholder flex-1 px-4 py-2 bg-[var(--color-ether-surface-ghost)] border border-white/[0.06] rounded-xl text-[var(--color-primary)] text-sm focus:outline-none focus:border-[var(--color-gold)]/50 hover:border-[var(--color-gold)]/30 transition-colors placeholder:text-[var(--color-secondary)]"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {metadata.moods?.map((mood) => (
              <span
                key={mood}
                className="inline-flex items-center gap-1 px-3 py-1 bg-[var(--color-cyan)]/20 text-[var(--color-cyan)] rounded-full text-xs border border-[var(--color-cyan)]/30"
              >
                {mood}
                <button
                  type="button"
                  onClick={() => removeMood(mood)}
                  className="text-[var(--color-cyan)]/70 hover:text-[var(--color-cyan)] transition-colors"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div>
          <label htmlFor="metadata-tags" className="text-[var(--text-label)] text-[var(--color-muted)] mb-2 block" style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.08em' }}>
            {t('tagsLabel')}
          </label>
          <input
            id="metadata-tags"
            type="text"
            value={(metadata.tags || []).join(', ')}
            onChange={(e) => handleListChange('tags', e.target.value)}
            className="li-field-placeholder w-full px-4 py-2 bg-[var(--color-ether-surface-ghost)] border border-white/[0.06] rounded-xl text-[var(--color-primary)] text-sm focus:outline-none focus:border-[var(--color-gold)]/50 hover:border-[var(--color-gold)]/30 transition-colors placeholder:text-[var(--color-secondary)]"
          />
        </div>

        {/* Location + Weather */}
        <div className="grid grid-cols-2 max-[640px]:grid-cols-1 gap-4">
          <div>
            <div className="text-[var(--text-label)] text-[var(--color-muted)] mb-2 flex items-center gap-1" style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.08em' }}>
              <label htmlFor="metadata-location">{t('locationLabel')}</label>
              <button
                type="button"
                onClick={() => void detectLocationAndWeather()}
                disabled={isResolvingLocation || geolocation.loading}
                className="ml-auto text-xs text-[var(--color-cyan)]/70 hover:text-[var(--color-cyan)] transition-colors disabled:opacity-50"
                title={t('locationDetectHint')}
                data-action="detect-location"
              >
                {isResolvingLocation || geolocation.loading ? '...' : t('locate')}
              </button>
            </div>
            <input
              id="metadata-location"
              type="text"
              value={metadata.location || ''}
              onChange={(e) => handleLocationChange(e.target.value)}
              placeholder={t('locationManualPlaceholder')}
              className="li-field-placeholder w-full px-4 py-2.5 bg-[var(--color-ether-surface-ghost)] border border-white/[0.06] rounded-xl text-[var(--color-primary)] text-sm focus:outline-none focus:border-[var(--color-gold)]/50 hover:border-[var(--color-gold)]/30 transition-colors placeholder:text-[var(--color-secondary)]"
            />
            <p className="text-xs text-[var(--color-secondary)] mt-1" role="status">{locationHelperText}</p>
          </div>

          <div>
            <div className="text-[var(--text-label)] text-[var(--color-muted)] mb-2 flex items-center gap-1" style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.08em' }}>
              <label htmlFor="metadata-weather">{t('weatherLabel')}</label>
              <button
                type="button"
                onClick={() => void queryWeatherForLocation()}
                disabled={isResolvingWeather || !metadata.location?.trim()}
                className="ml-auto text-xs text-[var(--color-cyan)]/70 hover:text-[var(--color-cyan)] transition-colors disabled:opacity-50"
                title={t('weatherQueryHint')}
                data-action="query-weather"
              >
                {isResolvingWeather ? '...' : t('query')}
              </button>
            </div>
            <input
              id="metadata-weather"
              type="text"
              value={metadata.weather || ''}
              onChange={(e) => onUpdate({ weather: e.target.value })}
              placeholder={t('weatherPlaceholder')}
              className="li-field-placeholder w-full px-4 py-2.5 bg-[var(--color-ether-surface-ghost)] border border-white/[0.06] rounded-xl text-[var(--color-primary)] text-sm focus:outline-none focus:border-[var(--color-gold)]/50 hover:border-[var(--color-gold)]/30 transition-colors placeholder:text-[var(--color-secondary)]"
            />
            <p className="text-xs text-[var(--color-secondary)] mt-1" role="status">{weatherHelperText}</p>
          </div>
        </div>

        {/* People + Project */}
        <div className="grid grid-cols-2 max-[640px]:grid-cols-1 gap-4">
          <div>
            <label htmlFor="metadata-person" className="text-[var(--text-label)] text-[var(--color-muted)] mb-2 block" style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.08em' }}>{t('people')}</label>
            <div className="flex gap-2 mb-2">
              <input
                id="metadata-person"
                type="text"
                value={newPerson}
                onChange={(e) => setNewPerson(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addPerson())}
                placeholder="Name..."
                className="li-field-placeholder flex-1 px-4 py-2 bg-[var(--color-ether-surface-ghost)] border border-white/[0.06] rounded-xl text-[var(--color-primary)] text-sm focus:outline-none focus:border-[var(--color-gold)]/50 hover:border-[var(--color-gold)]/30 transition-colors placeholder:text-[var(--color-secondary)]"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {metadata.people?.map((person) => (
                <span
                  key={person}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--color-cyan)]/30 bg-[var(--color-cyan-15)] px-3 py-1 text-xs text-[var(--color-cyan)]"
                >
                  {person}
                  <button
                    type="button"
                    onClick={() => removePerson(person)}
                    className="text-[var(--color-muted)] hover:text-[var(--color-coral)] transition-colors"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="metadata-project" className="text-[var(--text-label)] text-[var(--color-muted)] mb-2 block" style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.08em' }}>{t('project')}</label>
            <input
              id="metadata-project"
              type="text"
              value={metadata.project || ''}
              onChange={(e) => onUpdate({ project: e.target.value })}
              placeholder="Project..."
              className="li-field-placeholder w-full px-4 py-2.5 bg-[var(--color-ether-surface-ghost)] border border-white/[0.06] rounded-xl text-[var(--color-primary)] text-sm focus:outline-none focus:border-[var(--color-gold)]/50 hover:border-[var(--color-gold)]/30 transition-colors placeholder:text-[var(--color-secondary)]"
            />
          </div>
        </div>

        {/* Links */}
        <div>
          <label htmlFor="metadata-links" className="text-[var(--text-label)] text-[var(--color-muted)] mb-2 block" style={{ fontFamily: 'var(--font-order)', letterSpacing: '0.08em' }}>
            {t('linksLabel')}
          </label>
          <input
            id="metadata-links"
            type="text"
            value={(metadata.links || []).join(', ')}
            onChange={(e) => handleListChange('links', e.target.value)}
            className="li-field-placeholder w-full px-4 py-2 bg-[var(--color-ether-surface-ghost)] border border-white/[0.06] rounded-xl text-[var(--color-primary)] text-sm focus:outline-none focus:border-[var(--color-gold)]/50 hover:border-[var(--color-gold)]/30 transition-colors placeholder:text-[var(--color-secondary)]"
          />
        </div>
      </div>
    </GlassCard>
  );
}
