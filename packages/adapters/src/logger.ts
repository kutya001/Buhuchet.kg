import { pino, type Logger } from 'pino';

export type { Logger };

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
        paths: [
          'password',
          '*.password',
          'token',
          '*.token',
          'code',
          '*.code',
          'secret',
          '*.secret',
          'req.headers.authorization',
          'req.headers.cookie',
          'headers.authorization',
          'headers.cookie',
        ],
        censor: '[скрыто]',
      },
    },
    options.destination,
  );
}
