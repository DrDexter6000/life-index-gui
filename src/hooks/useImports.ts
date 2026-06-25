import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  importAPI,
  type ImportPlanRequest,
} from '@/lib/api-client';

// ── Import query keys ──────────────────────────────────────────────────────

export const importKeys = {
  all: ['imports'] as const,
  plan: () => [...importKeys.all, 'plan'] as const,
  run: () => [...importKeys.all, 'run'] as const,
  status: (importId: string) => [...importKeys.all, 'status', importId] as const,
  rollback: () => [...importKeys.all, 'rollback'] as const,
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
