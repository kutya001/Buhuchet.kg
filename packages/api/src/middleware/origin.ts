import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { apiError } from '../errors';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Вызовы сервер-сервер со своим секретом: планировщик (позже — вебхук Telegram). */
const ORIGIN_EXEMPT_PREFIXES = ['/api/cron/'];

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Защита от подделки запросов с чужого сайта (CSRF): изменяющий запрос принимается, только если
 * заголовок Origin — наш же адрес. Браузер ставит Origin сам, страница чужого сайта подменить его
 * не может; без Origin изменяющий запрос не принимается.
 */
export function originCheck() {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (
      !UNSAFE_METHODS.has(c.req.method) ||
      ORIGIN_EXEMPT_PREFIXES.some((p) => c.req.path.startsWith(p))
    ) {
      return next();
    }
    const origin = c.req.header('origin');
    const own = new Set(
      [
        c.req.header('x-forwarded-host')?.split(',')[0]?.trim(),
        c.req.header('host'),
        hostOf(c.req.url),
      ].filter((h): h is string => Boolean(h)),
    );
    const from = origin ? hostOf(origin) : null;
    if (!from || !own.has(from)) {
      return c.json(apiError('origin_mismatch', 'Запрос с другого сайта отклонён'), 403);
    }
    return next();
  });
}
