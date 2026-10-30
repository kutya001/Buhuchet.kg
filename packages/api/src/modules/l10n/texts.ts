import { createHash } from 'node:crypto';
import { loadUiTexts, statusTonesStamp, statusToneTexts, uiTextsStamp } from '@buhuchet/db';
import { DEFAULT_UI_LANGUAGE, defaultUiTexts, type UiLanguage } from '@buhuchet/domain';
import type { UiDictionary } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';

/** Что нужно словарю: база и частота сверки (у задач по расписанию — по умолчанию). */
type TextDeps = Pick<ApiDeps, 'db' | 'l10nRecheckMs'>;

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

const loaders = new WeakMap<TextDeps, LoadDictionary>();

/**
 * Правки словаря в этом процессе: число правок по языку. Счётчик — на `globalThis`, а не в модуле:
 * Next.js собирает метод API и страницы отдельно, у каждой сборки своя копия модуля, а правка в
 * «Локализации» должна сразу дойти и до словаря страниц (корневой макет).
 */
const EDITS = Symbol.for('buhuchet.l10n.edits');

function edits(): Map<UiLanguage, number> {
  const g = globalThis as { [EDITS]?: Map<UiLanguage, number> };
  g[EDITS] ??= new Map();
  return g[EDITS];
}

/**
 * Словарь текстов в памяти API — один на приложение: тексты базы (`ui_texts`) поверх текстов по
 * умолчанию. Не чаще раза в секунду он сверяется с отметкой базы (число текстов и хеш) и
 * перечитывается, только когда она изменилась. Им пользуются метод словаря для экранов и методы,
 * которым нужны подписи на сервере (поиск по подписям статусов, заголовки выгрузки в Excel).
 */
export function uiDictionary(deps: TextDeps): LoadDictionary {
  const existing = loaders.get(deps);
  if (existing) return existing;
  const recheckMs = deps.l10nRecheckMs ?? RECHECK_MS;
  const cache = new Map<
    UiLanguage,
    { stamp: string; checkedAt: number; edits: number; body: UiDictionary }
  >();

  const load: LoadDictionary = async (lang) => {
    const cached = cache.get(lang);
    const now = Date.now();
    const edited = edits().get(lang) ?? 0;
    if (cached && cached.edits === edited && now - cached.checkedAt < recheckMs) return cached.body;
    // Цвета статусов из Админки едут вместе с текстами (`tone.<шкала>.<код>`): шкалы и метки всех
    // экранов берут цвет из словаря.
    const stamp = `${await uiTextsStamp(deps.db, lang)}|${await statusTonesStamp(deps.db)}`;
    if (cached?.stamp === stamp) {
      Object.assign(cached, { checkedAt: now, edits: edited });
      return cached.body;
    }
    const body: UiDictionary = {
      lang,
      version: versionOf(lang, stamp),
      texts: {
        ...DEFAULT_TEXTS,
        ...(await loadUiTexts(deps.db, lang)),
        ...(await statusToneTexts(deps.db)),
      },
    };
    cache.set(lang, { stamp, checkedAt: now, edits: edited, body });
    return body;
  };
  loaders.set(deps, load);
  return load;
}

/**
 * Правка словаря в «Локализации» сохранена: все словари языка в этом процессе сверятся с базой при
 * следующем запросе, не дожидаясь своей секунды. Другие процессы — не позже чем через секунду.
 */
export function uiDictionaryEdited(lang: UiLanguage): void {
  edits().set(lang, (edits().get(lang) ?? 0) + 1);
}

/**
 * Тексты словаря на сервере по ключу — те же, что на экране (язык интерфейса пока один —
 * русский). Ключа нет — сам ключ, как у экрана.
 */
export async function serverTexts(deps: TextDeps): Promise<(key: string) => string> {
  const { texts } = await uiDictionary(deps)(DEFAULT_UI_LANGUAGE);
  return (key) => texts[key] ?? key;
}
