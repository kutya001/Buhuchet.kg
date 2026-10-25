import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { ApiDeps } from './deps';
import { apiError } from './errors';
import { createModuleApp } from './module';
import { systemModule } from './modules/system';

/** Приложение API. Монтируется по пути /api (Next.js catch-all или отдельный сервер). */
export function createApp(deps: ApiDeps) {
  const app = createModuleApp().basePath('/api');

  app.use('*', requestId());
  app.use('*', secureHeaders());
  app.use('*', async (c, next) => {
    const started = performance.now();
    await next();
    c.header('x-robots-tag', 'noindex');
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

  // Модули подключаются цепочкой: так их маршруты попадают в тип ApiApp для клиента интерфейса.
  const routes = app.route('/', systemModule(deps));

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Buhuchet.kg API', version: deps.config.APP_VERSION },
  });

  app.notFound((c) => c.json(apiError('not_found', 'Метод не найден'), 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json(apiError('http_error', err.message), err.status);
    }
    deps.logger.error({ err, requestId: c.get('requestId'), path: c.req.path }, 'ошибка API');
    return c.json(apiError('internal_error', 'Внутренняя ошибка'), 500);
  });

  return routes;
}

export type ApiApp = ReturnType<typeof createApp>;
