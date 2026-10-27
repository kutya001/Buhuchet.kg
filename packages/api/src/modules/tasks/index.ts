import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  cancelTaskHandler,
  cancelTaskRoute,
  commentTaskHandler,
  commentTaskRoute,
  confirmTaskHandler,
  confirmTaskRoute,
  doneTaskHandler,
  doneTaskRoute,
  failTaskHandler,
  failTaskRoute,
  reworkTaskHandler,
  reworkTaskRoute,
  rollbackTaskHandler,
  rollbackTaskRoute,
  startTaskHandler,
  startTaskRoute,
} from './actions';
import {
  contractorTasksHandler,
  contractorTasksRoute,
  getTaskHandler,
  getTaskRoute,
  taskFormOptionsHandler,
  taskFormOptionsRoute,
} from './card';
import {
  exportTasksHandler,
  exportTasksRoute,
  listTasksHandler,
  listTasksRoute,
  taskSummaryHandler,
  taskSummaryRoute,
  taskValuesHandler,
  taskValuesRoute,
} from './list';
import { createTaskHandler, createTaskRoute, updateTaskHandler, updateTaskRoute } from './save';

/**
 * Модуль «Задачи» (задача 2.23, docs/decisions.md п. Б-1): ручные задачи — список с вкладками
 * (значения для фильтра, выгрузка в Excel, счётчики и плашка «На подтверждении»), карточка, форма,
 * действия со статусом, откат, комментарии и вкладка «Задачи» карточки контрагента. Регулярные задачи
 * по отчётам — задача 2.24, проект у задачи — 2.26, уведомления в Telegram — 2.25.
 */
export function tasksModule(deps: ApiDeps) {
  return (
    createModuleApp()
      .openapi(listTasksRoute, listTasksHandler(deps))
      // Раньше `/tasks/{id}`: иначе «summary», «values», «export» и «form-options» разбирались бы как
      // номер задачи.
      .openapi(taskSummaryRoute, taskSummaryHandler(deps))
      .openapi(taskValuesRoute, taskValuesHandler(deps))
      .openapi(exportTasksRoute, exportTasksHandler(deps))
      .openapi(taskFormOptionsRoute, taskFormOptionsHandler(deps))
      .openapi(getTaskRoute, getTaskHandler(deps))
      .openapi(createTaskRoute, createTaskHandler(deps))
      .openapi(updateTaskRoute, updateTaskHandler(deps))
      .openapi(startTaskRoute, startTaskHandler(deps))
      .openapi(doneTaskRoute, doneTaskHandler(deps))
      .openapi(failTaskRoute, failTaskHandler(deps))
      .openapi(confirmTaskRoute, confirmTaskHandler(deps))
      .openapi(reworkTaskRoute, reworkTaskHandler(deps))
      .openapi(cancelTaskRoute, cancelTaskHandler(deps))
      .openapi(rollbackTaskRoute, rollbackTaskHandler(deps))
      .openapi(commentTaskRoute, commentTaskHandler(deps))
      .openapi(contractorTasksRoute, contractorTasksHandler(deps))
  );
}
