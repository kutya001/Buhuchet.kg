import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  archiveIndicator,
  deleteIndicator,
  getIndicator,
  indicatorHistory,
  insertIndicator,
  kpiContractorRecords,
  kpiIndicatorOf,
  listIndicators,
  loadTargets,
  reorderIndicators,
  resyncFillStatuses,
  updateIndicator,
  writeTargets,
  type IndicatorFields,
  type IndicatorRecord,
  type Tx,
} from '@buhuchet/db';
import {
  applyWho,
  hasPermission,
  indicatorOn,
  indicatorProblems,
  INDICATOR_MESSAGES,
  whoAutoNew,
  type AccessSubject,
  type IsoDate,
  type KpiIndicator,
} from '@buhuchet/domain';
import {
  type Indicator,
  IndicatorArchive,
  IndicatorCard,
  IndicatorIdParam,
  IndicatorOrder,
  Indicators,
  IndicatorSave,
  IndicatorUpdate,
  IndicatorVersionQuery,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { requirePermission } from '../../middleware/access';
import {
  currentMonthOf,
  error,
  inKpi,
  kpiFail,
  kpiScopeOf,
  noAuth,
  subjectOf,
  todayOf,
} from './common';

/*
 * «Настройка показателей» (задача 2.27; ТЗ «Показатели контрагентов» → «Вкладка «Настройка
 * показателей»»; прототип modules/kpi.js: kpiSetupList, indDlg, kWhoApply). Список видят все с правом
 * «Просматривать показатели» (столбцы таблиц), меняет — право «Настраивать показатели». После правки
 * «Кому вести», архива и удаления статусы месяцев пересчитываются (прототип `kResync`).
 */

const noSetup = {
  description: 'Нет права «Настраивать показатели» или функция выключена',
  content: error,
};
const refusal = {
  400: { description: 'Неверное поле показателя: код правила и поле', content: error },
};
const listResponse = {
  200: {
    description: 'Показатели организации по порядку (и в архиве)',
    content: { 'application/json': { schema: Indicators } },
  },
  401: noAuth,
};

/** Неразовые контрагенты в области сотрудника (без архива): «Кому вести» и счёт «у N из M». */
async function visibleRegular(tx: Tx, subject: AccessSubject) {
  const list = await kpiContractorRecords(tx, { scope: kpiScopeOf(subject) });
  return list.filter((c) => c.kind !== 'oneoff');
}

function indicatorBody(r: IndicatorRecord, on: number, setup = true): Indicator {
  return {
    id: r.id,
    name: r.name,
    unit: r.unit,
    type: r.type,
    total: r.total,
    description: r.description,
    required: r.required,
    dueDay: r.dueDay,
    start: r.startMonth,
    scope: r.scope,
    autoNew: r.autoNew,
    archived: r.archived,
    order: r.sortOrder,
    version: r.version,
    // Число значений — по всей организации: его видит только тот, кто настраивает показатели.
    valueCount: setup ? r.valueCount : 0,
    hasRows: setup && r.hasRows,
    on,
  };
}

/** Показатели с числом контрагентов, у которых они ведутся (в области сотрудника). */
async function indicatorsBody(tx: Tx, subject: AccessSubject): Promise<Indicators> {
  const [list, contractors] = await Promise.all([listIndicators(tx), visibleRegular(tx, subject)]);
  const targets = await loadTargets(
    tx,
    contractors.map((c) => c.id),
  );
  const items = list.map((r) => {
    const i = kpiIndicatorOf(r);
    const on = contractors.filter((c) => indicatorOn(i, targets.get(`${r.id}|${c.id}`))).length;
    return indicatorBody(r, on, hasPermission(subject, 'indSetup'));
  });
  return { items, contractors: contractors.length };
}

/** Поля окна показателя для записи; «Включать новых автоматически» при «Всем» — всегда. */
function fieldsOf(body: IndicatorSave): IndicatorFields {
  return {
    name: body.name.trim(),
    unit: body.unit.trim(),
    type: body.type,
    total: body.total,
    description: body.description.trim(),
    required: body.required,
    dueDay: body.dueDay,
    startMonth: body.start,
    scope: body.scope,
    autoNew: whoAutoNew(body.scope, body.autoNew),
  };
}

/** Проверка окна показателя правилом домена: ошибка — 400 с кодом правила и полем. */
function checkIndicator(
  body: IndicatorSave,
  others: readonly IndicatorRecord[],
  currentMonth: string,
  selected: number,
  before?: IndicatorRecord,
) {
  const problems = indicatorProblems(
    { ...body, name: body.name, unit: body.unit },
    {
      otherNames: others.map((o) => o.name),
      currentMonth,
      selected,
      ...(before
        ? { before: { type: before.type, unit: before.unit, hasValues: before.valueCount > 0 } }
        : {}),
    },
  );
  const first = problems[0];
  if (first) apiFail(400, first.problem, INDICATOR_MESSAGES[first.problem], { field: first.field });
}

/**
 * «Кому вести» из окна показателя (прототип `kWhoApply`) по всем неразовым контрагентам организации (и в
 * архиве). Отмечать при «Выбранным» можно только контрагентов в своей области: у остальных показатель
 * остаётся, как был, и при переходе на «Всем» (`frozen`). `selected` — кто отмечен в итоге (для проверки «Выберите хотя бы одного»).
 */
async function whoPlan(
  tx: Tx,
  subject: AccessSubject,
  id: string | null,
  previous: Pick<KpiIndicator, 'scope' | 'autoNew'> | null,
  body: IndicatorSave,
) {
  const all = (await kpiContractorRecords(tx, { scope: undefined, archived: true })).filter(
    (c) => c.kind !== 'oneoff',
  );
  const visible = new Set((await visibleRegular(tx, subject)).map((c) => c.id));
  const targets = id ? await loadTargets(tx) : new Map();
  const targetOf = (cid: string) => (id ? targets.get(`${id}|${cid}`) : undefined);
  const selected = new Set(body.selected.filter((cid) => visible.has(cid)));
  if (previous) {
    for (const c of all) {
      if (!visible.has(c.id) && indicatorOn(previous, targetOf(c.id))) selected.add(c.id);
    }
  }
  // Не меняются только контрагенты вне области сотрудника; архивные в своей области при «Всем»
  // включаются, как в прототипе.
  const scope = kpiScopeOf(subject);
  const inScope = scope
    ? new Set((await kpiContractorRecords(tx, { scope, archived: true })).map((c) => c.id))
    : null;
  const frozen = new Set(inScope ? all.filter((c) => !inScope.has(c.id)).map((c) => c.id) : []);
  return { all, selected, targetOf, frozen };
}

async function saveWho(
  tx: Tx,
  id: string,
  previous: Pick<KpiIndicator, 'scope' | 'autoNew'> | null,
  scope: IndicatorSave['scope'],
  plan: Awaited<ReturnType<typeof whoPlan>>,
  today: IsoDate,
) {
  // У нового показателя строк «Кому вести» ещё нет: план считали без них.
  const changes = applyWho(
    previous,
    scope,
    plan.selected,
    plan.all,
    plan.targetOf,
    today,
    plan.frozen,
  );
  await writeTargets(tx, id, changes);
}

export const listIndicatorsRoute = createRoute({
  method: 'get',
  path: '/kpi/indicators',
  tags: ['kpi'],
  summary: 'Показатели организации',
  middleware: [requirePermission('kpiView')] as const,
  responses: {
    ...listResponse,
    403: {
      description: 'Нет права «Просматривать показатели» или функция выключена',
      content: error,
    },
  },
});

export function listIndicatorsHandler(
  deps: ApiDeps,
): RouteHandler<typeof listIndicatorsRoute, AppEnv> {
  return async (c) => {
    const body = await inKpi(deps, c, (tx) => indicatorsBody(tx, subjectOf(c)));
    return c.json(body, 200);
  };
}

export const indicatorCardRoute = createRoute({
  method: 'get',
  path: '/kpi/indicators/{id}',
  tags: ['kpi'],
  summary: 'Окно показателя: поля, у кого ведётся, история',
  middleware: [requirePermission('indSetup')] as const,
  request: { params: IndicatorIdParam },
  responses: {
    200: {
      description: 'Показатель, отмеченные контрагенты в области сотрудника и последние 30 правок',
      content: { 'application/json': { schema: IndicatorCard } },
    },
    401: noAuth,
    403: noSetup,
    404: { description: 'Показателя нет', content: error },
  },
});

export function indicatorCardHandler(
  deps: ApiDeps,
): RouteHandler<typeof indicatorCardRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const card = await inKpi(deps, c, async (tx): Promise<IndicatorCard | null> => {
      const r = await getIndicator(tx, id);
      if (!r) return null;
      const contractors = await visibleRegular(tx, subject);
      const targets = await loadTargets(
        tx,
        contractors.map((x) => x.id),
      );
      const i = kpiIndicatorOf(r);
      const selected = contractors
        .filter((x) => indicatorOn(i, targets.get(`${id}|${x.id}`)))
        .map((x) => x.id);
      const history = await indicatorHistory(tx, id, kpiScopeOf(subject));
      return {
        ...indicatorBody(r, selected.length),
        selected,
        history: history.map((h) => ({
          at: h.at.toISOString(),
          actor: h.actor,
          action: h.action,
          contractor: h.contractor,
          changes: h.changes,
        })),
      };
    });
    if (!card) return apiFail(404, 'not_found', 'Показатель не найден');
    return c.json(card, 200);
  };
}

export const createIndicatorRoute = createRoute({
  method: 'post',
  path: '/kpi/indicators',
  tags: ['kpi'],
  summary: 'Создать показатель',
  middleware: [requirePermission('indSetup')] as const,
  request: {
    body: { content: { 'application/json': { schema: IndicatorSave } }, required: true },
  },
  responses: { ...listResponse, ...refusal, 403: noSetup },
});

/** «Создать показатель» (прототип indDlg): последним по порядку, «Кому вести» — из окна. */
export function createIndicatorHandler(
  deps: ApiDeps,
): RouteHandler<typeof createIndicatorRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const result = await inKpi(deps, c, async (tx) => {
      const others = await listIndicators(tx);
      const plan = await whoPlan(tx, subject, null, null, body);
      checkIndicator(body, others, currentMonthOf(deps), plan.selected.size);
      const id = await insertIndicator(tx, fieldsOf(body));
      await saveWho(tx, id, null, body.scope, plan, today);
      await resyncFillStatuses(tx, today);
      return indicatorsBody(tx, subject);
    });
    return c.json(result, 200);
  };
}

export const updateIndicatorRoute = createRoute({
  method: 'put',
  path: '/kpi/indicators/{id}',
  tags: ['kpi'],
  summary: 'Сохранить показатель',
  middleware: [requirePermission('indSetup')] as const,
  request: {
    params: IndicatorIdParam,
    body: { content: { 'application/json': { schema: IndicatorUpdate } }, required: true },
  },
  responses: { ...listResponse, ...refusal, 403: noSetup, ...versionedSaveResponses },
});

/**
 * «Сохранить» в окне показателя: тип и единицу при значениях не меняют; изменения полей — в историю
 * «было → стало», «Кому вести» — строками по контрагентам.
 */
export function updateIndicatorHandler(
  deps: ApiDeps,
): RouteHandler<typeof updateIndicatorRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, ...body } = c.req.valid('json');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const result = await inKpi(deps, c, async (tx) => {
      const all = await listIndicators(tx);
      const before = all.find((r) => r.id === id);
      if (!before) return apiFail(404, 'not_found', 'Показатель не найден');
      const previous = kpiIndicatorOf(before);
      const plan = await whoPlan(tx, subject, id, previous, body);
      checkIndicator(
        body,
        all.filter((r) => r.id !== id),
        currentMonthOf(deps),
        plan.selected.size,
        before,
      );
      await updateIndicator(tx, id, version, fieldsOf(body));
      await saveWho(tx, id, previous, body.scope, plan, today);
      await resyncFillStatuses(tx, today);
      return indicatorsBody(tx, subject);
    });
    return c.json(result, 200);
  };
}

export const archiveIndicatorRoute = createRoute({
  method: 'post',
  path: '/kpi/indicators/{id}/archive',
  tags: ['kpi'],
  summary: 'Показатель в архив или из архива',
  middleware: [requirePermission('indSetup')] as const,
  request: {
    params: IndicatorIdParam,
    body: { content: { 'application/json': { schema: IndicatorArchive } }, required: true },
  },
  responses: { ...listResponse, 403: noSetup, ...versionedSaveResponses },
});

/** «В архив»: новых значений нет, старые видны; «Вернуть из архива». */
export function archiveIndicatorHandler(
  deps: ApiDeps,
): RouteHandler<typeof archiveIndicatorRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { archived, version } = c.req.valid('json');
    const result = await inKpi(deps, c, async (tx) => {
      await archiveIndicator(tx, id, version, archived);
      await resyncFillStatuses(tx, todayOf(deps));
      return indicatorsBody(tx, subjectOf(c));
    });
    return c.json(result, 200);
  };
}

export const deleteIndicatorRoute = createRoute({
  method: 'delete',
  path: '/kpi/indicators/{id}',
  tags: ['kpi'],
  summary: 'Удалить показатель без значений',
  middleware: [requirePermission('indSetup')] as const,
  request: { params: IndicatorIdParam, query: IndicatorVersionQuery },
  responses: {
    ...listResponse,
    403: noSetup,
    ...versionedSaveResponses,
    409: {
      description: 'По показателю есть значения (только в архив) или запись изменена',
      content: error,
    },
  },
});

/** Удалить можно только показатель без значений (ТЗ); с ними — «отправьте его в архив». */
export function deleteIndicatorHandler(
  deps: ApiDeps,
): RouteHandler<typeof deleteIndicatorRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('query');
    const result = await inKpi(deps, c, async (tx) => {
      const r = await getIndicator(tx, id);
      if (!r) return apiFail(404, 'not_found', 'Показатель не найден');
      if (r.hasRows) kpiFail(409, 'indicator_has_values');
      await deleteIndicator(tx, { id, name: r.name, version });
      await resyncFillStatuses(tx, todayOf(deps));
      return indicatorsBody(tx, subjectOf(c));
    });
    return c.json(result, 200);
  };
}

export const orderIndicatorsRoute = createRoute({
  method: 'put',
  path: '/kpi/indicators-order',
  tags: ['kpi'],
  summary: 'Порядок показателей',
  middleware: [requirePermission('indSetup')] as const,
  request: {
    body: { content: { 'application/json': { schema: IndicatorOrder } }, required: true },
  },
  responses: {
    ...listResponse,
    403: noSetup,
    409: { description: 'Список показателей изменился — порядок устарел', content: error },
  },
});

/** Порядок перетаскиванием: в этом порядке показатели идут в таблицах и в карточке контрагента. */
export function orderIndicatorsHandler(
  deps: ApiDeps,
): RouteHandler<typeof orderIndicatorsRoute, AppEnv> {
  return async (c) => {
    const { ids } = c.req.valid('json');
    const result = await inKpi(deps, c, async (tx) => {
      if (!(await reorderIndicators(tx, ids))) kpiFail(409, 'indicator_order');
      return indicatorsBody(tx, subjectOf(c));
    });
    return c.json(result, 200);
  };
}
