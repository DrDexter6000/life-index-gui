import { type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import App from './App';

const IndexTreeDiagnosticsMock = () => (
  <div data-testid="index-tree-diagnostics-route-mock">Index Tree Diagnostics Route</div>
);

const HostAgentGuideMock = () => (
  <div data-testid="host-agent-guide-route-mock">Host Agent Guide Route</div>
);

vi.mock('@/app/routes/IndexTreeDiagnostics', () => ({
  __esModule: true,
  default: IndexTreeDiagnosticsMock,
}));

vi.mock('@/app/routes/HostAgentGuide', () => ({
  __esModule: true,
  default: HostAgentGuideMock,
}));

vi.mock('@/app/routes/Recall', () => ({
  __esModule: true,
  default: () => <div>Recall</div>,
}));
vi.mock('@/app/routes/Archives', () => ({
  __esModule: true,
  default: () => <div>Archives</div>,
}));
vi.mock('@/app/routes/JournalDetail', () => ({
  __esModule: true,
  default: () => <div>JournalDetail</div>,
}));
vi.mock('@/app/routes/EmptyState', () => ({
  __esModule: true,
  default: () => <div>EmptyState</div>,
}));
vi.mock('@/app/routes/HealthCenter', () => ({
  __esModule: true,
  default: () => <div>HealthCenter</div>,
}));
vi.mock('@/app/routes/EntityGraph', () => ({
  __esModule: true,
  default: () => <div>EntityGraph</div>,
}));
vi.mock('@/app/routes/EntityProfile', () => ({
  __esModule: true,
  default: () => <div>EntityProfile</div>,
}));
vi.mock('@/app/routes/IndexDiagnostics', () => ({
  __esModule: true,
  default: () => <div>IndexDiagnostics</div>,
}));
vi.mock('@/app/routes/ImportWorkflow', () => ({
  __esModule: true,
  default: () => <div>ImportWorkflow</div>,
}));

vi.mock('@/components/maintenance/DiagnosticCenterLayout', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    __esModule: true,
    default: () => <actual.Outlet />,
  };
});

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    BrowserRouter: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

function renderAppAtRoute(route: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('/maintenance/index-tree route registration', () => {
  it('renders the IndexTreeDiagnostics component at /maintenance/index-tree', async () => {
    renderAppAtRoute('/maintenance/index-tree');

    await waitFor(() => {
      expect(screen.getByTestId('index-tree-diagnostics-route-mock')).toBeInTheDocument();
    });
  });
});

describe('/maintenance/host-agent route registration', () => {
  it('renders the host-agent connection guide at /maintenance/host-agent', async () => {
    renderAppAtRoute('/maintenance/host-agent');

    await waitFor(() => {
      expect(screen.getByTestId('host-agent-guide-route-mock')).toBeInTheDocument();
    });
  });
});
