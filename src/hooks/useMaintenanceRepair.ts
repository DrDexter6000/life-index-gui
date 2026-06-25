import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { maintenanceAPI } from '@/lib/api-client';

// ── Maintenance query keys ─────────────────────────────────────────────────

export const maintenanceKeys = {
  all: ['maintenance'] as const,
  audit: (domain?: string) =>
    domain
      ? [...maintenanceKeys.all, 'audit', domain] as const
      : [...maintenanceKeys.all, 'audit'] as const,
  plan: (issueId: string) => [...maintenanceKeys.all, 'plan', issueId] as const,
  dryRun: (issueId: string) => [...maintenanceKeys.all, 'dry-run', issueId] as const,
  apply: () => [...maintenanceKeys.all, 'apply'] as const,
};

// ── Maintenance hooks ──────────────────────────────────────────────────────

/**
 * Hook for fetching maintenance audit diagnostics.
 * Optionally filter by domain (e.g. 'index', 'entities').
 */
export function useMaintenanceAudit(domain?: string) {
  return useQuery({
    queryKey: maintenanceKeys.audit(domain),
    queryFn: () => maintenanceAPI.getAudit(domain),
  });
}

/**
 * Hook for fetching a repair plan for a specific issue.
 * Disabled when no issueId is selected.
 */
export function useMaintenancePlan(issueId: string | undefined) {
  return useQuery({
    queryKey: maintenanceKeys.plan(issueId ?? ''),
    queryFn: () => maintenanceAPI.getPlan(issueId!),
    enabled: !!issueId,
  });
}

/**
 * Hook for fetching a dry-run repair preview for a specific issue.
 * Disabled when no issueId is selected.
 */
export function useMaintenanceDryRun(issueId: string | undefined) {
  return useQuery({
    queryKey: maintenanceKeys.dryRun(issueId ?? ''),
    queryFn: () => maintenanceAPI.repairDryRun(issueId!),
    enabled: !!issueId,
  });
}

/**
 * Hook for applying a confirmed maintenance repair.
 * Mutation — must be called with { issueId, confirmed: true }.
 * The type signature enforces confirmed must be true (not boolean).
 */
export function useMaintenanceRepairApply() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: { issueId: string; confirmed: true }) =>
      maintenanceAPI.repairApply(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: maintenanceKeys.all });
    },
  });
}
