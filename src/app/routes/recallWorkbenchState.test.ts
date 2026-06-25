import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  setLaneLoading,
  setLaneSuccess,
  setLaneEmpty,
  setLaneError,
  retryLane,
  setLaneLastQuery,
} from './recallWorkbenchState';
import type { RecallWorkbenchState, LaneKey } from './recallWorkbenchState';

describe('createInitialState', () => {
  it('should create both lanes idle with empty query, no error, and zero retries', () => {
    const state = createInitialState();

    expect(state.keyword.status).toBe('idle');
    expect(state.keyword.query).toBe('');
    expect(state.keyword.error).toBeNull();
    expect(state.keyword.retryCount).toBe(0);

    expect(state.evidence.status).toBe('idle');
    expect(state.evidence.query).toBe('');
    expect(state.evidence.error).toBeNull();
    expect(state.evidence.retryCount).toBe(0);
  });
});

describe('lane independence', () => {
  const lanes: LaneKey[] = ['keyword', 'evidence'];

  it.each(lanes)(
    'setLaneLoading on %s must not mutate the other lane',
    (lane) => {
      const other = lane === 'keyword' ? 'evidence' : 'keyword';
      const before = createInitialState();
      const after = setLaneLoading(before, lane, 'test query');

      expect(after[lane].status).toBe('loading');
      expect(after[lane].query).toBe('test query');
      expect(after[other]).toEqual(before[other]);
      expect(after[other]).not.toBe(before[other]);
    },
  );

  it.each(lanes)(
    'setLaneSuccess on %s must not mutate the other lane',
    (lane) => {
      const other = lane === 'keyword' ? 'evidence' : 'keyword';
      const before = setLaneLoading(createInitialState(), lane);
      const after = setLaneSuccess(before, lane);

      expect(after[lane].status).toBe('success');
      expect(after[other]).toEqual(before[other]);
      expect(after[other]).not.toBe(before[other]);
    },
  );

  it.each(lanes)(
    'setLaneEmpty on %s must not mutate the other lane',
    (lane) => {
      const other = lane === 'keyword' ? 'evidence' : 'keyword';
      const before = setLaneLoading(createInitialState(), lane);
      const after = setLaneEmpty(before, lane);

      expect(after[lane].status).toBe('empty');
      expect(after[other]).toEqual(before[other]);
      expect(after[other]).not.toBe(before[other]);
    },
  );

  it.each(lanes)(
    'setLaneError on %s must not mutate the other lane',
    (lane) => {
      const other = lane === 'keyword' ? 'evidence' : 'keyword';
      const before = setLaneLoading(createInitialState(), lane);
      const after = setLaneError(before, lane, 'network failure');

      expect(after[lane].status).toBe('error');
      expect(after[lane].error).toBe('network failure');
      expect(after[other]).toEqual(before[other]);
      expect(after[other]).not.toBe(before[other]);
    },
  );

  it.each(lanes)(
    'retryLane on %s must not mutate the other lane',
    (lane) => {
      const other = lane === 'keyword' ? 'evidence' : 'keyword';
      const before = setLaneError(createInitialState(), lane, 'timeout');
      const after = retryLane(before, lane);

      expect(after[lane].status).toBe('loading');
      expect(after[lane].retryCount).toBe(1);
      expect(after[other]).toEqual(before[other]);
      expect(after[other]).not.toBe(before[other]);
    },
  );

  it.each(lanes)(
    'setLaneLastQuery on %s must not mutate the other lane',
    (lane) => {
      const other = lane === 'keyword' ? 'evidence' : 'keyword';
      const before = createInitialState();
      const after = setLaneLastQuery(before, lane, 'last query');

      expect(after[lane].query).toBe('last query');
      expect(after[other]).toEqual(before[other]);
      expect(after[other]).not.toBe(before[other]);
    },
  );
});

describe('keyword lane transitions', () => {
  it('should transition through loading -> success', () => {
    let state = createInitialState();
    state = setLaneLoading(state, 'keyword', 'hello');
    expect(state.keyword.status).toBe('loading');
    expect(state.keyword.query).toBe('hello');

    state = setLaneSuccess(state, 'keyword');
    expect(state.keyword.status).toBe('success');
  });

  it('should transition through loading -> empty', () => {
    let state = createInitialState();
    state = setLaneLoading(state, 'keyword', 'xyz');
    state = setLaneEmpty(state, 'keyword');
    expect(state.keyword.status).toBe('empty');
  });

  it('should transition through loading -> error', () => {
    let state = createInitialState();
    state = setLaneLoading(state, 'keyword', 'fail');
    state = setLaneError(state, 'keyword', 'server error');
    expect(state.keyword.status).toBe('error');
    expect(state.keyword.error).toBe('server error');
  });

  it('should clear error when transitioning back to loading', () => {
    let state = createInitialState();
    state = setLaneError(state, 'keyword', 'bad request');
    state = setLaneLoading(state, 'keyword', 'retry');
    expect(state.keyword.status).toBe('loading');
    expect(state.keyword.error).toBeNull();
  });

  it('should track retry count across multiple retries', () => {
    let state = createInitialState();
    state = setLaneError(state, 'keyword', 'first failure');

    state = retryLane(state, 'keyword');
    expect(state.keyword.status).toBe('loading');
    expect(state.keyword.retryCount).toBe(1);

    state = setLaneError(state, 'keyword', 'second failure');
    state = retryLane(state, 'keyword');
    expect(state.keyword.retryCount).toBe(2);
  });

  it('should preserve query during retry', () => {
    let state = createInitialState();
    state = setLaneLoading(state, 'keyword', 'persistent query');
    state = setLaneError(state, 'keyword', 'failed');
    state = retryLane(state, 'keyword');
    expect(state.keyword.query).toBe('persistent query');
  });

  it('should set last query independently of status', () => {
    let state = createInitialState();
    state = setLaneLastQuery(state, 'keyword', 'draft query');
    expect(state.keyword.query).toBe('draft query');
    expect(state.keyword.status).toBe('idle');
  });
});

describe('evidence lane transitions', () => {
  it('should transition through loading -> success', () => {
    let state = createInitialState();
    state = setLaneLoading(state, 'evidence', 'smart search');
    expect(state.evidence.status).toBe('loading');
    expect(state.evidence.query).toBe('smart search');

    state = setLaneSuccess(state, 'evidence');
    expect(state.evidence.status).toBe('success');
  });

  it('should transition through loading -> empty', () => {
    let state = createInitialState();
    state = setLaneLoading(state, 'evidence', 'no results');
    state = setLaneEmpty(state, 'evidence');
    expect(state.evidence.status).toBe('empty');
  });

  it('should transition through loading -> error', () => {
    let state = createInitialState();
    state = setLaneLoading(state, 'evidence', 'fail');
    state = setLaneError(state, 'evidence', 'cli unavailable');
    expect(state.evidence.status).toBe('error');
    expect(state.evidence.error).toBe('cli unavailable');
  });

  it('should clear error when transitioning back to loading', () => {
    let state = createInitialState();
    state = setLaneError(state, 'evidence', 'bad request');
    state = setLaneLoading(state, 'evidence', 'retry');
    expect(state.evidence.status).toBe('loading');
    expect(state.evidence.error).toBeNull();
  });

  it('should track retry count across multiple retries', () => {
    let state = createInitialState();
    state = setLaneError(state, 'evidence', 'first failure');

    state = retryLane(state, 'evidence');
    expect(state.evidence.status).toBe('loading');
    expect(state.evidence.retryCount).toBe(1);

    state = setLaneError(state, 'evidence', 'second failure');
    state = retryLane(state, 'evidence');
    expect(state.evidence.retryCount).toBe(2);
  });

  it('should preserve query during retry', () => {
    let state = createInitialState();
    state = setLaneLoading(state, 'evidence', 'persistent query');
    state = setLaneError(state, 'evidence', 'failed');
    state = retryLane(state, 'evidence');
    expect(state.evidence.query).toBe('persistent query');
  });

  it('should set last query independently of status', () => {
    let state = createInitialState();
    state = setLaneLastQuery(state, 'evidence', 'draft query');
    expect(state.evidence.query).toBe('draft query');
    expect(state.evidence.status).toBe('idle');
  });
});

describe('immutability', () => {
  it('should never mutate the input state object', () => {
    const original = createInitialState();
    const frozen: RecallWorkbenchState = {
      keyword: Object.freeze({ ...original.keyword }),
      evidence: Object.freeze({ ...original.evidence }),
    };

    const s1 = setLaneLoading(frozen, 'keyword', 'q');
    const s2 = setLaneSuccess(s1, 'keyword');
    const s3 = setLaneEmpty(s2, 'evidence');
    const s4 = setLaneError(s3, 'keyword', 'err');
    const s5 = retryLane(s4, 'keyword');
    const s6 = setLaneLastQuery(s5, 'evidence', 'last');

    expect(frozen.keyword.status).toBe('idle');
    expect(frozen.evidence.status).toBe('idle');
    expect(s6.keyword.status).toBe('loading');
    expect(s6.evidence.query).toBe('last');
  });
});
