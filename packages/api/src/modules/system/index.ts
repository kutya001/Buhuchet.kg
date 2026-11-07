import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { cronTickGetRoute, cronTickHandler, cronTickPostRoute } from './cron';
import { adminHealthHandler, adminHealthRoute, healthHandler, healthRoute } from './health';

/** Модуль «Система»: проверка «здоровья» (подробно — администратору платформы) и запуск задач по расписанию. */
export function systemModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(healthRoute, healthHandler(deps))
    .openapi(adminHealthRoute, adminHealthHandler(deps))
    .openapi(cronTickGetRoute, cronTickHandler(deps))
    .openapi(cronTickPostRoute, cronTickHandler(deps));
}
