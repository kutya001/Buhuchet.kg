import type { ApiApp } from '@buhuchet/api';
import { ApiError } from '@buhuchet/shared';
import { hc } from 'hono/client';
import type { ApiErrorLike } from './l10n/translate';

/** Типизированный клиент API: изменение метода сразу видно здесь как ошибка типов. */
export const api = hc<ApiApp>(
  typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
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
