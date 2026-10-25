import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { cronTickGetRoute, cronTickHandler, cronTickPostRoute } from './cron';
import { healthHandler, healthRoute } from './health';

/** Модуль «Система»: страница «здоровья» и запуск задач по расписанию. */
export function systemModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(healthRoute, healthHandler(deps))
    .openapi(cronTickGetRoute, cronTickHandler(deps))
    .openapi(cronTickPostRoute, cronTickHandler(deps));
}
