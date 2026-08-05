import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ImportPreviewResult,
  ImportReviewAttachment,
} from '@/lib/api-client';
import { PhotoAttachmentGrid } from './PhotoAttachmentGrid';

const apiMocks = vi.hoisted(() => ({
  preview: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  importAPI: {
    preview: apiMocks.preview,
  },
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        importPhotoPreviewLoading: '照片预览加载中',
        importPhotoPreviewUnavailable: '照片预览不可用',
        importPhotoSelected: '已纳入本篇',
        importPhotoExcluded: '未纳入本篇',
        importPhotoExcludeAction: '不纳入本篇',
        importPhotoIncludeAction: '纳入本篇',
        importPhotoFallbackLabel: '照片 {{index}}',
        importPhotoPreviousPage: '上一页',
        importPhotoNextPage: '下一页',
        importPhotoPageStatus: '第 {{current}} / {{total}} 页',
      };
      return Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        translations[key] ?? key,
      );
    },
  }),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function attachment(
  attachmentId: string,
  selected = false,
  sourceRef = `安全标签 ${attachmentId}`,
): ImportReviewAttachment {
  return {
    attachment_id: attachmentId,
    source_ref: sourceRef,
    media_type: 'image/jpeg',
    size: 3,
    selected,
  };
}

function previewResult(attachmentId: string): ImportPreviewResult {
  return {
    bytes: new Uint8Array([1, 2, 3]),
    blob: new Blob([attachmentId], { type: 'image/jpeg' }),
    metadata: {},
  } as ImportPreviewResult;
}

const createObjectURLMock = vi.fn<() => string>();
const revokeObjectURLMock = vi.fn<(url: string) => void>();
let objectUrlSequence = 0;

beforeEach(() => {
  vi.clearAllMocks();
  objectUrlSequence = 0;
  createObjectURLMock.mockImplementation(() => `blob:preview-${++objectUrlSequence}`);

  const NativeURL = globalThis.URL;
  class PreviewURL extends NativeURL {}
  Object.defineProperties(PreviewURL, {
    createObjectURL: { configurable: true, value: createObjectURLMock },
    revokeObjectURL: { configurable: true, value: revokeObjectURLMock },
  });
  vi.stubGlobal('URL', PreviewURL);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PhotoAttachmentGrid', () => {
  it('fetches only the first bounded page and never exceeds four concurrent previews', async () => {
    const attachments = Array.from({ length: 14 }, (_, index) =>
      attachment(`att-${index + 1}`),
    );
    const pending: Array<Deferred<ImportPreviewResult>> = [];
    let active = 0;
    let maxActive = 0;

    apiMocks.preview.mockImplementation((_parentId, _request) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const task = deferred<ImportPreviewResult>();
      pending.push(task);
      return task.promise.finally(() => {
        active -= 1;
      });
    });

    const { unmount } = render(
      <PhotoAttachmentGrid
        parentId="parent-1"
        proposalId="proposal-1"
        attachments={attachments}
        selectedAttachmentIds={[]}
        onToggle={vi.fn()}
      />,
    );

    await waitFor(() => expect(apiMocks.preview).toHaveBeenCalledTimes(4));

    for (let index = 0; index < 12; index += 1) {
      await waitFor(() => expect(pending[index]).toBeDefined());
      await act(async () => {
        pending[index].resolve(previewResult(`att-${index + 1}`));
        await pending[index].promise;
      });
    }

    await waitFor(() => expect(apiMocks.preview).toHaveBeenCalledTimes(12));
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(apiMocks.preview.mock.calls.map(([, request]) => request.attachment_id)).toEqual(
      attachments.slice(0, 12).map(({ attachment_id }) => attachment_id),
    );
    expect(apiMocks.preview).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ attachment_id: 'att-13' }),
    );

    unmount();
  });

  it('keeps one four-preview limit across page generations and skips canceled queued work', async () => {
    const attachments = Array.from({ length: 16 }, (_, index) =>
      attachment(`att-${index + 1}`),
    );
    const pending: Array<{
      attachmentId: string;
      task: Deferred<ImportPreviewResult>;
    }> = [];
    let active = 0;
    let maxActive = 0;

    apiMocks.preview.mockImplementation((_parentId, request) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const task = deferred<ImportPreviewResult>();
      pending.push({ attachmentId: request.attachment_id, task });
      return task.promise.finally(() => {
        active -= 1;
      });
    });

    render(
      <PhotoAttachmentGrid
        parentId="parent-1"
        proposalId="proposal-1"
        attachments={attachments}
        selectedAttachmentIds={[]}
        onToggle={vi.fn()}
        pageSize={8}
      />,
    );

    await waitFor(() => expect(apiMocks.preview).toHaveBeenCalledTimes(4));
    expect(pending.map(({ attachmentId }) => attachmentId)).toEqual([
      'att-1',
      'att-2',
      'att-3',
      'att-4',
    ]);

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(apiMocks.preview).toHaveBeenCalledTimes(4);

    await act(async () => {
      pending[0].task.resolve(previewResult('att-1'));
      await pending[0].task.promise;
    });

    await waitFor(() => expect(apiMocks.preview).toHaveBeenCalledTimes(5));
    expect(pending[4].attachmentId).toBe('att-9');
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it('fetches only the next bounded page with exact parent, proposal, and attachment identity', async () => {
    apiMocks.preview.mockImplementation((_parentId, request) =>
      Promise.resolve(previewResult(request.attachment_id)),
    );

    render(
      <PhotoAttachmentGrid
        parentId="parent-exact"
        proposalId="proposal-exact"
        attachments={[attachment('att-1'), attachment('att-2'), attachment('att-3')]}
        selectedAttachmentIds={[]}
        onToggle={vi.fn()}
        pageSize={2}
      />,
    );

    await waitFor(() => expect(apiMocks.preview).toHaveBeenCalledTimes(2));
    expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    await waitFor(() => expect(apiMocks.preview).toHaveBeenCalledTimes(3));
    expect(apiMocks.preview).toHaveBeenNthCalledWith(1, 'parent-exact', {
      proposal_id: 'proposal-exact',
      attachment_id: 'att-1',
    });
    expect(apiMocks.preview).toHaveBeenNthCalledWith(2, 'parent-exact', {
      proposal_id: 'proposal-exact',
      attachment_id: 'att-2',
    });
    expect(apiMocks.preview).toHaveBeenNthCalledWith(3, 'parent-exact', {
      proposal_id: 'proposal-exact',
      attachment_id: 'att-3',
    });
    expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument();
    expect(screen.queryByTestId('photo-attachment-att-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('photo-attachment-att-3')).toBeInTheDocument();
  });

  it('uses parent-owned selection and reports the real include or exclude decision', () => {
    apiMocks.preview.mockImplementation(() => new Promise(() => {}));
    const onToggle = vi.fn();

    render(
      <PhotoAttachmentGrid
        parentId="parent-1"
        proposalId="proposal-1"
        attachments={[
          attachment('att-selected', false),
          attachment('att-excluded', true),
        ]}
        selectedAttachmentIds={['att-selected']}
        onToggle={onToggle}
      />,
    );

    const selectedTile = screen.getByTestId('photo-attachment-att-selected');
    const excludedTile = screen.getByTestId('photo-attachment-att-excluded');
    expect(within(selectedTile).getByText('已纳入本篇')).toBeInTheDocument();
    expect(within(excludedTile).getByText('未纳入本篇')).toBeInTheDocument();

    fireEvent.click(within(selectedTile).getByRole('button', { name: '不纳入本篇' }));
    fireEvent.click(within(excludedTile).getByRole('button', { name: '纳入本篇' }));

    expect(onToggle).toHaveBeenNthCalledWith(1, 'att-selected', false);
    expect(onToggle).toHaveBeenNthCalledWith(2, 'att-excluded', true);
  });

  it('revokes current, old-page, and late-created object URLs', async () => {
    const previews = new Map([
      ['att-1', deferred<ImportPreviewResult>()],
      ['att-2', deferred<ImportPreviewResult>()],
      ['att-3', deferred<ImportPreviewResult>()],
    ]);
    apiMocks.preview.mockImplementation((_parentId, request) => {
      const task = previews.get(request.attachment_id);
      if (!task) throw new Error(`unexpected attachment ${request.attachment_id}`);
      return task.promise;
    });

    const { unmount } = render(
      <PhotoAttachmentGrid
        parentId="parent-1"
        proposalId="proposal-1"
        attachments={[attachment('att-1'), attachment('att-2'), attachment('att-3')]}
        selectedAttachmentIds={[]}
        onToggle={vi.fn()}
        pageSize={2}
      />,
    );

    await waitFor(() => expect(apiMocks.preview).toHaveBeenCalledTimes(2));
    await act(async () => {
      previews.get('att-1')?.resolve(previewResult('att-1'));
    });
    await waitFor(() =>
      expect(screen.getByAltText('安全标签 att-1')).toHaveAttribute('src', 'blob:preview-1'),
    );

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:preview-1'));
    await waitFor(() => expect(apiMocks.preview).toHaveBeenCalledTimes(3));

    await act(async () => {
      previews.get('att-2')?.resolve(previewResult('att-2'));
    });
    await waitFor(() => expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:preview-2'));
    expect(screen.queryByAltText('安全标签 att-2')).not.toBeInTheDocument();

    await act(async () => {
      previews.get('att-3')?.resolve(previewResult('att-3'));
    });
    await waitFor(() =>
      expect(screen.getByAltText('安全标签 att-3')).toHaveAttribute('src', 'blob:preview-3'),
    );

    unmount();
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:preview-3');
  });

  it('exposes accessible loading and error states without durable browser storage', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    const clear = vi.spyOn(Storage.prototype, 'clear');
    const indexedDbOpen = vi.fn();
    vi.stubGlobal('indexedDB', { open: indexedDbOpen });

    const previews = new Map([
      ['att-loading', deferred<ImportPreviewResult>()],
      ['att-error', deferred<ImportPreviewResult>()],
    ]);
    apiMocks.preview.mockImplementation((_parentId, request) => {
      const task = previews.get(request.attachment_id);
      if (!task) throw new Error(`unexpected attachment ${request.attachment_id}`);
      return task.promise;
    });

    render(
      <PhotoAttachmentGrid
        parentId="parent-1"
        proposalId="proposal-1"
        attachments={[
          attachment('att-loading', false, 'C:\\private\\photo.jpg'),
          attachment('att-error'),
        ]}
        selectedAttachmentIds={[]}
        onToggle={vi.fn()}
      />,
    );

    await waitFor(() => expect(apiMocks.preview).toHaveBeenCalledTimes(2));
    for (const loadingState of screen.getAllByText('照片预览加载中')) {
      expect(loadingState).toHaveAttribute('role', 'status');
    }
    expect(screen.queryByText('C:\\private\\photo.jpg')).not.toBeInTheDocument();
    expect(screen.getByText('照片 1')).toBeInTheDocument();

    await act(async () => {
      previews.get('att-error')?.reject(new Error('preview failed'));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('照片预览不可用');

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(indexedDbOpen).not.toHaveBeenCalled();
  });
});
