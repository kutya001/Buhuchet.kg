import type { IsoDate } from '../common/dates';
import { addMonths, monthRange, type YearMonth } from '../common/months';
import { ROLLBACK_REASON_MAX } from '../common/status';

/*
 * Обслуживание контрагента (задача 2.12; ТЗ «Контрагенты» → «Остановка и возобновление обслуживания»,
 * «Непостоянные контрагенты»; прототип core/org.js: inService, cpStatus, periodsText; modules/services.js:
 * applyService, pauseDlg, resumeDlg, unpauseCp, toRegularDlg; modules/contractors.js: archiveDlg,
 * unarchiveCp, cpActions; ui/status-scale.js: planPause, svcPlanNote, rollbackDlg('svc')).
 * Обслуживание — периоды «с месяца по месяц»: пауза — промежуток между ними, у последнего периода
 * конец пуст, пока обслуживание не приостановлено. Правила — без базы: на вход периоды и идущий месяц.
 * Одни и те же правила у кнопок экрана и у сервера.
 */

/** Период обслуживания: с месяца по месяц включительно; `to` пусто — обслуживается дальше. */
export interface ServicePeriod {
  from: YearMonth;
  to: YearMonth | null;
}

/** Статус обслуживания на шкале контрагента. */
export type ServiceState = 'active' | 'paused' | 'archived';

/** Контрагент глазами правил обслуживания. */
export interface ServiceSubject {
  archived: boolean;
  /** Разовый: периоды не ведутся, приостановки нет (прототип cpActions). */
  oneOff: boolean;
  periods: readonly ServicePeriod[];
}

/** Отказ правила: код — ключ словаря `err.<код>`. */
export type ServiceRefusal =
  | 'service_month_in_past'
  | 'service_resume_before_pause'
  | 'service_not_paused'
  | 'service_already_paused'
  | 'service_no_planned_pause'
  | 'service_fill_not_skipped';

/** Тексты отказов (прототип: тексты ошибок полей окон и подсказки пунктов меню). */
export const SERVICE_MESSAGES: Record<ServiceRefusal, string> = {
  service_month_in_past: 'Прошлые месяцы не меняются',
  service_resume_before_pause: 'Месяц возобновления должен быть позже месяца паузы',
  service_not_paused: 'Обслуживание не приостановлено',
  service_already_paused: 'Обслуживание уже приостановлено или приостановка запланирована',
  service_no_planned_pause: 'Запланированной приостановки нет',
  service_fill_not_skipped: 'Досоздать можно только за пропущенные месяцы',
};

/** Причина приостановки — не длиннее (как причина отката в «Истории статусов»). */
export const PAUSE_REASON_MAX = ROLLBACK_REASON_MAX;

export type ServiceResult =
  { ok: true; periods: ServicePeriod[] } | { ok: false; code: ServiceRefusal };

const last = <T>(xs: readonly T[]): T | undefined => xs[xs.length - 1];
const copy = (periods: readonly ServicePeriod[]) => periods.map((p) => ({ ...p }));
const refuse = (code: ServiceRefusal): { ok: false; code: ServiceRefusal } => ({ ok: false, code });

/** Обслуживается ли контрагент в месяце (прототип `inService`). */
export function inService(periods: readonly ServicePeriod[], month: YearMonth): boolean {
  return periods.some((p) => p.from <= month && (p.to === null || month <= p.to));
}

/**
 * Обслуживался ли контрагент хоть в одном месяце с `from` по `to` — период отчёта (квартал, полугодие,
 * год) относится к обслуживанию, если обслуживался хотя бы один его месяц (ТЗ «несданные отчёты за
 * месяцы, когда контрагент ещё обслуживался, остаются открытыми»). У месячного — `inService`.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#В-11 — прототип (applyService, archiveDlg) смотрит только на первый месяц периода.
export function servedWithin(
  periods: readonly ServicePeriod[],
  from: YearMonth,
  to: YearMonth,
): boolean {
  return periods.some((p) => p.from <= to && (p.to === null || from <= p.to));
}

/**
 * Статус обслуживания (прототип `cpStatus`): архив, обслуживается в идущем месяце или приостановлен.
 * Разовый не в архиве — «Обслуживается»: периодов у него нет (прототип addCpDlg), а приостановки не
 * бывает.
 */
export function serviceState(c: ServiceSubject, month: YearMonth): ServiceState {
  if (c.archived) return 'archived';
  if (c.oneOff) return 'active';
  return inService(c.periods, month) ? 'active' : 'paused';
}

/** «01.2026–10.2026, 05.2027–…» (прототип `periodsText`). */
export function periodsText(periods: readonly ServicePeriod[]): string {
  const m = (x: YearMonth) => `${x.slice(5, 7)}.${x.slice(0, 4)}`;
  return periods.map((p) => `${m(p.from)}–${p.to ? m(p.to) : '…'}`).join(', ');
}

/** Первый период обслуживания нового контрагента: постоянный — с месяца начала, разовый — без периодов. */
export function initialPeriods(oneOff: boolean, startDate: IsoDate): ServicePeriod[] {
  return oneOff ? [] : [{ from: startDate.slice(0, 7), to: null }];
}

/** Запланированная приостановка: ещё не началась (прототип `planPause`). */
export interface PlannedPause {
  /** С какого месяца приостановка. */
  from: YearMonth;
  /** С какого месяца возобновление, если оно уже задано. */
  resume: YearMonth | null;
}

/**
 * Запланированная приостановка: обслуживание идёт, но у периода уже есть конец не раньше идущего месяца
 * (с возобновлением — следующим периодом в будущем). Нет её или контрагент в архиве — null.
 */
export function plannedPause(
  c: Pick<ServiceSubject, 'archived' | 'periods'>,
  month: YearMonth,
): PlannedPause | null {
  const ps = c.periods;
  const l = last(ps);
  if (!l || c.archived) return null;
  const future = l.to === null && l.from > month && ps.length > 1;
  const prev = future ? ps[ps.length - 2]! : l;
  if (!prev.to || prev.to < month) return null;
  return { from: addMonths(prev.to, 1), resume: future ? l.from : null };
}

/**
 * Запланированное возобновление приостановленного: последний период начинается в будущем (прототип
 * `svcPlanNote`). У запланированной приостановки возобновление — в `plannedPause`.
 */
export function plannedResume(
  c: Pick<ServiceSubject, 'archived' | 'periods'>,
  month: YearMonth,
): YearMonth | null {
  if (c.archived || plannedPause(c, month) || inService(c.periods, month)) return null;
  const l = last(c.periods);
  return l && l.to === null && l.from > month ? l.from : null;
}

/** Пункты меню «…» обслуживания (прототип cpActions): какие показать, без учёта прав. */
export interface ServiceMenu {
  toRegular: boolean;
  /** «Отменить приостановку» — запланированная приостановка. */
  cancelPause: boolean;
  /** «Изменить возобновление: сейчас с …» — месяц запланированного возобновления. */
  changeResume: YearMonth | null;
  pause: boolean;
  resume: boolean;
  /** «Откатить приостановку» — действующая приостановка (шаг назад на шкале). */
  rollback: boolean;
  archive: boolean;
  unarchive: boolean;
}

/** Какие пункты обслуживания есть у контрагента в идущем месяце (прототип cpActions). */
export function serviceMenu(c: ServiceSubject, month: YearMonth): ServiceMenu {
  const none: ServiceMenu = {
    toRegular: false,
    cancelPause: false,
    changeResume: null,
    pause: false,
    resume: false,
    rollback: false,
    archive: false,
    unarchive: false,
  };
  if (c.archived) return { ...none, unarchive: true };
  if (c.oneOff) return { ...none, toRegular: true, archive: true };
  const pp = plannedPause(c, month);
  const l = last(c.periods);
  const future = !!l && l.to === null && l.from > month;
  return {
    ...none,
    cancelPause: !!pp,
    changeResume: future ? l.from : null,
    pause: !future && !!l && l.to === null && !pp,
    resume: !future && !(l && l.to === null) && !pp,
    rollback: !pp && serviceState(c, month) === 'paused',
    archive: true,
  };
}

/**
 * «Приостановить» (прототип `pauseDlg`, пункт меню — только у обслуживаемого без запланированной
 * приостановки): обслуживание прекращается с месяца `from` (не раньше идущего), возобновление —
 * необязательно и позже `from`. Период, который закончился бы раньше своего начала, пропадает
 * (приостановка с первого месяца обслуживания).
 */
export function pause(
  periods: readonly ServicePeriod[],
  from: YearMonth,
  resume: YearMonth | null,
  month: YearMonth,
): ServiceResult {
  if (from < month) return refuse('service_month_in_past');
  if (resume !== null && resume <= from) return refuse('service_resume_before_pause');
  const l = last(periods);
  if (!l || l.to !== null || l.from > month) return refuse('service_already_paused');
  const out = copy(periods);
  const cur = last(out)!;
  cur.to = addMonths(from, -1);
  if (cur.to < cur.from) out.pop();
  if (resume !== null) out.push({ from: resume, to: null });
  return { ok: true, periods: out };
}

/**
 * «Возобновить» и «Изменить возобновление» (прототип `resumeDlg`) с месяца `from` (не раньше идущего).
 * Запланированное возобновление переносится; возобновление сразу за концом прежнего периода продолжает
 * его. Обслуживаемому и с запланированной приостановкой без возобновления — отказ (сначала «Отменить
 * приостановку»).
 */
export function resume(
  periods: readonly ServicePeriod[],
  from: YearMonth,
  month: YearMonth,
): ServiceResult {
  if (from < month) return refuse('service_month_in_past');
  const pp = plannedPause({ archived: false, periods }, month);
  const out = copy(periods);
  const l = last(out);
  if (pp ? pp.resume === null : l && l.to === null && l.from <= month) {
    return refuse('service_not_paused');
  }
  if (l && l.to === null && l.from > month) {
    // Возобновление уже запланировано — меняется его месяц.
    l.from = from;
    const prev = out[out.length - 2];
    if (prev?.to && addMonths(prev.to, 1) >= from) {
      out.pop();
      prev.to = null;
    }
  } else if (l?.to && addMonths(l.to, 1) >= from) l.to = null;
  else out.push({ from, to: null });
  return { ok: true, periods: out };
}

/**
 * «Отменить приостановку» (прототип `unpauseCp`, право «Откат статусов»): запланированная приостановка
 * и её возобновление отменяются, обслуживание идёт без перерыва.
 */
export function cancelPlannedPause(
  c: Pick<ServiceSubject, 'archived' | 'periods'>,
  month: YearMonth,
): ServiceResult {
  const pp = plannedPause(c, month);
  if (!pp) return refuse('service_no_planned_pause');
  const out = copy(c.periods);
  if (pp.resume !== null) out.pop();
  last(out)!.to = null;
  return { ok: true, periods: out };
}

/**
 * Пропущенные месяцы действующей приостановки — с её начала по идущий (ТЗ «система показывает, какие
 * месяцы были пропущены»); приостановка с первого месяца обслуживания — только идущий.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#В-10 — при запланированном возобновлении прототип показывает только идущий месяц.
export function skippedMonths(periods: readonly ServicePeriod[], month: YearMonth): YearMonth[] {
  if (inService(periods, month)) return [];
  const ps = periods.filter((p) => p.from <= month);
  const l = last(ps);
  return l?.to && l.to < month ? monthRange(addMonths(l.to, 1), month) : [month];
}

/**
 * Откат действующей приостановки шагом назад на шкале (прототип `rollbackDlg('svc')`): обслуживание
 * продолжается без перерыва, запланированное возобновление отменяется. Приостановка с первого месяца
 * (периодов нет) — обслуживание с идущего месяца. Что досоздать за пропущенные месяцы
 * (`skippedMonths`), выбирает пользователь.
 */
export function rollbackPause(periods: readonly ServicePeriod[], month: YearMonth): ServiceResult {
  if (inService(periods, month)) return refuse('service_not_paused');
  if (!periods.length) return { ok: true, periods: [{ from: month, to: null }] };
  const out = copy(periods);
  let l = last(out)!;
  if (l.from > month && out.length > 1) {
    out.pop();
    l = last(out)!;
  }
  if (l.from > month) l.from = month;
  l.to = null;
  return { ok: true, periods: out };
}

/**
 * «В архив» (прототип `archiveDlg`): обслуживание заканчивается идущим месяцем, если шло дольше;
 * запланированное возобновление отменяется (у прототипа оно оставалось периодом с концом раньше начала).
 */
export function archivePeriods(
  periods: readonly ServicePeriod[],
  month: YearMonth,
): ServicePeriod[] {
  const out = copy(periods);
  if (out.length > 1 && last(out)!.from > month) out.pop();
  const l = last(out);
  if (l && (l.to === null || l.to > month)) l.to = month;
  if (l && l.to! < l.from) out.pop();
  return out;
}

/**
 * Возврат из архива (прототип `unarchiveCp`): обслуживание продолжается с идущего месяца; период,
 * который ещё не закончился, продолжается. У разового контрагента периоды не меняются.
 */
export function unarchivePeriods(
  periods: readonly ServicePeriod[],
  oneOff: boolean,
  month: YearMonth,
): ServicePeriod[] {
  const out = copy(periods);
  if (oneOff) return out;
  const l = last(out);
  if (l?.to && l.to >= month) l.to = null;
  else out.push({ from: month, to: null });
  return out;
}

/**
 * «Перевести в постоянное обслуживание» (прототип `toRegularDlg`) с месяца `from` (не раньше идущего):
 * открытый период разового закрывается месяцем раньше, обслуживание — с `from`.
 */
export function toRegularPeriods(
  periods: readonly ServicePeriod[],
  from: YearMonth,
  month: YearMonth,
): ServiceResult {
  if (from < month) return refuse('service_month_in_past');
  const out = copy(periods);
  const l = last(out);
  if (l && l.to === null) {
    if (l.from < from) l.to = addMonths(from, -1);
    else out.pop();
  }
  out.push({ from, to: null });
  return { ok: true, periods: out };
}

/** Отчёт глазами правил обслуживания. */
export interface ServiceReport {
  /** Месяц начала периода отчёта (прототип `ym(r.pkey)`). */
  month: YearMonth;
  /** Последний месяц периода отчёта (у месячного — тот же). */
  last: YearMonth;
  /** Срок сдачи. */
  due: IsoDate;
  /** Открыт (не сдан, прототип OPEN), «Не требуется» или другой. */
  status: 'open' | 'not_required' | 'other';
  /** Сдан (есть дата сдачи). */
  submitted: boolean;
  /** У вида есть действующее назначение, и период не позже «до какого периода». */
  assigned: boolean;
  /** «Не требуется» поставила приостановка или архив, а не пользователь и не снятие назначения. */
  byService: boolean;
}

/** Дата за `days` дней до `date`. */
function daysBefore(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Что станет с отчётом после изменения периодов (прототип `applyService`): открытый отчёт за период вне
 * обслуживания (`servedWithin`) со сроком не старше месяца назад — «Не требуется»; «Не требуется» от
 * приостановки или архива за период обслуживания с действующим назначением, несданный и со сроком не в
 * прошлом — снова «К сдаче» (не у архивного). Остальные — без изменений (null).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#В-9 — «Не требуется», поставленное вручную, не возвращается (прототип возвращает).
export function reportAfterServiceChange(
  r: ServiceReport,
  c: Pick<ServiceSubject, 'archived' | 'periods'>,
  today: IsoDate,
): 'not_required' | 'to_submit' | null {
  const served = servedWithin(c.periods, r.month, r.last);
  if (!served && r.status === 'open' && r.due >= daysBefore(today, 31)) return 'not_required';
  if (
    served &&
    r.status === 'not_required' &&
    r.byService &&
    r.assigned &&
    !r.submitted &&
    r.due >= today &&
    !c.archived
  ) {
    return 'to_submit';
  }
  return null;
}

/**
 * Отчёт при отправке в архив (прототип `archiveDlg`; ТЗ «несданные отчёты за периоды после окончания
 * обслуживания получают статус «Не требуется»; …за месяцы, когда контрагент ещё обслуживался, остаются
 * открытыми»): открытый, срок не прошёл, ни один месяц периода не обслуживается после архива.
 */
export function notRequiredOnArchive(
  r: Pick<ServiceReport, 'month' | 'last' | 'due' | 'status'>,
  periodsAfter: readonly ServicePeriod[],
  today: IsoDate,
): boolean {
  return r.status === 'open' && r.due >= today && !servedWithin(periodsAfter, r.month, r.last);
}

/**
 * Отчёт за пропущенный месяц, отмеченный при откате приостановки «досоздать» (месяц входит в период
 * отчёта): «Не требуется» от приостановки с действующим назначением снова «К сдаче», даже если срок
 * прошёл (ТЗ «предлагает досоздать за них … отчёты»).
 */
export function restoredOnFill(r: Omit<ServiceReport, 'due'>, fill: readonly YearMonth[]): boolean {
  return (
    fill.some((m) => r.month <= m && m <= r.last) &&
    r.status === 'not_required' &&
    r.byService &&
    r.assigned &&
    !r.submitted
  );
}
