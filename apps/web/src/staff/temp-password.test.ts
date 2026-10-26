import { TEMP_PASSWORD_ALPHABET, TEMP_PASSWORD_PATTERN } from '@buhuchet/domain';
import { describe, expect, it } from 'vitest';
import { suggestTemporaryPassword } from './temp-password';

describe('временный пароль в окне «Новый сотрудник» (docs/deviations.md, п. 17)', () => {
  it('вид Bh-XXXX-XXXX из алфавита временных паролей, не короче 8 символов', () => {
    const value = suggestTemporaryPassword();
    expect(value).toMatch(TEMP_PASSWORD_PATTERN);
    expect(value.length).toBeGreaterThanOrEqual(8);
  });

  it('байты из «хвоста» отбрасываются: буквы без перекоса', () => {
    const n = TEMP_PASSWORD_ALPHABET.length;
    const limit = 256 - (256 % n);
    // Сначала байт за пределом (отброшен), потом 0 — первая буква алфавита.
    const bytes = [limit, 0, 1, 2, 3, 4, 5, 6, 7];
    const value = suggestTemporaryPassword(() => bytes.shift()!);
    expect(value.slice(3, 4)).toBe(TEMP_PASSWORD_ALPHABET[0]);
    expect(bytes).toHaveLength(0);
  });

  it('разные вызовы — разные пароли', () => {
    const seen = new Set(Array.from({ length: 20 }, () => suggestTemporaryPassword()));
    expect(seen.size).toBe(20);
  });
});
