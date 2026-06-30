import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './Layout';
import { ErrorBoundary } from '@/components/celestial/ErrorBoundary';
import TheCore from '@/app/routes/TheCore';
import DiagnosticCenterLayout from '@/components/maintenance/DiagnosticCenterLayout';

// Lazy-loaded route pages for code splitting
const Recall = lazy(() => import('@/app/routes/Recall'));
const Archives = lazy(() => import('@/app/routes/Archives'));
const JournalDetail = lazy(() => import('@/app/routes/JournalDetail'));
const EmptyState = lazy(() => import('@/app/routes/EmptyState'));
const HealthCenter = lazy(() => import('@/app/routes/HealthCenter'));
const EntityGraph = lazy(() => import('@/app/routes/EntityGraph'));
const IndexDiagnostics = lazy(() => import('@/app/routes/IndexDiagnostics'));
const IndexTreeDiagnostics = lazy(() => import('@/app/routes/IndexTreeDiagnostics'));
const ImportWorkflow = lazy(() => import('@/app/routes/ImportWorkflow'));
const PublicLinkExchange = lazy(() => import('@/app/routes/PublicLinkExchange'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<div data-testid="suspense-fallback" />}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<TheCore />} />
              <Route path="/home" element={<TheCore />} />
              <Route path="/recall" element={<Recall />} />
              <Route path="/archives" element={<Archives />} />

              {/* Unified Diagnostic Center */}
              <Route path="/maintenance" element={<DiagnosticCenterLayout />}>
                <Route index element={<Navigate to="/maintenance/health" replace />} />
                <Route path="health" element={<HealthCenter />} />
                <Route path="entities" element={<EntityGraph />} />
                <Route path="index" element={<IndexDiagnostics />} />
                <Route path="index-tree" element={<IndexTreeDiagnostics />} />
              </Route>

              {/* Legacy redirect */}
              <Route path="/entities" element={<Navigate to="/maintenance/entities" replace />} />

              <Route path="/journal/*" element={
                <ErrorBoundary>
                  <JournalDetail />
                </ErrorBoundary>
              } />
              <Route path="/import" element={<ImportWorkflow />} />
              <Route path="/onboarding" element={<EmptyState />} />
              <Route path="/link" element={<PublicLinkExchange />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
