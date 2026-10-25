import { describe, expect, it } from 'vitest';
import { apiErrorCode, IsoDate, isRecordChanged, Tyiyn } from './common';
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

describe('ошибки API', () => {
  it('код ошибки из ответа в общем формате', () => {
    const conflict = {
      error: { code: 'record_changed', message: 'Запись изменена другим пользователем' },
    };
    expect(apiErrorCode(conflict)).toBe('record_changed');
    expect(isRecordChanged(conflict)).toBe(true);
    expect(isRecordChanged({ error: { code: 'not_found', message: 'Запись не найдена' } })).toBe(
      false,
    );
    expect(apiErrorCode({ id: 1 })).toBeNull();
    expect(isRecordChanged(null)).toBe(false);
  });
});
