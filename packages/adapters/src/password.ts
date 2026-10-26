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

/**
 * Подставной хеш: argon2id с параметрами OPTIONS от случайной строки, которую никто не знает (она не
 * сохранялась). Посчитан заранее, чтобы и первый запрос после запуска сервера проверялся так же долго,
 * как настоящий пароль. Параметры сверяет тест: при смене OPTIONS хеш нужно посчитать заново.
 */
export const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$H/xWfpSqx0Ms5GpUMBha4A$7uLTcw3OdIY4jn61kHIFshXyxbrHoicw+UKOQL9Smi4';

async function verifyDummy(password: string): Promise<void> {
  try {
    await verify(DUMMY_HASH, password);
  } catch {
    // Подставной хеш не может не подойти по формату; ответ всё равно «не подходит».
  }
}

/**
 * Неверный или испорченный хеш — просто «пароль не подходит». Испорченный хеш (у демо-сотрудника без
 * DEMO_PASSWORD — «!») проверяется так же долго, как настоящий: по времени ответа не видно, какие
 * логины есть (docs/deviations.md, п. 4).
 */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    await verifyDummy(password);
    return false;
  }
}

/**
 * Проверка пароля, когда логина нет: та же работа argon2 по подставному хешу, ответ — всегда «не
 * подходит». Так по времени ответа не понять, есть ли такой логин.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  await verifyDummy(password);
  return false;
}

/** Без похожих символов (0/O, 1/l/I), чтобы временный пароль легко продиктовать. */
const TEMP_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Временный пароль: при следующем входе пользователь обязан сменить его. */
export function generateTemporaryPassword(length = 12): string {
  let out = '';
  for (let i = 0; i < length; i++) out += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)];
  return out;
}
