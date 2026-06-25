import { useTranslation as useI18nTranslation } from 'react-i18next';

/**
 * Thin wrapper over react-i18next's useTranslation.
 * Exposes the same `{ t, lang }` shape the rest of the codebase expects.
 */
export function useTranslation() {
  const { t, i18n } = useI18nTranslation();
  const lang = i18n.language as 'zh' | 'en';

  return { t, lang };
}

// Re-export i18n instance for direct access (e.g. changeLanguage)
export { default as i18n } from '@/i18n';
