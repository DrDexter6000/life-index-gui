import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

// Mock all lazy routes — TheCore suspends forever to trigger Suspense fallback
const neverResolving = new Promise(() => {});
vi.mock('@/app/routes/TheCore', () => ({
  default: () => {
    throw neverResolving;
  },
}));
vi.mock('@/app/routes/Recall', () => ({
  default: () => <div data-testid="route-recall">Recall</div>,
}));
vi.mock('@/app/routes/Archives', () => ({
  default: () => <div data-testid="route-archives">Archives</div>,
}));
vi.mock('@/app/routes/JournalDetail', () => ({
  default: () => <div data-testid="route-journal-detail">JournalDetail</div>,
}));
vi.mock('@/app/routes/EmptyState', () => ({
  default: () => <div data-testid="route-empty-state">EmptyState</div>,
}));

// Mock Layout's heavy dependencies to keep test focused
vi.mock('@/components/layout/TopNavBar', () => ({
  TopNavBar: () => <div data-testid="top-nav" />,
}));
vi.mock('@/components/layout/BottomNavBar', () => ({
  BottomNavBar: () => <div data-testid="bottom-nav" />,
}));
vi.mock('@/components/layout/VideoBackground', () => ({
  VideoBackground: () => <div data-testid="video-bg" />,
}));
vi.mock('@/components/layout/ParticleCanvas', () => ({
  ParticleCanvas: () => <div data-testid="particle-canvas" />,
}));
vi.mock('@/components/layout/HeroIntro', () => ({
  HeroIntro: () => null,
}));
vi.mock('@/components/layout/GlobalOverlay', () => ({
  GlobalOverlay: () => null,
}));
vi.mock('@/components/celestial/FAB', () => ({
  FAB: () => null,
}));
vi.mock('@/components/celestial/CelestialLoader', () => ({
  PageLoader: () => <div data-testid="route-loader">loading</div>,
}));

vi.mock('@/stores/ui', () => ({
  useUIStore: vi.fn(() => ({
    appPhase: 'content',
    hasSeenHero: true,
    showHero: vi.fn(),
    hideHero: vi.fn(),
  })),
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    nav: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => <nav {...props}>{children}</nav>,
    button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  },
}));

describe('App Suspense boundary', () => {
  it('shows route-level Suspense fallback while lazy route chunks are loading', () => {
    render(<App />);
    // Route-level suspension is caught by AnimatedOutlet's inner Suspense (PageLoader),
    // NOT by the App-level Suspense — this keeps the Layout shell mounted
    expect(screen.getByTestId('route-loader')).toBeInTheDocument();
    expect(screen.queryByTestId('suspense-fallback')).not.toBeInTheDocument();
  });
});
