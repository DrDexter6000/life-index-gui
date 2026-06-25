import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { FAB } from './FAB';

describe('FAB', () => {
  const renderWithRouter = (ui: React.ReactElement) => {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
  };

  it('should render FAB with plus icon', () => {
    renderWithRouter(<FAB />);

    const button = screen.getByRole('link');
    expect(button).toBeInTheDocument();

    // Should have plus icon
    expect(screen.getByText('add')).toBeInTheDocument();
  });

  it('should have correct aria-label', () => {
    renderWithRouter(<FAB />);

    const button = screen.getByRole('link');
    expect(button).toHaveAttribute('aria-label', '记录新日志');
  });

  it('should link to / by default', () => {
    renderWithRouter(<FAB />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/');
  });

  it('should accept custom to prop', () => {
    renderWithRouter(<FAB to="/custom-route" />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/custom-route');
  });

  it('should call onClick when clicked', () => {
    const handleClick = vi.fn();
    renderWithRouter(<FAB onClick={handleClick} />);

    const link = screen.getByRole('link');
    fireEvent.click(link);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('should have fixed positioning', () => {
    const { container } = renderWithRouter(<FAB />);

    const link = container.querySelector('a');
    expect(link).toBeInTheDocument();
    expect(link?.classList.contains('fixed')).toBe(true);
  });

  it('should have correct z-index', () => {
    const { container } = renderWithRouter(<FAB />);

    const link = container.querySelector('a');
    expect(link?.classList.contains('z-[90]')).toBe(true);
  });

  describe('Press animation (Round 6)', () => {
    it('should have press animation via motion wrapper', () => {
      const { container } = renderWithRouter(<FAB />);

      // Motion wrapper should be present (motion.div adds data attributes or specific classes)
      const motionWrapper = container.querySelector('[style*="will-change"]');
      expect(motionWrapper).toBeInTheDocument();
    });

    it('should preserve fixed positioning with motion wrapper', () => {
      const { container } = renderWithRouter(<FAB />);

      const link = container.querySelector('a');
      expect(link?.classList.contains('fixed')).toBe(true);
      expect(link?.classList.contains('bottom-20')).toBe(true);
      expect(link?.classList.contains('right-6')).toBe(true);
    });

    it('should have hover glow ring', () => {
      const { container } = renderWithRouter(<FAB />);

      // Look for hover glow ring by its box shadow style (motion.div with glow styling)
      const glowRing = container.querySelector('[style*="boxShadow"]') ||
                       container.querySelector('[style*="box-shadow"]');
      expect(glowRing).toBeInTheDocument();
    });
  });

  describe('Responsive sizing', () => {
    it('should have mobile size classes', () => {
      const { container } = renderWithRouter(<FAB />);

      const buttonDiv = container.querySelector('.w-14');
      expect(buttonDiv).toBeInTheDocument();
    });

    it('should have uniform 56px size (no desktop override)', () => {
      const { container } = renderWithRouter(<FAB />);

      const buttonDiv = container.querySelector('.w-14');
      expect(buttonDiv).toBeInTheDocument();
      // DESIGN spec: FAB is always 56px — no lg:w-16 override
      expect(container.querySelector('.lg\\:w-16')).not.toBeInTheDocument();
    });
  });

  describe('Mobile FAB clearance (Round 8)', () => {
    it('should have increased bottom spacing on mobile to clear BottomNavBar', () => {
      const { container } = renderWithRouter(<FAB />);

      const link = container.querySelector('a');
      // Mobile: bottom-20 (80px) to clear the BottomNavBar
      expect(link?.classList.contains('bottom-20')).toBe(true);
    });

    it('should have standard bottom spacing on desktop', () => {
      const { container } = renderWithRouter(<FAB />);

      const link = container.querySelector('a');
      // Desktop: lg:bottom-10 (40px)
      expect(link?.classList.contains('lg:bottom-10')).toBe(true);
    });

    it('should maintain right positioning on mobile', () => {
      const { container } = renderWithRouter(<FAB />);

      const link = container.querySelector('a');
      expect(link?.classList.contains('right-6')).toBe(true);
    });

    it('should maintain right positioning on desktop', () => {
      const { container } = renderWithRouter(<FAB />);

      const link = container.querySelector('a');
      expect(link?.classList.contains('lg:right-10')).toBe(true);
    });
  });

  describe('Visual styling', () => {
    it('should have transparent background with gold border', () => {
      const { container } = renderWithRouter(<FAB />);

      const buttonDiv = container.querySelector('[style*="border"]') as HTMLElement;
      expect(buttonDiv).toBeInTheDocument();

      const style = buttonDiv?.style;
      // DESIGN spec: transparent ether film with gold border
      expect(style?.background).toBe('transparent');
      expect(style?.border).toContain('rgba(255, 231, 146, 0.4)');
    });

    it('should have gold border', () => {
      const { container } = renderWithRouter(<FAB />);

      const buttonDiv = container.querySelector('[style*="border"]') as HTMLElement;
      expect(buttonDiv).toBeInTheDocument();
      // DESIGN spec: 1px gold border at 0.4 opacity
      expect(buttonDiv?.style.border).toContain('rgba(255, 231, 146, 0.4)');
    });

    it('should have gold icon color', () => {
      const { container } = renderWithRouter(<FAB />);

      const icon = container.querySelector('.material-symbols-outlined');
      const style = (icon as HTMLElement)?.style;
      // DESIGN spec: gold icon on transparent FAB
      expect(style?.color).toBe('var(--color-gold)');
    });
  });
});
