import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { createLinkHandler, createLinkRoute, unlinkHandler, unlinkRoute } from './link';
import { getNotifyHandler, getNotifyRoute, saveNotifyHandler, saveNotifyRoute } from './notify';
import { webhookGuard, webhookHandler, webhookRoute } from './webhook';

/**
 * Модуль «Telegram»: привязка в профиле по ссылке, свои «Уведомления в Telegram» и вебхук бота. Очередь
 * отправки и напоминания — задачи расписания (`telegramSendJob`, `telegramRemindersJob`).
 */
export function telegramModule(deps: ApiDeps) {
  const app = createModuleApp();
  // Секрет вебхука проверяется до разбора тела запроса.
  app.use(webhookRoute.path, webhookGuard(deps));
  return app
    .openapi(createLinkRoute, createLinkHandler(deps))
    .openapi(unlinkRoute, unlinkHandler(deps))
    .openapi(getNotifyRoute, getNotifyHandler(deps))
    .openapi(saveNotifyRoute, saveNotifyHandler(deps))
    .openapi(webhookRoute, webhookHandler(deps));
}
