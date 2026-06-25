import { useEffect, useRef, useState } from 'react';

interface VideoBackgroundProps {
  /** Zen mode adds the only runtime dimming layer. */
  dimmed?: boolean;
  /** 视频加载就绪回调 */
  onReady?: () => void;
}

/**
 * VideoBackground - 视频背景层
 * 用循环播放的视频替换原有的金色/青色光晕效果
 * 视频放在最底层（z-index 最低），粒子效果在其之上
 *
 * Visual treatment:
 * - Source video plays unfiltered.
 * - Dynamic vignette keeps the edges quiet.
 * - Zen mode adds an extra dim layer.
 */
export function VideoBackground({ dimmed = false, onReady }: VideoBackgroundProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  // 用 ref 追踪 isLoaded，避免 visibilitychange 闭包捕获过期的 state
  const isLoadedRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const motionPreference = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    let reducedMotion = motionPreference?.matches ?? false;

    const playIfAllowed = () => {
      if (document.hidden || reducedMotion) {
        video.pause();
        return;
      }

      video.play().catch(() => {
        // 自动播放被阻止，等待用户交互
      });
    };

    const handleCanPlay = () => {
      setIsLoaded(true);
      isLoadedRef.current = true;
      onReady?.();
      playIfAllowed();
    };

    const handleError = () => {
      setIsLoaded(false);
      isLoadedRef.current = false;
    };

    const handleVisibilityChange = () => {
      if (isLoadedRef.current) playIfAllowed();
    };

    const handleMotionPreferenceChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      if (isLoadedRef.current) playIfAllowed();
    };

    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('error', handleError);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    motionPreference?.addEventListener('change', handleMotionPreferenceChange);

    // 如果视频已经缓存，canplay 可能已触发
    if (video.readyState >= 3) {
      handleCanPlay();
    }

    return () => {
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('error', handleError);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      motionPreference?.removeEventListener('change', handleMotionPreferenceChange);
    };
  }, [onReady]);

  return (
    <div
      className="pointer-events-none fixed inset-0 overflow-hidden"
        style={{ 
        zIndex: 0,
        background: 'var(--color-void)',
      }}
      aria-hidden="true"
    >
      {/* Video layer - unfiltered source playback */}
      <video
        ref={videoRef}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          opacity: isLoaded ? 1 : 0,
          transition: 'opacity 0.3s ease-out',
        }}
        onError={() => setIsLoaded(false)}
      >
        <source src="/bg-video.mp4" type="video/mp4" />
      </video>
      
      {/* 动态暗角层 - 边缘20%纯黑 + 20%渐变 */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(
              ellipse 60% 60% at 50% 50%,
              transparent 0%,
              transparent 60%,
              var(--color-video-vignette-start) 80%,
              var(--color-video-vignette-end) 100%
            )
          `,
        }}
      />
      
      {/* Zen 模式暗色遮罩 - 降低背景亮度约 70% */}
      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-[1200ms] ease-out"
        style={{
          background: 'var(--color-zen-dim)',
          opacity: dimmed ? 1 : 0,
        }}
      />

      {/* 视频加载前的兜底背景 - 始终存在确保无闪烁 */}
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{
          background: 'var(--color-void)',
          opacity: isLoaded ? 0 : 1,
        }}
      />
    </div>
  );
}
