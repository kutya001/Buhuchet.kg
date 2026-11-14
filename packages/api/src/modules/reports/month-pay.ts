import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  contractorTaxRequisiteText,
  getContractor,
  logPayTextCopy,
  messageTemplates,
  orgMenuSettings,
  reportMonthPlanRows,
  withOrgContext,
  type Tx,
} from '@buhuchet/db';
import {
  hasPermission,
  MONTH_PAY_MESSAGES,
  monthPayText,
  monthPlanGroup,
  monthPlanItem,
  monthToPay,
  PAY_MONTH_TEMPLATE,
  type AccessSubject,
  type IsoDate,
  type MonthPayRefusal,
  type Translate,
  type YearMonth,
} from '@buhuchet/domain';
import {
  ContractorMonthPay,
  ContractorMonthPayCopied,
  FeeContractorParam,
  ReportMonthQuery,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { scopeSqlOf, subjectOf, todayOf, translateOf } from '../contractors/common';
import { error, ownReportsEmployeeOf, reportScopeOf } from './common';

/*
 * «К оплате клиенту» за месяц в карточке контрагента (доработки 13.11.2026, задача К4; прототип v94
 * modules/cp-telegram.js: `rmToPay`, `rmPayHtml`, `rmPayMount`, `rmPayText`; docs/deviations.md п. К-3):
 * блок под месяцем вкладки «Отчёты к сдаче» и текст «Скопировать для клиента». Права — «Просматривать
 * отчёты» и «Просматривать контрагентов»; контрагент — в области группы «Контрагенты», отчёты месяца —
 * в области списков отчётов: сумма складывается только из отчётов, которые сотрудник видит сам.
 * Текст клиенту — только полный: если реквизит ответственного сотруднику не виден или часть отчётов
 * месяца вне его области, текста нет и «Скопировать» отклоняется.
 */

/**
 * Реквизит ответственного видят только он сам и роли с правом «Деньги» по всем контрагентам — владелец
 * и главный бухгалтер (решение 27.10.2026, docs/deviations.md п. В-1; то же правило, что у «Напомнить
 * в WhatsApp» о налоге, п. В-25). Счёт организации видит каждый сотрудник.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-3
function requisiteHidden(
  cp: { paysTo: 'emp' | 'org'; responsible: { id: string } | null },
  subject: AccessSubject,
): boolean {
  if (cp.paysTo === 'org' || !cp.responsible) return false;
  if (cp.responsible.id === subject.employeeId) return false;
  return !(hasPermission(subject, 'money') && hasPermission(subject, 'viewAll'));
}

const unauthorized = { description: 'Нет входа', content: error };
const forbidden = {
  description: 'Нет права «Просматривать отчёты» или «Просматривать контрагентов»',
  content: error,
};
const notFound = {
  description: 'Контрагент не найден, в другой организации или вне области сотрудника',
  content: error,
};

/**
 * Расчёт месяца для одного контрагента: одно правило домена `monthToPay` поверх строк «по месяцам».
 * Реквизит для налогов — только при «Учёте оплаты налогов» (прототип `pgTaxAcc`); текст — по шаблону
 * waPayMonth справочника платформы; платить нечего — текста нет.
 */
async function monthPayOf(
  tx: Tx,
  o: {
    orgId: string;
    subject: AccessSubject;
    contractorId: string;
    month: YearMonth;
    today: IsoDate;
    t: Translate;
  },
): Promise<ContractorMonthPay | null> {
  const cp = await getContractor(tx, o.contractorId, {
    scope: scopeSqlOf(o.subject),
    today: o.today,
  });
  if (!cp) return null;
  const { features } = await orgMenuSettings(tx, o.orgId);
  const taxpay = features.taxpay;
  const monthRows = (scope: ReturnType<typeof reportScopeOf>) =>
    reportMonthPlanRows(tx, {
      scope,
      today: o.today,
      taxpay,
      month: o.month,
      contractorId: o.contractorId,
    });
  const reports = await monthRows(reportScopeOf(o.subject));
  // При равном сроке — по краткому названию вида, как строки таблицы месяца (docs/deviations.md п. К-1),
  // дальше — в порядке создания отчётов.
  const created = new Map(reports.map((r, i) => [r.id, i]));
  const pay = monthToPay(
    monthPlanGroup(
      o.month,
      reports.map((r) => monthPlanItem(r, { taxpay })),
    ),
    {
      taxpay,
      tie: (a, b) =>
        a.typeShort.localeCompare(b.typeShort, 'ru') || created.get(a.id)! - created.get(b.id)!,
    },
  );
  const rows = pay.rows.map((x) => ({
    reportId: x.report.id,
    name: x.report.typeShort,
    left: x.left,
    due: x.due,
  }));
  const hidden = taxpay && requisiteHidden(cp, o.subject);
  // Область отчётов «Свои», а контрагент чужой: сотрудник видит только отчёты, которые ведёт сам.
  // Есть ли у месяца другие отчёты — считаем без сумм, только число.
  const own = ownReportsEmployeeOf(o.subject);
  const partial =
    !!own && cp.responsible?.id !== own && (await monthRows(undefined)).length > reports.length;
  const refusal: MonthPayRefusal | null = !rows.length
    ? null
    : hidden
      ? 'month_pay_requisite_hidden'
      : partial
        ? 'month_pay_partial'
        : null;
  const requisite =
    taxpay && rows.length && !hidden
      ? await contractorTaxRequisiteText(
          tx,
          { paysTo: cp.paysTo, responsibleId: cp.responsible?.id ?? null },
          o.t,
        )
      : null;
  const text =
    pay.due && !refusal
      ? monthPayText((await messageTemplates(tx)).waPayMonth ?? PAY_MONTH_TEMPLATE, {
          contractor: cp.name,
          month: o.month,
          lines: rows,
          total: pay.total,
          due: pay.due,
          requisite,
        })
      : null;
  return {
    month: o.month,
    rows,
    total: pay.total,
    noAmount: pay.noAmount,
    due: pay.due,
    requisite,
    text,
    refusal,
  };
}

const contractorNotFound = (): never =>
  apiFail(404, 'contractor_not_found', 'Контрагент не найден');

export const contractorMonthPayRoute = createRoute({
  method: 'get',
  path: '/contractors/{id}/month-pay',
  tags: ['reports'],
  summary: 'Блок «К оплате клиенту» месяца в карточке контрагента',
  middleware: [requirePermission('repView'), requirePermission('cpView')] as const,
  request: { params: FeeContractorParam, query: ReportMonthQuery },
  responses: {
    200: {
      description:
        'Налоги месяца с остатком к оплате от ближайшего срока, итог, число отчётов без суммы, реквизит для налогов и текст для клиента (платить нечего, реквизит ответственного не виден или часть отчётов вне области — без текста)',
      content: { 'application/json': { schema: ContractorMonthPay } },
    },
    400: { description: 'Месяц не в виде ГГГГ-ММ', content: error },
    401: unauthorized,
    403: forbidden,
    404: notFound,
  },
});

export function contractorMonthPayHandler(
  deps: ApiDeps,
): RouteHandler<typeof contractorMonthPayRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { month } = c.req.valid('query');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const t = await translateOf(deps);
    const ctx = orgContextOf(c);
    const body = await withOrgContext(deps.db, ctx, (tx) =>
      monthPayOf(tx, { orgId: ctx.orgId, subject, contractorId: id, month, today, t }),
    );
    if (!body) return contractorNotFound();
    return c.json(body, 200);
  };
}

export const contractorMonthPayCopiedRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/month-pay/copied',
  tags: ['reports'],
  summary: '«Скопировать для клиента»: запись в историю контрагента',
  middleware: [requirePermission('repView'), requirePermission('cpView')] as const,
  request: {
    params: FeeContractorParam,
    body: {
      required: true,
      content: { 'application/json': { schema: ContractorMonthPayCopied } },
    },
  },
  responses: {
    200: {
      description: 'Записано в историю контрагента: месяц и сумма на момент копирования',
      content: { 'application/json': { schema: ContractorMonthPay } },
    },
    400: { description: 'Месяц не в виде ГГГГ-ММ', content: error },
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: {
      description:
        'За месяц платить нечего; реквизит ответственного сотруднику не виден; часть отчётов месяца — вне области сотрудника',
      content: error,
    },
  },
});

/**
 * Нажатие «Скопировать для клиента» (прототип `rmPayMount`: «Скопирован текст «К оплате» за октябрь
 * 2026: 5 000 сом»). Сумму считает сервер заново — из запроса берётся только месяц. Повтор того же
 * нажатия в течение пяти минут вторую запись не добавляет.
 */
export function contractorMonthPayCopiedHandler(
  deps: ApiDeps,
): RouteHandler<typeof contractorMonthPayCopiedRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { month } = c.req.valid('json');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const t = await translateOf(deps);
    const ctx = orgContextOf(c);
    const body = await withOrgContext(deps.db, ctx, async (tx) => {
      const pay = await monthPayOf(tx, {
        orgId: ctx.orgId,
        subject,
        contractorId: id,
        month,
        today,
        t,
      });
      if (!pay) return null;
      if (!pay.rows.length) apiFail(409, 'month_pay_empty', MONTH_PAY_MESSAGES.month_pay_empty);
      if (pay.refusal) apiFail(409, pay.refusal, MONTH_PAY_MESSAGES[pay.refusal]);
      await logPayTextCopy(tx, id, month, pay.total);
      return pay;
    });
    if (!body) return contractorNotFound();
    return c.json(body, 200);
  };
}
