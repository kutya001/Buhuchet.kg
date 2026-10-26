import { formatTemporaryPassword, TEMP_PASSWORD_ALPHABET } from '@buhuchet/domain';

/** Случайное целое от 0 до n − 1 без перекоса: лишние значения байта отбрасываются. */
function randomBelow(n: number, bytes: () => number): number {
  const limit = 256 - (256 % n);
  for (;;) {
    const b = bytes();
    if (b < limit) return b % n;
  }
}

/** Случайный байт из генератора браузера (Web Crypto). */
function cryptoByte(): number {
  return crypto.getRandomValues(new Uint8Array(1))[0]!;
}

/**
 * Временный пароль для поля «Новый сотрудник» (прототип empAddDlg заполнял поле сам): вид
 * `Bh-7K4M-Q9TX`, как при сбросе пароля (docs/deviations.md, п. 7 и 17). Владелец может заменить его
 * своим не короче 8 символов.
 */
export function suggestTemporaryPassword(bytes: () => number = cryptoByte): string {
  let chars = '';
  for (let i = 0; i < 8; i++)
    chars += TEMP_PASSWORD_ALPHABET[randomBelow(TEMP_PASSWORD_ALPHABET.length, bytes)];
  return formatTemporaryPassword(chars);
}
