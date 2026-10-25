import { pino, type Logger } from 'pino';

export type { Logger };

/** Поля, которые никогда не попадают в журнал, на любом уровне вложенности до трёх. */
const SECRET_KEYS = [
  'password',
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

/**
 * Ошибка запроса к базе (DrizzleQueryError) несёт значения параметров — хеш пароля, телефоны — и в
 * `params`, и в тексте сообщения, и в стеке. В журнал из неё идут только текст запроса без значений
 * и код ошибки PostgreSQL; остальные ошибки — как обычно.
 */
export function serializeError(err: unknown): unknown {
  if (err instanceof Error && 'query' in err && 'params' in err) {
    const cause = err.cause as
      { code?: string; message?: string; constraint_name?: string } | undefined;
    return {
      type: err.name,
      message: 'Ошибка запроса к базе',
      query: typeof err.query === 'string' ? err.query : undefined,
      code: cause?.code,
      constraint: cause?.constraint_name,
      cause: cause?.message,
    };
  }
  return pino.stdSerializers.err(err as Error);
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
