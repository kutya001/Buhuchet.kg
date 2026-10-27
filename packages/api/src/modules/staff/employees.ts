import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  exportEmployees,
  getEmployee,
  listEmployeeValues,
  listEmployeesPage,
  roleRightsMap,
  staffTabCounts,
  withOrgContext,
  type EmployeeRecord,
  type Tx,
} from '@buhuchet/db';
import {
  hasPermission,
  RecordNotFoundError,
  staffManageable,
  telegramName,
  type RoleSaveEditor,
  type StaffAction,
  type StaffActor,
  type StaffRefusal,
} from '@buhuchet/domain';
import {
  ApiError,
  Employee,
  EmployeeList,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  StaffTabCounts,
  Uuid,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { xlsxContent, xlsxResponse } from '../../lists/export';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';

export const error = { 'application/json': { schema: ApiError } };

/** Сотрудник для ответа API: только поля схемы, моменты — строкой ISO. */
export function employeeBody(e: EmployeeRecord, manageable: boolean): Employee {
  return {
    id: e.id,
    fullName: e.fullName,
    shortName: e.shortName,
    login: e.login,
    phone: e.phone,
    phoneText: e.phoneText,
    role: e.role,
    active: e.active,
    manageable,
    telegram: e.telegram && {
      name: telegramName(e.telegram),
      linkedAt: e.telegram.linkedAt.toISOString(),
    },
    lastLoginAt: e.lastLoginAt?.toISOString() ?? null,
    audit: {
      createdAt: e.audit.createdAt.toISOString(),
      createdBy: e.audit.createdBy,
      updatedAt: e.audit.updatedAt.toISOString(),
      updatedBy: e.audit.updatedBy,
    },
    version: e.version,
  };
}

/**
 * Сотрудники для ответа API с признаком `manageable` для того, кто смотрит (`staffManageable`: кнопки
 * «Сменить роль», «Сбросить пароль», «Заблокировать» скрыты, где нельзя): права ролей строк читаются
 * одним запросом. Без права «Сотрудники и роли» — нельзя ни у кого.
 */
export async function employeeBodies(
  tx: Tx,
  actor: StaffActor,
  rows: readonly EmployeeRecord[],
): Promise<Employee[]> {
  if (!hasPermission(actor, 'staff')) return rows.map((e) => employeeBody(e, false));
  const rights = await roleRightsMap(
    tx,
    rows.map((e) => e.role.id),
  );
  return rows.map((e) => {
    const role = rights.get(e.role.id);
    return employeeBody(e, !!role && staffManageable(actor, { employeeId: e.id, role }));
  });
}

/** Один сотрудник для ответа API (`employeeBodies`). */
export async function employeeOut(tx: Tx, actor: StaffActor, e: EmployeeRecord): Promise<Employee> {
  const [body] = await employeeBodies(tx, actor, [e]);
  return body!;
}

/**
 * Кто действует в методах модуля: сотрудник из общего слоя (право метода уже проверено) — его права
 * и область для правил сотрудников и своя роль для правил ролей.
 */
export function staffActor(c: Context<AppEnv>): StaffActor & RoleSaveEditor {
  const { subject, roleId } = c.get('access')!;
  return { ...subject, roleId, subject };
}

const REFUSAL_MESSAGES: Record<StaffRefusal, string> = {
  owner_employee: 'Роль, блокировку и пароль владельца организации ведёт администратор платформы',
  own_role: 'Свою роль меняет владелец',
  own_account: 'Нельзя заблокировать себя',
  owner_role: 'Роль владельца организации не назначается',
  owner_granted: 'Роль с правами, которые выдаёт только владелец, назначает и снимает владелец',
  beyond_own: 'Роль с правами шире ваших назначает и снимает владелец',
};

/**
 * Отказ 403 в действии над сотрудником (`staffActionRefusal`, `newEmployeeRoleRefusal`); внутри
 * транзакции откатывает её. Отказ в правке, сбросе пароля, блокировке и разблокировке передаёт
 * `details.variant` (`edit`, `reset_password`, `block`): экран берёт текст из словаря
 * (`err.<код>.<вариант>`), а не из ответа.
 */
export function refuse(refusal: StaffRefusal, action: StaffAction | 'create'): never {
  if (refusal === 'owner_employee' && action === 'edit') {
    apiFail(403, refusal, 'ФИО и телефон владельца меняет сам владелец', { variant: 'edit' });
  }
  if (refusal === 'owner_employee' && action === 'resetPassword') {
    apiFail(403, 'owner_password_reset', 'Пароль владельца сбрасывает администратор платформы');
  }
  if (refusal === 'owner_granted' && action === 'resetPassword') {
    apiFail(
      403,
      refusal,
      'Пароль сотрудника с правами, которые выдаёт только владелец, сбрасывает владелец',
      { variant: 'reset_password' },
    );
  }
  if (refusal === 'owner_granted' && (action === 'block' || action === 'unblock')) {
    apiFail(
      403,
      refusal,
      'Сотрудника с правами, которые выдаёт только владелец, блокирует и разблокирует владелец',
      { variant: 'block' },
    );
  }
  if (refusal === 'beyond_own' && action === 'resetPassword') {
    apiFail(403, refusal, 'Пароль сотрудника с правами шире ваших сбрасывает владелец', {
      variant: 'reset_password',
    });
  }
  if (refusal === 'beyond_own' && (action === 'block' || action === 'unblock')) {
    apiFail(403, refusal, 'Сотрудника с правами шире ваших блокирует и разблокирует владелец', {
      variant: 'block',
    });
  }
  apiFail(403, refusal, REFUSAL_MESSAGES[refusal]);
}

export const listEmployeesRoute = createRoute({
  method: 'get',
  path: '/staff',
  tags: ['staff'],
  summary: 'Сотрудники организации: страница списка',
  middleware: [requirePermission('staffView')] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description:
        'Страница списка сотрудников (и заблокированных): сортировка, страница, фильтры, поиск и группы — на сервере',
      content: { 'application/json': { schema: EmployeeList } },
    },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Просматривать сотрудников»', content: error },
  },
});

/**
 * Список сотрудников (прототип modules/staff.js, renderStaff, вкладка «Сотрудники»): в ответе только
 * текущая страница, всего записей по фильтру и итоги; в сгруппированном — ещё группы и ключи групп
 * записей. Поиск идёт и по подписям статуса и Telegram — тем же текстам словаря, что на экране.
 */
export function listEmployeesHandler(
  deps: ApiDeps,
): RouteHandler<typeof listEmployeesRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await serverTexts(deps);
    const actor = staffActor(c);
    const { page, items } = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const page = await listEmployeesPage(tx, query, t);
      return { page, items: await employeeBodies(tx, actor, page.rows) };
    });
    return c.json(
      {
        items,
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

export const staffTabCountsRoute = createRoute({
  method: 'get',
  path: '/staff/tab-counts',
  tags: ['staff'],
  summary: 'Счётчики вкладок модуля «Сотрудники»',
  middleware: [requirePermission('staffView')] as const,
  responses: {
    200: {
      description: 'Активных сотрудников и ролей (ролей — только с правом «Сотрудники и роли»)',
      content: { 'application/json': { schema: StaffTabCounts } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Просматривать сотрудников»', content: error },
  },
});

/**
 * Числа на вкладках модуля (прототип staffTabs): у «Сотрудников» — активных сотрудников, у «Ролей» —
 * ролей. Без права «Сотрудники и роли» вкладки «Роли» нет, и её число не отдаётся.
 */
export function staffTabCountsHandler(
  deps: ApiDeps,
): RouteHandler<typeof staffTabCountsRoute, AppEnv> {
  return async (c) => {
    const counts = await withOrgContext(deps.db, orgContextOf(c), (tx) => staffTabCounts(tx));
    const roles = hasPermission(c.get('access')!.subject, 'staff') ? counts.roles : null;
    return c.json({ list: counts.active, roles }, 200);
  };
}

export const employeeValuesRoute = createRoute({
  method: 'get',
  path: '/staff/values',
  tags: ['staff'],
  summary: 'Значения столбца списка сотрудников для фильтра',
  middleware: [requirePermission('staffView')] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом записей во всём списке',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Просматривать сотрудников»', content: error },
  },
});

/**
 * Значения для фильтра-галочек столбца (прототип filterPop): роли, статусы, «Создал»…; `q` —
 * «Найти значение» по всем значениям.
 */
export function employeeValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof employeeValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      listEmployeeValues(tx, col, t, q),
    );
    return c.json(values, 200);
  };
}

export const exportEmployeesRoute = createRoute({
  method: 'get',
  path: '/staff/export',
  tags: ['staff'],
  summary: 'Сотрудники в Excel',
  middleware: [requirePermission('staffView'), requirePermission('export')] as const,
  request: { query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со всеми записями под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Нет права «Просматривать сотрудников» или «Выгружать в Excel»',
      content: error,
    },
  },
});

/**
 * Выгрузка списка сотрудников в Excel (ТЗ «Экспорт в Excel всех отфильтрованных записей; файл
 * формируется на сервере»): все записи под поиском и фильтрами, видимые столбцы по порядку экрана.
 */
// Файл с сервера — как в ТЗ (docs/deviations.md, п. 32, решение А; прототип поправят).
export function exportEmployeesHandler(
  deps: ApiDeps,
): RouteHandler<typeof exportEmployeesRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const t = await serverTexts(deps);
    const result = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      exportEmployees(tx, query, keys, t),
    );
    return xlsxResponse(c, {
      title: t('nav.staff'),
      today: deps.clock.now(),
      columns: result.columns,
      rows: result.rows,
      more: result.more,
      t,
    });
  };
}

export const getEmployeeRoute = createRoute({
  method: 'get',
  path: '/staff/{id}',
  tags: ['staff'],
  summary: 'Карточка сотрудника',
  middleware: [requirePermission('staffView')] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: { description: 'Сотрудник', content: { 'application/json': { schema: Employee } } },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Просматривать сотрудников»', content: error },
    404: { description: 'Сотрудника нет', content: error },
  },
});

/** Карточка сотрудника (прототип modules/staff.js, empCard, вкладка «Основное»). */
export function getEmployeeHandler(deps: ApiDeps): RouteHandler<typeof getEmployeeRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const actor = staffActor(c);
    const employee = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const found = await getEmployee(tx, id);
      return found && employeeOut(tx, actor, found);
    });
    if (!employee) throw new RecordNotFoundError('employee', id);
    return c.json(employee, 200);
  };
}
