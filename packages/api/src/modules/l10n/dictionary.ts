import { createHash } from 'node:crypto';
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { loadUiTexts, uiTextsStamp } from '@buhuchet/db';
import { DEFAULT_UI_LANGUAGE, defaultUiTexts, type UiLanguage } from '@buhuchet/domain';
import { UiDictionary, UiDictionaryQuery } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';

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

const DEFAULTS = defaultUiTexts();

/** Словарь сверяется с базой не чаще раза в секунду: поток запросов не занимает соединения базы. */
const RECHECK_MS = 1000;

/** Тексты по умолчанию входят в версию: новая выкладка с новыми ключами — новая версия словаря. */
const DEFAULTS_HASH = createHash('sha256').update(JSON.stringify(DEFAULTS)).digest('hex');

function versionOf(lang: UiLanguage, stamp: string): string {
  return createHash('sha256')
    .update(`${lang}|${stamp}|${DEFAULTS_HASH}`)
    .digest('base64url')
    .slice(0, 16);
}

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
  const recheckMs = deps.l10nRecheckMs ?? RECHECK_MS;
  const cache = new Map<UiLanguage, { stamp: string; checkedAt: number; body: UiDictionary }>();

  async function load(lang: UiLanguage): Promise<UiDictionary> {
    const cached = cache.get(lang);
    const now = Date.now();
    if (cached && now - cached.checkedAt < recheckMs) return cached.body;
    const stamp = await uiTextsStamp(deps.db, lang);
    if (cached?.stamp === stamp) {
      cached.checkedAt = now;
      return cached.body;
    }
    const body: UiDictionary = {
      lang,
      version: versionOf(lang, stamp),
      texts: { ...DEFAULTS, ...(await loadUiTexts(deps.db, lang)) },
    };
    cache.set(lang, { stamp, checkedAt: now, body });
    return body;
  }

  return async (c) => {
    const lang = c.req.valid('query').lang ?? DEFAULT_UI_LANGUAGE;
    let body: UiDictionary;
    try {
      body = await load(lang);
    } catch (err) {
      deps.logger.error({ err }, 'словарь: база недоступна, отданы тексты по умолчанию');
      c.header('cache-control', 'no-store');
      return c.json({ lang, version: 'default', texts: DEFAULTS } satisfies UiDictionary, 200);
    }
    const etag = `"${body.version}"`;
    c.header('etag', etag);
    c.header('cache-control', 'no-cache');
    if (notModified(c.req.header('if-none-match'), etag)) return c.body(null, 304);
    return c.json(body, 200);
  };
}
