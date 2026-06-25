import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SkeletonCard, SkeletonStatsCard, SkeletonBentoGrid, SkeletonJournalGrid } from './SkeletonCard';

describe('SkeletonCard', () => {
  it('should render with default props', () => {
    render(<SkeletonCard />);

    // Should render the skeleton container
    const container = document.querySelector('[class*="rounded-[24px]"]');
    expect(container).toBeInTheDocument();
  });

  it('should render with custom className', () => {
    render(<SkeletonCard className="custom-class" />);

    const container = document.querySelector('.custom-class');
    expect(container).toBeInTheDocument();
  });

  it('should render without header when showHeader is false', () => {
    const { container } = render(<SkeletonCard showHeader={false} />);

    // Should still render the skeleton but without header elements
    expect(container.firstChild).toBeInTheDocument();
  });

  it('should render without footer when showFooter is false', () => {
    const { container } = render(<SkeletonCard showFooter={false} />);

    // Should still render the skeleton but without footer elements
    expect(container.firstChild).toBeInTheDocument();
  });

  it('should render shimmer overlay with motion animation', () => {
    render(<SkeletonCard />);

    // Shimmer overlay should be present
    const shimmer = document.querySelector('[class*="pointer-events-none"]');
    expect(shimmer).toBeInTheDocument();
  });
});

describe('SkeletonStatsCard', () => {
  it('should render stats card skeleton', () => {
    render(<SkeletonStatsCard />);

    // Should render the container
    const container = document.querySelector('[class*="rounded-[24px]"]');
    expect(container).toBeInTheDocument();
  });

  it('should render with delay prop', () => {
    const { container } = render(<SkeletonStatsCard delay={0.2} />);
    expect(container.firstChild).toBeInTheDocument();
  });
});

describe('SkeletonBentoGrid', () => {
  it('should render grid with 4 skeleton stats cards', () => {
    render(<SkeletonBentoGrid />);

    // Should render a grid container
    const grid = document.querySelector('.grid');
    expect(grid).toBeInTheDocument();

    // Should have grid-cols-2 class
    expect(grid?.classList.contains('grid-cols-2')).toBe(true);
  });
});

describe('SkeletonJournalGrid', () => {
  it('should render grid with default 4 skeleton cards', () => {
    render(<SkeletonJournalGrid />);

    // Should render a grid container
    const grid = document.querySelector('.grid');
    expect(grid).toBeInTheDocument();
  });

  it('should render with custom count', () => {
    const { container } = render(<SkeletonJournalGrid count={2} />);

    // Should render grid container
    expect(container.firstChild).toBeInTheDocument();
  });
});
