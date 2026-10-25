import { createMiddleware } from 'hono/factory';
import type { ApiDeps } from '../deps';
import type { AppEnv } from '../env';
import { apiError } from '../errors';

/** Методы, которые ничего не меняют; остальные проверяются. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
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
 * заголовок Origin — наш адрес: `APP_BASE_URL` или адрес, на который пришёл запрос (Host; на Vercel —
 * домен сайта или превью). Браузер ставит Origin и Host сам, страница чужого сайта подменить их не
 * может; заголовкам прокси вроде X-Forwarded-Host не верим. Без Origin изменяющий запрос не
 * принимается.
 */
export function originCheck(deps: ApiDeps) {
  const base = hostOf(deps.config.APP_BASE_URL);
  return createMiddleware<AppEnv>(async (c, next) => {
    if (
      SAFE_METHODS.has(c.req.method) ||
      ORIGIN_EXEMPT_PREFIXES.some((p) => c.req.path.startsWith(p))
    ) {
      return next();
    }
    const own = new Set(
      [base, c.req.header('host'), hostOf(c.req.url)].filter((h): h is string => Boolean(h)),
    );
    const origin = c.req.header('origin');
    const from = origin ? hostOf(origin) : null;
    if (!from || !own.has(from)) {
      return c.json(apiError('origin_mismatch', 'Запрос с другого сайта отклонён'), 403);
    }
    return next();
  });
}
