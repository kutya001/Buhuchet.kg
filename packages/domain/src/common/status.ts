/**
 * Шкалы статусов (ТЗ «Общие элементы интерфейса» → «Шкала статусов», «История статусов»; прототип
 * ui/status-scale.js: `SCALES`, `scPos`, `scNext`, `scBack`, `statusHist`, `durTxt`) — один движок для
 * всех записей со статусом. Статус — код, как в базе (`todo`, `in_progress`, …); название — из словаря
 * (`status.<шкала>.<код>`), цвет и значок — справочник «Статусы» (refDB.json `statuses`).
 * Что ставит статус и какие у шага условия (оплата, уточнённая версия, закрытый месяц) — в модулях.
 */
import { pluralForm } from './list';
import type { UiTextKey } from '../l10n/texts';

/** Шкалы: сдача отчёта, оплата налога, задача, обслуживание контрагента, проект, месяц показателей. */
export const STATUS_SCALES = [
  'report',
  'payment',
  'task',
  'service',
  'project',
  'indicator',
] as const;
export type StatusScaleKey = (typeof STATUS_SCALES)[number];

/** Цвета статусов справочника «Статусы» (прототип `.sc-<цвет>`, `.pill.<цвет>`). */
export const STATUS_TONES = [
  'gray',
  'blue',
  'yellow',
  'green',
  'orange',
  'red',
  'purple',
  'faint',
] as const;
export type StatusTone = (typeof STATUS_TONES)[number];

/** Цвет и значок статуса (значок — имя из набора значков интерфейса). */
export interface StatusLook {
  tone: StatusTone;
  icon: string;
}

/** Боковой статус — отметка на шаге шкалы, а не отдельный шаг; `at` < 0 — от конца шкалы. */
export interface SideStatus {
  at: number;
  tone: 'red' | 'faint';
}

export interface StatusScaleDef {
  /** Шаги по порядку. */
  steps: readonly string[];
  /** Шаги с подтверждением (задача «Требуется подтверждение»). */
  stepsConfirm?: readonly string[];
  side?: Readonly<Record<string, SideStatus>>;
  /** Нейтральные статусы: серая надпись вместо шкалы («Не требуется»). */
  none?: readonly string[];
  /** Отметки на последнем шаге — не шаг и не боковой статус («Ждёт подтверждения», «Подтверждено»). */
  marks?: readonly string[];
  /** Все статусы шкалы: цвет и значок по умолчанию (refDB.json `statuses`). */
  look: Readonly<Record<string, StatusLook>>;
}

/**
 * Шкалы по умолчанию (ТЗ «Шкала статусов» → «Шкалы по умолчанию»). Шага «Принят» у отчёта нет:
 * подтверждение сдачи — отметка на шаге «Сдан» (решение заказчика 24.10.2026).
 */
export const STATUS_SCALE_DEFS: Readonly<Record<StatusScaleKey, StatusScaleDef>> = {
  report: {
    steps: ['todo', 'in_progress', 'submitted'],
    side: { needs_fix: { at: 2, tone: 'red' } },
    none: ['not_required'],
    marks: ['waiting', 'confirmed'],
    look: {
      todo: { tone: 'gray', icon: 'circle' },
      in_progress: { tone: 'blue', icon: 'clock' },
      submitted: { tone: 'green', icon: 'check' },
      waiting: { tone: 'yellow', icon: 'hourglass' },
      confirmed: { tone: 'green', icon: 'ok' },
      needs_fix: { tone: 'orange', icon: 'alert' },
      not_required: { tone: 'faint', icon: 'ban' },
    },
  },
  payment: {
    steps: ['unpaid', 'partial', 'paid'],
    none: ['not_required'],
    look: {
      unpaid: { tone: 'gray', icon: 'circle' },
      partial: { tone: 'yellow', icon: 'half' },
      paid: { tone: 'green', icon: 'check' },
      not_required: { tone: 'faint', icon: 'ban' },
    },
  },
  task: {
    steps: ['todo', 'in_progress', 'done'],
    stepsConfirm: ['todo', 'in_progress', 'on_confirm', 'confirmed'],
    side: {
      rework: { at: 1, tone: 'red' },
      failed: { at: -1, tone: 'red' },
      cancelled: { at: -1, tone: 'faint' },
    },
    look: {
      todo: { tone: 'gray', icon: 'circle' },
      in_progress: { tone: 'blue', icon: 'clock' },
      rework: { tone: 'red', icon: 'refresh' },
      on_confirm: { tone: 'purple', icon: 'hourglass' },
      confirmed: { tone: 'green', icon: 'check' },
      done: { tone: 'green', icon: 'ok' },
      failed: { tone: 'orange', icon: 'x' },
      cancelled: { tone: 'faint', icon: 'ban' },
    },
  },
  service: {
    steps: ['active', 'paused', 'archived'],
    look: {
      active: { tone: 'green', icon: 'check' },
      paused: { tone: 'yellow', icon: 'pause' },
      archived: { tone: 'faint', icon: 'archive' },
    },
  },
  project: {
    steps: ['planned', 'in_progress', 'done'],
    side: { cancelled: { at: 2, tone: 'faint' } },
    look: {
      planned: { tone: 'blue', icon: 'clock' },
      in_progress: { tone: 'yellow', icon: 'hourglass' },
      done: { tone: 'green', icon: 'check' },
      cancelled: { tone: 'faint', icon: 'ban' },
    },
  },
  indicator: {
    steps: ['empty', 'filled', 'checked'],
    look: {
      empty: { tone: 'orange', icon: 'alert' },
      filled: { tone: 'blue', icon: 'check' },
      checked: { tone: 'green', icon: 'ok' },
    },
  },
};

/** Все статусы шкалы (шаги, боковые, нейтральные, отметки) — по порядку справочника. */
export function scaleStatuses(scale: StatusScaleKey): string[] {
  return Object.keys(STATUS_SCALE_DEFS[scale].look);
}

export function isScaleStatus(scale: StatusScaleKey, status: string): boolean {
  return Object.hasOwn(STATUS_SCALE_DEFS[scale].look, status);
}

/** Цвет и значок статуса; неизвестный статус — серый кружок (прототип `pill`). */
export function statusLook(scale: StatusScaleKey, status: string): StatusLook {
  return isScaleStatus(scale, status)
    ? STATUS_SCALE_DEFS[scale].look[status]!
    : { tone: 'gray', icon: 'circle' };
}

/** Нейтральный статус: шкала не ведётся. */
export function isNoScale(scale: StatusScaleKey, status: string): boolean {
  return STATUS_SCALE_DEFS[scale].none?.includes(status) ?? false;
}

export interface ScaleOptions {
  /** Задача с подтверждением: шкала «… → На подтверждении → Подтверждена». */
  confirm?: boolean;
}

/** Статусы задачи, при которых шкала — с подтверждением, даже если признак не передан (прототип `taskConfSt`). */
const TASK_CONFIRM_STATUSES: readonly string[] = ['on_confirm', 'confirmed', 'rework'];

/** Шаги шкалы (прототип `scSteps`): с подтверждением — если включено или статус только из неё. */
export function scaleSteps(
  scale: StatusScaleKey,
  status: string | null,
  options: ScaleOptions = {},
): readonly string[] {
  const def = STATUS_SCALE_DEFS[scale];
  if (!def.stepsConfirm) return def.steps;
  const confirmOnly =
    status !== null && TASK_CONFIRM_STATUSES.includes(status) && !def.steps.includes(status);
  return options.confirm || confirmOnly ? def.stepsConfirm : def.steps;
}

export interface ScalePosition {
  /** Номер текущего шага с 0. */
  index: number;
  steps: readonly string[];
  /** Боковой статус на этом шаге. */
  side: SideStatus | null;
}

/**
 * Где на шкале статус (прототип `scPos`): номер шага, шаги, боковой статус. null — шкала не ведётся
 * («Не требуется») или статус не с этой шкалы.
 */
export function scalePosition(
  scale: StatusScaleKey,
  status: string,
  options: ScaleOptions = {},
): ScalePosition | null {
  const steps = scaleSteps(scale, status, options);
  const index = steps.indexOf(status);
  if (index >= 0) return { index, steps, side: null };
  const side = STATUS_SCALE_DEFS[scale].side?.[status];
  if (!side) return null;
  return { index: side.at < 0 ? steps.length + side.at : side.at, steps, side };
}

/**
 * Следующие шаги, которые можно поставить из статуса (прототип `scNext`). Право и условия шага
 * (оплата до сдачи и т. п.) проверяет модуль.
 */
export function scaleNext(
  scale: StatusScaleKey,
  status: string,
  options: ScaleOptions = {},
): string[] {
  switch (scale) {
    case 'report':
      if (status === 'todo') return ['in_progress', 'submitted'];
      return status === 'in_progress' || status === 'needs_fix' ? ['submitted'] : [];
    case 'payment':
      if (status === 'unpaid') return ['partial', 'paid'];
      return status === 'partial' ? ['paid'] : [];
    case 'task':
      if (status === 'todo') return ['in_progress'];
      if (status === 'in_progress' || status === 'rework')
        return [options.confirm ? 'on_confirm' : 'done'];
      return status === 'on_confirm' ? ['confirmed'] : [];
    case 'service':
      if (status === 'active') return ['paused', 'archived'];
      if (status === 'paused') return ['archived'];
      return status === 'archived' ? ['active'] : [];
    case 'project':
      if (status === 'planned') return ['in_progress'];
      return status === 'in_progress' ? ['done'] : [];
    case 'indicator':
      return status === 'filled' ? ['checked'] : [];
  }
}

export interface BackOptions {
  /** Отчёт: сдача подтверждена — откат снимает подтверждение (на «Ждёт подтверждения»). */
  confirmed?: boolean;
  /**
   * Оплата: сколько останется оплачено после отмены последней оплаты; null — оплат нет. Откат оплаты —
   * отмена записи об оплате (ТЗ «Последствия отката»).
   */
  paidRest?: number | null;
}

/**
 * Куда откатить запись на один шаг (прототип `scBack`); null — откатывать некуда. Запрет отката
 * поверх зависимой записи или в закрытом месяце — у модуля.
 */
export function scaleBack(
  scale: StatusScaleKey,
  status: string,
  options: BackOptions = {},
): string | null {
  switch (scale) {
    case 'report':
      if (status === 'submitted') return options.confirmed ? 'waiting' : 'in_progress';
      if (status === 'needs_fix') return 'submitted';
      return status === 'in_progress' || status === 'not_required' ? 'todo' : null;
    case 'payment':
      if (options.paidRest == null) return null;
      return options.paidRest <= 0 ? 'unpaid' : 'partial';
    case 'task':
      if (status === 'confirmed') return 'on_confirm';
      if (['done', 'failed', 'cancelled', 'on_confirm'].includes(status)) return 'in_progress';
      return status === 'in_progress' ? 'todo' : null;
    case 'service':
      return status === 'paused' ? 'active' : null;
    case 'project':
      if (status === 'done' || status === 'cancelled') return 'in_progress';
      return status === 'in_progress' ? 'planned' : null;
    case 'indicator':
      return status === 'checked' ? 'filled' : null;
  }
}

/** Причина отката — не длиннее (поле «Причина» окна отката). */
export const ROLLBACK_REASON_MAX = 500;

/** Почему откат нельзя: нет права «Откат статусов», не на шаг назад, пустая причина. */
export type RollbackRefusal = 'no_right' | 'not_back_step' | 'reason_required';

/**
 * Можно ли откатить запись в статус `to` (ТЗ «Откат статуса»): только с правом «Откат статусов», только
 * на один шаг назад (`back` — `scaleBack` с условиями модуля), с обязательной причиной.
 */
export function rollbackRefusal(input: {
  canRollback: boolean;
  back: string | null;
  to: string;
  reason: string;
}): RollbackRefusal | null {
  if (!input.canRollback) return 'no_right';
  if (input.back === null || input.to !== input.back) return 'not_back_step';
  return input.reason.trim() ? null : 'reason_required';
}

/**
 * Сколько запись провела в каждом статусе истории (прототип `statusHist`): до следующей смены или до
 * «сейчас» у последней записи. История — по порядку, сначала старые; отрицательное время — 0.
 */
export function statusDurations(history: readonly { at: Date }[], now: Date): number[] {
  return history.map((e, i) => {
    const end = history[i + 1]?.at ?? now;
    return Math.max(0, end.getTime() - e.at.getTime());
  });
}

/** Сколько всего запись была в каждом статусе (строка итогов под историей): по порядку появления. */
export function statusTotals(
  history: readonly { at: Date; to: string }[],
  now: Date,
): { status: string; ms: number }[] {
  const durations = statusDurations(history, now);
  const totals = new Map<string, number>();
  history.forEach((e, i) => totals.set(e.to, (totals.get(e.to) ?? 0) + durations[i]!));
  return [...totals].map(([status, ms]) => ({ status, ms }));
}

/** Длительность словами (прототип `durTxt`): меньше часа, часы до суток, дальше — дни. */
export type DurationParts =
  { unit: 'lt_hour' } | { unit: 'hours'; n: number } | { unit: 'days'; n: number };

const HOUR_MS = 3_600_000;

export function durationParts(ms: number): DurationParts {
  const hours = Math.max(0, ms) / HOUR_MS;
  if (hours < 1) return { unit: 'lt_hour' };
  if (hours < 24) return { unit: 'hours', n: Math.round(hours) };
  return { unit: 'days', n: Math.round(hours / 24) };
}

/** Длительность — ключ текста словаря и число («3 дня», «5 ч», «меньше часа»). */
export function durationText(ms: number): { key: UiTextKey; n: number } {
  const parts = durationParts(ms);
  if (parts.unit === 'lt_hour') return { key: 'status.duration_lt_hour', n: 0 };
  if (parts.unit === 'hours') return { key: 'status.duration_hours', n: parts.n };
  return { key: `status.duration_days.${pluralForm(parts.n)}`, n: parts.n };
}

/** Ключ названия статуса в словаре: `status.<шкала>.<код>` (есть у каждого статуса шкалы — тест). */
export function statusTextKey(scale: StatusScaleKey, status: string): UiTextKey {
  return `status.${scale}.${status}` as UiTextKey;
}

/** Ключ названия шкалы в словаре («Сдача», «Оплата», …). */
export function scaleTextKey(scale: StatusScaleKey): UiTextKey {
  return `status.scale.${scale}`;
}
