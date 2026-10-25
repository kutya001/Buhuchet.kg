import { randomInt } from 'node:crypto';
import { hash, verify, type Algorithm, type Options } from '@node-rs/argon2';

/**
 * Пароли — хеш argon2id (ТЗ «Вход и сеансы — свои»): 19 МиБ памяти, 2 прохода, 1 поток —
 * рекомендация OWASP. Параметры записаны в самом хеше, поэтому их можно поднять без миграции.
 */
const OPTIONS: Options = {
  // Algorithm.Argon2id; const enum из .d.ts недоступен при isolatedModules.
  algorithm: 2 as Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

/** Неверный или испорченный хеш — просто «пароль не подходит». */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Без похожих символов (0/O, 1/l/I), чтобы временный пароль легко продиктовать. */
const TEMP_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Временный пароль: при следующем входе пользователь обязан сменить его. */
export function generateTemporaryPassword(length = 12): string {
  let out = '';
  for (let i = 0; i < length; i++) out += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
  return out;
}
