import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DiagnosticCenterLayout from './DiagnosticCenterLayout';

const mockInvalidateQueries = vi.fn();

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
    }),
  };
});

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        diagnosticCenter: '诊断中心',
        diagnosticCenterSubtitle: '全局健康一目了然，下钻诊断与维护。',
        diagnosticNavHealth: '健康状态',
        diagnosticNavEntities: '实体图谱',
        diagnosticNavIndex: '索引诊断',
        diagnosticNavIndexTree: '索引树',
        healthRetry: '重新检查',
      };
      return map[key] ?? key;
    },
  }),
}));

function renderLayout(initialEntry = '/maintenance/health') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/maintenance" element={<DiagnosticCenterLayout />}>
            <Route path="health" element={<div data-testid="health-page">Health</div>} />
            <Route path="entities" element={<div data-testid="entities-page">Entities</div>} />
            <Route path="index" element={<div data-testid="index-page">Index</div>} />
            <Route path="index-tree" element={<div data-testid="index-tree-page">IndexTree</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DiagnosticCenterLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the diagnostic center title and subtitle', () => {
    renderLayout();
    expect(screen.getByText('诊断中心')).toBeInTheDocument();
    expect(screen.getByText('全局健康一目了然，下钻诊断与维护。')).toBeInTheDocument();
  });

  it('renders sub-navigation with four items', () => {
    renderLayout();
    expect(screen.getByText('健康状态')).toBeInTheDocument();
    expect(screen.getByText('实体图谱')).toBeInTheDocument();
    expect(screen.getByText('索引诊断')).toBeInTheDocument();
    expect(screen.getByText('索引树')).toBeInTheDocument();
  });

  it('highlights the active nav item in gold', () => {
    renderLayout('/maintenance/entities');
    const entitiesNav = screen.getByTestId('diagnostic-nav-diagnosticNavEntities');
    expect(entitiesNav.className).toContain('border-');
    expect(entitiesNav.className).toContain('text-');
  });

  it('refreshes all diagnostic queries when refresh is clicked', () => {
    renderLayout();
    const refreshBtn = screen.getByTestId('diagnostic-refresh-button');
    fireEvent.click(refreshBtn);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['health'] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['index-diagnostics'] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['entities'] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['index-tree'] });
  });

  it('renders child route content through Outlet', () => {
    renderLayout('/maintenance/index-tree');
    expect(screen.getByTestId('index-tree-page')).toBeInTheDocument();
  });
});
