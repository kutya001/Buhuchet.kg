/*
 * Уведомления в Telegram (ТЗ «Уведомления в Telegram»; прототип modules/profile.js — `NMODES`,
 * `NKINDS`, `notifyBox`; admin/telegram.js — журнал `TG_LOG`, `tgSvc`, `tgNoRetry`): журнал отправок
 * и очередь с повторами, режим и переключатели сотрудника (задача 2.25, docs/decisions.md, п. Б-5).
 */

/** Состояние строки журнала (прототип: «Ожидает», «Отправлено», «Ошибка»). */
export const OUTBOX_STATUSES = ['pending', 'sent', 'error'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/**
 * Что за сообщение (столбец «Что» журнала Админки): напоминания за день (одно сообщение в день, по
 * понедельникам — со сводкой на неделю), события задач и отчётов — сразу, служебные сообщения бота.
 */
export const OUTBOX_KINDS = [
  'reminders',
  'task_new',
  'task_on_confirm',
  'task_confirmed',
  'task_rework',
  'task_cancelled',
  'report_fix',
  'code',
  'linked',
  'relinked',
  'unlinked',
  'pass_changed',
  'pass_reset',
  'broadcast',
] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

/** Служебные сообщения бота уходят сразу и пишутся в журнал после отправки (docs/deviations.md, п. 12). */
export const SERVICE_KINDS: readonly OutboxKind[] = [
  'code',
  'linked',
  'relinked',
  'unlinked',
  'pass_changed',
  'pass_reset',
];

/** Пачка отправки и пауза между пачками (прототип: «отправляются пачками»; предел Telegram — 30 в секунду). */
export const OUTBOX_BATCH = 25;
export const OUTBOX_PAUSE_MS = 1200;
/** За один запуск — не больше стольких пачек: запуск расписания должен уложиться в минуту. */
export const OUTBOX_MAX_BATCHES = 8;
/** После стольких попыток строка получает «Ошибка» (прототип: «после 5 повторов»). */
export const OUTBOX_MAX_TRIES = 5;
/** Пока строка отправляется, её не берёт другой запуск: столько секунд. */
export const OUTBOX_LEASE_SECONDS = 120;
/** Длина текста ошибки в журнале. */
export const OUTBOX_ERROR_MAX = 300;
/** Итог строки, получатель которой отвязал или сменил Telegram или заблокирован (журнал Админки). */
export const OUTBOX_UNDELIVERABLE = 'Получатель отвязал Telegram или заблокирован';

/**
 * Через сколько секунд повторить после временной ошибки: сколько попросил Telegram (429), иначе 1, 2,
 * 4, 8 минут после 1–4-й попытки.
 */
export function outboxRetryDelaySeconds(tries: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) return Math.ceil(retryAfterSeconds);
  return 60 * 2 ** Math.max(0, Math.min(tries, OUTBOX_MAX_TRIES) - 1);
}

/** Почему строку журнала нельзя повторить (прототип `tgNoRetry`); null — можно. */
export function outboxRetryRefusal(row: {
  status: OutboxStatus;
  kind: string;
}): 'outbox_not_error' | 'outbox_code' | null {
  if (row.status !== 'error') return 'outbox_not_error';
  if (row.kind === 'code') return 'outbox_code';
  return null;
}

/** Режим уведомлений владельца и главного бухгалтера (прототип `NMODES`), по умолчанию — «Все». */
export const NOTIFY_MODES = ['all', 'digest', 'manual'] as const;
export type NotifyMode = (typeof NOTIFY_MODES)[number];

/**
 * Переключатели (прототип `NKINDS`): «за N дней» и просрочки по отчётам других сотрудников, ручные
 * задачи, регулярные задачи по отчётам, сводка за неделю. Сотрудник без режима видит только «Ручные
 * задачи» и «Регулярные задачи»: напоминания по своим отчётам у него не отключаются.
 */
export const NOTIFY_KINDS = ['before', 'over', 'tasks', 'regtasks', 'week'] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

/** Переключатели сотрудника без режима (прототип: `boss || !['week','before','over'].includes(k)`). */
export const STAFF_NOTIFY_KINDS: readonly NotifyKind[] = ['tasks', 'regtasks'];

export interface NotifySettings {
  mode: NotifyMode;
  /** Отключённые переключатели. */
  off: readonly NotifyKind[];
}

export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = { mode: 'all', off: [] };

/** Что входит в режим (прототип `on` в `notifyBox`). */
const MODE_KINDS: Readonly<Record<NotifyMode, readonly NotifyKind[]>> = {
  all: NOTIFY_KINDS,
  digest: ['over', 'tasks', 'week'],
  manual: ['tasks'],
};

/**
 * Включено ли у получателя (прототип `on` в `notifyBox`): у владельца и главного бухгалтера — по режиму
 * и переключателям; у остальных — только переключатели «Ручные задачи» и «Регулярные задачи», режим
 * не действует. Напоминания по своим отчётам, в день срока и о просрочке своих отчётов — всегда.
 */
export function notifyOn(settings: NotifySettings, boss: boolean, kind: NotifyKind): boolean {
  if (settings.off.includes(kind)) return false;
  if (!boss) return STAFF_NOTIFY_KINDS.includes(kind);
  return MODE_KINDS[settings.mode].includes(kind);
}

/**
 * Переключатель недоступен (прототип: «Отключённый переключатель — это то, что не входит в выбранный
 * режим»): у владельца и главного бухгалтера — то, что не входит в режим.
 */
export function notifyKindLocked(
  settings: NotifySettings,
  boss: boolean,
  kind: NotifyKind,
): boolean {
  return boss && !MODE_KINDS[settings.mode].includes(kind);
}

/** Какие переключатели видит сотрудник (прототип `NKINDS.filter`). */
export function notifyKindsFor(boss: boolean): readonly NotifyKind[] {
  return boss ? NOTIFY_KINDS : STAFF_NOTIFY_KINDS;
}

/** Смена режима сбрасывает переключатели (прототип: `n.mode = r.value; n.off = {}`). */
export function withNotifyMode(mode: NotifyMode): NotifySettings {
  return { mode, off: [] };
}

/** Переключатель включён или выключен: порядок — как в каталоге. */
export function withNotifyKind(
  settings: NotifySettings,
  kind: NotifyKind,
  on: boolean,
): NotifySettings {
  const off = new Set(settings.off);
  if (on) off.delete(kind);
  else off.add(kind);
  return { mode: settings.mode, off: NOTIFY_KINDS.filter((k) => off.has(k)) };
}
