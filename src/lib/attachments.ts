/**
 * attachmentUrl — normalize a CLI attachment relPath into a backend download URL.
 *
 * Rules:
 * - Full URLs (http/https) pass through unchanged.
 * - Strip leading `/attachments/` or `attachments/` prefix if present.
 * - Handle relative paths like `../../../attachments/2026/01/file.jpg` by extracting
 *   the segment after `/attachments/`.
 * - Encode each path segment with encodeURIComponent; preserve `/` separators.
 */
export interface AttachmentUrlOptions {
  variant?: 'thumbnail' | 'preview';
  maxPx?: number;
}

export function attachmentUrl(relPath: string, options: AttachmentUrlOptions = {}): string {
  if (
    relPath.startsWith('http://') ||
    relPath.startsWith('https://')
  ) {
    return relPath;
  }

  let normalized = relPath;

  if (normalized.startsWith('/attachments/')) {
    normalized = normalized.slice('/attachments/'.length);
  } else if (normalized.startsWith('attachments/')) {
    normalized = normalized.slice('attachments/'.length);
  } else if (normalized.includes('/attachments/')) {
    const idx = normalized.indexOf('/attachments/');
    normalized = normalized.slice(idx + '/attachments/'.length);
  }

  const path = `/api/attachments/${normalized.split('/').map(encodeURIComponent).join('/')}`;
  if (!options.variant) return path;

  const params = new URLSearchParams({ variant: options.variant });
  if (options.maxPx) {
    params.set('max_px', String(options.maxPx));
  }
  return `${path}?${params.toString()}`;
}
