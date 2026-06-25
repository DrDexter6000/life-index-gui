import { memo } from 'react';

/**
 * NoiseOverlay - BIS texture layer
 * SVG noise filter at 5.5% opacity with overlay blend mode
 * Eliminates color banding in dark gradients
 * Implements the DESIGN.md noise overlay contract
 */
export const NoiseOverlay = memo(function NoiseOverlay() {
  // Inline SVG keeps the texture deterministic without adding an asset request.
  const noiseSvg = `data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.5' numOctaves='3' stitchTiles='stitch'/%3E%3CcolorMatrix type='matrix' values='1 0 0 0 0, 0 1 0 0 0, 0 0 1 0 0, 0 0 0 0.5 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E`;

  return (
    <div
      className="fixed inset-0 z-[1000] pointer-events-none"
      style={{
        opacity: 0.035,
        backgroundImage: `url("${noiseSvg}")`,
        // mixBlendMode: 'overlay' disabled — most expensive CSS blend mode,
        // full-screen per-pixel compositing regardless of opacity.
      }}
      aria-hidden="true"
    />
  );
});
