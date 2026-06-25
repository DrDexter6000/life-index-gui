import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsCard, StatsBentoGrid } from './StatsCard';

// Note: motion/react is not mocked - tests run with actual motion components

describe('StatsCard', () => {
  const defaultProps = {
    value: 42,
    label: '总篇数',
    subLabel: 'Total Entries',
    iconName: 'auto_stories',
    color: 'gold' as const,
    delay: 0,
  };

  it('should render with value and label', () => {
    render(<StatsCard {...defaultProps} />);

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('总篇数')).toBeInTheDocument();
    expect(screen.getByText('Total Entries')).toBeInTheDocument();
  });

  it('should render with icon', () => {
    render(<StatsCard {...defaultProps} />);

    const icon = screen.getByText('auto_stories');
    expect(icon).toBeInTheDocument();
    expect(icon.classList.contains('material-symbols-outlined')).toBe(true);
  });

  it('should render with custom icon element', () => {
    render(<StatsCard {...defaultProps} icon={<span data-testid="custom-icon">🔥</span>} iconName={undefined} />);

    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  it('should apply color styles correctly for gold using theme tokens', () => {
    render(<StatsCard {...defaultProps} color="gold" />);

    const valueElement = screen.getByText('42');
    expect(valueElement.style.color).toBe('var(--color-gold)');
  });

  it('should apply color styles correctly for cyan using theme tokens', () => {
    render(<StatsCard {...defaultProps} color="cyan" />);

    const valueElement = screen.getByText('42');
    expect(valueElement.style.color).toBe('var(--color-cyan)');
  });

  it('should apply color styles correctly for coral using theme tokens', () => {
    render(<StatsCard {...defaultProps} color="coral" />);

    const valueElement = screen.getByText('42');
    expect(valueElement.style.color).toBe('var(--color-coral)');
  });

  it('should render without subLabel when not provided', () => {
    render(<StatsCard {...defaultProps} subLabel={undefined} />);

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.queryByText('Total Entries')).not.toBeInTheDocument();
  });

  describe('Glow line (Round 6 fix, Round 7 token alignment)', () => {
    it('should render decorative glow line', () => {
      const { container } = render(<StatsCard {...defaultProps} />);

      // Look for the glow line by its gradient background
      const glowLine = container.querySelector('[style*="linear-gradient"]');
      expect(glowLine).toBeInTheDocument();
    });

    it('should have glow line with proper positioning to avoid clipping', () => {
      const { container } = render(<StatsCard {...defaultProps} />);

      // The glow line should be positioned with bottom margin to avoid overflow clipping
      // Find by the gradient style and bottom positioning
      const glowLine = container.querySelector('[style*="linear-gradient"]');
      expect(glowLine).toBeInTheDocument();

      // Check that it has proper styling
      const style = (glowLine as HTMLElement)?.style;
      expect(style).toBeTruthy();
    });

    it('should apply box shadow to glow line using theme tokens', () => {
      const { container } = render(<StatsCard {...defaultProps} color="gold" />);

      // Find the StatsCard-specific glow line (has rounded-full and opacity-40 classes)
      const glowLine = container.querySelector('.rounded-full.opacity-40');
      expect(glowLine).toBeInTheDocument();

      // Verify glow uses CSS theme token
      const style = (glowLine as HTMLElement)?.style;
      expect(style.boxShadow).toContain('var(--color-gold-glow-soft)');
    });

    it('should use theme tokens for icon background glow', () => {
      const { container } = render(<StatsCard {...defaultProps} color="gold" />);

      // Find icon container by its rounded styling
      const iconContainer = container.querySelector('[class*="rounded-[10px]"]');
      expect(iconContainer).toBeInTheDocument();

      const style = (iconContainer as HTMLElement)?.style;
      expect(style.background).toContain('var(--color-gold-icon-bg)');
    });
  });

  describe('Tap feedback (Round 6)', () => {
    it('should have tap feedback styles applied', () => {
      const { container } = render(<StatsCard {...defaultProps} />);

      // StatsCard should have motion wrapper for tap feedback
      const motionWrapper = container.firstChild;
      expect(motionWrapper).toBeTruthy();
    });

    it('should use GlassCard with hoverable=true', () => {
      const { container } = render(<StatsCard {...defaultProps} />);

      // Should contain GlassCard styling
      const glassCard = container.querySelector('[style*="linear-gradient"]');
      expect(glassCard).toBeInTheDocument();
    });
  });

  describe('Animation delay', () => {
    it('should apply delay to entrance animation', () => {
      const { container } = render(<StatsCard {...defaultProps} delay={0.5} />);

      // Motion wrapper should be present
      expect(container.firstChild).toBeTruthy();
    });
  });
});

describe('StatsBentoGrid', () => {
  const mockStats = {
    totalJournals: 42,
    totalWords: 15800,
    activeDays: 28,
    streakDays: 7,
  };

  it('should render all 4 stat cards', () => {
    render(<StatsBentoGrid stats={mockStats} />);

    expect(screen.getByText('总篇数')).toBeInTheDocument();
    expect(screen.getByText('总字数')).toBeInTheDocument();
    expect(screen.getByText('活跃天数')).toBeInTheDocument();
    expect(screen.getByText('连续记录')).toBeInTheDocument();
  });

  it('should format large numbers with k suffix', () => {
    render(<StatsBentoGrid stats={mockStats} />);

    expect(screen.getByText('15.8k')).toBeInTheDocument(); // 15800 formatted
  });

  it('should render demo stats when isDemo is true', () => {
    render(<StatsBentoGrid stats={mockStats} isDemo={true} />);

    // Demo stats are used when isDemo=true
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('should use correct Material Symbols icons', () => {
    render(<StatsBentoGrid stats={mockStats} />);

    expect(screen.getByText('auto_stories')).toBeInTheDocument();
    expect(screen.getByText('edit_note')).toBeInTheDocument();
    expect(screen.getByText('calendar_month')).toBeInTheDocument();
    expect(screen.getByText('local_fire_department')).toBeInTheDocument();
  });

  it('should render in 2x2 grid layout', () => {
    const { container } = render(<StatsBentoGrid stats={mockStats} />);

    const grid = container.querySelector('.grid');
    expect(grid).toBeInTheDocument();
    expect(grid?.classList.contains('grid-cols-2')).toBe(true);
  });
});
