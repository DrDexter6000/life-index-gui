import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  journalAPI,
  dashboardAPI,
  healthAPI,
  indexDiagnosticsAPI,
  entityAPI,
  entityMaintenanceAPI,
  type CreateJournalRequest,
  type UpdateJournalRequest,
  type SearchParams,
  type EntityMutationRequest,
} from '@/lib/api-client';

// Query keys for cache management
export const journalKeys = {
  all: ['journals'] as const,
  lists: () => [...journalKeys.all, 'list'] as const,
  list: (filters: SearchParams) => [...journalKeys.lists(), filters] as const,
  details: () => [...journalKeys.all, 'detail'] as const,
  detail: (id: string) => [...journalKeys.details(), id] as const,
};

export const dashboardKeys = {
  all: ['dashboard'] as const,
  stats: () => [...dashboardKeys.all, 'stats'] as const,
  recent: (limit?: number) => [...dashboardKeys.all, 'recent', limit] as const,
  heatmap: () => [...dashboardKeys.all, 'heatmap'] as const,
  topics: () => [...dashboardKeys.all, 'topics'] as const,
  moods: () => [...dashboardKeys.all, 'moods'] as const,
};

/**
 * Hook for fetching dashboard statistics
 */
export function useDashboardStats() {
  return useQuery({
    queryKey: dashboardKeys.stats(),
    queryFn: () => dashboardAPI.getStats(),
    staleTime: 30 * 1000, // 30 seconds
    retry: 1,
  });
}

/**
 * Hook for fetching recent journals
 */
export function useRecentJournals(limit?: number) {
  return useQuery({
    queryKey: dashboardKeys.recent(limit),
    queryFn: () => dashboardAPI.getRecent(limit),
    staleTime: 30 * 1000,
    retry: 1,
  });
}

/**
 * Hook for fetching a single journal by ID
 */
export function useJournal(id: string) {
  return useQuery({
    queryKey: journalKeys.detail(id),
    queryFn: () => journalAPI.getById(id),
    enabled: !!id,
    staleTime: 60 * 1000, // 1 minute
    retry: 1,
  });
}

/**
 * Hook for fetching all journals
 */
export function useJournals() {
  return useQuery({
    queryKey: journalKeys.lists(),
    queryFn: () => journalAPI.getAll(),
    staleTime: 30 * 1000,
    retry: 1,
  });
}

/**
 * Hook for searching journals
 */
export function useJournalSearch(params: SearchParams) {
  const hasCriteria = Boolean(
    params.query?.length
    || params.dateStart
    || params.dateEnd
    || params.topics?.length
    || params.moods?.length
    || params.people?.length,
  );

  return useQuery({
    queryKey: journalKeys.list(params),
    queryFn: () => journalAPI.search(params),
    enabled: hasCriteria,
    staleTime: 30 * 1000,
    retry: 1,
  });
}

/**
 * Hook for fetching monthly heatmap data
 * Calls GET /api/heatmap?year=YYYY&month=MM
 */
export function useHeatmapData(year: number, month: number) {
  return useQuery({
    queryKey: [...dashboardKeys.heatmap(), year, month],
    queryFn: () => dashboardAPI.getHeatmap(year, month),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/**
 * Hook for fetching topic distribution
 */
export function useTopicDistribution() {
  return useQuery({
    queryKey: dashboardKeys.topics(),
    queryFn: () => dashboardAPI.getTopics(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/**
 * Hook for fetching mood frequency
 */
export function useMoodFrequency() {
  return useQuery({
    queryKey: dashboardKeys.moods(),
    queryFn: () => dashboardAPI.getMoods(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/**
 * Hook for creating a new journal
 */
export function useCreateJournal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateJournalRequest) => journalAPI.create(data),
    retry: false,
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: journalKeys.lists() });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.stats() });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.recent() });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.heatmap() });
    },
  });
}

/**
 * Hook for updating a journal
 */
export function useUpdateJournal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateJournalRequest }) =>
      journalAPI.update(id, data),
    retry: false,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: journalKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: journalKeys.lists() });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.recent() });
    },
  });
}

/**
 * Hook for deleting a journal
 * TODO: Implement when backend delete endpoint is ready
 */
export function useDeleteJournal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (_id: string) => {
      // Delete not yet implemented in backend
      throw new Error('Delete not yet implemented');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: journalKeys.lists() });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.stats() });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.recent() });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.heatmap() });
    },
  });
}

// ── Health query keys and hooks (S2 — Health Center) ───────────────────────

export const healthKeys = {
  check: () => ['health', 'check'] as const,
  version: () => ['health', 'version'] as const,
  dataAudit: () => ['health', 'data-audit'] as const,
};

export const indexDiagnosticsKeys = {
  all: ['index-diagnostics'] as const,
  check: () => [...indexDiagnosticsKeys.all, 'check'] as const,
  verify: () => [...indexDiagnosticsKeys.all, 'verify'] as const,
  cacheDryRun: () => [...indexDiagnosticsKeys.all, 'cache-dry-run'] as const,
};

export const entityKeys = {
  all: ['entities'] as const,
  stats: () => [...entityKeys.all, 'stats'] as const,
  list: (type?: string) => [...entityKeys.all, 'list', type] as const,
  profile: (id?: string) => [...entityKeys.all, 'profile', id] as const,
  check: () => [...entityKeys.all, 'check'] as const,
  audit: () => [...entityKeys.all, 'audit'] as const,
  review: () => [...entityKeys.all, 'review'] as const,
  candidateEdges: (limit?: number) => [...entityKeys.all, 'candidate-edges', limit] as const,
  mutations: () => [...entityKeys.all, 'mutations'] as const,
};

/**
 * Hook for fetching CLI health status.
 * Independent of journal/search queries — degradation does not block M1 flows.
 */
export function useHealthCheck() {
  return useQuery({
    queryKey: healthKeys.check(),
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), 10000);
      signal.addEventListener('abort', () => controller.abort(), { once: true });

      try {
        return await healthAPI.getHealth({ signal: controller.signal });
      } finally {
        globalThis.clearTimeout(timeout);
      }
    },
    staleTime: 30 * 1000,
    retry: 1,
  });
}

/**
 * Hook for fetching GUI/CLI version compatibility metadata.
 */
export function useVersionCheck() {
  return useQuery({
    queryKey: healthKeys.version(),
    queryFn: () => healthAPI.getVersion(),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/**
 * Hook for fetching CLI data-audit diagnostics.
 * Read-only surface; anomalies are informational, not blocking.
 */
export function useDataAudit() {
  return useQuery({
    queryKey: healthKeys.dataAudit(),
    queryFn: () => healthAPI.getDataAudit(),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/**
 * Hook for fetching read-only CLI index health diagnostics.
 */
export function useIndexCheck() {
  return useQuery({
    queryKey: indexDiagnosticsKeys.check(),
    queryFn: () => indexDiagnosticsAPI.getIndexCheck(),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/**
 * Hook for fetching read-only CLI verify diagnostics.
 */
export function useIndexVerify() {
  return useQuery({
    queryKey: indexDiagnosticsKeys.verify(),
    queryFn: () => indexDiagnosticsAPI.getVerify(),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/**
 * Hook for fetching read-only cache dry-run metadata diagnostics.
 */
export function useIndexCacheDryRun() {
  return useQuery({
    queryKey: indexDiagnosticsKeys.cacheDryRun(),
    queryFn: () => indexDiagnosticsAPI.getCacheDryRun(),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

// ── Entity graph hooks (S4 — Entity Inspection) ────────────────────────

/**
 * Hook for fetching entity graph statistics.
 */
export function useEntityStats() {
  return useQuery({
    queryKey: entityKeys.stats(),
    queryFn: () => entityAPI.getStats(),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/**
 * Hook for listing entities with optional type filter.
 */
export function useEntityList(type?: string) {
  return useQuery({
    queryKey: entityKeys.list(type),
    queryFn: () => entityAPI.listEntities(type),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/**
 * Hook for fetching entity graph integrity check.
 */
export function useEntityCheck() {
  return useQuery({
    queryKey: entityKeys.check(),
    queryFn: () => entityAPI.getCheck(),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/**
 * Hook for fetching entity quality audit findings.
 */
export function useEntityAudit() {
  return useQuery({
    queryKey: entityKeys.audit(),
    queryFn: () => entityAPI.getAudit(),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/**
 * Hook for fetching entity review/curation queue.
 */
export function useEntityReview() {
  return useQuery({
    queryKey: entityKeys.review(),
    queryFn: () => entityAPI.getReview(),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/**
 * Hook for fetching capped candidate relationship edges.
 */
export function useEntityCandidateEdges(limit?: number) {
  return useQuery({
    queryKey: entityKeys.candidateEdges(limit),
    queryFn: () => entityAPI.getCandidateEdges(limit),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/**
 * Hook for fetching a confirmed entity profile by stable id.
 */
export function useEntityProfile(id?: string) {
  return useQuery({
    queryKey: entityKeys.profile(id),
    queryFn: () => entityAPI.getProfile({ id: id ?? '' }),
    enabled: Boolean(id),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

// ── Entity mutation hooks (S5 — Guarded Entity Mutation UX) ────────────────

/**
 * Hook for previewing a supported entity mutation (delete or merge_as_alias).
 * Does not modify the graph; returns a preview for user confirmation.
 */
export function useEntityMutationPreview() {
  return useMutation({
    mutationFn: (req: EntityMutationRequest) =>
      entityMaintenanceAPI.previewMutation(req),
  });
}

/**
 * Hook for confirming a previewed entity mutation.
 * Requires the caller to have already shown preview evidence to the user.
 * Sends `previewAccepted: true`, executes serialized CLI mutation, then runs
 * `entity --check`. Invalidates all entity queries on success.
 */
export function useEntityMutationConfirm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: EntityMutationRequest) =>
      entityMaintenanceAPI.confirmMutation(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entityKeys.all });
    },
  });
}
