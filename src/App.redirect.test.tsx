import { type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import App from './App';

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
  default: () => <div data-testid="entity-graph-route">EntityGraph</div>,
}));
vi.mock('@/app/routes/IndexDiagnostics', () => ({
  __esModule: true,
  default: () => <div>IndexDiagnostics</div>,
}));
vi.mock('@/app/routes/IndexTreeDiagnostics', () => ({
  __esModule: true,
  default: () => <div>IndexTreeDiagnostics</div>,
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

function renderAppAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('/entities legacy redirect', () => {
  it('redirects /entities to /maintenance/entities', async () => {
    renderAppAt('/entities');

    await waitFor(() => {
      expect(screen.getByTestId('entity-graph-route')).toBeInTheDocument();
    });
  });
});
