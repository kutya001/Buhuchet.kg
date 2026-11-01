import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  contractorProjectsHandler,
  contractorProjectsRoute,
  projectCardHandler,
  projectCardRoute,
  projectFormHandler,
  projectFormRoute,
} from './card';
import {
  exportProjectsHandler,
  exportProjectsRoute,
  listProjectsHandler,
  listProjectsRoute,
  projectSummaryHandler,
  projectSummaryRoute,
  projectValuesHandler,
  projectValuesRoute,
} from './list';
import {
  projectPayHandler,
  projectPaymentDeleteHandler,
  projectPaymentDeleteRoute,
  projectPaymentEditHandler,
  projectPaymentEditRoute,
  projectPaymentWindowHandler,
  projectPaymentWindowRoute,
  projectPayRoute,
} from './payments';
import {
  projectCreateHandler,
  projectCreateRoute,
  projectEditHandler,
  projectEditRoute,
  projectStatusHandler,
  projectStatusRoute,
  projectWorkAddHandler,
  projectWorkAddRoute,
  projectWorkDoneHandler,
  projectWorkDoneRoute,
} from './save';

/**
 * Модуль «Проекты контрагентов» (задача 2.26, docs/decisions.md п. Г-7): список с вкладками
 * «Активные», «Все», «Мои» (значения фильтра, выгрузка, плашки), карточка, окно проекта, статусы по
 * шкале с откатом, работы, вкладка «Проекты» карточки контрагента. Файлы проекта — источник `project`
 * модуля файлов (`./files.ts`), проект у задачи — модуль «Задачи». Оплаты по проекту — транши
 * (`./payments.ts`): «Записать оплату», окно транша, «Изменить» и «Удалить» с причиной; их строки — в
 * журнале «Финансовых операций», файлы — источник `project_payment`.
 */
export function projectsModule(deps: ApiDeps) {
  return (
    createModuleApp()
      .openapi(listProjectsRoute, listProjectsHandler(deps))
      // Раньше `/projects/{id}`: иначе «summary», «values», «export» и «form» разбирались бы как номер.
      .openapi(projectSummaryRoute, projectSummaryHandler(deps))
      .openapi(projectValuesRoute, projectValuesHandler(deps))
      .openapi(exportProjectsRoute, exportProjectsHandler(deps))
      .openapi(projectFormRoute, projectFormHandler(deps))
      .openapi(projectCardRoute, projectCardHandler(deps))
      .openapi(projectCreateRoute, projectCreateHandler(deps))
      .openapi(projectEditRoute, projectEditHandler(deps))
      .openapi(projectStatusRoute, projectStatusHandler(deps))
      .openapi(projectWorkAddRoute, projectWorkAddHandler(deps))
      .openapi(projectWorkDoneRoute, projectWorkDoneHandler(deps))
      .openapi(projectPayRoute, projectPayHandler(deps))
      .openapi(projectPaymentWindowRoute, projectPaymentWindowHandler(deps))
      .openapi(projectPaymentEditRoute, projectPaymentEditHandler(deps))
      .openapi(projectPaymentDeleteRoute, projectPaymentDeleteHandler(deps))
      .openapi(contractorProjectsRoute, contractorProjectsHandler(deps))
  );
}
