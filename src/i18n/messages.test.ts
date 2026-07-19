import { describe, expect, it } from 'vitest';
import en from './en.json';
import zh from './zh.json';

describe('i18n messages', () => {
  it('localizes the persistent title character limit', () => {
    expect(en.titleCharacterLimit).toContain('{{current}}/{{max}}');
    expect(en.titleCharacterLimit).toMatch(/Maximum/);
    expect(zh.titleCharacterLimit).toContain('{{current}}/{{max}}');
    expect(zh.titleCharacterLimit).toContain('最多');
  });

  it('keeps metadata weather helper copy compact enough for the drawer', () => {
    expect(en.weatherAutoHint).not.toMatch(/Weather is queried after the city resolves/);
    expect(en.weatherAutoHint.length).toBeLessThanOrEqual(42);
    expect(zh.weatherAutoHint.length).toBeLessThanOrEqual(22);
    expect(en.weatherUnavailable).toMatch(/Weather not updated/);
    expect(zh.weatherUnavailable).toMatch(/天气未更新/);
  });

  it('uses user-facing Smart capability wording instead of CLI degraded jargon', () => {
    expect(en.smartCapabilityStatus).toMatch(/Smart/i);
    expect(en.smartCapabilityStatusHint).toMatch(/Agent not connected/i);
    expect(zh.smartCapabilityStatus).toContain('Smart');
    expect(zh.smartCapabilityStatusHint).toContain('Agent 未连接');
  });
});
