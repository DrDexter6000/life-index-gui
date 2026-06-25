import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import ImportWorkflow from './ImportWorkflow';

// Mock hooks — configured per test
const mockUseImportPlan = vi.fn();
const mockUseImportRun = vi.fn();
const mockUseImportStatus = vi.fn();
const mockUseImportRollback = vi.fn();
const mockInvalidateQueries = vi.fn();

vi.mock('@/hooks/useImports', () => ({
  useImportPlan: () => mockUseImportPlan(),
  useImportRun: () => mockUseImportRun(),
  useImportStatus: (importId: string | undefined) => mockUseImportStatus(importId),
  useImportRollback: () => mockUseImportRollback(),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
    }),
  };
});

function renderImportWorkflow() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ImportWorkflow />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Default mock return values ────────────────────────────────────────────

const defaultPlanHook = {
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  reset: vi.fn(),
};

const defaultRunHook = {
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  reset: vi.fn(),
};

const defaultStatusHook = {
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
};

const defaultRollbackHook = {
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  reset: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseImportPlan.mockReturnValue({ ...defaultPlanHook });
  mockUseImportRun.mockReturnValue({ ...defaultRunHook });
  mockUseImportStatus.mockReturnValue({ ...defaultStatusHook });
  mockUseImportRollback.mockReturnValue({ ...defaultRollbackHook });
});

// ── CLI-shaped envelope fixtures ──────────────────────────────────────────

const planEnvelope = {
  schema_version: 'import_job.v1',
  import_id: 'imp-001',
  dry_run: true,
  plan_fingerprint: 'fp-abc',
  idempotency_key: 'idem-abc',
  source: { adapter_id: 'fixture.import_records', record_count: 3 },
  summary: {
    proposed_journal_count: 2,
    proposed_attachment_count: 1,
    conflict_count: 0,
    warning_count: 1,
  },
  proposals: [
    {
      proposal_id: 'prop-1',
      source_record_id: 'rec-1',
      journal: { date_time: '2026-05-28T10:00:00', title: 'Imported Entry 1' },
      attachments: [],
      conflicts: [],
      warnings: [],
    },
    {
      proposal_id: 'prop-2',
      source_record_id: 'rec-2',
      journal: { date_time: '2026-05-29T11:00:00', title: 'Imported Entry 2', content: 'Some content' },
      attachments: [{ name: 'photo.jpg', media_type: 'image/jpeg', size_bytes: 1024 }],
      conflicts: [],
      warnings: [{ code: 'low_confidence', message: 'Low confidence match' }],
    },
  ],
  conflicts: [],
  warnings: [{ code: 'dedup_overlap', message: 'Possible duplicate detected' }],
  errors: [],
};

const photoPlanEnvelope = {
  ...planEnvelope,
  source: { adapter_id: 'media.photo_timeline', record_count: 1 },
  summary: {
    proposed_journal_count: 1,
    proposed_attachment_count: 1,
    conflict_count: 1,
    warning_count: 1,
  },
  proposals: [
    {
      proposal_id: 'prop-photo-1',
      source_record_id: 'photo_2b28bd92fb47',
      journal: {
        title: 'Photo import: 2020-01-01',
        date: '2020-01-01',
      },
      attachments: [
        {
          attachment_id: 'att_2b28bd92fb47',
          source_ref: 'source://media.photo_timeline/2b28bd92fb47',
          source_rel_path: 'photo_with_exif.jpg',
          target_rel_path: 'attachments/2020/01/import_2b28bd92fb47.jpg',
          media_type: 'image/jpeg',
          size_bytes: 1574,
          copy_mode: 'copy',
        },
      ],
      conflicts: [
        {
          code: 'PHOTO_CAPTURE_TIME_MISSING',
          severity: 'conflict',
          runnable: false,
          message: 'No EXIF capture time found',
        },
      ],
      warnings: [
        {
          code: 'PHOTO_GPS_MISSING',
          severity: 'warning',
          runnable: true,
          message: 'No GPS data found',
        },
      ],
    },
  ],
  conflicts: [
    {
      code: 'PHOTO_CAPTURE_TIME_MISSING',
      severity: 'conflict',
      runnable: false,
      message: 'No EXIF capture time found',
    },
  ],
  warnings: [
    {
      code: 'PHOTO_GPS_MISSING',
      severity: 'warning',
      runnable: true,
      message: 'No GPS data found',
    },
  ],
};

const statusEnvelope = {
  schema_version: 'import_job.v1',
  import_id: 'imp-001',
  state: 'committed',
  counts: { committed: 2, failed: 0, skipped: 1 },
  rollback_available: true,
};

const rollbackEnvelope = {
  schema_version: 'import_job.v1',
  import_id: 'imp-001',
  state: 'rolled_back',
  deleted_count: 2,
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ImportWorkflow', () => {
  it('renders the import workflow page', () => {
    renderImportWorkflow();
    // Page should have a bilingual header element
    expect(screen.getByTestId('import-workflow-page')).toBeInTheDocument();
  });

  it('enables fixture.import_records source and disables photo/video and social sources', () => {
    renderImportWorkflow();

    // fixture.import_records chip should be enabled
    const fixtureChip = screen.getByTestId('source-chip-fixture.import_records');
    expect(fixtureChip).toBeInTheDocument();
    expect(fixtureChip).not.toBeDisabled();

    // photo/video chip should be disabled
    const photoChip = screen.queryByTestId('source-chip-photo_video');
    if (photoChip) {
      expect(photoChip).toBeDisabled();
    }

    // social chip should be disabled
    const socialChip = screen.queryByTestId('source-chip-social');
    if (socialChip) {
      expect(socialChip).toBeDisabled();
    }
  });

  it('enables media.photo_timeline source and plans with that source when selected', () => {
    const mutate = vi.fn();
    mockUseImportPlan.mockReturnValue({ ...defaultPlanHook, mutate });

    renderImportWorkflow();

    const photoChip = screen.getByTestId('source-chip-media.photo_timeline');
    expect(photoChip).toBeInTheDocument();
    expect(photoChip).not.toBeDisabled();
    fireEvent.click(photoChip);

    const inputField = screen.getByTestId('import-input-path');
    fireEvent.change(inputField, { target: { value: 'D:/photos' } });
    fireEvent.click(screen.getByTestId('import-generate-plan'));

    expect(mutate).toHaveBeenCalledWith({
      source: 'media.photo_timeline',
      input_path: 'D:/photos',
    });
    const callArg = mutate.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('plan_path');
    expect(callArg).not.toHaveProperty('source_root');
  });

  it('calls useImportPlan mutate with { source, input_path } and no plan_path', () => {
    const mutate = vi.fn();
    mockUseImportPlan.mockReturnValue({ ...defaultPlanHook, mutate });

    renderImportWorkflow();

    // Type an input path
    const inputField = screen.getByTestId('import-input-path');
    fireEvent.change(inputField, { target: { value: '/data/fixture.json' } });

    // Click generate plan
    const planButton = screen.getByTestId('import-generate-plan');
    fireEvent.click(planButton);

    expect(mutate).toHaveBeenCalledWith({
      source: 'fixture.import_records',
      input_path: '/data/fixture.json',
    });

    // Verify plan_path was NOT included
    const callArg = mutate.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('plan_path');
  });

  it('renders plan preview with summary, proposals, and warnings from CLI envelope', async () => {
    mockUseImportPlan.mockReturnValue({
      ...defaultPlanHook,
      data: planEnvelope,
    });

    renderImportWorkflow();

    // Summary should render — check proposed entry count within the summary section
    const summary = screen.getByTestId('import-plan-summary');
    expect(summary).toBeInTheDocument();
    expect(summary.textContent).toContain('2'); // proposed_journal_count

    // Proposals should render
    expect(screen.getByTestId('import-proposal-prop-1')).toBeInTheDocument();
    expect(screen.getByTestId('import-proposal-prop-2')).toBeInTheDocument();

    // Warnings should render
    expect(screen.getByTestId('import-plan-warnings')).toBeInTheDocument();
  });

  it('renders photo timeline attachment paths and warning/conflict codes', () => {
    mockUseImportPlan.mockReturnValue({
      ...defaultPlanHook,
      data: photoPlanEnvelope,
    });

    renderImportWorkflow();

    expect(screen.getByText('Photo import: 2020-01-01')).toBeInTheDocument();
    expect(screen.getByText('photo_with_exif.jpg')).toBeInTheDocument();
    expect(screen.getByText('attachments/2020/01/import_2b28bd92fb47.jpg')).toBeInTheDocument();
    expect(screen.getAllByText('PHOTO_GPS_MISSING').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PHOTO_CAPTURE_TIME_MISSING').length).toBeGreaterThan(0);
  });

  it('disables confirm run when CLI envelope has blocking conflicts', () => {
    mockUseImportPlan.mockReturnValue({
      ...defaultPlanHook,
      data: photoPlanEnvelope,
    });

    renderImportWorkflow();

    expect(screen.getByTestId('import-confirm-run')).toBeDisabled();
  });

  it('calls useImportRun mutate with import_id only on confirm', () => {
    const runMutate = vi.fn();
    mockUseImportPlan.mockReturnValue({
      ...defaultPlanHook,
      data: planEnvelope,
    });
    mockUseImportRun.mockReturnValue({ ...defaultRunHook, mutate: runMutate });

    renderImportWorkflow();

    // Click confirm run
    const confirmButton = screen.getByTestId('import-confirm-run');
    fireEvent.click(confirmButton);

    expect(runMutate).toHaveBeenCalledWith('imp-001');
  });

  it('renders committed/failed/skipped counts from useImportStatus', async () => {
    mockUseImportStatus.mockReturnValue({
      ...defaultStatusHook,
      data: statusEnvelope,
    });

    renderImportWorkflow();

    await waitFor(() => {
      expect(screen.getByTestId('import-status-result')).toBeInTheDocument();
    });

    // Should display counts from the status envelope
    expect(screen.getByTestId('import-count-committed')).toHaveTextContent('2');
    expect(screen.getByTestId('import-count-failed')).toHaveTextContent('0');
    expect(screen.getByTestId('import-count-skipped')).toHaveTextContent('1');
  });

  it('calls useImportRollback mutate with import_id when rollback is available', () => {
    const rollbackMutate = vi.fn();
    mockUseImportStatus.mockReturnValue({
      ...defaultStatusHook,
      data: statusEnvelope, // rollback_available: true
    });
    mockUseImportRollback.mockReturnValue({
      ...defaultRollbackHook,
      mutate: rollbackMutate,
    });

    renderImportWorkflow();

    // Rollback button should be visible when rollback_available
    const rollbackButton = screen.getByTestId('import-rollback-btn');
    expect(rollbackButton).toBeInTheDocument();

    fireEvent.click(rollbackButton);
    expect(rollbackMutate).toHaveBeenCalledWith('imp-001');
  });

  it('does not show rollback action when rollback is not available', () => {
    mockUseImportStatus.mockReturnValue({
      ...defaultStatusHook,
      data: {
        ...statusEnvelope,
        rollback_available: false,
      },
    });

    renderImportWorkflow();

    expect(screen.queryByTestId('import-rollback-btn')).not.toBeInTheDocument();
  });

  it('renders stale-plan error for VALIDATION_ERROR with replan_required', async () => {
    const planError = {
      code: 'VALIDATION_ERROR',
      message: 'Plan is stale',
      details: { reason: 'replan_required' },
    };
    mockUseImportPlan.mockReturnValue({
      ...defaultPlanHook,
      isError: true,
      error: planError,
    });

    renderImportWorkflow();

    await waitFor(() => {
      expect(screen.getByTestId('import-error-card')).toBeInTheDocument();
    });
    expect(screen.getByTestId('import-error-code')).toHaveTextContent('VALIDATION_ERROR');
    expect(screen.getByTestId('import-error-replan')).toBeInTheDocument();
  });

  it('renders structured error for IMPORT_IDEMPOTENCY_CONFLICT', async () => {
    const conflictError = {
      code: 'IMPORT_IDEMPOTENCY_CONFLICT',
      message: 'Idempotency conflict',
    };
    mockUseImportPlan.mockReturnValue({
      ...defaultPlanHook,
      isError: true,
      error: conflictError,
    });

    renderImportWorkflow();

    await waitFor(() => {
      expect(screen.getByTestId('import-error-card')).toBeInTheDocument();
    });
    expect(screen.getByTestId('import-error-code')).toHaveTextContent('IMPORT_IDEMPOTENCY_CONFLICT');
  });

  it('renders run idempotency conflict as a replan-required structured error', async () => {
    const conflictError = {
      code: 'IMPORT_IDEMPOTENCY_CONFLICT',
      message: 'Idempotency conflict',
    };
    mockUseImportPlan.mockReturnValue({
      ...defaultPlanHook,
      data: planEnvelope,
    });
    mockUseImportRun.mockReturnValue({
      ...defaultRunHook,
      isError: true,
      error: conflictError,
    });

    renderImportWorkflow();

    await waitFor(() => {
      expect(screen.getByTestId('import-run-error-card')).toBeInTheDocument();
    });
    expect(screen.getByTestId('import-run-error-code')).toHaveTextContent('IMPORT_IDEMPOTENCY_CONFLICT');
    expect(screen.getByTestId('import-run-error-replan')).toBeInTheDocument();
  });

  it('renders status last_error from the CLI envelope', async () => {
    mockUseImportStatus.mockReturnValue({
      ...defaultStatusHook,
      data: {
        ...statusEnvelope,
        last_error: {
          code: 'IMPORT_RUN_FAILED',
          user_message: 'One record could not be imported',
        },
      },
    });

    renderImportWorkflow();

    await waitFor(() => {
      expect(screen.getByTestId('import-status-last-error-card')).toBeInTheDocument();
    });
    expect(screen.getByTestId('import-status-last-error-code')).toHaveTextContent('IMPORT_RUN_FAILED');
    expect(screen.getByText('One record could not be imported')).toBeInTheDocument();
  });

  it('renders rollback result from the CLI envelope', () => {
    mockUseImportRollback.mockReturnValue({
      ...defaultRollbackHook,
      data: rollbackEnvelope,
    });

    renderImportWorkflow();

    expect(screen.getByTestId('import-rollback-result')).toBeInTheDocument();
    expect(screen.getByTestId('import-rollback-deleted-count')).toHaveTextContent('2');
  });

  it('renders rollback structured error from the hook error', async () => {
    mockUseImportRollback.mockReturnValue({
      ...defaultRollbackHook,
      isError: true,
      error: {
        code: 'IMPORT_ROLLBACK_FAILED',
        message: 'Rollback could not complete',
      },
    });

    renderImportWorkflow();

    await waitFor(() => {
      expect(screen.getByTestId('import-rollback-error-card')).toBeInTheDocument();
    });
    expect(screen.getByTestId('import-rollback-error-code')).toHaveTextContent('IMPORT_ROLLBACK_FAILED');
    expect(screen.getByText('Rollback could not complete')).toBeInTheDocument();
  });

  it('toggles import help panel expand and collapse', () => {
    renderImportWorkflow();

    const toggle = screen.getByTestId('import-help-toggle');
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('import-help-content')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('import-help-content')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('import-help-content')).not.toBeInTheDocument();
  });

  // ── Static boundary test ──────────────────────────────────────────────

  it('production code must not contain forbidden patterns', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const componentPath = path.resolve(__dirname, 'ImportWorkflow.tsx');

    // If the file doesn't exist yet (RED phase), skip
    if (!fs.existsSync(componentPath)) {
      return;
    }

    const content = fs.readFileSync(componentPath, 'utf-8');

    const forbidden = [
      'plan_path',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'EXIF',
      'Journals',
      'attachments/',
      '.life-index/import-jobs',
    ];

    for (const term of forbidden) {
      expect(
        content,
        `ImportWorkflow.tsx must not contain forbidden pattern "${term}"`,
      ).not.toContain(term);
    }
  });
});
