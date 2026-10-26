import { describe, expect, it } from 'vitest';
import {
  formatTemporaryPassword,
  isResetCodeShape,
  RESET_CODE_MAX_PER_HOUR,
  RESET_CODE_TTL_MINUTES,
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_PATTERN,
} from './reset';

describe('«Забыли пароль?»', () => {
  it('код действует 10 минут, не больше 3 кодов в час (ТЗ)', () => {
    expect(RESET_CODE_TTL_MINUTES).toBe(10);
    expect(RESET_CODE_MAX_PER_HOUR).toBe(3);
  });

  it('код — ровно 6 цифр', () => {
    expect(isResetCodeShape('482913')).toBe(true);
    expect(isResetCodeShape('48291')).toBe(false);
    expect(isResetCodeShape('4829134')).toBe(false);
    expect(isResetCodeShape('48291a')).toBe(false);
    expect(isResetCodeShape(' 482913')).toBe(false);
  });
});

describe('временный пароль', () => {
  it('Bh- и 8 знаков без похожих друг на друга', () => {
    const p = formatTemporaryPassword('7K4MQ9TX');
    expect(p).toBe('Bh-7K4M-Q9TX');
    expect(TEMP_PASSWORD_PATTERN.test(p)).toBe(true);
    expect(TEMP_PASSWORD_ALPHABET).not.toMatch(/[01ILO]/);
    expect(p.length).toBeGreaterThanOrEqual(8);
  });

  it('другая длина или чужие знаки — ошибка', () => {
    expect(() => formatTemporaryPassword('7K4MQ9T')).toThrow();
    expect(() => formatTemporaryPassword('7K4MQ9T0')).toThrow();
    expect(() => formatTemporaryPassword('7k4mq9tx')).toThrow();
  });
});
