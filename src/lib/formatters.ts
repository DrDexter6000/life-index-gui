/**
 * Date formatters for Life Index GUI
 * Uses BIS design language
 */

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  // Within last minute
  if (diffMins < 1) {
    return '刚刚';
  }

  // Within last hour
  if (diffHours < 1) {
    return `${diffMins}分钟前`;
  }

  // Within last 24 hours
  if (diffDays < 1) {
    return `${diffHours}小时前`;
  }

  // Yesterday
  if (diffDays === 1) {
    return '昨天';
  }

  // Within last 7 days
  if (diffDays < 7) {
    return `${diffDays}天前`;
  }

  // Same year
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  // Different year
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${formatDate(date)} ${hours}:${minutes}`;
}

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function formatDateShort(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${month}月${day}日`;
}

export function formatDateParts(date: string | Date): { monthAbbr: string; dayNum: string } {
  const d = typeof date === 'string' ? new Date(date) : date;
  return {
    monthAbbr: MONTH_ABBR[d.getMonth()],
    dayNum: d.getDate().toString().padStart(2, '0'),
  };
}

export function formatDateISO(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
}

/**
 * Number formatters
 */
export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}k`;
  }
  return num.toString();
}

export function formatWordCount(count: number): string {
  if (count === 0) return '0字';
  if (count < 1000) return `${count}字`;
  return `${(count / 1000).toFixed(1)}k字`;
}

/**
 * Mood formatters - BIS naming
 */
export type MoodType = 'gold' | 'cyan' | 'coral';

export interface MoodConfig {
  label: string;
  color: MoodType;
  emoji: string;
}

export const MOOD_MAP: Record<string, MoodConfig> = {
  'happy': { label: '愉悦', color: 'gold', emoji: '😊' },
  'excited': { label: '兴奋', color: 'gold', emoji: '🎉' },
  'content': { label: '惬意', color: 'gold', emoji: '☕' },
  'calm': { label: '平静', color: 'cyan', emoji: '🌊' },
  'focused': { label: '专注', color: 'cyan', emoji: '🎯' },
  'curious': { label: '好奇', color: 'cyan', emoji: '🔍' },
  'anxious': { label: '焦虑', color: 'coral', emoji: '😰' },
  'sad': { label: '低落', color: 'coral', emoji: '😢' },
  'tired': { label: '疲惫', color: 'coral', emoji: '😴' },
  'grateful': { label: '感恩', color: 'gold', emoji: '🙏' },
  'inspired': { label: '灵感', color: 'cyan', emoji: '💡' },
  'nostalgic': { label: '回望', color: 'coral', emoji: '🌙' },
};

export function getMoodConfig(mood: string): MoodConfig {
  return MOOD_MAP[mood] || { label: mood, color: 'cyan', emoji: '✨' };
}

export function formatMood(mood: string): string {
  const config = getMoodConfig(mood);
  return `${config.emoji} ${config.label}`;
}

/**
 * Topic formatters
 */
/** Topic display names — English key → Chinese name */
export const TOPIC_NAMES: Record<string, string> = {
  'work': '工作',
  'learn': '学习',
  'health': '健康',
  'relation': '关系',
  'think': '思考',
  'create': '创造',
  'life': '生活',
  'travel': '旅行',
  'read': '阅读',
  'inspiration': '灵感',
};

/** Topic color mapping — supports both English and Chinese keys */
export const TOPIC_COLORS: Record<string, string> = {
  'work': 'gold', '工作': 'gold',
  'learn': 'cyan', '学习': 'cyan',
  'health': 'coral', '健康': 'coral',
  'relation': 'coral', '关系': 'coral',
  'think': 'cyan', '思考': 'cyan',
  'create': 'gold', '创造': 'gold',
  'life': 'gold', '生活': 'gold',
  'travel': 'cyan', '旅行': 'cyan',
  'read': 'cyan', '阅读': 'cyan',
  'inspiration': 'gold', '灵感': 'gold',
};

export function getTopicColor(topic: string): string {
  return TOPIC_COLORS[topic] || 'cyan';
}

export function getTopicName(topic: string): string {
  return TOPIC_NAMES[topic] || topic;
}

/**
 * BIS text helpers
 */
export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 9) return '早安';
  if (hour < 12) return '上午好';
  if (hour < 14) return '午安';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function getWelcomeMessage(): string {
  return 'Welcome back, Deep Diver';
}

/**
 * Search result highlighting
 */
export function highlightMatch(text: string, query: string): string {
  if (!query) return text;
  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  return text.replace(regex, '<mark class="bg-[var(--color-gold)]/20 text-[var(--color-gold)]">$1</mark>');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
