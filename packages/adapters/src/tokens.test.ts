import { describe, expect, it } from 'vitest';
import { isResetCodeShape, TEMP_PASSWORD_PATTERN } from '@buhuchet/domain';
import {
  hashSessionToken,
  isSessionTokenShape,
  newLinkToken,
  newResetCode,
  newSessionToken,
  newTemporaryPassword,
} from './tokens';

describe('токен сеанса', () => {
  it('32 случайных байта в base64url, каждый раз новый', () => {
    const a = newSessionToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isSessionTokenShape(a)).toBe(true);
    expect(newSessionToken()).not.toBe(a);
  });

  it('в базу — SHA-256 в hex, один и тот же для одного токена', () => {
    const token = newSessionToken();
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toBe(hashSessionToken(newSessionToken()));
  });

  it('мусор вместо токена отбрасывается', () => {
    for (const v of ['', 'abc', 'a'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)}.`]) {
      expect(isSessionTokenShape(v)).toBe(false);
    }
  });
});

describe('ссылка Telegram, код и временный пароль', () => {
  it('токен ссылки годится для t.me/бот?start=… (до 64 знаков A–Z, a–z, 0–9, _ и -)', () => {
    expect(newLinkToken()).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('код — 6 цифр, каждый раз свой', () => {
    const codes = new Set(Array.from({ length: 50 }, () => newResetCode()));
    for (const code of codes) expect(isResetCodeShape(code)).toBe(true);
    expect(codes.size).toBeGreaterThan(40);
  });

  it('временный пароль — Bh-XXXX-XXXX, каждый раз свой', () => {
    const a = newTemporaryPassword();
    expect(a).toMatch(TEMP_PASSWORD_PATTERN);
    expect(newTemporaryPassword()).not.toBe(a);
  });
});
