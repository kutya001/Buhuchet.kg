import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  addTariff,
  contractorFeeView,
  createFeePayment,
  feePaymentFormOf,
  feeSubject,
  feeToOptions,
  logFeeReminder,
  mainFeeRequisite,
  messageTemplates,
  phoneCodes,
} from '@buhuchet/db';
import {
  canAcceptFeePayment,
  contractorFees,
  FEE_WHATSAPP_TEMPLATE,
  feeReminder,
  feeWhatsAppText,
  formatPhone,
  hasPermission,
  tariffDefaults,
} from '@buhuchet/domain';
import {
  ContractorFees,
  FeeContractorParam,
  FeePaymentForm,
  FeePaymentRequest,
  FeePaymentSaved,
  FeeReminder,
  OkResponse,
  TariffRequest,
  TariffSaved,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { requirePermission } from '../../middleware/access';
import { scopeSqlOf, subjectOf, todayOf, translateOf } from '../contractors/common';
import { error } from '../reports/common';
import { feeFail, inFee } from './common';

/*
 * Плата за обслуживание (задача 2.21; ТЗ «Контрагенты» → «Плата за обслуживание»; прототип
 * modules/contractor-card.js — вкладка «Обслуживание», `tariffDlg`, `feePayDlg`, `feeAccOk`;
 * ui/status-scale.js — `waDlg` с `fee`). Всё — при включённой «Плате за обслуживание» и праве «Видеть
 * плату за обслуживание»; контрагент — в области группы «Контрагенты»; ставки и приём оплаты — ещё и
 * право «Менять журнал тарифов». Правила — домен, запись — слой данных (`@buhuchet/db` fees).
 */

const json = <S>(schema: S) => ({ 'application/json': { schema } });
const body = <S>(schema: S) => ({ required: true, content: json(schema) });

/** Оплат на вкладке — последние 24 (прототип: `fps.slice(0,24)`). */
const PAYMENTS_SHOWN = 24;

const off = '«Плата за обслуживание» выключена или нет права «Видеть плату за обслуживание»';
const notFound = { description: 'Нет такого контрагента или он вне области', content: error };
const unauthorized = { description: 'Нет входа', content: error };

function contractorNotFound(): never {
  apiFail(404, 'contractor_not_found', 'Контрагент не найден');
}

export const contractorFeesRoute = createRoute({
  method: 'get',
  path: '/contractors/{id}/fees',
  tags: ['fees'],
  summary: 'Вкладка «Обслуживание»: начисления, оплаты, долг, журнал тарифов',
  middleware: [requirePermission('fee')] as const,
  request: { params: FeeContractorParam },
  responses: {
    200: {
      description:
        'Начисления по месяцам, долг и аванс, оплаты, журнал тарифов и что можно сделать',
      content: json(ContractorFees),
    },
    401: unauthorized,
    403: { description: off, content: error },
    404: notFound,
  },
});

/**
 * Вкладка «Обслуживание» (прототип contractor-card.js, `st.tab==='fee'`): плашки «Текущая ставка» и
 * «Долг за обслуживание», «Начисления и оплаты», «Оплаты» (последние 24) и «Журнал тарифов».
 */
export function contractorFeesHandler(
  deps: ApiDeps,
): RouteHandler<typeof contractorFeesRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const t = await translateOf(deps);
    const view = await inFee(deps, c, (tx) =>
      contractorFeeView(tx, id, { today, scope: scopeSqlOf(subject) }),
    );
    if (!view) contractorNotFound();
    const { subject: cp, fees } = view;
    const tariffRight = hasPermission(subject, 'tariff');
    // «Новая ставка» — по праву и у архивного, как в прототипе (`tariffDlg`); у разового платы нет.
    const canTariff = tariffRight && !cp.oneOff;
    const payments = [...view.payments].sort((a, b) =>
      a.date === b.date ? b.createdAt.getTime() - a.createdAt.getTime() : a.date < b.date ? 1 : -1,
    );
    const defaults = canTariff ? tariffDefaults(cp.tariffs, today, t) : null;
    const out: ContractorFees = {
      contractor: {
        id: cp.id,
        name: cp.name,
        archived: cp.archived,
        oneOff: cp.oneOff,
        feeDay: cp.feeDay,
        startDate: cp.start,
        version: cp.version,
      },
      current: view.current,
      months: fees.months,
      debt: fees.debt,
      advance: fees.advance,
      payments: payments.slice(0, PAYMENTS_SHOWN).map((p) => ({
        id: p.id,
        date: p.date,
        amount: p.amount,
        allocation: p.allocation.map((x) => ({ month: x.month, amount: x.amount })),
        fromReceipt: p.operationId !== null,
        edited: p.edited,
        author: p.author,
      })),
      paymentsTotal: payments.length,
      tariffs: [...view.tariffs].reverse().map((x) => ({
        id: x.id,
        amount: x.amount,
        period: x.period,
        from: x.from,
        note: x.note,
        author: x.author,
        at: x.at,
      })),
      canAccept: view.canAccept && tariffRight,
      canTariff,
      canRemind: fees.debt > 0,
      tariffForm: defaults && { ...defaults, hasTariff: cp.tariffs.length > 0 },
    };
    return c.json(out, 200);
  };
}

export const addTariffRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/tariffs',
  tags: ['fees'],
  summary: '«Новая ставка обслуживания»: запись в журнал тарифов',
  middleware: [requirePermission('fee'), requirePermission('tariff')] as const,
  request: { params: FeeContractorParam, body: body(TariffRequest) },
  responses: {
    201: { description: 'Ставка добавлена в журнал', content: json(TariffSaved) },
    400: {
      description: 'Нет суммы или месяца; месяц прошлый, текущий при уже заданной ставке или занят',
      content: error,
    },
    401: unauthorized,
    403: { description: `${off}; нет права «Менять журнал тарифов»`, content: error },
    404: notFound,
    409: { description: 'Контрагент разовый или в архиве', content: error },
  },
});

/**
 * «Добавить в журнал» (прототип `tariffDlg`): запись журнала не меняется и не удаляется; прошлые
 * начисления не пересчитываются.
 */
export function addTariffHandler(deps: ApiDeps): RouteHandler<typeof addTariffRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const subject = subjectOf(c);
    const saved = await inFee(deps, c, (tx) =>
      addTariff(
        tx,
        id,
        { amount: input.amount, period: input.period, from: input.from, note: input.note ?? '' },
        { today: todayOf(deps), scope: scopeSqlOf(subject) },
      ),
    );
    return c.json(saved, 201);
  };
}

export const feePaymentFormRoute = createRoute({
  method: 'get',
  path: '/contractors/{id}/fee-payment-form',
  tags: ['fees'],
  summary: 'Окно «Принять оплату за обслуживание»',
  middleware: [requirePermission('fee'), requirePermission('tariff')] as const,
  request: { params: FeeContractorParam },
  responses: {
    200: {
      description: 'Неоплаченные месяцы, сумма и распределение по умолчанию, куда поступили деньги',
      content: json(FeePaymentForm),
    },
    401: unauthorized,
    403: { description: `${off}; нет права «Менять журнал тарифов»`, content: error },
    404: notFound,
    409: { description: 'У контрагента нет начислений (разовый) или он в архиве', content: error },
  },
});

/** Окно «Принять оплату за обслуживание» (прототип `feePayDlg`): сумма по умолчанию — долг. */
export function feePaymentFormHandler(
  deps: ApiDeps,
): RouteHandler<typeof feePaymentFormRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const out = await inFee(deps, c, async (tx) => {
      const found = await feePaymentFormOf(tx, id, {
        today: todayOf(deps),
        scope: scopeSqlOf(subject),
      });
      if (!found) return null;
      if (!canAcceptFeePayment(found.subject, found.subject.archived, found.fees))
        feeFail(409, 'fee_not_accepted');
      return { ...found, to: await feeToOptions(tx, t) };
    });
    if (!out) contractorNotFound();
    const { subject: cp, fees, form, to } = out;
    const body: FeePaymentForm = {
      contractor: { id: cp.id, name: cp.name },
      debt: fees.debt,
      advance: fees.advance,
      unpaid: form.unpaid,
      amount: form.amount,
      months: form.months.map((m) => ({
        month: m.month,
        charge: m.charge,
        got: m.got,
        left: m.left,
        overdue: m.overdue,
      })),
      order: form.order,
      allocation: form.allocation.map((x) => ({ month: x.month, amount: x.amount })),
      to,
    };
    return c.json(body, 200);
  };
}

export const createFeePaymentRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/fee-payments',
  tags: ['fees'],
  summary: '«Принять оплату» за обслуживание',
  middleware: [requirePermission('fee'), requirePermission('tariff')] as const,
  request: { params: FeeContractorParam, body: body(FeePaymentRequest) },
  responses: {
    201: {
      description:
        'Оплата принята: начисления получили «Оплачено» или «Оплачено частично»; к оплате загружаются файлы',
      content: json(FeePaymentSaved),
    },
    400: {
      description:
        'Неверные данные: сумма, дата позже сегодня, месяц не из неоплаченных, строка больше долга, распределено больше суммы, куда поступили деньги',
      content: error,
    },
    401: unauthorized,
    403: {
      description: `${off}; нет права «Менять журнал тарифов»; файлы к оплате загружать нельзя`,
      content: error,
    },
    404: notFound,
    409: { description: 'У контрагента нет начислений (разовый) или он в архиве', content: error },
  },
});

/**
 * «Принять оплату» (прототип `feePayDlg`): сумма распределяется по неоплаченным месяцам, излишек —
 * аванс; деньги — только организации. Файлы окно загружает к оплате после ответа.
 */
export function createFeePaymentHandler(
  deps: ApiDeps,
): RouteHandler<typeof createFeePaymentRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const saved = await inFee(deps, c, (tx, settings) => {
      // Файлы к оплате окно загрузит после сохранения — значит, загружать их должно быть можно.
      if (
        (input.files ?? 0) > 0 &&
        !(settings.features.files && hasPermission(subject, 'filesUpload'))
      )
        apiFail(403, 'forbidden', 'Нет права на это действие');
      return createFeePayment(
        tx,
        id,
        {
          amount: input.amount,
          date: input.date,
          to: input.to,
          allocation: input.allocation ?? [],
          note: input.note ?? '',
        },
        { today: todayOf(deps), scope: scopeSqlOf(subject), t },
      );
    });
    return c.json(saved, 201);
  };
}

export const feeReminderRoute = createRoute({
  method: 'get',
  path: '/contractors/{id}/fee-reminder',
  tags: ['fees'],
  summary: 'Окно «Напомнить в WhatsApp» о долге за обслуживание',
  middleware: [requirePermission('fee')] as const,
  request: { params: FeeContractorParam },
  responses: {
    200: {
      description: 'Номер, текст по шаблону и основной счёт организации для обслуживания',
      content: json(FeeReminder),
    },
    401: unauthorized,
    403: { description: off, content: error },
    404: notFound,
    409: { description: 'Долга за обслуживание нет', content: error },
  },
});

/**
 * Сообщение о долге (прототип `waDlg({cp, fee:true})`): шаблон waFee справочника платформы, месяцы
 * долга, сумма, «оплатить до» и основной счёт для обслуживания.
 */
export function feeReminderHandler(deps: ApiDeps): RouteHandler<typeof feeReminderRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const t = await translateOf(deps);
    const out = await inFee(deps, c, async (tx) => {
      const found = await feeSubject(tx, id, scopeSqlOf(subject));
      if (!found) return null;
      const fees = contractorFees(found.subject, found.payments, today);
      if (fees.debt <= 0) feeFail(409, 'fee_no_debt');
      const [templates, requisite, codes] = await Promise.all([
        messageTemplates(tx),
        mainFeeRequisite(tx, t),
        phoneCodes(tx),
      ]);
      return { cp: found.subject, fees, template: templates.waFee, requisite, codes };
    });
    if (!out) contractorNotFound();
    const { cp, fees, requisite } = out;
    const r = feeReminder(fees, cp.feeDay, today);
    const body: FeeReminder = {
      contractor: { id: cp.id, name: cp.name },
      phone: cp.phone || null,
      phoneText: cp.phone ? formatPhone(cp.phone, out.codes) : '',
      text: feeWhatsAppText(
        out.template ?? FEE_WHATSAPP_TEMPLATE,
        {
          contractor: cp.name,
          months: r.months,
          amount: r.amount,
          payBy: r.payBy,
          requisite: requisite?.text ?? null,
        },
        (req) => t('fee.wa.requisites', { req }),
      ),
      requisite: requisite && {
        bank: requisite.bank,
        number: requisite.number,
        phone: requisite.phone,
        holder: requisite.holder,
      },
    };
    return c.json(body, 200);
  };
}

export const feeReminderSentRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/fee-reminder',
  tags: ['fees'],
  summary: '«Открыть WhatsApp» с напоминанием о долге: запись в историю',
  middleware: [requirePermission('fee')] as const,
  request: { params: FeeContractorParam },
  responses: {
    200: { description: 'Записано в историю контрагента', content: json(OkResponse) },
    401: unauthorized,
    403: { description: off, content: error },
    404: notFound,
    409: {
      description: 'Долга за обслуживание нет или у контрагента нет телефона',
      content: error,
    },
  },
});

/** Нажатие «Открыть WhatsApp» (прототип: «Напоминание в WhatsApp о долге за обслуживание»). */
export function feeReminderSentHandler(
  deps: ApiDeps,
): RouteHandler<typeof feeReminderSentRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const found = await inFee(deps, c, async (tx) => {
      const found = await feeSubject(tx, id, scopeSqlOf(subject));
      if (!found) return false;
      const fees = contractorFees(found.subject, found.payments, today);
      if (fees.debt <= 0) feeFail(409, 'fee_no_debt');
      if (!found.subject.phone) feeFail(409, 'fee_no_phone');
      await logFeeReminder(tx, id);
      return true;
    });
    if (!found) contractorNotFound();
    return c.json({ ok: true as const }, 200);
  };
}
