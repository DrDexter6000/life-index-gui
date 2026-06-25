import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'
import zhTranslations from '../i18n/zh.json'

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
  })) as unknown as HTMLCanvasElement['getContext']
}

// Resolve nested keys like "ns.key" → not needed (flat structure), but handle direct keys
function resolve(obj: Record<string, string>, key: string): string {
  return obj[key] ?? key
}

// Global mock for useTranslation — uses actual zh.json so test assertions match real text.
// Individual tests can override with vi.mock('@/hooks/useTranslation', ...) for specific mappings.
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const value = resolve(zhTranslations, key)
      if (!opts) return value
      // Simple interpolation: replace {{var}} with value
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)),
        value,
      )
    },
    lang: 'zh' as const,
  }),
  i18n: { changeLanguage: vi.fn() },
}))
