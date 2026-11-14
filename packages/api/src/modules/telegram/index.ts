import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { botTestHandler, botTestRoute, plainTextHandler, plainTextRoute } from './bot-test';
import {
  createGroupLinkHandler,
  createGroupLinkRoute,
  getGroupHandler,
  getGroupRoute,
  saveGroupHandler,
  saveGroupRoute,
  unlinkGroupHandler,
  unlinkGroupRoute,
} from './group';
import { createLinkHandler, createLinkRoute, unlinkHandler, unlinkRoute } from './link';
import { getNotifyHandler, getNotifyRoute, saveNotifyHandler, saveNotifyRoute } from './notify';
import { webhookGuard, webhookHandler, webhookRoute } from './webhook';

/**
 * Модуль «Telegram»: привязка в профиле по ссылке, свои «Уведомления в Telegram», «Проверить бота»,
 * «Сообщения простым текстом», «Общий чат фирмы» и вебхук бота (привязка и нажатия кнопок под сообщениями). Очередь
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
    .openapi(botTestRoute, botTestHandler(deps))
    .openapi(plainTextRoute, plainTextHandler(deps))
    .openapi(getGroupRoute, getGroupHandler(deps))
    .openapi(createGroupLinkRoute, createGroupLinkHandler(deps))
    .openapi(saveGroupRoute, saveGroupHandler(deps))
    .openapi(unlinkGroupRoute, unlinkGroupHandler(deps))
    .openapi(webhookRoute, webhookHandler(deps));
}
