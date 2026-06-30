import { useQuery } from '@tanstack/react-query';
import {
  indexTreeAPI,
  type IndexTreeDiscoverParams,
  type IndexTreeNavigateParams,
  type IndexTreeRangeParams,
} from '@/lib/api-client';

// ── Index Tree query keys ─────────────────────────────────────────────────

function facetKey(params: IndexTreeDiscoverParams = {}) {
  return (params.facets ?? []).join(',');
}

function navigateSelectionKey(params: IndexTreeNavigateParams = {}) {
  const filterKey = (params.filters ?? [])
    .map((filter) => `${filter.facet}=${filter.values.join('||')}`)
    .join('&');
  const entityKey = (params.entityNeighbors ?? []).join('||');
  return [filterKey, entityKey].filter(Boolean).join(';');
}

function hasNavigationSelection(params: IndexTreeNavigateParams) {
  const hasFilters = (params.filters ?? []).some(
    (filter) => filter.facet.trim().length > 0 && filter.values.some((value) => value.trim().length > 0),
  );
  const hasEntities = (params.entityNeighbors ?? []).some((entity) => entity.trim().length > 0);
  return hasFilters || hasEntities;
}

export const indexTreeKeys = {
  all: ['index-tree'] as const,
  discover: (params: IndexTreeDiscoverParams = {}) => [
    ...indexTreeKeys.all,
    'discover',
    facetKey(params),
    params.dateFrom ?? '',
    params.dateTo ?? '',
  ] as const,
  navigate: (params: IndexTreeNavigateParams = {}) => [
    ...indexTreeKeys.all,
    'navigate',
    navigateSelectionKey(params),
    params.dateFrom ?? '',
    params.dateTo ?? '',
  ] as const,
  ensure: (params: IndexTreeRangeParams = {}) => [
    ...indexTreeKeys.all,
    'ensure',
    params.dateFrom ?? '',
    params.dateTo ?? '',
  ] as const,
  shadow: (query: string) => [...indexTreeKeys.all, 'shadow', query] as const,
};

/** Fetch canonical facet menus. The GUI presents values; it does not choose tools. */
export function useIndexTreeDiscover(params: IndexTreeDiscoverParams = {}) {
  return useQuery({
    queryKey: indexTreeKeys.discover(params),
    queryFn: () => indexTreeAPI.discover(params),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/** Fetch deterministic journal pointers for explicit user-selected values. */
export function useIndexTreeNavigate(params: IndexTreeNavigateParams) {
  return useQuery({
    queryKey: indexTreeKeys.navigate(params),
    queryFn: () => indexTreeAPI.navigate(params),
    enabled: hasNavigationSelection(params),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/** Fetch ensure/fallback state when canonical discover reports stale index-b freshness. */
export function useIndexTreeEnsure(params: IndexTreeRangeParams = {}, enabled = true) {
  return useQuery({
    queryKey: indexTreeKeys.ensure(params),
    queryFn: () => indexTreeAPI.ensure(params),
    enabled,
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
