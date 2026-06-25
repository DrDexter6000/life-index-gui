import { useState, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

interface CelestialLoaderProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
  /**
   * Enable tiered text escalation based on loading duration.
   * When true, text will change after 2s and 5s of loading.
   */
  tieredText?: boolean;
}

/**
 * Loading tier text messages based on duration
 * 0-2s: Initial message
 * 2-5s: Patience message
 * 5s+: Extended wait message
 */
const TIER_KEYS = {
  initial: 'loading',
  patience: 'stillLoading',
  extended: 'extendedLoading',
} as const;

/**
 * CelestialLoader - Loading animation with star/glow spinner
 * Rendered with CSS @keyframes for GPU-composited smoothness.
 * Eliminates Framer Motion runtime overhead during loading states.
 */
export function CelestialLoader({ size = 'md', text, tieredText = false }: CelestialLoaderProps) {
  const { t } = useTranslation();
  const [tier, setTier] = useState<'initial' | 'patience' | 'extended'>('initial');

  useEffect(() => {
    if (!tieredText) return;

    const patienceTimer = setTimeout(() => {
      setTier('patience');
    }, 2000);

    const extendedTimer = setTimeout(() => {
      setTier('extended');
    }, 5000);

    return () => {
      clearTimeout(patienceTimer);
      clearTimeout(extendedTimer);
    };
  }, [tieredText]);

  const displayText = text ?? (tieredText ? t(TIER_KEYS[tier]) : undefined);

  const sizeMap = {
    sm: { container: 40, orbit: 32, core: 8 },
    md: { container: 64, orbit: 48, core: 12 },
    lg: { container: 96, orbit: 72, core: 16 },
  };

  const { container, orbit, core } = sizeMap[size];

  // Particle trajectories: 3 particles at 120° intervals
  const particles = [
    { tx: (container / 2 - 4), ty: 0, delay: '0s' },
    { tx: -(container / 2 - 4) * 0.5, ty: (container / 2 - 4) * 0.866, delay: '0.6s' },
    { tx: -(container / 2 - 4) * 0.5, ty: -(container / 2 - 4) * 0.866, delay: '1.2s' },
  ];

  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <div className="relative" style={{ width: container, height: container }}>
        {/* Outer orbit ring */}
        <div
          className="absolute inset-0 rounded-full animate-celestial-outer-spin"
          style={{
            border: '1px solid var(--color-gold-20)',
            borderTopColor: 'var(--color-gold)',
          }}
        />

        {/* Inner orbit ring */}
        <div
          className="absolute rounded-full animate-celestial-inner-spin"
          style={{
            width: orbit,
            height: orbit,
            top: (container - orbit) / 2,
            left: (container - orbit) / 2,
            border: '1px solid var(--color-cyan-20)',
            borderBottomColor: 'var(--color-cyan)',
          }}
        />

        {/* Glowing core */}
        <div
          className="absolute rounded-full animate-celestial-core-breathe"
          style={{
            width: core,
            height: core,
            top: (container - core) / 2,
            left: (container - core) / 2,
            background: 'var(--color-gold)',
            boxShadow: `
              0 0 ${core}px var(--color-gold-40),
              0 0 ${core * 2}px var(--color-gold-20),
              0 0 ${core * 3}px var(--color-gold-10)
            `,
          }}
        />

        {/* Star particles */}
        {particles.map((p, i) => (
          <div
            key={`particle-${i}`}
            className="absolute w-1 h-1 rounded-full bg-[var(--color-gold)] animate-celestial-particle"
            style={{
              top: '50%',
              left: '50%',
              '--particle-tx': `${p.tx}px`,
              '--particle-ty': `${p.ty}px`,
              animationDelay: p.delay,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {displayText && (
        <p
          className="text-sm text-[var(--color-secondary)] font-medium animate-celestial-text-breathe"
          role="status"
        >
          {displayText}
        </p>
      )}
    </div>
  );
}

/**
 * PageLoader - Full page loading state with CelestialLoader
 * Uses tiered text escalation by default
 */
export function PageLoader({ text, tieredText = true }: { text?: string; tieredText?: boolean }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <CelestialLoader size="lg" text={text} tieredText={tieredText} />
    </div>
  );
}

/**
 * SuspenseFallback - React Suspense fallback component
 * Uses tiered text escalation for better UX during code splitting
 */
export function SuspenseFallback() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex items-center justify-center">
      <CelestialLoader size="lg" text={t('extendedLoading')} tieredText={true} />
    </div>
  );
}
