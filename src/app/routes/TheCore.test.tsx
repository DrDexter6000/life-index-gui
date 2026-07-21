import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import TheCore from './TheCore';
import { useUIStore } from '@/stores/ui';
import { useJournalDraftStore } from '@/stores/journal-draft';

/** Renders the current pathname so tests can assert no navigation occurred. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="current-pathname">{location.pathname}</span>;
}

// Mock the hooks - will be configured per test
const mockUseDashboardStats = vi.fn();
const mockUseRecentJournals = vi.fn();
const mockUseJournal = vi.fn();
const mockUseCreateJournal = vi.fn();
const mockUseUpdateJournal = vi.fn();
const mockJournalAPI = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}));
const mockHostAgentAPI = vi.hoisted(() => ({
  getHealth: vi.fn(),
  proposeMetadata: vi.fn(),
}));

vi.mock('@/hooks/useJournals', () => ({
  useDashboardStats: () => mockUseDashboardStats(),
  useRecentJournals: () => mockUseRecentJournals(),
  useJournal: (id: string) => mockUseJournal(id),
  useCreateJournal: () => mockUseCreateJournal(),
  useUpdateJournal: () => mockUseUpdateJournal(),
  useHealthCheck: () => ({ data: null, isError: false }),
}));

// Mock healthAPI — S5 health-degraded banner
vi.mock('@/lib/api-client', () => ({
  healthAPI: {
    getHealth: vi.fn().mockResolvedValue({
      status: 'ok',
      cli_available: true,
      compatible: true,
      package_version: '1.2.1',
      repo_version: '1.2.1',
      health: { status: 'healthy' },
    }),
  },
  dashboardAPI: {
    getGeocode: vi.fn().mockResolvedValue('Hangzhou, China'),
    getWeather: vi.fn().mockResolvedValue('Clear'),
  },
  journalAPI: mockJournalAPI,
  hostAgentAPI: mockHostAgentAPI,
}));

// Mock motion/react so AnimatePresence panels render their children in JSDOM.
// This lets TA-3 tests interact with the attachment file input.
// useReducedMotion defaults to true so existing navigate assertions stay synchronous.
const mockReducedMotion = vi.hoisted(() => ({ value: true }));
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    button: 'button',
    div: 'div',
  },
  useReducedMotion: () => mockReducedMotion.value,
}));

// Default mock implementations
const defaultMocks = () => {
  mockUseDashboardStats.mockReturnValue({
    data: { totalJournals: 0 },
    isLoading: false,
  });
  mockUseRecentJournals.mockReturnValue({
    data: [],
    isLoading: false,
  });
  mockUseJournal.mockReturnValue({
    data: undefined,
    isLoading: false,
  });
  mockUseCreateJournal.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
  mockUseUpdateJournal.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
  mockJournalAPI.create.mockReset().mockResolvedValue({ id: 'journal-write-boundary' });
  mockJournalAPI.update.mockReset().mockResolvedValue({ id: 'journal-write-boundary' });
  mockHostAgentAPI.getHealth.mockReset().mockResolvedValue({
    schema_version: 'gui.host_agent.health.v1',
    running: true,
    ready: true,
    degraded: false,
    mode: 'READY',
    reason: 'ready',
    runtime: { kind: 'external-host-agent', interface_version: 'v1' },
    checks: [],
  });
  mockHostAgentAPI.proposeMetadata.mockReset().mockImplementation((request: { request_id: string }) => Promise.resolve({
    schema_version: 'gui.host_agent.metadata_proposal.v1',
    request_id: request.request_id,
    mode: 'PROPOSED',
    reason: 'synthetic proposal',
    fields: {
      project: {
        value: 'Proposed project',
        field_source: 'test',
        confidence: 0.9,
        rationale: 'synthetic',
      },
    },
    warnings: [],
  }));
};

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

function renderWithProviders(
  ui: React.ReactElement,
  initialEntries: string[] = ['/'],
) {
  const queryClient = createTestQueryClient();
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          {ui}
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    ),
    queryClient,
  };
}

describe('TheCore', () => {
  beforeEach(() => {
    defaultMocks();
    mockReducedMotion.value = true;
    window.localStorage.clear();
    useUIStore.getState().resetHome();
    // Reset draft store
    useJournalDraftStore.getState().reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('should render EmptyState when totalJournals is 0', async () => {
    renderWithProviders(<TheCore />);

    // EmptyState is lazy-loaded via React.lazy, so we need waitFor
    await waitFor(
      () => {
        expect(screen.getByText('你的星空尚未点亮')).toBeInTheDocument();
      },
      { timeout: 5_000 },
    );
    expect(screen.getByText('写第一篇')).toBeInTheDocument();

    // Should NOT show greeting or editor (EmptyState replaces the write page)
    expect(screen.queryByText('Welcome Back')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("写下此时的想法... / Write down what's on your mind...")).not.toBeInTheDocument();

    // Legacy empty state text should not appear
    expect(screen.queryByText('开始记录')).not.toBeInTheDocument();
  });

  it('activates the official editor from a fresh zero-journal EmptyState without creating a journal', async () => {
    window.localStorage.clear();
    useUIStore.getState().resetHome();
    useJournalDraftStore.getState().reset();
    mockUseDashboardStats.mockReturnValue({
      data: { totalJournals: 0 },
      isLoading: false,
    });
    const createMutation = vi.fn();
    mockUseCreateJournal.mockReturnValue({
      mutateAsync: createMutation,
      isPending: false,
    });

    renderWithProviders(<TheCore />);

    await waitFor(() => {
      expect(screen.getByText('你的星空尚未点亮')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('Journal content')).not.toBeInTheDocument();

    const writeFirstButton = screen.getByRole('button', { name: '写第一篇' });
    expect(writeFirstButton).toBeEnabled();
    expect(writeFirstButton).toHaveAttribute('type', 'button');

    fireEvent.click(writeFirstButton);

    const editor = await screen.findByLabelText('Journal content');
    expect(screen.queryByText('你的星空尚未点亮')).not.toBeInTheDocument();
    expect(screen.getByTestId('current-pathname')).toHaveTextContent('/');
    expect(editor).toHaveAttribute('id', 'editor-textarea');
    expect(editor).toHaveFocus();
    expect(createMutation).not.toHaveBeenCalled();
  });

  it('should render write page with greeting and editor when journals exist', () => {
    mockUseDashboardStats.mockReturnValue({
      data: { totalJournals: 5 },
      isLoading: false,
    });
    useUIStore.getState().setHomeActivated(true);

    renderWithProviders(<TheCore />);

    // Editor with translated placeholder after the hero has been activated
    expect(screen.getByPlaceholderText("写下此时的想法... / Write down what's on your mind...")).toBeInTheDocument();
    expect(screen.getByText('NEW THREAD / 新织线')).toBeInTheDocument();

    // Save button
    expect(screen.getByText('保存')).toBeInTheDocument();

    // Should NOT have old deprecated sections
    expect(screen.queryByText('数碑')).not.toBeInTheDocument();
    expect(screen.queryByText('潮汐线')).not.toBeInTheDocument();
  });

  it('refreshes a pristine new draft date when the write surface opens after module load', async () => {
    mockUseDashboardStats.mockReturnValue({
      data: { totalJournals: 5 },
      isLoading: false,
    });
    useUIStore.getState().setHomeActivated(true);

    const currentState = useJournalDraftStore.getState();
    useJournalDraftStore.setState({
      content: '',
      metadata: { ...currentState.metadata, date: '1999-12-31' },
      isDirty: false,
      lastSaved: null,
    });

    const now = new Date();
    const expectedLocalDate = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');

    renderWithProviders(<TheCore />);

    await waitFor(() => {
      expect(useJournalDraftStore.getState().metadata.date).toBe(expectedLocalDate);
    });
  });

  it('should show loading spinner during journal creation', () => {
    // Must have journals > 0 to skip EmptyState path
    mockUseDashboardStats.mockReturnValue({
      data: { totalJournals: 5 },
      isLoading: false,
    });
    mockUseCreateJournal.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: true,
    });

    renderWithProviders(<TheCore />);

    // CelestialLoader renders in a min-h-[60vh] container
    const loaderContainer = document.querySelector('[class*="min-h-[60vh]"]');
    expect(loaderContainer).toBeInTheDocument();

    // CelestialLoader renders orbit rings with rounded-full class
    const orbitRing = document.querySelector('[class*="rounded-full"]');
    expect(orbitRing).toBeInTheDocument();

    // Should NOT show greeting while loading
    expect(screen.queryByText('Welcome Back')).not.toBeInTheDocument();
  });

  it('should NOT render demo cards in zero-data state', () => {
    renderWithProviders(<TheCore />);

    // Demo card content should not exist (current implementation uses EmptyState)
    expect(screen.queryByText('周末的街角咖啡馆')).not.toBeInTheDocument();
    expect(screen.queryByText('关于新项目的灵感')).not.toBeInTheDocument();
    expect(screen.queryByText('睡不着的夜晚')).not.toBeInTheDocument();
    expect(screen.queryByText('Synthetic legacy memory card')).not.toBeInTheDocument();

    // Topic badges from legacy demo cards should not exist
    expect(screen.queryByText('日常碎片')).not.toBeInTheDocument();
    expect(screen.queryByText('工作灵感')).not.toBeInTheDocument();

    // Mood emojis from legacy demo cards should not exist
    expect(screen.queryByText('☕')).not.toBeInTheDocument();
    expect(screen.queryByText('🌱')).not.toBeInTheDocument();
  });

  describe('Loading states', () => {
    it('should render content when not loading and journals exist', () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      renderWithProviders(<TheCore />);

      // Should show actual content
      expect(screen.getByPlaceholderText("写下此时的想法... / Write down what's on your mind...")).toBeInTheDocument();
      expect(screen.getByText('保存')).toBeInTheDocument();

      // Should NOT show stale loading text
      expect(screen.queryByText('正在读取记忆...')).not.toBeInTheDocument();
      expect(screen.queryByText('正在加载...')).not.toBeInTheDocument();
    });
  });

  // --- S2 Exit Gate: Write, Draft, And Confirmation Flow ---

  describe('S2 - Write error handling', () => {
    it('should display error message when write fails', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      const rejectError = Object.assign(new Error('Write failed'), {
        code: 'WRITE_ERROR',
      });
      const mockMutateAsync = vi.fn().mockRejectedValue(rejectError);
      mockUseCreateJournal.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      });

      // Set draft content so save is enabled
      useJournalDraftStore.getState().setContent('test content');
      useJournalDraftStore.getState().updateMetadata({ title: 'Test Title' });

      renderWithProviders(<TheCore />);

      // Find and click save button
      const saveButton = screen.getByText('保存');
      expect(saveButton).toBeInTheDocument();
      fireEvent.click(saveButton);

      // Wait for error banner to appear
      await waitFor(() => {
        expect(screen.getByText('保存失败，请重试')).toBeInTheDocument();
      });
    });

    it('should preserve draft text after failed write attempt', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      const rejectError = Object.assign(new Error('Write failed'), {
        code: 'WRITE_ERROR',
      });
      const mockMutateAsync = vi.fn().mockRejectedValue(rejectError);
      mockUseCreateJournal.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      });

      const originalContent = 'My precious draft content that must survive';
      useJournalDraftStore.getState().setContent(originalContent);
      useJournalDraftStore.getState().updateMetadata({ title: 'Survivor Title' });

      renderWithProviders(<TheCore />);

      // Click save to trigger failure
      const saveButton = screen.getByText('保存');
      fireEvent.click(saveButton);

      // Wait for error to appear
      await waitFor(() => {
        expect(screen.getByText('保存失败，请重试')).toBeInTheDocument();
      });

      // Draft content must still be in the editor
      const textarea = screen.getByLabelText('Journal content');
      expect(textarea).toHaveValue(originalContent);

      // Draft store must still hold the content
      expect(useJournalDraftStore.getState().content).toBe(originalContent);
      expect(useJournalDraftStore.getState().metadata.title).toBe('Survivor Title');
    });

    it('should navigate to journal detail even when create returns needsConfirmation=true', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      const mockMutateAsync = vi.fn().mockResolvedValue({
        id: 'journal-confirm-001',
        needsConfirmation: true,
        confirmation: {
          message: '确认要保存这篇日志吗？',
          choices: ['确认', '取消'],
        },
      });
      mockUseCreateJournal.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      });

      useJournalDraftStore.getState().setContent('Draft content');
      useJournalDraftStore.getState().updateMetadata({ title: 'Confirmation Title' });

      renderWithProviders(<TheCore />);

      const saveButton = screen.getByText('保存');
      fireEvent.click(saveButton);

      // Must navigate to the detail page — needsConfirmation no longer blocks create
      await waitFor(() => {
        expect(screen.getByTestId('current-pathname')).toHaveTextContent(
          '/journal/journal-confirm-001',
        );
      });

      // Must NOT show any confirmation-needed banner
      expect(screen.queryByText('确认要保存这篇日志吗？')).not.toBeInTheDocument();
      expect(screen.queryByText('需要确认，请检查后再保存')).not.toBeInTheDocument();

      // Must NOT show the save error banner — this is not a write failure
      expect(screen.queryByText('保存失败，请重试')).not.toBeInTheDocument();
    });

    it('should display validation error message for incomplete data', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      const rejectError = Object.assign(new Error('Validation failed'), {
        code: 'VALIDATION_ERROR',
      });
      const mockMutateAsync = vi.fn().mockRejectedValue(rejectError);
      mockUseCreateJournal.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      });

      useJournalDraftStore.getState().setContent('validation test');
      useJournalDraftStore.getState().updateMetadata({ title: 'Val Test' });

      renderWithProviders(<TheCore />);

      const saveButton = screen.getByText('保存');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText('信息不完整，请检查后重试')).toBeInTheDocument();
      });
    });

    it('keeps metadata proposal and acceptance outside the journal write boundary until normal save', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);
      useJournalDraftStore.getState().setContent('write-boundary integration draft');
      useJournalDraftStore.getState().updateMetadata({
        location: 'Stored City, Stored Country',
        weather: 'Clear',
      });

      mockUseCreateJournal.mockReturnValue({
        mutateAsync: (data: unknown) => mockJournalAPI.create(data),
        isPending: false,
      });
      mockUseUpdateJournal.mockReturnValue({
        mutateAsync: (variables: { id: string; data: unknown }) => mockJournalAPI.update(variables.id, variables.data),
        isPending: false,
      });

      renderWithProviders(<TheCore />);

      fireEvent.click(screen.getByText('元数据').closest('button')!);
      const proposeButton = await screen.findByTestId('metadata-agent-propose-button');
      await waitFor(() => expect(proposeButton).not.toBeDisabled());

      fireEvent.click(proposeButton);
      await waitFor(() => expect(mockHostAgentAPI.proposeMetadata).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByTestId('metadata-proposal-panel')).toBeInTheDocument());

      expect(mockJournalAPI.create).not.toHaveBeenCalled();
      expect(mockJournalAPI.update).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('metadata-proposal-accept-project'));
      await waitFor(() => expect(document.querySelector<HTMLInputElement>('#metadata-project')).toHaveValue('Proposed project'));
      expect(mockJournalAPI.create).not.toHaveBeenCalled();
      expect(mockJournalAPI.update).not.toHaveBeenCalled();

      fireEvent.click(screen.getByText('保存'));
      await waitFor(() => expect(mockJournalAPI.create).toHaveBeenCalledTimes(1));
      expect(mockJournalAPI.update).not.toHaveBeenCalled();
    });

    it('should submit filled weather when creating a new journal', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      const mockMutateAsync = vi.fn().mockResolvedValue({ id: 'journal-001' });
      mockUseCreateJournal.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      });

      useJournalDraftStore.getState().setContent('weather-enriched content');
      useJournalDraftStore.getState().updateMetadata({
        title: 'Weather Title',
        location: 'Hangzhou, China',
        weather: 'Clear, 18℃-27℃',
      });

      renderWithProviders(<TheCore />);

      fireEvent.click(screen.getByText('保存'));

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
          title: 'Weather Title',
          content: 'weather-enriched content',
          location: 'Hangzhou, China',
          weather: 'Clear, 18℃-27℃',
        }));
      });
    });

    it('should submit the date currently shown in the new journal metadata', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      const mockMutateAsync = vi.fn().mockResolvedValue({ id: 'journal-local-date' });
      mockUseCreateJournal.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      });

      useJournalDraftStore.getState().setContent('local date content');
      useJournalDraftStore.getState().updateMetadata({
        title: 'Local Date Title',
        date: '2026-07-20',
      });

      renderWithProviders(<TheCore />);
      fireEvent.click(screen.getByText('保存'));

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
          date: '2026-07-20',
        }));
      });
    });

    it('should block a new journal save when the editable date is blank', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      const mockMutateAsync = vi.fn().mockResolvedValue({ id: 'journal-host-date-fallback' });
      mockUseCreateJournal.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      });

      useJournalDraftStore.getState().setContent('blank date must not reach the host');
      useJournalDraftStore.getState().updateMetadata({
        title: 'Blank Date',
        date: '',
      });

      renderWithProviders(<TheCore />);
      fireEvent.click(screen.getByText('保存'));

      await waitFor(() => {
        expect(screen.getByText('信息不完整，请检查后重试')).toBeInTheDocument();
      });
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });
  });

  describe('unsaved draft recovery', () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    afterEach(() => {
      window.localStorage.clear();
    });

    it('restores unsaved content and metadata after the write page is recreated', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      const firstRender = renderWithProviders(<TheCore />);

      fireEvent.change(screen.getByLabelText('Journal content'), {
        target: { value: '手机端写了很长的一段草稿，刷新后不能丢。' },
      });
      fireEvent.click(screen.getByText('元数据'));
      fireEvent.change(screen.getByLabelText('标题'), {
        target: { value: '手机草稿恢复测试' },
      });

      firstRender.unmount();
      useJournalDraftStore.getState().reset();
      useUIStore.getState().setHomeActivated(true);

      renderWithProviders(<TheCore />);

      await waitFor(() => {
        expect(screen.getByLabelText('Journal content')).toHaveValue(
          '手机端写了很长的一段草稿，刷新后不能丢。',
        );
      });

      fireEvent.click(screen.getByText('元数据'));
      await waitFor(() => {
        expect(screen.getByLabelText('标题')).toHaveValue('手机草稿恢复测试');
      });
    });

    it('restores selected attachments after the write page is recreated', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      const firstRender = renderWithProviders(<TheCore />);

      fireEvent.change(screen.getByLabelText('Journal content'), {
        target: { value: '带附件的草稿也不能因为刷新丢失。' },
      });
      fireEvent.click(screen.getByText('附件'));

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['phone attachment bytes'], 'phone-note.txt', { type: 'text/plain' });
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText('phone-note.txt')).toBeInTheDocument();
      });
      await waitFor(() => {
        const cachedValues = Array.from({ length: window.localStorage.length }, (_, index) => {
          const key = window.localStorage.key(index);
          return key ? window.localStorage.getItem(key) : null;
        });
        expect(cachedValues.some((value) => value?.includes('phone-note.txt'))).toBe(true);
      });

      firstRender.unmount();
      useJournalDraftStore.getState().reset();
      useUIStore.getState().setHomeActivated(true);

      renderWithProviders(<TheCore />);
      fireEvent.click(screen.getByText('附件'));

      await waitFor(() => {
        expect(screen.getByText('phone-note.txt')).toBeInTheDocument();
      });
    });

    it('clears the recovered draft after a successful save', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      const mockMutateAsync = vi.fn().mockResolvedValue({ id: 'journal-saved-draft' });
      mockUseCreateJournal.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      });

      const firstRender = renderWithProviders(<TheCore />);

      fireEvent.change(screen.getByLabelText('Journal content'), {
        target: { value: '保存后这份本地草稿必须清掉。' },
      });
      fireEvent.click(screen.getByText('保存'));

      await waitFor(() => {
        expect(screen.getByTestId('current-pathname')).toHaveTextContent(
          '/journal/journal-saved-draft',
        );
      });

      firstRender.unmount();
      useJournalDraftStore.getState().reset();
      useUIStore.getState().setHomeActivated(true);

      renderWithProviders(<TheCore />);

      await waitFor(() => {
        expect(screen.getByLabelText('Journal content')).toHaveValue('');
      });
    });
  });

  // --- S3/S6 Exit Gate: Detail -> edit continuation flow ---

  describe('S6 - Edit continuation', () => {
    it('should load an existing journal from the edit query and submit updates through the journal API', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });

      const editId = '2026/05/life-index_2026-05-28_001';
      const mockUpdate = vi.fn().mockResolvedValue({ id: editId });
      mockUseJournal.mockImplementation((id: string) => ({
        data: id === editId
          ? {
              id,
              title: 'Existing Title',
              date: '2026-05-28',
              content: 'Existing content',
              abstract: null,
              topics: ['work'],
              moods: ['focused'],
              people: ['Alice'],
              location: 'Hangzhou',
              weather: 'Clear',
              project: 'Life Index',
              links: [],
              wordCount: 2,
            }
          : undefined,
        isLoading: false,
      }));
      mockUseUpdateJournal.mockReturnValue({
        mutateAsync: mockUpdate,
        isPending: false,
      });

      renderWithProviders(
        <TheCore />,
        [`/?edit=${encodeURIComponent(editId)}`],
      );

      const textarea = await screen.findByLabelText('Journal content');
      await waitFor(() => {
        expect(textarea).toHaveValue('Existing content');
      });

      fireEvent.change(textarea, { target: { value: 'Edited content' } });
      fireEvent.click(screen.getByText('保存'));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith({
          id: editId,
          data: expect.objectContaining({
            title: 'Existing Title',
            contentReplace: 'Edited content',
            topic: 'work',
            mood: 'focused',
            people: 'Alice',
            location: 'Hangzhou',
            weather: 'Clear',
            project: 'Life Index',
          }),
        });
      });
      await waitFor(() => {
        expect(screen.getByTestId('current-pathname')).toHaveTextContent(
          `/journal/${editId}`,
        );
      });
    });
  });

  // --- S5 Exit Gate: Mobile, Smart status, Manual Fallback ---

  describe('S5 - Write surface status presentation', () => {
    it('does not render a large degraded-status banner above the editor', () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      renderWithProviders(<TheCore />);

      expect(screen.queryByTestId('health-degraded-banner')).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText("写下此时的想法... / Write down what's on your mind...")).toBeInTheDocument();
    });

    it('allows writing controls to keep their original position without a status banner', () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      renderWithProviders(<TheCore />);

      expect(screen.getByText('保存')).toBeInTheDocument();
      expect(screen.getByText('元数据')).toBeInTheDocument();
      expect(screen.queryByTestId('health-degraded-banner')).not.toBeInTheDocument();
    });
  });

  describe('S6 - Append continuation', () => {
    it('should start with an empty editor, show a continuation banner with the target title, and save via contentAppend', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });

      const appendId = '2026/05/life-index_2026-05-28_001';
      const mockUpdate = vi.fn().mockResolvedValue({ id: appendId });
      mockUseJournal.mockImplementation((id: string) => ({
        data: id === appendId
          ? {
              id,
              title: 'Existing Title',
              date: '2026-05-28',
              content: 'Existing content',
              abstract: null,
              topics: [],
              moods: [],
              people: [],
              location: null,
              weather: null,
              project: null,
              links: [],
              wordCount: 2,
            }
          : undefined,
        isLoading: false,
      }));
      mockUseUpdateJournal.mockReturnValue({
        mutateAsync: mockUpdate,
        isPending: false,
      });

      renderWithProviders(
        <TheCore />,
        [`/?append=${encodeURIComponent(appendId)}`],
      );

      // Banner shows the target title (CN4)
      await waitFor(() => {
        expect(screen.getByText(`继续写：Existing Title`)).toBeInTheDocument();
      });

      // Editor starts empty, NOT pre-filled with old content
      const textarea = screen.getByLabelText('Journal content');
      expect(textarea).toHaveValue('');
      expect(screen.queryByText('Existing content')).not.toBeInTheDocument();

      // Save disabled until content is entered
      const saveButton = screen.getByText('保存');
      expect(saveButton.closest('button')).toBeDisabled();

      // Type new content and save
      fireEvent.change(textarea, { target: { value: 'Appended content' } });
      expect(saveButton.closest('button')).not.toBeDisabled();
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith({
          id: appendId,
          data: expect.objectContaining({
            contentAppend: 'Appended content',
          }),
        });
      });

      // Must NOT send contentReplace
      const calls = mockUpdate.mock.calls;
      expect(calls.length).toBe(1);
      expect(calls[0][0].data).not.toHaveProperty('contentReplace');

      await waitFor(() => {
        expect(screen.getByTestId('current-pathname')).toHaveTextContent(
          `/journal/${appendId}`,
        );
      });
    });

    it('should keep the save button disabled in append mode when the editor is empty', () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });

      const appendId = '2026/05/life-index_2026-05-28_001';
      mockUseJournal.mockImplementation((id: string) => ({
        data: id === appendId
          ? {
              id,
              title: 'Existing Title',
              date: '2026-05-28',
              content: 'Existing content',
              abstract: null,
              topics: [],
              moods: [],
              people: [],
              location: null,
              weather: null,
              project: null,
              links: [],
              wordCount: 2,
            }
          : undefined,
        isLoading: false,
      }));
      mockUseUpdateJournal.mockReturnValue({
        mutateAsync: vi.fn(),
        isPending: false,
      });

      renderWithProviders(
        <TheCore />,
        [`/?append=${encodeURIComponent(appendId)}`],
      );

      const saveButton = screen.getByText('保存');
      expect(saveButton.closest('button')).toBeDisabled();
    });
  });

  describe('S5 - Mobile writing controls', () => {
    it('should show metadata toggle accessible on mobile', () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      renderWithProviders(<TheCore />);

      // Metadata toggle button must exist
      const metadataBtn = screen.getByText('元数据');
      expect(metadataBtn).toBeInTheDocument();
      expect(metadataBtn.closest('button')).toHaveAttribute('aria-expanded', 'false');
    });

    it('should show save button reachable without desktop-only controls', () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);
      useJournalDraftStore.getState().setContent('some content');

      renderWithProviders(<TheCore />);

      // Save button must be present and enabled when there is content
      const saveBtn = screen.getByText('保存');
      expect(saveBtn).toBeInTheDocument();
      expect(saveBtn.closest('button')).not.toBeDisabled();
    });

    it('should toggle metadata panel when clicking metadata button', () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);
      useJournalDraftStore.getState().updateMetadata({
        location: 'Stored City, Stored Country',
        weather: 'Stored weather, 1℃-2℃',
      });

      renderWithProviders(<TheCore />);

      // Initially collapsed: aria-expanded=false, button text = "元数据"
      const metadataBtn = screen.getByText('元数据').closest('button')!;
      expect(metadataBtn).toHaveAttribute('aria-expanded', 'false');

      // Click to expand
      fireEvent.click(metadataBtn);

      // Toggle state updated: aria-expanded=true, button text changes to "收起"
      expect(metadataBtn).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('收起')).toBeInTheDocument();

      // Note: AnimatePresence/motion.div does not complete animation in JSDOM,
      // so the MetadataSidebar content is not rendered in this test environment.
      // MetadataSidebar rendering is covered by its own 16 tests.
    });

    it('opens the metadata panel after focusing the editor', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      renderWithProviders(<TheCore />);

      fireEvent.focus(screen.getByLabelText('Journal content'));

      const metadataBtn = screen.getByText('元数据').closest('button')!;
      const actionBar = metadataBtn.closest('.ether-action-bar');
      expect(actionBar).toBeInTheDocument();

      await waitFor(() => {
        expect(useUIStore.getState().isEtherDissolve).toBe(true);
      });

      fireEvent.click(metadataBtn);

      await waitFor(() => {
        expect(metadataBtn).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('收起')).toBeInTheDocument();
        expect(actionBar?.className).not.toContain('pointer-events-none');
        expect(actionBar?.className).not.toContain('opacity-0');
      });
    });

    it('dissolves the action bar in zen mode when drawers are closed', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      renderWithProviders(<TheCore />);

      fireEvent.focus(screen.getByLabelText('Journal content'));

      const metadataBtn = screen.getByText('元数据').closest('button')!;
      const actionBar = metadataBtn.closest('.ether-action-bar');
      expect(actionBar).toBeInTheDocument();

      await waitFor(() => {
        expect(useUIStore.getState().isEtherDissolve).toBe(true);
        expect(actionBar?.className).toContain('grid-rows-[0fr]');
        expect(actionBar?.className).toContain('opacity-0');
        expect(actionBar?.className).toContain('pointer-events-none');
      });
    });

    it('wakes action bar chrome so drawers can open after writing has entered zen', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      renderWithProviders(<TheCore />);

      fireEvent.change(screen.getByLabelText('Journal content'), {
        target: { value: '写正文后进入 Zen，再打开元数据抽屉。' },
      });
      fireEvent.focus(screen.getByLabelText('Journal content'));

      const metadataBtn = screen.getByText('元数据').closest('button')!;
      const actionBar = metadataBtn.closest('.ether-action-bar');
      await waitFor(() => {
        expect(useUIStore.getState().isEtherDissolve).toBe(true);
        expect(actionBar?.className).toContain('grid-rows-[0fr]');
        expect(actionBar?.className).toContain('pointer-events-none');
      });

      fireEvent.pointerDown(screen.getByTestId('zen-drawer-wake-zone'));

      await waitFor(() => {
        expect(actionBar?.className).toContain('grid-rows-[1fr]');
        expect(actionBar?.className).toContain('opacity-100');
        expect(actionBar?.className).not.toContain('pointer-events-none');
      });

      fireEvent.click(metadataBtn);

      await waitFor(() => {
        expect(metadataBtn).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('metadata-agent-action-cluster')).toBeInTheDocument();
        expect(useUIStore.getState().isEtherDissolve).toBe(true);
      });

      fireEvent.click(metadataBtn);

      await waitFor(() => {
        expect(metadataBtn).toHaveAttribute('aria-expanded', 'false');
        expect(actionBar?.className).toContain('grid-rows-[0fr]');
        expect(actionBar?.className).toContain('opacity-0');
        expect(actionBar?.className).toContain('pointer-events-none');
      });
    });

    it('restores action bar chrome while a drawer is open and dissolves it after closing', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      renderWithProviders(<TheCore />);

      const metadataBtn = screen.getByText('元数据').closest('button')!;
      const actionBar = metadataBtn.closest('.ether-action-bar');
      expect(actionBar).toBeInTheDocument();

      fireEvent.click(metadataBtn);
      fireEvent.focus(screen.getByLabelText('Journal content'));

      await waitFor(() => {
        expect(useUIStore.getState().isEtherDissolve).toBe(true);
        expect(metadataBtn).toHaveAttribute('aria-expanded', 'true');
        expect(actionBar?.className).toContain('grid-rows-[1fr]');
        expect(actionBar?.className).toContain('opacity-100');
        expect(actionBar?.className).not.toContain('pointer-events-none');
      });

      fireEvent.click(metadataBtn);

      await waitFor(() => {
        expect(metadataBtn).toHaveAttribute('aria-expanded', 'false');
        expect(actionBar?.className).toContain('grid-rows-[0fr]');
        expect(actionBar?.className).toContain('opacity-0');
        expect(actionBar?.className).toContain('pointer-events-none');
      });
    });

    it('keeps zen mode while interacting with an open metadata drawer', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      renderWithProviders(<TheCore />);

      const metadataBtn = screen.getByText('元数据').closest('button')!;
      fireEvent.click(metadataBtn);
      fireEvent.focus(screen.getByLabelText('Journal content'));

      await waitFor(() => {
        expect(useUIStore.getState().isEtherDissolve).toBe(true);
        expect(metadataBtn).toHaveAttribute('aria-expanded', 'true');
      });

      fireEvent.mouseDown(screen.getByText('标题'));

      expect(useUIStore.getState().isEtherDissolve).toBe(true);
    });
  });

  // --- TA-3 Exit Gate: Create-time attachment upload ---

  describe('TA-3 - Attachment upload', () => {
    it('should pass selected files to the create mutation as attachments', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);

      const mockMutateAsync = vi.fn().mockResolvedValue({ id: 'journal-002' });
      mockUseCreateJournal.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      });

      useJournalDraftStore.getState().setContent('content with attachment');
      useJournalDraftStore.getState().updateMetadata({ title: 'Attachment Title' });

      renderWithProviders(<TheCore />);

      // Expand the attachments panel so the file input is mounted.
      fireEvent.click(screen.getByText('附件'));

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).toBeInTheDocument();

      const file = new File(['fake image bytes'], 'test.png', { type: 'image/png' });
      fireEvent.change(fileInput, { target: { files: [file] } });

      fireEvent.click(screen.getByText('保存'));

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Attachment Title',
            content: 'content with attachment',
            attachments: [file],
          }),
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId('current-pathname')).toHaveTextContent('/journal/journal-002');
      });
    });
  });

  // --- TA-4 Exit Gate: Save transition ceremony ---

  describe('TA-4 - Save transition ceremony', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    });

    it('shows CelestialLoader during the save ceremony when reduced motion is off, then navigates after SAVE_CEREMONY_MS', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);
      mockReducedMotion.value = false;

      const mockMutateAsync = vi.fn().mockResolvedValue({ id: 'journal-ceremony-001' });
      mockUseCreateJournal.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      });

      useJournalDraftStore.getState().setContent('ceremony content');
      useJournalDraftStore.getState().updateMetadata({ title: 'Ceremony Title' });

      renderWithProviders(<TheCore />);

      // Click save and let the async handler reach the pending timer.
      await act(async () => {
        fireEvent.click(screen.getByText('保存'));
      });

      // Transition placeholder should appear (full-page loader container)
      expect(document.querySelector('[class*="min-h-[60vh]"]')).toBeInTheDocument();
      expect(document.querySelector('[class*="rounded-full"]')).toBeInTheDocument();

      // Should still be on the write page while the ceremony runs
      expect(screen.getByTestId('current-pathname')).toHaveTextContent('/');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });

      expect(screen.getByTestId('current-pathname')).toHaveTextContent(
        '/journal/journal-ceremony-001',
      );
    });

    it('skips the ceremony and navigates immediately when reduced motion is on', async () => {
      mockUseDashboardStats.mockReturnValue({
        data: { totalJournals: 5 },
        isLoading: false,
      });
      useUIStore.getState().setHomeActivated(true);
      mockReducedMotion.value = true;

      const mockMutateAsync = vi.fn().mockResolvedValue({ id: 'journal-reduced-001' });
      mockUseCreateJournal.mockReturnValue({
        mutateAsync: mockMutateAsync,
        isPending: false,
      });

      useJournalDraftStore.getState().setContent('reduced content');
      useJournalDraftStore.getState().updateMetadata({ title: 'Reduced Title' });

      renderWithProviders(<TheCore />);

      await act(async () => {
        fireEvent.click(screen.getByText('保存'));
      });

      expect(screen.getByTestId('current-pathname')).toHaveTextContent(
        '/journal/journal-reduced-001',
      );

      // Reduced motion should skip the placeholder loader entirely
      expect(document.querySelector('[class*="min-h-[60vh]"]')).not.toBeInTheDocument();
    });
  });
});
