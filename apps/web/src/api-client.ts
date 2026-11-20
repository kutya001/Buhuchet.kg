import type { ApiApp } from '@buhuchet/api';
import { ApiError } from '@buhuchet/shared';
import { hc } from 'hono/client';
import type { ApiErrorLike } from './l10n/translate';
import { skipNextIntro } from './shell/brand-intro';

/**
 * Событие окна после удачного сохранения (запрос не GET): «База знаний» сверяет шаги «Сделать» с
 * историей действий пользователя и сразу показывает «Готово: шаг выполнен» (задача 2.30).
 */
export const SAVED_EVENT = 'buhuchet:saved';

/**
 * Запросы, после которых сверять шаги незачем: сама «База знаний», отметки прочитанных новостей, вид
 * списков, вход и пароль, страница контрагента без входа, заявка и видео с лендинга, «просмотрено» и
 * «прочитано» колокольчика (новости он обновляет сам).
 */
const NOT_SAVES = [
  '/api/kb/',
  '/api/news/',
  '/api/view-settings/',
  '/api/auth/',
  '/api/page/',
  '/api/leads',
  '/api/landing/',
  '/api/bell/',
];

/**
 * Сервер закрыл сеанс сотрудника: доступ организации закрыт по подписке (403 `sub_closed`, доработки
 * 20.11.2026, блок 4, пункт 4) — сразу на страницу входа, где после пароля будет «Доступ закрыт…», а не
 * при следующем переходе. Ответ входа с тем же кодом показывает сама форма входа.
 */
export async function leaveIfClosed(res: Response, path: string): Promise<void> {
  if (path.startsWith('/api/auth/')) return;
  const body = ApiError.safeParse(await res.json().catch(() => null));
  if (!body.success || body.data.error.code !== 'sub_closed') return;
  skipNextIntro();
  window.location.assign('/login');
}

const savingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (typeof window === 'undefined') return res;
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, window.location.origin).pathname;
  if (res.status === 403) void leaveIfClosed(res.clone(), path);
  if (res.ok && method !== 'GET' && method !== 'HEAD') {
    if (!NOT_SAVES.some((p) => path.startsWith(p))) window.dispatchEvent(new Event(SAVED_EVENT));
  }
  return res;
};

/** Типизированный клиент API: изменение метода сразу видно здесь как ошибка типов. */
export const api = hc<ApiApp>(
  typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
  { fetch: savingFetch },
);

/** Ответ метода: данные или ошибка в общем формате API; нет связи с сервером — код `network`. */
export type ApiResult<T> =
  { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiErrorLike };

interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/**
 * Вызов метода для формы: ошибка ответа и обрыв связи не бросаются, а возвращаются, чтобы форма
 * показала их под полем. Данные ответа экран проверяет схемой из `@buhuchet/shared`.
 */
export async function callApi(send: () => Promise<ResponseLike>): Promise<ApiResult<unknown>> {
  let res: ResponseLike;
  try {
    res = await send();
  } catch {
    return { ok: false, status: 0, error: { code: 'network', message: '' } };
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, status: res.status, data: body };
  const parsed = ApiError.safeParse(body);
  return {
    ok: false,
    status: res.status,
    error: parsed.success ? parsed.data.error : { code: 'unknown', message: '' },
  };
}

/**
 * Ошибка ответа API в запросах данных (react-query): код и текст из ответа, чтобы экран показал
 * понятную причину («Запрос выполнялся слишком долго»), а не «проверьте подключение».
 */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiErrorLike,
  ) {
    super(`${error.code} (${status})`);
    this.name = 'ApiFailure';
  }
}

/** `ApiFailure` из ответа с ошибкой; тело не в общем формате — код `unknown`. */
export async function apiFailure(res: ResponseLike): Promise<ApiFailure> {
  const body: unknown = await res.json().catch(() => null);
  const parsed = ApiError.safeParse(body);
  return new ApiFailure(
    res.status,
    parsed.success ? parsed.data.error : { code: 'unknown', message: '' },
  );
}
