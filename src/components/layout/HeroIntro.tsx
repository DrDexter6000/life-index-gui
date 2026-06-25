import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useUIStore } from '@/stores/ui';

/**
 * HeroIntro - 品牌欢迎动画
 *
 * Phase: hero �?entry
 * - 中央显示 "Life Index | 人生索引" 品牌（放�?1.6x�? * - 品牌随鼠标微�?3D 倾斜（perspective + rotateX/Y�? * - 等待视频加载 + 最小展示时�?1.5s
 * - 品牌 fly-to 左上�?+ 渐隐，overlay 消失
 *
 * 动画时序（�?2.2s）：
 *   t=0s:   品牌开�?fly-to�?s duration�? *   t=1.5s: 品牌 opacity �?0
 *   t=2.0s: 品牌到达目标位置
 *   t=2.2s: overlay unmount，setAppPhase('entry')
 */

interface HeroIntroProps {
  /** 视频是否已加载就�?*/
  videoReady: boolean;
}

export function HeroIntro({ videoReady }: HeroIntroProps) {
  const { setAppPhase, setHomeActivated } = useUIStore();
  const [isVisible, setIsVisible] = useState(true);
  const [canExit, setCanExit] = useState(false);
  const tiltRef = useRef<HTMLDivElement>(null);
  const [targetPos, setTargetPos] = useState({ x: 0, y: 0 });

  // 最小展示时�?1.5s
  useEffect(() => {
    const timer = setTimeout(() => setCanExit(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  // 当视频就绪且最小时间满足后，立即切换到 entry phase 并启动退出序列
  useEffect(() => {
    if (videoReady && canExit && isVisible) {
      const navBrand = document.querySelector('[data-hero-target="brand"]');
      if (navBrand) {
        const rect = navBrand.getBoundingClientRect();
        setTargetPos({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        });
      }
      // 立即切换到 entry phase，触发 GlobalOverlay 渐隐
      setAppPhase('entry');
      // 2200ms 后 unmount HeroIntro（fly-to 动画完成后）
      const timer = setTimeout(() => setIsVisible(false), 2200);
      return () => clearTimeout(timer);
    }
  }, [videoReady, canExit, isVisible, setAppPhase]);

  // exit 动画完成后：entry → content，触发 AnimatedOutlet 渲染路由内容
  const handleExitComplete = useCallback(() => {
    setAppPhase('content');
    setHomeActivated(true);
  }, [setAppPhase, setHomeActivated]);

  // 鼠标移动：直接操作 DOM transform，避免 React 重渲染
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!tiltRef.current) return;
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;
    const rotateX = (y - 0.5) * -20;
    const rotateY = (x - 0.5) * 20;
    tiltRef.current.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [handleMouseMove]);

  // 目标位置相对于屏幕中央的偏移
  const targetOffsetX = targetPos.x > 0 ? targetPos.x - window.innerWidth / 2 : 0;
  const targetOffsetY = targetPos.y > 0 ? targetPos.y - window.innerHeight / 2 : 0;

  return (
    <AnimatePresence onExitComplete={handleExitComplete}>
      {isVisible && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center pointer-events-none"
          style={{ backgroundColor: 'var(--color-hero-bg)' }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
        >
          {/* 品牌容器 �?外层 CSS 居中，内�?motion �?fly-to + fade-out */}
          <div
            className="fixed pointer-events-auto"
            style={{
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              perspective: '800px',
            }}
          >
            <motion.div
              style={{ transformStyle: 'preserve-3d' }}
              initial={{ scale: 1.6, x: 0, y: 0, opacity: 1 }}
              animate={{ scale: 1, x: targetOffsetX, y: targetOffsetY, opacity: 0 }}
              transition={{ duration: 2, ease: [0.23, 1, 0.32, 1] }}
            >
              {/* 3D 倾斜 — ref 直接操作 transform，避免每帧触发 React 重渲染 */}
              <div
                ref={tiltRef}
                style={{
                  transformStyle: 'preserve-3d',
                  willChange: 'transform',
                  transition: 'transform 1.2s cubic-bezier(0.23, 1, 0.32, 1)',
                }}
              >
                {/* 品牌 Logo */}
                <div className="flex items-center gap-4">
                  <div className="relative w-12 h-12 flex-shrink-0">
                    {/* Gold dot */}
                    <div
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full"
                      style={{
                        background: 'var(--color-gold)',
                        boxShadow:
                          '0 0 20px var(--color-gold-60), 0 0 40px var(--color-gold-30)',
                      }}
                    />
                    {/* Ring */}
                    <div
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border-[2px]"
                      style={{ borderColor: 'var(--color-gold-25)' }}
                    />
                    {/* Breathing halo */}
                    <div
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full border border-[rgba(201,176,127,0.08)] animate-orb-breathe"
                    />
                  </div>
                  <span
                    className="text-3xl font-normal tracking-[0.15em] uppercase whitespace-nowrap max-[360px]:whitespace-normal"
                    style={{
                      fontFamily: 'var(--font-divine)',
                      color: 'var(--color-primary)',
                      textShadow:
                        '0 0 40px var(--color-gold-30), 0 0 80px var(--color-gold-15), 0 0 120px var(--color-antique-gold-10)',
                    }}
                  >
                    Life Index
                  </span>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
