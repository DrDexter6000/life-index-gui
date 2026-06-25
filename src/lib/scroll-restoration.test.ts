import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveScrollPosition, readScrollPosition } from './scroll-restoration';

const STORAGE_KEY = 'li-scroll-positions';

describe('scroll-restoration', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('save→read round-trip returns the original value', () => {
    saveScrollPosition('q=foo&start=2026-01-01', 1234);
    expect(readScrollPosition('q=foo&start=2026-01-01')).toBe(1234);
  });

  it('returns null for an unknown key', () => {
    expect(readScrollPosition('never-saved')).toBeNull();
  });

  it('returns null when sessionStorage is empty', () => {
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(readScrollPosition('any')).toBeNull();
  });

  it('does not throw when sessionStorage throws on save', () => {
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => saveScrollPosition('k', 100)).not.toThrow();

    vi.restoreAllMocks();
  });

  it('does not throw and returns null when sessionStorage throws on read', () => {
    vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => readScrollPosition('k')).not.toThrow();
    expect(readScrollPosition('k')).toBeNull();

    vi.restoreAllMocks();
  });
});
