import type { Tyiyn } from '../common/money';
import { scaleBack } from '../common/status';
import { singleTaxRateParts, type SingleTaxRateText } from '../dicts/value-guide';
import type { Translate } from '../l10n/texts';
import type { RateAddition, ReportAct, ReportPayment } from '../platform-dicts/catalog';
import { isSingleTaxType } from './rates';
import { OPEN_REPORT_STATUSES, type AssignmentEnRate, type ReportStatus } from './rules';

/*
 * Сдача отчёта и сумма к уплате (ТЗ «Отчеты для сдачи» → «Сдача отчёта», «Подтверждение сдачи», «Сумма
 * при нескольких ставках», «Сумма к уплате»; прототип ui/status-scale.js: repWait, repConfWhy, scBack,
 * needF0, submitDlg, repConfDlg, repFixDlg, partsFld, linesFld, readLines; core/tax-lines.js: taxLines,
 * lineTax). Правило «Сдан только после оплаты» включит задача денег (2.19).
 */

/** Строки суммы: по ставкам (ЕН, налог с продаж с добавленными строками) и по платежам вида. */
export const REPORT_LINE_KINDS = ['rate', 'payment'] as const;
export type ReportLineKind = (typeof REPORT_LINE_KINDS)[number];

/** Строка суммы в окне «Сдан» и «Указать сумму». */
export interface ReportLineDef {
  kind: ReportLineKind;
  /** Ключ строки: «ЕНС-04:cl», «main:r», «pay:0». */
  key: string;
  /** «ЕНС-04 · безналичная выручка, 4 %», «Подоходный налог». */
  label: string;
  /** Ставка строки «4 %»; у строки платежа — пусто. */
  pct: string;
  /** Наличная выручка — да, безналичная — нет, без деления — пусто (подсказка у строки). */
  cash: boolean | null;
  /** Строки уже нет в назначении, но в отчёте у неё есть значения: остаётся, пока они есть. */
  old: boolean;
  /** У строки платежа — код платежа (подсказка). */
  kbk?: string;
}

/** Строка суммы, сохранённая у отчёта. */
export interface ReportLine {
  kind: ReportLineKind;
  key: string;
  label: string;
  pct: string;
  cash: boolean | null;
  revenue: Tyiyn | null;
  tax: Tyiyn;
}

/** Назначение — то, из чего строятся строки по ставкам. */
export interface LineAssignment {
  rate: string | null;
  enRates: readonly AssignmentEnRate[];
  rateAdditions: readonly string[];
}

/** Ключ части ставки (прототип rtParts: k): безнал и нал — две строки, иначе одна «Выручка». */
const partKey = (count: number, i: number) => (count === 2 ? (i === 0 ? 'cl' : 'ca') : 'r');

/**
 * Строки суммы по ставкам (прототип taxLines): у единого налога — всегда, по каждой строке ЕНС (при
 * нескольких — с кодом в начале); у налога с продаж — когда к основной ставке добавлены строки. Ставка
 * по датам — на начало периода `date`. У вида без суммы и без назначения строк нет. Строки, уже
 * введённые в отчёте, но которых больше нет в назначении, остаются, пока в них есть значения (если у
 * назначения вообще есть строки).
 */
export function reportRateLines(
  input: {
    typeCode: string;
    act: ReportAct;
    assignment: LineAssignment | null;
    typeAdditions: readonly RateAddition[];
    rates: readonly SingleTaxRateText[];
    date: string;
    stored?: readonly ReportLine[];
  },
  t: Translate,
): ReportLineDef[] {
  if (input.act === 'sub') return [];
  const en = isSingleTaxType(input.typeCode);
  type Row = { code: string; variant: number | null; x: SingleTaxRateText; short?: string };
  const asText = (x: Pick<RateAddition, 'rate' | 'rateCashless' | 'rateCash'>, code = '') => ({
    code,
    rate: x.rate,
    rateCashless: x.rateCashless ?? '',
    rateCash: x.rateCash ?? '',
  });
  const a = input.assignment;
  let rows: Row[] = [];
  if (a && en) {
    rows = a.enRates.flatMap((e) => {
      const x = input.rates.find((r) => r.code === e.code);
      return x ? [{ code: e.code, variant: e.variant, x }] : [];
    });
  } else if (a && a.rateAdditions.length) {
    const added = a.rateAdditions.flatMap((k) => {
      const x = input.typeAdditions.find((y) => y.k === k);
      return x ? [{ code: k, variant: null, x: asText(x), short: x.short || x.name }] : [];
    });
    if (added.length)
      rows = [
        ...(a.rate ? [{ code: '', variant: null, x: asText({ rate: a.rate }) }] : []),
        ...added,
      ];
  }
  // Строк по ставкам нет — нет и прежних строк: сумма вводится одним числом (прототип taxLines).
  if (en ? !rows.length : rows.length < 2) return [];
  const out: ReportLineDef[] = [];
  const many = rows.length > 1;
  const seen = new Map<string, number>();
  for (const row of rows) {
    const parts = singleTaxRateParts(row.x, input.rates, input.date, t, row.variant ?? 0);
    parts.forEach((p, i) => {
      const pre = !many ? '' : en ? row.code : row.code ? (row.short ?? '') : t('report.line.main');
      let key = `${row.code || 'main'}${row.variant != null ? `/${row.variant}` : ''}:${partKey(parts.length, i)}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n > 1) key += `#${n}`;
      out.push({
        kind: 'rate',
        key,
        label: pre
          ? t('report.line.label_pre', { pre, name: p.name.toLowerCase(), pct: p.pct })
          : t('report.line.label', { name: p.name, pct: p.pct }),
        pct: p.pct,
        cash: parts.length === 2 ? i === 1 : null,
        old: false,
      });
    });
  }
  for (const l of input.stored ?? []) {
    if (l.kind === 'rate' && !out.some((o) => o.key === l.key)) {
      out.push({ kind: 'rate', key: l.key, label: l.label, pct: l.pct, cash: l.cash, old: true });
    }
  }
  return out;
}

/**
 * Строки по платежам «Что уплачивается» (прототип partsFld): у вида с уплатой и несколькими платежами
 * (Соцфонд — «Подоходный налог» и «Страховые взносы») — сумма по каждому, итог — их сумма.
 */
export function reportPaymentLines(
  payments: readonly ReportPayment[],
  act: ReportAct,
): ReportLineDef[] {
  if (act === 'sub' || payments.length < 2) return [];
  return payments.map((p, i) => ({
    kind: 'payment',
    key: `pay:${i}`,
    label: p.name,
    pct: '',
    cash: null,
    old: false,
    kbk: p.kbk,
  }));
}

/** Процент ставки числом: «4 %» → 4, «0,5 %» → 0,5. */
const pctNumber = (pct: string) => Number.parseFloat(pct.replace(',', '.')) || 0;

/** Налог строки: выручка × ставка с округлением до сома (прототип lineTax), в тыйынах. */
export function lineTax(revenue: Tyiyn, pct: string): Tyiyn {
  return Math.round((revenue * pctNumber(pct)) / 100 / 100) * 100;
}

/** Введённое в строке: выручка и налог (пусто — не введено). */
export interface ReportLineInput {
  key: string;
  revenue: Tyiyn | null;
  tax: Tyiyn | null;
}

export type ReportLinesResult =
  { ok: true; lines: ReportLine[]; total: Tyiyn | null } | { ok: false; key: string };

/**
 * Строки из введённого (прототип readLines): налог без выручки — как введён, выручка без налога —
 * выручка × ставка; пустые строки не сохраняются. Все строки пустые — строк нет, итог null (сумма к
 * уплате остаётся прежней). Ключ не из строк окна или отрицательное значение — отказ по этой строке.
 */
export function reportLinesOf(
  defs: readonly ReportLineDef[],
  inputs: readonly ReportLineInput[],
): ReportLinesResult {
  const lines: ReportLine[] = [];
  for (const input of inputs) {
    const def = defs.find((d) => d.key === input.key);
    const bad = (v: number | null) => v !== null && (!Number.isSafeInteger(v) || v < 0);
    if (!def || bad(input.revenue) || bad(input.tax)) return { ok: false, key: input.key };
    if (input.revenue === null && input.tax === null) continue;
    if (lines.some((l) => l.key === def.key)) return { ok: false, key: input.key };
    const tax =
      input.tax ??
      (def.kind === 'rate' && input.revenue !== null ? lineTax(input.revenue, def.pct) : 0);
    lines.push({
      kind: def.kind,
      key: def.key,
      label: def.label,
      pct: def.pct,
      cash: def.cash,
      revenue: def.kind === 'rate' ? input.revenue : null,
      tax,
    });
  }
  lines.sort(
    (x, y) => defs.findIndex((d) => d.key === x.key) - defs.findIndex((d) => d.key === y.key),
  );
  if (!lines.length) return { ok: true, lines, total: null };
  return { ok: true, lines, total: lines.reduce((s, l) => s + l.tax, 0) };
}

/** Отчёт для правил сдачи и подтверждения. */
export interface ReportFacts {
  status: ReportStatus;
  act: ReportAct;
  superseded: boolean;
  /** Сдача подтверждена (есть отметка «Подтверждено»). */
  confirmed: boolean;
  /** Кто отметил «Сдан» (учётная запись); у отмеченных при назначении — тот, кто назначил. */
  submittedBy: string | null;
}

/**
 * Сдача ждёт подтверждения (прототип repWait): сдан, у вида есть сдача, подтверждения нет — при
 * включённой в учётной политике «Сдача отчётов требует подтверждения».
 */
export const reportWaiting = (
  r: Pick<ReportFacts, 'status' | 'act' | 'confirmed'>,
  confirmOn: boolean,
) => confirmOn && r.status === 'submitted' && r.act !== 'pay' && !r.confirmed;

/** Отметка на шаге «Сдан» (прототип repMark): «Ждёт подтверждения», «Подтверждено» или нет. */
export function reportMarkOf(
  r: Pick<ReportFacts, 'status' | 'act' | 'confirmed'>,
  confirmOn: boolean,
): 'waiting' | 'confirmed' | null {
  if (!confirmOn || r.status !== 'submitted' || r.act === 'pay') return null;
  return r.confirmed ? 'confirmed' : 'waiting';
}

/** Кто подтверждает: право «Подтверждать сдачу отчётов», учётная запись, владелец ли. */
export interface ReportConfirmer {
  canConfirm: boolean;
  userId: string | null;
  isOwner: boolean;
}

export type ReportConfirmRefusal =
  'report_not_waiting' | 'report_confirm_right' | 'report_confirm_own';

/**
 * Почему нельзя «Подтвердить» и «На исправление» (прототип repConfWhy): отчёт не ждёт подтверждения;
 * нет права «Подтверждать сдачу отчётов»; свой сданный отчёт — подтверждает другой сотрудник с правом
 * (кроме владельца организации).
 */
export function reportConfirmRefusal(
  r: Pick<ReportFacts, 'status' | 'act' | 'confirmed' | 'submittedBy'>,
  who: ReportConfirmer,
  confirmOn: boolean,
): ReportConfirmRefusal | null {
  if (!reportWaiting(r, confirmOn)) return 'report_not_waiting';
  if (!who.canConfirm) return 'report_confirm_right';
  if (!who.isOwner && r.submittedBy !== null && r.submittedBy === who.userId) {
    return 'report_confirm_own';
  }
  return null;
}

/**
 * Куда откатить отчёт на один шаг (прототип scBack): у прежней версии уточнённого — сначала откатить
 * уточнённую (кроме «Не требуется»); «Сдан» с подтверждением — снять подтверждение («Ждёт
 * подтверждения»), иначе — в «В работе»; «Требует исправления» — в «Сдан»; «В работе» и «Не
 * требуется» — в «К сдаче».
 */
export function reportBack(
  r: Pick<ReportFacts, 'status' | 'act' | 'confirmed' | 'superseded'>,
  confirmOn: boolean,
): { to: string } | { refusal: 'report_rollback_superseded' } | null {
  if (r.superseded && r.status !== 'not_required') return { refusal: 'report_rollback_superseded' };
  const to = scaleBack('report', r.status, {
    confirmed: confirmOn && r.confirmed && r.act !== 'pay',
  });
  return to ? { to } : null;
}

/** Настройки вида отчёта в организации: «Файл при сдаче обязателен», «Квитанция о приёме обязательна». */
export interface ReportTypeFiles {
  needFile: boolean;
  needReceipt: boolean;
}

/**
 * Без файла «Сдан» не ставится (прототип needF0): «Файл при сдаче обязателен» или «Квитанция о приёме
 * обязательна» без подтверждения сдачи (квитанцию тогда прикладывают при сдаче). Без «Файлов в
 * карточках» требования нет, как у задач (docs/deviations.md п. Б-1, Б-6).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Б-6 — в прототипе без «Файлов в карточках» такой отчёт не сдать.
export const reportFileRequired = (
  type: ReportTypeFiles,
  o: { confirmOn: boolean; filesOn: boolean },
) => o.filesOn && (type.needFile || (!o.confirmOn && type.needReceipt));

/** Без квитанции сдачу не подтвердить (прототип needRcpt): «Квитанция о приёме обязательна». */
export const reportReceiptRequired = (type: ReportTypeFiles, o: { filesOn: boolean }) =>
  o.filesOn && type.needReceipt;

/** Можно ли «Отметить сданным»: несданный отчёт со сдачей, не прежняя версия. */
export const reportSubmittable = (r: Pick<ReportFacts, 'status' | 'act' | 'superseded'>) =>
  !r.superseded && r.act !== 'pay' && OPEN_REPORT_STATUSES.has(r.status);

/**
 * «Не требуется» (прототип reportActions): у отчёта, который ещё не «Не требуется» и не сдан
 * окончательно — сданный, но ждущий подтверждения, отметить можно.
 */
export const reportNotRequiredAllowed = (
  r: Pick<ReportFacts, 'status' | 'act' | 'confirmed' | 'superseded'>,
  confirmOn: boolean,
) =>
  !r.superseded &&
  r.status !== 'not_required' &&
  !(r.status === 'submitted' && !reportWaiting(r, confirmOn));

/** Есть ли у отчёта сумма к уплате (прототип tR(r).sum): у вида «Сдача» суммы нет. */
export const reportHasAmount = (act: ReportAct) => act !== 'sub';
