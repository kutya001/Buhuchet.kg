import { createHash } from 'node:crypto';
import { loadUiTexts, statusTonesStamp, statusToneTexts, uiTextsStamp } from '@buhuchet/db';
import { DEFAULT_UI_LANGUAGE, defaultUiTexts, type UiLanguage } from '@buhuchet/domain';
import type { UiDictionary } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';

/** Что нужно словарю: база, своё соединение, частота сверки (у задач — по умолчанию) и журнал. */
type TextDeps = Pick<ApiDeps, 'db' | 'textsDb' | 'l10nRecheckMs'> &
  Partial<Pick<ApiDeps, 'logger'>>;

/** Тексты экранов продукта по умолчанию (`UI_TEXTS`): под ними — тексты базы. */
export const DEFAULT_TEXTS = defaultUiTexts();

/** Словарь сверяется с базой не чаще раза в секунду: поток запросов не занимает соединения базы. */
const RECHECK_MS = 1000;

/**
 * Сколько ждать ответа базы на сверку. У соединения словаря нет предела времени запроса (он вне
 * транзакций), а сверку ждут и методы с открытыми транзакциями: зависший запрос не должен держать их.
 */
const CHECK_LIMIT_MS = 5000;

/** После неудачной сверки словарь из памяти отдаётся без новой попытки столько миллисекунд. */
const FAILED_CHECK_PAUSE_MS = 15_000;

/** Результат работы или ошибка, если она не уложилась в срок (сама работа не прерывается). */
function withLimit<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`словарь текстов: база не ответила за ${ms} мс`)),
      ms,
    );
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

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
 *
 * Сверка идёт по своему соединению (`deps.textsDb`), а не по пулу методов: тексты нужны и внутри
 * открытых транзакций, и запрос к пулу, все соединения которого заняты такими же транзакциями, не
 * дождался бы соединения никогда — вместе с ним навсегда встали бы и они. Одновременные запросы
 * ждут одну общую сверку, а не встают за своей каждый. База не ответила на сверку (ошибка или дольше
 * `CHECK_LIMIT_MS`) — отдаётся словарь из памяти, если он есть, и следующая попытка — после паузы;
 * словаря ещё нет — ошибка (метод словаря для экранов отвечает тогда текстами по умолчанию).
 */
export function uiDictionary(deps: TextDeps): LoadDictionary {
  const existing = loaders.get(deps);
  if (existing) return existing;
  const recheckMs = deps.l10nRecheckMs ?? RECHECK_MS;
  const db = deps.textsDb ?? deps.db;
  const cache = new Map<
    UiLanguage,
    { stamp: string; checkedAt: number; edits: number; body: UiDictionary }
  >();

  /** Сверка, которая сейчас идёт: её ждут все, кто пришёл за тем же словарём (язык и число правок). */
  const checking = new Map<UiLanguage, { edits: number; result: Promise<UiDictionary> }>();
  /** До какого момента после неудачной сверки словарь языка отдаётся из памяти без новой попытки. */
  const pausedUntil = new Map<UiLanguage, number>();

  const recheck = async (lang: UiLanguage, edited: number): Promise<UiDictionary> => {
    const cached = cache.get(lang);
    const now = Date.now();
    // Цвета статусов из Админки едут вместе с текстами (`tone.<шкала>.<код>`): шкалы и метки всех
    // экранов берут цвет из словаря.
    const stamp = `${await uiTextsStamp(db, lang)}|${await statusTonesStamp(db)}`;
    if (cached?.stamp === stamp) {
      Object.assign(cached, { checkedAt: now, edits: edited });
      return cached.body;
    }
    const body: UiDictionary = {
      lang,
      version: versionOf(lang, stamp),
      texts: {
        ...DEFAULT_TEXTS,
        ...(await loadUiTexts(db, lang)),
        ...(await statusToneTexts(db)),
      },
    };
    cache.set(lang, { stamp, checkedAt: now, edits: edited, body });
    return body;
  };

  const load: LoadDictionary = (lang) => {
    const cached = cache.get(lang);
    const edited = edits().get(lang) ?? 0;
    const now = Date.now();
    if (cached && cached.edits === edited && now - cached.checkedAt < recheckMs) {
      return Promise.resolve(cached.body);
    }
    if (cached && now < (pausedUntil.get(lang) ?? 0)) return Promise.resolve(cached.body);
    const running = checking.get(lang);
    if (running?.edits === edited) return running.result;
    const result = withLimit(recheck(lang, edited), CHECK_LIMIT_MS)
      .catch((err: unknown) => {
        const last = cache.get(lang);
        if (!last) throw err;
        pausedUntil.set(lang, Date.now() + FAILED_CHECK_PAUSE_MS);
        deps.logger?.warn(
          { err },
          'словарь текстов: сверка с базой не удалась, отдан словарь из памяти',
        );
        return last.body;
      })
      .finally(() => {
        if (checking.get(lang)?.result === result) checking.delete(lang);
      });
    checking.set(lang, { edits: edited, result });
    return result;
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
 * русский). Ключа нет — сам ключ, как у экрана: так в выгрузку попадают и готовые подписи
 * (название показателя в столбце), поэтому ищутся только свои ключи словаря, не `constructor`.
 */
export async function serverTexts(deps: TextDeps): Promise<(key: string) => string> {
  const { texts } = await uiDictionary(deps)(DEFAULT_UI_LANGUAGE);
  return (key) => (Object.hasOwn(texts, key) ? texts[key]! : key);
}
