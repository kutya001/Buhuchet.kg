import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  cancelPayment,
  contractorBalance,
  contractorMoneyView,
  contractorOperations,
  createReceipt,
  moneyContractor,
  payReport,
  receiptFeeRows,
  receiptFormRows,
  reportLabel,
  reportMoneyCard,
  reportPayments,
  reportSchedule,
  reportScope,
  saveMoneySettings,
  type ReportCard as ReportCardData,
  type Tx,
} from '@buhuchet/db';
import {
  canSeeContractor,
  formatText,
  hasPermission,
  periodLabel,
  scopeOf,
  type AccessSubject,
  type IsoDate,
  type Translate,
} from '@buhuchet/domain';
import {
  ContractorMoney,
  ContractorMoneyQuery,
  MoneyContractorParam,
  MoneySettingsRequest,
  MoneySettingsSaved,
  PaymentRequest,
  PaymentRollbackRequest,
  PaymentSaved,
  ReceiptForm,
  ReceiptRequest,
  ReceiptSaved,
  ReportIdParam,
  ReportSaved,
  type ReportCardMoney,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf, requireAnyPermission, requirePermission } from '../../middleware/access';
import { feeVisible, scopeSqlOf, subjectOf, todayOf } from '../contractors/common';
import { serverTexts } from '../l10n/texts';
import { error } from '../reports/common';
import { finScopeOf, inTaxpay } from './common';

/*
 * Деньги по отчётам (задача 2.19; ТЗ «Отчеты для сдачи» → «Оплата налога», «Сдача после оплаты»;
 * «Контрагенты» → вкладка «Деньги», «Баланс по контрагенту»; прототип modules/contractors.js inDlg,
 * ui/status-scale.js payDlg, rollbackDlg('pay'), modules/contractor-card.js). Всё — при включённом
 * «Учёте оплаты налогов»; контрагент — в области группы «Финансовые операции»; правила и запись —
 * слой данных (`@buhuchet/db` money-tax).
 */

const json = <S>(schema: S) => ({ 'application/json': { schema } });
const body = <S>(schema: S) => ({ required: true, content: json(schema) });

/**
 * Часть за обслуживание в поступлении (прототип inDlg, `feeOk`): плата видна (функция и право «Видеть
 * плату за обслуживание»), контрагент не разовый и платит организации; строже прототипа — ещё право
 * «Менять журнал тарифов» и контрагент в области группы «Контрагенты» (docs/deviations.md п. В-19).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#В-19
async function receiptFeeAllowed(
  tx: Tx,
  c: Context<AppEnv>,
  cp: { id: string; paysTo: 'emp' | 'org'; oneOff: boolean },
): Promise<boolean> {
  if (cp.paysTo !== 'org' || cp.oneOff) return false;
  const subject = subjectOf(c);
  // Записать оплату за обслуживание — право «Менять журнал тарифов» (ТЗ «Роли и права»).
  if (!hasPermission(subject, 'tariff')) return false;
  if (!(await feeVisible(tx, orgContextOf(c).orgId, subject))) return false;
  return !!(await moneyContractor(tx, cp.id, scopeSqlOf(subject)));
}

/** Тексты словаря для подписей отчётов («НДС 09.2026»). */
async function translator(deps: ApiDeps): Promise<Translate> {
  const texts = await serverTexts(deps);
  return (key, params) => formatText(texts(key), params);
}

/** Отчёт «НДС 09.2026» по полям сверки. */
const labelOf = (
  r: {
    typeShort: string;
    period: Parameters<typeof periodLabel>[0]['period'];
    periodStart: IsoDate;
    eventDate: IsoDate | null;
  },
  t: Translate,
) => reportLabel(r, t);

/** Месяц `YYYY-MM` со сдвигом. */
function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Последний день месяца `YYYY-MM`. */
function monthEnd(month: string): IsoDate {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function notFound(): never {
  apiFail(404, 'contractor_not_found', 'Контрагент не найден');
}

export const contractorMoneyRoute = createRoute({
  method: 'get',
  path: '/contractors/{id}/money',
  tags: ['money'],
  summary: 'Вкладка «Деньги» и «Баланс по контрагенту»',
  middleware: [requireAnyPermission('finView', 'money')] as const,
  request: { params: MoneyContractorParam, query: ContractorMoneyQuery },
  responses: {
    200: {
      description: 'Сверка по сроку оплаты до конца месяца, что нужно оплатить, операции и баланс',
      content: json(ContractorMoney),
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Нет права «Видеть финансовые операции» или «Учёт денег», или «Учёт оплаты налогов» выключен',
      content: error,
    },
    404: { description: 'Нет такого контрагента или он вне области', content: error },
  },
});

/**
 * Вкладка «Деньги» (прототип contractor-card.js, `money`): месяц — два прошлых, текущий и следующий;
 * сверка по сроку оплаты до конца месяца; операции без отменённых, от новых к старым.
 */
export function contractorMoneyHandler(
  deps: ApiDeps,
): RouteHandler<typeof contractorMoneyRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const today = todayOf(deps);
    const current = today.slice(0, 7);
    const months = [-2, -1, 0, 1].map((n) => addMonths(current, n));
    const month = c.req.valid('query').month ?? current;
    if (!months.includes(month)) {
      apiFail(400, 'validation_failed', 'Месяц сверки — два прошлых, текущий или следующий', {
        field: 'month',
      });
    }
    const subject = subjectOf(c);
    const t = await translator(deps);
    const out = await inTaxpay(deps, c, async (tx) => {
      const cp = await moneyContractor(tx, id, finScopeOf(subject));
      if (!cp) return null;
      const [view, ops, balance, fee] = await Promise.all([
        contractorMoneyView(tx, id, monthEnd(month)),
        contractorOperations(tx, id, t),
        contractorBalance(tx, id),
        feeVisible(tx, orgContextOf(c).orgId, subject),
      ]);
      // Плата видна по контрагенту ещё и в области группы «Контрагенты» (как `receiptFeeAllowed`).
      return { cp, view, ops, balance, fee: fee && canSeeContractor(subject, 'cps', cp) };
    });
    if (!out) notFound();
    const { cp, view, ops, balance, fee } = out;
    const byId = new Map(view.reports.map((r) => [r.id, r]));
    const item = (rid: string, amount: (r: (typeof view.reports)[number]) => number) => {
      const r = byId.get(rid)!;
      return { reportId: r.id, label: labelOf(r, t), payDue: r.payDue, amount: amount(r) };
    };
    const { reconciliation: rec } = view;
    const body: ContractorMoney = {
      contractor: {
        id: cp.id,
        name: cp.name,
        paysTo: cp.paysTo,
        holder: cp.responsibleName,
        archived: cp.archived,
        needReceiptFile: cp.needReceiptFile,
        version: cp.version,
      },
      month,
      months,
      balance,
      free: view.money.free,
      need: rec.due.map((rid) => item(rid, (r) => r.sum! - r.paid)),
      needSum: rec.dueSum,
      later: rec.later.map((rid) => item(rid, (r) => view.money.reports.get(r.id)?.reserved ?? 0)),
      laterSum: rec.laterSum,
      verdict: {
        state: rec.verdict.state,
        amount: 'amount' in rec.verdict ? rec.verdict.amount : 0,
      },
      // ОТКЛОНЕНИЕ: docs/deviations.md#В-19
      // Часть за обслуживание (общая сумма больше части на налоги) — только тому, кто видит плату:
      // остальным общая сумма равна части на налоги, а поступление только за обслуживание не видно.
      operations: ops
        .filter((o) => fee || !(o.kind === 'in' && o.amount === 0))
        .map((o) => ({
          id: o.id,
          kind: o.kind,
          self: o.self,
          date: o.date,
          amount: o.amount,
          total: fee || o.total === null ? o.total : o.amount,
          reports: o.reports,
          author: o.actorName,
        })),
      canReceive: hasPermission(subject, 'money') && !cp.archived,
    };
    return c.json(body, 200);
  };
}

export const receiptFormRoute = createRoute({
  method: 'get',
  path: '/contractors/{id}/receipt-form',
  tags: ['money'],
  summary: 'Окно «Поступление от контрагента»: неоплаченные отчёты',
  middleware: [requirePermission('money')] as const,
  request: { params: MoneyContractorParam },
  responses: {
    200: { description: 'Отчёты для детализации по сроку оплаты', content: json(ReceiptForm) },
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Нет права «Учёт денег» или «Учёт оплаты налогов» выключен',
      content: error,
    },
    404: { description: 'Нет такого контрагента или он вне области', content: error },
  },
});

export function receiptFormHandler(deps: ApiDeps): RouteHandler<typeof receiptFormRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const t = await translator(deps);
    const subject = subjectOf(c);
    const today = todayOf(deps);
    const out = await inTaxpay(deps, c, async (tx) => {
      const cp = await moneyContractor(tx, id, finScopeOf(subject));
      if (!cp) return null;
      const { rows, unpaid } = await receiptFormRows(tx, id);
      const fee = (await receiptFeeAllowed(tx, c, cp)) ? await receiptFeeRows(tx, id, today) : null;
      return { cp, rows, unpaid, fee };
    });
    if (!out) notFound();
    const body: ReceiptForm = {
      contractor: {
        id: out.cp.id,
        name: out.cp.name,
        paysTo: out.cp.paysTo,
        holder: out.cp.responsibleName,
        needReceiptFile: out.cp.needReceiptFile,
        // «Платит одной суммой» — только тому, кто видит плату (как переключатель на «Основном»).
        oneSum: !!out.fee && out.cp.oneSum,
      },
      rows: out.rows.map((r) => ({
        reportId: r.reportId,
        typeShort: r.typeShort,
        periodLabel: periodLabel({ period: r.period, start: r.periodStart, event: r.eventDate }, t),
        payDue: r.payDue,
        sum: r.sum,
        already: r.already,
        left: r.left,
      })),
      unpaid: out.unpaid,
      fee: out.fee ? { months: out.fee } : null,
      today,
    };
    return c.json(body, 200);
  };
}

export const createReceiptRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/receipts',
  tags: ['money'],
  summary: '«Записать поступление» от контрагента',
  middleware: [requirePermission('money')] as const,
  request: { params: MoneyContractorParam, body: body(ReceiptRequest) },
  responses: {
    201: {
      description: 'Поступление записано: к нему загружаются файлы (источник «Поступление»)',
      content: json(ReceiptSaved),
    },
    400: {
      description:
        'Неверные данные: сумма, дата позже сегодня, строка детализации больше нужного или не того контрагента, нет файла',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Нет права «Учёт денег», «Учёт оплаты налогов» выключен или файлы к поступлению загружать нельзя',
      content: error,
    },
    404: { description: 'Нет такого контрагента или он вне области', content: error },
    409: { description: 'Контрагент в архиве', content: error },
  },
});

/**
 * «Записать поступление» (прототип inDlg): общая сумма, дата и детализация по неоплаченным отчётам;
 * излишек — аванс. Файлы окно загружает к поступлению после ответа.
 */
export function createReceiptHandler(
  deps: ApiDeps,
): RouteHandler<typeof createReceiptRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const t = await translator(deps);
    const subject = subjectOf(c);
    const saved = await inTaxpay(deps, c, async (tx, settings) => {
      // Файлы к поступлению окно загрузит после сохранения — значит, загружать их должно быть можно.
      if (input.files > 0 && !(settings.features.files && hasPermission(subject, 'filesUpload')))
        apiFail(403, 'forbidden', 'Нет права на это действие');
      const cp = await moneyContractor(tx, id, finScopeOf(subject));
      return createReceipt(tx, id, input, {
        today: todayOf(deps),
        scope: finScopeOf(subject),
        filesOn: settings.features.files,
        t,
        fee: !!cp && (await receiptFeeAllowed(tx, c, cp)),
      });
    });
    return c.json(saved, 201);
  };
}

/** Область над отчётом для денежного действия: отчёт виден в «Отчётах для сдачи». */
const reportScopeOfSubject = (subject: AccessSubject) =>
  reportScope(scopeOf(subject, 'reports') === 'own' ? subject.employeeId : null);

export const payReportRoute = createRoute({
  method: 'post',
  path: '/reports/{id}/payments',
  tags: ['money'],
  summary: '«Отметить оплаченным»: оплата налога в бюджет',
  middleware: [requirePermission('repView'), requirePermission('money')] as const,
  request: { params: ReportIdParam, body: body(PaymentRequest) },
  responses: {
    200: {
      description:
        'Оплата записана: новая версия отчёта и операция — к ней загружается платёжное поручение',
      content: json(PaymentSaved),
    },
    400: { description: 'Неверная сумма или дата позже сегодня', content: error },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Нет права «Просматривать отчёты» или «Учёт денег»; «Учёт оплаты налогов» выключен',
      content: error,
    },
    404: { description: 'Нет такого отчёта или он вне области', content: error },
    409: {
      description:
        'Отчёт изменён другим пользователем, не ждёт оплаты или денег контрагента не хватает',
      content: error,
    },
  },
});

/**
 * «Отметить оплаченным» (прототип payDlg): без «Оплатил контрагент сам» — только деньгами этого
 * контрагента (сверка «Достаточно» и сумма не больше денег на счетах).
 */
export function payReportHandler(deps: ApiDeps): RouteHandler<typeof payReportRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, ...input } = c.req.valid('json');
    const subject = subjectOf(c);
    const { report, operationId } = await inTaxpay(deps, c, (tx) =>
      payReport(
        tx,
        id,
        { ...input, version },
        {
          today: todayOf(deps),
          scope: reportScopeOfSubject(subject),
          finScope: finScopeOf(subject),
        },
      ),
    );
    return c.json({ id: report.id, version: report.version, operationId }, 200);
  };
}

export const cancelPaymentRoute = createRoute({
  method: 'post',
  path: '/reports/{id}/payments/rollback',
  tags: ['money'],
  summary: 'Откат шкалы оплаты: отмена последней оплаты',
  middleware: [
    requirePermission('repView'),
    requirePermission('money'),
    requirePermission('rollback'),
  ] as const,
  request: { params: ReportIdParam, body: body(PaymentRollbackRequest) },
  responses: {
    200: { description: 'Оплата отменена: новая версия отчёта', content: json(ReportSaved) },
    400: { description: 'Нет причины', content: error },
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Нет права «Учёт денег» или «Откат статусов»; «Учёт оплаты налогов» выключен',
      content: error,
    },
    404: { description: 'Нет такого отчёта или он вне области', content: error },
    409: {
      description:
        'Отчёт изменён другим пользователем, оплат нет, это прежняя версия или после оплаты остаток списан в бонус',
      content: error,
    },
  },
});

export function cancelPaymentHandler(
  deps: ApiDeps,
): RouteHandler<typeof cancelPaymentRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const subject = subjectOf(c);
    const r = await inTaxpay(deps, c, (tx) =>
      cancelPayment(tx, id, input, {
        scope: reportScopeOfSubject(subject),
        finScope: finScopeOf(subject),
      }),
    );
    return c.json({ id: r.id, version: r.version }, 200);
  };
}

export const moneySettingsRoute = createRoute({
  method: 'patch',
  path: '/contractors/{id}/money-settings',
  tags: ['money'],
  summary: '«Файл при поступлении» и «Деньги на налоги переводит»',
  middleware: [requirePermission('createCp')] as const,
  request: { params: MoneyContractorParam, body: body(MoneySettingsRequest) },
  responses: {
    200: { description: 'Сохранено: новая версия контрагента', content: json(MoneySettingsSaved) },
    400: { description: 'Нечего менять', content: error },
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Нет права «Создавать и изменять контрагентов»; «Учёт оплаты налогов» выключен',
      content: error,
    },
    404: { description: 'Нет такого контрагента или он вне области', content: error },
    409: { description: 'Контрагент изменён другим пользователем или он в архиве', content: error },
  },
});

/**
 * «Файл при поступлении» и «Деньги на налоги переводит» на «Основном» (прототип contractor-card.js,
 * `cp-needf`, `cp-pays`): смена счёта переносит на него деньги контрагента (операции, кроме «Оплатил
 * сам»); в истории контрагента — было → стало.
 */
export function moneySettingsHandler(
  deps: ApiDeps,
): RouteHandler<typeof moneySettingsRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, ...patch } = c.req.valid('json');
    const subject = subjectOf(c);
    // Область — группы «Контрагенты», как у «Изменить» карточки: переключатели на «Основном» (прототип).
    const saved = await inTaxpay(deps, c, async (tx) => {
      // «Платит одной суммой» видит и меняет только тот, кто видит плату (прототип: переключатель
      // показан при feat('fee') && can('fee')).
      if (patch.oneSum !== undefined && !(await feeVisible(tx, orgContextOf(c).orgId, subject)))
        apiFail(403, 'forbidden', 'Нет права на это действие');
      return saveMoneySettings(tx, id, { version, ...patch }, scopeSqlOf(subject));
    });
    return c.json(saved, 200);
  };
}

/**
 * Деньги отчёта для карточки (прототип report-card.js): график, оплаты для «Истории статусов» оплаты,
 * что можно сделать. Деньги контрагента на счетах — только тому, кто может оплатить или принять. Без
 * «Учёта оплаты налогов» — только график оплаты (прототип показывает его у вида с долями всегда).
 */
export async function reportCardMoney(
  tx: Tx,
  card: ReportCardData,
  subject: AccessSubject,
  contractor: { responsibleEmployeeId: string | null; archived: boolean } | undefined,
  filesVisible: boolean,
  taxpay: boolean,
): Promise<ReportCardMoney | null> {
  if (card.act === 'sub') return null;
  if (!taxpay) {
    const schedule = await reportSchedule(tx, {
      ...card,
      reportTypeCode: card.type.code,
    });
    return {
      available: null,
      schedule,
      payments: [],
      canPay: false,
      canReceive: false,
      canCancel: false,
    };
  }
  const [m, payments] = await Promise.all([
    reportMoneyCard(tx, {
      ...card,
      contractorId: card.contractor.id,
      reportTypeCode: card.type.code,
    }),
    reportPayments(tx, card.id),
  ]);
  const fin =
    !!contractor && hasPermission(subject, 'money') && canSeeContractor(subject, 'fin', contractor);
  const sum = card.amount ?? 0;
  const waits = !card.superseded && card.status !== 'not_required' && sum > 0 && card.paid < sum;
  const canPay = fin && waits;
  const canReceive = canPay && !contractor!.archived;
  const live = payments.filter((p) => !p.cancelled);
  return {
    available: canPay || canReceive ? m.available : null,
    schedule: m.schedule,
    payments: payments.map((p) => ({
      at: p.at.toISOString(),
      amount: p.amount,
      self: p.self,
      date: p.date,
      actor: p.actorName,
      file: filesVisible && p.fileId && p.fileName ? { id: p.fileId, name: p.fileName } : null,
      cancelled: p.cancelled
        ? {
            at: p.cancelled.at.toISOString(),
            actor: p.cancelled.actorName,
            reason: p.cancelled.reason,
          }
        : null,
    })),
    canPay,
    canReceive,
    canCancel: fin && hasPermission(subject, 'rollback') && !card.superseded && live.length > 0,
  };
}
