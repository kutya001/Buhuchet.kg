import { describe, expect, it } from 'vitest';
import { hashSessionToken, isSessionTokenShape, newSessionToken } from './tokens';

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
