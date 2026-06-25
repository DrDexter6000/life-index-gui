import { describe, expect, it, vi } from 'vitest';
import { diagnoseMediaLoadFailure } from './media-diagnostics';

describe('diagnoseMediaLoadFailure', () => {
  it('classifies 5xx responses from the app origin as backend failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    await expect(diagnoseMediaLoadFailure('/api/attachments/photo.jpg', fetchImpl)).resolves.toEqual({
      layer: 'backend',
      status: 500,
      url: '/api/attachments/photo.jpg',
    });
    expect(fetchImpl).toHaveBeenCalledWith('/api/attachments/photo.jpg', {
      method: 'HEAD',
      cache: 'no-store',
    });
  });

  it('classifies common tunnel/origin status codes as tunnel failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 502 });

    await expect(diagnoseMediaLoadFailure('/api/attachments/photo.jpg', fetchImpl)).resolves.toMatchObject({
      layer: 'tunnel',
      status: 502,
    });
  });

  it('classifies a successful probe after image onError as browser decode or render failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await expect(diagnoseMediaLoadFailure('/api/attachments/photo.jpg', fetchImpl)).resolves.toMatchObject({
      layer: 'browser',
      status: 200,
    });
  });

  it('classifies rejected probes as network or tunnel interruption', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('terminated'));

    await expect(diagnoseMediaLoadFailure('/api/attachments/photo.jpg', fetchImpl)).resolves.toMatchObject({
      layer: 'network',
      status: null,
    });
  });
});
