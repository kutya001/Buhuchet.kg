import {
  auditActorName,
  OPEN_REPORT_STATUSES,
  RecordNotFoundError,
  reportBack,
  reportConfirmRefusal,
  reportFileRequired,
  reportHasAmount,
  reportLinesOf,
  reportNotRequiredAllowed,
  reportPaymentLines,
  reportRateLines,
  reportReceiptRequired,
  reportSubmittable,
  type HistoryChange,
  type HistoryValue,
  type IsoDate,
  type ReportConfirmer,
  type ReportLine,
  type ReportLineDef,
  type ReportLineInput,
  type ReportMessageCode,
  type ReportStatus,
  type Translate,
  type Tyiyn,
} from '@buhuchet/domain';
import { and, asc, count, desc, eq, gt, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from './client';
import { writeHistory } from './history';
import { lockReport, ReportChangedError, ReportStateError } from './reports';
import {
  assignments,
  auditLog,
  authorities,
  contractors,
  employees,
  files,
  orgReportTypes,
  reports,
  reportTaxLines,
  reportTypes,
  singleTaxRates,
  statusHistory,
} from './schema';
import { writeStatusChange } from './status';

/*
 * Сдача отчёта (ТЗ «Отчеты для сдачи» → «Сдача отчёта», «Подтверждение сдачи», «Сумма при нескольких
 * ставках», «Сумма к уплате»; прототип ui/status-scale.js: submitDlg, repConfDlg, repFixDlg, sumDlg,
 * applyRepeat, rollbackDlg, setStatus; задача 2.14). Что можно — правила @buhuchet/domain
 * (`reportSubmittable`, `reportConfirmRefusal`, `reportBack`); здесь — что прочитать и что записать.
 * Смена статуса пишется в «Историю статусов», сумма, строки, дата сдачи и файлы — в историю отчёта, в
 * той же транзакции. Отчёт блокируется до конца транзакции; устаревшая версия —
 * `ReportChangedError`. «Сдан только после оплаты» добавит задача денег (2.19).
 */

/** Отказ действия с отчётом: код и текст — `REPORT_MESSAGES`; 400 — неверный ввод, 403 — не по правам. */
export class ReportRefusedError extends Error {
  constructor(
    readonly id: string,
    readonly code: ReportMessageCode,
    readonly status: 400 | 403 | 409 = 409,
    readonly field?: string,
  ) {
    super(`reports: ${id} — ${code}`);
    this.name = 'ReportRefusedError';
  }
}

type ReportRecord = typeof reports.$inferSelect;

/** Что знает действие об организации: подтверждение сдачи, «Файлы в карточках», сегодня. */
export interface ReportActionContext {
  today: IsoDate;
  /** Область «Свои» (`reportScope`) над отчётом с контрагентом. */
  scope: SQL | undefined;
  /**
   * Область «Свои» над контрагентом (`contractorScope`): «Повторять эту сумму» меняет назначение и
   * следующие отчёты — только у своего контрагента, а не у того, где сотрудник ответственный за один отчёт.
   */
  contractorScope: SQL | undefined;
  confirmOn: boolean;
  filesOn: boolean;
  t: Translate;
}

/** Причины, которые пишутся в историю системой. */
export interface ReportSubmitTexts {
  /** «Повторяющаяся сумма из назначения». */
  repeat: string;
}

/** Настройки вида в организации: файл при сдаче и квитанция о приёме обязательны. */
export async function reportTypeFiles(
  tx: Tx,
  code: string,
): Promise<{ needFile: boolean; needReceipt: boolean }> {
  const [row] = await tx
    .select({ needFile: orgReportTypes.needFile, needReceipt: orgReportTypes.needReceipt })
    .from(orgReportTypes)
    .where(eq(orgReportTypes.reportTypeCode, code));
  return { needFile: row?.needFile ?? false, needReceipt: row?.needReceipt ?? false };
}

/** Загруженные файлы отчёта (блок «Файлы» карточки): номер и имя, по порядку загрузки. */
export async function reportReadyFiles(
  tx: Tx,
  reportId: string,
): Promise<{ id: string; name: string }[]> {
  return tx
    .select({ id: files.id, name: files.name })
    .from(files)
    .where(
      and(eq(files.sourceKind, 'report'), eq(files.sourceId, reportId), eq(files.state, 'ready')),
    )
    .orderBy(asc(files.createdAt), asc(files.id));
}

/**
 * Отчёт как источник файлов (блок «Файлы» карточки, Файловый менеджер): контрагент — для области группы
 * «Файловый менеджер» и запрета у архивного, прежняя ли версия; null — нет или вне области `scope`.
 */
export async function reportFileTarget(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
): Promise<{
  id: string;
  superseded: boolean;
  contractor: { id: string; responsibleEmployeeId: string | null; archived: boolean };
} | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await tx
    .select({
      id: reports.id,
      superseded: reports.superseded,
      contractorId: contractors.id,
      responsibleEmployeeId: contractors.responsibleEmployeeId,
      archived: sql<boolean>`${contractors.serviceStatus} = 'archived'`,
    })
    .from(reports)
    .innerJoin(contractors, eq(contractors.id, reports.contractorId))
    .where(and(eq(reports.id, id), scope));
  if (!row) return null;
  return {
    id: row.id,
    superseded: row.superseded,
    contractor: {
      id: row.contractorId,
      responsibleEmployeeId: row.responsibleEmployeeId,
      archived: row.archived,
    },
  };
}

/** Строки суммы отчёта по порядку. */
async function storedLines(tx: Tx, reportId: string): Promise<ReportLine[]> {
  const rows = await tx
    .select()
    .from(reportTaxLines)
    .where(eq(reportTaxLines.reportId, reportId))
    .orderBy(asc(reportTaxLines.kind), asc(reportTaxLines.sortOrder), asc(reportTaxLines.id));
  return rows.map((l) => ({
    kind: l.kind,
    key: l.lineKey,
    label: l.label,
    pct: l.rate,
    cash: l.cash,
    revenue: l.revenue === null ? null : Number(l.revenue),
    tax: Number(l.tax),
  }));
}

/**
 * Назначение, из которого берутся строки и куда пишется повторяющаяся сумма (прототип assignOf):
 * назначение отчёта, иначе действующее назначение вида у контрагента; `active` — только действующее.
 */
async function assignmentOf(tx: Tx, r: ReportRecord, active: boolean) {
  const rows = await tx
    .select()
    .from(assignments)
    .where(
      and(
        eq(assignments.contractorId, r.contractorId),
        eq(assignments.reportTypeCode, r.reportTypeCode),
        active ? isNull(assignments.endedOn) : undefined,
      ),
    )
    .orderBy(sql`${assignments.endedOn} is null desc`, desc(assignments.createdAt));
  return (
    (!active && r.assignmentId ? rows.find((a) => a.id === r.assignmentId) : undefined) ??
    rows.find((a) => a.endedOn === null) ??
    (active ? null : (rows[0] ?? null))
  );
}

/** Строки окна «Сдан» и «Указать сумму»: по ставкам назначения и по платежам вида. */
export async function reportLineDefs(
  tx: Tx,
  r: ReportRecord,
  t: Translate,
  stored?: readonly ReportLine[],
): Promise<ReportLineDef[]> {
  if (!reportHasAmount(r.act)) return [];
  const [a, [type], rates, saved] = await Promise.all([
    assignmentOf(tx, r, false),
    tx
      .select({ additions: reportTypes.rateAdditions, payments: reportTypes.payments })
      .from(reportTypes)
      .where(eq(reportTypes.code, r.reportTypeCode)),
    tx
      .select({
        code: singleTaxRates.code,
        rate: singleTaxRates.rate,
        rateCashless: singleTaxRates.rateCashless,
        rateCash: singleTaxRates.rateCash,
      })
      .from(singleTaxRates),
    stored ?? storedLines(tx, r.id),
  ]);
  return [
    ...reportRateLines(
      {
        typeCode: r.reportTypeCode,
        act: r.act,
        assignment: a ?? null,
        typeAdditions: type?.additions ?? [],
        rates,
        date: r.periodStart,
        stored: saved,
      },
      t,
    ),
    ...reportPaymentLines(type?.payments ?? [], r.act),
  ];
}

/** Строки в истории: подпись, выручка, налог. */
const linesValue = (lines: readonly ReportLine[]): HistoryValue =>
  lines.map((l) => ({ label: l.label, revenue: l.revenue, tax: l.tax }));

const sameLines = (a: readonly ReportLine[], b: readonly ReportLine[]) =>
  JSON.stringify(linesValue(a)) === JSON.stringify(linesValue(b));

/** Ввод суммы: итог (null — не введён) и строки (null — строк в окне нет или их не трогали). */
export interface ReportAmountInput {
  amount: Tyiyn | null;
  lines: readonly ReportLineInput[] | null;
}

/**
 * Сумма к уплате и строки из ввода (прототип sumDlg, submitDlg, readLines): при строках по ставкам
 * сумма — их итог, руками не вводится; все строки пустые — строки удаляются, сумма прежняя; строки по
 * платежам — так же. Без строк — введённая сумма. Возвращает новую сумму и строки (undefined — не
 * меняются) и изменения для истории.
 */
async function amountOf(
  tx: Tx,
  r: ReportRecord,
  input: ReportAmountInput,
  t: Translate,
): Promise<{ amount: Tyiyn | null; lines: ReportLine[] | undefined; changes: HistoryChange[] }> {
  const was = await storedLines(tx, r.id);
  const defs = await reportLineDefs(tx, r, t, was);
  const before = r.amount === null ? null : Number(r.amount);
  let amount = input.amount ?? before;
  let lines: ReportLine[] | undefined;
  if (defs.length && input.lines !== null) {
    const res = reportLinesOf(defs, input.lines);
    if (!res.ok) throw new ReportRefusedError(r.id, 'report_lines_invalid', 400, 'lines');
    lines = res.lines;
    amount = res.total ?? before;
  }
  const changes: HistoryChange[] = [];
  if (amount !== before) changes.push({ field: 'amount', from: before, to: amount });
  if (lines && !sameLines(was, lines)) {
    changes.push({ field: 'lines', from: linesValue(was), to: linesValue(lines) });
  }
  return { amount, lines, changes };
}

/** Заменить строки суммы отчёта. */
async function saveLines(tx: Tx, reportId: string, lines: readonly ReportLine[]): Promise<void> {
  await tx.delete(reportTaxLines).where(eq(reportTaxLines.reportId, reportId));
  if (!lines.length) return;
  await tx.insert(reportTaxLines).values(
    lines.map((l, i) => ({
      reportId,
      kind: l.kind,
      lineKey: l.key,
      label: l.label,
      rate: l.pct,
      cash: l.cash,
      revenue: l.revenue,
      tax: l.tax,
      sortOrder: i,
    })),
  );
}

/**
 * «Повторять эту сумму» (прототип applyRepeat): галочка — сумма сохраняется в действующем назначении и
 * подставляется итогом, без строк, в следующие несданные отчёты контрагента по виду без своей суммы;
 * снятая галочка — повторяющаяся сумма отключается и уходит из следующих отчётов, где она стояла.
 */
async function applyRepeat(
  tx: Tx,
  r: ReportRecord,
  amount: Tyiyn,
  on: boolean,
  ctx: Pick<ReportActionContext, 'contractorScope'> & { texts: ReportSubmitTexts },
): Promise<void> {
  if (ctx.contractorScope) {
    const [own] = await tx
      .select({ id: contractors.id })
      .from(contractors)
      .where(and(eq(contractors.id, r.contractorId), ctx.contractorScope));
    if (!own) return;
  }
  const { texts } = ctx;
  const a = await assignmentOf(tx, r, true);
  if (!a) return;
  const was = a.fixedAmount === null ? null : Number(a.fixedAmount);
  if (!on && was === null) return;
  const next = on ? amount : null;
  if (was !== next) {
    await tx
      .update(assignments)
      .set({
        fixedAmount: next,
        version: sql`${assignments.version} + 1`,
        updatedAt: sql`now()`,
        updatedBy: sql`app.current_user_id()`,
      })
      .where(eq(assignments.id, a.id));
    await writeHistory(tx, {
      entity: 'assignment',
      entityId: a.id,
      action: 'update',
      changes: [{ field: 'fixedAmount', from: was, to: next }],
      contractorId: r.contractorId,
    });
  }
  const later = and(
    eq(reports.contractorId, r.contractorId),
    eq(reports.reportTypeCode, r.reportTypeCode),
    gt(reports.periodStart, r.periodStart),
    eq(reports.superseded, false),
    inArray(reports.status, [...OPEN_REPORT_STATUSES]),
    on ? or(isNull(reports.amount), eq(reports.amountAuto, true)) : eq(reports.amountAuto, true),
  );
  const targets = await tx
    .select({ id: reports.id, amount: reports.amount })
    .from(reports)
    .where(later)
    .for('update');
  const changed = targets.filter((x) => (x.amount === null ? null : Number(x.amount)) !== next);
  if (!changed.length) return;
  const ids = changed.map((x) => x.id);
  await tx
    .update(reports)
    .set({
      amount: next,
      amountAuto: on,
      version: sql`${reports.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(inArray(reports.id, ids));
  await tx.delete(reportTaxLines).where(inArray(reportTaxLines.reportId, ids));
  await writeHistory(
    tx,
    ...changed.map((x) => ({
      entity: 'report' as const,
      entityId: x.id,
      action: 'update' as const,
      changes: [{ field: 'amount', from: x.amount === null ? null : Number(x.amount), to: next }],
      reason: texts.repeat,
      contractorId: r.contractorId,
    })),
  );
}

/** Отчёт заблокирован, версия совпадает. */
async function lockCurrent(tx: Tx, id: string, version: number, scope: SQL | undefined) {
  const r = await lockReport(tx, id, scope);
  if (r.version !== version) throw new ReportChangedError(id, r.version);
  return r;
}

/** Новые файлы — среди загруженных файлов отчёта; их имена — для истории. */
async function checkFiles(
  tx: Tx,
  r: ReportRecord,
  fileIds: readonly string[],
): Promise<{ ready: { id: string; name: string }[]; added: { id: string; name: string }[] }> {
  const ready = await reportReadyFiles(tx, r.id);
  const added = fileIds.map((id) => ready.find((f) => f.id === id));
  if (added.some((f) => !f)) {
    throw new ReportRefusedError(r.id, 'report_file_not_found', 400, 'fileIds');
  }
  return { ready, added: added as { id: string; name: string }[] };
}

/** Поля сдачи и подтверждения, которые снимает уход со «Сдан». */
const CLEAR_SUBMIT = {
  submittedOn: null,
  submittedAt: null,
  submittedBy: null,
  confirmedAt: null,
  confirmedBy: null,
  confirmNote: '',
} as const;
const CLEAR_CONFIRM = { confirmedAt: null, confirmedBy: null, confirmNote: '' } as const;

const bump = () => ({
  version: sql`${reports.version} + 1`,
  updatedAt: sql`now()`,
  updatedBy: sql`app.current_user_id()`,
});

/** Ввод окна «Сдан» одного отчёта. */
export interface ReportSubmitInput extends ReportAmountInput {
  date: IsoDate;
  /** «Повторять эту сумму в следующих отчётах» (только с введённой суммой). */
  repeat: boolean;
  /** Файлы, загруженные в окне (уже прикреплены к отчёту). */
  fileIds: readonly string[];
}

/**
 * «Отметить сданным» (ТЗ «При отметке «Сдан» указывается дата сдачи, сумма к уплате и можно прикрепить
 * файлы»; прототип submitDlg): дата — не позже сегодня; файл обязателен, если так настроен вид (и
 * включены «Файлы в карточках»); сумма и строки — как в «Указать сумму». Отчёт получает «Сдан» и, при
 * подтверждении сдачи, отметку «Ждёт подтверждения»; прежнее подтверждение и возврат снимаются.
 */
export async function submitReport(
  tx: Tx,
  id: string,
  input: ReportSubmitInput,
  ctx: ReportActionContext & { version: number; texts: ReportSubmitTexts },
): Promise<ReportRecord> {
  const r = await lockCurrent(tx, id, ctx.version, ctx.scope);
  submittable(r);
  if (input.date > ctx.today) throw new ReportRefusedError(id, 'submit_date_invalid', 400, 'date');
  const { ready, added } = await checkFiles(tx, r, input.fileIds);
  const type = await reportTypeFiles(tx, r.reportTypeCode);
  if (reportFileRequired(type, ctx) && ready.length === 0) {
    throw new ReportRefusedError(id, 'report_file_required', 400, 'fileIds');
  }
  const typed = reportHasAmount(r.act) && (input.amount !== null || input.lines !== null);
  const sum = typed ? await amountOf(tx, r, input, ctx.t) : null;
  const [updated] = await tx
    .update(reports)
    .set({
      status: 'submitted',
      submittedOn: input.date,
      submittedAt: sql`now()`,
      submittedBy: sql`app.current_user_id()`,
      ...CLEAR_CONFIRM,
      // Сумма из окна — уже не повторяющаяся из назначения, даже без изменений (прототип submitDlg:
      // r.auto = false).
      ...(sum ? { amount: sum.amount, amountAuto: false } : {}),
      ...bump(),
    })
    .where(eq(reports.id, id))
    .returning();
  if (sum?.lines) await saveLines(tx, id, sum.lines);
  await writeStatusChange(tx, {
    scale: 'report',
    entityId: id,
    from: r.status,
    to: 'submitted',
    fileId: added[0]?.id ?? null,
  });
  await writeHistory(tx, {
    entity: 'report',
    entityId: id,
    action: 'update',
    changes: [
      { field: 'submittedOn', from: r.submittedOn, to: input.date },
      ...(sum?.changes ?? []),
      ...(added.length ? [{ field: 'files', to: added.map((f) => f.name) }] : []),
    ],
    contractorId: r.contractorId,
  });
  if (sum && input.amount !== null && sum.amount !== null) {
    await applyRepeat(tx, r, sum.amount, input.repeat, ctx);
  }
  return updated!;
}

/** Сдать можно несданный отчёт со сдачей, не прежнюю версию. */
function submittable(r: ReportRecord): void {
  if (r.superseded) throw new ReportStateError(r.id, 'superseded');
  if (r.act === 'pay') throw new ReportRefusedError(r.id, 'report_pay_only_submit');
  if (!reportSubmittable(r)) throw new ReportRefusedError(r.id, 'report_not_open_submit');
}

/** Отчёт массовой сдачи: версия, на которой его видели, и сумма из окна (null — не меняется). */
export interface ReportBatchItem {
  id: string;
  version: number;
  amount: Tyiyn | null;
}

/** Итог массового действия: сделано, пропущено из-за файла (квитанции) и по статусу или правам. */
export interface ReportBatchResult {
  done: number;
  skippedFile: number;
  skipped: number;
}

/**
 * Отчёты пачки по номеру: две пачки с общими отчётами блокируют их в одном порядке и не ждут друг
 * друга по кругу.
 */
const byId = <T extends { id: string }>(items: readonly T[]) =>
  [...items].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

/**
 * Массовая «Сдан» (ТЗ «Массово: выбрать несколько отчётов и отметить сданными одной датой, суммы
 * вписать в том же окне»; прототип submitDlg): отчёты, для которых файл обязателен, а его нет, и уже
 * сданные пропускаются; сумма — одна на отчёт без строк, изменённая сумма удаляет строки отчёта.
 */
export async function submitReports(
  tx: Tx,
  items: readonly ReportBatchItem[],
  date: IsoDate,
  ctx: ReportActionContext,
): Promise<ReportBatchResult> {
  if (date > ctx.today) throw new ReportRefusedError('', 'submit_date_invalid', 400, 'date');
  const result: ReportBatchResult = { done: 0, skippedFile: 0, skipped: 0 };
  const types = new Map<string, { needFile: boolean; needReceipt: boolean }>();
  for (const item of byId(items)) {
    const r = await lockCurrent(tx, item.id, item.version, ctx.scope);
    if (r.superseded || !reportSubmittable(r)) {
      result.skipped++;
      continue;
    }
    if (!types.has(r.reportTypeCode)) {
      types.set(r.reportTypeCode, await reportTypeFiles(tx, r.reportTypeCode));
    }
    if (reportFileRequired(types.get(r.reportTypeCode)!, ctx)) {
      if ((await reportReadyFiles(tx, r.id)).length === 0) {
        result.skippedFile++;
        continue;
      }
    }
    const before = r.amount === null ? null : Number(r.amount);
    const amount = reportHasAmount(r.act) && item.amount !== null ? item.amount : before;
    const changes: HistoryChange[] = [{ field: 'submittedOn', from: r.submittedOn, to: date }];
    if (amount !== before) {
      changes.push({ field: 'amount', from: before, to: amount });
      const was = await storedLines(tx, r.id);
      if (was.length) {
        changes.push({ field: 'lines', from: linesValue(was), to: [] });
        await saveLines(tx, r.id, []);
      }
    }
    await tx
      .update(reports)
      .set({
        status: 'submitted',
        submittedOn: date,
        submittedAt: sql`now()`,
        submittedBy: sql`app.current_user_id()`,
        ...CLEAR_CONFIRM,
        ...(amount !== before ? { amount, amountAuto: false } : {}),
        ...bump(),
      })
      .where(eq(reports.id, r.id));
    await writeStatusChange(tx, {
      scale: 'report',
      entityId: r.id,
      from: r.status,
      to: 'submitted',
    });
    await writeHistory(tx, {
      entity: 'report',
      entityId: r.id,
      action: 'update',
      changes,
      contractorId: r.contractorId,
    });
    result.done++;
  }
  return result;
}

/**
 * «Указать сумму» (ТЗ «Сумма к уплате»: вводится вручную, 0 — нулевой отчёт, «Повторять эту сумму»;
 * прототип sumDlg): у вида с уплатой, кроме «Не требуется» и прежних версий; в историю — «Сумма к
 * уплате: X → Y; строки: …».
 */
export async function setReportAmount(
  tx: Tx,
  id: string,
  input: ReportAmountInput & { repeat: boolean },
  ctx: ReportActionContext & { version: number; texts: ReportSubmitTexts },
): Promise<ReportRecord> {
  const r = await lockCurrent(tx, id, ctx.version, ctx.scope);
  if (r.superseded) throw new ReportStateError(id, 'superseded');
  if (!reportHasAmount(r.act)) throw new ReportRefusedError(id, 'report_no_amount');
  if (r.status === 'not_required') throw new ReportRefusedError(id, 'report_amount_not_required');
  const sum = await amountOf(tx, r, input, ctx.t);
  if (sum.amount === null)
    throw new ReportRefusedError(id, 'report_amount_required', 400, 'amount');
  const [updated] = await tx
    .update(reports)
    .set({ amount: sum.amount, amountAuto: false, ...bump() })
    .where(eq(reports.id, id))
    .returning();
  if (sum.lines) await saveLines(tx, id, sum.lines);
  if (sum.changes.length) {
    await writeHistory(tx, {
      entity: 'report',
      entityId: id,
      action: 'update',
      changes: sum.changes,
      contractorId: r.contractorId,
    });
  }
  await applyRepeat(tx, r, sum.amount, input.repeat, ctx);
  return updated!;
}

/** Кто подтверждает сдачу и подтверждение сдачи в учётной политике. */
export interface ReportConfirmContext extends ReportActionContext {
  confirmer: ReportConfirmer;
}

const CONFIRM_STATUS = {
  report_not_waiting: 409,
  report_confirm_right: 403,
  report_confirm_own: 403,
} as const;

/**
 * Подтвердить или вернуть можно (прототип repConfWhy); иначе — отказ. Прежняя версия не меняется
 * (ТЗ «Уточнённые отчёты», docs/decisions.md п. Б-3).
 */
function confirmable(r: ReportRecord, ctx: ReportConfirmContext): void {
  // ОТКЛОНЕНИЕ: docs/deviations.md#Б-7 (решение «А») — в прототипе прежнюю версию можно подтвердить и вернуть.
  if (r.superseded) throw new ReportStateError(r.id, 'superseded');
  const refusal = reportConfirmRefusal(
    { status: r.status, act: r.act, confirmed: r.confirmedAt !== null, submittedBy: r.submittedBy },
    ctx.confirmer,
    ctx.confirmOn,
  );
  if (refusal) throw new ReportRefusedError(r.id, refusal, CONFIRM_STATUS[refusal]);
}

/** Записать подтверждение сдачи одного отчёта. */
async function writeConfirm(
  tx: Tx,
  r: ReportRecord,
  note: string,
  fileId: string | null,
): Promise<ReportRecord> {
  const [updated] = await tx
    .update(reports)
    .set({
      confirmedAt: sql`now()`,
      confirmedBy: sql`app.current_user_id()`,
      confirmNote: note,
      ...bump(),
    })
    .where(eq(reports.id, r.id))
    .returning();
  await writeStatusChange(tx, {
    scale: 'report',
    entityId: r.id,
    from: 'submitted',
    to: 'confirmed',
    reason: note || null,
    fileId,
  });
  return updated!;
}

/**
 * «Подтвердить» сдачу (ТЗ «Подтверждение сдачи»: старший бухгалтер проверяет сдачу, комментарий
 * необязательный; прототип repConfDlg): отметка «Подтверждено», кто и когда; квитанция о приёме
 * обязательна, если так настроен вид и её нет среди файлов отчёта.
 */
export async function confirmReport(
  tx: Tx,
  id: string,
  input: { note: string; fileIds: readonly string[] },
  ctx: ReportConfirmContext & { version: number },
): Promise<ReportRecord> {
  const r = await lockCurrent(tx, id, ctx.version, ctx.scope);
  confirmable(r, ctx);
  const { ready, added } = await checkFiles(tx, r, input.fileIds);
  if (reportReceiptRequired(await reportTypeFiles(tx, r.reportTypeCode), ctx) && !ready.length) {
    throw new ReportRefusedError(id, 'report_receipt_required', 400, 'fileIds');
  }
  if (added.length) {
    await writeHistory(tx, {
      entity: 'report',
      entityId: id,
      action: 'update',
      changes: [{ field: 'files', to: added.map((f) => f.name) }],
      contractorId: r.contractorId,
    });
  }
  return writeConfirm(tx, r, input.note, added[0]?.id ?? null);
}

/**
 * Массовое «Подтвердить» во вкладке «Ожидают подтверждения» (прототип repConfDlg): свои сданные и не
 * ждущие подтверждения пропускаются, как и отчёты без файлов, которым нужна квитанция.
 */
export async function confirmReports(
  tx: Tx,
  items: readonly { id: string; version: number }[],
  note: string,
  ctx: ReportConfirmContext,
): Promise<ReportBatchResult> {
  const result: ReportBatchResult = { done: 0, skippedFile: 0, skipped: 0 };
  for (const item of byId(items)) {
    const r = await lockCurrent(tx, item.id, item.version, ctx.scope);
    try {
      confirmable(r, ctx);
    } catch (e) {
      if (!(e instanceof ReportRefusedError || e instanceof ReportStateError)) throw e;
      result.skipped++;
      continue;
    }
    if (reportReceiptRequired(await reportTypeFiles(tx, r.reportTypeCode), ctx)) {
      if ((await reportReadyFiles(tx, r.id)).length === 0) {
        result.skippedFile++;
        continue;
      }
    }
    await writeConfirm(tx, r, note, null);
    result.done++;
  }
  return result;
}

/**
 * «На исправление» (ТЗ: старший бухгалтер возвращает отчёт с обязательной причиной; прототип repFixDlg):
 * «Требует исправления», отчёт снова несданный, подтверждение снимается; причина — в «Истории
 * статусов», ответственный видит её в карточке. Сообщение ответственному в Telegram отправит задача
 * уведомлений (2.25).
 */
export async function returnReportForFix(
  tx: Tx,
  id: string,
  reason: string,
  ctx: ReportConfirmContext & { version: number },
): Promise<ReportRecord> {
  const r = await lockCurrent(tx, id, ctx.version, ctx.scope);
  confirmable(r, ctx);
  // Причина из одних пробелов и невидимых символов (U+200B и т. п.) — пустая, как у отката.
  if (!/[^\s\p{Cf}]/u.test(reason))
    throw new ReportRefusedError(id, 'report_fix_reason', 400, 'reason');
  return setStatus(tx, r, 'needs_fix', { reason, clear: CLEAR_CONFIRM });
}

/** Сменить статус отчёта с записью в «Историю статусов». */
async function setStatus(
  tx: Tx,
  r: ReportRecord,
  to: ReportStatus,
  o: { reason?: string | null; clear?: Partial<typeof CLEAR_SUBMIT> } = {},
): Promise<ReportRecord> {
  const [updated] = await tx
    .update(reports)
    .set({ status: to, ...o.clear, ...bump() })
    .where(eq(reports.id, r.id))
    .returning();
  await writeStatusChange(tx, {
    scale: 'report',
    entityId: r.id,
    from: r.status,
    to,
    reason: o.reason ?? null,
  });
  return updated!;
}

/** Шаги без окна: «Взять в работу», «Требует исправления» (орган не принял), «Не требуется». */
export type ReportStep = 'in_progress' | 'needs_fix' | 'not_required';

/**
 * Шаг из меню и шкалы (прототип reportActions, setStatus): «Взять в работу» — у «К сдаче» со сдачей;
 * «Требует исправления» — у сданного (орган не принял отчёт), подтверждение снимается; «Не требуется» —
 * у отчёта, который ещё не сдан окончательно (сданный, но ждущий подтверждения, — можно), поля сдачи
 * снимаются.
 */
export async function setReportStep(
  tx: Tx,
  id: string,
  to: ReportStep,
  ctx: ReportActionContext & { version: number },
): Promise<ReportRecord> {
  const r = await lockCurrent(tx, id, ctx.version, ctx.scope);
  if (r.superseded) throw new ReportStateError(id, 'superseded');
  const facts = { ...r, confirmed: r.confirmedAt !== null };
  const ok =
    to === 'in_progress'
      ? r.act !== 'pay' && r.status === 'todo'
      : to === 'needs_fix'
        ? r.act !== 'pay' && r.status === 'submitted'
        : reportNotRequiredAllowed(facts, ctx.confirmOn);
  if (!ok) {
    throw new ReportRefusedError(
      id,
      to === 'not_required' ? 'report_not_required_invalid' : 'report_step_invalid',
    );
  }
  const clear =
    to === 'needs_fix'
      ? CLEAR_CONFIRM
      : to === 'not_required' && r.status === 'submitted'
        ? CLEAR_SUBMIT
        : {};
  return setStatus(tx, r, to, { clear });
}

/**
 * Откат на один шаг (ТЗ «Откат статуса»: право «Откат статусов», причина; прототип rollbackDlg): у
 * подтверждённого — снять подтверждение («Подтверждено» → «Ждёт подтверждения»); у «Сдан» — в «В
 * работе» с датой сдачи; «Требует исправления» — снова «Сдан»; «В работе» и «Не требуется» — «К
 * сдаче». У прежней версии уточнённого — сначала откатить уточнённую. Право проверяет API.
 */
export async function rollbackReport(
  tx: Tx,
  id: string,
  input: { to: string; reason: string },
  ctx: ReportActionContext & { version: number },
): Promise<ReportRecord> {
  const r = await lockCurrent(tx, id, ctx.version, ctx.scope);
  const back = reportBack({ ...r, confirmed: r.confirmedAt !== null }, ctx.confirmOn);
  if (back && 'refusal' in back) throw new ReportRefusedError(id, back.refusal);
  if (!back) throw new ReportRefusedError(id, 'report_rollback_none');
  if (back.to !== input.to) throw new ReportRefusedError(id, 'report_step_invalid', 400, 'to');
  if (back.to === 'waiting') {
    const [updated] = await tx
      .update(reports)
      .set({ ...CLEAR_CONFIRM, ...bump() })
      .where(eq(reports.id, id))
      .returning();
    await writeStatusChange(tx, {
      scale: 'report',
      entityId: id,
      from: 'confirmed',
      to: 'waiting',
      rollback: true,
      reason: input.reason,
    });
    return updated!;
  }
  const [updated] = await tx
    .update(reports)
    .set({
      status: back.to as ReportStatus,
      ...(r.status === 'submitted' ? CLEAR_SUBMIT : {}),
      ...bump(),
    })
    .where(eq(reports.id, id))
    .returning();
  await writeStatusChange(tx, {
    scale: 'report',
    entityId: id,
    from: r.status,
    to: back.to,
    rollback: true,
    reason: input.reason,
  });
  return updated!;
}

/** Сданный отчёт ждёт подтверждения (прототип status-scale.js, repWait): не только уплата и без отметки. */
const waitingConfirm = () =>
  and(eq(reports.status, 'submitted'), sql`${reports.act} <> 'pay'`, isNull(reports.confirmedAt));

/**
 * Сколько отчётов организации ждут подтверждения — для вопроса «Выключить подтверждение сдачи?»
 * (прототип org.js, repConfSet): все отчёты, а не только видимые сотруднику, потому что выключение
 * подтверждает все.
 */
export async function countWaitingReports(tx: Tx): Promise<number> {
  const [row] = await tx.select({ n: count() }).from(reports).where(waitingConfirm());
  return row?.n ?? 0;
}

/**
 * Выключили «Сдача отчётов требует подтверждения» (ТЗ: отчёты, которые ждали подтверждения, считаются
 * подтверждёнными с записью в истории «Подтверждение выключено в учётной политике»; прототип org.js).
 * Возвращает, сколько отчётов подтверждено.
 */
export async function confirmWaitingReports(tx: Tx, reason: string): Promise<number> {
  const rows = await tx
    .update(reports)
    .set({
      confirmedAt: sql`now()`,
      confirmedBy: sql`app.current_user_id()`,
      confirmNote: reason,
      ...bump(),
    })
    .where(waitingConfirm())
    .returning({ id: reports.id });
  for (let i = 0; i < rows.length; i += 500) {
    await writeStatusChange(
      tx,
      ...rows.slice(i, i + 500).map((x) => ({
        scale: 'report' as const,
        entityId: x.id,
        from: 'submitted',
        to: 'confirmed',
        reason,
        cause: 'policy' as const,
      })),
    );
  }
  return rows.length;
}

/**
 * Включили «Сдача отчётов требует подтверждения» (прототип org.js, repConfSet): отчёты, сданные, пока
 * подтверждение было выключено, его не ждут — отметка «Подтверждено» без автора с пометкой «Сдан, когда
 * подтверждение было выключено» (запись «Истории статусов» не пишется, как в прототипе: изменение
 * политики — в её истории). Возвращает, сколько отчётов отмечено.
 */
export async function confirmSubmittedWhileOff(tx: Tx, note: string): Promise<number> {
  const rows = await tx
    .update(reports)
    .set({ confirmedAt: sql`now()`, confirmedBy: null, confirmNote: note, ...bump() })
    .where(waitingConfirm())
    .returning({ id: reports.id });
  return rows.length;
}

/** Запись истории отчёта для карточки: кто, когда, что изменено. */
export interface ReportHistoryItem {
  at: Date;
  actor: string | null;
  action: string;
  reason: string | null;
  changes: HistoryChange[];
}

/** Сдача в карточке: строки суммы, файлы, настройки вида, возврат на исправление, история. */
export interface ReportSubmitView {
  confirmNote: string;
  /** «Что уплачивается» вида. */
  payments: { name: string; authority: string; kbk: string }[];
  lines: ReportLine[];
  lineDefs: ReportLineDef[];
  files: { id: string; name: string }[];
  needFile: boolean;
  needReceipt: boolean;
  /** Повторяющаяся сумма действующего назначения; null — назначения нет (галочки нет). */
  repeat: { fixedAmount: Tyiyn | null } | null;
  /** Последний возврат «На исправление» или «Требует исправления»: кто, когда, причина. */
  fix: { at: Date; actor: string | null; reason: string | null } | null;
  history: ReportHistoryItem[];
}

const historyActor = alias(employees, 'report_history_actor');
const fixActor = alias(employees, 'report_fix_actor');

/** Что карточке отчёта нужно для сдачи и истории (прототип openReport, linesKv, repConfBox). */
export async function reportSubmitView(
  tx: Tx,
  id: string,
  t: Translate,
): Promise<ReportSubmitView> {
  const [r] = await tx.select().from(reports).where(eq(reports.id, id));
  if (!r) throw new RecordNotFoundError('report', id);
  const lines = await storedLines(tx, id);
  const [lineDefs, readyFiles, type, active, [fix], history, [kind]] = await Promise.all([
    reportLineDefs(tx, r, t, lines),
    reportReadyFiles(tx, id),
    reportTypeFiles(tx, r.reportTypeCode),
    reportHasAmount(r.act) ? assignmentOf(tx, r, true) : null,
    r.status === 'needs_fix'
      ? tx
          .select({
            at: statusHistory.at,
            actorUserId: statusHistory.actorUserId,
            actorName: fixActor.shortName,
            reason: statusHistory.reason,
          })
          .from(statusHistory)
          .leftJoin(fixActor, eq(fixActor.userId, statusHistory.actorUserId))
          .where(
            and(
              eq(statusHistory.scale, 'report'),
              eq(statusHistory.entityId, id),
              eq(statusHistory.toStatus, 'needs_fix'),
            ),
          )
          .orderBy(desc(statusHistory.at), desc(statusHistory.id))
          .limit(1)
      : [],
    tx
      .select({
        at: auditLog.at,
        actorUserId: auditLog.actorUserId,
        actorName: historyActor.shortName,
        action: auditLog.action,
        reason: auditLog.reason,
        changes: auditLog.changes,
      })
      .from(auditLog)
      .leftJoin(historyActor, eq(historyActor.userId, auditLog.actorUserId))
      .where(and(eq(auditLog.entity, 'report'), eq(auditLog.entityId, id)))
      .orderBy(desc(auditLog.at), desc(auditLog.id)),
    tx
      .select({ payments: reportTypes.payments })
      .from(reportTypes)
      .where(eq(reportTypes.code, r.reportTypeCode)),
  ]);
  // В справочнике вида — код органа (ОРГ-01); на экране — его название («ГНС»), как в прототипе.
  const codes = [...new Set((kind?.payments ?? []).map((p) => p.authority))];
  const organs = codes.length
    ? await tx
        .select({ code: authorities.code, name: authorities.name })
        .from(authorities)
        .where(inArray(authorities.code, codes))
    : [];
  const organ = new Map(organs.map((o) => [o.code, o.name]));
  const people = await employeeNames(
    tx,
    history.flatMap((h) =>
      ((h.changes ?? []) as HistoryChange[])
        .filter((c) => c.field === 'responsibleEmployeeId')
        .flatMap((c) => [c.from, c.to]),
    ),
  );
  /** «Ответственный: было → стало» — краткими именами сотрудников (прототип `empName`). */
  const named = (c: HistoryChange): HistoryChange =>
    c.field === 'responsibleEmployeeId' ? { ...c, from: people(c.from), to: people(c.to) } : c;
  return {
    confirmNote: r.confirmNote,
    payments: (kind?.payments ?? []).map((p) => ({
      name: p.name,
      authority: organ.get(p.authority) ?? p.authority,
      kbk: p.kbk,
    })),
    lines,
    lineDefs,
    files: readyFiles,
    needFile: type.needFile,
    needReceipt: type.needReceipt,
    repeat: active
      ? { fixedAmount: active.fixedAmount === null ? null : Number(active.fixedAmount) }
      : null,
    fix: fix
      ? { at: fix.at, actor: auditActorName(fix.actorUserId, fix.actorName), reason: fix.reason }
      : null,
    history: history.map((h) => ({
      at: h.at,
      actor: auditActorName(h.actorUserId, h.actorName),
      action: h.action,
      reason: h.reason,
      changes: ((h.changes ?? []) as HistoryChange[]).map(named),
    })),
  };
}

/** Краткие имена сотрудников по номерам из записей истории; не номер — null. */
async function employeeNames(tx: Tx, values: readonly unknown[]) {
  const ids = [...new Set(values.filter((v): v is string => typeof v === 'string'))];
  const rows = ids.length
    ? await tx
        .select({ id: employees.id, shortName: employees.shortName })
        .from(employees)
        .where(inArray(employees.id, ids))
    : [];
  const byId = new Map(rows.map((e) => [e.id, e.shortName]));
  return (v: unknown) => (typeof v === 'string' ? (byId.get(v) ?? null) : null);
}
