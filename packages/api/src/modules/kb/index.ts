import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
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
 * уровни других — право «Видеть уровни сотрудников».
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
    .openapi(kbMemberRoute, kbMemberHandler(deps));
}
