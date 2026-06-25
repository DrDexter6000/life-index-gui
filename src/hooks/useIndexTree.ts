import { useQuery } from '@tanstack/react-query';
import {
  indexTreeAPI,
  type IndexTreeLevel,
  type IndexTreeSignal,
} from '@/lib/api-client';

// ── Index Tree query keys ─────────────────────────────────────────────────

export const indexTreeKeys = {
  all: ['index-tree'] as const,
  nodes: (level: IndexTreeLevel = 'all') => [...indexTreeKeys.all, 'nodes', level] as const,
  lens: (signal: IndexTreeSignal) => [...indexTreeKeys.all, 'lens', signal] as const,
  shadow: (query: string) => [...indexTreeKeys.all, 'shadow', query] as const,
};

/**
 * Hook for fetching read-only Index Tree nodes.
 */
export function useIndexTreeNodes(level: IndexTreeLevel = 'all') {
  return useQuery({
    queryKey: indexTreeKeys.nodes(level),
    queryFn: () => indexTreeAPI.getNodes(level),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/**
 * Hook for fetching read-only Index Tree lens values.
 */
export function useIndexTreeLens(signal: IndexTreeSignal) {
  return useQuery({
    queryKey: indexTreeKeys.lens(signal),
    queryFn: () => indexTreeAPI.getLens(signal),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/**
 * Hook for fetching shadow diagnostics only.
 *
 * Shadow output is intentionally separate from search/smart-search hooks and
 * must not drive ranking, filtering, or ordering in default search surfaces.
 */
export function useIndexTreeShadow(query: string) {
  const normalizedQuery = query.trim();

  return useQuery({
    queryKey: indexTreeKeys.shadow(normalizedQuery),
    queryFn: () => indexTreeAPI.getShadow(normalizedQuery),
    enabled: normalizedQuery.length > 0,
    staleTime: 30 * 1000,
    retry: 1,
  });
}
