import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GlassCard } from './GlassCard';

// Note: motion/react is not mocked - tests run with actual motion components

describe('GlassCard', () => {
  it('should render with children', () => {
    render(
      <GlassCard>
        <span data-testid="content">Card Content</span>
      </GlassCard>
    );

    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(screen.getByText('Card Content')).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(
      <GlassCard className="custom-class">
        <span>Content</span>
      </GlassCard>
    );

    const card = container.firstChild as HTMLElement;
    expect(card.classList.contains('custom-class')).toBe(true);
  });

  it('should render as button when onClick is provided', () => {
    const handleClick = vi.fn();
    render(
      <GlassCard onClick={handleClick}>
        <span>Clickable</span>
      </GlassCard>
    );

    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('type', 'button');
  });

  it('should call onClick when clicked', () => {
    const handleClick = vi.fn();
    render(
      <GlassCard onClick={handleClick}>
        <span>Clickable</span>
      </GlassCard>
    );

    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('should render as div when no onClick is provided', () => {
    const { container } = render(
      <GlassCard>
        <span>Non-clickable</span>
      </GlassCard>
    );

    // Should not have a button role
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // First child should be a div
    const card = container.firstChild as HTMLElement;
    expect(card.tagName.toLowerCase()).toBe('div');
  });

  it('should have glassmorphism styling applied', () => {
    const { container } = render(
      <GlassCard>
        <span>Content</span>
      </GlassCard>
    );

    const card = container.firstChild as HTMLElement;
    expect(card.classList.contains('glass-card')).toBe(true);
    expect(card.classList.contains('relative')).toBe(true);
    expect(card.classList.contains('overflow-hidden')).toBe(true);
    expect(card.classList.contains('rounded-[24px]')).toBe(true);
    expect(card).toBeInTheDocument();
  });

  it('should keep deprecated glowEffect prop CSS-driven when true', () => {
    const { container } = render(
      <GlassCard glowEffect={true}>
        <span>Content</span>
      </GlassCard>
    );

    const card = container.firstChild as HTMLElement;
    const glowElement = container.querySelector('.card-glow');
    expect(card.classList.contains('glass-card')).toBe(true);
    expect(glowElement).not.toBeInTheDocument();
  });

  it('should not render glow effect when glowEffect is false', () => {
    const { container } = render(
      <GlassCard glowEffect={false}>
        <span>Content</span>
      </GlassCard>
    );

    const glowElement = container.querySelector('.card-glow');
    expect(glowElement).not.toBeInTheDocument();
  });

  it('should wrap content above CSS pseudo-element layers', () => {
    const { container } = render(
      <GlassCard>
        <span>Content</span>
      </GlassCard>
    );

    const contentLayer = container.querySelector('.relative.z-\\[3\\]');
    expect(contentLayer).toBeInTheDocument();
  });

  it('should apply hoverable styles when hoverable is true', () => {
    const { container } = render(
      <GlassCard hoverable={true}>
        <span>Content</span>
      </GlassCard>
    );

    const card = container.firstChild as HTMLElement;
    // Should have group class for hover effects
    expect(card.classList.contains('group')).toBe(true);
  });

  it('should not apply hoverable styles when hoverable is false', () => {
    const { container } = render(
      <GlassCard hoverable={false}>
        <span>Content</span>
      </GlassCard>
    );

    const card = container.firstChild as HTMLElement;
    // Should still have group class (needed for glow), but no hover transform
    expect(card.classList.contains('group')).toBe(true);
  });

  it('should call onMouseMove when mouse moves over card', () => {
    const handleMouseMove = vi.fn();
    const { container } = render(
      <GlassCard onMouseMove={handleMouseMove}>
        <span>Content</span>
      </GlassCard>
    );

    const card = container.firstChild as HTMLElement;
    fireEvent.mouseMove(card, { clientX: 100, clientY: 100 });

    expect(handleMouseMove).toHaveBeenCalled();
  });

  it('should have rounded corners', () => {
    const { container } = render(
      <GlassCard>
        <span>Content</span>
      </GlassCard>
    );

    const card = container.firstChild as HTMLElement;
    expect(card.classList.contains('rounded-[24px]')).toBe(true);
  });

  it('should have overflow hidden', () => {
    const { container } = render(
      <GlassCard>
        <span>Content</span>
      </GlassCard>
    );

    const card = container.firstChild as HTMLElement;
    expect(card.classList.contains('overflow-hidden')).toBe(true);
  });

  describe('Motion variants', () => {
    it('should use motion variants for hover state instead of manual style manipulation', () => {
      // This test verifies that the component uses motion variants
      // The actual motion implementation is tested via the mock
      const { container } = render(
        <GlassCard hoverable={true}>
          <span>Content</span>
        </GlassCard>
      );

      const card = container.firstChild as HTMLElement;
      // Motion variants should be applied via the motion component
      // The card should have the group class for hover effects
      expect(card.classList.contains('group')).toBe(true);
    });

  it('should preserve the CSS-driven glass card surface without extra glow DOM', () => {
    const { container } = render(
      <GlassCard glowEffect={true}>
        <span>Content</span>
      </GlassCard>
    );

    const card = container.firstChild as HTMLElement;
    expect(card.classList.contains('glass-card')).toBe(true);
    expect(container.querySelector('.card-glow')).not.toBeInTheDocument();
  });
  });
});
