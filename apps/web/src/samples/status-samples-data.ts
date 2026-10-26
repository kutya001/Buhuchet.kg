import { scaleBack, scaleNext, type StatusScaleKey, type UiTextKey } from '@buhuchet/domain';
import type { Translate } from '../l10n/translate';
import type { StatusEvent } from '../status/status-view';

/**
 * Демо-записи страницы образцов (задача #17): по одной записи на каждый вид шкалы и особые случаи —
 * отметка подтверждения, боковой статус, «Не требуется», откат в истории. Всё живёт только в браузере:
 * переходы и откаты меняют состояние страницы и добавляют строки в «Историю статусов».
 */

export const SAMPLE_IDS = [
  'report',
  'report_confirmed',
  'report_fix',
  'report_none',
  'task_confirm',
  'task_failed',
  'service',
  'project',
  'indicator',
] as const;
export type SampleId = (typeof SAMPLE_IDS)[number];

/** Шкала демо-записи: статус, отметка подтверждения сдачи и история (сначала старые). */
export interface SampleScale {
  scale: StatusScaleKey;
  status: string;
  /** Отчёт: включено «Сдача отчётов требует подтверждения» — после «Сдан» отметка «Ждёт подтверждения». */
  confirmPolicy?: boolean;
  mark?: 'waiting' | 'confirmed' | null;
  /** Задача «Требуется подтверждение». */
  confirm?: boolean;
  history: StatusEvent[];
}

export interface Sample {
  id: SampleId;
  title: UiTextKey;
  scales: SampleScale[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Демо-записи с историей «несколько дней назад» от `now`; действия людей — от имени `actor`. */
export function buildSamples(t: Translate, now: number, actor: string): Sample[] {
  // Время записи: дней и часов назад от показа страницы.
  const ago = (days: number, hours = 0) => new Date(now - days * DAY - hours * HOUR);
  const step = (
    days: number,
    from: string | null,
    to: string,
    more: Partial<StatusEvent> = {},
  ): StatusEvent => ({
    at: ago(days, 3),
    from,
    to,
    rollback: false,
    reason: null,
    actor,
    ...more,
  });
  const created = (days: number, to: string): StatusEvent =>
    step(days, null, to, { actor: null, reason: t('samples.note.created') });
  const file = { name: t('samples.note.file') };
  const report = (scale: Omit<SampleScale, 'scale'>): SampleScale => ({
    scale: 'report',
    ...scale,
  });
  return [
    {
      id: 'report',
      title: 'samples.status.report',
      scales: [
        report({
          status: 'in_progress',
          history: [created(9, 'todo'), step(3, 'todo', 'in_progress')],
        }),
        { scale: 'payment', status: 'unpaid', history: [created(9, 'unpaid')] },
      ],
    },
    {
      id: 'report_confirmed',
      title: 'samples.status.report_confirmed',
      scales: [
        report({
          status: 'submitted',
          confirmPolicy: true,
          mark: 'confirmed',
          history: [
            created(20, 'todo'),
            step(12, 'todo', 'in_progress'),
            step(6, 'in_progress', 'submitted', { file }),
            step(5, 'submitted', 'confirmed'),
          ],
        }),
      ],
    },
    {
      id: 'report_fix',
      title: 'samples.status.report_fix',
      scales: [
        report({
          status: 'needs_fix',
          confirmPolicy: true,
          history: [
            created(25, 'todo'),
            step(15, 'todo', 'in_progress'),
            step(10, 'in_progress', 'submitted', { file }),
            step(2, 'submitted', 'needs_fix', { reason: t('samples.note.fix') }),
          ],
        }),
      ],
    },
    {
      id: 'report_none',
      title: 'samples.status.report_none',
      scales: [
        report({
          status: 'not_required',
          history: [created(30, 'todo'), step(4, 'todo', 'not_required')],
        }),
      ],
    },
    {
      id: 'task_confirm',
      title: 'samples.status.task_confirm',
      scales: [
        {
          scale: 'task',
          status: 'on_confirm',
          confirm: true,
          history: [
            created(7, 'todo'),
            step(5, 'todo', 'in_progress'),
            step(1, 'in_progress', 'on_confirm', { file }),
          ],
        },
      ],
    },
    {
      id: 'task_failed',
      title: 'samples.status.task_failed',
      scales: [
        {
          scale: 'task',
          status: 'failed',
          history: [
            created(14, 'todo'),
            step(10, 'todo', 'in_progress'),
            step(6, 'in_progress', 'done'),
            step(5, 'done', 'in_progress', { rollback: true, reason: t('samples.note.rollback') }),
            step(1, 'in_progress', 'failed', { reason: t('samples.note.failed') }),
          ],
        },
      ],
    },
    {
      id: 'service',
      title: 'samples.status.service',
      scales: [
        {
          scale: 'service',
          status: 'paused',
          history: [
            created(200, 'active'),
            step(20, 'active', 'paused', { reason: t('samples.note.pause') }),
          ],
        },
      ],
    },
    {
      id: 'project',
      title: 'samples.status.project',
      scales: [
        {
          scale: 'project',
          status: 'cancelled',
          history: [
            created(60, 'planned'),
            step(40, 'planned', 'in_progress'),
            step(3, 'in_progress', 'cancelled', { reason: t('samples.note.cancelled') }),
          ],
        },
      ],
    },
    {
      id: 'indicator',
      title: 'samples.status.indicator',
      scales: [
        {
          scale: 'indicator',
          status: 'filled',
          history: [created(25, 'empty'), step(2, 'empty', 'filled')],
        },
      ],
    },
  ];
}

/** Следующие шаги шкалы (`scaleNext`); у отметки подтверждения шагов нет. */
export function sampleNext(s: SampleScale): string[] {
  return scaleNext(s.scale, s.status, s.confirm ? { confirm: true } : {});
}

/**
 * Куда откатить (`scaleBack`); без права «Откат статусов» — некуда. Оплата: отменяется последняя
 * оплата — «Оплачено» после частичной вернётся в «Оплачено частично», иначе в «Не оплачено».
 */
export function sampleBack(s: SampleScale, canRollback: boolean): string | null {
  if (!canRollback) return null;
  const paidRest =
    s.status === 'unpaid'
      ? null
      : s.status === 'paid' && s.history.some((e) => e.to === 'partial' && !e.rollback)
        ? 1
        : 0;
  return scaleBack(s.scale, s.status, { confirmed: s.mark === 'confirmed', paidRest });
}

/** Отметка подтверждения после смены статуса отчёта: «Сдан» при включённом подтверждении — ждёт. */
const markAfter = (s: SampleScale, status: string) =>
  s.confirmPolicy && status === 'submitted' ? 'waiting' : null;

/** Перевести на следующий шаг: новый статус и строка истории. */
export function moveSample(s: SampleScale, to: string, at: Date, actor: string): SampleScale {
  return {
    ...s,
    status: to,
    mark: markAfter(s, to),
    history: [...s.history, { at, from: s.status, to, rollback: false, reason: null, actor }],
  };
}

/**
 * Откатить на шаг назад с причиной: строка истории с пометкой «Откат». Снять подтверждение сдачи —
 * откат отметки «Подтверждено» → «Ждёт подтверждения», статус «Сдан» остаётся.
 */
export function rollbackSample(
  s: SampleScale,
  to: string,
  reason: string,
  at: Date,
  actor: string,
): SampleScale {
  const unconfirm = s.scale === 'report' && to === 'waiting';
  const from = unconfirm ? 'confirmed' : s.status;
  return {
    ...s,
    status: unconfirm ? s.status : to,
    mark: unconfirm ? 'waiting' : markAfter(s, to),
    history: [...s.history, { at, from, to, rollback: true, reason, actor }],
  };
}

/** Из какого статуса откат (заголовок окна): у подтверждённой сдачи — «Подтверждено». */
export function rollbackFrom(s: SampleScale, to: string): string {
  return s.scale === 'report' && to === 'waiting' ? 'confirmed' : s.status;
}
