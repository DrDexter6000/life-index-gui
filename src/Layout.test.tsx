import React, { Suspense } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { Layout } from './Layout';
import { useUIStore } from '@/stores/ui';

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  },
}));

vi.mock('@/components/layout/TopNavBar', () => ({
  TopNavBar: () => <div data-testid="top-nav">top nav</div>,
}));

vi.mock('@/components/layout/VideoBackground', () => ({
  VideoBackground: () => <div data-testid="video-bg" />,
}));

vi.mock('@/components/layout/GlobalOverlay', () => ({
  GlobalOverlay: () => <div data-testid="global-overlay" />,
}));

vi.mock('@/components/layout/ParticleCanvas', () => ({
  ParticleCanvas: () => <div data-testid="particle-canvas" />,
}));

vi.mock('@/components/celestial/CelestialLoader', () => ({
  PageLoader: () => <div data-testid="route-loader">route loader</div>,
}));

const neverResolvingPromise = new Promise(() => {});

function SuspendedRoute(): React.ReactNode {
  throw neverResolvingPromise;
}

describe('Layout', () => {
  beforeEach(() => {
    useUIStore.getState().setAppPhase('content');
  });

  it('should have a skip-to-content link before VideoBackground', () => {
    render(
      <MemoryRouter initialEntries={['/recall']}>
        <Suspense fallback={<div data-testid="app-fallback">app fallback</div>}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/recall" element={<SuspendedRoute />} />
            </Route>
          </Routes>
        </Suspense>
      </MemoryRouter>
    );

    const skipLink = screen.getByRole('link', { name: /跳到主要内容|skip to content/i });
    expect(skipLink).toBeInTheDocument();
    expect(skipLink).toHaveAttribute('href', '#main-content');
    expect(skipLink.classList.contains('sr-only')).toBe(true);
  });

  it('should have id="main-content" on main element', () => {
    render(
      <MemoryRouter initialEntries={['/recall']}>
        <Suspense fallback={<div data-testid="app-fallback">app fallback</div>}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/recall" element={<SuspendedRoute />} />
            </Route>
          </Routes>
        </Suspense>
      </MemoryRouter>
    );

    const mainElement = document.querySelector('main');
    expect(mainElement).toHaveAttribute('id', 'main-content');
  });

  it('keeps routed content above the decorative background stack', () => {
    render(
      <MemoryRouter initialEntries={['/recall']}>
        <Suspense fallback={<div data-testid="app-fallback">app fallback</div>}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/recall" element={<div data-testid="route-content">route content</div>} />
            </Route>
          </Routes>
        </Suspense>
      </MemoryRouter>
    );

    const mainElement = document.querySelector('main');
    expect(mainElement).toHaveClass('z-10');
  });

  it('keeps the shell mounted when a route suspends and shows a route-local loader', () => {
    render(
      <MemoryRouter initialEntries={['/recall']}>
        <Suspense fallback={<div data-testid="app-fallback">app fallback</div>}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/recall" element={<SuspendedRoute />} />
            </Route>
          </Routes>
        </Suspense>
      </MemoryRouter>
    );

    expect(screen.getByTestId('top-nav')).toBeInTheDocument();
    expect(screen.getByTestId('route-loader')).toBeInTheDocument();
    expect(screen.queryByTestId('app-fallback')).not.toBeInTheDocument();
    expect(screen.getByTestId('video-bg')).toBeInTheDocument();
  });
});
