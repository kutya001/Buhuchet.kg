import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { createLinkHandler, createLinkRoute, unlinkHandler, unlinkRoute } from './link';
import { webhookGuard, webhookHandler, webhookRoute } from './webhook';

/** Модуль «Telegram»: привязка в профиле по ссылке и вебхук бота. Очередь напоминаний — поток Б. */
export function telegramModule(deps: ApiDeps) {
  const app = createModuleApp();
  // Секрет вебхука проверяется до разбора тела запроса.
  app.use(webhookRoute.path, webhookGuard(deps));
  return app
    .openapi(createLinkRoute, createLinkHandler(deps))
    .openapi(unlinkRoute, unlinkHandler(deps))
    .openapi(webhookRoute, webhookHandler(deps));
}
