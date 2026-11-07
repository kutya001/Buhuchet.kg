import { describe, expect, it } from 'vitest';
import {
  formatTemporaryPassword,
  isResetCodeShape,
  relinkCodeOf,
  RESET_CODE_MAX_PER_HOUR,
  RESET_CODE_TTL_MINUTES,
  TELEGRAM_RELINK_CODE_TTL_MINUTES,
  TELEGRAM_RELINK_FREE_HOURS,
  TELEGRAM_RELINK_MAX_ATTEMPTS,
  TELEGRAM_RELINK_MAX_DAILY_FAILURES,
  TELEGRAM_RELINK_MAX_PER_HOUR,
  telegramRelinkNeedsCode,
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

describe('замена Telegram кодом из прежнего чата (Р-13 Б, docs/deviations.md п. О-20)', () => {
  it('пределы — как у кода «Забыли пароль?»; без кода — сутки после сброса пароля', () => {
    expect(TELEGRAM_RELINK_CODE_TTL_MINUTES).toBe(10);
    expect(TELEGRAM_RELINK_MAX_PER_HOUR).toBe(3);
    expect(TELEGRAM_RELINK_MAX_ATTEMPTS).toBe(5);
    expect(TELEGRAM_RELINK_MAX_DAILY_FAILURES).toBe(10);
    expect(TELEGRAM_RELINK_FREE_HOURS).toBe(24);
  });

  it('код нужен, только когда прежний чат есть, он другой и замена без кода не разрешена', () => {
    expect(telegramRelinkNeedsCode({ confirmChatId: 1, relinkFree: false }, 2)).toBe(true);
    expect(telegramRelinkNeedsCode({ confirmChatId: 1, relinkFree: false }, 1)).toBe(false);
    expect(telegramRelinkNeedsCode({ confirmChatId: null, relinkFree: false }, 2)).toBe(false);
    expect(telegramRelinkNeedsCode({ confirmChatId: 1, relinkFree: true }, 2)).toBe(false);
  });

  it('код в сообщении боту: 6 цифр, пробелы и дефисы не мешают', () => {
    expect(relinkCodeOf('482913')).toBe('482913');
    expect(relinkCodeOf(' 482 913 ')).toBe('482913');
    expect(relinkCodeOf('482-913')).toBe('482913');
    expect(relinkCodeOf('48291')).toBeNull();
    expect(relinkCodeOf('код 482913')).toBeNull();
    expect(relinkCodeOf('привет')).toBeNull();
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
