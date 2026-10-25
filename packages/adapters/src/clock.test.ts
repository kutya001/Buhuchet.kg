import { describe, expect, it } from 'vitest';
import { clockFromConfig, fixedClock, systemClock } from './clock';

describe('clock', () => {
  it('fixedClock стоит на месте и считает «сегодня» по Бишкеку', () => {
    const clock = fixedClock('2026-10-18T19:30:00Z');
    expect(clock.now().toISOString()).toBe('2026-10-18T19:30:00.000Z');
    expect(clock.today()).toBe('2026-10-19');
    clock.advance(60_000);
    expect(clock.now().toISOString()).toBe('2026-10-18T19:31:00.000Z');
    clock.set('2026-01-01T00:00:00Z');
    expect(clock.today()).toBe('2026-01-01');
  });

  it('отказывает неверной дате', () => {
    expect(() => fixedClock('вчера')).toThrow(RangeError);
  });

  it('clockFromConfig', () => {
    expect(clockFromConfig({}).now).toBe(systemClock.now);
    expect(clockFromConfig({ FIXED_NOW: '2026-10-18T06:00:00Z' }).today()).toBe('2026-10-18');
    expect(systemClock.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
