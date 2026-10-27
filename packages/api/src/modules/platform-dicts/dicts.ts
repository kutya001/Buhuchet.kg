import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  listAuthorities,
  listDueChangeReasons,
  listOwnershipForms,
  listReportBases,
  listReportTypes,
  listSingleTaxRates,
  listTaxBenefits,
  listTaxOffices,
  listTaxes,
  listTaxRegimes,
  productionCalendarEntries,
  taxGkedNames,
} from '@buhuchet/db';
import { calendarYear } from '@buhuchet/domain';
import {
  ApiError,
  Authorities,
  CalendarQuery,
  DictListQuery,
  DueChangeReasons,
  OwnershipForms,
  ProductionCalendarYear,
  ReportBases,
  ReportTypes,
  SingleTaxRates,
  TaxBenefits,
  Taxes,
  TaxOffices,
  TaxRegimes,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { asSessionUser } from '../../middleware/access';

/*
 * Справочники платформы для форм и списков (задачи #20, 2.01): читает любой вошедший — сотрудник любой
 * организации и администратор платформы; меняет только Админка (поток Д). Без `all=true` — только
 * действующие значения: отключённое не предлагается в новых записях (ТЗ «Справочники платформы»).
 */

const error = { 'application/json': { schema: ApiError } };
const listResponses = <T>(schema: T, description: string) =>
  ({
    200: { description, content: { 'application/json': { schema } } },
    400: { description: 'Неверный параметр запроса', content: error },
    401: { description: 'Нет входа', content: error },
  }) as const;

const allOf = (query: DictListQuery) => ({ all: query.all === 'true' });

export const reportTypesRoute = createRoute({
  method: 'get',
  path: '/report-types',
  tags: ['platform-dicts'],
  summary: 'Справочник платформы «Виды отчётов» — единый каталог',
  request: { query: DictListQuery },
  responses: listResponses(ReportTypes, 'Виды отчётов по порядку каталога; ссылки — кодами'),
});

export function reportTypesHandler(deps: ApiDeps): RouteHandler<typeof reportTypesRoute, AppEnv> {
  return async (c) => {
    const options = allOf(c.req.valid('query'));
    const items = await asSessionUser(deps, c.get('session')!, (tx) =>
      listReportTypes(tx, options),
    );
    return c.json({ items }, 200);
  };
}

export const taxRegimesRoute = createRoute({
  method: 'get',
  path: '/tax-regimes',
  tags: ['platform-dicts'],
  summary: 'Справочник платформы «Режимы налогообложения»',
  request: { query: DictListQuery },
  responses: listResponses(TaxRegimes, 'Режимы по порядку справочника'),
});

export function taxRegimesHandler(deps: ApiDeps): RouteHandler<typeof taxRegimesRoute, AppEnv> {
  return async (c) => {
    const options = allOf(c.req.valid('query'));
    const items = await asSessionUser(deps, c.get('session')!, (tx) => listTaxRegimes(tx, options));
    return c.json({ items }, 200);
  };
}

export const taxBenefitsRoute = createRoute({
  method: 'get',
  path: '/tax-benefits',
  tags: ['platform-dicts'],
  summary: 'Справочник платформы «Налоговые льготы и особые статусы»',
  request: { query: DictListQuery },
  responses: listResponses(TaxBenefits, 'Льготы и статусы по порядку справочника'),
});

export function taxBenefitsHandler(deps: ApiDeps): RouteHandler<typeof taxBenefitsRoute, AppEnv> {
  return async (c) => {
    const options = allOf(c.req.valid('query'));
    const items = await asSessionUser(deps, c.get('session')!, (tx) =>
      listTaxBenefits(tx, options),
    );
    return c.json({ items }, 200);
  };
}

export const reportBasesRoute = createRoute({
  method: 'get',
  path: '/report-bases',
  tags: ['platform-dicts'],
  summary: 'Справочник платформы «Основания для отчётов»',
  request: { query: DictListQuery },
  responses: listResponses(ReportBases, 'Основания по порядку справочника с видами отчётов'),
});

export function reportBasesHandler(deps: ApiDeps): RouteHandler<typeof reportBasesRoute, AppEnv> {
  return async (c) => {
    const options = allOf(c.req.valid('query'));
    const items = await asSessionUser(deps, c.get('session')!, (tx) =>
      listReportBases(tx, options),
    );
    return c.json({ items }, 200);
  };
}

export const taxOfficesRoute = createRoute({
  method: 'get',
  path: '/tax-offices',
  tags: ['platform-dicts'],
  summary: 'Справочник платформы «Налоговые органы (УГНС)»',
  request: { query: DictListQuery },
  responses: listResponses(TaxOffices, 'Управления ГНС по порядку справочника'),
});

export function taxOfficesHandler(deps: ApiDeps): RouteHandler<typeof taxOfficesRoute, AppEnv> {
  return async (c) => {
    const options = allOf(c.req.valid('query'));
    const items = await asSessionUser(deps, c.get('session')!, (tx) => listTaxOffices(tx, options));
    return c.json({ items }, 200);
  };
}

export const authoritiesRoute = createRoute({
  method: 'get',
  path: '/authorities',
  tags: ['platform-dicts'],
  summary: 'Справочник платформы «Органы»',
  request: { query: DictListQuery },
  responses: listResponses(Authorities, 'Органы по порядку справочника'),
});

export function authoritiesHandler(deps: ApiDeps): RouteHandler<typeof authoritiesRoute, AppEnv> {
  return async (c) => {
    const options = allOf(c.req.valid('query'));
    const items = await asSessionUser(deps, c.get('session')!, (tx) =>
      listAuthorities(tx, options),
    );
    return c.json({ items }, 200);
  };
}

export const ownershipFormsRoute = createRoute({
  method: 'get',
  path: '/ownership-forms',
  tags: ['platform-dicts'],
  summary: 'Справочник платформы «Формы собственности»',
  request: { query: DictListQuery },
  responses: listResponses(OwnershipForms, 'Формы собственности по порядку справочника'),
});

export function ownershipFormsHandler(
  deps: ApiDeps,
): RouteHandler<typeof ownershipFormsRoute, AppEnv> {
  return async (c) => {
    const options = allOf(c.req.valid('query'));
    const items = await asSessionUser(deps, c.get('session')!, (tx) =>
      listOwnershipForms(tx, options),
    );
    return c.json({ items }, 200);
  };
}

export const singleTaxRatesRoute = createRoute({
  method: 'get',
  path: '/single-tax-rates',
  tags: ['platform-dicts'],
  summary: 'Справочник платформы «Ставки единого налога» (ст. 423 НК КР)',
  request: { query: DictListQuery },
  responses: listResponses(SingleTaxRates, 'Строки ставок ЕН по порядку справочника'),
});

export function singleTaxRatesHandler(
  deps: ApiDeps,
): RouteHandler<typeof singleTaxRatesRoute, AppEnv> {
  return async (c) => {
    const options = allOf(c.req.valid('query'));
    const items = await asSessionUser(deps, c.get('session')!, (tx) =>
      listSingleTaxRates(tx, options),
    );
    return c.json({ items }, 200);
  };
}

export const dueChangeReasonsRoute = createRoute({
  method: 'get',
  path: '/due-change-reasons',
  tags: ['platform-dicts'],
  summary: 'Справочник платформы «Причины изменения срока отчёта»',
  request: { query: DictListQuery },
  responses: listResponses(DueChangeReasons, 'Причины по порядку справочника'),
});

export function dueChangeReasonsHandler(
  deps: ApiDeps,
): RouteHandler<typeof dueChangeReasonsRoute, AppEnv> {
  return async (c) => {
    const options = allOf(c.req.valid('query'));
    const items = await asSessionUser(deps, c.get('session')!, (tx) =>
      listDueChangeReasons(tx, options),
    );
    return c.json({ items }, 200);
  };
}

export const productionCalendarRoute = createRoute({
  method: 'get',
  path: '/production-calendar',
  tags: ['platform-dicts'],
  summary: 'Производственный календарь КР на год',
  request: { query: CalendarQuery },
  responses: listResponses(
    ProductionCalendarYear,
    'Праздники («каждый год» — на этот год), переносы и рабочие субботы года по дате',
  ),
});

export function productionCalendarHandler(
  deps: ApiDeps,
): RouteHandler<typeof productionCalendarRoute, AppEnv> {
  return async (c) => {
    const { year } = c.req.valid('query');
    const entries = await asSessionUser(deps, c.get('session')!, (tx) =>
      productionCalendarEntries(tx),
    );
    return c.json({ year, days: calendarYear(entries, year) }, 200);
  };
}

export const taxesRoute = createRoute({
  method: 'get',
  path: '/taxes',
  tags: ['platform-dicts'],
  summary: 'Справочник платформы «Налоги и ставки» — с формой просмотра налога',
  request: { query: DictListQuery },
  responses: listResponses(
    Taxes,
    'Налоги и платежи по порядку справочника: «Что это», ставки, сроки, связи (кодами), «Сверить»; названия кодов ГКЭД из связей',
  ),
});

/** Блок «Налог» в форме просмотра вида отчёта (ТЗ «Форма просмотра налога»): налоги, у которых вид в «Видах отчётов». */
export function taxesHandler(deps: ApiDeps): RouteHandler<typeof taxesRoute, AppEnv> {
  return async (c) => {
    const options = allOf(c.req.valid('query'));
    const body = await asSessionUser(deps, c.get('session')!, async (tx) => {
      const items = await listTaxes(tx, options);
      return { items, gkedNames: await taxGkedNames(tx, items) };
    });
    return c.json(body, 200);
  };
}
