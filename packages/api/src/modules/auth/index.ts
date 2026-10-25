import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { loginHandler, loginRoute } from './login';
import { logoutHandler, logoutRoute } from './logout';
import { meHandler, meRoute } from './me';
import { changePasswordHandler, changePasswordRoute } from './password';

/** Модуль «Вход и сеансы»: вход, выход, «кто я», смена своего пароля. */
export function authModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(loginRoute, loginHandler(deps))
    .openapi(logoutRoute, logoutHandler(deps))
    .openapi(meRoute, meHandler(deps))
    .openapi(changePasswordRoute, changePasswordHandler(deps));
}
