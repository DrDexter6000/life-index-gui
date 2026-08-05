import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { APIClientError } from '@/lib/api-client';
import ImportWorkflow from './ImportWorkflow';

type QueryResult = {
  data?: Record<string, unknown>;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
};

type MutationResult = {
  mutateAsync: ReturnType<typeof vi.fn>;
  isPending: boolean;
};

const mocks = vi.hoisted(() => {
  const mutation = (): MutationResult => ({
    mutateAsync: vi.fn(),
    isPending: false,
  });
  return {
    reviewsListHook: vi.fn(),
    reviewQueueHook: vi.fn(),
    reviewStatusHook: vi.fn(),
    listResult: {
      data: { schema_version: 'import_reviews.v1', jobs: [], has_more: false },
      isLoading: false,
      isError: false,
      error: null,
    } as QueryResult,
    queueResult: {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
    } as QueryResult,
    statusResult: {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
    } as QueryResult,
    versionCheckResult: {
      data: { compatible: true, cli_package_version: '1.6.2' },
      isLoading: false,
      isError: false,
      error: null,
    } as QueryResult,
    validate: mutation(),
    stage: mutation(),
    rebind: mutation(),
    confirm: mutation(),
    batch: mutation(),
    rollback: mutation(),
    translate: vi.fn(),
    editorProps: vi.fn(),
    sidebarProps: vi.fn(),
    gridProps: vi.fn(),
  };
});

vi.mock('@/hooks/useImports', () => ({
  useReviewsList: (params: unknown) => {
    mocks.reviewsListHook(params);
    return mocks.listResult;
  },
  useReviewQueue: (parentId: unknown, params: unknown) => {
    mocks.reviewQueueHook(parentId, params);
    return mocks.queueResult;
  },
  useReviewStatus: (parentId: unknown) => {
    mocks.reviewStatusHook(parentId);
    return mocks.statusResult;
  },
  useValidateSource: () => mocks.validate,
  useStageReview: () => mocks.stage,
  useRebindReview: () => mocks.rebind,
  useConfirmEdit: () => mocks.confirm,
  useBatchRun: () => mocks.batch,
  useChildRollback: () => mocks.rollback,
}));

vi.mock('@/hooks/useJournals', () => ({
  useVersionCheck: () => mocks.versionCheckResult,
}));

vi.mock('@/components/editor/SimpleEditor', () => ({
  SimpleEditor: (props: { content: string; onChange: (content: string) => void }) => {
    mocks.editorProps(props);
    return (
      <textarea
        data-testid="mock-simple-editor"
        value={props.content}
        onChange={(event) => props.onChange(event.target.value)}
      />
    );
  },
}));

vi.mock('@/components/editor/MetadataSidebar', () => ({
  MetadataSidebar: (props: {
    metadata: Record<string, unknown>;
    fieldScope?: string;
    topicMode?: string;
    smartCapabilityAvailable?: boolean;
    onUpdate: (patch: Record<string, unknown>) => void;
  }) => {
    mocks.sidebarProps(props);
    return (
      <button
        type="button"
        data-testid="mock-metadata-edit"
        onClick={() => props.onUpdate({
          title: 'Edited title',
          date: '1999-12-31',
          topics: ['work'],
          tags: ['edited'],
        })}
      >
        edit metadata
      </button>
    );
  },
}));

vi.mock('@/components/import/PhotoAttachmentGrid', () => ({
  PhotoAttachmentGrid: (props: {
    parentId: string;
    proposalId: string;
    attachments: Array<{ attachment_id: string }>;
    selectedAttachmentIds: readonly string[];
    onToggle: (attachmentId: string, selected: boolean) => void;
  }) => {
    mocks.gridProps(props);
    return (
      <div data-testid="mock-photo-grid">
        {props.attachments.map((attachment) => {
          const selected = props.selectedAttachmentIds.includes(attachment.attachment_id);
          return (
            <button
              type="button"
              key={attachment.attachment_id}
              data-testid={`toggle-${attachment.attachment_id}`}
              onClick={() => props.onToggle(attachment.attachment_id, !selected)}
            >
              {selected ? 'selected' : 'excluded'}
            </button>
          );
        })}
      </div>
    );
  },
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    lang: 'en',
    t: (key: string, options?: Record<string, string | number>) => {
      mocks.translate(key, options);
      const copy: Record<string, string> = {
        importSourcePathLabel: 'Enter or paste a local photo directory',
        importStartReview: 'Start review',
        importRebind: 'Rebind source',
        importBindingRequired: 'Rebind required',
        importConfirmNext: 'Confirm and next',
        importSkipCurrent: 'Skip this one',
        importReturnPending: 'Return to pending',
        importBatchConfirmed: 'Import {{count}} confirmed entries',
        importRollback: 'Rollback',
      };
      return (copy[key] ?? key).replace(
        /\{\{(\w+)\}\}/g,
        (_, name: string) => String(options?.[name] ?? `{{${name}}}`),
      );
    },
  }),
}));

const attachment = (attachmentId: string, selected: boolean) => ({
  attachment_id: attachmentId,
  source_ref: `safe-${attachmentId}.jpg`,
  media_type: 'image/jpeg',
  size: 123,
  selected,
});

const proposal = (overrides: Record<string, unknown> = {}) => ({
  proposal_id: 'proposal-1',
  state: 'pending',
  journal: {
    title: 'Original title',
    date: '1988-06-12',
    topic: 'life',
    tags: ['old'],
    content: 'Original body',
  },
  date_resolution: { status: 'user_confirmed', date: '1988-06-12' },
  available_attachments: [
    attachment('attachment-1', true),
    attachment('attachment-2', true),
  ],
  ...overrides,
});

const queue = (overrides: Record<string, unknown> = {}) => ({
  schema_version: 'import_review.v1',
  import_id: 'parent-1',
  state: 'pending',
  queue_revision: 5,
  queue_counts: {
    pending: 2,
    confirmed: 7,
    skipped: 0,
    stale: 0,
    batching: 0,
    imported: 0,
  },
  total_all: 2,
  total_filtered: 2,
  offset: 0,
  limit: 1,
  has_more: true,
  next_offset: 1,
  proposals: [proposal()],
  ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function setPersistedJob(jobOverrides: Record<string, unknown> = {}) {
  mocks.listResult.data = {
    schema_version: 'import_reviews.v1',
    jobs: [{
      import_id: 'parent-1',
      state: 'pending',
      queue_revision: 5,
      queue_counts: { confirmed: 7 },
      ...jobOverrides,
    }],
    has_more: false,
  };
  mocks.queueResult.data = queue();
  mocks.statusResult.data = {
    schema_version: 'import_review.v1',
    import_id: 'parent-1',
    queue_counts: { confirmed: 7 },
  };
}

async function startNewReview(path = 'D:\\Photos\\Archive') {
  fireEvent.change(screen.getByTestId('import-source-path'), {
    target: { value: path },
  });
  fireEvent.click(screen.getByTestId('import-start-review'));
  await waitFor(() => expect(mocks.stage.mutateAsync).toHaveBeenCalled());
}

describe('ImportWorkflow historical-photo workbench', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listResult.data = {
      schema_version: 'import_reviews.v1',
      jobs: [],
      has_more: false,
    };
    mocks.listResult.isLoading = false;
    mocks.listResult.isError = false;
    mocks.queueResult.data = undefined;
    mocks.queueResult.isLoading = false;
    mocks.queueResult.isError = false;
    mocks.statusResult.data = undefined;
    mocks.statusResult.isLoading = false;
    mocks.statusResult.isError = false;
    mocks.versionCheckResult.data = { compatible: true, cli_package_version: '1.6.2' };
    mocks.versionCheckResult.isLoading = false;
    mocks.versionCheckResult.isError = false;
    mocks.versionCheckResult.error = null;
    for (const mutation of [
      mocks.validate,
      mocks.stage,
      mocks.rebind,
      mocks.confirm,
      mocks.batch,
      mocks.rollback,
    ]) {
      mutation.mutateAsync.mockReset();
      mutation.isPending = false;
    }
    mocks.validate.mutateAsync.mockResolvedValue({
      schema_version: 'import_review.v1',
      readable: true,
    });
    mocks.stage.mutateAsync.mockResolvedValue({
      schema_version: 'import_review.v1',
      parent_id: 'parent-1',
    });
    mocks.rebind.mutateAsync.mockResolvedValue({
      schema_version: 'import_review.v1',
      import_id: 'parent-1',
      rebound: true,
    });
    mocks.confirm.mutateAsync.mockResolvedValue({
      schema_version: 'import_review.v1',
      parent_id: 'parent-1',
      queue_revision: 6,
    });
    mocks.batch.mutateAsync.mockResolvedValue({ import_id: 'parent-1#batch-1' });
    mocks.rollback.mutateAsync.mockResolvedValue({ import_id: 'parent-1#batch-1' });
  });

  it('uses a memory-only local path and validates readability before staging', async () => {
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');
    mocks.queueResult.data = queue();
    render(<ImportWorkflow />);

    const input = screen.getByTestId('import-source-path');
    expect(input).toHaveAttribute('type', 'text');
    expect(document.querySelector('input[type="file"]')).toBeNull();

    await startNewReview();

    expect(mocks.validate.mutateAsync).toHaveBeenCalledWith({
      source_root: 'D:\\Photos\\Archive',
    });
    expect(mocks.stage.mutateAsync).toHaveBeenCalledWith({
      source_root: 'D:\\Photos\\Archive',
    });
    expect(mocks.validate.mutateAsync.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.stage.mutateAsync.mock.invocationCallOrder[0]);
    expect(storageSpy).not.toHaveBeenCalled();
    expect(mocks.reviewsListHook).toHaveBeenCalledWith({ limit: 20 });
    await waitFor(() => expect(mocks.reviewQueueHook).toHaveBeenLastCalledWith(
      'parent-1',
      { offset: 0, limit: 1, states: ['pending'] },
    ));
    storageSpy.mockRestore();
  });

  it('fails closed when source validation does not return readable true', async () => {
    mocks.validate.mutateAsync.mockResolvedValue({
      schema_version: 'import_review.v1',
      readable: false,
    });
    render(<ImportWorkflow />);

    fireEvent.change(screen.getByTestId('import-source-path'), {
      target: { value: 'D:\\Unreadable Photos' },
    });
    fireEvent.click(screen.getByTestId('import-start-review'));

    expect(await screen.findByTestId('import-notice')).toHaveTextContent(
      'importSourceUnreadable',
    );
    expect(mocks.stage.mutateAsync).not.toHaveBeenCalled();
  });

  it('resumes an already-staged parent and rebinds the current source without staging twice', async () => {
    mocks.queueResult.data = queue({ import_id: 'existing-parent' });
    mocks.stage.mutateAsync.mockRejectedValue(new APIClientError(
      'unsafe server message',
      'IMPORT_REVIEW_ALREADY_STAGED',
      409,
      { existing_import_id: 'existing-parent' },
    ));
    render(<ImportWorkflow />);

    await startNewReview('E:\\Family Photos');

    await waitFor(() => expect(mocks.rebind.mutateAsync).toHaveBeenCalledWith({
      parentId: 'existing-parent',
      sourceRoot: 'E:\\Family Photos',
    }));
    expect(mocks.stage.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mocks.reviewQueueHook).toHaveBeenLastCalledWith(
      'existing-parent',
      { offset: 0, limit: 1, states: ['pending'] },
    );
  });

  it('keeps an already-staged parent unbound when its required rebind fails', async () => {
    mocks.queueResult.data = queue({ import_id: 'existing-parent' });
    mocks.stage.mutateAsync.mockRejectedValue(new APIClientError(
      'unsafe server message',
      'IMPORT_REVIEW_ALREADY_STAGED',
      409,
      { existing_import_id: 'existing-parent' },
    ));
    mocks.rebind.mutateAsync.mockRejectedValue(new Error('rebind failed'));
    render(<ImportWorkflow />);

    await startNewReview('E:\\Disconnected Photos');

    expect(await screen.findByTestId('import-binding-required')).toBeInTheDocument();
    expect(screen.getByTestId('import-notice')).toHaveTextContent('importRebindGuidance');
    expect(screen.getByTestId('import-notice')).not.toHaveTextContent(
      'importAlreadyStagedResumed',
    );
  });

  it('restores a persisted queue without a source binding and requires explicit rebind', async () => {
    setPersistedJob();
    render(<ImportWorkflow />);

    fireEvent.click(screen.getByTestId('review-job-parent-1'));

    expect(screen.getByTestId('import-binding-required')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-photo-grid')).not.toBeInTheDocument();
    expect(screen.getByTestId('import-batch-run')).toBeDisabled();

    fireEvent.change(screen.getByTestId('import-source-path'), {
      target: { value: 'C:\\Restored Photos' },
    });
    fireEvent.click(screen.getByTestId('import-rebind'));

    await waitFor(() => expect(mocks.rebind.mutateAsync).toHaveBeenCalledWith({
      parentId: 'parent-1',
      sourceRoot: 'C:\\Restored Photos',
    }));
    expect(await screen.findByTestId('mock-photo-grid')).toBeInTheDocument();
  });

  it('rehydrates a same-id proposal from the authoritative queue after rebind succeeds', async () => {
    setPersistedJob();
    let resolveRebind!: (value: unknown) => void;
    mocks.rebind.mutateAsync.mockReturnValue(new Promise((resolve) => {
      resolveRebind = resolve;
    }));
    const { rerender } = render(<ImportWorkflow />);
    fireEvent.click(screen.getByTestId('review-job-parent-1'));
    fireEvent.change(await screen.findByTestId('mock-simple-editor'), {
      target: { value: 'Unsaved stale draft' },
    });
    fireEvent.click(screen.getByTestId('mock-metadata-edit'));

    fireEvent.change(screen.getByTestId('import-source-path'), {
      target: { value: 'C:\\Rebound Photos' },
    });
    fireEvent.click(screen.getByTestId('import-rebind'));
    await waitFor(() => expect(mocks.rebind.mutateAsync).toHaveBeenCalled());

    mocks.queueResult.data = queue({
      queue_revision: 6,
      proposals: [proposal({
        journal: {
          title: 'Authoritative title',
          date: '2001-02-03',
          topic: 'family',
          tags: ['rehydrated'],
          content: 'Authoritative rebound body',
        },
        available_attachments: [
          attachment('attachment-1', false),
          attachment('attachment-2', true),
        ],
      })],
    });
    rerender(<ImportWorkflow />);
    expect(screen.getByTestId('mock-simple-editor')).toHaveValue('Unsaved stale draft');

    resolveRebind({
      schema_version: 'import_review.v1',
      import_id: 'parent-1',
      rebound: true,
    });

    await waitFor(() => expect(screen.getByTestId('mock-simple-editor'))
      .toHaveValue('Authoritative rebound body'));
    expect(mocks.sidebarProps).toHaveBeenLastCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        title: 'Authoritative title',
        date: '2001-02-03',
        topics: ['family'],
        tags: ['rehydrated'],
      }),
    }));
    expect(mocks.gridProps).toHaveBeenLastCalledWith(expect.objectContaining({
      selectedAttachmentIds: ['attachment-2'],
    }));
  });

  it('ignores a rebind completion after the user activates another parent', async () => {
    setPersistedJob();
    mocks.listResult.data = {
      schema_version: 'import_reviews.v1',
      jobs: [
        { import_id: 'parent-1', state: 'pending', queue_revision: 5 },
        { import_id: 'parent-2', state: 'pending', queue_revision: 9 },
      ],
      has_more: false,
    };
    const rebind = deferred<unknown>();
    mocks.rebind.mutateAsync.mockReturnValue(rebind.promise);
    const { rerender } = render(<ImportWorkflow />);
    fireEvent.click(screen.getByTestId('review-job-parent-1'));
    fireEvent.change(screen.getByTestId('import-source-path'), {
      target: { value: 'C:\\Parent One Photos' },
    });
    fireEvent.click(screen.getByTestId('import-rebind'));
    await waitFor(() => expect(mocks.rebind.mutateAsync).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('review-job-parent-2'));
    mocks.queueResult.data = queue({
      import_id: 'parent-2',
      queue_revision: 9,
      proposals: [proposal({
        proposal_id: 'proposal-2',
        journal: {
          title: 'Parent two title',
          date: '2002-02-02',
          topic: 'family',
          tags: ['parent-two'],
          content: 'Parent two body',
        },
      })],
    });
    rerender(<ImportWorkflow />);
    expect(await screen.findByTestId('mock-simple-editor')).toHaveValue('Parent two body');

    await act(async () => {
      rebind.resolve({
        schema_version: 'import_review.v1',
        import_id: 'parent-1',
        rebound: true,
      });
      await rebind.promise;
    });

    expect(screen.getByTestId('import-binding-required')).toBeInTheDocument();
    expect(screen.getByTestId('mock-simple-editor')).toHaveValue('Parent two body');
    expect(screen.queryByTestId('import-notice')).not.toBeInTheDocument();
  });

  it('suppresses every deferred rebind completion after a real unmount', async () => {
    setPersistedJob();
    const rebind = deferred<unknown>();
    mocks.rebind.mutateAsync.mockReturnValue(rebind.promise);
    const { unmount } = render(<ImportWorkflow />);
    fireEvent.click(screen.getByTestId('review-job-parent-1'));
    fireEvent.change(screen.getByTestId('import-source-path'), {
      target: { value: 'C:\\Unmounted Photos' },
    });
    fireEvent.click(screen.getByTestId('import-rebind'));
    await waitFor(() => expect(mocks.rebind.mutateAsync).toHaveBeenCalled());

    unmount();
    mocks.translate.mockClear();
    await act(async () => {
      rebind.resolve({
        schema_version: 'import_review.v1',
        import_id: 'parent-1',
        rebound: true,
      });
      await rebind.promise;
    });

    expect(mocks.translate).not.toHaveBeenCalled();
  });

  it('keeps coordinator operations live after StrictMode effect replay', async () => {
    mocks.queueResult.data = queue();
    render(
      <StrictMode>
        <ImportWorkflow />
      </StrictMode>,
    );

    await startNewReview();
    fireEvent.click(await screen.findByTestId('import-confirm-next'));

    await waitFor(() => expect(mocks.confirm.mutateAsync).toHaveBeenCalled());
    expect(await screen.findByTestId('import-notice'))
      .toHaveTextContent('importDecisionQueued');
  });

  it('uses exactly six filters, defaults to pending, and pages by server offsets at limit one', async () => {
    setPersistedJob();
    render(<ImportWorkflow />);
    fireEvent.click(screen.getByTestId('review-job-parent-1'));

    for (const state of ['pending', 'confirmed', 'skipped', 'stale', 'batching', 'imported']) {
      expect(screen.getByTestId(`import-filter-${state}`)).toBeInTheDocument();
    }
    expect(mocks.reviewQueueHook).toHaveBeenLastCalledWith(
      'parent-1',
      { offset: 0, limit: 1, states: ['pending'] },
    );

    fireEvent.click(screen.getByTestId('import-candidate-next'));
    expect(mocks.reviewQueueHook).toHaveBeenLastCalledWith(
      'parent-1',
      { offset: 1, limit: 1, states: ['pending'] },
    );

    fireEvent.click(screen.getByTestId('import-filter-confirmed'));
    expect(mocks.reviewQueueHook).toHaveBeenLastCalledWith(
      'parent-1',
      { offset: 0, limit: 1, states: ['confirmed'] },
    );
  });

  it('navigates every persisted review with bounded server cursors and retains a later active job', async () => {
    const firstPageJobs = Array.from({ length: 20 }, (_, index) => ({
      import_id: index === 19 ? 'server-tail-id' : `parent-${index + 1}`,
      state: 'pending',
      queue_revision: index + 1,
      queue_counts: { confirmed: 0 },
    }));
    mocks.listResult.data = {
      schema_version: 'import_reviews.v1',
      jobs: firstPageJobs,
      has_more: true,
    };
    const { rerender } = render(<ImportWorkflow />);

    expect(mocks.reviewsListHook).toHaveBeenLastCalledWith({ limit: 20 });
    expect(screen.getByTestId('import-reviews-previous')).toBeDisabled();
    expect(screen.getByTestId('import-reviews-next')).toBeEnabled();
    fireEvent.click(screen.getByTestId('import-reviews-next'));

    expect(mocks.reviewsListHook).toHaveBeenLastCalledWith({
      limit: 20,
      after: 'server-tail-id',
    });
    mocks.listResult.data = {
      schema_version: 'import_reviews.v1',
      jobs: [{
        import_id: 'parent-25',
        state: 'pending',
        queue_revision: 25,
        queue_counts: { confirmed: 1 },
      }],
      has_more: false,
    };
    mocks.queueResult.data = queue({ import_id: 'parent-25' });
    rerender(<ImportWorkflow />);

    expect(screen.getByTestId('import-reviews-previous')).toBeEnabled();
    expect(screen.getByTestId('import-reviews-next')).toBeDisabled();
    fireEvent.click(screen.getByTestId('review-job-parent-25'));
    expect(mocks.reviewQueueHook).toHaveBeenLastCalledWith(
      'parent-25',
      { offset: 0, limit: 1, states: ['pending'] },
    );

    fireEvent.click(screen.getByTestId('import-reviews-previous'));
    mocks.listResult.data = {
      schema_version: 'import_reviews.v1',
      jobs: firstPageJobs,
      has_more: true,
    };
    rerender(<ImportWorkflow />);

    expect(mocks.reviewsListHook).toHaveBeenLastCalledWith({ limit: 20 });
    expect(mocks.reviewQueueHook).toHaveBeenLastCalledWith(
      'parent-25',
      { offset: 0, limit: 1, states: ['pending'] },
    );
    expect(screen.getByTestId('import-binding-required')).toBeInTheDocument();
  });

  it('disables candidate mutations when the authoritative queue revision is missing', async () => {
    mocks.queueResult.data = queue({ queue_revision: undefined });
    render(<ImportWorkflow />);
    await startNewReview();

    expect(await screen.findByTestId('import-missing-revision')).toBeInTheDocument();
    expect(screen.getByTestId('import-confirm-next')).toBeDisabled();
    expect(screen.getByTestId('import-skip-current')).toBeDisabled();
  });

  it('requires a valid manual calendar date to confirm an unresolved proposal while keeping skip available', async () => {
    mocks.queueResult.data = queue({
      proposals: [proposal({
        journal: {
          title: 'Needs a date',
          date: '2023-02-29',
          topic: 'life',
          tags: [],
          content: 'Undated memory',
        },
        date_resolution: { status: 'unresolved' },
      })],
    });
    render(<ImportWorkflow />);
    await startNewReview();

    expect(await screen.findByTestId('import-confirm-next')).toBeDisabled();
    expect(screen.getByTestId('import-skip-current')).toBeEnabled();
    expect(screen.getByTestId('import-unresolved-date')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-metadata-edit'));

    expect(screen.getByTestId('import-confirm-next')).toBeEnabled();
    fireEvent.click(screen.getByTestId('import-confirm-next'));
    await waitFor(() => expect(mocks.confirm.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'confirmed',
        journal: expect.objectContaining({ date: '1999-12-31' }),
      }),
    ));
  });

  it('uses successful confirm reason codes instead of generic queued success copy', async () => {
    mocks.queueResult.data = queue();
    mocks.confirm.mutateAsync
      .mockResolvedValueOnce({
        schema_version: 'import_review.v1',
        queue_revision: 5,
        reason_code: 'IMPORT_REVIEW_DATE_REQUIRED',
      })
      .mockResolvedValueOnce({
        schema_version: 'import_review.v1',
        queue_revision: 5,
        reason_code: 'IMPORT_REVIEW_EMPTY_SELECTION_SKIPPED',
      });
    render(<ImportWorkflow />);
    await startNewReview();

    fireEvent.click(await screen.findByTestId('import-confirm-next'));
    await waitFor(() => expect(screen.getByTestId('import-notice'))
      .toHaveTextContent('importDateRequired'));
    expect(screen.getByTestId('import-notice')).not.toHaveTextContent(
      'importDecisionQueued',
    );

    fireEvent.click(screen.getByTestId('import-confirm-next'));
    await waitFor(() => expect(screen.getByTestId('import-notice'))
      .toHaveTextContent('importNoPhotosSkipped'));
    expect(screen.getByTestId('import-notice')).not.toHaveTextContent(
      'importDecisionQueued',
    );
  });

  it('suppresses every deferred confirm completion after a real unmount', async () => {
    mocks.queueResult.data = queue();
    const confirm = deferred<unknown>();
    mocks.confirm.mutateAsync.mockReturnValue(confirm.promise);
    const { unmount } = render(<ImportWorkflow />);
    await startNewReview();
    fireEvent.click(await screen.findByTestId('import-confirm-next'));
    await waitFor(() => expect(mocks.confirm.mutateAsync).toHaveBeenCalled());

    unmount();
    mocks.translate.mockClear();
    await act(async () => {
      confirm.resolve({
        schema_version: 'import_review.v1',
        parent_id: 'parent-1',
        queue_revision: 6,
      });
      await confirm.promise;
    });

    expect(mocks.translate).not.toHaveBeenCalled();
  });

  it('keeps a deferred confirm current when the active filter is clicked again', async () => {
    mocks.queueResult.data = queue();
    const confirm = deferred<unknown>();
    mocks.confirm.mutateAsync.mockReturnValue(confirm.promise);
    render(<ImportWorkflow />);
    await startNewReview();
    fireEvent.click(await screen.findByTestId('import-confirm-next'));
    await waitFor(() => expect(mocks.confirm.mutateAsync).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('import-filter-pending'));
    await act(async () => {
      confirm.resolve({
        schema_version: 'import_review.v1',
        parent_id: 'parent-1',
        queue_revision: 6,
      });
      await confirm.promise;
    });

    expect(await screen.findByTestId('import-notice'))
      .toHaveTextContent('importDecisionQueued');
  });

  it.each([
    ['filter', 'import-filter-confirmed'],
    ['page', 'import-candidate-next'],
  ])('invalidates a deferred confirm after an actual %s change', async (_, testId) => {
    mocks.queueResult.data = queue();
    const confirm = deferred<unknown>();
    mocks.confirm.mutateAsync.mockReturnValue(confirm.promise);
    render(<ImportWorkflow />);
    await startNewReview();
    fireEvent.click(await screen.findByTestId('import-confirm-next'));
    await waitFor(() => expect(mocks.confirm.mutateAsync).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId(testId));
    await act(async () => {
      confirm.resolve({
        schema_version: 'import_review.v1',
        parent_id: 'parent-1',
        queue_revision: 6,
      });
      await confirm.promise;
    });

    expect(screen.queryByTestId('import-notice')).not.toBeInTheDocument();
  });

  it('initializes the disposable form exactly and confirms only editable journal fields plus selection', async () => {
    mocks.queueResult.data = queue();
    render(<ImportWorkflow />);
    await startNewReview();

    expect(await screen.findByTestId('mock-simple-editor')).toHaveValue('Original body');
    expect(mocks.sidebarProps).toHaveBeenLastCalledWith(expect.objectContaining({
      fieldScope: 'import-review',
      topicMode: 'single',
      smartCapabilityAvailable: false,
      metadata: expect.objectContaining({
        title: 'Original title',
        date: '1988-06-12',
        topics: ['life'],
        tags: ['old'],
      }),
    }));

    fireEvent.change(await screen.findByTestId('mock-simple-editor'), {
      target: { value: 'User edited body' },
    });
    fireEvent.click(screen.getByTestId('mock-metadata-edit'));
    fireEvent.click(screen.getByTestId('toggle-attachment-2'));
    fireEvent.click(screen.getByTestId('import-confirm-next'));

    await waitFor(() => expect(mocks.confirm.mutateAsync).toHaveBeenCalledWith({
      parentId: 'parent-1',
      expectedQueueRevision: 5,
      proposalId: 'proposal-1',
      decision: 'confirmed',
      journal: {
        title: 'Edited title',
        date: '1999-12-31',
        topic: 'work',
        tags: ['edited'],
        content: 'User edited body',
      },
      selectedAttachmentIds: ['attachment-1'],
      queuePage: { offset: 0, limit: 1, states: ['pending'] },
    }));
  });

  it('skips without an empty journal when all photos are deselected and supports explicit skip', async () => {
    mocks.queueResult.data = queue();
    render(<ImportWorkflow />);
    await startNewReview();

    fireEvent.click(await screen.findByTestId('toggle-attachment-1'));
    fireEvent.click(screen.getByTestId('toggle-attachment-2'));
    fireEvent.click(screen.getByTestId('import-confirm-next'));
    await waitFor(() => expect(mocks.confirm.mutateAsync).toHaveBeenLastCalledWith({
      parentId: 'parent-1',
      expectedQueueRevision: 5,
      proposalId: 'proposal-1',
      decision: 'skipped',
      selectedAttachmentIds: [],
      queuePage: { offset: 0, limit: 1, states: ['pending'] },
    }));
    expect(screen.getByTestId('import-notice')).toHaveTextContent('importNoPhotosSkipped');

    mocks.confirm.mutateAsync.mockClear();
    fireEvent.click(screen.getByTestId('import-skip-current'));
    await waitFor(() => expect(mocks.confirm.mutateAsync).toHaveBeenCalledWith({
      parentId: 'parent-1',
      expectedQueueRevision: 5,
      proposalId: 'proposal-1',
      decision: 'skipped',
      selectedAttachmentIds: [],
      queuePage: { offset: 0, limit: 1, states: ['pending'] },
    }));
  });

  it('allows reviewed candidates back to pending and freezes batching or imported candidates', async () => {
    mocks.queueResult.data = queue({
      proposals: [proposal({ state: 'confirmed' })],
    });
    const { rerender } = render(<ImportWorkflow />);
    await startNewReview();

    expect(await screen.findByTestId('mock-simple-editor')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('import-return-pending'));
    await waitFor(() => expect(mocks.confirm.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'pending' }),
    ));

    mocks.queueResult.data = queue({
      proposals: [proposal({ proposal_id: 'proposal-frozen', state: 'imported' })],
    });
    rerender(<ImportWorkflow />);

    expect(screen.getByTestId('import-candidate-readonly')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-simple-editor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-metadata-edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-photo-grid')).not.toBeInTheDocument();
  });

  it('preserves local edits across a revision conflict and retries with the refreshed revision', async () => {
    mocks.queueResult.data = queue();
    mocks.confirm.mutateAsync.mockRejectedValueOnce(new APIClientError(
      'raw conflict',
      'IMPORT_REVIEW_REVISION_CONFLICT',
      409,
      { current_queue_revision: 8, reason: 'revision_conflict' },
    )).mockResolvedValueOnce({ schema_version: 'import_review.v1', queue_revision: 9 });
    const { rerender } = render(<ImportWorkflow />);
    await startNewReview();

    fireEvent.change(await screen.findByTestId('mock-simple-editor'), {
      target: { value: 'Draft survives conflict' },
    });
    fireEvent.click(screen.getByTestId('mock-metadata-edit'));
    fireEvent.click(screen.getByTestId('import-confirm-next'));

    expect(await screen.findByTestId('import-revision-conflict')).toBeInTheDocument();
    mocks.queueResult.data = queue({ queue_revision: 8 });
    rerender(<ImportWorkflow />);
    expect(screen.getByTestId('mock-simple-editor')).toHaveValue('Draft survives conflict');
    expect(mocks.sidebarProps).toHaveBeenLastCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ title: 'Edited title' }),
    }));

    fireEvent.click(screen.getByTestId('import-confirm-next'));
    await waitFor(() => expect(mocks.confirm.mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedQueueRevision: 8 }),
    ));
  });

  it('ignores a confirm conflict after the user activates another parent', async () => {
    setPersistedJob();
    mocks.listResult.data = {
      schema_version: 'import_reviews.v1',
      jobs: [
        { import_id: 'parent-1', state: 'pending', queue_revision: 5 },
        { import_id: 'parent-2', state: 'pending', queue_revision: 9 },
      ],
      has_more: false,
    };
    const confirm = deferred<unknown>();
    mocks.confirm.mutateAsync.mockReturnValue(confirm.promise);
    const { rerender } = render(<ImportWorkflow />);
    fireEvent.click(screen.getByTestId('review-job-parent-1'));
    fireEvent.click(await screen.findByTestId('import-confirm-next'));
    await waitFor(() => expect(mocks.confirm.mutateAsync).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('review-job-parent-2'));
    mocks.queueResult.data = queue({
      import_id: 'parent-2',
      queue_revision: 9,
      proposals: [proposal({
        proposal_id: 'proposal-2',
        journal: {
          title: 'Parent two title',
          date: '2002-02-02',
          topic: 'family',
          tags: [],
          content: 'Parent two draft',
        },
      })],
    });
    rerender(<ImportWorkflow />);
    fireEvent.change(await screen.findByTestId('mock-simple-editor'), {
      target: { value: 'Parent two local edit' },
    });

    const conflict = new APIClientError(
      'raw stale conflict',
      'IMPORT_REVIEW_REVISION_CONFLICT',
      409,
      { current_queue_revision: 10, reason: 'revision_conflict' },
    );
    await act(async () => {
      confirm.reject(conflict);
      await expect(confirm.promise).rejects.toBe(conflict);
    });

    expect(screen.getByTestId('mock-simple-editor')).toHaveValue('Parent two local edit');
    expect(screen.queryByTestId('import-revision-conflict')).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-notice')).not.toBeInTheDocument();
  });

  it('uses server confirmed count, batches only explicitly, and recovers rebind-required', async () => {
    setPersistedJob();
    render(<ImportWorkflow />);
    fireEvent.click(screen.getByTestId('review-job-parent-1'));

    expect(screen.getByTestId('import-batch-run')).toHaveTextContent(
      'Import 7 confirmed entries',
    );
    expect(mocks.batch.mutateAsync).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('import-source-path'), {
      target: { value: 'F:\\Bound Photos' },
    });
    fireEvent.click(screen.getByTestId('import-rebind'));
    await screen.findByTestId('mock-photo-grid');

    mocks.batch.mutateAsync.mockRejectedValue(new APIClientError(
      'raw locator',
      'IMPORT_REVIEW_REBIND_REQUIRED',
      409,
      { reason: 'rebind_required' },
    ));
    fireEvent.click(screen.getByTestId('import-batch-run'));
    await waitFor(() => expect(mocks.batch.mutateAsync).toHaveBeenCalledWith('parent-1'));
    expect(await screen.findByTestId('import-binding-required')).toBeInTheDocument();
  });

  it('ignores a batch completion after the user activates another parent', async () => {
    mocks.queueResult.data = queue();
    mocks.listResult.data = {
      schema_version: 'import_reviews.v1',
      jobs: [{ import_id: 'parent-2', state: 'pending', queue_revision: 9 }],
      has_more: false,
    };
    const batch = deferred<unknown>();
    mocks.batch.mutateAsync.mockReturnValue(batch.promise);
    const { rerender } = render(<ImportWorkflow />);
    await startNewReview();
    fireEvent.click(screen.getByTestId('import-batch-run'));
    await waitFor(() => expect(mocks.batch.mutateAsync).toHaveBeenCalledWith('parent-1'));

    fireEvent.click(screen.getByTestId('review-job-parent-2'));
    mocks.queueResult.data = queue({
      import_id: 'parent-2',
      queue_revision: 9,
      proposals: [proposal({ proposal_id: 'proposal-2' })],
    });
    rerender(<ImportWorkflow />);
    await act(async () => {
      batch.resolve({ import_id: 'parent-1#batch-1' });
      await batch.promise;
    });

    expect(screen.getByTestId('import-binding-required')).toBeInTheDocument();
    expect(screen.queryByTestId('import-notice')).not.toBeInTheDocument();
  });

  it.each([
    'validate',
    'stage',
    'rebind',
    'confirm',
    'batch',
    'rollback',
  ] as const)('disables every mutation control and edit surface while %s is pending', async (name) => {
    mocks.queueResult.data = queue({
      proposals: [proposal({ state: 'confirmed' })],
    });
    mocks.statusResult.data = {
      schema_version: 'import_review.v1',
      import_id: 'parent-1',
      queue_counts: { confirmed: 7 },
      batches: [{
        import_id: 'parent-1#batch-1',
        state: 'committed',
        rollback_available: true,
      }],
    };
    const { rerender } = render(<ImportWorkflow />);
    await startNewReview();

    mocks[name].isPending = true;
    rerender(<ImportWorkflow />);

    expect(screen.getByTestId('import-start-review')).toBeDisabled();
    expect(screen.getByTestId('import-rebind')).toBeDisabled();
    expect(screen.getByTestId('import-confirm-next')).toBeDisabled();
    expect(screen.getByTestId('import-skip-current')).toBeDisabled();
    expect(screen.getByTestId('import-return-pending')).toBeDisabled();
    expect(screen.getByTestId('import-batch-run')).toBeDisabled();
    expect(screen.getByTestId('import-rollback-parent-1#batch-1')).toBeDisabled();
    expect(screen.getByTestId('mock-metadata-edit')).toBeDisabled();
    expect(screen.getByTestId('mock-simple-editor')).toBeDisabled();
    expect(screen.getByTestId('toggle-attachment-1')).toBeDisabled();
  });

  it('disables every candidate mutation and batch run while recovery or an active child blocks authority', async () => {
    mocks.queueResult.data = queue({
      proposals: [proposal({ state: 'confirmed' })],
    });
    mocks.statusResult.data = {
      schema_version: 'import_review.v1',
      import_id: 'parent-1',
      active_child_id: 'parent-1#batch-active',
      recovery_required: true,
      authority_status: 'recovery_required',
      queue_counts: { confirmed: 7 },
    };
    render(<ImportWorkflow />);
    await startNewReview();

    expect(await screen.findByTestId('import-confirm-next')).toBeDisabled();
    expect(screen.getByTestId('import-skip-current')).toBeDisabled();
    expect(screen.getByTestId('import-return-pending')).toBeDisabled();
    expect(screen.getByTestId('import-batch-run')).toBeDisabled();
    expect(screen.getByTestId('import-recovery-required')).toBeInTheDocument();
    expect(screen.getByTestId('import-active-child'))
      .toHaveTextContent('parent-1#batch-active');
    expect(screen.getByTestId('import-authority-blocked'))
      .toHaveTextContent('importAuthorityBlockedGuidance');
  });

  it('surfaces safe authority guidance for blocked confirm and batch failures', async () => {
    mocks.queueResult.data = queue();
    mocks.confirm.mutateAsync.mockRejectedValue(new APIClientError(
      'C:\\private\\raw confirm failure',
      'IMPORT_REVIEW_RECOVERY_REQUIRED',
      409,
      { reason: 'recovery_required', recovery_required: true },
    ));
    mocks.batch.mutateAsync.mockRejectedValue(new APIClientError(
      'C:\\private\\raw batch failure',
      'IMPORT_BATCH_ALREADY_ACTIVE',
      409,
      { reason: 'batch_active', active_child_id: 'parent-1#batch-2' },
    ));
    render(<ImportWorkflow />);
    await startNewReview();

    fireEvent.click(await screen.findByTestId('import-confirm-next'));
    await waitFor(() => expect(screen.getByTestId('import-notice'))
      .toHaveTextContent('importAuthorityBlockedGuidance'));
    expect(screen.getByTestId('import-notice')).not.toHaveTextContent('private');

    fireEvent.click(screen.getByTestId('import-batch-run'));
    await waitFor(() => expect(mocks.batch.mutateAsync).toHaveBeenCalled());
    expect(screen.getByTestId('import-notice'))
      .toHaveTextContent('importAuthorityBlockedGuidance');
    expect(screen.getByTestId('import-notice')).not.toHaveTextContent('private');
  });

  it('surfaces safe advisories and authority facts and gates rollback by strict true', async () => {
    setPersistedJob({ active_child_id: 'parent-1#batch-active', recovery_required: true });
    mocks.queueResult.data = queue({
      proposals: [proposal({
        state: 'stale',
        date_resolution: { status: 'unresolved' },
        warnings: [{
          code: 'HEIC_PREVIEW_UNAVAILABLE',
          format: 'HEIC',
          severity: 'warning',
          preview_available: false,
          message: 'C:\\secret\\photo.heic',
        }],
      })],
      warnings: [{ code: 'SAFE_CODE', severity: 'info', message: 'do not render me' }],
    });
    mocks.statusResult.data = {
      schema_version: 'import_review.v1',
      import_id: 'parent-1',
      active_child_id: 'parent-1#batch-active',
      recovery_required: true,
      authority_status: 'recovery_required',
      queue_counts: { confirmed: 7 },
    };
    const { rerender } = render(<ImportWorkflow />);
    fireEvent.click(screen.getByTestId('review-job-parent-1'));

    expect(screen.getByTestId('import-unresolved-date')).toBeInTheDocument();
    expect(screen.getByTestId('import-stale-candidate')).toBeInTheDocument();
    expect(screen.getByTestId('import-recovery-required')).toBeInTheDocument();
    expect(screen.getByTestId('import-active-child')).toHaveTextContent('parent-1#batch-active');
    expect(screen.getByText(/HEIC_PREVIEW_UNAVAILABLE/)).toBeInTheDocument();
    expect(screen.getByTestId('import-heic-limitation')).toBeInTheDocument();
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('import-batches')).not.toBeInTheDocument();

    mocks.statusResult.data = {
      ...mocks.statusResult.data,
      batches: [
        {
          import_id: 'parent-1#batch-1',
          state: 'committed',
          proposal_ids: ['proposal-1'],
          proposal_count: 1,
          rollback_available: true,
        },
        {
          import_id: 'parent-1#batch-2',
          state: 'committed',
          proposal_ids: [],
          proposal_count: 0,
          rollback_available: false,
        },
      ],
    };
    rerender(<ImportWorkflow />);

    expect(screen.getByTestId('import-batches')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^import-rollback-/)).toHaveLength(1);
    fireEvent.click(screen.getByTestId('import-rollback-parent-1#batch-1'));
    await waitFor(() => expect(mocks.rollback.mutateAsync).toHaveBeenCalledWith(
      'parent-1#batch-1',
    ));
  });

  it('surfaces persisted-review loading, error, and empty states without raw errors', () => {
    mocks.listResult.isLoading = true;
    const { rerender } = render(<ImportWorkflow />);
    expect(screen.getByRole('status')).toHaveTextContent('importReviewsLoading');

    mocks.listResult.isLoading = false;
    mocks.listResult.isError = true;
    mocks.listResult.error = new Error('C:\\private\\raw error');
    rerender(<ImportWorkflow />);
    expect(screen.getByRole('alert')).toHaveTextContent('importReviewsError');
    expect(screen.queryByText(/private/)).not.toBeInTheDocument();

    mocks.listResult.isError = false;
    rerender(<ImportWorkflow />);
    expect(screen.getByText('importReviewsEmpty')).toBeInTheDocument();
  });

  describe('CLI version gate', () => {
    it.each([
      '1.5.3',
      '1.6.0',
      '1.6.1',
    ])('fail-closes the gate for a globally-compatible but sub-1.6.2 CLI (%s) without calling any import hook or operation', (version) => {
      mocks.versionCheckResult.data = { compatible: true, cli_package_version: version };
      render(<ImportWorkflow />);

      expect(screen.getByTestId('import-cli-version-gate')).toBeInTheDocument();
      expect(screen.queryByTestId('import-review-workbench')).not.toBeInTheDocument();
      expect(screen.queryByTestId('import-source-path')).not.toBeInTheDocument();
      expect(screen.queryByTestId('import-start-review')).not.toBeInTheDocument();

      expect(mocks.reviewsListHook).not.toHaveBeenCalled();
      expect(mocks.reviewQueueHook).not.toHaveBeenCalled();
      expect(mocks.reviewStatusHook).not.toHaveBeenCalled();
      expect(mocks.validate.mutateAsync).not.toHaveBeenCalled();
      expect(mocks.stage.mutateAsync).not.toHaveBeenCalled();
      expect(mocks.rebind.mutateAsync).not.toHaveBeenCalled();
      expect(mocks.confirm.mutateAsync).not.toHaveBeenCalled();
      expect(mocks.batch.mutateAsync).not.toHaveBeenCalled();
      expect(mocks.rollback.mutateAsync).not.toHaveBeenCalled();
    });

    it('mounts the workbench unchanged when the CLI meets the 1.6.2 photo-import floor', () => {
      mocks.versionCheckResult.data = { compatible: true, cli_package_version: '1.6.2' };
      render(<ImportWorkflow />);

      expect(screen.getByTestId('import-review-workbench')).toBeInTheDocument();
      expect(screen.queryByTestId('import-cli-version-gate')).not.toBeInTheDocument();
    });

    it('mounts the workbench unchanged when the CLI is above the 1.6.2 photo-import floor', () => {
      mocks.versionCheckResult.data = { compatible: true, cli_package_version: '1.7.0' };
      render(<ImportWorkflow />);

      expect(screen.getByTestId('import-review-workbench')).toBeInTheDocument();
      expect(screen.queryByTestId('import-cli-version-gate')).not.toBeInTheDocument();
    });

    it('shows an honest loading state and mounts no import hooks before the version resolves', () => {
      mocks.versionCheckResult.data = undefined;
      mocks.versionCheckResult.isLoading = true;
      mocks.versionCheckResult.isError = false;
      render(<ImportWorkflow />);

      expect(screen.getByTestId('import-cli-version-loading')).toBeInTheDocument();
      expect(screen.queryByTestId('import-review-workbench')).not.toBeInTheDocument();
      expect(mocks.reviewsListHook).not.toHaveBeenCalled();
      expect(mocks.reviewQueueHook).not.toHaveBeenCalled();
      expect(mocks.reviewStatusHook).not.toHaveBeenCalled();
      expect(mocks.stage.mutateAsync).not.toHaveBeenCalled();
    });

    it('fail-closes the gate when the version query errors with no usable data', () => {
      mocks.versionCheckResult.data = undefined;
      mocks.versionCheckResult.isLoading = false;
      mocks.versionCheckResult.isError = true;
      mocks.versionCheckResult.error = new Error('version check failed');
      render(<ImportWorkflow />);

      expect(screen.getByTestId('import-cli-version-gate')).toBeInTheDocument();
      expect(screen.queryByTestId('import-review-workbench')).not.toBeInTheDocument();
    });

    it('fail-closes the gate when a stale 1.6.2 cache is retained alongside a query error', () => {
      mocks.versionCheckResult.data = { compatible: true, cli_package_version: '1.6.2' };
      mocks.versionCheckResult.isLoading = false;
      mocks.versionCheckResult.isError = true;
      mocks.versionCheckResult.error = new Error('background refresh failed');
      render(<ImportWorkflow />);

      expect(screen.getByTestId('import-cli-version-gate')).toBeInTheDocument();
      expect(screen.queryByTestId('import-review-workbench')).not.toBeInTheDocument();

      expect(mocks.reviewsListHook).not.toHaveBeenCalled();
      expect(mocks.reviewQueueHook).not.toHaveBeenCalled();
      expect(mocks.reviewStatusHook).not.toHaveBeenCalled();
      expect(mocks.validate.mutateAsync).not.toHaveBeenCalled();
      expect(mocks.stage.mutateAsync).not.toHaveBeenCalled();
      expect(mocks.rebind.mutateAsync).not.toHaveBeenCalled();
      expect(mocks.confirm.mutateAsync).not.toHaveBeenCalled();
      expect(mocks.batch.mutateAsync).not.toHaveBeenCalled();
      expect(mocks.rollback.mutateAsync).not.toHaveBeenCalled();
    });

    it.each([
      ['a prerelease-suffixed version', '1.6.2-dev'],
      ['a missing version', undefined],
    ])('fail-closes the gate when the reported CLI version is %s', (_label, version) => {
      mocks.versionCheckResult.data = { compatible: true, cli_package_version: version };
      render(<ImportWorkflow />);

      expect(screen.getByTestId('import-cli-version-gate')).toBeInTheDocument();
      expect(screen.queryByTestId('import-review-workbench')).not.toBeInTheDocument();
    });
  });
});
