import { useEffect, useRef, useCallback } from 'react';

const SAMPLE_FRAGMENTS = [
  { text: '今夜的风穿过阳台，带来远处海潮的气息。', date: '2024.03' },
  { text: '在地铁里读到一首诗，忽然觉得整个世界都安静了。', date: '2024.05' },
  { text: '咖啡凉了，但思路忽然清晰起来。', date: '2024.06' },
  { text: '雨后的街道反射着霓虹，像一条通往过去的河。', date: '2024.08' },
  { text: '那个问题想了整整一周，答案竟在一个梦中浮现。', date: '2024.09' },
  { text: '旧书页间的批注，是十年前的自己在说话。', date: '2024.11' },
  { text: '凌晨三点，窗外的城市仍在呼吸。', date: '2025.01' },
  { text: '整理书架时发现一张便签，上面只有两个字：坚持。', date: '2025.02' },
];

/**
 * MemoryFragments — Floating historical journal quotes on hero screen
 * 16s animation cycle: 4s emerge / 8s linger / 4s dissolve
 * Spawn interval: 6-9s, max 4 concurrent
 */
export function MemoryFragments({ enabled = true }: { enabled?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeAnimationsRef = useRef<Animation[]>([]);

  // 使用 ref 存储 spawnFragment，避免 useCallback 循环依赖
  const spawnFragmentRef = useRef<() => void>(() => {});

  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => spawnFragmentRef.current(), 6000 + Math.random() * 3000);
  }, []);

  const spawnFragment = useCallback(() => {
    if (!containerRef.current || !enabled) return;

    // Limit to 4 concurrent fragments
    const existing = containerRef.current.querySelectorAll('.memory-fragment');
    if (existing.length >= 4) {
      scheduleNext();
      return;
    }

    const fragment = SAMPLE_FRAGMENTS[Math.floor(Math.random() * SAMPLE_FRAGMENTS.length)];

    // Random position: avoid center (video focal point) and edges
    const x = 8 + Math.random() * 70; // 8% - 78%
    const y = 25 + Math.random() * 50; // 25% - 75%

    const el = document.createElement('p');
    el.className = 'memory-fragment';
    el.innerHTML = `&ldquo;${fragment.text}&rdquo; <span class="memory-date">${fragment.date}</span>`;
    el.style.cssText = `
      position: absolute;
      left: ${x}%;
      top: ${y}%;
      font-family: var(--font-narrative);
      font-size: 0.9375rem;
      line-height: 1.6;
      color: rgba(232,234,240,0.5);
      max-width: 280px;
      pointer-events: none;
      opacity: 0;
      transform: translateY(12px);
      will-change: opacity, transform;
      contain: layout paint style;
      z-index: 5;
    `;

    containerRef.current.appendChild(el);

    // Animate: 4s emerge / 8s linger / 4s dissolve = 16s total
    const anim = el.animate([
      { opacity: 0, transform: 'translateY(12px)' },
      { opacity: 0, transform: 'translateY(8px)', offset: 0.125 },
      { opacity: 0.45, transform: 'translateY(0)', offset: 0.3125 },
      { opacity: 0.5, transform: 'translateY(-3px)', offset: 0.75 },
      { opacity: 0.3, transform: 'translateY(-6px)', offset: 0.875 },
      { opacity: 0, transform: 'translateY(-10px)' },
    ], {
      duration: 16000,
      easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
      fill: 'forwards',
    });

    activeAnimationsRef.current.push(anim);

    anim.onfinish = () => {
      el.remove();
      activeAnimationsRef.current = activeAnimationsRef.current.filter(a => a !== anim);
    };

    scheduleNext();
  }, [enabled, scheduleNext]);

  // 保持 ref 与最新 spawnFragment 同步
  useEffect(() => {
    spawnFragmentRef.current = spawnFragment;
  }, [spawnFragment]);

  useEffect(() => {
    if (!enabled) return;

    // 后台时暂停定时器，恢复时重启
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // 页面隐藏：取消待执行的定时器
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = undefined;
        }
        // 暂停所有活跃的 Web Animations
        activeAnimationsRef.current.forEach(a => a.pause());
      } else {
        // 页面恢复：恢复暂停的动画并重启定时器链
        activeAnimationsRef.current.forEach(a => a.play());
        scheduleNext();
      }
    };

    // Initial delay before first fragment
    timerRef.current = setTimeout(spawnFragment, 3000);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      // 清理所有残留动画
      activeAnimationsRef.current.forEach(a => a.cancel());
      activeAnimationsRef.current = [];
    };
  }, [enabled, spawnFragment, scheduleNext]);

  if (!enabled) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 5 }}
      aria-hidden="true"
    />
  );
}
