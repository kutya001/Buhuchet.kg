import { pino, type Logger } from 'pino';

export type { Logger };

/** Поля, которые никогда не попадают в журнал, на любом уровне вложенности до трёх. */
const SECRET_KEYS = [
  'password',
  'newPassword',
  'passwordHash',
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
];
const SECRET_HEADERS = ['set-cookie', 'x-telegram-bot-api-secret-token'];

export const REDACT_PATHS = [
  ...SECRET_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
  ...SECRET_HEADERS.flatMap((h) => [`headers["${h}"]`, `*.headers["${h}"]`]),
];

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
      redact: {
        paths: REDACT_PATHS,
        censor: '[скрыто]',
      },
    },
    options.destination,
  );
}
