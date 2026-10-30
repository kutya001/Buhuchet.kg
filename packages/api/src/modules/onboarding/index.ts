import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  applyOnboardingHandler,
  applyOnboardingRoute,
  onboardingHandler,
  onboardingLaterHandler,
  onboardingLaterRoute,
  onboardingRoute,
  welcomeSeenHandler,
  welcomeSeenRoute,
} from './onboarding';

/**
 * Первый запуск организации (ТЗ «Моя организация» → «Первый запуск организации», задача 2.33):
 * приветствие после входа, «Позже», «Применить» опросника. Только сотрудникам организации; опросник —
 * с правом «Настройки и учётная политика».
 */
export function onboardingModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(onboardingRoute, onboardingHandler(deps))
    .openapi(welcomeSeenRoute, welcomeSeenHandler(deps))
    .openapi(onboardingLaterRoute, onboardingLaterHandler(deps))
    .openapi(applyOnboardingRoute, applyOnboardingHandler(deps));
}
