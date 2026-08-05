import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  importAPI,
  type ImportReviewAttachment,
} from '@/lib/api-client';

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 12;
const MAX_PREVIEW_CONCURRENCY = 4;

type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; objectUrl: string }
  | { status: 'error' };

interface PreviewQueueTask {
  isCancelled: () => boolean;
  run: () => Promise<void>;
}

interface PreviewScheduler {
  active: number;
  queue: PreviewQueueTask[];
}

export interface PhotoAttachmentGridProps {
  parentId: string;
  proposalId: string;
  attachments: ImportReviewAttachment[];
  selectedAttachmentIds: readonly string[];
  onToggle: (attachmentId: string, selected: boolean) => void;
  pageSize?: number;
}

function boundedPageSize(pageSize: number | undefined): number {
  if (pageSize === undefined || !Number.isFinite(pageSize)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize)));
}

function safeSourceLabel(sourceRef: string | undefined): string | null {
  const label = sourceRef?.trim();
  if (!label || label.length > 160) return null;

  const looksLikePath =
    /[\\/]/.test(label) ||
    /^[a-z]:/i.test(label) ||
    /^file:/i.test(label);
  const looksLikeHash = /\b[a-f0-9]{32,}\b/i.test(label);
  return looksLikePath || looksLikeHash ? null : label;
}

function pumpPreviewQueue(scheduler: PreviewScheduler): void {
  while (
    scheduler.active < MAX_PREVIEW_CONCURRENCY &&
    scheduler.queue.length > 0
  ) {
    const task = scheduler.queue.shift();
    if (!task || task.isCancelled()) continue;

    scheduler.active += 1;
    void task
      .run()
      .catch(() => undefined)
      .finally(() => {
        scheduler.active -= 1;
        pumpPreviewQueue(scheduler);
      });
  }
}

/**
 * Bounded, presentation-only attachment picker for one historical-photo
 * proposal. Selection remains parent-owned; this component only previews the
 * visible page and reports explicit include/exclude intent.
 */
export function PhotoAttachmentGrid({
  parentId,
  proposalId,
  attachments,
  selectedAttachmentIds,
  onToggle,
  pageSize,
}: PhotoAttachmentGridProps) {
  const { t } = useTranslation();
  const effectivePageSize = boundedPageSize(pageSize);
  const totalPages = Math.max(1, Math.ceil(attachments.length / effectivePageSize));
  const [currentPage, setCurrentPage] = useState(0);
  const [previewStates, setPreviewStates] = useState<Record<string, PreviewState>>({});
  const previewSchedulerRef = useRef<PreviewScheduler>({
    active: 0,
    queue: [],
  });

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages - 1));
  }, [totalPages]);

  const pageStart = currentPage * effectivePageSize;
  const visibleAttachments = useMemo(
    () => attachments.slice(pageStart, pageStart + effectivePageSize),
    [attachments, effectivePageSize, pageStart],
  );

  useEffect(() => {
    const generation = { cancelled: false };
    const createdObjectUrls = new Set<string>();
    const scheduler = previewSchedulerRef.current;

    setPreviewStates(
      Object.fromEntries(
        visibleAttachments.map(({ attachment_id }) => [
          attachment_id,
          { status: 'loading' } satisfies PreviewState,
        ]),
      ),
    );

    for (const attachment of visibleAttachments) {
      scheduler.queue.push({
        isCancelled: () => generation.cancelled,
        run: async () => {
          if (generation.cancelled) return;

          try {
            const result = await importAPI.preview(parentId, {
              proposal_id: proposalId,
              attachment_id: attachment.attachment_id,
            });
            const objectUrl = URL.createObjectURL(result.blob);

            if (generation.cancelled) {
              URL.revokeObjectURL(objectUrl);
              return;
            }

            createdObjectUrls.add(objectUrl);
            setPreviewStates((current) => ({
              ...current,
              [attachment.attachment_id]: { status: 'ready', objectUrl },
            }));
          } catch {
            if (!generation.cancelled) {
              setPreviewStates((current) => ({
                ...current,
                [attachment.attachment_id]: { status: 'error' },
              }));
            }
          }
        },
      });
    }
    pumpPreviewQueue(scheduler);

    return () => {
      generation.cancelled = true;
      scheduler.queue = scheduler.queue.filter((task) => !task.isCancelled());
      for (const objectUrl of createdObjectUrls) {
        URL.revokeObjectURL(objectUrl);
      }
      createdObjectUrls.clear();
    };
  }, [parentId, proposalId, visibleAttachments]);

  const selectedIds = useMemo(
    () => new Set(selectedAttachmentIds),
    [selectedAttachmentIds],
  );

  const loadingCopy = t('importPhotoPreviewLoading', {
    defaultValue: '照片预览加载中',
  });
  const unavailableCopy = t('importPhotoPreviewUnavailable', {
    defaultValue: '照片预览不可用',
  });

  return (
    <section aria-label={t('importPhotoGridLabel', { defaultValue: '照片附件' })}>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {visibleAttachments.map((attachment, index) => {
          const selected = selectedIds.has(attachment.attachment_id);
          const preview = previewStates[attachment.attachment_id] ?? { status: 'loading' };
          const label =
            safeSourceLabel(attachment.source_ref) ??
            t('importPhotoFallbackLabel', {
              defaultValue: '照片 {{index}}',
              index: pageStart + index + 1,
            });

          return (
            <article
              key={attachment.attachment_id}
              aria-label={label}
              data-testid={`photo-attachment-${attachment.attachment_id}`}
              className="overflow-hidden rounded-xl border border-[var(--color-gold-20)] bg-[var(--color-surface)]"
            >
              <div className="flex aspect-square items-center justify-center bg-[var(--color-surface-elevated)]">
                {preview.status === 'ready' ? (
                  <img
                    src={preview.objectUrl}
                    alt={label}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : preview.status === 'error' ? (
                  <p
                    role="alert"
                    className="px-3 text-center text-sm text-[var(--color-muted)]"
                  >
                    {unavailableCopy}
                  </p>
                ) : (
                  <p
                    role="status"
                    aria-live="polite"
                    className="px-3 text-center text-sm text-[var(--color-muted)]"
                  >
                    {loadingCopy}
                  </p>
                )}
              </div>

              <div className="space-y-2 p-3">
                <p className="truncate text-sm text-[var(--color-secondary)]" title={label}>
                  {label}
                </p>
                <p className="text-xs text-[var(--color-muted)]">
                  {selected
                    ? t('importPhotoSelected', { defaultValue: '已纳入本篇' })
                    : t('importPhotoExcluded', { defaultValue: '未纳入本篇' })}
                </p>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onToggle(attachment.attachment_id, !selected)}
                  className="w-full rounded-lg border border-[var(--color-gold-20)] px-3 py-2 text-sm text-[var(--color-primary)]"
                >
                  {selected
                    ? t('importPhotoExcludeAction', { defaultValue: '不纳入本篇' })
                    : t('importPhotoIncludeAction', { defaultValue: '纳入本篇' })}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <nav
        aria-label={t('importPhotoPaginationLabel', { defaultValue: '照片分页' })}
        className="mt-4 flex items-center justify-between gap-4"
      >
        <button
          type="button"
          disabled={currentPage === 0}
          onClick={() => setCurrentPage((page) => Math.max(0, page - 1))}
          className="rounded-lg border border-[var(--color-gold-20)] px-4 py-2 text-sm disabled:opacity-40"
        >
          {t('importPhotoPreviousPage', { defaultValue: '上一页' })}
        </button>
        <p aria-live="polite" className="text-sm text-[var(--color-muted)]">
          {t('importPhotoPageStatus', {
            defaultValue: '第 {{current}} / {{total}} 页',
            current: currentPage + 1,
            total: totalPages,
          })}
        </p>
        <button
          type="button"
          disabled={currentPage >= totalPages - 1}
          onClick={() => setCurrentPage((page) => Math.min(totalPages - 1, page + 1))}
          className="rounded-lg border border-[var(--color-gold-20)] px-4 py-2 text-sm disabled:opacity-40"
        >
          {t('importPhotoNextPage', { defaultValue: '下一页' })}
        </button>
      </nav>
    </section>
  );
}
