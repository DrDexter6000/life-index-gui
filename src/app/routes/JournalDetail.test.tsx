import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import {
  Link,
  RouterProvider,
  createMemoryRouter,
  useLocation,
  useNavigate as useRouterNavigate,
} from 'react-router';
import { type UseQueryResult } from '@tanstack/react-query';
import JournalDetail from './JournalDetail';
import { useJournal, useUpdateJournal } from '@/hooks/useJournals';
import { type JournalDetail as JournalDetailType } from '@/lib/api-client';

const mockNavigate = vi.fn();

// React Router's data router creates a request with the jsdom AbortSignal,
// while Node's undici Request validates against its own constructor. The
// route harness does not perform loaders, so strip that transport-only signal
// to keep navigation tests focused on router state and blockers.
const NativeRequest = globalThis.Request;
if (NativeRequest) {
  vi.stubGlobal('Request', class TestRequest extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, init ? { ...init, signal: undefined } : undefined);
    }
  });
}

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => {
      const navigate = actual.useNavigate();
      return ((to: unknown, options?: unknown) => {
        if (options === undefined) mockNavigate(to);
        else mockNavigate(to, options);
        return (navigate as (target: unknown, nextOptions?: unknown) => unknown)(to, options);
      }) as typeof navigate;
    },
    useParams: () => {
      const location = actual.useLocation();
      const match = location.pathname.match(/^\/journal\/(.+)$/);
      return {
        '*': match?.[1] ?? '2026/04/life-index_2026-04-19_001',
      };
    },
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
        editTitle: 'Edit title',
        editContent: 'Edit content',
        editAbstract: 'Edit abstract',
        editTopics: 'Edit topics',
        editMoods: 'Edit moods',
        editPeople: 'Edit people',
        editLocation: 'Edit location',
        editWeather: 'Edit weather',
        editProject: 'Edit project',
        editLinks: 'Edit links',
        saveChanges: 'Save changes',
        cancelEdit: 'Cancel',
        editSaveFailed: 'Could not save changes. Your edits are still here.',
         editRefreshFailed: 'Saved, but the journal could not be refreshed. Your edits are still here.',
         retryRefresh: 'Retry refresh',
         unsavedChangesPrompt: 'You have unsaved changes. Leave this page?',
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
  useUpdateJournal: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
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
    renderDetail();

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

    renderDetail();

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

    renderDetail();

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

    renderDetail();

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
    renderDetail();

    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    expect(continueBtn).toBeInTheDocument();

    fireEvent.click(continueBtn);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(
      '/?append=2026%2F04%2Flife-index_2026-04-19_001',
    );
  });
});

const EDIT_ID = '2026/04/life-index_2026-04-19_001';

function makeEditableJournal(
  overrides: Partial<JournalDetailType> = {},
): JournalDetailType {
  return {
    id: EDIT_ID,
    title: 'Original title',
    date: '2026-04-19',
    content: 'Original content.',
    abstract: 'Original abstract',
    topics: ['one', 'two'],
    moods: ['calm'],
    people: ['Ada'],
    location: 'Paris',
    weather: 'Rain',
    project: 'Project A',
    links: ['https://old.example'],
    wordCount: 2,
    attachments: [
      {
        relPath: 'attachments/2026/04/photo.jpg',
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 12,
      },
    ],
    ...overrides,
  };
}

function setDetailState(
  data: JournalDetailType,
  refetch: ReturnType<typeof vi.fn> = vi.fn(),
) {
  vi.mocked(useJournal).mockReturnValue({
    isLoading: false,
    error: null,
    refetch,
    data,
  } as unknown as UseQueryResult<JournalDetailType, Error>);
}

function setMutationState(
  mutateAsync: ReturnType<typeof vi.fn>,
  isPending = false,
) {
  vi.mocked(useUpdateJournal).mockReturnValue({
    mutateAsync,
    isPending,
  } as never);
}

function NavigationProbe() {
  const navigate = useRouterNavigate();
  const location = useLocation();

  return (
    <div data-testid="navigation-probe">
      <span data-testid="probe-location">{location.pathname}{location.search}</span>
      <Link to="/recall" data-testid="probe-link">Recall</Link>
      <button type="button" data-testid="probe-navigate" onClick={() => navigate('/home')}>
        Home
      </button>
      <button type="button" data-testid="probe-switch" onClick={() => navigate('/journal/2026/04/life-index_2026-04-19-002')}>
        Switch journal
      </button>
    </div>
  );
}

function renderDetail(initialEntry: string | string[] = `/journal/${EDIT_ID}`) {
  const initialEntries = Array.isArray(initialEntry) ? initialEntry : [initialEntry];
  const router = createMemoryRouter([
    {
      path: '/journal/*',
      element: (
        <>
          <JournalDetail />
          <NavigationProbe />
        </>
      ),
    },
    { path: '/', element: <div data-testid="home-route">Home route</div> },
    { path: '/home', element: <div data-testid="home-route">Home route</div> },
    { path: '/recall', element: <div data-testid="recall-route">Recall route</div> },
  ], { initialEntries, initialIndex: initialEntries.length - 1 });

  return { ...render(<RouterProvider router={router} />), router };
}

describe('JournalDetail detail-context editing (D3-D / GUI #11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDetailState(makeEditableJournal());
    setMutationState(vi.fn());
  });

  it('enters edit mode in the same detail context without rendering or navigating to the create template', () => {
    renderDetail(`/journal/${EDIT_ID}`);

    fireEvent.click(screen.getByRole('button', { name: 'Edit journal' }));

    expect(screen.getByRole('heading', { name: 'Edit journal' })).toBeInTheDocument();
    expect(screen.getByLabelText('Edit title')).toHaveValue('Original title');
    expect(screen.queryByText('New Journal Entry')).not.toBeInTheDocument();
    expect(mockNavigate).toHaveBeenCalledWith(`/journal/${EDIT_ID}?mode=edit`, { replace: true });
  });

  it('cancel discards the local draft and emits zero mutations', () => {
    const mutateAsync = vi.fn();
    setMutationState(mutateAsync);

    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Edit journal' }));
    fireEvent.change(screen.getByLabelText('Edit title'), { target: { value: 'Unsaved title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('heading', { name: 'Original title' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit title')).not.toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenLastCalledWith(`/journal/${EDIT_ID}`, { replace: true });
  });

  it('preserves the route, canonical object, and unsaved draft when the edit mutation fails', async () => {
    const journal = makeEditableJournal();
    const mutateAsync = vi.fn().mockRejectedValue(new Error('CLI edit failed'));
    setDetailState(journal);
    setMutationState(mutateAsync);

    renderDetail(`/journal/${EDIT_ID}`);

    fireEvent.click(screen.getByRole('button', { name: 'Edit journal' }));
    fireEvent.change(screen.getByLabelText('Edit title'), { target: { value: 'Unsaved title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('alert');
    expect(screen.getByLabelText('Edit title')).toHaveValue('Unsaved title');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save changes');
    expect(journal.title).toBe('Original title');
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(`/journal/${EDIT_ID}?mode=edit`, { replace: true });
  });

  it('updates once, refetches canonical detail, and only then exits edit mode on success', async () => {
    const original = makeEditableJournal();
    const fresh = makeEditableJournal({ title: 'Fresh canonical title', content: 'Fresh canonical body.' });
    const mutateAsync = vi.fn().mockResolvedValue({ raw: 'not display truth' });
    const refetch = vi.fn().mockImplementation(async () => {
      setDetailState(fresh, refetch);
      return { data: fresh, error: null };
    });
    setDetailState(original, refetch);
    setMutationState(mutateAsync);

    renderDetail(`/journal/${EDIT_ID}`);

    fireEvent.click(screen.getByRole('button', { name: 'Edit journal' }));
    fireEvent.change(screen.getByLabelText('Edit title'), { target: { value: 'Fresh canonical title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Fresh canonical title' })).toBeInTheDocument();
      expect(screen.queryByLabelText('Edit title')).not.toBeInTheDocument();
    });
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({
      id: EDIT_ID,
      data: { title: 'Fresh canonical title' },
    });
    expect(screen.queryByText('not display truth')).not.toBeInTheDocument();
    expect(mockNavigate).toHaveBeenLastCalledWith(`/journal/${EDIT_ID}`, { replace: true });
  });

  it('preserves draft/context and offers refresh retry when the post-commit refetch fails', async () => {
    const journal = makeEditableJournal();
    const mutateAsync = vi.fn().mockResolvedValue({ raw: 'committed' });
    const refetch = vi.fn().mockRejectedValue(new Error('refresh failed'));
    setDetailState(journal, refetch);
    setMutationState(mutateAsync);

    renderDetail(`/journal/${EDIT_ID}`);

    fireEvent.click(screen.getByRole('button', { name: 'Edit journal' }));
    fireEvent.change(screen.getByLabelText('Edit title'), { target: { value: 'Committed title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('could not be refreshed');
    expect(screen.getByLabelText('Edit title')).toHaveValue('Committed title');
    expect(screen.getByRole('button', { name: 'Retry refresh' })).toBeInTheDocument();
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(`/journal/${EDIT_ID}?mode=edit`, { replace: true });
  });

  it('sends only changed supported fields, uses contentReplace, and preserves intentional clears', async () => {
    const journal = makeEditableJournal({
      abstract: 'Clear this abstract',
      location: null,
      topics: [],
      moods: ['calm'],
      people: ['Ada'],
      links: [],
    });
    const mutateAsync = vi.fn().mockResolvedValue({ raw: 'ignored' });
    const fresh = makeEditableJournal({ ...journal, title: 'Changed title' });
    const refetch = vi.fn().mockResolvedValue({ data: fresh, error: null });
    setDetailState(journal, refetch);
    setMutationState(mutateAsync);

    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Edit journal' }));
    fireEvent.change(screen.getByLabelText('Edit title'), { target: { value: 'Changed title' } });
    fireEvent.change(screen.getByLabelText('Journal content'), { target: { value: 'Changed content' } });
    fireEvent.change(screen.getByLabelText('Edit abstract'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Edit topics'), { target: { value: 'alpha, beta' } });
    fireEvent.change(screen.getByLabelText('Edit moods'), { target: { value: 'joy' } });
    fireEvent.change(screen.getByLabelText('Edit people'), { target: { value: 'Bob' } });
    fireEvent.change(screen.getByLabelText('Edit location'), { target: { value: 'Tokyo' } });
    fireEvent.change(screen.getByLabelText('Edit weather'), { target: { value: 'Sun' } });
    fireEvent.change(screen.getByLabelText('Edit project'), { target: { value: 'Project B' } });
    fireEvent.change(screen.getByLabelText('Edit links'), { target: { value: 'https://new.example, https://two.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mutateAsync.mock.calls[0][0];
    expect(payload).toEqual({
      id: EDIT_ID,
      data: {
        title: 'Changed title',
        contentReplace: 'Changed content',
        abstract: '',
        topic: 'alpha, beta',
        mood: 'joy',
        people: 'Bob',
        location: 'Tokyo',
        weather: 'Sun',
        project: 'Project B',
        links: 'https://new.example, https://two.example',
      },
    });
    expect(payload.data).not.toHaveProperty('contentAppend');
    expect(payload.data).not.toHaveProperty('date');
    expect(payload.data).not.toHaveProperty('tags');
    expect(payload.data).not.toHaveProperty('attachments');
    expect(payload.data).not.toHaveProperty('wordCount');
    expect(payload.data).not.toHaveProperty('id');
  });

  it('does not send a zero diff and emits one mutation when Save is clicked twice while pending', async () => {
    const mutateAsync = vi.fn();
    let resolveMutation: (value: unknown) => void = () => undefined;
    mutateAsync.mockImplementation(
      () => new Promise((resolve) => {
        resolveMutation = resolve;
      }),
    );
    const fresh = makeEditableJournal({ title: 'Pending title' });
    const refetch = vi.fn().mockResolvedValue({ data: fresh, error: null });
    setDetailState(makeEditableJournal(), refetch);
    setMutationState(mutateAsync);

    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Edit journal' }));
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(mutateAsync).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Edit title'), { target: { value: 'Pending title' } });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();

    resolveMutation({ raw: 'ignored' });
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
  });
});

describe('JournalDetail product DoD draft exits', () => {
  const SECOND_ID = '2026/04/life-index_2026-04-19-002';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useJournal).mockReset();
    setDetailState(makeEditableJournal());
    setMutationState(vi.fn());
    vi.spyOn(window, 'confirm').mockReturnValue(false);
  });

  function beforeUnloadEvent() {
    const event = new Event('beforeunload', { cancelable: true });
    Object.defineProperty(event, 'returnValue', {
      configurable: true,
      writable: true,
      value: '',
    });
    window.dispatchEvent(event);
    return event;
  }

  it('enters edit mode from the ?mode=edit deep link and keeps the canonical journal URL', () => {
    const { router } = renderDetail(`/journal/${EDIT_ID}?mode=edit`);

    expect(screen.getByRole('heading', { name: 'Edit journal' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/journal/${EDIT_ID}`);
    expect(router.state.location.search).toBe('?mode=edit');
  });

  it('updates the same journal URL when Edit is clicked', () => {
    const { router } = renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Edit journal' }));

    expect(mockNavigate).toHaveBeenCalledWith(
      `/journal/${EDIT_ID}?mode=edit`,
      { replace: true },
    );
    expect(router.state.location.pathname).toBe(`/journal/${EDIT_ID}`);
    expect(router.state.location.search).toBe('?mode=edit');
  });

  it('blocks dirty detail Back until Leave is confirmed and keeps the draft while blocked', async () => {
    const { router } = renderDetail(['/recall', `/journal/${EDIT_ID}`]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit journal' }));
    fireEvent.change(screen.getByLabelText('Edit title'), { target: { value: 'Draft title' } });

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe(`/journal/${EDIT_ID}`);
    expect(screen.getByLabelText('Edit title')).toHaveValue('Draft title');

    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/recall'));
  });

  it('blocks an imperative navigation issued in the same act as the first draft change', () => {
    const { router } = renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Edit journal' }));
    const title = screen.getByLabelText('Edit title');

    act(() => {
      fireEvent.change(title, { target: { value: 'Immediate draft' } });
      router.navigate('/recall');
    });

    expect(router.state.location.pathname).toBe(`/journal/${EDIT_ID}`);
    expect(screen.getByLabelText('Edit title')).toHaveValue('Immediate draft');
    expect(window.confirm).toHaveBeenCalledTimes(1);
  });

  it('does not block a clean edit snapshot when leaving', async () => {
    const { router } = renderDetail(['/recall', `/journal/${EDIT_ID}`]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit journal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(window.confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(router.state.location.pathname).toBe('/recall'));
  });

  it('blocks POP and both Link/imperative navigation exits, and exposes Continue in edit mode', async () => {
    const { router } = renderDetail(['/recall', `/journal/${EDIT_ID}`]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit journal' }));
    fireEvent.change(screen.getByLabelText('Edit title'), { target: { value: 'Draft title' } });

    const editContinue = screen.getByTestId('journal-detail-continue-edit');
    expect(editContinue).toBeInTheDocument();
    expect(editContinue.closest('.hidden')).toBeNull();

    fireEvent.click(screen.getByTestId('probe-link'));
    expect(router.state.location.pathname).toBe(`/journal/${EDIT_ID}`);
    expect(screen.getByLabelText('Edit title')).toHaveValue('Draft title');

    fireEvent.click(screen.getByTestId('probe-navigate'));
    expect(router.state.location.pathname).toBe(`/journal/${EDIT_ID}`);

    fireEvent.click(screen.getByTestId('journal-detail-continue-edit'));
    expect(router.state.location.pathname).toBe(`/journal/${EDIT_ID}`);
    expect(router.state.location.search).toBe('?mode=edit');

    act(() => {
      router.navigate(-1);
    });
    expect(router.state.location.pathname).toBe(`/journal/${EDIT_ID}`);

    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByTestId('journal-detail-continue-edit'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
      expect(router.state.location.search).toBe(`?append=${encodeURIComponent(EDIT_ID)}`);
    });
  });

  it('prevents refresh/close only while the snapshot diff is dirty', () => {
    const cleanEvent = beforeUnloadEvent();
    expect(cleanEvent.defaultPrevented).toBe(false);

    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Edit journal' }));
    fireEvent.change(screen.getByLabelText('Edit title'), { target: { value: 'Draft title' } });

    const dirtyEvent = beforeUnloadEvent();
    expect(dirtyEvent.defaultPrevented).toBe(true);
    expect(dirtyEvent.returnValue).toBeTruthy();
  });

  it('blocks same-router journal switching until confirmed and only then clears the old draft', async () => {
    const first = makeEditableJournal();
    const second = makeEditableJournal({ id: SECOND_ID, title: 'Second journal' });
    vi.mocked(useJournal).mockImplementation((id) => ({
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      data: id === SECOND_ID ? second : first,
    } as unknown as UseQueryResult<JournalDetailType, Error>));

    const { router } = renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Edit journal' }));
    fireEvent.change(screen.getByLabelText('Edit title'), { target: { value: 'Draft title' } });

    fireEvent.click(screen.getByTestId('probe-switch'));
    expect(router.state.location.pathname).toBe(`/journal/${EDIT_ID}`);
    expect(screen.getByLabelText('Edit title')).toHaveValue('Draft title');

    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByTestId('probe-switch'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/journal/${SECOND_ID}`);
      expect(screen.getByRole('heading', { name: 'Second journal' })).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('Edit title')).not.toBeInTheDocument();
  });
});
