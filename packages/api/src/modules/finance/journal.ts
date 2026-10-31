import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  bonusesOfMonth,
  closedMonthsOf,
  closeMonth,
  exportBonuses,
  exportFinJournal,
  exportReceiptJournal,
  finSummary,
  listBonusPage,
  listBonusValues,
  listFinJournalPage,
  listFinJournalValues,
  listReceiptJournalPage,
  listReceiptJournalValues,
  MonthClosedTakenError,
  orgMenuSettings,
  withOrgContext,
  type Tx,
} from '@buhuchet/db';
import {
  hasPermission,
  monthOf,
  monthToClose,
  scopeOf,
  type AccessSubject,
  type Feature,
} from '@buhuchet/domain';
import {
  BonusRow,
  ClosedMonths,
  CloseMonthRequest,
  type FIN_JOURNAL_TAB_IDS,
  FinJournalParams,
  FinJournalRow,
  FinSummary,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  OkResponse,
  ReceiptJournalParams,
  ReceiptJournalRow,
  listPageSchema,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { subjectOf, todayOf, translateOf } from '../contractors/common';
import { serverTexts } from '../l10n/texts';
import { finScopeOf, moneyFail, withMoneyErrors } from '../money/common';
import { journalLocks } from './common';
import { error } from '../reports/common';

/*
 * Модуль «Финансовые операции по контрагентам» (задача 2.22; ТЗ «Финансовые операции по
 * контрагентам»; прототип modules/finance.js `renderFin`, `finRows`, `finCols`, `renderJournal`) и
 * вкладка «Списания в бонус» раздела «Сотрудники» (прототип modules/staff.js, `bonus`). Строки — в
 * области группы «Финансовые операции»; налоговые операции — с «Учётом оплаты налогов» и правом «Учёт
 * денег», оплаты за обслуживание — с «Платой за обслуживание» и правом «Видеть плату» (прототип
 * `taxVis`, `feat('fee') && can('fee')`).
 */

const json = <S>(schema: S) => ({ 'application/json': { schema } });

const noAuth = { description: 'Нет входа', content: error };
const noFin = {
  description:
    '«Финансовые операции по контрагентам» выключены или нет права «Просматривать финансовые операции»',
  content: error,
};
const noFinExport = {
  description: 'Нет права «Просматривать финансовые операции» или «Выгружать в Excel»',
  content: error,
};
const noReceipts = {
  description:
    '«Финансовые операции» или «Учёт оплаты налогов» выключены, нет права «Просматривать финансовые операции» или «Учёт денег»',
  content: error,
};
const noBonus = {
  description:
    'Нет права «Сотрудники и роли» или права на деньги контрагентов; «Учёт оплаты налогов» или «Виртуальные счета» выключены',
  content: error,
};

export const FinJournalList = listPageSchema(FinJournalRow);
export const ReceiptJournalList = listPageSchema(ReceiptJournalRow);
export const BonusList = listPageSchema(BonusRow);

/**
 * Транзакция модуля: «Финансовые операции по контрагентам» выключены в учётной политике — 403
 * `finops_off` (сервер проверяет сам, а не только прячет пункт меню).
 */
function inFinops<T>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  fn: (tx: Tx, features: Record<Feature, boolean>) => Promise<T>,
  kind?: 'export',
): Promise<T> {
  const ctx = orgContextOf(c);
  return withOrgContext(deps.db, kind ? { ...ctx, kind } : ctx, async (tx) => {
    const { features } = await orgMenuSettings(tx, ctx.orgId);
    if (!features.finops) moneyFail(403, 'finops_off');
    return withMoneyErrors(() => fn(tx, features));
  });
}

/** Что видит сотрудник в модуле (прототип `taxVis`, `feat('fee') && can('fee')`). */
function visibility(subject: AccessSubject, features: Record<Feature, boolean>) {
  return {
    tax: features.taxpay && hasPermission(subject, 'money'),
    fee: features.fee && hasPermission(subject, 'fee'),
  };
}

async function journalInput(
  deps: ApiDeps,
  c: Context<AppEnv>,
  features: Record<Feature, boolean>,
  params: { tab: (typeof FIN_JOURNAL_TAB_IDS)[number]; deleted?: '0' | '1' },
) {
  const subject = subjectOf(c);
  return {
    tab: params.tab,
    deleted: params.deleted === '1',
    ...visibility(subject, features),
    scope: finScopeOf(subject),
    t: await serverTexts(deps),
  };
}

/* ───────────── Журнал операций ───────────── */

export const finJournalRoute = createRoute({
  method: 'get',
  path: '/fin/journal',
  tags: ['finance'],
  summary: '«Финансовые операции»: страница журнала вкладки',
  middleware: [requirePermission('finView')] as const,
  request: { query: ListQueryParams.extend(FinJournalParams.shape) },
  responses: {
    200: {
      description:
        'Операции по счетам контрагентов и оплаты за обслуживание вкладки; удалённые — с «Показать удалённые», в итоги не входят',
      content: json(FinJournalList),
    },
    ...listQueryResponses,
    401: noAuth,
    403: noFin,
  },
});

export function finJournalHandler(deps: ApiDeps): RouteHandler<typeof finJournalRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const t = await translateOf(deps);
    const subject = subjectOf(c);
    const page = await inFinops(deps, c, async (tx, features) => {
      const found = await listFinJournalPage(
        tx,
        query,
        await journalInput(deps, c, features, params),
      );
      // Меню строки: «Изменить» и «Удалить» с замком и причиной (прототип opActs).
      const lockOf = journalLocks(tx, t, subject, new Set(await closedMonthsOf(tx)));
      const rows = await Promise.all(
        found.rows.map(async ({ archived, ...r }) => {
          const facts = { ...r, archived };
          const [edit, del] = await Promise.all([lockOf(facts, 'edit'), lockOf(facts, 'del')]);
          return { ...r, locks: { edit, del } };
        }),
      );
      return { ...found, rows };
    });
    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        items: page.rows,
        total: page.total,
        page: page.page,
        size: page.size,
        totals: page.totals,
        ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
      },
      200,
    );
  };
}

export const finJournalValuesRoute = createRoute({
  method: 'get',
  path: '/fin/journal/values',
  tags: ['finance'],
  summary: 'Значения столбца журнала для фильтра',
  middleware: [requirePermission('finView')] as const,
  request: { query: ListValuesQuery.extend(FinJournalParams.shape) },
  responses: {
    200: { description: 'Значения столбца с числом строк', content: json(ListValues) },
    ...listQueryResponses,
    401: noAuth,
    403: noFin,
  },
});

export function finJournalValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof finJournalValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q, ...params } = c.req.valid('query');
    const values = await inFinops(deps, c, async (tx, features) =>
      listFinJournalValues(tx, col, await journalInput(deps, c, features, params), q),
    );
    return c.json(values, 200);
  };
}

export const finJournalExportRoute = createRoute({
  method: 'get',
  path: '/fin/journal/export',
  tags: ['finance'],
  summary: 'Журнал вкладки в Excel',
  middleware: [requirePermission('finView'), requirePermission('export')] as const,
  request: { query: ListExportParams.extend(FinJournalParams.shape) },
  responses: {
    200: {
      description: 'Файл Excel со всеми строками под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    401: noAuth,
    403: noFinExport,
  },
});

export function finJournalExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof finJournalExportRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const result = await inFinops(
        deps,
        c,
        async (tx, features) =>
          exportFinJournal(tx, query, keys, await journalInput(deps, c, features, params)),
        'export',
      );
      return xlsxResponse(c, {
        title: t(`tab.fin.${params.tab}`),
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

/* ───────────── «Журнал поступлений» ───────────── */

/** «Журнал поступлений» — тому, кто видит налоговые операции (прототип: вкладка при `taxVis()`). */
async function receiptInput(
  deps: ApiDeps,
  c: Context<AppEnv>,
  features: Record<Feature, boolean>,
  params: { deleted?: '0' | '1' },
) {
  const subject = subjectOf(c);
  const vis = visibility(subject, features);
  if (!features.taxpay) moneyFail(403, 'taxpay_off');
  if (!vis.tax) apiFail(403, 'forbidden', 'Нет права на это действие');
  return {
    deleted: params.deleted === '1',
    fee: vis.fee,
    scope: finScopeOf(subject),
    t: await serverTexts(deps),
  };
}

export const receiptJournalRoute = createRoute({
  method: 'get',
  path: '/fin/receipts',
  tags: ['finance'],
  summary: '«Журнал поступлений»: страница списка',
  middleware: [requirePermission('finView'), requirePermission('money')] as const,
  request: { query: ListQueryParams.extend(ReceiptJournalParams.shape) },
  responses: {
    200: {
      description: 'Поступления: общая сумма, детализация, аванс, сколько уже потрачено на налоги',
      content: json(ReceiptJournalList),
    },
    ...listQueryResponses,
    401: noAuth,
    403: noReceipts,
  },
});

export function receiptJournalHandler(
  deps: ApiDeps,
): RouteHandler<typeof receiptJournalRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const t = await translateOf(deps);
    const subject = subjectOf(c);
    const page = await inFinops(deps, c, async (tx, features) => {
      const found = await listReceiptJournalPage(
        tx,
        query,
        await receiptInput(deps, c, features, params),
      );
      // Меню строки — как в журнале: «Изменить», «Обратная запись» и «Удалить» с замком (прототип
      // inActions → opActs).
      const lockOf = journalLocks(tx, t, subject, new Set(await closedMonthsOf(tx)));
      const rows = await Promise.all(
        found.rows.map(async ({ archived, ...r }) => {
          const facts = { src: 'op' as const, kind: 'in', receiptPart: false, archived, ...r };
          const [edit, del] = await Promise.all([lockOf(facts, 'edit'), lockOf(facts, 'del')]);
          return { ...r, locks: { edit, del } };
        }),
      );
      return { ...found, rows };
    });
    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        items: page.rows,
        total: page.total,
        page: page.page,
        size: page.size,
        totals: page.totals,
        ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
      },
      200,
    );
  };
}

export const receiptJournalValuesRoute = createRoute({
  method: 'get',
  path: '/fin/receipts/values',
  tags: ['finance'],
  summary: 'Значения столбца «Журнала поступлений» для фильтра',
  middleware: [requirePermission('finView'), requirePermission('money')] as const,
  request: { query: ListValuesQuery.extend(ReceiptJournalParams.shape) },
  responses: {
    200: { description: 'Значения столбца с числом строк', content: json(ListValues) },
    ...listQueryResponses,
    401: noAuth,
    403: noReceipts,
  },
});

export function receiptJournalValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof receiptJournalValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q, ...params } = c.req.valid('query');
    const values = await inFinops(deps, c, async (tx, features) =>
      listReceiptJournalValues(tx, col, await receiptInput(deps, c, features, params), q),
    );
    return c.json(values, 200);
  };
}

export const receiptJournalExportRoute = createRoute({
  method: 'get',
  path: '/fin/receipts/export',
  tags: ['finance'],
  summary: '«Журнал поступлений» в Excel',
  middleware: [
    requirePermission('finView'),
    requirePermission('money'),
    requirePermission('export'),
  ] as const,
  request: { query: ListExportParams.extend(ReceiptJournalParams.shape) },
  responses: {
    200: {
      description: 'Файл Excel со всеми строками под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    401: noAuth,
    403: noReceipts,
  },
});

export function receiptJournalExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof receiptJournalExportRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const result = await inFinops(
        deps,
        c,
        async (tx, features) =>
          exportReceiptJournal(tx, query, keys, await receiptInput(deps, c, features, params)),
        'export',
      );
      return xlsxResponse(c, {
        title: t('tab.fin.journal'),
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

/* ───────────── Плашки ───────────── */

export const finSummaryRoute = createRoute({
  method: 'get',
  path: '/fin/summary',
  tags: ['finance'],
  summary: 'Плашки модуля за текущий месяц',
  middleware: [requirePermission('finView')] as const,
  responses: {
    200: {
      description:
        '«Поступило на налоги» и «оплачено в бюджет», «Получено за обслуживание», «Списания и возвраты»',
      content: json(FinSummary),
    },
    401: noAuth,
    403: noFin,
  },
});

export function finSummaryHandler(deps: ApiDeps): RouteHandler<typeof finSummaryRoute, AppEnv> {
  return async (c) => {
    const subject = subjectOf(c);
    const out = await inFinops(deps, c, (tx, features) =>
      finSummary(tx, monthOf(todayOf(deps)), {
        ...visibility(subject, features),
        scope: finScopeOf(subject),
      }),
    );
    c.header('Cache-Control', 'no-store');
    return c.json(out, 200);
  };
}

/* ───────────── «Списания в бонус» ───────────── */

/**
 * Вкладка «Списания в бонус» (прототип: `can('staff') && feat('accounts') && feat('taxpay')`). Суммы
 * видит тот, кто видит деньги контрагентов, и только в своей области группы «Финансовые операции»
 * (строже прототипа, docs/deviations.md п. В-29).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#В-29
function inBonus<T>(
  deps: ApiDeps,
  c: Context<AppEnv>,
  fn: (tx: Tx) => Promise<T>,
  kind?: 'export',
): Promise<T> {
  const subject = subjectOf(c);
  if (!hasPermission(subject, 'finView') && !hasPermission(subject, 'money'))
    apiFail(403, 'forbidden', 'Нет права на это действие');
  const ctx = orgContextOf(c);
  return withOrgContext(deps.db, kind ? { ...ctx, kind } : ctx, async (tx) => {
    const { features } = await orgMenuSettings(tx, ctx.orgId);
    if (!features.taxpay) moneyFail(403, 'taxpay_off');
    if (!features.accounts) moneyFail(403, 'accounts_off');
    return withMoneyErrors(() => fn(tx));
  });
}

async function bonusInput(deps: ApiDeps, c: Context<AppEnv>) {
  return { scope: finScopeOf(subjectOf(c)), t: await serverTexts(deps) };
}

export const bonusListRoute = createRoute({
  method: 'get',
  path: '/fin/bonuses',
  tags: ['finance'],
  summary: '«Списания в бонус»: страница списка',
  middleware: [requirePermission('staff')] as const,
  request: { query: ListQueryParams },
  responses: {
    200: { description: 'Действующие списания в бонус', content: json(BonusList) },
    ...listQueryResponses,
    401: noAuth,
    403: noBonus,
  },
});

export function bonusListHandler(deps: ApiDeps): RouteHandler<typeof bonusListRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await translateOf(deps);
    const subject = subjectOf(c);
    const page = await inBonus(deps, c, async (tx) => {
      const found = await listBonusPage(tx, query, await bonusInput(deps, c));
      // Меню строки — те же действия, что в окне операции (прототип opActs).
      const lockOf = journalLocks(tx, t, subject, new Set(await closedMonthsOf(tx)));
      const rows = await Promise.all(
        found.rows.map(async ({ archived, ...r }) => {
          const facts = {
            src: 'op' as const,
            kind: 'bonus',
            deleted: false,
            archived,
            receiptPart: false,
            date: r.date,
          };
          const [edit, del] = await Promise.all([lockOf(facts, 'edit'), lockOf(facts, 'del')]);
          return { ...r, locks: { edit, del } };
        }),
      );
      return { ...found, rows };
    });
    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        items: page.rows,
        total: page.total,
        page: page.page,
        size: page.size,
        totals: page.totals,
        ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
      },
      200,
    );
  };
}

export const bonusValuesRoute = createRoute({
  method: 'get',
  path: '/fin/bonuses/values',
  tags: ['finance'],
  summary: 'Значения столбца «Списаний в бонус» для фильтра',
  middleware: [requirePermission('staff')] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: { description: 'Значения столбца с числом строк', content: json(ListValues) },
    ...listQueryResponses,
    401: noAuth,
    403: noBonus,
  },
});

export function bonusValuesHandler(deps: ApiDeps): RouteHandler<typeof bonusValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const values = await inBonus(deps, c, async (tx) =>
      listBonusValues(tx, col, await bonusInput(deps, c), q),
    );
    return c.json(values, 200);
  };
}

export const bonusExportRoute = createRoute({
  method: 'get',
  path: '/fin/bonuses/export',
  tags: ['finance'],
  summary: '«Списания в бонус» в Excel',
  middleware: [requirePermission('staff'), requirePermission('export')] as const,
  request: { query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со всеми строками под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    401: noAuth,
    403: noBonus,
  },
});

export function bonusExportHandler(deps: ApiDeps): RouteHandler<typeof bonusExportRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const t = await serverTexts(deps);
      const result = await inBonus(
        deps,
        c,
        async (tx) => exportBonuses(tx, query, keys, await bonusInput(deps, c)),
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

/** «Закрыть <месяц>»: право «Списывать остаток в бонус» и область «Все» финансовых операций. */
const canCloseMonth = (subject: AccessSubject) =>
  hasPermission(subject, 'bonus') && scopeOf(subject, 'fin') === 'all';

export const closedMonthsRoute = createRoute({
  method: 'get',
  path: '/fin/months',
  tags: ['finance'],
  summary: 'Закрытые месяцы и «Закрыть <прошлый месяц>»',
  middleware: [requirePermission('staff')] as const,
  responses: {
    200: {
      description: 'Закрытые месяцы, какой закрыть, можно ли, списаний за него',
      content: json(ClosedMonths),
    },
    401: noAuth,
    403: noBonus,
  },
});

export function closedMonthsHandler(deps: ApiDeps): RouteHandler<typeof closedMonthsRoute, AppEnv> {
  return async (c) => {
    const subject = subjectOf(c);
    const toClose = monthToClose(todayOf(deps));
    const can = canCloseMonth(subject);
    const out = await inBonus(deps, c, async (tx) => {
      const [closed, bonuses] = await Promise.all([
        closedMonthsOf(tx),
        // Число и сумма списаний — тому, кто закрывает: он видит все финансовые операции.
        can ? bonusesOfMonth(tx, toClose) : { count: 0, amount: 0 },
      ]);
      return { closed, bonuses };
    });
    const body: ClosedMonths = {
      closed: out.closed,
      toClose,
      canClose: can && !out.closed.includes(toClose),
      bonuses: out.bonuses,
    };
    c.header('Cache-Control', 'no-store');
    return c.json(body, 200);
  };
}

export const closeMonthRoute = createRoute({
  method: 'post',
  path: '/fin/months/close',
  tags: ['finance'],
  summary: '«Закрыть <месяц>»',
  middleware: [requirePermission('staff'), requirePermission('bonus')] as const,
  request: { body: { required: true, content: json(CloseMonthRequest) } },
  responses: {
    200: {
      description: 'Месяц закрыт: запись в истории учётной политики',
      content: json(OkResponse),
    },
    400: { description: 'Закрывают только прошлый месяц', content: error },
    401: noAuth,
    403: {
      description:
        'Нет права «Списывать остаток в бонус» или области «Все» финансовых операций; функции выключены',
      content: error,
    },
    409: { description: 'Этот месяц уже закрыт', content: error },
  },
});

export function closeMonthHandler(deps: ApiDeps): RouteHandler<typeof closeMonthRoute, AppEnv> {
  return async (c) => {
    const { month } = c.req.valid('json');
    const subject = subjectOf(c);
    if (!canCloseMonth(subject)) apiFail(403, 'forbidden', 'Нет права на это действие');
    if (month !== monthToClose(todayOf(deps)))
      apiFail(400, 'validation_failed', 'Закрывают только прошлый месяц', { field: 'month' });
    await inBonus(deps, c, async (tx) => {
      try {
        await closeMonth(tx, month);
      } catch (e) {
        if (e instanceof MonthClosedTakenError) moneyFail(409, 'month_close_taken');
        throw e;
      }
    });
    return c.json({ ok: true as const }, 200);
  };
}
