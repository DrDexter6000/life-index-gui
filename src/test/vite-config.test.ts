/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { resolveAllowedHosts } from '../../config/vite-allowed-hosts';
import viteConfig, { manualChunks } from '../../vite.config';

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

describe('vite manual chunks', () => {
  it('keeps heavy ECharts packages out of the catch-all vendor chunk', () => {
    expect(manualChunks('D:/repo/node_modules/echarts/lib/echarts.js')).toBe('echarts-vendor');
    expect(manualChunks('D:/repo/node_modules/zrender/lib/zrender.js')).toBe('echarts-vendor');
  });

  it('sets the warning limit around the isolated lazy ECharts vendor size', () => {
    expect(viteConfig.build?.chunkSizeWarningLimit).toBe(1200);
  });
});
