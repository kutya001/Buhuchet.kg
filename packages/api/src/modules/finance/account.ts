import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { employeeAccountOf, getEmployee } from '@buhuchet/db';
import { AccountEmployeeParam, EmployeeAccount } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { requirePermission } from '../../middleware/access';
import { subjectOf } from '../contractors/common';
import { finScopeOf, inTaxpay, moneyFail } from '../money/common';
import { error } from '../reports/common';

/*
 * Вкладка «Счёт» карточки сотрудника (задача 2.20; ТЗ «Сотрудники» → «Счёт»; прототип modules/staff.js,
 * вкладка `acc`): при «Учёте оплаты налогов» и «Виртуальных счетах», с правом «Управлять сотрудниками».
 */

const json = <S>(schema: S) => ({ 'application/json': { schema } });

export const employeeAccountRoute = createRoute({
  method: 'get',
  path: '/staff/{id}/account',
  tags: ['finance'],
  summary: 'Вкладка «Счёт» карточки сотрудника',
  middleware: [requirePermission('staff')] as const,
  request: { params: AccountEmployeeParam },
  responses: {
    200: {
      description: 'Баланс, поступления, оплаты налогов, бонусы и строки по контрагентам',
      content: json(EmployeeAccount),
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Нет права «Управлять сотрудниками»; «Учёт оплаты налогов» или «Виртуальные счета» выключены',
      content: error,
    },
    404: { description: 'Сотрудника нет', content: error },
  },
});

/**
 * Деньги на счёте сотрудника (прототип: `OPS.filter(o => o.holder === e.id)`): суммы — только по
 * контрагентам в области группы «Финансовые операции» (docs/deviations.md п. В-22).
 */
export function employeeAccountHandler(
  deps: ApiDeps,
): RouteHandler<typeof employeeAccountRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const out = await inTaxpay(deps, c, async (tx, settings) => {
      if (!settings.features.accounts) moneyFail(403, 'accounts_off');
      if (!(await getEmployee(tx, id))) return null;
      return employeeAccountOf(tx, id, finScopeOf(subject));
    });
    if (!out) apiFail(404, 'not_found', 'Сотрудник не найден');
    const names = new Map(out.contractors.map((x) => [x.id, x.name]));
    const { account } = out;
    const body: EmployeeAccount = {
      balance: account.balance,
      received: account.received,
      paid: account.paid,
      bonus: account.bonus,
      rows: account.rows.map((x) => ({
        contractorId: x.contractorId,
        name: names.get(x.contractorId) ?? '',
        received: x.received,
        paid: x.paid,
        bonus: x.bonus,
        rest: x.rest,
      })),
    };
    c.header('Cache-Control', 'no-store');
    return c.json(body, 200);
  };
}
