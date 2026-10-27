import type { ApiApp } from '@buhuchet/api';
import { ApiError } from '@buhuchet/shared';
import { hc } from 'hono/client';
import type { ApiErrorLike } from './l10n/translate';

/**
 * Событие окна после удачного сохранения (запрос не GET): «База знаний» сверяет шаги «Сделать» с
 * историей действий пользователя и сразу показывает «Готово: шаг выполнен» (задача 2.30).
 */
export const SAVED_EVENT = 'buhuchet:saved';

/**
 * Запросы, после которых сверять шаги незачем: сама «База знаний», отметки прочитанных новостей, вид
 * списков, вход и пароль.
 */
const NOT_SAVES = ['/api/kb/', '/api/news/', '/api/view-settings/', '/api/auth/'];

const savingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const method = (init?.method ?? 'GET').toUpperCase();
  if (res.ok && method !== 'GET' && method !== 'HEAD' && typeof window !== 'undefined') {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, window.location.origin).pathname;
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
