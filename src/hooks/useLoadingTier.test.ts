import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLoadingTier, useLoadingTierWithData, useDelayedLoading, LOADING_TIERS } from './useLoadingTier';

describe('LOADING_TIERS', () => {
  it('should have correct threshold values', () => {
    expect(LOADING_TIERS.INSTANT).toBe(100);
    expect(LOADING_TIERS.SKELETON).toBe(300);
    expect(LOADING_TIERS.LOADER_INITIAL).toBe(2000);
    expect(LOADING_TIERS.LOADER_EXTENDED).toBe(Infinity);
  });
});

describe('useLoadingTier', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start in instant tier when not loading', () => {
    const { result } = renderHook(() => useLoadingTier(false));

    expect(result.current.tier).toBe('instant');
    expect(result.current.showSkeleton).toBe(false);
    expect(result.current.showLoader).toBe(false);
    expect(result.current.isLoadingActive).toBe(false);
  });

  it('should stay in instant tier for first 100ms of loading', () => {
    const { result } = renderHook(() => useLoadingTier(true));

    expect(result.current.tier).toBe('instant');

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(result.current.tier).toBe('instant');
  });

  it('should transition to skeleton tier after 100ms', () => {
    const { result } = renderHook(() => useLoadingTier(true));

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(result.current.tier).toBe('skeleton');
    expect(result.current.showSkeleton).toBe(true);
    expect(result.current.showLoader).toBe(false);
  });

  it('should transition to loader-initial tier after 300ms', () => {
    const { result } = renderHook(() => useLoadingTier(true));

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(result.current.tier).toBe('loader-initial');
    expect(result.current.showSkeleton).toBe(false);
    expect(result.current.showLoader).toBe(true);
    expect(result.current.showExtendedLoader).toBe(false);
  });

  it('should transition to loader-extended tier after 2000ms', () => {
    const { result } = renderHook(() => useLoadingTier(true));

    act(() => {
      vi.advanceTimersByTime(2100);
    });

    expect(result.current.tier).toBe('loader-extended');
    expect(result.current.showSkeleton).toBe(false);
    expect(result.current.showLoader).toBe(true);
    expect(result.current.showExtendedLoader).toBe(true);
  });

  it('should reset when loading stops', () => {
    const { result, rerender } = renderHook(
      ({ isLoading }) => useLoadingTier(isLoading),
      { initialProps: { isLoading: true } }
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.tier).toBe('loader-initial');

    rerender({ isLoading: false });

    expect(result.current.tier).toBe('instant');
    expect(result.current.elapsedTime).toBe(0);
    expect(result.current.isLoadingActive).toBe(false);
  });

  it('should track elapsed time', () => {
    const { result } = renderHook(() => useLoadingTier(true));

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.elapsedTime).toBeGreaterThanOrEqual(450);
  });

  it('should respect custom delays', () => {
    const { result } = renderHook(() =>
      useLoadingTier(true, {
        skeletonDelay: 200,
        loaderDelay: 500,
        extendedDelay: 3000,
      })
    );

    // Should still be instant at 150ms
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current.tier).toBe('instant');

    // Should be skeleton at 250ms
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.tier).toBe('skeleton');

    // Should be loader-initial at 600ms
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(result.current.tier).toBe('loader-initial');

    // Should be loader-extended at 3100ms
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(result.current.tier).toBe('loader-extended');
  });

  it('should clean up interval on unmount', () => {
    const { unmount } = renderHook(() => useLoadingTier(true));

    unmount();

    // Should not throw when advancing timers after unmount
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }).not.toThrow();
  });
});

describe('useLoadingTierWithData', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should indicate not ready when loading', () => {
    const { result } = renderHook(() => useLoadingTierWithData(true, false));

    expect(result.current.isReady).toBe(false);
    expect(result.current.showEmpty).toBe(false);
  });

  it('should indicate ready when not loading and has data', () => {
    const { result } = renderHook(() => useLoadingTierWithData(false, true));

    expect(result.current.isReady).toBe(true);
    expect(result.current.showEmpty).toBe(false);
  });

  it('should indicate empty when not loading and no data', () => {
    const { result } = renderHook(() => useLoadingTierWithData(false, false));

    expect(result.current.isReady).toBe(false);
    expect(result.current.showEmpty).toBe(true);
  });

  it('should pass through tier state', () => {
    const { result } = renderHook(() => useLoadingTierWithData(true, false));

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(result.current.tier).toBe('loader-initial');
    expect(result.current.showLoader).toBe(true);
  });
});

describe('useDelayedLoading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return false immediately when not loading', () => {
    const { result } = renderHook(() => useDelayedLoading(false));

    expect(result.current).toBe(false);
  });

  it('should return false during delay period', () => {
    const { result } = renderHook(() => useDelayedLoading(true, 200));

    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current).toBe(false);
  });

  it('should return true after delay', () => {
    const { result } = renderHook(() => useDelayedLoading(true, 200));

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(result.current).toBe(true);
  });

  it('should use default delay of 150ms', () => {
    const { result } = renderHook(() => useDelayedLoading(true));

    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current).toBe(false);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current).toBe(true);
  });

  it('should reset when loading stops', () => {
    const { result, rerender } = renderHook(
      ({ isLoading }) => useDelayedLoading(isLoading, 200),
      { initialProps: { isLoading: true } }
    );

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe(true);

    rerender({ isLoading: false });

    expect(result.current).toBe(false);
  });

  it('should clean up timeout on unmount', () => {
    const { unmount } = renderHook(() => useDelayedLoading(true, 200));

    unmount();

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(300);
      });
    }).not.toThrow();
  });
});
