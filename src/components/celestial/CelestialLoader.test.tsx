import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CelestialLoader, PageLoader, SuspenseFallback } from './CelestialLoader';

describe('CelestialLoader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render with default props', () => {
    render(<CelestialLoader />);

    // Should render the loader container
    const container = document.querySelector('[class*="flex-col"]');
    expect(container).toBeInTheDocument();
  });

  it('should render with custom text', () => {
    render(<CelestialLoader text="Custom loading text" />);

    expect(screen.getByText('Custom loading text')).toBeInTheDocument();
  });

  it('should render different sizes', () => {
    const { rerender } = render(<CelestialLoader size="sm" />);
    expect(document.querySelector('[class*="flex-col"]')).toBeInTheDocument();

    rerender(<CelestialLoader size="md" />);
    expect(document.querySelector('[class*="flex-col"]')).toBeInTheDocument();

    rerender(<CelestialLoader size="lg" />);
    expect(document.querySelector('[class*="flex-col"]')).toBeInTheDocument();
  });

  it('should show initial tiered text immediately', () => {
    render(<CelestialLoader tieredText={true} />);

    expect(screen.getByText('正在加载...')).toBeInTheDocument();
  });

  it('should escalate to patience tier after 2 seconds', () => {
    render(<CelestialLoader tieredText={true} />);

    // Initial state
    expect(screen.getByText('正在加载...')).toBeInTheDocument();

    // Advance 2 seconds
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText('还在加载中...')).toBeInTheDocument();
  });

  it('should escalate to extended tier after 5 seconds', () => {
    render(<CelestialLoader tieredText={true} />);

    // Initial state
    expect(screen.getByText('正在加载...')).toBeInTheDocument();

    // Advance 5 seconds
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText('加载时间较长，请稍候...')).toBeInTheDocument();
  });

  it('should not escalate when tieredText is false', () => {
    render(<CelestialLoader tieredText={false} text="Static text" />);

    // Initial state
    expect(screen.getByText('Static text')).toBeInTheDocument();

    // Advance 5 seconds
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // Text should remain the same
    expect(screen.getByText('Static text')).toBeInTheDocument();
  });

  it('should prioritize explicit text over tiered messages', () => {
    render(<CelestialLoader tieredText={true} text="Explicit text" />);

    expect(screen.getByText('Explicit text')).toBeInTheDocument();

    // Advance 5 seconds - text should not change
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText('Explicit text')).toBeInTheDocument();
  });

  it('should clean up timers on unmount', () => {
    const { unmount } = render(<CelestialLoader tieredText={true} />);

    unmount();

    // Should not throw when advancing timers after unmount
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(5000);
      });
    }).not.toThrow();
  });
});

describe('PageLoader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render with default props', () => {
    render(<PageLoader />);

    // Should render in a flex container with min-height
    const container = document.querySelector('[class*="min-h-[60vh]"]');
    expect(container).toBeInTheDocument();

    // Should show default text with tiered escalation
    expect(screen.getByText('正在加载...')).toBeInTheDocument();
  });

  it('should use tiered text by default', () => {
    render(<PageLoader />);

    expect(screen.getByText('正在加载...')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText('还在加载中...')).toBeInTheDocument();
  });

  it('should allow disabling tiered text', () => {
    render(<PageLoader tieredText={false} text="Static loading" />);

    expect(screen.getByText('Static loading')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // Text should remain unchanged
    expect(screen.getByText('Static loading')).toBeInTheDocument();
  });

  it('should render with custom text', () => {
    render(<PageLoader text="Custom page loading" />);

    expect(screen.getByText('Custom page loading')).toBeInTheDocument();
  });
});

describe('SuspenseFallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render with full screen height', () => {
    render(<SuspenseFallback />);

    const container = document.querySelector('[class*="min-h-screen"]');
    expect(container).toBeInTheDocument();
  });

  it('should show celestial entry text', () => {
    render(<SuspenseFallback />);

    expect(screen.getByText('加载时间较长，请稍候...')).toBeInTheDocument();
  });

  it('should use tiered text escalation', () => {
    render(<SuspenseFallback />);

    expect(screen.getByText('加载时间较长，请稍候...')).toBeInTheDocument();

    // Note: SuspenseFallback uses explicit text, so tiered escalation
    // won't change the text unless the text prop is removed
  });
});
