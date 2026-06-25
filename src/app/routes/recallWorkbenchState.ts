/**
 * Recall Workbench State Model
 *
 * Pure route-local state helper for managing independent keyword and evidence
 * lane states. All transitions return new state objects; no mutation.
 *
 * Used by the Recall workbench to track per-lane status, query, error,
 * and retry state without coupling to backend APIs or UI components.
 */

/** Recognized lane keys in the Recall workbench */
export type LaneKey = 'keyword' | 'evidence';

/** Lifecycle status of a single lane */
export type LaneStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

/** State held for one lane */
export interface LaneState {
  /** Current lifecycle status */
  status: LaneStatus;
  /** Last submitted query for this lane */
  query: string;
  /** Human-readable error message, or null when healthy */
  error: string | null;
  /** Number of retry attempts on this lane */
  retryCount: number;
}

/** Full workbench state with both lanes */
export interface RecallWorkbenchState {
  keyword: LaneState;
  evidence: LaneState;
}

/** Factory for a fresh lane in the idle state */
function createIdleLane(): LaneState {
  return {
    status: 'idle',
    query: '',
    error: null,
    retryCount: 0,
  };
}

/**
 * Create the initial workbench state.
 * Both lanes start idle with empty query, no error, and zero retries.
 */
export function createInitialState(): RecallWorkbenchState {
  return {
    keyword: createIdleLane(),
    evidence: createIdleLane(),
  };
}

/**
 * Return a copy of the state with one lane replaced.
 * Both lanes are shallow-copied to guarantee referential freshness
 * without mutating the input.
 */
function updateLane(
  state: RecallWorkbenchState,
  lane: LaneKey,
  patch: Partial<LaneState>,
): RecallWorkbenchState {
  const other = lane === 'keyword' ? 'evidence' : 'keyword';
  return {
    ...state,
    [lane]: { ...state[lane], ...patch },
    [other]: { ...state[other] },
  } as RecallWorkbenchState;
}

/**
 * Set a lane to loading, optionally recording the query that triggered it.
 * Clears any previous error.
 */
export function setLaneLoading(
  state: RecallWorkbenchState,
  lane: LaneKey,
  query?: string,
): RecallWorkbenchState {
  return updateLane(state, lane, {
    status: 'loading',
    ...(query !== undefined ? { query } : {}),
    error: null,
  });
}

/**
 * Mark a lane as successfully loaded.
 */
export function setLaneSuccess(
  state: RecallWorkbenchState,
  lane: LaneKey,
): RecallWorkbenchState {
  return updateLane(state, lane, { status: 'success' });
}

/**
 * Mark a lane as empty (search completed but no results).
 */
export function setLaneEmpty(
  state: RecallWorkbenchState,
  lane: LaneKey,
): RecallWorkbenchState {
  return updateLane(state, lane, { status: 'empty' });
}

/**
 * Mark a lane as failed with a descriptive error.
 */
export function setLaneError(
  state: RecallWorkbenchState,
  lane: LaneKey,
  error: string,
): RecallWorkbenchState {
  return updateLane(state, lane, { status: 'error', error });
}

/**
 * Retry a failed lane: bump retryCount and transition back to loading.
 */
export function retryLane(
  state: RecallWorkbenchState,
  lane: LaneKey,
): RecallWorkbenchState {
  return updateLane(state, lane, {
    status: 'loading',
    retryCount: state[lane].retryCount + 1,
    error: null,
  });
}

/**
 * Store the last submitted query for a lane without changing status.
 */
export function setLaneLastQuery(
  state: RecallWorkbenchState,
  lane: LaneKey,
  query: string,
): RecallWorkbenchState {
  return updateLane(state, lane, { query });
}
