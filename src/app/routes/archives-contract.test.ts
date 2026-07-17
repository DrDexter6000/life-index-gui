import { describe, expect, it } from 'vitest';
import {
  getLocalCurrentMonth,
  isFutureLocalMonth,
  shiftLocalMonth,
} from './archives-contract';

describe('Archives local calendar helpers', () => {
  it('formats the host-local month without UTC or toISOString boundaries', () => {
    expect(getLocalCurrentMonth(new Date(2026, 6, 15, 23, 59))).toBe('2026-07');
    expect(getLocalCurrentMonth(new Date(2026, 6, 16, 0, 1))).toBe('2026-07');
  });

  it('shifts months using local calendar semantics', () => {
    expect(shiftLocalMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftLocalMonth('2026-12', 1)).toBe('2027-01');
  });

  it('blocks only future months relative to the host-local current month', () => {
    expect(isFutureLocalMonth('2026-08', '2026-07')).toBe(true);
    expect(isFutureLocalMonth('2026-07', '2026-07')).toBe(false);
  });
});
