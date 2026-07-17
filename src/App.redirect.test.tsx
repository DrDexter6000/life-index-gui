import type { ReactElement } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import App, { appRoutes } from './App';

const NativeRequest = globalThis.Request;
if (NativeRequest) {
  vi.stubGlobal('Request', class TestRequest extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, init ? { ...init, signal: undefined } : undefined);
    }
  });
}

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
vi.mock('@/app/routes/HostAgentGuide', () => ({
  __esModule: true,
  default: () => <div>HostAgentGuide</div>,
}));
vi.mock('@/app/routes/EntityGraph', () => ({
  __esModule: true,
  default: () => <div data-testid="entity-graph-route">EntityGraph</div>,
}));
vi.mock('@/app/routes/EntityProfile', () => ({
  __esModule: true,
  default: () => <div data-testid="entity-profile-route">EntityProfile</div>,
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
vi.mock('@/app/routes/PublicLinkExchange', () => ({
  __esModule: true,
  default: () => <div>PublicLinkExchange</div>,
}));

vi.mock('@/components/maintenance/DiagnosticCenterLayout', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    __esModule: true,
    default: () => <actual.Outlet />,
  };
});

function renderAppAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(
    <App router={router} />,
  );
}

describe('/entities legacy redirect', () => {
  it('redirects /entities to /maintenance/entities', async () => {
    renderAppAt('/entities');

    await waitFor(
      () => {
        expect(screen.getByTestId('entity-graph-route')).toBeInTheDocument();
      },
      { timeout: 5_000 },
    );
  });

  it('keeps /entities/:entityId available for entity profiles', async () => {
    renderAppAt('/entities/actor-alice');

    await waitFor(
      () => {
        expect(screen.getByTestId('entity-profile-route')).toBeInTheDocument();
      },
      { timeout: 5_000 },
    );
  });
});

describe('/maintenance index redirect', () => {
  it('redirects /maintenance to /maintenance/health', async () => {
    renderAppAt('/maintenance');

    await waitFor(() => {
      expect(screen.getByText('HealthCenter')).toBeInTheDocument();
    });
  });
});

describe('data-router route inventory', () => {
  it('preserves every existing route path and redirect target', () => {
    const layout = appRoutes[0];
    const children = layout.children ?? [];
    const paths = children.map((route) => route.path).filter(Boolean);
    expect(paths).toEqual(expect.arrayContaining([
      '/', '/home', '/recall', '/archives', '/maintenance', '/entities',
      '/entities/:entityId', '/journal/*', '/import', '/onboarding', '/link',
    ]));

    const maintenance = children.find((route) => route.path === '/maintenance');
    expect(maintenance?.children?.map((route) => route.path)).toEqual([
      undefined, 'health', 'host-agent', 'entities', 'index', 'index-tree',
    ]);
    const maintenanceRedirect = maintenance?.children?.[0]?.element as ReactElement<{ to: string; replace?: boolean }>;
    expect(maintenanceRedirect.props.to).toBe('/maintenance/health');
    expect(maintenanceRedirect.props.replace).toBe(true);
    const entitiesRedirect = children.find((route) => route.path === '/entities')?.element as ReactElement<{ to: string; replace?: boolean }>;
    expect(entitiesRedirect.props.to).toBe('/maintenance/entities');
    expect(entitiesRedirect.props.replace).toBe(true);
  });
});
