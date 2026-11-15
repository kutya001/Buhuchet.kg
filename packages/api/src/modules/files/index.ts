import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  completeUploadHandler,
  completeUploadRoute,
  deleteFileHandler,
  deleteFileRoute,
  downloadFileHandler,
  downloadFileRoute,
  editFileHandler,
  editFileRoute,
  fileLinkHandler,
  fileLinkRoute,
  filePageHandler,
  filePageRoute,
  listFilesHandler,
  listFilesRoute,
  startReplaceHandler,
  startReplaceRoute,
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
import {
  contractorSentHandler,
  contractorSentRoute,
  sentAcceptHandler,
  sentAcceptRoute,
  sentCountHandler,
  sentCountRoute,
  sentExportHandler,
  sentExportRoute,
  sentLinkHandler,
  sentLinkRoute,
  sentListHandler,
  sentListRoute,
  sentRejectHandler,
  sentRejectRoute,
  sentUploadHandler,
  sentUploadRoute,
  sentUploadSetHandler,
  sentUploadSetRoute,
  sentValuesHandler,
  sentValuesRoute,
} from './sent';
import {
  pageSentCompleteHandler,
  pageSentCompleteRoute,
  pageSentStartHandler,
  pageSentStartRoute,
} from './sent-page';

/**
 * Файлы записей (задача 2.04): блок «Файлы» карточки — список файлов записи, загрузка мимо API по
 * подписанной ссылке, скачивание по ссылке на 15 минут, правка (название, примечание, замена файла —
 * прототип v95), удаление. Записи-источники — `FILE_SOURCES`.
 * Модуль «Файловый менеджер» (задача 2.29): список всех файлов с плашками и выгрузкой, просмотр в окне,
 * контрагенты ручной загрузки, занятый объём.
 * Файлы от контрагентов (доработки 14.11.2026, блок 2): «Отправленные файлы» карточки, вкладка «Файлы от
 * контрагентов» со счётчиком, «Принять» и «Отклонить», галочка контрагента и отправка со страницы по
 * ссылке без входа. Маршруты `/files/sent/…` — раньше `/files/{id}…`: «sent» — не номер файла.
 */
export function filesModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(contractorSentRoute, contractorSentHandler(deps))
    .openapi(sentListRoute, sentListHandler(deps))
    .openapi(sentValuesRoute, sentValuesHandler(deps))
    .openapi(sentExportRoute, sentExportHandler(deps))
    .openapi(sentCountRoute, sentCountHandler(deps))
    .openapi(sentAcceptRoute, sentAcceptHandler(deps))
    .openapi(sentRejectRoute, sentRejectHandler(deps))
    .openapi(sentLinkRoute, sentLinkHandler(deps))
    .openapi(sentUploadRoute, sentUploadHandler(deps))
    .openapi(sentUploadSetRoute, sentUploadSetHandler(deps))
    .openapi(pageSentStartRoute, pageSentStartHandler(deps))
    .openapi(pageSentCompleteRoute, pageSentCompleteHandler(deps))
    .openapi(listFilesRoute, listFilesHandler(deps))
    .openapi(startUploadRoute, startUploadHandler(deps))
    .openapi(completeUploadRoute, completeUploadHandler(deps))
    .openapi(fileLinkRoute, fileLinkHandler(deps))
    .openapi(downloadFileRoute, downloadFileHandler(deps))
    .openapi(filePageRoute, filePageHandler(deps))
    .openapi(startReplaceRoute, startReplaceHandler(deps))
    .openapi(editFileRoute, editFileHandler(deps))
    .openapi(deleteFileRoute, deleteFileHandler(deps))
    .openapi(listManagerRoute, listManagerHandler(deps))
    .openapi(managerValuesRoute, managerValuesHandler(deps))
    .openapi(exportManagerRoute, exportManagerHandler(deps))
    .openapi(managerSummaryRoute, managerSummaryHandler(deps))
    .openapi(formContractorsRoute, formContractorsHandler(deps))
    .openapi(fileUsageRoute, fileUsageHandler(deps))
    .openapi(fileViewRoute, fileViewHandler(deps));
}
