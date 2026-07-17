import { lazy, Suspense } from 'react';
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  type RouteObject,
} from 'react-router';
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
const HostAgentGuide = lazy(() => import('@/app/routes/HostAgentGuide'));
const EntityGraph = lazy(() => import('@/app/routes/EntityGraph'));
const EntityProfile = lazy(() => import('@/app/routes/EntityProfile'));
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

export const appRoutes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <TheCore /> },
      { path: '/home', element: <TheCore /> },
      { path: '/recall', element: <Recall /> },
      { path: '/archives', element: <Archives /> },

      // Unified Diagnostic Center
      {
        path: '/maintenance',
        element: <DiagnosticCenterLayout />,
        children: [
          { index: true, element: <Navigate to="/maintenance/health" replace /> },
          { path: 'health', element: <HealthCenter /> },
          { path: 'host-agent', element: <HostAgentGuide /> },
          { path: 'entities', element: <EntityGraph /> },
          { path: 'index', element: <IndexDiagnostics /> },
          { path: 'index-tree', element: <IndexTreeDiagnostics /> },
        ],
      },

      // Legacy redirect
      { path: '/entities', element: <Navigate to="/maintenance/entities" replace /> },
      { path: '/entities/:entityId', element: <EntityProfile /> },

      {
        path: '/journal/*',
        element: (
          <ErrorBoundary>
            <JournalDetail />
          </ErrorBoundary>
        ),
      },
      { path: '/import', element: <ImportWorkflow /> },
      { path: '/onboarding', element: <EmptyState /> },
      { path: '/link', element: <PublicLinkExchange /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}

const browserRouter = createAppRouter();
type AppRouter = ReturnType<typeof createAppRouter>;

export default function App({ router = browserRouter }: { router?: AppRouter } = {}) {
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<div data-testid="suspense-fallback" />}>
        <RouterProvider router={router} />
      </Suspense>
    </QueryClientProvider>
  );
}
