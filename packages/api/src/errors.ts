import { HTTPException } from 'hono/http-exception';
import { ListQueryError, queryTimedOut } from '@buhuchet/db';
import { RecordChangedError, RecordNotFoundError } from '@buhuchet/domain';
import { ApiError, parseListQuery, type ListQuery, type ListQueryParams } from '@buhuchet/shared';

export function apiError(code: string, message: string, details?: unknown): ApiError {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

/**
 * Ошибки записи и запроса списка, общие для всех модулей: метод просто бросает их
 * (`updateWithHistory`, `selectListPage` из @buhuchet/db), а общий обработчик отвечает одинаково
 * везде. Запрос к базе дольше предела вида работы (`QUERY_TIMEOUT_MS`) — 503 `query_timeout`, а не
 * «Внутренняя ошибка» (docs/decisions.md, п. 38). Остальные ошибки — null.
 */
export function recordErrorResponse(
  err: unknown,
): { status: 400 | 404 | 409 | 503; body: ApiError } | null {
  if (err instanceof ListQueryError) {
    return {
      status: 400,
      body: apiError('validation_failed', 'Неверные данные запроса', { [err.part]: err.key }),
    };
  }
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
  if (queryTimedOut(err)) {
    return { status: 503, body: apiError('query_timeout', 'Запрос выполнялся слишком долго') };
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
  status: 400 | 403 | 404 | 409 | 429,
  code: string,
  message: string,
  details?: unknown,
): never {
  throw new HTTPException(status, {
    res: Response.json(apiError(code, message, details), { status }),
  });
}

/** Ответы 400 и 503 метода списка — для описания OpenAPI (`createRoute`). */
export const listQueryResponses = {
  400: {
    description: 'Неверная сортировка, страница или фильтр списка',
    content: { 'application/json': { schema: ApiError } },
  },
  503: {
    description: 'Запрос к базе дольше предела: сузить список поиском или фильтром',
    content: { 'application/json': { schema: ApiError } },
  },
} as const;

/**
 * Запрос страницы списка из параметров (`ListQueryParams`); фильтры не в формате — 400. Столбцы
 * сортировки и фильтров проверяет `selectListPage` (неизвестный — тоже 400).
 */
export function listQueryOf(params: ListQueryParams): ListQuery {
  const parsed = parseListQuery(params);
  if (!parsed.ok) apiFail(400, 'validation_failed', 'Неверные фильтры списка');
  return parsed.query;
}
