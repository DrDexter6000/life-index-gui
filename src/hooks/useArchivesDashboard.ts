import { useQuery } from '@tanstack/react-query';
import {
  dashboardAPI,
  type DashboardResponse,
} from '@/lib/api-client';

export const archivesDashboardKeys = {
  all: ['archives-dashboard'] as const,
  dashboard: (month: string, top: number) => ['archives-dashboard', month, top] as const,
};

/** Fetch one transient GUI dashboard projection for the selected local month. */
export function useArchivesDashboard(month: string, top = 5) {
  return useQuery<DashboardResponse>({
    queryKey: archivesDashboardKeys.dashboard(month, top),
    queryFn: () => dashboardAPI.getDashboard({ month, top }),
    staleTime: 30 * 1000,
    retry: false,
  });
}
