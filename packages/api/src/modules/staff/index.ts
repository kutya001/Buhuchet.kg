import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { createEmployeeHandler, createEmployeeRoute } from './create';
import {
  employeeValuesHandler,
  employeeValuesRoute,
  exportEmployeesHandler,
  exportEmployeesRoute,
  getEmployeeHandler,
  getEmployeeRoute,
  listEmployeesHandler,
  listEmployeesRoute,
  staffTabCountsHandler,
  staffTabCountsRoute,
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
 * Модуль «Сотрудники»: список (значения для фильтра, выгрузка в Excel, счётчики вкладок), карточка, создание, правка и смена роли, блокировка, сброс пароля.
 * Роли — модуль `roles`; передача контрагентов, счёт и уровень знаний — их модули.
 */
export function staffModule(deps: ApiDeps) {
  return (
    createModuleApp()
      .openapi(listEmployeesRoute, listEmployeesHandler(deps))
      // Раньше `/staff/{id}`: иначе «values», «export» и «tab-counts» разбирались бы как номер сотрудника.
      .openapi(employeeValuesRoute, employeeValuesHandler(deps))
      .openapi(staffTabCountsRoute, staffTabCountsHandler(deps))
      .openapi(exportEmployeesRoute, exportEmployeesHandler(deps))
      .openapi(getEmployeeRoute, getEmployeeHandler(deps))
      .openapi(createEmployeeRoute, createEmployeeHandler(deps))
      .openapi(updateEmployeeRoute, updateEmployeeHandler(deps))
      .openapi(blockEmployeeRoute, blockEmployeeHandler(deps))
      .openapi(unblockEmployeeRoute, unblockEmployeeHandler(deps))
      .openapi(resetEmployeePasswordRoute, resetEmployeePasswordHandler(deps))
  );
}
