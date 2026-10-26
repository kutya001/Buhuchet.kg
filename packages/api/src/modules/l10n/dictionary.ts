import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { DEFAULT_UI_LANGUAGE } from '@buhuchet/domain';
import { UiDictionary, UiDictionaryQuery } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { DEFAULT_TEXTS, uiDictionary } from './texts';

export const dictionaryRoute = createRoute({
  method: 'get',
  path: '/l10n',
  tags: ['l10n'],
  summary: 'Словарь текстов интерфейса (без входа)',
  request: { query: UiDictionaryQuery },
  responses: {
    200: {
      description: 'Тексты языка по ключам; ETag — версия словаря',
      content: { 'application/json': { schema: UiDictionary } },
    },
    304: { description: 'Словарь не изменился с версии из If-None-Match' },
  },
});

/** Совпадает ли версия из If-None-Match (одна, список или `*`) с текущей. */
function notModified(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((v) => v.trim().replace(/^W\//, ''))
    .some((v) => v === '*' || v === etag);
}

/**
 * Словарь текстов интерфейса (ТЗ: все тексты — в словаре, не в коде). Тексты из базы (`ui_texts`)
 * ложатся поверх текстов по умолчанию (`UI_TEXTS`): ключ, который выложен с новым кодом, но ещё не
 * попал в базу наполнением, всё равно показывается. Словарь держится в памяти; не чаще раза в
 * секунду он сверяется с отметкой базы (число текстов и хеш) и перечитывается, только когда она
 * изменилась, — поправленный текст виден со следующего обновления страницы. Браузер перепроверяет словарь по ETag и получает 304, пока
 * версия та же. База недоступна — отдаются тексты по умолчанию без кэширования, чтобы страница
 * (в том числе «здоровье») всё равно показалась.
 */
export function dictionaryHandler(deps: ApiDeps): RouteHandler<typeof dictionaryRoute, AppEnv> {
  const load = uiDictionary(deps);

  return async (c) => {
    const lang = c.req.valid('query').lang ?? DEFAULT_UI_LANGUAGE;
    let body: UiDictionary;
    try {
      body = await load(lang);
    } catch (err) {
      deps.logger.error({ err }, 'словарь: база недоступна, отданы тексты по умолчанию');
      c.header('cache-control', 'no-store');
      return c.json({ lang, version: 'default', texts: DEFAULT_TEXTS } satisfies UiDictionary, 200);
    }
    const etag = `"${body.version}"`;
    c.header('etag', etag);
    c.header('cache-control', 'no-cache');
    if (notModified(c.req.header('if-none-match'), etag)) return c.body(null, 304);
    return c.json(body, 200);
  };
}
