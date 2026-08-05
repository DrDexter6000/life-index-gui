import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  importAPI,
  APIClientError,
  type ImportPlanRequest,
  type ImportValidateRequest,
  type ImportStageRequest,
  type ImportReviewsListParams,
  type ImportReviewQueueParams,
  type ImportEditableJournal,
  type ImportReviewDecision,
} from '@/lib/api-client';

// ── Import query keys ──────────────────────────────────────────────────────

export const importKeys = {
  all: ['imports'] as const,
  plan: () => [...importKeys.all, 'plan'] as const,
  run: () => [...importKeys.all, 'run'] as const,
  status: (importId: string) => [...importKeys.all, 'status', importId] as const,
  rollback: () => [...importKeys.all, 'rollback'] as const,
  // ── M7 historical-photo review surface ─────────────────────────────────
  // Every review query/mutation key sits under ['imports', 'reviews', ...]
  // so invalidating `reviews()` refetches the whole CLI-authoritative scope
  // while preserving each active query's own variables (offset/limit/states).
  reviews: () => [...importKeys.all, 'reviews'] as const,
  reviewsList: (params: ImportReviewsListParams = {}) =>
    [...importKeys.reviews(), 'list', params] as const,
  reviewQueue: (parentId: string, params: ImportReviewQueueParams = {}) =>
    [...importKeys.reviews(), 'queue', parentId, params] as const,
  reviewQueueAll: (parentId: string) =>
    [...importKeys.reviews(), 'queue', parentId] as const,
  reviewStatus: (parentId: string) => [...importKeys.reviews(), 'status', parentId] as const,
};

// ── Terminal states for status polling ─────────────────────────────────────
// Polling stops when state reaches one of these values.

const IMPORT_TERMINAL_STATES = new Set([
  'committed',
  'failed',
  'rolled_back',
  'partially_committed',
  'partial_rollback',
]);

function isTerminalState(state: string | undefined): boolean {
  return IMPORT_TERMINAL_STATES.has(state ?? '');
}

// ── Import hooks ───────────────────────────────────────────────────────────

/**
 * Hook for triggering an import plan (dry-run preview).
 * useMutation — call mutate({ source, input_path }) to trigger.
 */
export function useImportPlan() {
  return useMutation({
    mutationFn: (req: ImportPlanRequest) => importAPI.plan(req),
  });
}

/**
 * Hook for running a confirmed import.
 * Sends only { import_id } — no backend temp file path or filesystem paths.
 */
export function useImportRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (importId: string) => importAPI.run(importId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: importKeys.all });
    },
  });
}

/**
 * Hook for polling import job status.
 * Polling continues while state is non-terminal and stops once a terminal
 * state is reached (committed, failed, rolled_back, partially_committed,
 * partial_rollback).
 */
export function useImportStatus(importId: string | undefined) {
  return useQuery({
    queryKey: importKeys.status(importId ?? ''),
    queryFn: () => importAPI.getStatus(importId!),
    enabled: !!importId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && isTerminalState(data.state)) {
        return false;
      }
      return 3000;
    },
    staleTime: 0,
    retry: 1,
  });
}

/**
 * Hook for rolling back an import job.
 */
export function useImportRollback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (importId: string) => importAPI.rollback(importId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: importKeys.all });
    },
  });
}

// ── M7 historical-photo review hooks ──────────────────────────────────────
// The frozen CLI import job stays the sole durable authority. Queue counts
// and `queue_revision` are read from the server — never derived locally.
// On a revision conflict the SAME parent + filters + offset page is refetched
// (not page zero). Mutations invalidate CLI-authoritative data instead of
// optimistically rewriting proposal states. No durable browser storage is
// created anywhere in this surface (no localStorage / sessionStorage /
// IndexedDB / Zustand mirror).

/**
 * Discover persisted parent review jobs (read-only). GET /api/imports/reviews
 */
export function useReviewsList(params: ImportReviewsListParams = {}) {
  return useQuery({
    queryKey: importKeys.reviewsList(params),
    queryFn: () => importAPI.listReviews(params),
    staleTime: 0,
  });
}

/**
 * Bounded read of one parent's review queue (read-only).
 * GET /api/imports/reviews/{parent}?offset&limit&state...
 * Disabled until a parent id is known. `queue_counts.confirmed` is read
 * verbatim from the server response.
 */
export function useReviewQueue(parentId?: string, params: ImportReviewQueueParams = {}) {
  return useQuery({
    queryKey: importKeys.reviewQueue(parentId ?? '', params),
    queryFn: () => importAPI.reviewQueue(parentId!, params),
    enabled: !!parentId,
    staleTime: 0,
  });
}

/**
 * Review-parent status (read-only). GET /api/imports/reviews/{parent}/status
 */
export function useReviewStatus(parentId?: string) {
  return useQuery({
    queryKey: importKeys.reviewStatus(parentId ?? ''),
    queryFn: () => importAPI.reviewStatus(parentId!),
    enabled: !!parentId,
    staleTime: 0,
  });
}

/**
 * Validate a photo source root (read-only). POST /api/imports/validate
 */
export function useValidateSource() {
  return useMutation({
    mutationFn: (req: ImportValidateRequest) => importAPI.validate(req),
  });
}

/**
 * Stage a photo review (plan + stage). POST /api/imports/reviews/stage
 *
 * Staging creates a new review parent, so the discovery list is the surface
 * that must be refreshed — the queue/status of any one parent is unaffected.
 */
export function useStageReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: ImportStageRequest) => importAPI.stageReview(req),
    onSuccess: () => {
      // Refresh the reviews-list scope (every parent job) without touching any
      // active queue offset.
      queryClient.invalidateQueries({ queryKey: [...importKeys.reviews(), 'list'] });
    },
  });
}

/**
 * Re-bind a review parent to a source root.
 * POST /api/imports/reviews/{parent}/rebind — re-binding can reshape the
 * proposals, so the discovery list, every page of this parent's queue, and this
 * parent's status are all refreshed. No active offset is reset to page zero:
 * only existing pages are invalidated.
 */
export function useRebindReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (vars: { parentId: string; sourceRoot: string }) =>
      importAPI.rebindReview(vars.parentId, { source_root: vars.sourceRoot }),
    onSuccess: async (_data, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [...importKeys.reviews(), 'list'],
          refetchType: 'active',
        }),
        queryClient.invalidateQueries({
          queryKey: importKeys.reviewQueueAll(vars.parentId),
          refetchType: 'active',
        }, {
          throwOnError: true,
        }),
        queryClient.invalidateQueries({
          queryKey: importKeys.reviewStatus(vars.parentId),
          refetchType: 'active',
        }),
      ]);
    },
  });
}

/** Variables accepted by {@link useConfirmEdit}. */
export interface ConfirmEditVariables {
  parentId: string;
  expectedQueueRevision: number;
  proposalId: string;
  decision: ImportReviewDecision;
  journal?: ImportEditableJournal;
  selectedAttachmentIds?: string[];
  /**
   * The active queue page (parent + filters + offset) the caller is operating
   * on. When present, success and revision-conflict both refetch THIS page
   * (refetchType 'active') rather than resetting to page zero.
   */
  queuePage?: ImportReviewQueueParams;
}

function isReviewAuthorityError(error: unknown): boolean {
  if (!(error instanceof APIClientError)) return false;
  const reason = typeof error.details?.reason === 'string'
    ? error.details.reason
    : null;
  return error.code === 'IMPORT_REVIEW_RECOVERY_REQUIRED'
    || error.code === 'IMPORT_RECOVERY_REQUIRED'
    || error.code === 'IMPORT_BATCH_ALREADY_ACTIVE'
    || reason === 'recovery_required'
    || reason === 'batch_active'
    || error.details?.recovery_required === true
    || typeof error.details?.active_child_id === 'string';
}

async function invalidateReviewAuthority(
  queryClient: ReturnType<typeof useQueryClient>,
  parentId: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: [...importKeys.reviews(), 'list'],
      refetchType: 'active',
    }),
    queryClient.invalidateQueries({
      queryKey: importKeys.reviewQueueAll(parentId),
      refetchType: 'active',
    }),
    queryClient.invalidateQueries({
      queryKey: importKeys.reviewStatus(parentId),
      refetchType: 'active',
    }),
  ]);
}

/**
 * Invalidate the authoritative surfaces a confirm-edit touched. The discovery
 * list and this parent's status are ALWAYS refreshed. The queue is handled
 * without resetting the active offset: when `queuePage` is known, the EXACT
 * parent + filters + offset page is invalidated with an active refetch (never
 * page zero); otherwise this parent's whole queue prefix is invalidated. Never
 * sets query data — the CLI is authoritative and the server must be re-read.
 */
async function invalidateReviewPage(
  queryClient: ReturnType<typeof useQueryClient>,
  vars: ConfirmEditVariables,
) {
  const refreshes = [
    queryClient.invalidateQueries({
      queryKey: [...importKeys.reviews(), 'list'],
      refetchType: 'active',
    }),
    queryClient.invalidateQueries({
      queryKey: importKeys.reviewStatus(vars.parentId),
      refetchType: 'active',
    }),
  ];

  if (vars.queuePage) {
    refreshes.push(queryClient.invalidateQueries({
      queryKey: importKeys.reviewQueue(vars.parentId, vars.queuePage),
      refetchType: 'active',
    }));
  } else {
    refreshes.push(queryClient.invalidateQueries({
      queryKey: importKeys.reviewQueueAll(vars.parentId),
      refetchType: 'active',
    }));
  }

  await Promise.all(refreshes);
}

/**
 * Atomic single-proposal edit.
 * POST /api/imports/reviews/{parent}/confirm-edit
 *
 * On success — and on `IMPORT_REVIEW_REVISION_CONFLICT` (the server rejected a
 * stale revision) — the SAME parent + filters + offset page is refetched (never
 * page zero) so the UI can read the current `queue_revision` / counts, plus the
 * reviews-list scope and this parent's status. See {@link invalidateReviewPage}.
 */
export function useConfirmEdit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (vars: ConfirmEditVariables) =>
      importAPI.confirmEdit(vars.parentId, {
        expected_queue_revision: vars.expectedQueueRevision,
        proposal_id: vars.proposalId,
        decision: vars.decision,
        journal: vars.journal,
        selected_attachment_ids: vars.selectedAttachmentIds,
      }),
    onSuccess: async (_data, vars) => {
      await invalidateReviewPage(queryClient, vars);
    },
    onError: async (error, vars) => {
      if (
        (
          error instanceof APIClientError
          && error.code === 'IMPORT_REVIEW_REVISION_CONFLICT'
        )
        || isReviewAuthorityError(error)
      ) {
        await invalidateReviewPage(queryClient, vars);
      }
    },
  });
}

/**
 * Run a child batch off the staged source root.
 * POST /api/imports/reviews/{parent}/batch-run — invalidates CLI-authoritative
 * review data; never optimistically marks proposals as imported.
 */
export function useBatchRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (parentId: string) => importAPI.batchRun(parentId),
    onSettled: async (_data, _error, parentId) => {
      await invalidateReviewAuthority(queryClient, parentId);
    },
  });
}

/**
 * Roll back a child batch by id (the id travels in the JSON body, never a path
 * segment, because it contains '#'). Invalidates CLI-authoritative review data;
 * never optimistically rewrites proposal states.
 */
export function useChildRollback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (childId: string) => importAPI.childRollback(childId),
    onSuccess: async (_data, childId) => {
      const separator = childId.lastIndexOf('#');
      const parentId = separator > 0 ? childId.slice(0, separator) : childId;
      await invalidateReviewAuthority(queryClient, parentId);
    },
  });
}
