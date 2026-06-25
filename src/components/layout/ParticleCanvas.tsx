import { useEffect, useRef, useState } from 'react';

interface ParticleData {
  id: number;
  left: string;
  top: string;
  size: string;
  color: string;
  opacity: number;
  duration: string;
  delay: string;
}

const PARTICLE_COUNT_SCALE = 2 / 3;
const MIN_PARTICLE_COUNT = 25;
const MAX_PARTICLE_COUNT = 35;
const PARTICLE_DENSITY_AREA = 38_000;

/** Color palette: cyan 60%, gold 20%, coral 20% */
const COLORS = [
  '#85fff2', '#85fff2', '#85fff2', '#85fff2', '#85fff2', '#85fff2', // 6 cyan
  '#ffe792', '#ffe792',                                               // 2 gold
  '#ffb4a6', '#ffb4a6',                                               // 2 coral
];

function createParticles(count: number): ParticleData[] {
  return Array.from({ length: count }, (_, i) => {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)] ?? COLORS[0];
    const size = 1 + Math.random() * 2.5;
    const opacity = parseFloat((0.15 + Math.random() * 0.35).toFixed(2));
    const duration = 10 + Math.random() * 20;
    const delay = -(Math.random() * 20);

    return {
      id: i,
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 100}%`,
      size: `${size.toFixed(2)}px`,
      color,
      opacity,
      duration: `${duration.toFixed(1)}s`,
      delay: `${delay.toFixed(1)}s`,
    };
  });
}

function getParticleCount(width: number, height: number): number {
  const densityCount = Math.floor((width * height) / PARTICLE_DENSITY_AREA);
  return Math.min(
    MAX_PARTICLE_COUNT,
    Math.max(MIN_PARTICLE_COUNT, Math.round(densityCount * PARTICLE_COUNT_SCALE)),
  );
}

/**
 * ParticleCanvas - subtle atmospheric background particles
 * Rendered as DOM elements with CSS @keyframes for GPU-composited smoothness,
 * matching the BIS prototype visual quality.
 */
export function ParticleCanvas() {
  const [particles, setParticles] = useState<ParticleData[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isVisible, setIsVisible] = useState(!document.hidden);
  const styleInserted = useRef(false);

  useEffect(() => {
    // Inject global keyframes once across all instances
    if (!styleInserted.current) {
      styleInserted.current = true;
      const styleId = 'particle-keyframes';
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          @keyframes particleFloat {
            0%   { transform: translate(0, 0); opacity: 0; }
            10%  { opacity: 1; }
            90%  { opacity: 1; }
            100% { transform: translate(80px, -60px); opacity: 0; }
          }
        `;
        document.head.appendChild(style);
      }
    }

    // Initialise particles based on viewport density
    const width = window.innerWidth;
    const height = window.innerHeight;
    const count = getParticleCount(width, height);
    setParticles(createParticles(count));

    // Respect prefers-reduced-motion
    const motionQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    setReducedMotion(motionQuery?.matches ?? false);
    const handleMotionChange = (e: MediaQueryListEvent) => {
      setReducedMotion(e.matches);
    };
    motionQuery?.addEventListener('change', handleMotionChange);

    // Pause animations when tab is hidden to save GPU
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      motionQuery?.removeEventListener('change', handleMotionChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const isPaused = reducedMotion || !isVisible;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[2] h-full w-full overflow-hidden"
    >
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            opacity: p.opacity,
            animation: `particleFloat ${p.duration} linear infinite`,
            animationDelay: p.delay,
            animationPlayState: isPaused ? 'paused' : 'running',
            willChange: 'transform, opacity',
          }}
        />
      ))}
    </div>
  );
}
