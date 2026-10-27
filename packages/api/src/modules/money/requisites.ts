import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  deleteEmployeeWallet,
  deleteOrgAccount,
  getEmployee,
  listBanks,
  listEmployeeWallets,
  listOrgAccounts,
  phoneCodes,
  saveEmployeeWallet,
  saveOrgAccount,
  withOrgContext,
  type Tx,
} from '@buhuchet/db';
import {
  hasPermission,
  normalizeRequisite,
  REQUISITE_MESSAGES,
  requisiteProblem,
  type RequisiteInput,
} from '@buhuchet/domain';
import {
  ApiError,
  Banks,
  OrgAccounts,
  OrgAccountSave,
  OrgAccountUpdate,
  RequisiteDeleteQuery,
  RequisiteIdParam,
  Uuid,
  Wallets,
  WalletSave,
  WalletUpdate,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import {
  asSessionUser,
  orgContextOf,
  requireEmployee,
  requirePermission,
} from '../../middleware/access';

/*
 * Реквизиты для переводов (задача 2.18; ТЗ «Моя организация» → «Реквизиты организации для приёма
 * денег», «Профиль пользователя» → «Мои реквизиты для переводов»; прототип modules/org.js, profile.js,
 * staff.js). Счета организации видят все сотрудники, меняет право «Настройки и учётная политика»
 * (`org`). Свои реквизиты ведёт сам сотрудник; чужие видят владелец и роль с правами «Учёт денег и
 * оплата налогов» и «Видеть все отчёты и всех контрагентов» (docs/deviations.md п. В-1, решение А).
 * Ответ на правку — весь список: «Основной» меняется и у соседних реквизитов.
 */

const error = { 'application/json': { schema: ApiError } };

/** Неверный реквизит: код ошибки — ключ словаря, поле — куда поставить ошибку на экране. */
const refusal = {
  400: {
    description:
      'Неверный реквизит: банк не из действующих, номер счёта, БИК, телефон или банки номера',
    content: error,
  },
};

/**
 * Проверить и привести реквизит формы. `keep` — банки реквизита до правки: отключённый с тех пор банк
 * остаётся допустимым.
 */
async function checkedRequisite<T extends RequisiteInput>(
  tx: Tx,
  input: T,
  owner: 'org' | 'employee',
  keep: readonly string[] = [],
): Promise<T> {
  const banks = await listBanks(tx, { all: true });
  const value = normalizeRequisite(input, owner, banks);
  const problem = requisiteProblem(value, owner, banks, await phoneCodes(tx), keep);
  if (problem) {
    apiFail(400, problem.problem, REQUISITE_MESSAGES[problem.problem], { field: problem.field });
  }
  return value;
}

const banksOf = (r: { bankCode: string | null; phoneBanks: readonly string[] }) =>
  r.bankCode ? [r.bankCode, ...r.phoneBanks] : [...r.phoneBanks];

/* ───────────── «Банковские провайдеры» ───────────── */

export const banksRoute = createRoute({
  method: 'get',
  path: '/banks',
  tags: ['money'],
  summary: 'Справочник платформы «Банковские провайдеры» для реквизитов',
  responses: {
    200: {
      description: 'Банки и кошельки по порядку справочника, с отключёнными',
      content: { 'application/json': { schema: Banks } },
    },
    401: { description: 'Нет входа', content: error },
  },
});

/**
 * Провайдеры для формы реквизита (прототип `rqProvs`): отключённые тоже — их название нужно реквизиту,
 * в котором банк выбрали до отключения. Справочник общий, его читает любой вошедший.
 */
export function banksHandler(deps: ApiDeps): RouteHandler<typeof banksRoute, AppEnv> {
  return async (c) => {
    const items = await asSessionUser(deps, c.get('session')!, (tx) =>
      listBanks(tx, { all: true }),
    );
    return c.json({ items }, 200);
  };
}

/* ───────────── Счета организации ───────────── */

export const orgAccountsRoute = createRoute({
  method: 'get',
  path: '/org/accounts',
  tags: ['money'],
  summary: '«Реквизиты для приёма денег от контрагентов»: счета организации',
  middleware: [requireEmployee] as const,
  responses: {
    200: {
      description: 'Счета по порядку добавления',
      content: { 'application/json': { schema: OrgAccounts } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не сотрудник организации', content: error },
  },
});

export function orgAccountsHandler(deps: ApiDeps): RouteHandler<typeof orgAccountsRoute, AppEnv> {
  return async (c) => {
    const items = await withOrgContext(deps.db, orgContextOf(c), (tx) => listOrgAccounts(tx));
    return c.json({ items }, 200);
  };
}

const accountsResponse = {
  200: {
    description: 'Счета организации после правки',
    content: { 'application/json': { schema: OrgAccounts } },
  },
  401: { description: 'Нет входа', content: error },
  403: { description: 'Нет права «Настройки и учётная политика»', content: error },
};

export const createOrgAccountRoute = createRoute({
  method: 'post',
  path: '/org/accounts',
  tags: ['money'],
  summary: 'Добавить счёт организации',
  middleware: [requirePermission('org')] as const,
  request: {
    body: { content: { 'application/json': { schema: OrgAccountSave } }, required: true },
  },
  responses: { ...accountsResponse, ...refusal },
});

/**
 * «Добавить» в окне «Счёт организации» (прототип orgAccDlg): первый счёт — основной и для налогов, и
 * для обслуживания; отмеченный основным снимает отметку с прежнего. Добавление — в историю.
 */
export function createOrgAccountHandler(
  deps: ApiDeps,
): RouteHandler<typeof createOrgAccountRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const items = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const input = await checkedRequisite(tx, body, 'org');
      await saveOrgAccount(tx, null, input);
      return listOrgAccounts(tx);
    });
    return c.json({ items }, 200);
  };
}

export const updateOrgAccountRoute = createRoute({
  method: 'patch',
  path: '/org/accounts/{id}',
  tags: ['money'],
  summary: 'Изменить счёт организации',
  middleware: [requirePermission('org')] as const,
  request: {
    params: RequisiteIdParam,
    body: { content: { 'application/json': { schema: OrgAccountUpdate } }, required: true },
  },
  responses: { ...accountsResponse, ...refusal, ...versionedSaveResponses },
});

/** «Сохранить» в окне счёта: изменения — в историю «было → стало», устаревшая версия — 409. */
export function updateOrgAccountHandler(
  deps: ApiDeps,
): RouteHandler<typeof updateOrgAccountRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, ...body } = c.req.valid('json');
    const items = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const current = (await listOrgAccounts(tx)).find((a) => a.id === id);
      const input = await checkedRequisite(tx, body, 'org', current ? banksOf(current) : []);
      await saveOrgAccount(tx, { id, version }, input);
      return listOrgAccounts(tx);
    });
    return c.json({ items }, 200);
  };
}

export const deleteOrgAccountRoute = createRoute({
  method: 'delete',
  path: '/org/accounts/{id}',
  tags: ['money'],
  summary: 'Удалить счёт организации',
  middleware: [requirePermission('org')] as const,
  request: { params: RequisiteIdParam, query: RequisiteDeleteQuery },
  responses: { ...accountsResponse, ...versionedSaveResponses },
});

/** Удаление счёта: прошлые поступления не меняются; удалённый основной заменяет первый подходящий. */
export function deleteOrgAccountHandler(
  deps: ApiDeps,
): RouteHandler<typeof deleteOrgAccountRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('query');
    const items = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      await deleteOrgAccount(tx, { id, version });
      return listOrgAccounts(tx);
    });
    return c.json({ items }, 200);
  };
}

/* ───────────── Реквизиты сотрудника ───────────── */

/** Сотрудник вошедшего: реквизиты в «Мой профиль» — только свои. */
function ownEmployee(c: Context<AppEnv>): string {
  const employeeId = c.get('session')?.employeeId;
  if (!employeeId) apiFail(403, 'forbidden', 'Нет права на это действие');
  return employeeId;
}

export const myWalletsRoute = createRoute({
  method: 'get',
  path: '/profile/wallets',
  tags: ['money'],
  summary: '«Мои реквизиты для переводов»',
  middleware: [requireEmployee] as const,
  responses: {
    200: {
      description: 'Свои реквизиты по порядку добавления',
      content: { 'application/json': { schema: Wallets } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Не сотрудник организации', content: error },
  },
});

export function myWalletsHandler(deps: ApiDeps): RouteHandler<typeof myWalletsRoute, AppEnv> {
  return async (c) => {
    const employeeId = ownEmployee(c);
    const items = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      listEmployeeWallets(tx, employeeId),
    );
    return c.json({ items }, 200);
  };
}

const walletsResponse = {
  200: {
    description: 'Свои реквизиты после правки',
    content: { 'application/json': { schema: Wallets } },
  },
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не сотрудник организации', content: error },
};

export const createWalletRoute = createRoute({
  method: 'post',
  path: '/profile/wallets',
  tags: ['money'],
  summary: 'Добавить свой реквизит для переводов',
  middleware: [requireEmployee] as const,
  request: {
    body: { content: { 'application/json': { schema: WalletSave } }, required: true },
  },
  responses: { ...walletsResponse, ...refusal },
});

/** «Добавить» в окне «Новый реквизит» (прототип walletDlg): первый реквизит — основной. */
export function createWalletHandler(deps: ApiDeps): RouteHandler<typeof createWalletRoute, AppEnv> {
  return async (c) => {
    const employeeId = ownEmployee(c);
    const body = c.req.valid('json');
    const items = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const input = await checkedRequisite(tx, { ...body, bik: null }, 'employee');
      await saveEmployeeWallet(tx, employeeId, null, input);
      return listEmployeeWallets(tx, employeeId);
    });
    return c.json({ items }, 200);
  };
}

export const updateWalletRoute = createRoute({
  method: 'patch',
  path: '/profile/wallets/{id}',
  tags: ['money'],
  summary: 'Изменить свой реквизит или сделать его основным',
  middleware: [requireEmployee] as const,
  request: {
    params: RequisiteIdParam,
    body: { content: { 'application/json': { schema: WalletUpdate } }, required: true },
  },
  responses: { ...walletsResponse, ...refusal, ...versionedSaveResponses },
});

/** «Сохранить» в окне реквизита и «Сделать основным» в списке. */
export function updateWalletHandler(deps: ApiDeps): RouteHandler<typeof updateWalletRoute, AppEnv> {
  return async (c) => {
    const employeeId = ownEmployee(c);
    const { id } = c.req.valid('param');
    const { version, ...body } = c.req.valid('json');
    const items = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const current = (await listEmployeeWallets(tx, employeeId)).find((w) => w.id === id);
      const input = await checkedRequisite(
        tx,
        { ...body, bik: null },
        'employee',
        current ? banksOf(current) : [],
      );
      await saveEmployeeWallet(tx, employeeId, { id, version }, input);
      return listEmployeeWallets(tx, employeeId);
    });
    return c.json({ items }, 200);
  };
}

export const deleteWalletRoute = createRoute({
  method: 'delete',
  path: '/profile/wallets/{id}',
  tags: ['money'],
  summary: 'Удалить свой реквизит',
  middleware: [requireEmployee] as const,
  request: { params: RequisiteIdParam, query: RequisiteDeleteQuery },
  responses: { ...walletsResponse, ...versionedSaveResponses },
});

/** Удалённый реквизит больше не подставляется в напоминания; основным становится первый. */
export function deleteWalletHandler(deps: ApiDeps): RouteHandler<typeof deleteWalletRoute, AppEnv> {
  return async (c) => {
    const employeeId = ownEmployee(c);
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('query');
    const items = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      await deleteEmployeeWallet(tx, employeeId, { id, version });
      return listEmployeeWallets(tx, employeeId);
    });
    return c.json({ items }, 200);
  };
}

export const employeeWalletsRoute = createRoute({
  method: 'get',
  path: '/staff/{id}/wallets',
  tags: ['money'],
  summary: 'Реквизиты сотрудника для переводов в его карточке',
  middleware: [requireEmployee] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: {
      description: 'Реквизиты сотрудника по порядку добавления',
      content: { 'application/json': { schema: Wallets } },
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Чужие реквизиты — только владельцу и роли с правами «Учёт денег и оплата налогов» и «Видеть все отчёты и всех контрагентов»',
      content: error,
    },
    404: { description: 'Нет такого сотрудника в организации', content: error },
  },
});

/**
 * Блок «Реквизиты для переводов» в карточке сотрудника (прототип empCard; кто видит — решение
 * заказчика 27.10.2026, docs/deviations.md п. В-1): сам сотрудник, владелец и роль с правами
 * «Учёт денег и оплата налогов» и «Видеть все отчёты и всех контрагентов».
 */
export function employeeWalletsHandler(
  deps: ApiDeps,
): RouteHandler<typeof employeeWalletsRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = c.get('access')!.subject;
    const own = c.get('session')?.employeeId === id;
    if (!own && !(hasPermission(subject, 'money') && hasPermission(subject, 'viewAll'))) {
      apiFail(403, 'forbidden', 'Нет права на это действие');
    }
    const items = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      if (!(await getEmployee(tx, id))) apiFail(404, 'not_found', 'Сотрудник не найден');
      return listEmployeeWallets(tx, id);
    });
    return c.json({ items }, 200);
  };
}
