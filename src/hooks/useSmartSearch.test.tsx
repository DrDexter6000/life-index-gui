import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSmartSearch } from './useSmartSearch';

const mockSmartSearch = vi.fn();

vi.mock('@/lib/api-client', () => ({
  journalAPI: {
    smartSearch: (params: { query: string }) => mockSmartSearch(params),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('useSmartSearch', () => {
  beforeEach(() => {
    mockSmartSearch.mockReset();
    mockSmartSearch.mockResolvedValue({
      scaffold: [],
      evidence: [],
      provenance: 'deterministic',
    });
  });

  it('should expose refetch on the returned object', () => {
    const { result } = renderHook(() => useSmartSearch(), {
      wrapper: createWrapper(),
    });
    expect(typeof result.current.refetch).toBe('function');
  });

  it('should start in idle state with no data', () => {
    const { result } = renderHook(() => useSmartSearch(), {
      wrapper: createWrapper(),
    });
    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should trigger a search and load data', async () => {
    mockSmartSearch.mockResolvedValue({
      scaffold: [],
      evidence: [
        { id: '1', title: 'Test', date: '2026-01-01', abstract: 'a', topics: [], moods: [], location: null },
      ],
      provenance: 'deterministic',
    });

    const { result } = renderHook(() => useSmartSearch(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.search('test query');
    });

    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data!.evidence).toHaveLength(1);
    expect(result.current.data!.provenance).toBe('deterministic');
  });

  it('should call refetch without throwing when no query is active', () => {
    const { result } = renderHook(() => useSmartSearch(), {
      wrapper: createWrapper(),
    });
    expect(() => result.current.refetch()).not.toThrow();
  });

  it('should refetch the same query when refetch is called after a search', async () => {
    mockSmartSearch.mockResolvedValue({
      scaffold: [],
      evidence: [
        { id: '1', title: 'Test', date: '2026-01-01', abstract: 'a', topics: [], moods: [], location: null },
      ],
      provenance: 'deterministic',
    });

    const { result } = renderHook(() => useSmartSearch(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.search('test query');
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(mockSmartSearch).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.refetch();
    });
    await waitFor(() => expect(mockSmartSearch).toHaveBeenCalledTimes(2));
  });
});
