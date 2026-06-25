const STORAGE_KEY = 'li-scroll-positions';

/**
 * Save a scroll position to sessionStorage.
 * Silently degrades if sessionStorage is unavailable.
 */
export function saveScrollPosition(key: string, y: number): void {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const map: Record<string, number> = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    map[key] = y;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Silent downgrade — storage quota or private mode
  }
}

/**
 * Read a previously saved scroll position from sessionStorage.
 * Returns null if the key is unknown or storage is unavailable.
 */
export function readScrollPosition(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const map: Record<string, number> = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return typeof map[key] === 'number' ? map[key] : null;
  } catch {
    return null;
  }
}
