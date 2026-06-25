import { Link, useLocation } from 'react-router';
import { motion } from 'motion/react';
import { useUIStore } from '@/stores/ui';

interface NavItem {
  path: string;
  cn: string;
  en: string;
  icon: string;
}

const navItems: NavItem[] = [
  { path: '/home', cn: '写入', en: 'Write', icon: 'edit_note' },
  { path: '/recall', cn: '搜索', en: 'Search', icon: 'search' },
  { path: '/archives', cn: '面板', en: 'Panel', icon: 'dashboard' },
];

/**
 * BottomNavBar - 星轨栏 (Star Track Bar)
 * Mobile navigation with glass background and FAB center button
 * Visible below 900px breakpoint
 */
export function BottomNavBar() {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/home') {
      return location.pathname === '/' || location.pathname.startsWith('/home');
    }

    return location.pathname.startsWith(path);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-[100] lg:hidden"
      style={{
        background: 'linear-gradient(180deg, var(--color-nav-mobile-start) 0%, var(--color-nav-mobile-end) 100%)',
        backdropFilter: 'blur(9px) saturate(140%)',
        WebkitBackdropFilter: 'blur(9px) saturate(140%)',
        borderTop: '1px solid var(--color-white-6)',
      }}
    >
      <div className="flex items-center justify-around px-4 py-2 pb-safe max-[640px]:px-2">
        {navItems.map((item) => (
          <NavButton
            key={item.path}
            item={item}
            isActive={isActive(item.path)}
          />
        ))}
      </div>
    </nav>
  );
}

interface NavButtonProps {
  item: NavItem;
  isActive: boolean;
}

function NavButton({ item, isActive }: NavButtonProps) {
  const { setHomeActivated } = useUIStore();
  return (
    <Link
      to={item.path}
      aria-label={item.cn}
      className="relative flex flex-col items-center justify-center gap-1 min-h-[44px] min-w-[44px] py-2 px-3 max-[640px]:px-2 transition-all duration-300"
      aria-current={isActive ? 'page' : undefined}
      onClick={() => {
        if (item.path === '/home') {
          setHomeActivated(true);
        }
      }}
    >
      {/* Animated active indicator */}
      {isActive && (
        <motion.div
          className="absolute -top-1 left-1/2 h-1 w-8 rounded-full bg-[var(--color-gold)]"
          layoutId="activeIndicator"
          initial={{ opacity: 0, scale: 0.5, x: '-50%' }}
          animate={{ opacity: 1, scale: 1, x: '-50%' }}
          exit={{ opacity: 0, scale: 0.5, x: '-50%' }}
          transition={{ duration: 0.8, ease: [0.23, 1, 0.32, 1] }}
          style={{
            boxShadow: '0 0 8px var(--color-gold-60)',
          }}
        />
      )}
      <span
        aria-hidden="true"
        className={`material-symbols-outlined text-xl transition-colors duration-300 ${
          isActive ? 'text-[var(--color-gold)]' : 'text-[var(--color-muted)]'
        }`}
      >
        {item.icon}
      </span>
      <span
        className={`text-[var(--text-label)] font-medium transition-colors duration-300 ${
          isActive ? 'text-[var(--color-gold)]' : 'text-[var(--color-muted)]'
        }`}
      >
        {item.cn}
      </span>
    </Link>
  );
}
