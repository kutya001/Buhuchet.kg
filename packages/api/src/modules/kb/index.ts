import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
export { VIDEO_COVER_UPLOAD_PATH } from './video-admin';
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
  autoAdminKbShowHandler,
  autoAdminKbShowRoute,
  createAdminKbArticleHandler,
  createAdminKbArticleRoute,
  createAdminKbStepHandler,
  createAdminKbStepRoute,
  exportAdminKbHandler,
  exportAdminKbRoute,
  getAdminKbArticleHandler,
  getAdminKbArticleRoute,
  getAdminKbShowHandler,
  getAdminKbShowRoute,
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
  saveAdminKbShowHandler,
  saveAdminKbShowRoute,
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
  kbHandHandler,
  kbHandRoute,
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
  kbUnhandHandler,
  kbUnhandRoute,
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
import {
  kbVideoCatalogHandler,
  kbVideoCatalogRoute,
  kbVideoCoverHandler,
  kbVideoCoverRoute,
  kbVideoListHandler,
  kbVideoListRoute,
  kbVideoMetaHandler,
  kbVideoMetaRoute,
  kbVideoOpenHandler,
  kbVideoOpenRoute,
  kbVideoProgressHandler,
  kbVideoProgressRoute,
  kbVideoValuesHandler,
  kbVideoValuesRoute,
  kbVideoExportHandler,
  kbVideoExportRoute,
} from './video';
import {
  adminVideoCardHandler,
  adminVideoCardRoute,
  adminVideoCoverHandler,
  adminVideoCoverRoute,
  adminVideoCreateHandler,
  adminVideoCreateRoute,
  adminVideoDeleteHandler,
  adminVideoDeleteRoute,
  adminVideoExportHandler,
  adminVideoExportRoute,
  adminVideoListHandler,
  adminVideoListRoute,
  adminVideoOffHandler,
  adminVideoOffRoute,
  adminVideoOptionsHandler,
  adminVideoOptionsRoute,
  adminVideoPublishHandler,
  adminVideoPublishRoute,
  adminVideoUpdateHandler,
  adminVideoUpdateRoute,
  adminVideoUploadCancelHandler,
  adminVideoUploadCancelRoute,
  adminVideoUploadCompleteHandler,
  adminVideoUploadCompleteRoute,
  adminVideoUploadPartsHandler,
  adminVideoUploadPartsRoute,
  adminVideoUploadStartHandler,
  adminVideoUploadStartRoute,
  adminVideoUploadStateHandler,
  adminVideoUploadStateRoute,
  adminVideoValuesHandler,
  adminVideoValuesRoute,
} from './video-admin';
import {
  adminVideoViewHistoryHandler,
  adminVideoViewHistoryRoute,
  adminVideoViewsExportHandler,
  adminVideoViewsExportRoute,
  adminVideoViewsHandler,
  adminVideoViewsRoute,
  adminVideoViewsValuesHandler,
  adminVideoViewsValuesRoute,
  kbVideoViewHistoryHandler,
  kbVideoViewHistoryRoute,
  kbVideoViewsExportHandler,
  kbVideoViewsExportRoute,
  kbVideoViewsHandler,
  kbVideoViewsRoute,
  kbVideoViewsValuesHandler,
  kbVideoViewsValuesRoute,
} from './video-views';
import {
  landingVideoCoverHandler,
  landingVideoCoverRoute,
  landingVideoPlayHandler,
  landingVideoPlayRoute,
  landingVideoStartHandler,
  landingVideoStartRoute,
  landingVideoWatchedHandler,
  landingVideoWatchedRoute,
} from './video-landing';

/**
 * «База знаний» (ТЗ «База знаний», задача 2.30): своя программа обучения и уровень, отметки шагов,
 * статьи, уровни сотрудников; «Показать как» и «Обзор экрана» — сценарии, знакомые элементы, отметка
 * показом (задача 2.31). Свою программу видит любой вошедший (у администратора платформы — своя),
 * уровни других — право «Видеть уровни сотрудников». Содержимое правит администратор платформы
 * (Админка → «База знаний (содержимое)», задача 2.39, `/admin/kb/…`).
 * Видео платформы (прототип v79): вкладки «Видео» и «Просмотры видео», окно видео с учётом
 * просмотренных секунд; содержимое и загрузку ведёт администратор платформы (`/admin/videos/…`).
 * Постоянные адреса (`options`, `values`, `export`, `uploads`, `covers`) — раньше `{id}`.
 */
export function kbModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(kbStateRoute, kbStateHandler(deps))
    .openapi(kbSyncRoute, kbSyncHandler(deps))
    .openapi(kbLookRoute, kbLookHandler(deps))
    .openapi(kbHitRoute, kbHitHandler(deps))
    .openapi(kbSkipRoute, kbSkipHandler(deps))
    .openapi(kbUnskipRoute, kbUnskipHandler(deps))
    .openapi(kbHandRoute, kbHandHandler(deps))
    .openapi(kbUnhandRoute, kbUnhandHandler(deps))
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
    .openapi(getAdminKbShowRoute, getAdminKbShowHandler(deps))
    .openapi(saveAdminKbShowRoute, saveAdminKbShowHandler(deps))
    .openapi(autoAdminKbShowRoute, autoAdminKbShowHandler(deps))
    .openapi(getAdminKbArticleRoute, getAdminKbArticleHandler(deps))
    .openapi(createAdminKbArticleRoute, createAdminKbArticleHandler(deps))
    .openapi(saveAdminKbArticleRoute, saveAdminKbArticleHandler(deps))
    .openapi(activeAdminKbArticleRoute, activeAdminKbArticleHandler(deps))
    .openapi(kbVideoCatalogRoute, kbVideoCatalogHandler(deps))
    .openapi(kbVideoListRoute, kbVideoListHandler(deps))
    .openapi(kbVideoValuesRoute, kbVideoValuesHandler(deps))
    .openapi(kbVideoExportRoute, kbVideoExportHandler(deps))
    .openapi(kbVideoOpenRoute, kbVideoOpenHandler(deps))
    .openapi(kbVideoProgressRoute, kbVideoProgressHandler(deps))
    .openapi(kbVideoMetaRoute, kbVideoMetaHandler(deps))
    .openapi(kbVideoCoverRoute, kbVideoCoverHandler(deps))
    .openapi(kbVideoViewsRoute, kbVideoViewsHandler(deps))
    .openapi(kbVideoViewsValuesRoute, kbVideoViewsValuesHandler(deps))
    .openapi(kbVideoViewsExportRoute, kbVideoViewsExportHandler(deps))
    .openapi(kbVideoViewHistoryRoute, kbVideoViewHistoryHandler(deps))
    .openapi(adminVideoListRoute, adminVideoListHandler(deps))
    .openapi(adminVideoValuesRoute, adminVideoValuesHandler(deps))
    .openapi(adminVideoExportRoute, adminVideoExportHandler(deps))
    .openapi(adminVideoOptionsRoute, adminVideoOptionsHandler(deps))
    .openapi(adminVideoUploadStartRoute, adminVideoUploadStartHandler(deps))
    .openapi(adminVideoUploadPartsRoute, adminVideoUploadPartsHandler(deps))
    .openapi(adminVideoUploadStateRoute, adminVideoUploadStateHandler(deps))
    .openapi(adminVideoUploadCompleteRoute, adminVideoUploadCompleteHandler(deps))
    .openapi(adminVideoUploadCancelRoute, adminVideoUploadCancelHandler(deps))
    .openapi(adminVideoCoverRoute, adminVideoCoverHandler(deps))
    .openapi(adminVideoCreateRoute, adminVideoCreateHandler(deps))
    .openapi(adminVideoCardRoute, adminVideoCardHandler(deps))
    .openapi(adminVideoUpdateRoute, adminVideoUpdateHandler(deps))
    .openapi(adminVideoPublishRoute, adminVideoPublishHandler(deps))
    .openapi(adminVideoOffRoute, adminVideoOffHandler(deps))
    .openapi(adminVideoDeleteRoute, adminVideoDeleteHandler(deps))
    .openapi(adminVideoViewsRoute, adminVideoViewsHandler(deps))
    .openapi(adminVideoViewsValuesRoute, adminVideoViewsValuesHandler(deps))
    .openapi(adminVideoViewsExportRoute, adminVideoViewsExportHandler(deps))
    .openapi(adminVideoViewHistoryRoute, adminVideoViewHistoryHandler(deps))
    .openapi(landingVideoCoverRoute, landingVideoCoverHandler(deps))
    .openapi(landingVideoPlayRoute, landingVideoPlayHandler(deps))
    .openapi(landingVideoStartRoute, landingVideoStartHandler(deps))
    .openapi(landingVideoWatchedRoute, landingVideoWatchedHandler(deps));
}
