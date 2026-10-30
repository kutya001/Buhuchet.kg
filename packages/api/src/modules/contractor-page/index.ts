import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  changePageCodeHandler,
  changePageCodeRoute,
  disablePageHandler,
  disablePageRoute,
  enablePageHandler,
  enablePageRoute,
  enablePagesHandler,
  enablePagesRoute,
  getPageHandler,
  getPageRoute,
  pageCopiedRoute,
  pageLogHandler,
  pageSectionsHandler,
  pageSectionsRoute,
  pageSentRoute,
} from './card';
import {
  publicPageCodeHandler,
  publicPageCodeRoute,
  publicPageHandler,
  publicPageRoute,
} from './public';

/**
 * Модуль «Страница контрагента по ссылке» (задача 2.42): блок карточки — включить, выключить, сменить
 * код, разделы, скопировать и отправить ссылку, включение у выбранных; страница без входа — что
 * показать по ссылке и ввод кода. Разделы самой страницы — задача 2.43.
 */
export function contractorPageModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(getPageRoute, getPageHandler(deps))
    .openapi(enablePageRoute, enablePageHandler(deps))
    .openapi(disablePageRoute, disablePageHandler(deps))
    .openapi(changePageCodeRoute, changePageCodeHandler(deps))
    .openapi(pageSectionsRoute, pageSectionsHandler(deps))
    .openapi(pageCopiedRoute, pageLogHandler(deps, 'page_copy'))
    .openapi(pageSentRoute, pageLogHandler(deps, 'page_send'))
    .openapi(enablePagesRoute, enablePagesHandler(deps))
    .openapi(publicPageRoute, publicPageHandler(deps))
    .openapi(publicPageCodeRoute, publicPageCodeHandler(deps));
}
