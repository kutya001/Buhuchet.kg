import { createHash } from 'node:crypto';
import { loadUiTexts, uiTextsStamp } from '@buhuchet/db';
import { DEFAULT_UI_LANGUAGE, defaultUiTexts, type UiLanguage } from '@buhuchet/domain';
import type { UiDictionary } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';

/** Тексты экранов продукта по умолчанию (`UI_TEXTS`): под ними — тексты базы. */
export const DEFAULT_TEXTS = defaultUiTexts();

/** Словарь сверяется с базой не чаще раза в секунду: поток запросов не занимает соединения базы. */
const RECHECK_MS = 1000;

/** Тексты по умолчанию входят в версию: новая выкладка с новыми ключами — новая версия словаря. */
const DEFAULTS_HASH = createHash('sha256').update(JSON.stringify(DEFAULT_TEXTS)).digest('hex');

function versionOf(lang: UiLanguage, stamp: string): string {
  return createHash('sha256')
    .update(`${lang}|${stamp}|${DEFAULTS_HASH}`)
    .digest('base64url')
    .slice(0, 16);
}

type LoadDictionary = (lang: UiLanguage) => Promise<UiDictionary>;

const loaders = new WeakMap<ApiDeps, LoadDictionary>();

/**
 * Словарь текстов в памяти API — один на приложение: тексты базы (`ui_texts`) поверх текстов по
 * умолчанию. Не чаще раза в секунду он сверяется с отметкой базы (число текстов и хеш) и
 * перечитывается, только когда она изменилась. Им пользуются метод словаря для экранов и методы,
 * которым нужны подписи на сервере (поиск по подписям статусов, заголовки выгрузки в Excel).
 */
export function uiDictionary(deps: ApiDeps): LoadDictionary {
  const existing = loaders.get(deps);
  if (existing) return existing;
  const recheckMs = deps.l10nRecheckMs ?? RECHECK_MS;
  const cache = new Map<UiLanguage, { stamp: string; checkedAt: number; body: UiDictionary }>();

  const load: LoadDictionary = async (lang) => {
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
      texts: { ...DEFAULT_TEXTS, ...(await loadUiTexts(deps.db, lang)) },
    };
    cache.set(lang, { stamp, checkedAt: now, body });
    return body;
  };
  loaders.set(deps, load);
  return load;
}

/**
 * Тексты словаря на сервере по ключу — те же, что на экране (язык интерфейса пока один —
 * русский). Ключа нет — сам ключ, как у экрана.
 */
export async function serverTexts(deps: ApiDeps): Promise<(key: string) => string> {
  const { texts } = await uiDictionary(deps)(DEFAULT_UI_LANGUAGE);
  return (key) => texts[key] ?? key;
}
