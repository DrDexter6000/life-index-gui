import { useEffect, useRef, useMemo, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { Link } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { useUIStore } from '@/stores/ui';
import { useTranslation } from '@/hooks/useTranslation';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NavItem {
  path: string;
  labelKey: string;
  cn: string;
  en: string;
}

export interface NavItemRenderState {
  item: NavItem;
  active: boolean;
  desktopLinkStyle: CSSProperties;
  mobileLinkStyle: CSSProperties;
  mobileCnStyle: CSSProperties;
  mobileEnStyle: CSSProperties;
  activeDotStyle: CSSProperties;
}

interface MobileMenuProps {
  navItemRenderStates: NavItemRenderState[];
  isOpen: boolean;
  onClose: () => void;
  onNavClick: (e: ReactMouseEvent<HTMLAnchorElement>) => void;
}

// ─── Style Constants ─────────────────────────────────────────────────────────

const MOBILE_BLUR_OVERLAY_STYLE = {
  background: 'var(--color-nav-mobile-overlay)',
  zIndex: 90,
} as const satisfies CSSProperties;

const MOBILE_DROPDOWN_STYLE = {
  top: '4.5rem',
  right: '1.5rem',
  minWidth: '200px',
  background: 'var(--color-nav-mobile-dropdown-bg)',
  backdropFilter: 'blur(9px) saturate(140%)',
  WebkitBackdropFilter: 'blur(9px) saturate(140%)',
  border: '1px solid var(--color-glass-highlight)',
  borderRadius: '20px',
  padding: '0.625rem',
  boxShadow: '0 18px 36px var(--color-black-50)',
  transformOrigin: 'top right',
  fontFamily: 'var(--font-control)',
  willChange: 'opacity, transform',
  zIndex: 100,
} as const satisfies CSSProperties;

const MOBILE_DROPDOWN_HIGHLIGHT_STYLE = {
  height: '1px',
  background: 'linear-gradient(90deg, transparent, var(--color-white-20), transparent)',
  borderTopLeftRadius: '20px',
  borderTopRightRadius: '20px',
} as const satisfies CSSProperties;

const MOBILE_NAV_LINK_ACTIVE_STYLE = {
  padding: '0.75rem 1.125rem',
  borderRadius: '12px',
  background: 'var(--color-gold-15)',
} as const satisfies CSSProperties;

const MOBILE_NAV_LINK_INACTIVE_STYLE = {
  padding: '0.75rem 1.125rem',
  borderRadius: '12px',
  background: 'transparent',
} as const satisfies CSSProperties;

const MOBILE_NAV_CN_ACTIVE_STYLE = {
  fontSize: '0.9375rem',
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-gold)',
} as const satisfies CSSProperties;

const MOBILE_NAV_CN_INACTIVE_STYLE = {
  fontSize: '0.9375rem',
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-primary)',
} as const satisfies CSSProperties;

const MOBILE_NAV_EN_ACTIVE_STYLE = {
  fontSize: '0.6875rem',
  fontWeight: 500,
  color: 'var(--color-gold-60)',
  letterSpacing: '0.08em',
} as const satisfies CSSProperties;

const MOBILE_NAV_EN_INACTIVE_STYLE = {
  fontSize: '0.6875rem',
  fontWeight: 500,
  color: 'var(--color-secondary)',
  letterSpacing: '0.08em',
} as const satisfies CSSProperties;

const MOBILE_ACTIVE_DOT_VISIBLE_STYLE = {
  width: '6px',
  height: '6px',
  background: 'var(--color-gold)',
  boxShadow: '0 0 10px var(--color-gold)',
  opacity: 1,
} as const satisfies CSSProperties;

const MOBILE_ACTIVE_DOT_HIDDEN_STYLE = {
  width: '6px',
  height: '6px',
  background: 'var(--color-gold)',
  boxShadow: '0 0 10px var(--color-gold)',
  opacity: 0,
} as const satisfies CSSProperties;

const MOBILE_NAV_TEXT_GROUP_STYLE = {
  gap: '0.75rem',
} as const satisfies CSSProperties;

const MOBILE_DIVIDER_STYLE = {
  height: '1px',
  background: 'var(--color-glass-border)',
  margin: '0.5rem 0.625rem',
} as const satisfies CSSProperties;

const MOBILE_LANGUAGE_SECTION_STYLE = {
  padding: '0.75rem',
  gap: '0.5rem',
} as const satisfies CSSProperties;

const MOBILE_LANGUAGE_BUTTON_ACTIVE_STYLE = {
  padding: '0.375rem 0.75rem',
  fontSize: '0.75rem',
  fontWeight: 500,
  fontFamily: 'var(--font-control)',
  letterSpacing: '0.08em',
  borderRadius: '8px',
  background: 'var(--color-gold-10)',
  color: 'var(--color-gold)',
} as const satisfies CSSProperties;

const MOBILE_LANGUAGE_BUTTON_INACTIVE_STYLE = {
  padding: '0.375rem 0.75rem',
  fontSize: '0.75rem',
  fontWeight: 500,
  fontFamily: 'var(--font-control)',
  letterSpacing: '0.08em',
  borderRadius: '8px',
  background: 'transparent',
  color: 'var(--color-secondary)',
} as const satisfies CSSProperties;

const MOBILE_LANGUAGE_SEPARATOR_STYLE = {
  color: 'var(--color-secondary)',
  fontSize: '0.75rem',
  fontFamily: 'var(--font-control)',
} as const satisfies CSSProperties;

// ─── Re-export style getters for TopNavBar render states ─────────────────────

export function getMobileLinkStyle(active: boolean): CSSProperties {
  return active ? MOBILE_NAV_LINK_ACTIVE_STYLE : MOBILE_NAV_LINK_INACTIVE_STYLE;
}

export function getMobileCnStyle(active: boolean): CSSProperties {
  return active ? MOBILE_NAV_CN_ACTIVE_STYLE : MOBILE_NAV_CN_INACTIVE_STYLE;
}

export function getMobileEnStyle(active: boolean): CSSProperties {
  return active ? MOBILE_NAV_EN_ACTIVE_STYLE : MOBILE_NAV_EN_INACTIVE_STYLE;
}

export function getActiveDotStyle(active: boolean): CSSProperties {
  return active ? MOBILE_ACTIVE_DOT_VISIBLE_STYLE : MOBILE_ACTIVE_DOT_HIDDEN_STYLE;
}

export function getMobileLanguageButtonStyle(isActive: boolean): CSSProperties {
  return isActive ? MOBILE_LANGUAGE_BUTTON_ACTIVE_STYLE : MOBILE_LANGUAGE_BUTTON_INACTIVE_STYLE;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * MobileMenu - Mobile dropdown menu extracted from TopNavBar
 * Handles lightweight overlay, dropdown rendering, focus trap, and language switching.
 * Toggle button remains in TopNavBar.
 */
export function MobileMenu({ navItemRenderStates, isOpen, onClose, onNavClick }: MobileMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { lang, toggleLang } = useUIStore();
  const { t } = useTranslation();

  const mobileLanguageStyles = useMemo(() => ({
    zh: getMobileLanguageButtonStyle(lang === 'zh'),
    en: getMobileLanguageButtonStyle(lang === 'en'),
  }), [lang]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Focus trap when mobile menu is open
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    const menu = menuRef.current;
    const focusableSelector = 'a[href], button, [tabindex]:not([tabindex="-1"])';
    const focusableElements = menu.querySelectorAll<HTMLElement>(focusableSelector);

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    // Defer focus until after first paint so opening the menu stays responsive.
    const focusFrame = window.requestAnimationFrame(() => {
      firstElement.focus({ preventScroll: true });
    });

    menu.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      menu.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      {/* Mobile Blur Overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            className="fixed inset-0 lg:hidden"
            style={MOBILE_BLUR_OVERLAY_STYLE}
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Mobile Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={menuRef}
            role="dialog"
            aria-label={t('navigationMenu')}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            className="absolute lg:hidden"
            style={MOBILE_DROPDOWN_STYLE}
          >
            {/* Top highlight line */}
            <div
              className="absolute top-0 left-0 right-0 pointer-events-none"
              style={MOBILE_DROPDOWN_HIGHLIGHT_STYLE}
            />

            {/* Nav Items */}
            {navItemRenderStates.map(({ item, active, mobileLinkStyle, mobileCnStyle, mobileEnStyle, activeDotStyle }) => (
              <Link
                key={item.path}
                to={item.path}
                data-nav-path={item.path}
                onClick={onNavClick}
                className="flex items-center justify-between mb-[0.625rem] last:mb-0 transition-all duration-200"
                style={mobileLinkStyle}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'var(--color-gold-10)';
                    const cn = e.currentTarget.querySelector('.nav-cn') as HTMLElement;
                    if (cn) cn.style.color = 'var(--color-gold)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'transparent';
                    const cn = e.currentTarget.querySelector('.nav-cn') as HTMLElement;
                    if (cn) cn.style.color = 'var(--color-primary)';
                  }
                }}
              >
                <div className="flex items-center" style={MOBILE_NAV_TEXT_GROUP_STYLE}>
                  <span
                    className="nav-cn font-semibold transition-colors duration-200"
                    style={mobileCnStyle}
                  >
                    {item.cn}
                  </span>
                  <span
                    className="nav-en text-xs tracking-wider uppercase transition-colors duration-200"
                    style={mobileEnStyle}
                  >
                    {item.en}
                  </span>
                </div>
                {/* Active dot with glow */}
                <span
                  className="rounded-full transition-opacity duration-200"
                  style={activeDotStyle}
                />
              </Link>
            ))}

            {/* Divider */}
            <div style={MOBILE_DIVIDER_STYLE} />

            {/* Language Section */}
            <div
              className="flex items-center justify-center"
              style={MOBILE_LANGUAGE_SECTION_STYLE}
            >
              <button
                type="button"
                aria-label={t('switchToZh')}
                onClick={() => {
                  if (lang !== 'zh') toggleLang();
                }}
                className="transition-all duration-200"
                style={mobileLanguageStyles.zh}
                onMouseEnter={(e) => {
                  if (lang !== 'zh') {
                    e.currentTarget.style.background = 'var(--color-white-5)';
                    e.currentTarget.style.color = 'var(--color-primary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (lang !== 'zh') {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--color-secondary)';
                  }
                }}
              >
                中
              </button>
              <span style={MOBILE_LANGUAGE_SEPARATOR_STYLE}>/</span>
              <button
                type="button"
                aria-label={t('switchToEn')}
                onClick={() => {
                  if (lang !== 'en') toggleLang();
                  onClose();
                }}
                className="transition-all duration-200"
                style={mobileLanguageStyles.en}
                onMouseEnter={(e) => {
                  if (lang !== 'en') {
                    e.currentTarget.style.background = 'var(--color-white-5)';
                    e.currentTarget.style.color = 'var(--color-primary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (lang !== 'en') {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--color-secondary)';
                  }
                }}
              >
                ENG
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
