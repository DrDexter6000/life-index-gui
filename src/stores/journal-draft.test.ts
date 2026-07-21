import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalTimezone = process.env.TZ;

describe('journal draft local date', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    process.env.TZ = 'Pacific/Kiritimati';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  });

  it('initializes a new draft with the browser local calendar day near a UTC boundary', async () => {
    vi.setSystemTime(new Date('2026-07-21T23:30:00.000Z'));

    const { useJournalDraftStore } = await import('./journal-draft');

    expect(useJournalDraftStore.getState().metadata.date).toBe('2026-07-22');
  });

  it('refreshes the local calendar day when reset runs after local midnight', async () => {
    vi.setSystemTime(new Date('2026-07-21T09:00:00.000Z'));
    const { useJournalDraftStore } = await import('./journal-draft');
    expect(useJournalDraftStore.getState().metadata.date).toBe('2026-07-21');

    vi.setSystemTime(new Date('2026-07-21T11:00:00.000Z'));
    useJournalDraftStore.getState().reset();

    expect(useJournalDraftStore.getState().metadata.date).toBe('2026-07-22');
  });
});
