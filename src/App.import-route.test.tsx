import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import App, { appRoutes } from './App';

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
vi.mock('@/app/routes/TheCore', () => ({
  __esModule: true,
  default: () => <div>TheCore</div>,
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
vi.mock('@/app/routes/PublicLinkExchange', () => ({
  __esModule: true,
  default: () => <div>PublicLinkExchange</div>,
}));

function renderAppAtImport() {
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/import'] });
  return render(
    <App router={router} />,
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
