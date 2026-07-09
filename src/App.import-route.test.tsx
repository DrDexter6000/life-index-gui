import { type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import App from './App';

// Mock the lazy-loaded ImportWorkflow so we can verify route registration
// without needing the real component to exist during RED phase.
const ImportWorkflowMock = () => (
  <div data-testid="import-workflow-route-mock">Import Workflow Route</div>
);

vi.mock('@/app/routes/ImportWorkflow', () => ({
  __esModule: true,
  default: ImportWorkflowMock,
}));

// Mock other lazy-loaded routes to avoid unnecessary loading
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

// Replace BrowserRouter in App with a passthrough so MemoryRouter is the
// only real router — avoids the "nested Router" error.
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    BrowserRouter: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

function renderAppAtImport() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/import']}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('/import route registration', () => {
  it('renders the ImportWorkflow component at /import', async () => {
    renderAppAtImport();

    await waitFor(() => {
      expect(
        screen.getByTestId('import-workflow-route-mock'),
      ).toBeInTheDocument();
    });
  });
});
