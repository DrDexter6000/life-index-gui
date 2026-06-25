import { memo } from 'react';
import { useLocation } from 'react-router';
import { motion } from 'motion/react';
import { useUIStore } from '@/stores/ui';

/**
 * GlobalOverlay - 全局黑色遮罩动画层
 *
 * 参与 appPhase 过渡动画：
 *   hero:    opacity 0.98（几乎全黑，遮住背景视频）
 *   entry:   opacity 0（完全透明，背景视频完全可见）
 *   content: 除 The Core 待机 Hero Screen 外，所有界面 opacity 0.68
 *
 * z-index: 1，位于 VideoBackground(0) 之上、ParticleCanvas(2) 与内容(10) 之下
 */
export const GlobalOverlay = memo(function GlobalOverlay() {
  const { appPhase, homeActivated } = useUIStore();
  const location = useLocation();
  const routeKey = location.pathname.split('/')[1] || 'home';
  const isHeroScreen = appPhase === 'content' && routeKey === 'home' && !homeActivated;

  const targetOpacity =
    appPhase === 'hero' ? 0.98
    : appPhase === 'entry' ? 0
    : isHeroScreen ? 0
    : 0.68;

  const duration = appPhase === 'entry' ? 2 : 1.5;

  return (
    <motion.div
      className="fixed inset-0 pointer-events-none"
      style={{
        zIndex: 1,
        backgroundColor: 'black',
      }}
      initial={false}
      animate={{ opacity: targetOpacity }}
      transition={{
        duration,
        ease: [0.23, 1, 0.32, 1],
      }}
    />
  );
});
