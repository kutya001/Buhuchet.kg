/*
 * Админка → «Телеграм» (ТЗ «Админка» → «Модуль Телеграмм»; прототип admin/telegram.js; задача 2.41,
 * docs/decisions.md п. Д-13): состояние вебхука бота платформы и пределы рассылки объявлений.
 */

/** Объявление — одно сообщение Telegram: не длиннее предела Bot API (4096 символов). */
export const BROADCAST_TEXT_MAX = 4096;

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
  info:
    | { url: string; lastErrorAt: Date | null; lastError: string | null }
    | null
    | 'unreachable',
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
