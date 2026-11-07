import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { adminCodeHandler, adminCodeRoute } from './admin-code';
import { loginHandler, loginRoute } from './login';
import { logoutHandler, logoutRoute } from './logout';
import { meHandler, meRoute } from './me';
import { changePasswordHandler, changePasswordRoute } from './password';
import {
  resetConfirmHandler,
  resetConfirmRoute,
  resetRequestHandler,
  resetRequestRoute,
} from './reset';

/**
 * Модуль «Вход и сеансы»: вход (у администратора платформы — с кодом из Telegram), выход, «кто я»,
 * смена своего пароля, «Забыли пароль?».
 */
export function authModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(loginRoute, loginHandler(deps))
    .openapi(adminCodeRoute, adminCodeHandler(deps))
    .openapi(logoutRoute, logoutHandler(deps))
    .openapi(meRoute, meHandler(deps))
    .openapi(changePasswordRoute, changePasswordHandler(deps))
    .openapi(resetRequestRoute, resetRequestHandler(deps))
    .openapi(resetConfirmRoute, resetConfirmHandler(deps));
}
