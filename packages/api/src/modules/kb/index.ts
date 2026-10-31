import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  activeAdminKbArticleHandler,
  activeAdminKbArticleRoute,
  activeAdminKbStepHandler,
  activeAdminKbStepRoute,
  adminKbHistoryHandler,
  adminKbHistoryRoute,
  adminKbLevelsHandler,
  adminKbLevelsRoute,
  adminKbMetaHandler,
  adminKbMetaRoute,
  adminKbValuesHandler,
  adminKbValuesRoute,
  createAdminKbArticleHandler,
  createAdminKbArticleRoute,
  createAdminKbStepHandler,
  createAdminKbStepRoute,
  exportAdminKbHandler,
  exportAdminKbRoute,
  getAdminKbArticleHandler,
  getAdminKbArticleRoute,
  getAdminKbStepHandler,
  getAdminKbStepRoute,
  listAdminKbHandler,
  listAdminKbRoute,
  moveAdminKbStepHandler,
  moveAdminKbStepRoute,
  previewAdminKbArticleHandler,
  previewAdminKbArticleRoute,
  saveAdminKbArticleHandler,
  saveAdminKbArticleRoute,
  saveAdminKbLevelsHandler,
  saveAdminKbLevelsRoute,
  saveAdminKbStepHandler,
  saveAdminKbStepRoute,
} from './admin';
import {
  kbArticleHandler,
  kbArticleReadHandler,
  kbArticleReadRoute,
  kbArticleRoute,
  kbArticlesHandler,
  kbArticlesRoute,
} from './articles';
import {
  kbHitHandler,
  kbHitRoute,
  kbLookHandler,
  kbLookRoute,
  kbSkipHandler,
  kbSkipRoute,
  kbStateHandler,
  kbStateRoute,
  kbSyncHandler,
  kbSyncRoute,
  kbUnskipHandler,
  kbUnskipRoute,
} from './progress';
import {
  kbKnownAddHandler,
  kbKnownAddRoute,
  kbKnownHandler,
  kbKnownResetHandler,
  kbKnownResetRoute,
  kbKnownRoute,
  kbScreenShowHandler,
  kbScreenShowRoute,
  kbShowsHandler,
  kbShowsRoute,
  kbStepShowHandler,
  kbStepShowRoute,
} from './shows';
import {
  kbMemberHandler,
  kbMemberRoute,
  kbTeamExportHandler,
  kbTeamExportRoute,
  kbTeamHandler,
  kbTeamRoute,
  kbTeamValuesHandler,
  kbTeamValuesRoute,
} from './team';

/**
 * «База знаний» (ТЗ «База знаний», задача 2.30): своя программа обучения и уровень, отметки шагов,
 * статьи, уровни сотрудников; «Показать как» и «Обзор экрана» — сценарии, знакомые элементы, отметка
 * показом (задача 2.31). Свою программу видит любой вошедший (у администратора платформы — своя),
 * уровни других — право «Видеть уровни сотрудников». Содержимое правит администратор платформы
 * (Админка → «База знаний (содержимое)», задача 2.39, `/admin/kb/…`).
 */
export function kbModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(kbStateRoute, kbStateHandler(deps))
    .openapi(kbSyncRoute, kbSyncHandler(deps))
    .openapi(kbLookRoute, kbLookHandler(deps))
    .openapi(kbHitRoute, kbHitHandler(deps))
    .openapi(kbSkipRoute, kbSkipHandler(deps))
    .openapi(kbUnskipRoute, kbUnskipHandler(deps))
    .openapi(kbStepShowRoute, kbStepShowHandler(deps))
    .openapi(kbScreenShowRoute, kbScreenShowHandler(deps))
    .openapi(kbShowsRoute, kbShowsHandler(deps))
    .openapi(kbKnownRoute, kbKnownHandler(deps))
    .openapi(kbKnownAddRoute, kbKnownAddHandler(deps))
    .openapi(kbKnownResetRoute, kbKnownResetHandler(deps))
    .openapi(kbArticlesRoute, kbArticlesHandler(deps))
    .openapi(kbArticleRoute, kbArticleHandler(deps))
    .openapi(kbArticleReadRoute, kbArticleReadHandler(deps))
    .openapi(kbTeamRoute, kbTeamHandler(deps))
    .openapi(kbTeamValuesRoute, kbTeamValuesHandler(deps))
    .openapi(kbTeamExportRoute, kbTeamExportHandler(deps))
    .openapi(kbMemberRoute, kbMemberHandler(deps))
    .openapi(adminKbMetaRoute, adminKbMetaHandler(deps))
    .openapi(adminKbHistoryRoute, adminKbHistoryHandler(deps))
    .openapi(adminKbLevelsRoute, adminKbLevelsHandler(deps))
    .openapi(saveAdminKbLevelsRoute, saveAdminKbLevelsHandler(deps))
    .openapi(listAdminKbRoute, listAdminKbHandler(deps))
    .openapi(adminKbValuesRoute, adminKbValuesHandler(deps))
    .openapi(exportAdminKbRoute, exportAdminKbHandler(deps))
    .openapi(previewAdminKbArticleRoute, previewAdminKbArticleHandler(deps))
    .openapi(getAdminKbStepRoute, getAdminKbStepHandler(deps))
    .openapi(createAdminKbStepRoute, createAdminKbStepHandler(deps))
    .openapi(saveAdminKbStepRoute, saveAdminKbStepHandler(deps))
    .openapi(moveAdminKbStepRoute, moveAdminKbStepHandler(deps))
    .openapi(activeAdminKbStepRoute, activeAdminKbStepHandler(deps))
    .openapi(getAdminKbArticleRoute, getAdminKbArticleHandler(deps))
    .openapi(createAdminKbArticleRoute, createAdminKbArticleHandler(deps))
    .openapi(saveAdminKbArticleRoute, saveAdminKbArticleHandler(deps))
    .openapi(activeAdminKbArticleRoute, activeAdminKbArticleHandler(deps));
}
