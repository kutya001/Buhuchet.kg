import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  bellCountHandler,
  bellCountRoute,
  bellPageHandler,
  bellPageRoute,
  bellReadAllHandler,
  bellReadAllRoute,
  bellReadHandler,
  bellReadRoute,
  bellSeenHandler,
  bellSeenRoute,
} from './bell-panel';
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
import {
  setupCompleteHandler,
  setupCompleteRoute,
  setupPeekHandler,
  setupPeekRoute,
} from './setup-password';
import { webhookGuard, webhookHandler, webhookRoute } from './webhook';

/**
 * Модуль «Telegram»: привязка в профиле по ссылке, свои «Уведомления в Telegram», «Проверить бота»,
 * «Сообщения простым текстом», «Общий чат фирмы», колокольчик уведомлений (`bell-panel.ts`) и вебхук бота (привязка и нажатия кнопок под сообщениями). Очередь
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
    // «/bell/read-all» — раньше «/bell/{id}/read» не нужно: пути разной длины.
    .openapi(bellPageRoute, bellPageHandler(deps))
    .openapi(bellCountRoute, bellCountHandler(deps))
    .openapi(bellSeenRoute, bellSeenHandler(deps))
    .openapi(bellReadAllRoute, bellReadAllHandler(deps))
    .openapi(bellReadRoute, bellReadHandler(deps))
    .openapi(setupPeekRoute, setupPeekHandler(deps))
    .openapi(setupCompleteRoute, setupCompleteHandler(deps))
    .openapi(webhookRoute, webhookHandler(deps));
}
