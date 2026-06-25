import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { BottomNavBar } from './BottomNavBar';

describe('BottomNavBar', () => {
  const renderWithRouter = (initialRoute: string) => {
    return render(
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="*" element={<BottomNavBar />} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('should render navigation with three items', () => {
    renderWithRouter('/');

    // Should have three nav links
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);
  });

  it('should render write nav item', () => {
    renderWithRouter('/');

    expect(screen.getByText('写入')).toBeInTheDocument();
    expect(screen.getByText('edit_note')).toBeInTheDocument();
  });

  it('should render recall nav item', () => {
    renderWithRouter('/');

    expect(screen.getByText('搜索')).toBeInTheDocument();
    expect(screen.getByText('search')).toBeInTheDocument();
  });

  it('should render archives nav item', () => {
    renderWithRouter('/');

    expect(screen.getByText('面板')).toBeInTheDocument();
    expect(screen.getByText('dashboard')).toBeInTheDocument();
  });

  it('should mark home as active on root path', () => {
    renderWithRouter('/');

    const homeLink = screen.getAllByRole('link')[0];
    expect(homeLink).toHaveAttribute('aria-current', 'page');
  });

  it('should mark recall as active on /recall path', () => {
    renderWithRouter('/recall');

    const recallLink = screen.getAllByRole('link')[1];
    expect(recallLink).toHaveAttribute('aria-current', 'page');
  });

  it('should mark archives as active on /archives path', () => {
    renderWithRouter('/archives');

    const archivesLink = screen.getAllByRole('link')[2];
    expect(archivesLink).toHaveAttribute('aria-current', 'page');
  });

  it('should have correct hrefs', () => {
    renderWithRouter('/');

    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/home');
    expect(links[1]).toHaveAttribute('href', '/recall');
    expect(links[2]).toHaveAttribute('href', '/archives');
  });

  describe('Mobile touch targets (Round 8)', () => {
    it('should have 44px minimum touch target height', () => {
      renderWithRouter('/');

      const links = screen.getAllByRole('link');
      links.forEach(link => {
        expect(link.classList.contains('min-h-[44px]')).toBe(true);
      });
    });

    it('should have 44px minimum touch target width', () => {
      renderWithRouter('/');

      const links = screen.getAllByRole('link');
      links.forEach(link => {
        expect(link.classList.contains('min-w-[44px]')).toBe(true);
      });
    });

    it('should use justify-center for vertical alignment', () => {
      renderWithRouter('/');

      const links = screen.getAllByRole('link');
      links.forEach(link => {
        expect(link.classList.contains('justify-center')).toBe(true);
      });
    });
  });

  describe('Animated active indicator (Round 8)', () => {
    it('should render active indicator for active item', () => {
      renderWithRouter('/');

      // Active indicator is a motion div with specific styling
      const { container } = renderWithRouter('/');
      const activeIndicator = container.querySelector('[class*="rounded-full"]');
      expect(activeIndicator).toBeInTheDocument();
    });

    it('should have gold color for active indicator', () => {
      const { container } = renderWithRouter('/');

      // Look for the gold background color on the indicator (motion.div with bg-[#ffe792])
      const indicator = container.querySelector('[class*="bg-"][class*="color-gold"]');
      expect(indicator).toBeInTheDocument();
    });

    it('should have glow effect on active indicator', () => {
      const { container } = renderWithRouter('/');

      // Indicator should have box shadow for glow - check the motion.div indicator
      const indicators = container.querySelectorAll('[class*="rounded-full"]');
      const hasGlow = Array.from(indicators).some(el => {
        const style = (el as HTMLElement).style;
        return style.boxShadow && style.boxShadow.includes('var(--color-gold-60)');
      });
      expect(hasGlow).toBe(true);
    });

    it('should position indicator above active item', () => {
      const { container } = renderWithRouter('/');

      // Indicator should have negative top position
      const indicator = container.querySelector('.-top-1');
      expect(indicator).toBeInTheDocument();
    });

    it('should center indicator horizontally', () => {
      const { container } = renderWithRouter('/');

      // Indicator should be centered with left-1/2 class
      const indicators = container.querySelectorAll('[class*="left-"]');
      const hasCentered = Array.from(indicators).some(el =>
        el.className.includes('left-1/2')
      );
      expect(hasCentered).toBe(true);
    });
  });

  describe('Visual styling', () => {
    it('should have glass background on nav container', () => {
      const { container } = renderWithRouter('/');

      const nav = container.querySelector('nav');
      expect(nav).toBeInTheDocument();

      const style = (nav as HTMLElement)?.style;
      expect(style?.backdropFilter).toBe('blur(9px) saturate(140%)');
    });

    it('should have correct z-index', () => {
      const { container } = renderWithRouter('/');

      const nav = container.querySelector('nav');
      expect(nav?.classList.contains('z-[100]')).toBe(true);
    });

    it('should be hidden on large screens', () => {
      const { container } = renderWithRouter('/');

      const nav = container.querySelector('nav');
      expect(nav?.classList.contains('lg:hidden')).toBe(true);
    });

    it('should have fixed positioning at bottom', () => {
      const { container } = renderWithRouter('/');

      const nav = container.querySelector('nav');
      expect(nav?.classList.contains('fixed')).toBe(true);
      expect(nav?.classList.contains('bottom-0')).toBe(true);
    });
  });

  describe('Active state colors', () => {
    it('should use gold color for active icon', () => {
      renderWithRouter('/');

      const activeIcon = screen.getByText('edit_note');
      expect(activeIcon.classList.contains('text-[var(--color-gold)]')).toBe(true);
    });

    it('should use muted color for inactive icons', () => {
      renderWithRouter('/');

      const inactiveIcons = screen.getAllByText(/search|dashboard/);
      inactiveIcons.forEach(icon => {
        expect(icon.classList.contains('text-[var(--color-muted)]')).toBe(true);
      });
    });
  });
});
