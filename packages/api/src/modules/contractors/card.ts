import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  contractorDictValues,
  contractorGkedDicts,
  getContractor,
  gkedNames,
  gkedSearch,
  orgMenuSettings,
  responsibleOptions,
  withOrgContext,
} from '@buhuchet/db';
import { GKED_PICK_LIMIT } from '@buhuchet/domain';
import {
  Contractor,
  ContractorGkedCheckRequest,
  ContractorFormOptions,
  ContractorGkedNotes,
  GkedSearchQuery,
  GkedSearchResult,
  Uuid,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import {
  checkSubject,
  contractorOut,
  error,
  feeVisible,
  notesOf,
  ownEmployeeOf,
  scopeSqlOf,
  subjectOf,
  todayOf,
  translateOf,
} from './common';

export function notFound(): never {
  apiFail(404, 'contractor_not_found', 'Контрагент не найден');
}

export const getContractorRoute = createRoute({
  method: 'get',
  path: '/contractors/{id}',
  tags: ['contractors'],
  summary: 'Карточка контрагента',
  middleware: [requirePermission('cpView')] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: {
      description: 'Контрагент со справочными названиями, ответственным и сверкой с ГКЭД',
      content: { 'application/json': { schema: Contractor } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Просматривать контрагентов»', content: error },
    404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
  },
});

/**
 * Карточка контрагента (прототип modules/contractor-card.js, «Основное»): контрагент вне области
 * «Свои контрагенты» — «не найден», как чужой организации.
 */
export function getContractorHandler(
  deps: ApiDeps,
): RouteHandler<typeof getContractorRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const r = await getContractor(tx, id, { scope: scopeSqlOf(subject), today: todayOf(deps) });
      if (!r) notFound();
      return contractorOut(tx, r, { fee: await feeVisible(tx, orgContextOf(c).orgId, subject), t });
    });
    return c.json(body, 200);
  };
}

export const gkedCheckRoute = createRoute({
  method: 'post',
  path: '/contractors/gked-check',
  tags: ['contractors'],
  summary: 'Сверка набранных значений контрагента с ГКЭД',
  middleware: [requirePermission('createCp')] as const,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: ContractorGkedCheckRequest } },
    },
  },
  responses: {
    200: {
      description:
        'Запрет режима, вопросы о праве на режим, несоответствия льгот и отчётов, подсказка ставки ЕН',
      content: { 'application/json': { schema: ContractorGkedNotes } },
    },
    400: { description: 'Неверные данные запроса', content: error },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Создавать и изменять контрагентов»', content: error },
    404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
  },
});

/**
 * Сверка для формы (ТЗ: «под полями ГКЭД сразу видны предупреждения … и подсказка ставки единого
 * налога»; прототип gkNote): ничего не сохраняет. У созданного контрагента учитывается сохранённое
 * подтверждение права на режим.
 */
export function gkedCheckHandler(deps: ApiDeps): RouteHandler<typeof gkedCheckRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const notes = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      let confirmation = null;
      if (body.contractorId) {
        const r = await getContractor(tx, body.contractorId, {
          scope: scopeSqlOf(subject),
          today: todayOf(deps),
        });
        if (!r) notFound();
        confirmation = r.gkedConfirmation;
      }
      const codes = [body.gked, ...body.gkedExtra].filter((x): x is string => !!x);
      const [dicts, values, names] = await Promise.all([
        contractorGkedDicts(tx, codes, body.reportTypes),
        contractorDictValues(tx, {
          forms: body.formCode ? [body.formCode] : [],
          regimes: [],
          benefits: [],
          bases: [],
          taxOffices: [],
          gked: [],
        }),
        gkedNames(tx, codes),
      ]);
      const form = body.formCode ? values.forms.get(body.formCode) : undefined;
      const { check, ok } = checkSubject(
        dicts,
        {
          gked: body.gked,
          gkedExtra: body.gkedExtra,
          form: form ? { code: body.formCode!, declarationFor: form.declarationFor } : null,
          regimes: [body.regimeCode, body.regime2Code].filter((x): x is string => !!x),
          benefits: body.benefits,
        },
        confirmation,
        body.reportTypes,
      );
      return notesOf(check, ok, t, { codes, names });
    });
    return c.json(notes, 200);
  };
}

export const gkedSearchRoute = createRoute({
  method: 'get',
  path: '/contractors/gked-search',
  tags: ['contractors'],
  summary: 'Поиск кода ГКЭД для контрагента',
  middleware: [requirePermission('cpView')] as const,
  request: { query: GkedSearchQuery },
  responses: {
    200: {
      description:
        'Первые 80 действующих подклассов по порядку справочника, путь и сколько найдено',
      content: { 'application/json': { schema: GkedSearchResult } },
    },
    400: { description: 'Неверный параметр запроса', content: error },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Просматривать контрагентов»', content: error },
  },
});

/**
 * Окно выбора ГКЭД в форме контрагента (ТЗ «Основной вид деятельности (ГКЭД)»; прототип gkPickDlg): по
 * коду, началу кода или словам названия; выбирается только подкласс — нижний уровень.
 */
export function gkedSearchHandler(deps: ApiDeps): RouteHandler<typeof gkedSearchRoute, AppEnv> {
  return async (c) => {
    const { q } = c.req.valid('query');
    const out = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      gkedSearch(tx, q, GKED_PICK_LIMIT),
    );
    return c.json(out, 200);
  };
}

export const formOptionsRoute = createRoute({
  method: 'get',
  path: '/contractors/form-options',
  tags: ['contractors'],
  summary: 'Значения для формы контрагента',
  middleware: [requirePermission('createCp')] as const,
  responses: {
    200: {
      description:
        'Действующие сотрудники для ответственного, ответственный по умолчанию, видна ли плата за обслуживание',
      content: { 'application/json': { schema: ContractorFormOptions } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Создавать и изменять контрагентов»', content: error },
  },
});

/**
 * Значения формы «Новый контрагент» и «Изменить» (прототип addCpDlg: «Ответственный бухгалтер» —
 * действующие сотрудники; стоимость обслуживания — тому, кто видит плату, остальным — замок с
 * пояснением). Ответственный по умолчанию — сам сотрудник с областью «Свои контрагенты»: иначе новый
 * контрагент пропал бы из его списка.
 */
export function formOptionsHandler(deps: ApiDeps): RouteHandler<typeof formOptionsRoute, AppEnv> {
  return async (c) => {
    const subject = subjectOf(c);
    const ctx = orgContextOf(c);
    const out = await withOrgContext(deps.db, ctx, async (tx) => {
      const [employees, settings, fee] = await Promise.all([
        responsibleOptions(tx),
        orgMenuSettings(tx, ctx.orgId),
        feeVisible(tx, ctx.orgId, subject),
      ]);
      const own = ownEmployeeOf(subject);
      return {
        employees,
        defaultResponsible: own && employees.some((e) => e.id === own) ? own : null,
        fee,
        feeOn: settings.features.fee,
      };
    });
    return c.json(out, 200);
  };
}
