import { useState, useEffect, useMemo } from 'react';

/**
 * Loading tier thresholds in milliseconds
 * Based on GUI_ARCHITECTURE.md §13 Loading State Gradation
 */
export const LOADING_TIERS = {
  /** 0-100ms: Direct render - no loading state needed */
  INSTANT: 100,
  /** 100-300ms: Skeleton screen */
  SKELETON: 300,
  /** 300ms-2s: CelestialLoader with initial text */
  LOADER_INITIAL: 2000,
  /** 2s+: CelestialLoader with escalated text */
  LOADER_EXTENDED: Infinity,
} as const;

/**
 * Loading tier types
 */
export type LoadingTier = 'instant' | 'skeleton' | 'loader-initial' | 'loader-extended';

/**
 * useLoadingTier - Hook for tiered loading state management
 *
 * Implements the loading state gradation from GUI_ARCHITECTURE.md:
 * - 0-100ms: Direct render (no loading indicator)
 * - 100-300ms: Skeleton screen
 * - 300ms-2s: CelestialLoader with initial text
 * - 2s+: CelestialLoader with escalated text
 *
 * @param isLoading - Whether data is currently loading
 * @param options - Configuration options
 * @returns Current loading tier and helper booleans
 *
 * @example
 * ```tsx
 * const { tier, showSkeleton, showLoader } = useLoadingTier(isLoading);
 *
 * if (showSkeleton) return <SkeletonView />;
 * if (showLoader) return <CelestialLoader tieredText={tier === 'loader-extended'} />;
 * return <ActualContent />;
 * ```
 */
export function useLoadingTier(
  isLoading: boolean,
  options: {
    /** Minimum time in ms before showing skeleton (default: 100) */
    skeletonDelay?: number;
    /** Minimum time in ms before showing loader (default: 300) */
    loaderDelay?: number;
    /** Time in ms before escalating to extended tier (default: 2000) */
    extendedDelay?: number;
  } = {}
) {
  const {
    skeletonDelay = LOADING_TIERS.INSTANT,
    loaderDelay = LOADING_TIERS.SKELETON,
    extendedDelay = LOADING_TIERS.LOADER_INITIAL,
  } = options;

  const [elapsedTime, setElapsedTime] = useState(0);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setElapsedTime(0);
      setIsActive(false);
      return;
    }

    // Start tracking when loading begins
    setIsActive(true);
    const startTime = Date.now();

    // Update elapsed time every 50ms for smooth tier transitions
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      setElapsedTime(elapsed);
    }, 50);

    return () => {
      clearInterval(interval);
    };
  }, [isLoading]);

  // Determine current tier based on elapsed time
  const tier: LoadingTier = useMemo(() => {
    if (!isActive || elapsedTime < skeletonDelay) {
      return 'instant';
    }
    if (elapsedTime < loaderDelay) {
      return 'skeleton';
    }
    if (elapsedTime < extendedDelay) {
      return 'loader-initial';
    }
    return 'loader-extended';
  }, [elapsedTime, isActive, skeletonDelay, loaderDelay, extendedDelay]);

  // Helper booleans for common use cases
  const showSkeleton = tier === 'skeleton';
  const showLoader = tier === 'loader-initial' || tier === 'loader-extended';
  const showExtendedLoader = tier === 'loader-extended';

  return {
    /** Current loading tier */
    tier,
    /** Elapsed time in milliseconds since loading started */
    elapsedTime,
    /** Whether to show skeleton screen */
    showSkeleton,
    /** Whether to show loader (initial or extended) */
    showLoader,
    /** Whether to show extended loader with escalated text */
    showExtendedLoader,
    /** Whether loading is still active */
    isLoadingActive: isActive,
  };
}

/**
 * useLoadingTierWithData - Extended hook that handles data fetching states
 *
 * Combines useLoadingTier with data availability checks for common patterns
 *
 * @param isLoading - Whether data is currently loading
 * @param hasData - Whether data is available
 * @param options - Configuration options
 * @returns Loading tier state and data availability
 *
 * @example
 * ```tsx
 * const { tier, showSkeleton, showLoader, isReady } = useLoadingTierWithData(
 *   isLoading,
 *   data != null && data.length > 0
 * );
 *
 * if (showSkeleton) return <SkeletonGrid />;
 * if (showLoader) return <PageLoader />;
 * if (!isReady) return <EmptyState />;
 * return <DataView data={data} />;
 * ```
 */
export function useLoadingTierWithData(
  isLoading: boolean,
  hasData: boolean,
  options?: {
    skeletonDelay?: number;
    loaderDelay?: number;
    extendedDelay?: number;
  }
) {
  const tierState = useLoadingTier(isLoading, options);

  // Content is ready when not loading and has data
  const isReady = !isLoading && hasData;

  // Show empty state when not loading and no data
  const showEmpty = !isLoading && !hasData;

  return {
    ...tierState,
    /** Whether data is ready to display */
    isReady,
    /** Whether to show empty state */
    showEmpty,
  };
}

/**
 * useDelayedLoading - Hook for delaying the display of loading states
 *
 * Useful for preventing flash of loading content on fast connections
 *
 * @param isLoading - Whether data is currently loading
 * @param delay - Delay in milliseconds before showing loading state
 * @returns Whether loading state should be visible
 *
 * @example
 * ```tsx
 * const showLoading = useDelayedLoading(isLoading, 150);
 *
 * if (showLoading) return <LoadingView />;
 * return <ContentView />;
 * ```
 */
export function useDelayedLoading(isLoading: boolean, delay: number = 150): boolean {
  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShowLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      setShowLoading(true);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [isLoading, delay]);

  return showLoading;
}
