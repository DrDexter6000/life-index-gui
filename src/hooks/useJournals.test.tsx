import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useCreateJournal, useUpdateJournal } from '@/hooks/useJournals';
import { journalAPI } from '@/lib/api-client';

function createRetryingWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        retry: 2,
        retryDelay: 0,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('journal write mutations', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not retry journal creation after a failed write', async () => {
    const createSpy = vi
      .spyOn(journalAPI, 'create')
      .mockRejectedValue(new Error('write failed'));

    const { result } = renderHook(() => useCreateJournal(), {
      wrapper: createRetryingWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          title: 'No duplicate writes',
          content: 'Create should not be retried.',
          date: '2026-06-23',
        }),
      ).rejects.toThrow('write failed');
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('does not retry journal updates after a failed write', async () => {
    const updateSpy = vi
      .spyOn(journalAPI, 'update')
      .mockRejectedValue(new Error('update failed'));

    const { result } = renderHook(() => useUpdateJournal(), {
      wrapper: createRetryingWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          id: '2026/06/life-index_2026-06-23_001',
          data: {
            title: 'No duplicate updates',
            contentAppend: 'Update should not be retried.',
          },
        }),
      ).rejects.toThrow('update failed');
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});
