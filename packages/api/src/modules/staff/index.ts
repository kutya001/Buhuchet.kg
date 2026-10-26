import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { createEmployeeHandler, createEmployeeRoute } from './create';
import {
  getEmployeeHandler,
  getEmployeeRoute,
  listEmployeesHandler,
  listEmployeesRoute,
} from './employees';
import { resetEmployeePasswordHandler, resetEmployeePasswordRoute } from './password-reset';
import {
  blockEmployeeHandler,
  blockEmployeeRoute,
  unblockEmployeeHandler,
  unblockEmployeeRoute,
  updateEmployeeHandler,
  updateEmployeeRoute,
} from './update';

/**
 * Модуль «Сотрудники»: список, карточка, создание, правка и смена роли, блокировка, сброс пароля.
 * Роли — модуль `roles`; передача контрагентов, счёт и уровень знаний — их модули.
 */
export function staffModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(listEmployeesRoute, listEmployeesHandler(deps))
    .openapi(getEmployeeRoute, getEmployeeHandler(deps))
    .openapi(createEmployeeRoute, createEmployeeHandler(deps))
    .openapi(updateEmployeeRoute, updateEmployeeHandler(deps))
    .openapi(blockEmployeeRoute, blockEmployeeHandler(deps))
    .openapi(unblockEmployeeRoute, unblockEmployeeHandler(deps))
    .openapi(resetEmployeePasswordRoute, resetEmployeePasswordHandler(deps));
}
