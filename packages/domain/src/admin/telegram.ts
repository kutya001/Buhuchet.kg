import type { BotButton, BotMessage } from '../telegram/bot-message';

/*
 * Админка → «Телеграм» (ТЗ «Админка» → «Модуль Телеграмм»; прототип admin/telegram.js; задача 2.41,
 * docs/decisions.md п. Д-13): состояние вебхука бота платформы и пределы рассылки объявлений.
 */

/**
 * Оформленная рассылка (поток Т, задача Т6; пакет заказчика 13.11.2026, идея 15; прототип v103
 * admin/tg-cast.js): сообщение из частей — картинка, заголовок, текст, кнопки «Подробнее» и «Смотреть
 * видео». Заголовок до 80 знаков и текст до 900: вместе они помещаются в подпись к картинке (1024).
 */
export const CAST_TITLE_MAX = 80;
export const CAST_TEXT_MAX = 900;
/** Текст объявления (прежнее имя предела): как в прототипе — до 900 знаков. */
export const BROADCAST_TEXT_MAX = CAST_TEXT_MAX;
/** Картинка рассылки — JPG, PNG или WebP до 2 МБ (прототип `TG_CAST_IMG_MB`). */
export const CAST_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
/** Раздел картинок рассылки в хранилище платформы. */
export const CAST_IMAGES_SECTION = 'telegram-cast';
/** Новостей в списках «Заполнить из новости» и «Подробнее» — не больше (прототип `tgCastNews`). */
export const CAST_NEWS_MAX = 20;

export type CastImageType = 'image/jpeg' | 'image/png' | 'image/webp';

const startsWith = (bytes: Uint8Array, sig: readonly number[], at = 0) =>
  bytes.length > at + sig.length && sig.every((b, i) => bytes[at + i] === b);

/** Тип картинки по первым байтам файла, а не по имени и словам браузера; null — не JPG, PNG и не WebP. */
export function castImageType(bytes: Uint8Array): CastImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  return null;
}

export type CastImageProblem = 'cast_image_too_large' | 'cast_image_type';

/** Отказы рассылки: код ошибки API → текст (сервер и экран берут один текст). */
export const CAST_MESSAGES = {
  cast_image_too_large: 'Картинка больше 2 МБ',
  cast_image_type: 'Картинка — только JPG, PNG или WebP',
  cast_image: 'Картинка не найдена — выберите её ещё раз',
  cast_more: 'Новость или статья для «Подробнее» не найдена или снята с публикации',
  cast_video: 'Видео не найдено или снято с публикации',
  cast_empty: 'Некому отправлять: ни у кого из получателей не привязан Telegram',
} as const;

/** Что не так с картинкой рассылки: размер, затем тип (прототип — те же два сообщения). */
export function castImageProblem(bytes: Uint8Array): CastImageProblem | null {
  if (bytes.length > CAST_IMAGE_MAX_BYTES) return 'cast_image_too_large';
  return castImageType(bytes) ? null : 'cast_image_type';
}

/** Имя файла картинки для Telegram — по её типу. */
export const castImageName = (type: CastImageType) =>
  `image.${type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'webp'}`;

/** Текст не длиннее предела: лишнее — многоточием (прототип `tgClip`). */
export function castClip(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  let out = '';
  for (const ch of clean) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return `${out}…`;
}

/** Кнопка «Подробнее»: опубликованная новость или статья Базы знаний. */
export type CastMore = { kind: 'news' | 'article'; id: string };

/**
 * Новость → поля рассылки (прототип `tgCastFromNews`): заголовок, краткое описание, «Подробнее» — сама
 * новость, «Смотреть видео» — если ссылка новости ведёт на видео, которое можно разослать.
 */
export function castFromNews(
  news: { id: string; title: string; short: string; video: string | null },
  videoOk: (id: string) => boolean,
): { title: string; text: string; more: CastMore; video: string | null } {
  return {
    title: castClip(news.title, CAST_TITLE_MAX),
    text: castClip(news.short, CAST_TEXT_MAX),
    more: { kind: 'news', id: news.id },
    video: news.video && videoOk(news.video) ? news.video : null,
  };
}

/**
 * Сообщение рассылки (прототип `tgCastMsg`): картинка, заголовок, текст и ряд кнопок-ссылок. Адреса
 * кнопок собирает сервер из записей сайта; кнопки без адреса https нет (`null`).
 */
export function castBotMessage(o: {
  title: string;
  text: string;
  image: string | null;
  more: { text: string; url: string } | null;
  video: { text: string; url: string } | null;
}): BotMessage {
  const row: BotButton[] = [o.more, o.video].flatMap((b) =>
    b && /^https:\/\//.test(b.url) ? [{ text: b.text, url: b.url }] : [],
  );
  return {
    ...(o.title ? { heading: o.title } : {}),
    text: o.text,
    ...(o.image ? { image: o.image } : {}),
    ...(row.length ? { buttons: [row] } : {}),
  };
}

/** Адреса кнопок рассылки на сайте (прототип `tgCastMsg`): новость, статья Базы знаний, видео. */
export const CAST_PATHS = {
  news: (id: string) => `/app/kb/news?news=${encodeURIComponent(id)}`,
  article: (id: string) => `/app/kb/arts?article=${encodeURIComponent(id)}`,
  video: (id: string) => `/app/kb/video?video=${encodeURIComponent(id)}`,
} as const;

/**
 * Ошибка доставки, которую Telegram сообщил не раньше этого (getWebhookInfo `last_error_date`), —
 * текущая: вебхук «Ошибка». Telegram не стирает последнюю ошибку после успешной доставки, поэтому
 * старая ошибка состояние не портит.
 */
export const WEBHOOK_ERROR_FRESH_MS = 60 * 60 * 1000;

/**
 * Почему вебхук не работает: бот не подключён (нет переменных бота в окружении сайта), Telegram не
 * ответил на проверку, вебхук не поставлен, поставлен на другой адрес, Telegram недавно не смог
 * доставить обновление.
 */
export type WebhookProblem = 'no_bot' | 'unreachable' | 'not_set' | 'other_url' | 'delivery';

export interface WebhookState {
  ok: boolean;
  problem: WebhookProblem | null;
  /** Текст последней ошибки Telegram (как у прототипа «Последняя ошибка Telegram: …»). */
  lastError: string | null;
  /** Адрес, на который Telegram сейчас шлёт обновления, если он не наш. */
  actualUrl: string | null;
}

/**
 * Состояние вебхука по ответу Telegram (прототип `TG_WH`: «Работает» или текст последней ошибки):
 * работает, если Telegram шлёт обновления на наш адрес и последняя ошибка доставки — не свежее
 * `WEBHOOK_ERROR_FRESH_MS`. `info` — null, если бот не подключён; `'unreachable'` — Telegram не ответил.
 */
export function webhookState(
  info: { url: string; lastErrorAt: Date | null; lastError: string | null } | null | 'unreachable',
  expectedUrl: string,
  now: Date,
): WebhookState {
  const bad = (problem: WebhookProblem, o: Partial<WebhookState> = {}): WebhookState => ({
    ok: false,
    problem,
    lastError: null,
    actualUrl: null,
    ...o,
  });
  if (info === null) return bad('no_bot');
  if (info === 'unreachable') return bad('unreachable');
  if (!info.url) return bad('not_set');
  if (info.url !== expectedUrl) return bad('other_url', { actualUrl: info.url });
  if (
    info.lastErrorAt &&
    info.lastError &&
    now.getTime() - info.lastErrorAt.getTime() <= WEBHOOK_ERROR_FRESH_MS
  ) {
    return bad('delivery', { lastError: info.lastError });
  }
  return { ok: true, problem: null, lastError: null, actualUrl: null };
}
