import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { i18n } from '@/hooks/useTranslation';

export type ViewMode = 'default' | 'zen' | 'archivist';
export type Lang = 'zh' | 'en';
export type AppPhase = 'hero' | 'entry' | 'content';

const LANGUAGE_STORAGE_KEY = 'life-index-lang';
const LEGACY_LANGUAGE_STORAGE_KEY = 'lang';

function getInitialLang(): Lang {
  return (
    (localStorage.getItem(LANGUAGE_STORAGE_KEY) as Lang | null)
    ?? (localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY) as Lang | null)
    ?? 'zh'
  );
}

interface UIState {
  theme: 'dark';
  sidebarOpen: boolean;
  activeView: ViewMode;
  isEtherDissolve: boolean;
  mobileMenuOpen: boolean;
  lang: Lang;
  appPhase: AppPhase;
  homeActivated: boolean;
}

interface UIActions {
  toggleSidebar: () => void;
  setActiveView: (view: ViewMode) => void;
  toggleEtherDissolve: () => void;
  enterEtherDissolve: () => void;
  exitEtherDissolve: () => void;
  toggleMobileMenu: () => void;
  closeMobileMenu: () => void;
  toggleLang: () => void;
  setLang: (lang: Lang) => void;
  setAppPhase: (phase: AppPhase) => void;
  setHomeActivated: (active: boolean) => void;
  resetHome: () => void;
}

const initialState: UIState = {
  theme: 'dark',
  sidebarOpen: false,
  activeView: 'default',
  isEtherDissolve: false,
  mobileMenuOpen: false,
  lang: getInitialLang(),
  appPhase: 'content',
  homeActivated: false,
};

const createUIStore = () => create<UIState & UIActions>()(
  immer((set) => ({
    ...initialState,

    toggleSidebar: () =>
      set((state) => {
        state.sidebarOpen = !state.sidebarOpen;
      }),

    setActiveView: (view) =>
      set((state) => {
        state.activeView = view;
      }),

    toggleEtherDissolve: () =>
      set((state) => {
        state.isEtherDissolve = !state.isEtherDissolve;
      }),

    enterEtherDissolve: () =>
      set((state) => {
        state.isEtherDissolve = true;
      }),

    exitEtherDissolve: () =>
      set((state) => {
        state.isEtherDissolve = false;
      }),

    toggleMobileMenu: () =>
      set((state) => {
        state.mobileMenuOpen = !state.mobileMenuOpen;
      }),

    closeMobileMenu: () =>
      set((state) => {
        state.mobileMenuOpen = false;
      }),

    toggleLang: () =>
      set((state) => {
        const next = state.lang === 'zh' ? 'en' : 'zh';
        state.lang = next;
        i18n.changeLanguage(next);
        localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
      }),

    setLang: (lang) =>
      set((state) => {
        state.lang = lang;
        i18n.changeLanguage(lang);
        localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
      }),

    setAppPhase: (phase) =>
      set((state) => {
        state.appPhase = phase;
      }),

    setHomeActivated: (active) =>
      set((state) => {
        state.homeActivated = active;
      }),

    resetHome: () =>
      set((state) => {
        state.homeActivated = false;
        state.isEtherDissolve = false;
      }),
  }))
);

type UIStore = ReturnType<typeof createUIStore>;

const globalUIStore = globalThis as typeof globalThis & {
  __lifeIndexUIStore?: UIStore;
};

export const useUIStore = globalUIStore.__lifeIndexUIStore ?? (
  globalUIStore.__lifeIndexUIStore = createUIStore()
);
