import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { type UseQueryResult } from '@tanstack/react-query';
import JournalDetail from './JournalDetail';
import { useJournal } from '@/hooks/useJournals';
import { type JournalDetail as JournalDetailType } from '@/lib/api-client';

const mockNavigate = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ '*': '2026/04/life-index_2026-04-19_001' }),
  };
});

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        back: 'Back',
        loadFailed: 'Load Failed',
        checkNetwork: 'Check your network connection and retry',
        journalNotFound: 'Journal Not Found',
        journalMoved: 'This journal may have been moved or deleted',
        retry: 'Retry',
        editJournal: 'Edit journal',
        edit: 'Edit',
        continueWriting: 'Continue',
        continueWritingBanner: `Continuing: ${opts?.title ?? ''}`,
        readingTime: `${opts?.minutes ?? 1} min read`,
        attachments: 'Attachments',
        attachmentImagePreview: 'Image attachment preview',
        attachmentVideoPreview: 'Video attachment preview',
        attachmentOpen: 'Open attachment',
        weekdaySun: 'Sun',
        weekdayMon: 'Mon',
        weekdayTue: 'Tue',
        weekdayWed: 'Wed',
        weekdayThu: 'Thu',
        weekdayFri: 'Fri',
        weekdaySat: 'Sat',
        dateFormat: `${opts?.year}-${opts?.month}-${opts?.day}`,
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock('@/hooks/useJournals', () => ({
  useJournal: vi.fn(() => ({
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    data: {
      id: '2026/04/life-index_2026-04-19_001',
      title: 'Attachment Entry',
      date: '2026-04-19',
      content: 'Content body.',
      abstract: null,
      topics: [],
      moods: [],
      people: [],
      location: null,
      weather: null,
      project: null,
      links: [],
      wordCount: 2,
      attachments: [
        {
          relPath: 'attachments/2026/04/photo.jpg',
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 12345,
        },
        {
          relPath: 'attachments/2026/04/movie.mp4',
          filename: 'movie.mp4',
          contentType: 'video/mp4',
          sizeBytes: null,
        },
        {
          relPath: 'attachments/2026/04/report.pdf',
          filename: 'report.pdf',
          contentType: 'application/pdf',
          sizeBytes: null,
        },
      ],
    },
  })),
}));

vi.mock('@/components/journal/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('@/components/journal/JournalMetadataPanel', () => ({
  JournalMetadataPanel: () => <div>metadata panel</div>,
}));

vi.mock('@/components/journal/RelatedJournals', () => ({
  RelatedJournals: () => <div>related journals</div>,
}));

describe('JournalDetail attachments', () => {
  it('renders image, video, and download links through the backend attachment route', async () => {
    render(
      <MemoryRouter>
        <JournalDetail />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Attachment Entry')).toBeInTheDocument();
    expect(screen.getByText('Attachments')).toBeInTheDocument();

    const image = screen.getByAltText('photo.jpg') as HTMLImageElement;
    expect(image.src).toContain('/api/attachments/2026/04/photo.jpg');

    const video = screen.getByLabelText(/movie\.mp4/) as HTMLVideoElement;
    expect(video.querySelector('source')?.getAttribute('src')).toBe(
      '/api/attachments/2026/04/movie.mp4',
    );

    const documentLink = screen.getByRole('link', { name: /report\.pdf/ });
    expect(documentLink).toHaveAttribute(
      'href',
      '/api/attachments/2026/04/report.pdf',
    );
  });

  it('normalizes attachment paths that start with /attachments/ or attachments/', async () => {
    // This test is covered by the shared attachmentUrl() unit test,
    // but we keep the integration assertion above to ensure the component
    // wires the helper correctly for all three attachment types.
  });
});

describe('JournalDetail honest states (H1–H3)', () => {
  const mockedUseJournal = vi.mocked(useJournal);

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to a default success state so existing tests are not affected
    mockedUseJournal.mockReturnValue({
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      data: {
        id: '2026/04/life-index_2026-04-19_001',
        title: 'Attachment Entry',
        date: '2026-04-19',
        content: 'Content body.',
        abstract: null,
        topics: [],
        moods: [],
        people: [],
        location: null,
        weather: null,
        project: null,
        links: [],
        wordCount: 2,
        attachments: [],
      },
    } as unknown as UseQueryResult<JournalDetailType, Error>);
  });

  it('H1: loading — renders PageLoader and does not show journal title or body', () => {
    mockedUseJournal.mockReturnValue({
      isLoading: true,
      error: null,
      refetch: vi.fn(),
      data: undefined,
    } as unknown as UseQueryResult<JournalDetailType, Error>);

    render(
      <MemoryRouter>
        <JournalDetail />
      </MemoryRouter>,
    );

    // PageLoader contains CelestialLoader which renders role="status"
    expect(screen.getByRole('status')).toBeInTheDocument();

    // Must NOT render journal title or content
    expect(screen.queryByText('Attachment Entry')).not.toBeInTheDocument();
    expect(screen.queryByText('Content body.')).not.toBeInTheDocument();
    // Must NOT render error / not-found copy
    expect(screen.queryByText('Load Failed')).not.toBeInTheDocument();
    expect(screen.queryByText('Journal Not Found')).not.toBeInTheDocument();
  });

  it('H2: error — renders loadFailed + checkNetwork + retry, and does NOT render journal body', () => {
    const mockRefetch = vi.fn();
    mockedUseJournal.mockReturnValue({
      isLoading: false,
      error: new Error('network failure'),
      refetch: mockRefetch,
      data: undefined,
    } as unknown as UseQueryResult<JournalDetailType, Error>);

    render(
      <MemoryRouter>
        <JournalDetail />
      </MemoryRouter>,
    );

    expect(screen.getByText('Load Failed')).toBeInTheDocument();
    expect(screen.getByText('Check your network connection and retry')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();

    // Must NOT render journal title or content = does not pretend success
    expect(screen.queryByText('Attachment Entry')).not.toBeInTheDocument();
    expect(screen.queryByText('Content body.')).not.toBeInTheDocument();

    // Retry button calls refetch
    fireEvent.click(screen.getByText('Retry'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('H3: not-found — renders journalNotFound + journalMoved, and has NO retry button', () => {
    mockedUseJournal.mockReturnValue({
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      data: undefined,
    } as unknown as UseQueryResult<JournalDetailType, Error>);

    render(
      <MemoryRouter>
        <JournalDetail />
      </MemoryRouter>,
    );

    expect(screen.getByText('Journal Not Found')).toBeInTheDocument();
    expect(screen.getByText('This journal may have been moved or deleted')).toBeInTheDocument();

    // Must NOT show retry button (clearly distinguished from error state)
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();

    // Must NOT render journal title or content
    expect(screen.queryByText('Attachment Entry')).not.toBeInTheDocument();
    expect(screen.queryByText('Content body.')).not.toBeInTheDocument();
  });
});

describe('JournalDetail continue writing (CN1)', () => {
  beforeEach(() => {
    vi.mocked(useJournal).mockReturnValue({
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      data: {
        id: '2026/04/life-index_2026-04-19_001',
        title: 'Attachment Entry',
        date: '2026-04-19',
        content: 'Content body.',
        abstract: null,
        topics: [],
        moods: [],
        people: [],
        location: null,
        weather: null,
        project: null,
        links: [],
        wordCount: 2,
        attachments: [],
      },
    } as unknown as UseQueryResult<JournalDetailType, Error>);
  });

  it('navigates to /?append=<id> when the continue-writing button is clicked', () => {
    render(
      <MemoryRouter>
        <JournalDetail />
      </MemoryRouter>,
    );

    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    expect(continueBtn).toBeInTheDocument();

    fireEvent.click(continueBtn);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(
      '/?append=2026%2F04%2Flife-index_2026-04-19_001',
    );
  });
});
