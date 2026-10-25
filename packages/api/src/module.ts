import { OpenAPIHono } from '@hono/zod-openapi';
import { apiError } from './errors';

/**
 * Приложение модуля API. Маршруты регистрируются цепочкой (`.openapi(...).openapi(...)`), чтобы их типы
 * попали в `ApiApp` и типизированный клиент интерфейса видел каждый метод.
 */
export function createModuleApp() {
  return new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          apiError('validation_failed', 'Неверные данные запроса', result.error.issues),
          400,
        );
      }
    },
  });
}
