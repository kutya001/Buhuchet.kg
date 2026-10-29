import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  completeUploadHandler,
  completeUploadRoute,
  deleteFileHandler,
  deleteFileRoute,
  downloadFileHandler,
  downloadFileRoute,
  fileLinkHandler,
  fileLinkRoute,
  listFilesHandler,
  listFilesRoute,
  startUploadHandler,
  startUploadRoute,
} from './files';
import {
  exportManagerHandler,
  exportManagerRoute,
  fileUsageHandler,
  fileUsageRoute,
  fileViewHandler,
  fileViewRoute,
  formContractorsHandler,
  formContractorsRoute,
  listManagerHandler,
  listManagerRoute,
  managerSummaryHandler,
  managerSummaryRoute,
  managerValuesHandler,
  managerValuesRoute,
} from './manager';

/**
 * Файлы записей (задача 2.04): блок «Файлы» карточки — список файлов записи, загрузка мимо API по
 * подписанной ссылке, скачивание по ссылке на 15 минут, удаление. Записи-источники — `FILE_SOURCES`.
 * Модуль «Файловый менеджер» (задача 2.29): список всех файлов с плашками и выгрузкой, просмотр в окне,
 * контрагенты ручной загрузки, занятый объём.
 */
export function filesModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(listFilesRoute, listFilesHandler(deps))
    .openapi(startUploadRoute, startUploadHandler(deps))
    .openapi(completeUploadRoute, completeUploadHandler(deps))
    .openapi(fileLinkRoute, fileLinkHandler(deps))
    .openapi(downloadFileRoute, downloadFileHandler(deps))
    .openapi(deleteFileRoute, deleteFileHandler(deps))
    .openapi(listManagerRoute, listManagerHandler(deps))
    .openapi(managerValuesRoute, managerValuesHandler(deps))
    .openapi(exportManagerRoute, exportManagerHandler(deps))
    .openapi(managerSummaryRoute, managerSummaryHandler(deps))
    .openapi(formContractorsRoute, formContractorsHandler(deps))
    .openapi(fileUsageRoute, fileUsageHandler(deps))
    .openapi(fileViewRoute, fileViewHandler(deps));
}
