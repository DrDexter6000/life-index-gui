import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaLightbox, type MediaLightboxAttachment } from './MediaLightbox';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        hostAgentMediaLoading: 'Loading...',
        hostAgentMediaLoadFailed: 'Media failed to load',
        hostAgentMediaPreviewFailed: 'Preview failed',
        hostAgentMediaRetry: 'Retry',
        hostAgentMediaRetryAria: 'Retry media load',
        hostAgentMediaViewOriginal: 'View Original',
        hostAgentMediaViewOriginalAria: 'View original {{filename}}',
        hostAgentMediaDownload: 'Download',
        hostAgentMediaDownloadAria: 'Download attachment {{filename}}',
        hostAgentMediaClose: 'Close',
        hostAgentMediaDiagnosticChecking: 'Checking the media path...',
        hostAgentMediaDiagnosticBackend: 'Backend returned {{status}}.',
        hostAgentMediaDiagnosticTunnel: 'Tunnel returned {{status}}.',
        hostAgentMediaDiagnosticBrowser: 'Browser could not render media.',
        hostAgentMediaDiagnosticNetwork: 'Network request failed.',
        hostAgentMediaDiagnosticHttp: 'Media request returned {{status}}.',
        hostAgentMediaDiagnosticUnknown: 'Unknown media failure.',
        hostAgentMediaDiagnosticUrl: 'Request {{url}}',
      };
      const value = translations[key] ?? key;
      return Object.entries(opts ?? {}).reduce(
        (text, [name, replacement]) => text.replace(`{{${name}}}`, String(replacement)),
        value,
      );
    },
  }),
}));

const imageAttachment: MediaLightboxAttachment = {
  relPath: 'attachments/2026/04/photo.jpg',
  filename: 'photo.jpg',
  contentType: 'image/jpeg',
  sizeBytes: 12345,
  kind: 'image',
};

afterEach(() => {
  document.body.style.overflow = '';
  vi.unstubAllGlobals();
});

function LightboxHarness({ onClose }: { onClose: () => void }) {
  const [attachment, setAttachment] = useState<MediaLightboxAttachment | null>(imageAttachment);
  return (
    attachment ? (
      <MediaLightbox
        attachment={attachment}
        onClose={() => {
          onClose();
          setAttachment(null);
        }}
      />
    ) : (
      <button type="button" onClick={() => setAttachment(imageAttachment)}>
        Reopen
      </button>
    )
  );
}

describe('MediaLightbox', () => {
  it('uses a preview image, keeps download explicit, and ignores interaction inside the dialog', () => {
    const onClose = vi.fn();
    render(<LightboxHarness onClose={onClose} />);

    const dialog = screen.getByRole('dialog', { name: 'photo.jpg' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByTestId('host-agent-media-lightbox-image')).toHaveAttribute(
      'src',
      '/api/attachments/2026/04/photo.jpg?variant=preview&max_px=1400',
    );
    expect(screen.getByRole('link', { name: 'Download attachment photo.jpg' })).toHaveAttribute(
      'href',
      '/api/attachments/2026/04/photo.jpg',
    );
    expect(screen.getByRole('link', { name: 'Download attachment photo.jpg' })).toHaveAttribute(
      'download',
      'photo.jpg',
    );

    fireEvent.click(screen.getByTestId('host-agent-media-lightbox-frame'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes from the backdrop and restores the previous body scroll style', () => {
    const onClose = vi.fn();
    document.body.style.overflow = 'scroll';
    render(<LightboxHarness onClose={onClose} />);

    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByTestId('host-agent-media-lightbox'));

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('closes from the explicit close action', () => {
    const onClose = vi.fn();
    render(<LightboxHarness onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape and cleans up its scoped key handler', () => {
    const onClose = vi.fn();
    document.body.style.overflow = 'auto';
    render(<LightboxHarness onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('auto');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('starts a reopened session on preview without stale error diagnostics', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<LightboxHarness onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'View original photo.jpg' }));
    expect(screen.getByTestId('host-agent-media-lightbox-image')).toHaveAttribute(
      'src',
      '/api/attachments/2026/04/photo.jpg',
    );
    fireEvent.error(screen.getByTestId('host-agent-media-lightbox-image'));
    expect(screen.getByTestId('host-agent-media-error')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));

    expect(screen.getByTestId('host-agent-media-lightbox-image')).toHaveAttribute(
      'src',
      '/api/attachments/2026/04/photo.jpg?variant=preview&max_px=1400',
    );
    expect(screen.queryByTestId('host-agent-media-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('host-agent-media-diagnostic-url')).not.toBeInTheDocument();
  });
});
