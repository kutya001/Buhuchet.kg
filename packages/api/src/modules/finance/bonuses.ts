import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  bonusBalanceRows,
  bonusBalancesOf,
  bonusLogRows,
  bonusWhat,
  exportBonusBalances,
  exportBonusLog,
  getEmployee,
  listBonusBalancePage,
  listBonusBalanceValues,
  listBonusLogPage,
  listBonusLogValues,
  orgMenuSettings,
  undoBonusWriteoff,
  withOrgContext,
  writeOffBonus,
  type BonusLogRow as DbLogRow,
  type BonusVisibility,
  type ListPageResult,
  type ListTexts,
  type Tx,
} from '@buhuchet/db';
import {
  EMPTY_BONUS_BALANCE,
  hasPermission,
  type AccessSubject,
  type Feature,
} from '@buhuchet/domain';
import {
  BonusBalanceList,
  BonusEmployee,
  BonusEmployeeParam,
  BonusLogList,
  BonusLogQuery,
  BonusOutRequest,
  BonusOutSaved,
  BonusSummary,
  BonusUndoRequest,
  BonusWriteoffParam,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  type BonusLogRow,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import { z } from 'zod';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { orgContextOf, requireAnyPermission, requirePermission } from '../../middleware/access';
import { subjectOf, todayOf } from '../contractors/common';
import { serverTexts } from '../l10n/texts';
import { finScopeOf, withMoneyErrors } from '../money/common';
import { error } from '../reports/common';
import { serviceReadScope, servicesVisible } from './services';

/*
 * «Сотрудники» → «Бонусы» (прототип v84 и v87, просьба заказчика 12.11.2026: modules/staff.js — вкладка
 * `bonus`, `bonusLogGrid`, `bonusEmpDlg`; modules/services.js — `bonusLog`, `bonusSum`, `bonusOutDlg`,
 * `bonusUndo`; docs/deviations.md п. О-75). «Остатки» — сколько накоплено у каждого сотрудника,
 * «Начисления и списания» — журнал, окно сотрудника и «Списать бонус».
 *
 * Видит раздел право «Сотрудники и роли» или «Списывать остаток в бонус» вместе с правом
 * «Просматривать сотрудников», которое открывает модуль (как в прототипе); списывает и отменяет списание
 * — только «Списывать остаток в бонус». Суммы бонусов — данные о сотрудниках и видны
 * целиком; контрагент и основание записи журнала — только тому, кто видит её источник: списание остатка
 * — с правом на деньги контрагентов, услугу — кому видны услуги, оба — в области «Свои / Все» группы
 * «Финансовые операции» (строже прототипа, как п. В-29).
 */

const json = <S>(schema: S) => ({ 'application/json': { schema } });
const noAuth = { description: 'Нет входа', content: error };
const noView = {
  description: 'Нет права «Сотрудники и роли» и «Списывать остаток в бонус»',
  content: error,
};
const noExport = {
  description: 'Нет права смотреть бонусы или «Выгружать в Excel»',
  content: error,
};
const noOut = { description: 'Нет права «Списывать остаток в бонус»', content: error };
const noEmployee = { description: 'Сотрудника нет', content: error };

// Раздел — вкладка модуля «Сотрудники»: модуль открывает право «Просматривать сотрудников» (как у
// экрана и в прототипе `core/registry.js`), поэтому оно нужно и каждому методу раздела.
const inStaff = requirePermission('staffView');
const canView = requireAnyPermission('staff', 'bonus');

/** Кому видны контрагент и основание записей журнала. */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-75
function visibilityOf(subject: AccessSubject, features: Record<Feature, boolean>): BonusVisibility {
  const money = hasPermission(subject, 'finView') || hasPermission(subject, 'money');
  return {
    ops: money && features.taxpay ? finScopeOf(subject) : null,
    services:
      features.finops && servicesVisible(subject, features) ? serviceReadScope(subject) : null,
  };
}

/** Транзакция раздела: настройки организации и отказы слоя данных — ответом API. */
function inBonuses<T>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  fn: (tx: Tx, see: BonusVisibility, features: Record<Feature, boolean>) => Promise<T>,
  kind?: 'export',
): Promise<T> {
  const ctx = orgContextOf(c);
  const subject = subjectOf(c);
  return withOrgContext(deps.db, kind ? { ...ctx, kind } : ctx, async (tx) => {
    const { features } = await orgMenuSettings(tx, ctx.orgId);
    return withMoneyErrors(() => fn(tx, visibilityOf(subject, features), features));
  });
}

const logOut = (r: DbLogRow, t: ListTexts): BonusLogRow => ({
  id: r.id,
  kind: r.kind,
  date: r.date,
  employee: { id: r.employeeId, name: r.employeeName },
  amount: r.amount,
  contractor: r.contractor,
  what: bonusWhat(r, t),
  by: r.by,
  serviceId: r.serviceId,
  operationId: r.operationId,
  writeoff: r.writeoff,
});

const pageOut = <T, R>(page: ListPageResult<T>, item: (row: T) => R) => ({
  items: page.rows.map(item),
  total: page.total,
  page: page.page,
  size: page.size,
  totals: page.totals,
  ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
});

/* ───────────── «Остатки» ───────────── */

export const bonusSummaryRoute = createRoute({
  method: 'get',
  path: '/bonuses/summary',
  tags: ['finance'],
  summary: '«Бонусы»: плашки и что можно делать',
  middleware: [inStaff, canView] as const,
  responses: {
    200: {
      description:
        'Накоплено у всех сотрудников: из остатков контрагентов, за разовые услуги, ожидает оплаты услуг, списано, остаток',
      content: json(BonusSummary),
    },
    401: noAuth,
    403: noView,
  },
});

export function bonusSummaryHandler(deps: ApiDeps): RouteHandler<typeof bonusSummaryRoute, AppEnv> {
  return async (c) => {
    const subject = subjectOf(c);
    const body = await inBonuses(deps, c, async (tx, _see, features): Promise<BonusSummary> => {
      const rows = await bonusBalanceRows(tx);
      const sum = (k: 'cp' | 'svc' | 'wait' | 'out' | 'bal') =>
        rows.reduce((total, r) => total + r[k], 0);
      return {
        cp: sum('cp'),
        svc: sum('svc'),
        wait: sum('wait'),
        out: sum('out'),
        bal: sum('bal'),
        canOut: hasPermission(subject, 'bonus'),
        // Прежний отчёт о списаниях — как раньше (docs/deviations.md п. В-29).
        contractors:
          hasPermission(subject, 'staff') &&
          (hasPermission(subject, 'finView') || hasPermission(subject, 'money')) &&
          features.accounts &&
          features.taxpay,
      };
    });
    c.header('Cache-Control', 'no-store');
    return c.json(body, 200);
  };
}

const balanceOut = (r: Awaited<ReturnType<typeof bonusBalanceRows>>[number]) => ({
  id: r.id,
  fullName: r.fullName,
  role: r.role,
  active: r.active,
  cp: r.cp,
  svc: r.svc,
  wait: r.wait,
  out: r.out,
  bal: r.bal,
});

export const bonusBalancesRoute = createRoute({
  method: 'get',
  path: '/bonuses/balances',
  tags: ['finance'],
  summary: '«Бонусы» → «Остатки»: страница списка сотрудников',
  middleware: [inStaff, canView] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description:
        'Действующие сотрудники и те, у кого были начисления или списания: по умолчанию — по остатку, от больших',
      content: json(BonusBalanceList),
    },
    ...listQueryResponses,
    401: noAuth,
    403: noView,
  },
});

export function bonusBalancesHandler(
  deps: ApiDeps,
): RouteHandler<typeof bonusBalancesRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const page = await inBonuses(deps, c, async (tx) =>
      listBonusBalancePage(tx, query, await bonusBalanceRows(tx)),
    );
    return c.json(pageOut(page, balanceOut), 200);
  };
}

export const bonusBalanceValuesRoute = createRoute({
  method: 'get',
  path: '/bonuses/balances/values',
  tags: ['finance'],
  summary: 'Значения столбца «Остатков» для фильтра',
  middleware: [inStaff, canView] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: { description: 'Значения столбца с числом строк', content: json(ListValues) },
    ...listQueryResponses,
    401: noAuth,
    403: noView,
  },
});

export function bonusBalanceValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof bonusBalanceValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const values = await inBonuses(deps, c, async (tx) =>
      listBonusBalanceValues(tx, col, await bonusBalanceRows(tx), q),
    );
    return c.json(values, 200);
  };
}

export const bonusBalanceExportRoute = createRoute({
  method: 'get',
  path: '/bonuses/balances/export',
  tags: ['finance'],
  summary: '«Остатки» бонусов в Excel',
  middleware: [inStaff, canView, requirePermission('export')] as const,
  request: { query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со всеми строками под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    401: noAuth,
    403: noExport,
  },
});

export function bonusBalanceExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof bonusBalanceExportRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const result = await inBonuses(
        deps,
        c,
        async (tx) => exportBonusBalances(tx, query, keys, await bonusBalanceRows(tx)),
        'export',
      );
      return xlsxResponse(c, {
        title: t('tab.staff.bonus'),
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        total: result.total,
        t,
      });
    });
  };
}

/* ───────────── «Начисления и списания» ───────────── */

/** Записи журнала: всей организации или одного сотрудника (окно сотрудника). */
const logRowsOf = (tx: Tx, see: BonusVisibility, employeeId: string | undefined) =>
  bonusLogRows(tx, see, employeeId ? [employeeId] : undefined);

export const bonusLogRoute = createRoute({
  method: 'get',
  path: '/bonuses/log',
  tags: ['finance'],
  summary: '«Бонусы» → «Начисления и списания»: страница журнала',
  middleware: [inStaff, canView] as const,
  request: { query: ListQueryParams.extend(BonusLogQuery.shape) },
  responses: {
    200: {
      description:
        'Начисления (остаток контрагента, разовая услуга, ожидает оплаты услуги) и действующие списания: по умолчанию — по дате, сначала новые',
      content: json(BonusLogList),
    },
    ...listQueryResponses,
    401: noAuth,
    403: noView,
  },
});

export function bonusLogHandler(deps: ApiDeps): RouteHandler<typeof bonusLogRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const t = await serverTexts(deps);
    const page = await inBonuses(deps, c, async (tx, see) =>
      listBonusLogPage(tx, query, await logRowsOf(tx, see, params.employeeId), t),
    );
    return c.json(
      pageOut(page, (r) => logOut(r, t)),
      200,
    );
  };
}

export const bonusLogValuesRoute = createRoute({
  method: 'get',
  path: '/bonuses/log/values',
  tags: ['finance'],
  summary: 'Значения столбца журнала бонусов для фильтра',
  middleware: [inStaff, canView] as const,
  request: { query: ListValuesQuery.extend(BonusLogQuery.shape) },
  responses: {
    200: { description: 'Значения столбца с числом строк', content: json(ListValues) },
    ...listQueryResponses,
    401: noAuth,
    403: noView,
  },
});

export function bonusLogValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof bonusLogValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q, employeeId } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await inBonuses(deps, c, async (tx, see) =>
      listBonusLogValues(tx, col, await logRowsOf(tx, see, employeeId), t, q),
    );
    return c.json(values, 200);
  };
}

export const bonusLogExportRoute = createRoute({
  method: 'get',
  path: '/bonuses/log/export',
  tags: ['finance'],
  summary: 'Журнал бонусов в Excel',
  middleware: [inStaff, canView, requirePermission('export')] as const,
  request: { query: ListExportParams.extend(BonusLogQuery.shape) },
  responses: {
    200: {
      description: 'Файл Excel со всеми строками под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    401: noAuth,
    403: noExport,
  },
});

export function bonusLogExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof bonusLogExportRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const result = await inBonuses(
        deps,
        c,
        async (tx, see) =>
          exportBonusLog(tx, query, keys, await logRowsOf(tx, see, params.employeeId), t),
        'export',
      );
      return xlsxResponse(c, {
        title: t('tab.staff.bonus'),
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        total: result.total,
        t,
      });
    });
  };
}

/* ───────────── Окно сотрудника и списание ───────────── */

export const bonusEmployeeRoute = createRoute({
  method: 'get',
  path: '/bonuses/employees/{id}',
  tags: ['finance'],
  summary: 'Окно «Бонусы: начисления и списания» сотрудника',
  middleware: [inStaff, canView] as const,
  request: { params: BonusEmployeeParam },
  responses: {
    200: { description: 'Сотрудник и его накопления', content: json(BonusEmployee) },
    401: noAuth,
    403: noView,
    404: noEmployee,
  },
});

export function bonusEmployeeHandler(
  deps: ApiDeps,
): RouteHandler<typeof bonusEmployeeRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const body = await inBonuses(deps, c, async (tx, see): Promise<BonusEmployee | null> => {
      const e = await getEmployee(tx, id);
      if (!e) return null;
      const b = bonusBalancesOf(await bonusLogRows(tx, see, [id])).get(id) ?? EMPTY_BONUS_BALANCE;
      return {
        id,
        fullName: e.fullName,
        ...b,
        canOut: hasPermission(subject, 'bonus'),
        today: todayOf(deps),
      };
    });
    if (!body) apiFail(404, 'not_found', 'Сотрудник не найден');
    c.header('Cache-Control', 'no-store');
    return c.json(body, 200);
  };
}

export const bonusOutRoute = createRoute({
  method: 'post',
  path: '/bonuses/employees/{id}/writeoffs',
  tags: ['finance'],
  summary: '«Списать бонус»',
  middleware: [inStaff, requirePermission('bonus')] as const,
  request: {
    params: BonusEmployeeParam,
    body: { required: true, content: json(BonusOutRequest) },
  },
  responses: {
    201: { description: 'Списание записано; новый остаток бонусов', content: json(BonusOutSaved) },
    400: { description: 'Неверные сумма, дата или основание', content: error },
    401: noAuth,
    403: noOut,
    404: noEmployee,
    409: { description: 'У сотрудника нет накопленных бонусов', content: error },
  },
});

export function bonusOutHandler(deps: ApiDeps): RouteHandler<typeof bonusOutRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const saved = await inBonuses(deps, c, (tx) =>
      writeOffBonus(
        tx,
        { employeeId: id, amount: input.amount, date: input.date, note: input.note },
        { today: todayOf(deps) },
      ),
    );
    return c.json(saved, 201);
  };
}

export const bonusUndoRoute = createRoute({
  method: 'post',
  path: '/bonus-writeoffs/{id}/undo',
  tags: ['finance'],
  summary: '«Отменить списание» бонуса',
  middleware: [inStaff, requirePermission('bonus')] as const,
  request: {
    params: BonusWriteoffParam,
    body: { required: true, content: json(BonusUndoRequest) },
  },
  responses: {
    200: {
      description: 'Списание отменено: сумма вернулась в остаток',
      content: json(z.object({})),
    },
    401: noAuth,
    403: noOut,
    404: { description: 'Нет такого списания', content: error },
    409: { description: 'Списание уже отменено или изменено другим пользователем', content: error },
  },
});

export function bonusUndoHandler(deps: ApiDeps): RouteHandler<typeof bonusUndoRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('json');
    await inBonuses(deps, c, (tx) => undoBonusWriteoff(tx, id, version));
    return c.json({}, 200);
  };
}
