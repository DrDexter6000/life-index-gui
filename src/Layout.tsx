import { Suspense } from 'react';
import { useLocation, useOutlet } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { TopNavBar } from '@/components/layout/TopNavBar';

import { VideoBackground } from '@/components/layout/VideoBackground';
import { GlobalOverlay } from '@/components/layout/GlobalOverlay';
import { ParticleCanvas } from '@/components/layout/ParticleCanvas';
import { PageLoader } from '@/components/celestial/CelestialLoader';
import { useUIStore } from '@/stores/ui';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * Layout - Global layout shell wrapping all routes
 */
export function Layout() {
  const { isEtherDissolve } = useUIStore();
  const { t } = useTranslation();
  const outlet = useOutlet();
  const location = useLocation();
  const routeKey = location.pathname.split('/')[1] || 'home';
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[200] focus:px-4 focus:py-2 focus:rounded-xl focus:bg-[var(--color-gold)] focus:text-[var(--color-void)] focus:font-semibold"
      >
        {t('skipToContent')}
      </a>
      <VideoBackground dimmed={isEtherDissolve} />
      <GlobalOverlay />
      <ParticleCanvas />
      <TopNavBar />

      <main id="main-content" className="li-main-shell relative z-10 min-h-screen">
        <div aria-live="polite" aria-atomic="true">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={routeKey}
              className="li-route-fade"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.42, ease: [0.23, 1, 0.32, 1] }}
            >
              <Suspense fallback={<PageLoader />}>{outlet}</Suspense>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </>
  );
}
