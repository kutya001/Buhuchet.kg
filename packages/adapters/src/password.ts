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

/**
 * Очередь работы argon2 (ревью безопасности 06.11.2026, п. Р-4): каждая проверка или хеш занимает
 * 19 МиБ и процессор, поэтому одновременно идут не больше PASSWORD_CONCURRENCY, остальные ждут своей
 * очереди; если ждущих уже PASSWORD_QUEUE_MAX — сразу `PasswordBusyError` (API отвечает 503 «Сервер
 * занят»), а не очередь без конца. Так поток запросов входа не съест память и не задержит остальные
 * запросы сайта. Очередь — на один процесс; общий предел по адресу — в API.
 */
export const PASSWORD_CONCURRENCY = 2;
export const PASSWORD_QUEUE_MAX = 32;

/** Очередь проверки паролей переполнена: попробовать чуть позже. */
export class PasswordBusyError extends Error {
  constructor() {
    super('Очередь проверки паролей переполнена');
    this.name = 'PasswordBusyError';
  }
}

let running = 0;
const waiting: Array<() => void> = [];

/**
 * Очередь полна: новая работа argon2 сейчас получила бы `PasswordBusyError`. Нужна тем, кто до
 * проверки тратит что-то невосстановимое (попытку ввода кода «Забыли пароль?»).
 */
export function passwordQueueFull(): boolean {
  return running >= PASSWORD_CONCURRENCY && waiting.length >= PASSWORD_QUEUE_MAX;
}

/** Выполнить работу argon2 в очереди (экспорт — для тестов). */
export async function inPasswordQueue<T>(work: () => Promise<T>): Promise<T> {
  if (running >= PASSWORD_CONCURRENCY) {
    if (waiting.length >= PASSWORD_QUEUE_MAX) throw new PasswordBusyError();
    // Место передаёт закончивший: running не уменьшается, пока очередь не пуста.
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    running++;
  }
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

export function hashPassword(password: string): Promise<string> {
  return inPasswordQueue(() => hash(password, OPTIONS));
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
    await inPasswordQueue(() => verify(DUMMY_HASH, password));
  } catch (err) {
    if (err instanceof PasswordBusyError) throw err;
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
    return await inPasswordQueue(() => verify(passwordHash, password));
  } catch (err) {
    if (err instanceof PasswordBusyError) throw err;
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
