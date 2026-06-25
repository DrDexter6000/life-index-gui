/**
 * 能力开关。只有 lead/owner 决策可以翻转。
 * archivesDashboard: 面板打磨重启前保持 false（显示 coming-soon）。
 */
export const featureFlags = {
  archivesDashboard: false,
} as const;
