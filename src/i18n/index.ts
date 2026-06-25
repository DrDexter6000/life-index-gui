import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import zh from './zh.json';
import en from './en.json';

/**
 * i18next initialization — FOUC-safe by design:
 * - Translation JSONs are bundled (synchronous, no network fetch)
 * - LanguageDetector reads localStorage synchronously
 * - init() completes synchronously before React renders
 * - Runtime language changes are atomic via react-i18next re-renders
 */
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
    },
    fallbackLng: 'zh',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'life-index-lang',
      caches: ['localStorage'],
    },
  });

export default i18n;
