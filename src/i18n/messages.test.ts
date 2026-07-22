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

  it('localizes geolocation permission guidance without exposing provider errors', () => {
    expect(en.locationPermissionUnavailable).toMatch(/permission/i);
    expect(en.locationPermissionUnavailable).toMatch(/manually/i);
    expect(zh.locationPermissionUnavailable).toContain('位置权限');
    expect(zh.locationPermissionUnavailable).toContain('手动填写');
  });

  it('uses user-facing Smart capability wording instead of CLI degraded jargon', () => {
    expect(en.smartCapabilityStatus).toMatch(/Smart/i);
    expect(en.smartCapabilityStatusHint).toMatch(/Agent not connected/i);
    expect(zh.smartCapabilityStatus).toContain('Smart');
    expect(zh.smartCapabilityStatusHint).toContain('Agent 未连接');
  });

  it('localizes the compact partial metadata fill summary', () => {
    expect(en.metadataAgentUnfilledSummary).toBe('Not filled: {{fields}}');
    expect(zh.metadataAgentUnfilledSummary).toBe('未填入：{{fields}}');
    expect(en.metadataProposalPreserved).toBe('Preserved');
    expect(zh.metadataProposalPreserved).toBe('已保留');
    expect(en.metadataAgentStatusPartial).toBe('Partially filled');
    expect(zh.metadataAgentStatusPartial).toBe('部分填充');
    expect(en.metadataAgentStatusReviewed).toBe('Processed');
    expect(zh.metadataAgentStatusReviewed).toBe('已处理');
    expect(en.metadataAgentStatusStale).toBe('Expired');
    expect(zh.metadataAgentStatusStale).toBe('已过期');
  });
});
