import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  logTaxReminder,
  messageTemplates,
  phoneCodes,
  reportScope,
  taxReminderSource,
  type TaxReminderSource,
} from '@buhuchet/db';
import {
  formatDateRu,
  formatPhone,
  hasPermission,
  periodFull,
  scopeOf,
  TAX_WHATSAPP_TEMPLATE,
  taxWhatsAppBase,
  type AccessSubject,
  type Translate,
} from '@buhuchet/domain';
import { OkResponse, ReportIdParam, TaxReminder } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { subjectOf, todayOf, translateOf } from '../contractors/common';
import { inTaxpay, moneyFail } from '../money/common';
import { error } from '../reports/common';

/*
 * «Напомнить в WhatsApp» о налоге по отчёту (задача 2.20; ТЗ «Напоминания контрагенту в WhatsApp»;
 * прототип modules/reports.js — пункт меню отчёта, ui/status-scale.js `waDlg({r})`): при «Учёте оплаты
 * налогов», у отчёта, который ждёт оплаты; отчёт — в области «Отчётов для сдачи». Как в прототипе, без
 * отдельного права: пункт видит каждый, кто видит отчёт.
 */

const json = <S>(schema: S) => ({ 'application/json': { schema } });

const reportScopeOf = (subject: AccessSubject) =>
  reportScope(scopeOf(subject, 'reports') === 'own' ? subject.employeeId : null);

/** Ответственный по контрагенту — сам пользователь (сотрудник без входа — никто). */
const isHolder = (src: TaxReminderSource, userId: string | null | undefined) =>
  !!userId && src.holder?.userId === userId;

/**
 * Реквизиты ответственного видят только он сам и роли с правом «Деньги» по всем контрагентам —
 * владелец и главный бухгалтер (решение 27.10.2026, docs/deviations.md п. В-1); остальным окно их не
 * показывает и сообщение не отправляется (п. В-25). Счета организации видит каждый сотрудник.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#В-25
function walletsHidden(
  src: TaxReminderSource,
  subject: AccessSubject,
  userId: string | null | undefined,
): boolean {
  if (src.contractor.paysTo === 'org' || !src.holder) return false;
  if (isHolder(src, userId)) return false;
  return !(hasPermission(subject, 'money') && hasPermission(subject, 'viewAll'));
}

const unauthorized = { description: 'Нет входа', content: error };
const forbidden = {
  description: 'Нет права «Просматривать отчёты» или «Учёт оплаты налогов» выключен',
  content: error,
};
const notFound = { description: 'Нет такого отчёта или он вне области', content: error };

/** Отчёт ждёт оплаты налога (прототип: сумма есть, оплачено меньше, не «Не требуется»). */
const waitsPayment = (r: TaxReminderSource['report']) =>
  r.act !== 'sub' &&
  (r.amount ?? 0) > 0 &&
  r.paid < (r.amount ?? 0) &&
  r.status !== 'not_required' &&
  !r.superseded;

export const taxReminderRoute = createRoute({
  method: 'get',
  path: '/reports/{id}/tax-reminder',
  tags: ['finance'],
  summary: 'Окно «Напомнить в WhatsApp» о налоге по отчёту',
  middleware: [requirePermission('repView')] as const,
  request: { params: ReportIdParam },
  responses: {
    200: {
      description: 'Номер, текст по шаблону без реквизитов и реквизиты для отметок',
      content: json(TaxReminder),
    },
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: { description: 'Отчёт не ждёт оплаты налога', content: error },
  },
});

/** Месяц внутри фразы — строчными, как `phuman` прототипа: «НДС за сентябрь 2026». */
const inSentence = (period: string, text: string) =>
  period === 'M' ? text.charAt(0).toLowerCase() + text.slice(1) : text;

/** Первая буква — строчная: «дата события» внутри фразы. */
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * Период отчёта внутри фразы (прототип `phuman`): «сентябрь 2026», у разового отчёта — с датой события:
 * «сентябрь 2026 · дата ликвидации 18.09.2026».
 */
function periodInSentence(r: TaxReminderSource['report'], t: Translate): string {
  const period = inSentence(r.period, periodFull({ period: r.period, start: r.periodStart }, t));
  if (!r.eventDate) return period;
  return t('report.period.event_full', {
    period,
    event: lowerFirst(r.eventLabel || t('report.event.default')),
    date: formatDateRu(r.eventDate),
  });
}

/**
 * Текст по шаблону waTax справочника платформы: контрагент, полное название вида, период, срок сдачи,
 * сколько осталось оплатить, «перечислить до»; «{реквизиты}» окно подставляет по отметкам.
 */
export function taxReminderHandler(deps: ApiDeps): RouteHandler<typeof taxReminderRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const t = await translateOf(deps);
    const out = await inTaxpay(deps, c, async (tx) => {
      const src = await taxReminderSource(tx, id, reportScopeOf(subject), t);
      if (!src) return null;
      if (!waitsPayment(src.report)) moneyFail(409, 'remind_not_waiting');
      const [templates, codes] = await Promise.all([messageTemplates(tx), phoneCodes(tx)]);
      return { src, template: templates.waTax ?? TAX_WHATSAPP_TEMPLATE, codes };
    });
    if (!out) apiFail(404, 'not_found', 'Отчёт не найден');
    const { src } = out;
    const r = src.report;
    const userId = orgContextOf(c).userId;
    const hidden = walletsHidden(src, subject, userId);
    const body: TaxReminder = {
      contractor: { id: src.contractor.id, name: src.contractor.name },
      phone: src.contractor.phone || null,
      phoneText: src.contractor.phone ? formatPhone(src.contractor.phone, out.codes) : '',
      base: taxWhatsAppBase(out.template, {
        contractor: src.contractor.name,
        report: r.typeName,
        period: periodInSentence(r, t),
        due: r.dueDate,
        left: (r.amount ?? 0) - r.paid,
        payDue: r.payDue ?? r.dueDate,
        today,
      }),
      to: src.contractor.paysTo === 'org' ? 'org' : 'employee',
      holder: src.holder && {
        id: src.holder.id,
        name: src.holder.name,
        self: isHolder(src, userId),
      },
      hidden,
      requisites: hidden ? [] : src.requisites,
    };
    c.header('Cache-Control', 'no-store');
    return c.json(body, 200);
  };
}

export const taxReminderSentRoute = createRoute({
  method: 'post',
  path: '/reports/{id}/tax-reminder',
  tags: ['finance'],
  summary: '«Открыть WhatsApp» с напоминанием о налоге: запись в историю отчёта',
  middleware: [requirePermission('repView')] as const,
  request: { params: ReportIdParam },
  responses: {
    200: { description: 'Записано в историю отчёта', content: json(OkResponse) },
    401: unauthorized,
    403: forbidden,
    404: notFound,
    409: {
      description: 'Отчёт не ждёт оплаты, у контрагента нет телефона или нет реквизитов',
      content: error,
    },
  },
});

/** Нажатие «Открыть WhatsApp» (прототип: «Напоминание в WhatsApp отправлено контрагенту»). */
export function taxReminderSentHandler(
  deps: ApiDeps,
): RouteHandler<typeof taxReminderSentRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const found = await inTaxpay(deps, c, async (tx) => {
      const src = await taxReminderSource(tx, id, reportScopeOf(subject), t);
      if (!src) return false;
      if (!waitsPayment(src.report)) moneyFail(409, 'remind_not_waiting');
      if (!src.contractor.phone) moneyFail(409, 'remind_no_phone');
      if (!src.requisites.length || walletsHidden(src, subject, orgContextOf(c).userId))
        moneyFail(409, 'remind_no_requisites');
      await logTaxReminder(tx, src.report.id, src.contractor.id);
      return true;
    });
    if (!found) apiFail(404, 'not_found', 'Отчёт не найден');
    return c.json({ ok: true as const }, 200);
  };
}
