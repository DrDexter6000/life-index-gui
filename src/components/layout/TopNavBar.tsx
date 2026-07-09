import { useCallback, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useUIStore } from '@/stores/ui';
import { useTranslation } from '@/hooks/useTranslation';
import { useHostAgentCapability } from '@/hooks/useHostAgent';
import { getStarweaveConnectionState } from '@/lib/health-status';
import { MobileMenu, type NavItem, type NavItemRenderState, getMobileLinkStyle, getMobileCnStyle, getMobileEnStyle, getActiveDotStyle } from './MobileMenu';
import { PublicLinkDialog } from './PublicLinkDialog';
import { StarweaveConsole } from './StarweaveConsole';

const navItems: NavItem[] = [
  { path: '/home', labelKey: 'navHome', cn: '写入', en: 'WRITE' },
  { path: '/recall', labelKey: 'navSearch', cn: '搜索', en: 'SEARCH' },
  { path: '/archives', labelKey: 'navPanel', cn: '面板', en: 'PANEL' },
];

const TOP_NAV_BACKGROUND_STYLE = {
  background: 'var(--color-nav-bg-gradient)',
} as const satisfies CSSProperties;

const BRAND_GOLD_DOT_STYLE = {
  background: 'var(--color-gold)',
  boxShadow: '0 0 12px var(--color-gold-60)',
} as const satisfies CSSProperties;

const BRAND_RING_STYLE = {
  borderColor: 'var(--color-gold-25)',
} as const satisfies CSSProperties;

const DESKTOP_NAV_CAPSULE_STYLE = {
  background: 'var(--color-nav-capsule-bg)',
  backdropFilter: 'blur(9px) saturate(140%)',
  WebkitBackdropFilter: 'blur(9px) saturate(140%)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 18px 50px rgba(0,0,0,0.28)',
  fontFamily: 'var(--font-control)',
} as const satisfies CSSProperties;

const DESKTOP_NAV_LINK_ACTIVE_STYLE = {
  background: 'var(--color-gold-10)',
} as const satisfies CSSProperties;

const DESKTOP_NAV_LINK_INACTIVE_STYLE = {
  background: 'transparent',
} as const satisfies CSSProperties;

const DESKTOP_DIVIDER_STYLE = {
  background: 'var(--color-glass-highlight)',
} as const satisfies CSSProperties;

const AGENT_DISCONNECTED_DOT_STYLE = {
  background: 'var(--color-amber)',
  boxShadow: '0 0 8px var(--color-amber)',
} as const satisfies CSSProperties;

const AGENT_CHECKING_DOT_STYLE = {
  background: 'var(--color-muted)',
  boxShadow: '0 0 8px rgba(255,255,255,0.18)',
} as const satisfies CSSProperties;

const AGENT_CONNECTED_DOT_STYLE = {
  background: 'var(--color-green)',
  boxShadow: '0 0 8px var(--color-green-60)',
} as const satisfies CSSProperties;

const MOBILE_MENU_TOGGLE_STYLE = {
  background: 'var(--color-nav-mobile-toggle-bg)',
  border: '1px solid var(--color-white-6)',
} as const satisfies CSSProperties;

const MOBILE_MENU_ICON_STYLE = {
  fontSize: '20px',
} as const satisfies CSSProperties;

const isNavPathActive = (path: string, pathname: string) => {
  if (path === '/home') {
    return pathname === '/' || pathname.startsWith('/home');
  }
  return pathname.startsWith(path);
};

/**
 * TopNavBar - 天际线 (Skyline)
 * Desktop navigation with capsule style and CN/EN bilingual labels
 * Implements the DESIGN.md navigation capsule and mobile menu contract
 */
export function TopNavBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [publicLinkOpen, setPublicLinkOpen] = useState(false);
  const [starweaveConsoleOpen, setStarweaveConsoleOpen] = useState(false);
  const { closeMobileMenu, lang, toggleLang, appPhase, setAppPhase, resetHome, setHomeActivated } = useUIStore();
  const { t } = useTranslation();
  const hostCapability = useHostAgentCapability();
  const starweaveConnectionState = getStarweaveConnectionState(hostCapability);
  const starweaveDotStyle = starweaveConnectionState === 'online'
    ? AGENT_CONNECTED_DOT_STYLE
    : starweaveConnectionState === 'checking'
      ? AGENT_CHECKING_DOT_STYLE
      : AGENT_DISCONNECTED_DOT_STYLE;

  const navItemRenderStates = useMemo<NavItemRenderState[]>(() => navItems.map((item) => {
    const active = isNavPathActive(item.path, location.pathname);

    return {
      item,
      active,
      desktopLinkStyle: active ? DESKTOP_NAV_LINK_ACTIVE_STYLE : DESKTOP_NAV_LINK_INACTIVE_STYLE,
      mobileLinkStyle: getMobileLinkStyle(active),
      mobileCnStyle: getMobileCnStyle(active),
      mobileEnStyle: getMobileEnStyle(active),
      activeDotStyle: getActiveDotStyle(active),
    };
  }), [location.pathname]);

  const handleMobileMenuToggle = useCallback(() => {
    setMobileMenuOpen((open) => !open);
  }, []);

  const handleMobileMenuClose = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  const handlePublicLinkOpen = useCallback(() => {
    setMobileMenuOpen(false);
    setStarweaveConsoleOpen(false);
    closeMobileMenu();
    setPublicLinkOpen(true);
  }, [closeMobileMenu]);

  const handleStarweaveToggle = useCallback(() => {
    setMobileMenuOpen(false);
    closeMobileMenu();
    setStarweaveConsoleOpen((open) => !open);
  }, [closeMobileMenu]);

  const handleStarweaveClose = useCallback(() => {
    setStarweaveConsoleOpen(false);
  }, []);

  const handleBrandClick = useCallback((e: ReactMouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    setStarweaveConsoleOpen(false);
    closeMobileMenu();
    setAppPhase('content');
    resetHome();
    navigate('/');
  }, [closeMobileMenu, navigate, resetHome, setAppPhase]);

  const handleNavClick = useCallback((e: ReactMouseEvent<HTMLAnchorElement>) => {
    const path = e.currentTarget.getAttribute('data-nav-path');
    if (!path) return;

    setMobileMenuOpen(false);
    setStarweaveConsoleOpen(false);
    closeMobileMenu();
    if (path === '/home') {
      e.preventDefault();
      setAppPhase('content');
      setHomeActivated(true);
      navigate(path);
      return;
    }
    if (appPhase !== 'content') {
      e.preventDefault();
      setAppPhase('content');
      navigate(path);
    }
  }, [appPhase, closeMobileMenu, navigate, setAppPhase, setHomeActivated]);

  return (
    <nav
      className="top-nav fixed top-0 left-0 right-0 z-[100] flex justify-center items-center py-5"
      style={TOP_NAV_BACKGROUND_STYLE}
    >
      <div className="w-full max-w-[1200px] flex justify-between items-center px-6">
        {/* Brand Logo */}
        <Link
          to="/"
          className="top-nav-brand flex items-center gap-3 cursor-pointer transition-opacity duration-300 hover:opacity-80"
          onClick={handleBrandClick}
        >
          <div className="top-nav-brand-orb relative w-8 h-8 flex-shrink-0">
            {/* Gold dot */}
            <div
              className="top-nav-brand-dot absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[10px] h-[10px] rounded-full"
              style={BRAND_GOLD_DOT_STYLE}
            />
            {/* Ring */}
            <div
              className="top-nav-brand-ring absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[22px] h-[22px] rounded-full border-[1.5px]"
              style={BRAND_RING_STYLE}
            />
            {/* Breathing halo */}
            <div
              className="top-nav-brand-halo absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[28px] h-[28px] rounded-full border border-[rgba(201,176,127,0.08)] animate-orb-breathe"
            />
          </div>
          <span
            className="top-nav-brand-text text-[var(--text-nav-logo)] font-normal tracking-[0.15em] uppercase whitespace-nowrap"
            style={{ fontFamily: 'var(--font-divine)' }}
          >
            <span className="text-[var(--color-primary)]">Life Index</span>
            <span className="top-nav-brand-separator text-[var(--color-muted)] text-[0.75rem] opacity-50 mx-1">|</span>
            <span className="top-nav-brand-cn text-[var(--color-gold)]" style={{ transform: 'translateY(-1px)', display: 'inline-block' }}>人生索引</span>
          </span>
        </Link>

        {/* Desktop Navigation Links - Capsule */}
        <div className="hidden lg:flex items-center gap-3">
          <div
            className="flex gap-1 items-center rounded-full p-1.5"
            style={DESKTOP_NAV_CAPSULE_STYLE}
            data-testid="desktop-nav-capsule"
          >
            {navItemRenderStates.map(({ item, active, desktopLinkStyle }) => (
              <Link
                key={item.path}
                to={item.path}
                data-nav-path={item.path}
                className={`px-3.5 py-2 text-[0.75rem] font-medium rounded-full transition-all duration-300 flex items-center gap-1 whitespace-nowrap ${
                  active
                    ? 'text-[var(--color-gold)]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-primary)]'
                }`}
                style={{ ...desktopLinkStyle, fontFamily: 'var(--font-control)', letterSpacing: '0.08em', textTransform: 'uppercase' }}
                onClick={handleNavClick}
              >
                <span className="font-medium">{item.cn}</span>
                <span className="text-[var(--text-en-subscript)] opacity-50 ml-0.5" style={{ textTransform: 'uppercase' }}>
                  {item.en}
                </span>
              </Link>
            ))}
          </div>

          <div className="w-px h-5" style={DESKTOP_DIVIDER_STYLE} />

          <div className="relative">
            <button
              type="button"
              data-testid="smart-capability-status"
              data-starweave-trigger="true"
              aria-haspopup="dialog"
              aria-expanded={starweaveConsoleOpen}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--color-cyan)]/20 bg-[var(--color-cyan)]/5 px-3.5 py-2.5 text-[0.75rem] font-medium text-[var(--color-cyan)] transition-colors hover:bg-[var(--color-cyan)]/10 hover:border-[var(--color-cyan)]/35"
              style={{ ...DESKTOP_NAV_CAPSULE_STYLE, letterSpacing: '0.08em', textTransform: 'uppercase' }}
              title={t('starweaveTriggerHint')}
              onClick={handleStarweaveToggle}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={starweaveDotStyle}
                data-testid="smart-capability-dot"
              />
              <span>{t('starweaveTrigger')}</span>
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">expand_more</span>
            </button>

            <StarweaveConsole
              isOpen={starweaveConsoleOpen}
              onClose={handleStarweaveClose}
              capability={hostCapability}
              lang={lang}
              onToggleLang={toggleLang}
              onPublicLinkClick={handlePublicLinkOpen}
            />
          </div>
        </div>

        {/* Mobile Menu Toggle */}
        <button
          type="button"
          className="top-nav-mobile-toggle lg:hidden relative z-[95] flex items-center justify-center w-10 h-10 rounded-xl transition-colors"
          style={MOBILE_MENU_TOGGLE_STYLE}
          onClick={handleMobileMenuToggle}
          aria-label={t('toggleMenu')}
          aria-expanded={mobileMenuOpen}
        >
          <span className="material-symbols-outlined text-[var(--color-primary)]" style={MOBILE_MENU_ICON_STYLE}>
            {mobileMenuOpen ? 'close' : 'menu'}
          </span>
        </button>
      </div>

      {/* Mobile Menu — overlay + dropdown + effects */}
      <MobileMenu
        navItemRenderStates={navItemRenderStates}
        isOpen={mobileMenuOpen}
        onClose={handleMobileMenuClose}
        onNavClick={handleNavClick}
        capability={hostCapability}
      />

      <PublicLinkDialog
        isOpen={publicLinkOpen}
        onClose={() => setPublicLinkOpen(false)}
      />
    </nav>
  );
}
