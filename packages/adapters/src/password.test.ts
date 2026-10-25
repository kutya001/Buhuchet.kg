import { describe, expect, it } from 'vitest';
import { generateTemporaryPassword, hashPassword, verifyPassword } from './password';

describe('пароли', () => {
  it('хеш argon2id с солью: тот же пароль даёт разные хеши, оба проверяются', async () => {
    const a = await hashPassword('Секрет-123');
    const b = await hashPassword('Секрет-123');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'Секрет-123')).toBe(true);
    expect(await verifyPassword(b, 'Секрет-123')).toBe(true);
    expect(await verifyPassword(a, 'секрет-123')).toBe(false);
  });

  it('испорченный хеш — пароль не подходит, без исключения', async () => {
    expect(await verifyPassword('не хеш', 'x')).toBe(false);
  });

  it('временный пароль: 12 символов без похожих букв и цифр, каждый раз новый', () => {
    const p = generateTemporaryPassword();
    expect(p).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{12}$/);
    expect(generateTemporaryPassword()).not.toBe(p);
    expect(generateTemporaryPassword(20)).toHaveLength(20);
  });
});
