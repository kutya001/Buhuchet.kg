import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  contractorTaxRequisiteText,
  contractorTelegramRecipients,
  getContractor,
  logPayTextCopy,
  messageTemplates,
  orgMenuSettings,
  recentManualPaySends,
  reportMonthPlanRows,
  withOrgContext,
  type ContractorRecord,
  type Tx,
} from '@buhuchet/db';
import {
  CP_TG_PAY_SENDS_PER_HOUR,
  hasPermission,
  MONTH_PAY_MESSAGES,
  MONTH_PAY_SEND_MESSAGES,
  monthPaySendRefusal,
  monthPayText,
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
  ContractorMonthPaySent,
  FeeContractorParam,
  ReportMonthQuery,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { scopeSqlOf, subjectOf, todayOf, translateOf } from '../contractors/common';
import { deliverClientMessages, logMonthPaySent, prepareMonthPay } from '../telegram/client/pay';
import { error, ownReportsEmployeeOf, reportScopeOf } from './common';
import { monthPayRows } from './month-pay-rows';

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
/** Расчёт месяца: ответ блока и данные для «Отправить в Telegram». */
interface MonthPayResult {
  body: ContractorMonthPay;
  contractor: ContractorRecord;
  taxpay: boolean;
}

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
): Promise<MonthPayResult | null> {
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
  const { pay, rows } = monthPayRows(reports, o.month, taxpay);
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
  // «Отправить в Telegram» (прототип rmPaySendWhy): кнопка есть, пока включены «Напоминания в
  // Telegram» и «Страница контрагента по ссылке»; неполный итог клиенту не уходит.
  const sendOn = features.telegram && features.cppage;
  const recipients = sendOn ? (await contractorTelegramRecipients(tx, cp.id)).length : 0;
  const send = sendOn
    ? {
        refusal:
          monthPaySendRefusal({
            canManagePage: hasPermission(o.subject, 'cpPage'),
            archived: cp.serviceStatus === 'archived',
            recipients,
          }) ?? (partial ? ('month_pay_partial' as const) : null),
        recipients,
      }
    : null;
  return {
    body: {
      month: o.month,
      rows,
      total: pay.total,
      noAmount: pay.noAmount,
      due: pay.due,
      requisite,
      text,
      refusal,
      send,
    },
    contractor: cp,
    taxpay,
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
    const result = await withOrgContext(deps.db, ctx, (tx) =>
      monthPayOf(tx, { orgId: ctx.orgId, subject, contractorId: id, month, today, t }),
    );
    if (!result) return contractorNotFound();
    return c.json(result.body, 200);
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
      const result = await monthPayOf(tx, {
        orgId: ctx.orgId,
        subject,
        contractorId: id,
        month,
        today,
        t,
      });
      if (!result) return null;
      const pay = result.body;
      if (!pay.rows.length) apiFail(409, 'month_pay_empty', MONTH_PAY_MESSAGES.month_pay_empty);
      if (pay.refusal) apiFail(409, pay.refusal, MONTH_PAY_MESSAGES[pay.refusal]);
      await logPayTextCopy(tx, id, month, pay.total);
      return pay;
    });
    if (!body) return contractorNotFound();
    return c.json(body, 200);
  };
}

export const contractorMonthPaySendRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/month-pay/send',
  tags: ['reports'],
  summary: '«Отправить в Telegram»: сообщение «К оплате» подключённым Telegram контрагента',
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
      description: 'Сообщение отправлено: сколько получателей и скольким ушло',
      content: { 'application/json': { schema: ContractorMonthPaySent } },
    },
    400: { description: 'Месяц не в виде ГГГГ-ММ', content: error },
    401: unauthorized,
    403: {
      description:
        'Нет права «Просматривать отчёты», «Просматривать контрагентов» или «Управлять страницей контрагента»',
      content: error,
    },
    404: notFound,
    409: {
      description:
        'Отправка в Telegram выключена; контрагент в архиве; Telegram не подключён; за месяц платить нечего; часть отчётов месяца — вне области сотрудника; сообщение не ушло',
      content: error,
    },
    429: { description: 'Слишком много сообщений этому контрагенту за час', content: error },
  },
});

/**
 * «Отправить в Telegram» (прототип `pgPaySend`): сообщение «К оплате» за месяц — всем подключённым
 * Telegram контрагента. Право «Управлять страницей контрагента», контрагент — в области «Свои / Все»,
 * не в архиве; сумму сервер считает сам — из запроса берётся только месяц; неполный итог (часть
 * отчётов вне области сотрудника) клиенту не уходит. Реквизит для налогов получает только клиент — в
 * ответе метода его нет. История контрагента — после отправки: месяц, итог и число получателей.
 */
export function contractorMonthPaySendHandler(
  deps: ApiDeps,
): RouteHandler<typeof contractorMonthPaySendRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { month } = c.req.valid('json');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const t = await translateOf(deps);
    const ctx = orgContextOf(c);
    const prepared = await withOrgContext(deps.db, ctx, async (tx) => {
      const result = await monthPayOf(tx, {
        orgId: ctx.orgId,
        subject,
        contractorId: id,
        month,
        today,
        t,
      });
      if (!result) return null;
      const pay = result.body;
      if (!pay.send) apiFail(409, 'month_pay_send_off', MONTH_PAY_SEND_MESSAGES.month_pay_send_off);
      if (pay.send.refusal === 'month_pay_send_right') {
        apiFail(403, pay.send.refusal, MONTH_PAY_SEND_MESSAGES[pay.send.refusal]);
      }
      if (pay.send.refusal === 'month_pay_partial') {
        apiFail(409, pay.send.refusal, MONTH_PAY_MESSAGES.month_pay_partial);
      }
      if (pay.send.refusal) {
        apiFail(409, pay.send.refusal, MONTH_PAY_SEND_MESSAGES[pay.send.refusal]);
      }
      if (!pay.rows.length || !pay.due) {
        apiFail(409, 'month_pay_empty', MONTH_PAY_MESSAGES.month_pay_empty);
      }
      const recipients = await contractorTelegramRecipients(tx, id);
      // Клиента не завалить: не больше стольких отправок в час одному контрагенту.
      const recent = await recentManualPaySends(tx, id);
      if (recent >= CP_TG_PAY_SENDS_PER_HOUR) {
        apiFail(429, 'month_pay_send_limit', MONTH_PAY_SEND_MESSAGES.month_pay_send_limit);
      }
      const messages = await prepareMonthPay(tx, t, {
        contractor: result.contractor,
        pay: { month, lines: pay.rows, total: pay.total, due: pay.due },
        taxpay: result.taxpay,
        recipients,
        auto: false,
      });
      return { messages, total: pay.total };
    });
    if (!prepared) return contractorNotFound();
    const org = { orgId: ctx.orgId, userId: ctx.userId ?? null };
    const delivered = await deliverClientMessages(deps, org, prepared.messages);
    if (delivered === 0) {
      apiFail(409, 'month_pay_send_failed', MONTH_PAY_SEND_MESSAGES.month_pay_send_failed);
    }
    await logMonthPaySent(deps, org, id, {
      month,
      total: prepared.total,
      recipients: delivered,
      auto: false,
    });
    return c.json({ recipients: prepared.messages.length, delivered }, 200);
  };
}
