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

/**
 * Файлы записей (задача 2.04): блок «Файлы» карточки — список файлов записи, загрузка мимо API по
 * подписанной ссылке, скачивание по ссылке на 15 минут, удаление. Записи-источники — `FILE_SOURCES`.
 * Сам модуль «Файловый менеджер» (список всех файлов, ручная загрузка) — задача 2.29.
 */
export function filesModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(listFilesRoute, listFilesHandler(deps))
    .openapi(startUploadRoute, startUploadHandler(deps))
    .openapi(completeUploadRoute, completeUploadHandler(deps))
    .openapi(fileLinkRoute, fileLinkHandler(deps))
    .openapi(downloadFileRoute, downloadFileHandler(deps))
    .openapi(deleteFileRoute, deleteFileHandler(deps));
}
