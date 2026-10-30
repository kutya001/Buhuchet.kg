import {
  addMonths,
  archivePeriods,
  cancelPlannedPause,
  formatText,
  inService,
  monthLabelGen,
  notRequiredOnArchive,
  periodEnd,
  OPEN_REPORT_STATUSES,
  pause,
  periodsText,
  RecordChangedError,
  RecordNotFoundError,
  reportAfterServiceChange,
  restoredOnFill,
  resume,
  rollbackPause,
  serviceState,
  skippedMonths,
  toRegularPeriods,
  unarchivePeriods,
  type ContractorGkedConfirmation,
  type HistoryChange,
  type HistoryValue,
  type IsoDate,
  type ReportStatus,
  type ServicePeriod,
  type ServiceRefusal,
  type ServiceState,
  type TariffPeriod,
  type YearMonth,
} from '@buhuchet/domain';
import { and, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { Tx } from './client';
import { writeHistory } from './history';
import {
  ContractorArchivedError,
  ContractorOneOffError,
  createDueReports,
  createMonthReports,
} from './reports';
import { assignments, contractors, contractorTariffs, reports } from './schema';
import { servicePeriodsOf, writeServicePeriods, type ServicePeriodRow } from './service-periods';
import { readStatusHistory, writeStatusChange, type StatusHistoryItem } from './status';

/*
 * Обслуживание контрагента (задача 2.12; ТЗ «Остановка и возобновление обслуживания», «Непостоянные
 * контрагенты»): «Приостановить», «Возобновить» и «Изменить возобновление», «Отменить приостановку»,
 * откат приостановки, «В архив», «Вернуть из архива», «Перевести в постоянное обслуживание». Периоды
 * собирают правила `@buhuchet/domain` (contractors/service.ts); здесь — одна транзакция: периоды,
 * статус и версия контрагента, «История статусов» контрагента и его отчётов, история изменений и
 * отчёты, которые теперь нужны.
 */

/** Действие правила обслуживания отказало (код — `ServiceRefusal`). */
export class ServiceRefusedError extends Error {
  constructor(readonly code: ServiceRefusal) {
    super(`contractor service: ${code}`);
    this.name = 'ServiceRefusedError';
  }
}

/** «Вернуть из архива» у контрагента не в архиве. */
export class ContractorNotArchivedError extends Error {
  constructor(readonly contractorId: string) {
    super(`contractors: ${contractorId} не в архиве`);
    this.name = 'ContractorNotArchivedError';
  }
}

/** «Перевести в постоянное обслуживание» у постоянного. */
export class ContractorRegularError extends Error {
  constructor(readonly contractorId: string) {
    super(`contractors: ${contractorId} уже на постоянном обслуживании`);
    this.name = 'ContractorRegularError';
  }
}

/** Действие с обслуживанием. Месяцы — «2026-11». */
export type ServiceAction =
  | { kind: 'pause'; from: YearMonth; resume: YearMonth | null; reason: string }
  | { kind: 'resume'; from: YearMonth }
  | { kind: 'cancel_pause' }
  | { kind: 'rollback'; reason: string; fill: readonly YearMonth[] }
  | { kind: 'archive' }
  | { kind: 'unarchive' }
  | {
      kind: 'to_regular';
      from: YearMonth;
      /** undefined — режим не меняется. */
      regimeCode?: string | null;
      /** Подтверждение права на режим по ГКЭД после проверки; undefined — не меняется. */
      gkedConfirmation?: ContractorGkedConfirmation | null;
      /** Ставка с месяца начала; null — без ставки (нет права «Видеть плату за обслуживание»). */
      tariff: { amount: number; period: TariffPeriod; note: string } | null;
    };

/** Тексты, которые система пишет причиной в «Историю статусов». */
export interface ServiceTexts {
  /** Контрагента: «С {month}», «С {month}, возобновление с {resume}». */
  pausedFrom: string;
  pausedFromResume: string;
  /** «Причина: {reason}» — после текста приостановки. */
  pauseReason: string;
  /** Контрагента: «Возобновление с {month}». */
  resumedFrom: string;
  /** Контрагента: «Постоянное обслуживание с {month}». */
  regularFrom: string;
  /** Отчёта: «Не требуется» от приостановки и от архива, «К сдаче» после возобновления. */
  reportPaused: string;
  reportArchived: string;
  reportResumed: string;
  /** Отчёта, досозданного или возвращённого при откате приостановки за отмеченный месяц. */
  reportFilled: string;
}

/** Что действие сделало с отчётами. */
export interface ServiceEffect {
  /** Стали «Не требуется». */
  notRequired: number;
  /** Вернулись в «К сдаче». */
  restored: number;
  /** Созданы (на сегодня и за отмеченные месяцы). */
  created: number;
  /** Открытых отчётов у контрагента после действия (прототип unarchiveCp: «открытых отчётов: N»). */
  open: number;
}

const fill = (text: string, params: Record<string, string>) => formatText(text, params);

/** Контрагент для действия: в области, заблокирован до конца транзакции, с периодами. */
async function lockSubject(tx: Tx, id: string, scope: SQL | undefined) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new RecordNotFoundError('contractor', id);
  }
  const [row] = await tx
    .select({
      id: contractors.id,
      orgId: contractors.orgId,
      kind: contractors.kind,
      serviceStatus: contractors.serviceStatus,
      startDate: contractors.startDate,
      regimeCode: contractors.regimeCode,
      gkedConfirmation: contractors.gkedConfirmation,
      version: contractors.version,
    })
    .from(contractors)
    .where(and(eq(contractors.id, id), scope))
    .for('update');
  if (!row) throw new RecordNotFoundError('contractor', id);
  const periods = (await servicePeriodsOf(tx, [id])).get(id)!;
  return { ...row, periods };
}

type Subject = Awaited<ReturnType<typeof lockSubject>>;

/** Периоды из правила с причинами приостановки прежних периодов (по месяцу начала). */
const withReasons = (
  next: readonly ServicePeriod[],
  before: readonly ServicePeriodRow[],
): ServicePeriodRow[] =>
  next.map((p) => ({
    ...p,
    pauseReason:
      (p.to && before.find((b) => b.from === p.from && b.to === p.to)?.pauseReason) || '',
  }));

const unwrap = (
  r: { ok: true; periods: ServicePeriod[] } | { ok: false; code: ServiceRefusal },
) => {
  if (!r.ok) throw new ServiceRefusedError(r.code);
  return r.periods;
};

/** Новые периоды и что ещё меняется у контрагента. */
function plan(
  cp: Subject,
  action: ServiceAction,
  month: YearMonth,
): {
  periods: ServicePeriodRow[];
  archived: boolean;
  oneOff: boolean;
  set: Partial<typeof contractors.$inferInsert>;
} {
  const archived = cp.serviceStatus === 'archived';
  const oneOff = cp.kind === 'oneoff';
  if (action.kind === 'unarchive') {
    if (!archived) throw new ContractorNotArchivedError(cp.id);
    return {
      periods: withReasons(unarchivePeriods(cp.periods, oneOff, month), cp.periods),
      archived: false,
      oneOff,
      set: {},
    };
  }
  if (archived) throw new ContractorArchivedError(cp.id);
  if (action.kind === 'archive') {
    return {
      periods: withReasons(archivePeriods(cp.periods, month), cp.periods),
      archived: true,
      oneOff,
      set: {},
    };
  }
  if (action.kind === 'to_regular') {
    if (!oneOff) throw new ContractorRegularError(cp.id);
    const start = `${action.from}-01`;
    return {
      periods: withReasons(unwrap(toRegularPeriods(cp.periods, action.from, month)), cp.periods),
      archived: false,
      oneOff: false,
      set: {
        kind: 'regular',
        // Прототип toRegularDlg: «if(c.start.slice(0,7)<f)c.start=f+'-01'».
        ...(cp.startDate < start ? { startDate: start } : {}),
        ...(action.regimeCode !== undefined ? { regimeCode: action.regimeCode } : {}),
        ...(action.gkedConfirmation !== undefined
          ? { gkedConfirmation: action.gkedConfirmation }
          : {}),
      },
    };
  }
  if (oneOff) throw new ContractorOneOffError(cp.id);
  const subject = { archived: false, periods: cp.periods };
  switch (action.kind) {
    case 'pause': {
      const next = withReasons(
        unwrap(pause(cp.periods, action.from, action.resume, month)),
        cp.periods,
      );
      // Причина — у периода, который закончился перед приостановкой.
      const ended = next.find(
        (p) =>
          p.to !== null &&
          p.to < action.from &&
          !cp.periods.some((b) => b.from === p.from && b.to === p.to),
      );
      if (ended) ended.pauseReason = action.reason;
      return { periods: next, archived: false, oneOff, set: {} };
    }
    case 'resume':
      return {
        periods: withReasons(unwrap(resume(cp.periods, action.from, month)), cp.periods),
        archived: false,
        oneOff,
        set: {},
      };
    case 'cancel_pause':
      return {
        periods: withReasons(unwrap(cancelPlannedPause(subject, month)), cp.periods),
        archived: false,
        oneOff,
        set: {},
      };
    case 'rollback': {
      const skipped = skippedMonths(cp.periods, month);
      const next = withReasons(unwrap(rollbackPause(cp.periods, month)), cp.periods);
      if (action.fill.some((m) => !skipped.includes(m))) {
        throw new ServiceRefusedError('service_fill_not_skipped');
      }
      return { periods: next, archived: false, oneOff, set: {} };
    }
  }
}

/** Отчёт контрагента глазами правил обслуживания (последние версии, не сданные и «Не требуется»). */
async function lockServiceReports(tx: Tx, contractorId: string) {
  return tx
    .select({
      id: reports.id,
      status: reports.status,
      period: reports.period,
      periodStart: reports.periodStart,
      eventDate: reports.eventDate,
      dueDate: reports.dueDate,
      submittedOn: reports.submittedOn,
      // Столбцы отчёта — с именем таблицы: в подзапросах есть свои id и contractor_id.
      assigned: sql<boolean>`exists (select 1 from ${assignments} a where a.contractor_id = "reports"."contractor_id" and a.report_type_code = "reports"."report_type_code" and a.ended_on is null and (a.until_month is null or "reports"."period_start" <= a.until_month))`,
      // «Не требуется» поставила приостановка или архив: последняя смена статуса отчёта — с этой причиной.
      byService: sql<boolean>`coalesce((select sh.cause = 'service' from status_history sh where sh.scale = 'report' and sh.entity_id = "reports"."id" order by sh.at desc, sh.id desc limit 1), false)`,
    })
    .from(reports)
    .where(
      and(
        eq(reports.contractorId, contractorId),
        eq(reports.superseded, false),
        inArray(reports.status, ['todo', 'in_progress', 'needs_fix', 'not_required']),
      ),
    )
    .orderBy(reports.periodStart, reports.id)
    .for('update', { of: [reports] });
}

/** Сменить статус отчётов системой с записью «Истории статусов». */
async function setReportStatuses(
  tx: Tx,
  rows: readonly { id: string; status: ReportStatus }[],
  to: ReportStatus,
  reason: string,
  cause: 'service' | null,
): Promise<void> {
  if (rows.length === 0) return;
  await tx
    .update(reports)
    .set({
      status: to,
      version: sql`${reports.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(
      inArray(
        reports.id,
        rows.map((r) => r.id),
      ),
    );
  await writeStatusChange(
    tx,
    ...rows.map((r) => ({
      scale: 'report' as const,
      entityId: r.id,
      from: r.status,
      to,
      reason,
      cause,
    })),
  );
}

/** Отчёты после изменения периодов (прототип applyService и archiveDlg). */
async function applyToReports(
  tx: Tx,
  cp: { id: string; archived: boolean; periods: readonly ServicePeriod[] },
  context: { action: ServiceAction; today: IsoDate; texts: ServiceTexts },
): Promise<Pick<ServiceEffect, 'notRequired' | 'restored'>> {
  const { action, today, texts } = context;
  const rows = await lockServiceReports(tx, cp.id);
  const off: typeof rows = [];
  const on: typeof rows = [];
  const filled: typeof rows = [];
  for (const r of rows) {
    const report = {
      month: r.periodStart.slice(0, 7),
      last: periodEnd({ period: r.period, start: r.periodStart, event: r.eventDate }).slice(0, 7),
      due: r.dueDate,
      status: OPEN_REPORT_STATUSES.has(r.status)
        ? ('open' as const)
        : r.status === 'not_required'
          ? ('not_required' as const)
          : ('other' as const),
      submitted: r.submittedOn !== null,
      assigned: r.assigned,
      byService: r.byService,
    };
    if (action.kind === 'archive') {
      if (notRequiredOnArchive(report, cp.periods, today)) off.push(r);
      continue;
    }
    if (action.kind === 'rollback' && restoredOnFill(report, action.fill)) {
      filled.push(r);
      continue;
    }
    const next = reportAfterServiceChange(report, cp, today);
    if (next === 'not_required') off.push(r);
    else if (next === 'to_submit') on.push(r);
  }
  await setReportStatuses(
    tx,
    off,
    'not_required',
    action.kind === 'archive' ? texts.reportArchived : texts.reportPaused,
    'service',
  );
  await setReportStatuses(tx, on, 'todo', texts.reportResumed, null);
  await setReportStatuses(tx, filled, 'todo', texts.reportFilled, null);
  return { notRequired: off.length, restored: on.length + filled.length };
}

/** Причина смены статуса контрагента в «Истории статусов». */
function statusReason(action: ServiceAction, to: ServiceState, texts: ServiceTexts): string | null {
  switch (action.kind) {
    case 'pause': {
      const base = action.resume
        ? fill(texts.pausedFromResume, {
            month: monthLabelGen(action.from),
            resume: monthLabelGen(action.resume),
          })
        : fill(texts.pausedFrom, { month: monthLabelGen(action.from) });
      return action.reason
        ? `${base}. ${fill(texts.pauseReason, { reason: action.reason })}`
        : base;
    }
    case 'resume':
      return fill(texts.resumedFrom, { month: monthLabelGen(action.from) });
    case 'rollback':
      return action.reason;
    case 'to_regular':
      return to === 'paused'
        ? fill(texts.regularFrom, { month: monthLabelGen(action.from) })
        : null;
    default:
      return null;
  }
}

/**
 * Выполнить действие с обслуживанием контрагента в области `scope` (вне области — «не найден»):
 * `version` — версия, с которой открыто окно (устарела — «изменено другим пользователем»); у «В архив»
 * из списка — без версии. Правило отказало — `ServiceRefusedError`, архивного не меняет —
 * `ContractorArchivedError`, разовому нет приостановки — `ContractorOneOffError`.
 */
export async function changeService(
  tx: Tx,
  contractorId: string,
  action: ServiceAction,
  context: {
    today: IsoDate;
    scope: SQL | undefined;
    version: number | null;
    texts: ServiceTexts;
  },
): Promise<ServiceEffect> {
  const { today, texts } = context;
  const month = today.slice(0, 7);
  const cp = await lockSubject(tx, contractorId, context.scope);
  if (context.version !== null && context.version !== cp.version) {
    throw new RecordChangedError('contractor', contractorId, cp.version);
  }
  const next = plan(cp, action, month);
  // Статус в базе (его сверяет с периодами задача по расписанию) — «было» в истории статусов.
  const before = cp.serviceStatus as ServiceState;
  const after = serviceState(next, month);

  await writeServicePeriods(tx, cp.orgId, contractorId, next.periods);
  await tx
    .update(contractors)
    .set({
      ...next.set,
      serviceStatus: after,
      version: sql`${contractors.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: sql`app.current_user_id()`,
    })
    .where(eq(contractors.id, contractorId));
  if (action.kind === 'to_regular' && action.tariff) {
    await tx.insert(contractorTariffs).values({
      orgId: cp.orgId,
      contractorId,
      amount: action.tariff.amount,
      period: action.tariff.period,
      validFrom: `${action.from}-01`,
      note: action.tariff.note,
      createdBy: sql`app.current_user_id()`,
    });
  }
  if (after !== before) {
    await writeStatusChange(tx, {
      scale: 'service',
      entityId: contractorId,
      from: before,
      to: after,
      reason: statusReason(action, after, texts),
      rollback: action.kind === 'rollback',
    });
  }
  await writeHistory(tx, {
    entity: 'contractor',
    entityId: contractorId,
    action: 'update',
    contractorId,
    changes: historyChanges(cp, next, action, before, after),
    reason: action.kind === 'pause' || action.kind === 'rollback' ? action.reason || null : null,
  });

  const reportsEffect = next.oneOff
    ? { notRequired: 0, restored: 0 }
    : await applyToReports(
        tx,
        { id: contractorId, archived: next.archived, periods: next.periods },
        { action, today, texts },
      );
  let created = 0;
  if (!next.archived && !next.oneOff) {
    created += await createDueReports(tx, { today, contractorIds: [contractorId] });
    if (action.kind === 'rollback' && action.fill.length) {
      const fresh = await createMonthReports(tx, {
        contractorId,
        months: action.fill,
        today,
      });
      created += fresh;
    }
  }
  const [{ open }] = (await tx
    .select({ open: sql<number>`count(*)::int` })
    .from(reports)
    .where(
      and(
        eq(reports.contractorId, contractorId),
        eq(reports.superseded, false),
        inArray(reports.status, [...OPEN_REPORT_STATUSES]),
      ),
    )) as [{ open: number }];
  return { ...reportsEffect, created, open };
}

/** Что пишется в историю контрагента: периоды словами, статус и поля перевода в постоянное. */
function historyChanges(
  cp: Subject,
  next: ReturnType<typeof plan>,
  action: ServiceAction,
  before: ServiceState,
  after: ServiceState,
): HistoryChange[] {
  const out: HistoryChange[] = [];
  const was = periodsText(cp.periods);
  const now = periodsText(next.periods);
  if (was !== now) out.push({ field: 'servicePeriods', from: was || null, to: now || null });
  if (before !== after) out.push({ field: 'serviceStatus', from: before, to: after });
  if (action.kind === 'pause') {
    out.push({ field: 'pause', to: { from: action.from, resume: action.resume } });
  }
  if (action.kind === 'rollback' && action.fill.length) {
    out.push({ field: 'serviceFill', to: [...action.fill] });
  }
  for (const [field, value] of Object.entries(next.set)) {
    const from = (cp as Record<string, unknown>)[field] ?? null;
    if (JSON.stringify(from) === JSON.stringify(value ?? null)) continue;
    out.push({ field, from: from as HistoryValue, to: (value ?? null) as HistoryValue });
  }
  if (action.kind === 'to_regular' && action.tariff) {
    out.push({
      field: 'tariff',
      to: {
        amount: action.tariff.amount,
        period: action.tariff.period,
        validFrom: `${action.from}-01`,
      },
    });
  }
  // «Отменить приостановку» — запись «Приостановка отменена» (ТЗ: «в истории остаётся запись»).
  if (action.kind === 'cancel_pause') out.push({ field: 'pauseCancelled', to: true });
  return out;
}

/** Сколько контрагентов сменили статус при сверке статусов с периодами. */
export interface ServiceSyncResult {
  paused: number;
  resumed: number;
}

/**
 * Статус обслуживания по периодам в идущем месяце (задача по расписанию): наступил месяц
 * запланированной приостановки или возобновления — статус меняется системой с записью «Истории
 * статусов» (причина приостановки — та, что ввели в окне). Архивные и разовые не меняются; повтор
 * ничего не меняет.
 */
export async function syncServiceStatuses(
  tx: Tx,
  options: {
    today: IsoDate;
    texts: Pick<ServiceTexts, 'pausedFrom' | 'pausedFromResume' | 'pauseReason' | 'resumedFrom'>;
  },
): Promise<ServiceSyncResult> {
  const month = options.today.slice(0, 7);
  const rows = await tx
    .select({
      id: contractors.id,
      status: contractors.serviceStatus,
      version: contractors.version,
    })
    .from(contractors)
    .where(and(ne(contractors.serviceStatus, 'archived'), eq(contractors.kind, 'regular')));
  const periods = await servicePeriodsOf(
    tx,
    rows.map((r) => r.id),
  );
  const result: ServiceSyncResult = { paused: 0, resumed: 0 };
  for (const r of rows) {
    const ps = periods.get(r.id)!;
    const now: ServiceState = inService(ps, month) ? 'active' : 'paused';
    if (now === r.status) continue;
    // Только у тех, кого не изменили одновременно: действие с обслуживанием меняет версию, и периоды,
    // прочитанные задачей, были бы устаревшими (следующий запуск сверит по свежим).
    const changed = await tx
      .update(contractors)
      .set({
        serviceStatus: now,
        version: sql`${contractors.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(contractors.id, r.id), eq(contractors.version, r.version)))
      .returning({ id: contractors.id });
    if (changed.length === 0) continue;
    let reason: string;
    if (now === 'paused') {
      const ended = ps.filter((p) => p.to !== null && p.to < month).at(-1);
      const start = ended ? addMonths(ended.to!, 1) : month;
      const next = ps.find((p) => p.from > month);
      reason = next
        ? fill(options.texts.pausedFromResume, {
            month: monthLabelGen(start),
            resume: monthLabelGen(next.from),
          })
        : fill(options.texts.pausedFrom, { month: monthLabelGen(start) });
      if (ended?.pauseReason) {
        reason += `. ${fill(options.texts.pauseReason, { reason: ended.pauseReason })}`;
      }
      result.paused++;
    } else {
      reason = fill(options.texts.resumedFrom, { month: monthLabelGen(month) });
      result.resumed++;
    }
    await writeStatusChange(tx, {
      scale: 'service',
      entityId: r.id,
      from: r.status,
      to: now,
      reason,
    });
  }
  return result;
}

/** Обслуживание контрагента для карточки: статус, периоды, версия и «История статусов» шкалы. */
export interface ContractorServiceRecord {
  id: string;
  kind: 'regular' | 'oneoff';
  status: ServiceState;
  periods: ServicePeriod[];
  version: number;
  history: StatusHistoryItem[];
}

/** Обслуживание контрагента в области `scope`; null — нет или вне области. */
export async function getContractorService(
  tx: Tx,
  id: string,
  scope: SQL | undefined,
): Promise<ContractorServiceRecord | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const [row] = await tx
    .select({
      id: contractors.id,
      kind: contractors.kind,
      status: contractors.serviceStatus,
      version: contractors.version,
    })
    .from(contractors)
    .where(and(eq(contractors.id, id), scope));
  if (!row) return null;
  const [periods, history] = await Promise.all([
    servicePeriodsOf(tx, [id]),
    readStatusHistory(tx, 'service', id),
  ]);
  return {
    ...row,
    status: row.status as ServiceState,
    periods: periods.get(id)!.map(({ from, to }) => ({ from, to })),
    history,
  };
}
