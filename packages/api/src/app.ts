import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { ApiDeps } from './deps';
import { apiError, recordErrorResponse } from './errors';
import { originCheck } from './middleware/origin';
import { sessionGuard } from './middleware/session';
import { createModuleApp } from './module';
import { adminModule } from './modules/admin';
import { authModule } from './modules/auth';
import { l10nModule } from './modules/l10n';
import { orgModule } from './modules/org';
import { platformDictsModule } from './modules/platform-dicts';
import { LOGO_PATH } from './modules/org/logo';
import { rolesModule } from './modules/roles';
import { staffModule } from './modules/staff';
import { systemModule } from './modules/system';
import { telegramModule } from './modules/telegram';
import { viewsModule } from './modules/views';

/**
 * Предел тела запроса API: формы и списки — килобайты; файлы идут в хранилище по подписанной ссылке,
 * мимо API. Исключение — пути из `OWN_BODY_LIMIT_PATHS`: их метод задаёт свой предел сам.
 */
const API_BODY_LIMIT = 1024 * 1024;

/** Логотип организации (до 2 МБ) идёт через API: сервер проверяет, что это картинка, до сохранения. */
const OWN_BODY_LIMIT_PATHS: ReadonlySet<string> = new Set([LOGO_PATH]);

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
  const apiBodyLimit = bodyLimit({
    maxSize: API_BODY_LIMIT,
    onError: (c) => c.json(apiError('payload_too_large', 'Слишком большой запрос'), 413),
  });
  app.use('*', (c, next) =>
    OWN_BODY_LIMIT_PATHS.has(c.req.path) ? next() : apiBodyLimit(c, next),
  );
  app.use('*', originCheck(deps));
  app.use('*', sessionGuard(deps));

  // Модули подключаются цепочкой: так их маршруты попадают в тип ApiApp для клиента интерфейса.
  const routes = app
    .route('/', systemModule(deps))
    .route('/', l10nModule(deps))
    .route('/', authModule(deps))
    .route('/', telegramModule(deps))
    .route('/', staffModule(deps))
    .route('/', rolesModule(deps))
    .route('/', orgModule(deps))
    .route('/', platformDictsModule(deps))
    .route('/', viewsModule(deps))
    .route('/', adminModule(deps));

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
