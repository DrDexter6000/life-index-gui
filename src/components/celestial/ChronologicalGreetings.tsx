import { useTranslation } from '@/hooks/useTranslation';

function getGreetingKeys(): { cn: string; en: string } {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 12) {
    return { cn: 'chronologicalGreetingMorningCn', en: 'chronologicalGreetingMorningEn' };
  }
  if (hour >= 12 && hour < 18) {
    return { cn: 'chronologicalGreetingAfternoonCn', en: 'chronologicalGreetingAfternoonEn' };
  }
  if (hour >= 18 && hour < 24) {
    return { cn: 'chronologicalGreetingNightCn', en: 'chronologicalGreetingNightEn' };
  }
  return { cn: 'chronologicalGreetingLateNightCn', en: 'chronologicalGreetingLateNightEn' };
}

/**
 * ChronologicalGreetings — time-aware BIS write-page bilingual greeting.
 * Switches copy based on the hour of day, matching the original prototype.
 */
export function ChronologicalGreetings() {
  const { t, lang } = useTranslation();
  const keys = getGreetingKeys();
  const cn = t(keys.cn);
  const en = t(keys.en);
  const isEnglish = lang === 'en';
  const primary = isEnglish ? en : cn;
  const secondary = isEnglish ? cn : en;

  return (
    <div className="home-greeting relative text-center px-8 max-[640px]:px-4">
      {/* Radial backdrop */}
      <div
        className="absolute inset-0 rounded-3xl pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.12) 50%, transparent 80%)',
        }}
      />
      <p
        data-testid="chronological-greeting-primary"
        className={`li-page-title relative ${isEnglish ? 'home-greeting-title--en' : ''}`}
        style={{
          fontFamily: 'var(--font-narrative)',
        }}
      >
        {primary}
      </p>
      <p
        data-testid="chronological-greeting-secondary"
        className={`li-page-subtitle li-page-subtitle--code relative home-greeting-subtitle ${
          isEnglish ? '' : 'uppercase'
        }`}
        style={{
          fontFamily: isEnglish ? 'var(--font-narrative)' : 'var(--font-order)',
          opacity: 0.62,
        }}
      >
        {secondary}
      </p>
    </div>
  );
}
