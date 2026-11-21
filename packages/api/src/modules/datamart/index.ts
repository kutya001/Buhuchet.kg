import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { ADMIN_TOKEN_ROUTES, ORG_TOKEN_ROUTES, tokenHandlers } from './tokens';

/**
 * Обработчики сторон одни и те же (типы — по маршрутам организации): у Админки маршрут задан явно,
 * иначе путь в типах приложения возьмётся из обработчика и клиент сайта не увидит `/admin/dm/tokens`.
 */
type A = typeof ADMIN_TOKEN_ROUTES;

/**
 * «Витрина данных» (доработки 20.11.2026: Витрина данных): «API Токены» организации и Админки (поток Т,
 * этап 1, П14). Пути без номера («form», «values», «export») — раньше `{id}`.
 */
export function datamartModule(deps: ApiDeps) {
  const org = tokenHandlers(deps, 'org');
  const adm = tokenHandlers(deps, 'admin');
  return createModuleApp()
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
    .openapi<A['reissue']>(ADMIN_TOKEN_ROUTES.reissue, adm.reissue);
}
