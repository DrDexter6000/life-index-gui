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
  agentBridgeProbe: {
    data: null as Record<string, unknown> | null,
    isLoading: false,
    isError: false,
    error: null as Error | null,
  },
  agentBridgeHealth: {
    data: { running: true, degraded: false } as Record<string, unknown> | null,
    isLoading: false,
    isError: false,
    error: null as Error | null,
  },
}));

vi.mock('@/hooks/useAgentBridge', () => ({
  useAgentBridgeProbe: () => mocks.agentBridgeProbe,
  useAgentBridgeHealth: () => mocks.agentBridgeHealth,
}));

const readyProbeData = {
  success: true,
  sends_journal_evidence: false,
  ready_to_send_evidence: true,
  ack: { data_exposure_ack: true, required_for: ['P1', 'P2'] },
  checks: [{ name: 'models', status: 'pass', model_ids: ['hermes-agent'] }],
};

describe('TopNavBar', () => {
  const cssSource = fs.readFileSync(path.resolve(__dirname, '../../styles/tailwind.css'), 'utf8');

  beforeEach(() => {
    useUIStore.getState().setAppPhase('content');
    useUIStore.getState().setHomeActivated(false);
    mocks.agentBridgeProbe.data = null;
    mocks.agentBridgeProbe.isLoading = false;
    mocks.agentBridgeProbe.isError = false;
    mocks.agentBridgeProbe.error = null;
    mocks.agentBridgeHealth.data = { running: true, degraded: false };
    mocks.agentBridgeHealth.isLoading = false;
    mocks.agentBridgeHealth.isError = false;
    mocks.agentBridgeHealth.error = null;
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
    mocks.agentBridgeProbe.data = {
      ...readyProbeData,
      ready_to_send_evidence: false,
      ack: { data_exposure_ack: false, required_for: ['P1', 'P2'] },
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
    it('shows amber dot when gateway is warm but all AI+ features are frozen', () => {
      mocks.agentBridgeProbe.data = readyProbeData;
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <TopNavBar />
        </MemoryRouter>,
      );

      const dot = container.querySelector('[data-testid="smart-capability-status"] span');
      expect(dot).toBeInTheDocument();
      expect(dot?.getAttribute('style')).toContain('var(--color-amber)');
    });

    it('shows green dot when at least one AI+ feature is enabled and gateway is warm', () => {
      AI_PLUS_FEATURE_ENABLES.groundedQuery = true;
      mocks.agentBridgeProbe.data = readyProbeData;
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <TopNavBar />
        </MemoryRouter>,
      );

      const dot = container.querySelector('[data-testid="smart-capability-status"] span');
      expect(dot).toBeInTheDocument();
      expect(dot?.getAttribute('style')).toContain('var(--color-green)');
    });

    it('shows amber dot when probe is loading', () => {
      mocks.agentBridgeProbe.isLoading = true;
      mocks.agentBridgeProbe.data = null;
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <TopNavBar />
        </MemoryRouter>,
      );

      const dot = container.querySelector('[data-testid="smart-capability-status"] span');
      expect(dot).toBeInTheDocument();
      expect(dot?.getAttribute('style')).toContain('var(--color-amber)');
    });

    it('shows amber dot when probe errors', () => {
      mocks.agentBridgeProbe.isError = true;
      mocks.agentBridgeProbe.error = new Error('probe failed');
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <TopNavBar />
        </MemoryRouter>,
      );

      const dot = container.querySelector('[data-testid="smart-capability-status"] span');
      expect(dot).toBeInTheDocument();
      expect(dot?.getAttribute('style')).toContain('var(--color-amber)');
    });

    it('shows amber dot when no probe data exists', () => {
      mocks.agentBridgeProbe.data = null;
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <TopNavBar />
        </MemoryRouter>,
      );

      const dot = container.querySelector('[data-testid="smart-capability-status"] span');
      expect(dot).toBeInTheDocument();
      expect(dot?.getAttribute('style')).toContain('var(--color-amber)');
    });

    it('shows amber dot when ack is required', () => {
      mocks.agentBridgeProbe.data = {
        ...readyProbeData,
        ready_to_send_evidence: false,
        ack: { data_exposure_ack: false, required_for: ['P1', 'P2'] },
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

    it('ignores retired model checks when gateway health is warm', () => {
      AI_PLUS_FEATURE_ENABLES.groundedQuery = true;
      mocks.agentBridgeProbe.data = {
        ...readyProbeData,
        ready_to_send_evidence: false,
        checks: [{ name: 'models', status: 'fail', model_ids: ['hermes-agent'] }],
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

    it('shows amber dot when gateway health is down', () => {
      AI_PLUS_FEATURE_ENABLES.groundedQuery = true;
      mocks.agentBridgeProbe.data = readyProbeData;
      mocks.agentBridgeHealth.data = { running: false, degraded: false };
      const { container } = render(
        <MemoryRouter initialEntries={['/home']}>
          <TopNavBar />
        </MemoryRouter>,
      );

      const dot = container.querySelector('[data-testid="smart-capability-status"] span');
      expect(dot).toBeInTheDocument();
      expect(dot?.getAttribute('style')).toContain('var(--color-amber)');
    });

    it('ignores unknown probe checks when gateway health is warm', () => {
      AI_PLUS_FEATURE_ENABLES.groundedQuery = true;
      mocks.agentBridgeProbe.data = {
        ...readyProbeData,
        ready_to_send_evidence: false,
        checks: [{ name: 'custom', status: 'fail', error: 'raw diagnostic' }],
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
  });

  describe('no endpoint / model / token leak', () => {
    it('never renders endpoint URLs, model names, or token sources', () => {
      mocks.agentBridgeProbe.data = {
        ...readyProbeData,
        endpoint: { configured: true, url: 'http://127.0.0.1:8642/v1' },
        model: { configured: true, name: 'hermes-agent' },
        token: { configured: true, source: 'env:LIFE_INDEX_LLM_API_KEY', persisted_in_config: false },
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

    it('never renders raw error text from failed checks', () => {
      mocks.agentBridgeProbe.data = {
        ...readyProbeData,
        ready_to_send_evidence: false,
        checks: [{ name: 'models', status: 'fail', error: 'Connection refused to http://127.0.0.1:8642/v1' }],
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
