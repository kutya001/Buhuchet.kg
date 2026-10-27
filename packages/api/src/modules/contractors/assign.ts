import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  assignContractors,
  employeeActive,
  transferContractors,
  transferPreview,
  withOrgContext,
} from '@buhuchet/db';
import { RecordNotFoundError } from '@buhuchet/domain';
import {
  AssignContractorsRequest,
  AssignContractorsResult,
  TransferContractorsPreview,
  TransferContractorsQuery,
  TransferContractorsRequest,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf, requireAnyPermission, requirePermission } from '../../middleware/access';
import { notFound } from './card';
import { checkResponsible, error, scopeSqlOf, subjectOf } from './common';

export const assignContractorsRoute = createRoute({
  method: 'post',
  path: '/contractors/assign',
  tags: ['contractors'],
  summary: 'Назначить ответственного одному или нескольким контрагентам',
  middleware: [requirePermission('cpView'), requireAnyPermission('assign', 'createCp')] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: AssignContractorsRequest } } },
  },
  responses: {
    200: {
      description: 'Ответственный назначен; у каждого контрагента — запись истории',
      content: { 'application/json': { schema: AssignContractorsResult } },
    },
    400: { description: 'Нет такого сотрудника или он заблокирован', content: error },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Нет права «Назначать отчёты контрагентам» или «Создавать и изменять контрагентов»',
      content: error,
    },
    404: {
      description: 'Кого-то из контрагентов нет или он вне области сотрудника',
      content: error,
    },
    409: { description: 'Среди контрагентов есть архивные', content: error },
  },
});

/**
 * «Сменить ответственного» в карточке и «Назначить ответственного» выбранным в списке (ТЗ
 * «Массовое закрепление»; прототип respDlg): все или никто — контрагент вне области или в архиве
 * отменяет назначение целиком.
 */
export function assignContractorsHandler(
  deps: ApiDeps,
): RouteHandler<typeof assignContractorsRoute, AppEnv> {
  return async (c) => {
    const { ids, responsibleEmployeeId } = c.req.valid('json');
    const subject = subjectOf(c);
    const changed = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      await checkResponsible(tx, responsibleEmployeeId);
      try {
        const result = await assignContractors(tx, ids, responsibleEmployeeId, scopeSqlOf(subject));
        if (result.archived.length) {
          apiFail(
            409,
            'contractor_archived',
            'Контрагент в архиве — сначала верните его из архива',
            {
              ids: result.archived,
            },
          );
        }
        return result.changed;
      } catch (err) {
        if (err instanceof RecordNotFoundError) notFound();
        throw err;
      }
    });
    return c.json({ changed }, 200);
  };
}

export const transferPreviewRoute = createRoute({
  method: 'get',
  path: '/contractors/transfer',
  tags: ['contractors'],
  summary: 'Что перейдёт при передаче дел сотрудника',
  middleware: [requirePermission('staff')] as const,
  request: { query: TransferContractorsQuery },
  responses: {
    200: {
      description: 'Число контрагентов сотрудника на обслуживании и «Кому» по умолчанию',
      content: { 'application/json': { schema: TransferContractorsPreview } },
    },
    400: { description: 'Неверные данные запроса', content: error },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Сотрудники и роли»', content: error },
    404: { description: 'Нет такого сотрудника', content: error },
  },
});

/**
 * Окно «Передать контрагентов» (прототип transferDlg): сколько контрагентов перейдёт и «Кому» по
 * умолчанию — главный бухгалтер. Незавершённые отчёты, открытые задачи и деньги добавят их задачи.
 */
export function transferPreviewHandler(
  deps: ApiDeps,
): RouteHandler<typeof transferPreviewRoute, AppEnv> {
  return async (c) => {
    const { from } = c.req.valid('query');
    const preview = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      if ((await employeeActive(tx, from)) === null) {
        apiFail(404, 'employee_not_found', 'Сотрудник не найден');
      }
      return transferPreview(tx, from);
    });
    return c.json(preview, 200);
  };
}

export const transferContractorsRoute = createRoute({
  method: 'post',
  path: '/contractors/transfer',
  tags: ['contractors'],
  summary: 'Передача дел: все контрагенты сотрудника — другому',
  middleware: [requirePermission('staff')] as const,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: TransferContractorsRequest } },
    },
  },
  responses: {
    200: {
      description: 'Контрагенты переданы; у каждого — запись истории',
      content: { 'application/json': { schema: AssignContractorsResult } },
    },
    400: {
      description: 'Кому — тот же сотрудник, нет такого сотрудника или он заблокирован',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Сотрудники и роли»', content: error },
    404: { description: 'Нет такого сотрудника', content: error },
  },
});

/**
 * «Передать контрагентов» (ТЗ «Передача дел»: при увольнении, отпуске; право «Сотрудники и роли» —
 * «передавать контрагентов»): все контрагенты сотрудника на обслуживании, в том числе
 * заблокированного, переходят к другому активному сотруднику.
 */
export function transferContractorsHandler(
  deps: ApiDeps,
): RouteHandler<typeof transferContractorsRoute, AppEnv> {
  return async (c) => {
    const { from, to } = c.req.valid('json');
    if (from === to) {
      apiFail(400, 'transfer_same', 'Выберите другого сотрудника', { field: 'to' });
    }
    const changed = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      if ((await employeeActive(tx, from)) === null) {
        apiFail(404, 'employee_not_found', 'Сотрудник не найден');
      }
      await checkResponsible(tx, to);
      return transferContractors(tx, from, to);
    });
    return c.json({ changed }, 200);
  };
}
