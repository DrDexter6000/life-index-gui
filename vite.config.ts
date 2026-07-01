import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveAllowedHosts } from './config/vite-allowed-hosts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function normalizeModuleId(id: string) {
  return id.replace(/\\/g, '/')
}

export function manualChunks(id: string) {
  const moduleId = normalizeModuleId(id)

  if (moduleId.includes('/node_modules/')) {
    if (
      moduleId.includes('/echarts/')
      || moduleId.includes('/zrender/')
      || moduleId.includes('/echarts-for-react/')
    ) {
      return 'echarts-vendor'
    }

    if (
      moduleId.includes('/@nivo/')
      || moduleId.includes('/recharts/')
      || moduleId.includes('/d3-')
      || moduleId.includes('/victory-vendor/')
    ) {
      return 'charts-vendor'
    }

    if (
      moduleId.includes('/react/')
      || moduleId.includes('/react-dom/')
      || moduleId.includes('/scheduler/')
    ) {
      return 'react-vendor'
    }

    if (
      moduleId.includes('/motion/')
      || moduleId.includes('/@motionone/')
    ) {
      return 'motion-vendor'
    }

    return 'vendor'
  }

  if (
    moduleId.includes('/src/app/routes/Archives')
    || moduleId.includes('/src/components/archives/')
  ) {
    return 'route-archives'
  }

  if (
    moduleId.includes('/src/app/routes/Recall')
    || moduleId.includes('/src/app/routes/recallWorkbenchState')
  ) {
    return 'route-recall'
  }

  if (
    moduleId.includes('/src/app/routes/ImportWorkflow')
    || moduleId.includes('/src/hooks/useImports')
  ) {
    return 'route-import'
  }

  if (
    moduleId.includes('/src/app/routes/IndexTreeDiagnostics')
    || moduleId.includes('/src/hooks/useIndexTree')
  ) {
    return 'route-index-tree'
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    allowedHosts: resolveAllowedHosts(),
    proxy: {
      '/api': {
        target: process.env.BACKEND_URL || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/attachments': {
        target: process.env.BACKEND_URL || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
} as const)
