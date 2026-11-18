/*
 * Админка → «Запуски» (решение заказчика 17.11.2026; прототип v132 admin/runs.js; ТЗ «Доработки
 * 17.11.2026», блок «Админка: запуски по расписанию и переписка бота»; docs/decisions.md п. Т-15):
 * задачи по расписанию и журнал их запусков. Только просмотр.
 */

/** Попыток одного запуска не больше (первая и два повтора — через 2 и через 10 минут). */
export const RUN_MAX_ATTEMPTS = 3;
/** После стольких неудачных попыток подряд задача «Падает» (и уходит сообщение о сбое). */
export const RUN_FAILS_TO_ALERT = 3;
/** Журнал запусков хранится 30 дней. */
export const RUN_KEEP_DAYS = 30;
/** Период журнала запусков: «Сегодня · 7 дней · 30 дней»; по умолчанию — 7 дней. */
export const RUN_PERIODS = [1, 7, 30] as const;
export type RunPeriod = (typeof RUN_PERIODS)[number];
export const RUN_PERIOD_DEFAULT: RunPeriod = 7;

/** Итог запуска. */
export const RUN_STATUSES = ['ok', 'error', 'running'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Состояние задачи: «Работает», «Падает», «Не запускалась». */
export const JOB_STATES = ['ok', 'failing', 'missed'] as const;
export type JobStateCode = (typeof JOB_STATES)[number];

/** Прежняя попытка запуска: хранится в самой строке запуска. */
export interface RunAttempt {
  attempt: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

/**
 * Состояние задачи — по тем же правилам, что сообщение «Сбой в работе сайта»: три неудачные попытки
 * подряд — «Падает»; запуск по расписанию пропущен (с окном догоняния и запасом) или задача ещё ни разу
 * не запускалась — «Не запускалась».
 */
export function jobStateOf(job: {
  fails: number;
  alert: 'failing' | 'missed' | null;
  /** Последний занятый отрезок расписания; null — задача не запускалась. */
  lastSlot: Date | null;
  /** Отрезок, который уже должен был выполниться (окно догоняния закончилось), или null. */
  overdue: Date | null;
}): JobStateCode {
  if (job.fails >= RUN_FAILS_TO_ALERT || job.alert === 'failing') return 'failing';
  if (job.alert === 'missed') return 'missed';
  if (!job.lastSlot) return job.overdue ? 'missed' : 'ok';
  return job.overdue && job.overdue > job.lastSlot ? 'missed' : 'ok';
}

/** Порядок состояний в списке: сначала «Падает», потом «Не запускалась». */
export const JOB_STATE_RANK: Readonly<Record<JobStateCode, number>> = {
  failing: 0,
  missed: 1,
  ok: 2,
};

/** Как часто идёт задача — по расписанию cron из пяти полей (время — по Бишкеку). */
export type CronEvery =
  | { kind: 'minute' }
  | { kind: 'minutes'; n: number }
  | { kind: 'hourly'; minute: string }
  | { kind: 'daily'; time: string }
  | { kind: 'times'; n: number; times: string }
  | { kind: 'other'; cron: string };

const two = (n: number) => String(n).padStart(2, '0');

/**
 * Расписание словами (прототип: «Каждую минуту», «Каждые 5 минут», «Каждый час в :40», «Каждый день в
 * 03:30», «4 раза в сутки: 00:05, 06:05…»). Иное расписание — как записано.
 */
export function cronEvery(cron: string): CronEvery {
  const parts = cron.trim().split(/\s+/);
  const other: CronEvery = { kind: 'other', cron: cron.trim() };
  if (parts.length !== 5) return other;
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string];
  if (dom !== '*' || month !== '*' || dow !== '*') return other;
  if (hour === '*') {
    if (minute === '*') return { kind: 'minute' };
    const step = /^\*\/(\d{1,2})$/.exec(minute);
    if (step) {
      const n = Number(step[1]);
      return n === 1 ? { kind: 'minute' } : n >= 2 && n <= 59 ? { kind: 'minutes', n } : other;
    }
    if (/^\d{1,2}$/.test(minute) && Number(minute) < 60) {
      return { kind: 'hourly', minute: two(Number(minute)) };
    }
    return other;
  }
  if (!/^\d{1,2}$/.test(minute) || Number(minute) > 59) return other;
  if (!/^\d{1,2}(,\d{1,2})*$/.test(hour)) return other;
  const hours = hour.split(',').map(Number);
  if (hours.some((h) => h > 23)) return other;
  const times = hours.map((h) => `${two(h)}:${two(Number(minute))}`);
  return times.length === 1
    ? { kind: 'daily', time: times[0]! }
    : { kind: 'times', n: times.length, times: times.join(', ') };
}

/** Сколько минут между запусками — чтобы сортировать «Как часто» от частых к редким. */
export function cronEveryMinutes(every: CronEvery): number {
  switch (every.kind) {
    case 'minute':
      return 1;
    case 'minutes':
      return every.n;
    case 'hourly':
      return 60;
    case 'daily':
      return 1440;
    case 'times':
      return Math.round(1440 / every.n);
    default:
      return 1440;
  }
}

/** Длительность запуска для экрана: до минуты — секунды с десятыми, дольше — минуты и секунды. */
export function runDuration(
  ms: number | null,
): { kind: 's'; s: string } | { kind: 'm'; m: number; s: number } | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  const seconds = ms / 1000;
  if (seconds < 60)
    return { kind: 's', s: String(Math.round(seconds * 10) / 10).replace('.', ',') };
  const whole = Math.round(seconds);
  return { kind: 'm', m: Math.floor(whole / 60), s: whole % 60 };
}

/** Ключ словаря с названием задачи: `alert.job.<имя>` (точки и дефисы имени — «_»), как в оповещениях. */
export function jobTitleKey(name: string): string {
  return `alert.job.${name.replace(/[.-]/g, '_')}`;
}

/** Ключ словаря «Что делает» задачи. */
export function jobWhatKey(name: string): string {
  return `runs.what.${name.replace(/[.-]/g, '_')}`;
}

/** Ключ словаря «Что сделано» с числом: свой у задачи или общий «Сделано: {n}». */
export function jobDoneKey(name: string): string {
  return `runs.done.${name.replace(/[.-]/g, '_')}`;
}

/**
 * «Важный» запуск: ошибка, ещё выполняется или что-то сделал. Успешный запуск, который ничего не
 * сделал или не сообщил, сколько сделал, — пустой: в «Важных» его нет, во «Всех» — есть.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Т-22 — запуск без числа «Что сделано» тоже пустой.
export function runImportant(run: { status: RunStatus; done: number | null }): boolean {
  return run.status !== 'ok' || (run.done ?? 0) > 0;
}
