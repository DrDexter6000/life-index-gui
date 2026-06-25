import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { journalAPI, type SmartSearchResult } from '@/lib/api-client';

export interface UseSmartSearchReturn {
  data: SmartSearchResult | null;
  isLoading: boolean;
  error: Error | null;
  search: (query: string) => void;
  refetch: () => void;
}

/**
 * Hook for smart-search via CLI deterministic scaffold/evidence mode.
 *
 * Unlike keyword search, smart-search calls `life-index smart-search --query`
 * and returns scaffold/evidence/provenance. The hook is manually triggered
 * (not URL-driven) and stores the last query for react-query caching.
 */
export function useSmartSearch(): UseSmartSearchReturn {
  const [activeQuery, setActiveQuery] = useState<string>('');

  const queryResult = useQuery({
    queryKey: ['smart-search', activeQuery],
    queryFn: () => journalAPI.smartSearch({ query: activeQuery }),
    enabled: activeQuery.length > 0,
    staleTime: 30 * 1000,
    retry: 1,
  });

  const search = useCallback((query: string) => {
    if (query.trim()) {
      setActiveQuery(query.trim());
    }
  }, []);

  const refetch = useCallback(() => {
    queryResult.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryResult.refetch]);

  return {
    data: queryResult.data ?? null,
    isLoading: queryResult.isLoading,
    error: queryResult.error,
    search,
    refetch,
  };
}
