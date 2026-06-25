import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { TopNavBar } from './TopNavBar';
import { useUIStore } from '@/stores/ui';
import { AI_PLUS_FEATURE_ENABLES } from '@/lib/health-status';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname}</div>;
}

const mocks = vi.hoisted(() => ({
  hostAgentHealth: {
    data: {
      schema_version: 'gui.host_agent.health.v1',
      running: true,
      ready: true,
      degraded: false,
      reason: 'ready',
      runtime: { kind: 'external-host-agent', interface_version: 'v1' },
      checks: [],
    } as Record<string, unknown> | null,
    isLoading: false,
    isError: false,
    error: null as Error | null,
  },
}));

vi.mock('@/hooks/useHostAgent', () => ({
  useHostAgentHealth: () => mocks.hostAgentHealth,
}));

const readyHostAgentHealth = {
  schema_version: 'gui.host_agent.health.v1',
  running: true,
  ready: true,
  degraded: false,
  reason: 'ready',
  runtime: { kind: 'external-host-agent', interface_version: 'v1' },
  checks: [],
};

describe('TopNavBar', () => {
  const cssSource = fs.readFileSync(path.resolve(__dirname, '../../styles/tailwind.css'), 'utf8');

  beforeEach(() => {
    useUIStore.getState().setAppPhase('content');
    useUIStore.getState().setHomeActivated(false);
    mocks.hostAgentHealth.data = readyHostAgentHealth;
    mocks.hostAgentHealth.isLoading = false;
    mocks.hostAgentHealth.isError = false;
    mocks.hostAgentHealth.error = null;
    AI_PLUS_FEATURE_ENABLES.groundedQuery = false;
    AI_PLUS_FEATURE_ENABLES.smartMetadata = false;
  });

  afterEach(() => {
    AI_PLUS_FEATURE_ENABLES.groundedQuery = false;
    AI_PLUS_FEATURE_ENABLES.smartMetadata = false;
  });

  it('uses the compact navigation logo token instead of the display logo token', () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <TopNavBar />
      </MemoryRouter>,
    );

    const brandLink = screen.getByRole('link', { name: /Life Index/i });
    const brandText = brandLink.querySelector('span');

    expect(brandText?.className).toContain('text-[var(--text-nav-logo)]');
    expect(brandText?.className).not.toContain('text-[var(--text-logo)]');
  });

  it('uses mobile brand hooks so the nav mark can be scaled and centered against the menu button', () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <TopNavBar />
      </MemoryRouter>,
    );

    const brandLink = screen.getByRole('link', { name: /Life Index/i });
    const menuButton = screen.getByRole('button', { name: /切换菜单|toggle menu/i });

    expect(brandLink).toHaveClass('top-nav-brand');
    expect(brandLink.querySelector('.top-nav-brand-orb')).toBeInTheDocument();
    expect(brandLink.querySelector('.top-nav-brand-text')).toBeInTheDocument();
    expect(menuButton).toHaveClass('top-nav-mobile-toggle');
  });

  it('defines compact mobile nav and page-title rhythm tokens', () => {
    expect(cssSource).toContain('--text-nav-logo-mobile: 0.72rem');
    expect(cssSource).toContain('--layout-nav-clearance-mobile: 4rem');
    expect(cssSource).toContain('--layout-page-top-mobile: clamp(0.75rem, 2dvh, 1.25rem)');
    expect(cssSource).toContain('@media (max-width: 640px)');
    expect(cssSource).toContain('.top-nav-brand-orb');
    expect(cssSource).toContain('transform: translateY(2px)');
    expect(cssSource).toContain('--li-page-top: var(--layout-page-top-mobile)');
  });

  it('activates the write surface when clicking Write from the hero route', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <TopNavBar />
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('link', { name: /写入/i }));

    await waitFor(() => {
      expect(screen.getByTestId('current-path')).toHaveTextContent('/home');
    });
    expect(useUIStore.getState().homeActivated).toBe(true);
  });

  it('marks Write active on the hero route', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <TopNavBar />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /写入/i }).className).toContain('text-[var(--color-gold)]');
  });

  it('returns to the hero surface when clicking the brand from another route', async () => {
    useUIStore.getState().setHomeActivated(true);
    useUIStore.getState().setAppPhase('hero');

    render(
      <MemoryRouter initialEntries={['/recall']}>
        <TopNavBar />
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('link', { name: /Life Index/i }));

    await waitFor(() => {
      expect(screen.getByTestId('current-path')).toHaveTextContent('/');
    });
    expect(useUIStore.getState().homeActivated).toBe(false);
    expect(useUIStore.getState().appPhase).toBe('content');
  });

  it('shows the AI+ agent capsule at all times in desktop nav', () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <TopNavBar />
      </MemoryRouter>,
    );

    const indicator = screen.getByTestId('smart-capability-status');
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveAttribute('href', '/maintenance');
    expect(indicator.textContent).toContain('AI+');
  });

  it('always shows cyan capsule style regardless of connection state', () => {
    mocks.hostAgentHealth.data = {
      ...readyHostAgentHealth,
      ready: false,
      reason: 'host-agent-not-ready',
    };

    render(
      <MemoryRouter initialEntries={['/home']}>
        <TopNavBar />
      </MemoryRouter>,
    );

    const indicator = screen.getByTestId('smart-capability-status');
    expect(indicator.className).toContain('text-[var(--color-cyan)]');
    expect(indicator.className).toContain('border-[var(--color-cyan)]/20');
  });

  describe('Host Agent readiness dot', () => {
    it('shows amber dot when host-agent health is ready but all AI+ features are frozen', () => {
      mocks.hostAgentHealth.data = readyHostAgentHealth;
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <TopNavBar />
        </MemoryRouter>,
      );

      const dot = container.querySelector('[data-testid="smart-capability-status"] span');
      expect(dot).toBeInTheDocument();
      expect(dot?.getAttribute('style')).toContain('var(--color-amber)');
    });

    it('shows green dot when at least one AI+ feature is enabled and host-agent health is ready', () => {
      AI_PLUS_FEATURE_ENABLES.groundedQuery = true;
      mocks.hostAgentHealth.data = readyHostAgentHealth;
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <TopNavBar />
        </MemoryRouter>,
      );

      const dot = container.querySelector('[data-testid="smart-capability-status"] span');
      expect(dot).toBeInTheDocument();
      expect(dot?.getAttribute('style')).toContain('var(--color-green)');
    });

    it('shows amber dot when host-agent health is loading', () => {
      mocks.hostAgentHealth.isLoading = true;
      mocks.hostAgentHealth.data = null;
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <TopNavBar />
        </MemoryRouter>,
      );

      const dot = container.querySelector('[data-testid="smart-capability-status"] span');
      expect(dot).toBeInTheDocument();
      expect(dot?.getAttribute('style')).toContain('var(--color-amber)');
    });

    it('shows amber dot when host-agent health errors', () => {
      mocks.hostAgentHealth.isError = true;
      mocks.hostAgentHealth.error = new Error('health failed');
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <TopNavBar />
        </MemoryRouter>,
      );

      const dot = container.querySelector('[data-testid="smart-capability-status"] span');
      expect(dot).toBeInTheDocument();
      expect(dot?.getAttribute('style')).toContain('var(--color-amber)');
    });

    it('shows amber dot when no host-agent health data exists', () => {
      mocks.hostAgentHealth.data = null;
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <TopNavBar />
        </MemoryRouter>,
      );

      const dot = container.querySelector('[data-testid="smart-capability-status"] span');
      expect(dot).toBeInTheDocument();
      expect(dot?.getAttribute('style')).toContain('var(--color-amber)');
    });

    it('shows amber dot when host-agent health is not ready', () => {
      mocks.hostAgentHealth.data = {
        ...readyHostAgentHealth,
        ready: false,
        reason: 'host-agent-unconfigured',
      };
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <TopNavBar />
        </MemoryRouter>,
      );

      const dot = container.querySelector('[data-testid="smart-capability-status"] span');
      expect(dot).toBeInTheDocument();
      expect(dot?.getAttribute('style')).toContain('var(--color-amber)');
    });

    it('ignores non-gating host-agent health details when health is ready', () => {
      AI_PLUS_FEATURE_ENABLES.groundedQuery = true;
      mocks.hostAgentHealth.data = {
        ...readyHostAgentHealth,
        checks: [{ name: 'runtime-note', status: 'warn', detail: 'diagnostic only' }],
      };
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <TopNavBar />
        </MemoryRouter>,
      );

      const dot = container.querySelector('[data-testid="smart-capability-status"] span');
      expect(dot).toBeInTheDocument();
      expect(dot?.getAttribute('style')).toContain('var(--color-green)');
    });

    it('shows amber dot when host-agent health is down', () => {
      AI_PLUS_FEATURE_ENABLES.groundedQuery = true;
      mocks.hostAgentHealth.data = {
        ...readyHostAgentHealth,
        running: false,
        ready: false,
        reason: 'host-agent-unconfigured',
      };
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <TopNavBar />
        </MemoryRouter>,
      );

      const dot = container.querySelector('[data-testid="smart-capability-status"] span');
      expect(dot).toBeInTheDocument();
      expect(dot?.getAttribute('style')).toContain('var(--color-amber)');
    });

    it('shows amber dot when host-agent health is degraded', () => {
      AI_PLUS_FEATURE_ENABLES.groundedQuery = true;
      mocks.hostAgentHealth.data = {
        ...readyHostAgentHealth,
        ready: true,
        degraded: true,
        reason: 'host-agent-degraded',
      };
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <TopNavBar />
        </MemoryRouter>,
      );

      const dot = container.querySelector('[data-testid="smart-capability-status"] span');
      expect(dot).toBeInTheDocument();
      expect(dot?.getAttribute('style')).toContain('var(--color-amber)');
    });
  });

  describe('no endpoint / model / token leak', () => {
    it('never renders host-agent runtime URLs, model names, or token sources', () => {
      mocks.hostAgentHealth.data = {
        ...readyHostAgentHealth,
        runtime: {
          kind: 'external-host-agent',
          endpoint: 'http://127.0.0.1:8642/v1',
          model: 'hermes-agent',
          token_source: 'env:LIFE_INDEX_LLM_API_KEY',
        },
      };
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <TopNavBar />
        </MemoryRouter>,
      );

      expect(container.textContent).not.toContain('http://127.0.0.1:8642');
      expect(container.textContent).not.toContain('hermes-agent');
      expect(container.textContent).not.toContain('env:LIFE_INDEX_LLM_API_KEY');
    });

    it('never renders raw host-agent health diagnostic text', () => {
      mocks.hostAgentHealth.data = {
        ...readyHostAgentHealth,
        ready: false,
        reason: 'host-agent-runtime-failed',
        checks: [{ name: 'runtime', status: 'fail', error: 'Connection refused to http://127.0.0.1:8642/v1' }],
      };
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <TopNavBar />
        </MemoryRouter>,
      );

      expect(container.textContent).not.toContain('Connection refused');
      expect(container.textContent).not.toContain('http://127.0.0.1:8642');
    });
  });
});
