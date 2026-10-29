import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  createNewsHandler,
  createNewsRoute,
  deleteNewsHandler,
  deleteNewsRoute,
  exportNewsHandler,
  exportNewsRoute,
  getNewsHandler,
  getNewsRoute,
  listNewsHandler,
  listNewsRoute,
  newsArticlesHandler,
  newsArticlesRoute,
  newsHistoryHandler,
  newsHistoryRoute,
  newsOffHandler,
  newsOffRoute,
  newsValuesHandler,
  newsValuesRoute,
  publishNewsHandler,
  publishNewsRoute,
  saveNewsHandler,
  saveNewsRoute,
  uploadNewsImageHandler,
  uploadNewsImageRoute,
} from './admin';
import {
  newsFeedHandler,
  newsFeedRoute,
  newsImageHandler,
  newsImageRoute,
  newsReadAllHandler,
  newsReadAllRoute,
  newsReadHandler,
  newsReadRoute,
  newsUnreadHandler,
  newsUnreadRoute,
  whatsNewHandler,
  whatsNewRoute,
} from './feed';

export { NEWS_IMAGE_UPLOAD_PATH } from './admin';

/**
 * «Новости» Базы знаний (задача 2.32, docs/decisions.md п. Г-3): лента, прочитанность и окно «Что
 * нового» — любому вошедшему; правка — администратору платформы (Админка → «База знаний
 * (содержимое)» → «Новости»). Пути со словом (`values`, `export`, `articles`, `history`, `images`) — раньше путей с кодом
 * новости: код тоже из латинских букв.
 */
export function newsModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(newsFeedRoute, newsFeedHandler(deps))
    .openapi(newsUnreadRoute, newsUnreadHandler(deps))
    .openapi(whatsNewRoute, whatsNewHandler(deps))
    .openapi(newsReadRoute, newsReadHandler(deps))
    .openapi(newsReadAllRoute, newsReadAllHandler(deps))
    .openapi(newsImageRoute, newsImageHandler(deps))
    .openapi(listNewsRoute, listNewsHandler(deps))
    .openapi(newsValuesRoute, newsValuesHandler(deps))
    .openapi(exportNewsRoute, exportNewsHandler(deps))
    .openapi(newsArticlesRoute, newsArticlesHandler(deps))
    .openapi(newsHistoryRoute, newsHistoryHandler(deps))
    .openapi(uploadNewsImageRoute, uploadNewsImageHandler(deps))
    .openapi(getNewsRoute, getNewsHandler(deps))
    .openapi(createNewsRoute, createNewsHandler(deps))
    .openapi(saveNewsRoute, saveNewsHandler(deps))
    .openapi(publishNewsRoute, publishNewsHandler(deps))
    .openapi(newsOffRoute, newsOffHandler(deps))
    .openapi(deleteNewsRoute, deleteNewsHandler(deps));
}
