import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { EXT_ROUTE, extHandler } from './ext';
import { OUTPUT_ROUTES, outputHandlers } from './output';
import { REQUEST_ROUTES, requestHandlers } from './requests';
import { OUTPUT_EXPORT_ROUTES, outputExportHandlers } from './output-export';
import { TEMPLATE_ADMIN_ROUTES, templateAdminHandlers } from './templates-admin';
import { ADMIN_TOKEN_ROUTES, ORG_TOKEN_ROUTES, tokenHandlers } from './tokens';

/**
 * Обработчики сторон одни и те же (типы — по маршрутам организации): у Админки маршрут задан явно,
 * иначе путь в типах приложения возьмётся из обработчика и клиент сайта не увидит `/admin/dm/tokens`.
 */
type A = typeof ADMIN_TOKEN_ROUTES;

/**
 * «Витрина данных» (доработки 20.11.2026: Витрина данных): «Вывод» и каталог «Шаблоны» организации и
 * Админки, редактор шаблонов Админки (этап 2, П3–П4), «API Токены» организации и Админки (поток Т,
 * этап 1, П14), внешний адрес по токену `GET /api/ext/v1/{code}` и «Журнал запросов» Админки (поток Т,
 * этап 2, П11). Пути без номера («form», «values», «export») — раньше `{id}`.
 */
export function datamartModule(deps: ApiDeps) {
  const org = tokenHandlers(deps, 'org');
  const adm = tokenHandlers(deps, 'admin');
  const out = outputHandlers(deps);
  const log = requestHandlers(deps);
  const outXlsx = outputExportHandlers(deps);
  const tpl = templateAdminHandlers(deps);
  const T = TEMPLATE_ADMIN_ROUTES;
  return (
    createModuleApp()
      .openapi(OUTPUT_ROUTES.catalog, out.catalog)
      .openapi(OUTPUT_ROUTES.run, out.run)
      .openapi(OUTPUT_ROUTES.adminCatalog, out.adminCatalog)
      .openapi(OUTPUT_ROUTES.adminRun, out.adminRun)
      .openapi(OUTPUT_EXPORT_ROUTES.export, outXlsx.exportOrg)
      .openapi(OUTPUT_EXPORT_ROUTES.adminExport, outXlsx.exportAdmin)
      // Пути без номера — раньше `{id}`.
      .openapi(T.list, tpl.list)
      .openapi(T.values, tpl.values)
      .openapi(T.export, tpl.exportList)
      .openapi(T.form, tpl.form)
      .openapi(T.check, tpl.check)
      .openapi(T.create, tpl.create)
      .openapi(T.card, tpl.card)
      .openapi(T.save, tpl.update)
      .openapi(T.copy, tpl.copy)
      .openapi(T.state, tpl.state)
      .openapi(ORG_TOKEN_ROUTES.list, org.list)
      .openapi(ORG_TOKEN_ROUTES.values, org.values)
      .openapi(ORG_TOKEN_ROUTES.export, org.exportList)
      .openapi(ORG_TOKEN_ROUTES.form, org.form)
      .openapi(ORG_TOKEN_ROUTES.create, org.create)
      .openapi(ORG_TOKEN_ROUTES.card, org.card)
      .openapi(ORG_TOKEN_ROUTES.revoke, org.revoke)
      .openapi(ORG_TOKEN_ROUTES.reissue, org.reissue)
      .openapi<A['list']>(ADMIN_TOKEN_ROUTES.list, adm.list)
      .openapi<A['values']>(ADMIN_TOKEN_ROUTES.values, adm.values)
      .openapi<A['export']>(ADMIN_TOKEN_ROUTES.export, adm.exportList)
      .openapi<A['form']>(ADMIN_TOKEN_ROUTES.form, adm.form)
      .openapi<A['create']>(ADMIN_TOKEN_ROUTES.create, adm.create)
      .openapi<A['card']>(ADMIN_TOKEN_ROUTES.card, adm.card)
      .openapi<A['revoke']>(ADMIN_TOKEN_ROUTES.revoke, adm.revoke)
      .openapi<A['reissue']>(ADMIN_TOKEN_ROUTES.reissue, adm.reissue)
      .openapi(REQUEST_ROUTES.list, log.list)
      .openapi(REQUEST_ROUTES.values, log.values)
      .openapi(REQUEST_ROUTES.export, log.exportList)
      .openapi(REQUEST_ROUTES.summary, log.summary)
      .openapi(EXT_ROUTE, extHandler(deps))
  );
}
