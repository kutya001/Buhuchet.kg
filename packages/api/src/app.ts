import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { ApiDeps } from './deps';
import { apiError, recordErrorResponse } from './errors';
import { originCheck } from './middleware/origin';
import { sessionGuard } from './middleware/session';
import { createModuleApp } from './module';
import { authModule } from './modules/auth';
import { systemModule } from './modules/system';

/**
 * Предел тела запроса API: формы и списки — килобайты; файлы идут в хранилище по подписанной ссылке,
 * мимо API. Метод, которому нужно больше, задаёт свой предел.
 */
const API_BODY_LIMIT = 1024 * 1024;

/** Приложение API. Монтируется по пути /api (Next.js catch-all или отдельный сервер). */
export function createApp(deps: ApiDeps) {
  const app = createModuleApp().basePath('/api');

  app.use('*', requestId());
  app.use('*', secureHeaders());
  app.use('*', async (c, next) => {
    const started = performance.now();
    await next();
    c.header('x-robots-tag', 'noindex');
    // Ответы API по умолчанию не кэшируются (данные организаций); метод может задать своё.
    if (!c.res.headers.has('cache-control')) c.header('cache-control', 'no-store');
    deps.logger.info(
      {
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - started),
      },
      'request',
    );
  });

  // Общий слой для всех методов: сначала Origin изменяющих запросов, потом сеанс, организация и
  // права сотрудника; право конкретного метода — requirePermission в его createRoute.
  app.use(
    '*',
    bodyLimit({
      maxSize: API_BODY_LIMIT,
      onError: (c) => c.json(apiError('payload_too_large', 'Слишком большой запрос'), 413),
    }),
  );
  app.use('*', originCheck(deps));
  app.use('*', sessionGuard(deps));

  // Модули подключаются цепочкой: так их маршруты попадают в тип ApiApp для клиента интерфейса.
  const routes = app.route('/', systemModule(deps)).route('/', authModule(deps));

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Buhuchet.kg API', version: deps.config.APP_VERSION },
  });

  app.notFound((c) => c.json(apiError('not_found', 'Метод не найден'), 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return err.res ? err.getResponse() : c.json(apiError('http_error', err.message), err.status);
    }
    const record = recordErrorResponse(err);
    if (record) return c.json(record.body, record.status);
    deps.logger.error({ err, requestId: c.get('requestId'), path: c.req.path }, 'ошибка API');
    return c.json(apiError('internal_error', 'Внутренняя ошибка'), 500);
  });

  return routes;
}

export type ApiApp = ReturnType<typeof createApp>;
