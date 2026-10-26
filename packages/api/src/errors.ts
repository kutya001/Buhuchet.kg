import { HTTPException } from 'hono/http-exception';
import { RecordChangedError, RecordNotFoundError } from '@buhuchet/domain';
import { ApiError } from '@buhuchet/shared';

export function apiError(code: string, message: string, details?: unknown): ApiError {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

/**
 * Ошибки записи, общие для всех модулей: метод просто бросает их (`updateWithHistory` из
 * @buhuchet/db), а общий обработчик отвечает одинаково везде. Остальные ошибки — null.
 */
export function recordErrorResponse(err: unknown): { status: 404 | 409; body: ApiError } | null {
  if (err instanceof RecordChangedError) {
    return {
      status: 409,
      body: apiError('record_changed', 'Запись изменена другим пользователем', {
        version: err.currentVersion,
      }),
    };
  }
  if (err instanceof RecordNotFoundError) {
    return { status: 404, body: apiError('not_found', 'Запись не найдена') };
  }
  return null;
}

/** Ответы метода, который сохраняет запись с версией, — для описания OpenAPI (`createRoute`). */
export const versionedSaveResponses = {
  404: {
    description: 'Записи нет',
    content: { 'application/json': { schema: ApiError } },
  },
  409: {
    description: 'Запись изменена другим пользователем: перечитать и повторить правку',
    content: { 'application/json': { schema: ApiError } },
  },
} as const;

/**
 * Отказ метода в общем формате ошибки. Брошенный внутри `withOrgContext`, откатывает транзакцию;
 * отвечает общий обработчик (`app.onError`). Код ответа должен быть в описании маршрута.
 */
export function apiFail(
  status: 400 | 403 | 404 | 409,
  code: string,
  message: string,
  details?: unknown,
): never {
  throw new HTTPException(status, {
    res: Response.json(apiError(code, message, details), { status }),
  });
}
