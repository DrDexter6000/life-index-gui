import type { DashboardResponse } from '@/lib/api-client';

/** Format a local calendar month without UTC conversion or toISOString(). */
export function getLocalCurrentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftLocalMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const value = new Date(year, monthNumber - 1 + delta, 1);
  return getLocalCurrentMonth(value);
}

export function isFutureLocalMonth(month: string, currentMonth: string): boolean {
  return month > currentMonth;
}

export type ArchivesDashboard = DashboardResponse;
