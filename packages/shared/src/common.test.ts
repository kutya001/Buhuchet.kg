import { describe, expect, it } from 'vitest';
import { IsoDate, Tyiyn } from './common';
import { HealthResponse } from './system';

describe('общие схемы', () => {
  it('IsoDate принимает только YYYY-MM-DD', () => {
    expect(IsoDate.safeParse('2026-10-25').success).toBe(true);
    expect(IsoDate.safeParse('25.10.2026').success).toBe(false);
  });

  it('Tyiyn — только целые', () => {
    expect(Tyiyn.safeParse(125050).success).toBe(true);
    expect(Tyiyn.safeParse(1250.5).success).toBe(false);
  });

  it('HealthResponse', () => {
    const ok = HealthResponse.safeParse({
      status: 'ok',
      version: '0.0.0',
      environment: 'local',
      time: '2026-10-25T10:00:00.000Z',
      todayBishkek: '2026-10-25',
      checks: { database: 'ok', storage: 'ok' },
    });
    expect(ok.success).toBe(true);
  });
});
