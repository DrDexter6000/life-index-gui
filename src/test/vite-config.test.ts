import { describe, expect, it } from 'vitest';
import { resolveAllowedHosts } from '../../config/vite-allowed-hosts';

describe('vite allowed hosts', () => {
  it('does not allow tunnel hosts by default', () => {
    expect(resolveAllowedHosts({})).toEqual([]);
  });

  it('allows trycloudflare hosts only for explicit local mobile tunnel runs', () => {
    expect(resolveAllowedHosts({ LIFE_INDEX_ALLOW_TRYCLOUDFLARE_HOSTS: '1' })).toEqual([
      '.trycloudflare.com',
    ]);
  });
});
