import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { adminResetPasswordHandler, adminResetPasswordRoute } from './password-reset';

/** Модуль «Админка». Пока — сброс пароля пользователя организации (#6); остальное — #18. */
export function adminModule(deps: ApiDeps) {
  return createModuleApp().openapi(adminResetPasswordRoute, adminResetPasswordHandler(deps));
}
