import {
  bishkekDate,
  bishkekTime,
  formatDateRu,
  RUN_MAX_ATTEMPTS,
  runDuration,
  type JobStateCode,
  type ListFilterValue,
  type RunStatus,
} from '@buhuchet/domain';
import type { AdminJobSummary } from '@buhuchet/shared';
import type { IconName, Pill, PlateColor } from '@buhuchet/ui';
import type { ComponentProps } from 'react';
import type { Translate } from '../l10n/translate';

type PillTone = NonNullable<ComponentProps<typeof Pill>['tone']>;

/** Итог запуска: цвет и значок (прототип `RUN_ST`). */
export const RUN_PILL: Readonly<Record<RunStatus, { tone: PillTone; icon: IconName }>> = {
  ok: { tone: 'ok', icon: 'check' },
  error: { tone: 'bad', icon: 'alert' },
  running: { tone: 'warn', icon: 'hourglass' },
};

/** Состояние задачи: цвет и значок (прототип `JOB_ST`). */
export const JOB_PILL: Readonly<Record<JobStateCode, { tone: PillTone; icon: IconName }>> = {
  ok: { tone: 'ok', icon: 'check' },
  failing: { tone: 'bad', icon: 'alert' },
  missed: { tone: 'warn', icon: 'clock' },
};

/** «0,4 с», «1 мин 30 с»; пусто — запуск ещё идёт (прототип `runDur`). */
export function durationText(t: Translate, ms: number | null): string {
  const d = runDuration(ms);
  if (!d) return '';
  return d.kind === 's' ? t('runs.dur.s', { s: d.s }) : t('runs.dur.m', { m: d.m, s: d.s });
}

/** «2 из 3» (прототип `runTry`). */
export function tryText(t: Translate, attempt: number): string {
  return t('runs.try', { n: attempt, max: RUN_MAX_ATTEMPTS });
}

/** Момент с секундами: «18.11.2026 10:05:07» — «Окончание» запуска. */
export function momentWithSeconds(iso: string): string {
  const at = new Date(iso);
  // Секунды в Бишкеке те же, что в UTC: сдвиг — целые часы.
  return `${formatDateRu(bishkekDate(at))} ${bishkekTime(at)}:${at.toISOString().slice(17, 19)}`;
}

/** Момент для ленты попыток: дата и время «ЧЧ:ММ» отдельными строками (прототип `runDlg`). */
export function attemptStamp(iso: string): { date: string; time: string } {
  const text = momentWithSeconds(iso);
  return { date: text.slice(0, 10), time: text.slice(11, 16) };
}

/** Цвета плашек над задачами (прототип `renderRuns`): зелёная — всё хорошо. */
export function jobPlateColors(
  s: AdminJobSummary | undefined,
): Record<'ok' | 'fail' | 'miss' | 'err', PlateColor> {
  return {
    ok: !s || s.ok === s.total ? 'green' : 'yellow',
    fail: s?.failing ? 'red' : 'green',
    miss: s?.missed ? 'yellow' : 'green',
    err: s?.dayErrors ? 'red' : 'green',
  };
}

type Filters = Record<string, ListFilterValue>;

/** Фильтр задач по состоянию — нажатие плашки «Работают», «Падают», «Не запускались». */
export const jobStateFilter = (state: JobStateCode): Filters => ({
  st: { type: 'enum', vals: [state] },
});

/** Журнал запусков одной задачи — нажатие на задачу и «Запуски задачи». */
export const runsOfJobFilter = (job: string): Filters => ({
  title: { type: 'enum', vals: [job] },
});

/** Журнал только с ошибками — плашка «Ошибок за сутки». */
export const RUN_ERRORS_FILTER: Filters = { st: { type: 'enum', vals: ['error'] } };
