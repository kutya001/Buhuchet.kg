import type { ApiDeps } from '../../deps';
import { createModuleApp } from '../../module';
import {
  authoritiesHandler,
  authoritiesRoute,
  dueChangeReasonsHandler,
  dueChangeReasonsRoute,
  ownershipFormsHandler,
  ownershipFormsRoute,
  productionCalendarHandler,
  productionCalendarRoute,
  reportBasesHandler,
  reportBasesRoute,
  reportTypesHandler,
  reportTypesRoute,
  singleTaxRatesHandler,
  singleTaxRatesRoute,
  taxBenefitsHandler,
  taxBenefitsRoute,
  taxesHandler,
  taxesRoute,
  taxOfficesHandler,
  taxOfficesRoute,
  taxRegimesHandler,
  taxRegimesRoute,
} from './dicts';
import { phoneCodesHandler, phoneCodesRoute } from './phone-codes';

/**
 * Справочники платформы для экранов организаций (только чтение): коды телефонов, виды отчётов, режимы,
 * налоги и ставки, льготы и статусы, основания, УГНС, органы, формы собственности, ставки единого налога, причины
 * изменения срока, производственный календарь. Правка справочников —
 * Админка → «Справочники платформы» (поток Д).
 */
export function platformDictsModule(deps: ApiDeps) {
  return createModuleApp()
    .openapi(phoneCodesRoute, phoneCodesHandler(deps))
    .openapi(reportTypesRoute, reportTypesHandler(deps))
    .openapi(taxRegimesRoute, taxRegimesHandler(deps))
    .openapi(taxBenefitsRoute, taxBenefitsHandler(deps))
    .openapi(reportBasesRoute, reportBasesHandler(deps))
    .openapi(taxOfficesRoute, taxOfficesHandler(deps))
    .openapi(authoritiesRoute, authoritiesHandler(deps))
    .openapi(ownershipFormsRoute, ownershipFormsHandler(deps))
    .openapi(singleTaxRatesRoute, singleTaxRatesHandler(deps))
    .openapi(dueChangeReasonsRoute, dueChangeReasonsHandler(deps))
    .openapi(taxesRoute, taxesHandler(deps))
    .openapi(productionCalendarRoute, productionCalendarHandler(deps));
}
