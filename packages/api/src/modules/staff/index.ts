import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import { resetEmployeePasswordHandler, resetEmployeePasswordRoute } from './password-reset';

/** Модуль «Сотрудники». Пока — сброс пароля сотрудника (#6); список, карточка и роли — #7. */
export function staffModule(deps: ApiDeps) {
  return createModuleApp().openapi(resetEmployeePasswordRoute, resetEmployeePasswordHandler(deps));
}
