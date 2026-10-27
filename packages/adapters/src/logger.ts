import { pino, type Logger } from 'pino';

export type { Logger };

/** Поля, которые никогда не попадают в журнал, на любом уровне вложенности до трёх. */
const SECRET_KEYS = [
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'password_hash',
  'temporaryPassword',
  'token',
  'accessToken',
  'refreshToken',
  'sessionToken',
  'apiKey',
  'secret',
  'secretAccessKey',
  'otpCode',
  'accessCode',
  'cookie',
  'authorization',
  'DATABASE_URL',
  'DATABASE_ADMIN_URL',
  'S3_SECRET_ACCESS_KEY',
  'CRON_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'DEMO_PASSWORD',
  'PLATFORM_ADMIN_PASSWORD',
  // Поля тела ошибки S3, которые SDK копирует в объект ошибки (подпись запроса).
  'AWSAccessKeyId',
  'StringToSign',
  'StringToSignBytes',
  'CanonicalRequest',
  'CanonicalRequestBytes',
  'SignatureProvided',
];
const SECRET_HEADERS = ['set-cookie', 'x-telegram-bot-api-secret-token'];

export const REDACT_PATHS = [
  ...SECRET_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
  ...SECRET_HEADERS.flatMap((h) => [`headers["${h}"]`, `*.headers["${h}"]`]),
];

type QueryError = Error & {
  query: unknown;
  params: unknown;
  cause?: { code?: string; message?: string; constraint_name?: string };
};

/** Ошибка запроса к базе в цепочке причин (сама ошибка или обёрнутая в другую). */
function findQueryError(err: unknown): QueryError | null {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 10; depth++) {
    if ('query' in e && 'params' in e) return e as QueryError;
    e = e.cause;
  }
  return null;
}

/**
 * Ошибка запроса к базе (DrizzleQueryError) несёт значения параметров — хеш пароля, телефоны — и в
 * `params`, и в тексте сообщения, и в стеке. Если она есть в цепочке причин, в журнал идут только
 * текст запроса без значений и код ошибки PostgreSQL; остальные ошибки — как обычно. Ошибки пишутся
 * в журнал только под ключом `err` — так их видит этот обработчик.
 */
export function serializeError(err: unknown): unknown {
  const q = findQueryError(err);
  if (q) {
    return {
      type: (err as Error).name,
      message:
        err === q ? 'Ошибка запроса к базе' : `${(err as Error).message}: ошибка запроса к базе`,
      query: typeof q.query === 'string' ? q.query : undefined,
      code: q.cause?.code,
      constraint: q.cause?.constraint_name,
      cause: q.cause?.message,
    };
  }
  return pino.stdSerializers.err(err as Error);
}

/** Текст ошибки для сохранения в базе (журнал задач): без значений параметров запроса. */
export function safeErrorMessage(err: unknown): string {
  const q = findQueryError(err);
  if (q) return `Ошибка запроса к базе${q.cause?.code ? ` (${q.cause.code})` : ''}`;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Журнал — структурированные строки JSON в стандартный вывод: на Vercel их собирает Vercel,
 * на VPS — Docker или journald. Пароли, токены, cookie и коды доступа вычищаются.
 */
export function createLogger(options: {
  level: string;
  environment: string;
  version: string;
  service: 'web' | 'worker' | 'tool';
  destination?: pino.DestinationStream;
}): Logger {
  return pino(
    {
      level: options.level,
      base: { service: options.service, env: options.environment, version: options.version },
      timestamp: pino.stdTimeFunctions.isoTime,
      serializers: { err: serializeError },
      redact: {
        paths: REDACT_PATHS,
        censor: '[скрыто]',
      },
    },
    options.destination,
  );
}
