import {
  bishkekDate,
  diffDays,
  durationText,
  formatMomentRu,
  isNoScale,
  scalePosition,
  scaleTextKey,
  statusDurations,
  statusLook,
  statusTextKey,
  statusTotals,
  type StatusScaleKey,
  type StatusTone,
} from '@buhuchet/domain';
import type { StatusHistoryEntry } from '@buhuchet/shared';
import type {
  IconName,
  RollbackDialogLabels,
  StatusHistoryLabels,
  StatusHistoryRow,
  StatusMiniProps,
  StatusScaleLabels,
  StatusScaleProps,
} from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/**
 * Шкала статусов и «История статусов» для экранов модулей (прототип ui/status-scale.js: `scaleFull`,
 * `scaleMini`, `statusHistHtml`): из статуса записи, её истории и того, что разрешил модуль (следующие
 * шаги, шаг для отката, закрытые шаги), — пропсы компонентов `@buhuchet/ui` с текстами словаря.
 */

/** Запись «Истории статусов» для показа: момент — `Date`, автор null — система. */
export interface StatusEvent {
  at: Date;
  from: string | null;
  to: string;
  rollback: boolean;
  /** Комментарий или причина. */
  reason: string | null;
  /** Краткое ФИО; null — система. */
  actor: string | null;
  file?: { name: string; href?: string } | null;
}

/** История из ответа API (`StatusHistoryEntry`, время строкой ISO). */
export function statusEvents(entries: readonly StatusHistoryEntry[]): StatusEvent[] {
  return entries.map((e) => ({ ...e, at: new Date(e.at) }));
}

/** Название статуса из словаря. */
export function statusName(t: Translate, scale: StatusScaleKey, status: string): string {
  return t(statusTextKey(scale, status));
}

/** Метка статуса: название, цвет и значок справочника «Статусы» (значки есть в наборе — тест). */
export function statusPillView(
  t: Translate,
  scale: StatusScaleKey,
  status: string,
): { label: string; tone: StatusTone; icon: IconName } {
  const look = statusLook(scale, status);
  return { label: statusName(t, scale, status), tone: look.tone, icon: look.icon as IconName };
}

/** Длительность словами: «меньше часа», «5 ч», «3 дня». */
export function durationLabel(t: Translate, ms: number): string {
  const d = durationText(ms);
  return t(d.key, { n: d.n });
}

/** Когда статус ставили в последний раз (прототип `when` в `scaleFull`). */
function lastSet(history: readonly StatusEvent[], status: string): Date | null {
  for (let i = history.length - 1; i >= 0; i--)
    if (history[i]!.to === status) return history[i]!.at;
  return null;
}

const moment = (at: Date | null) => (at ? formatMomentRu(at) : null);

export interface ScaleInput {
  scale: StatusScaleKey;
  status: string;
  /** История записи на этой шкале, сначала старые. */
  history: readonly StatusEvent[];
  /** Задача «Требуется подтверждение». */
  confirm?: boolean;
  /** Отметка на последнем шаге отчёта: `waiting` или `confirmed`. */
  mark?: string | null;
  /** Текст отметки вместо названия: «Ждёт подтверждения · 3 дн.», «Подтвердил Тилекова А.» (`confirmMarkLabel`). */
  markLabel?: string | null;
  /** Следующие шаги, которые модуль разрешает поставить (`scaleNext` с правом). */
  next?: readonly string[];
  /** Следующие шаги, закрытые условием: код → почему. */
  blocked?: Readonly<Record<string, string>>;
  /** Шаг для отката (`scaleBack`), только при праве «Откат статусов». */
  back?: string | null;
  /** Строки под шкалой: почему откат или шаг недоступен. */
  hints?: readonly string[];
}

export type ScaleView =
  | { kind: 'scale'; props: Omit<StatusScaleProps, 'onStep' | 'onBack'> }
  | { kind: 'none'; title: string; text: string; since: string | null; undo: string | null }
  | { kind: 'pill'; title: string; pill: ReturnType<typeof statusPillView> };

/**
 * Полная шкала записи (прототип `scaleFull`): шаги с датой, когда каждый ставили в последний раз,
 * боковой статус, отметка подтверждения (цвет шкалы — по отметке); «Не требуется» — надпись с какого
 * времени и «Снять «…»», если откат разрешён; статус не с этой шкалы — просто метка.
 */
export function scaleView(t: Translate, input: ScaleInput): ScaleView {
  const { scale, status, history } = input;
  const title = t(scaleTextKey(scale));
  const name = statusName(t, scale, status);
  if (isNoScale(scale, status)) {
    const since = moment(lastSet(history, status));
    return {
      kind: 'none',
      title,
      text: t('status.no_scale_full', { name }),
      since: since ? t('status.since', { at: since }) : null,
      undo: input.back ? t('status.undo_none', { name }) : null,
    };
  }
  const pos = scalePosition(scale, status, input.confirm ? { confirm: true } : {});
  if (!pos) return { kind: 'pill', title, pill: statusPillView(t, scale, status) };
  const mark = input.mark && !pos.side ? statusPillView(t, scale, input.mark) : null;
  return {
    kind: 'scale',
    props: {
      title,
      steps: pos.steps.map((code, j) => ({
        code,
        label: statusName(t, scale, code),
        at: j <= pos.index ? moment(lastSet(history, code)) : null,
      })),
      index: pos.index,
      tone: mark ? mark.tone : statusLook(scale, status).tone,
      side: pos.side
        ? { label: name, tone: pos.side.tone, at: moment(lastSet(history, status)) }
        : null,
      mark: mark && {
        ...mark,
        label: input.markLabel ?? mark.label,
        icon: input.mark === 'confirmed' ? 'check' : 'hourglass',
      },
      next: input.next ?? [],
      blocked: input.blocked ?? {},
      back: input.back ?? null,
      hints: input.hints ?? [],
      labels: scaleLabels(t),
    },
  };
}

export type MiniView =
  | { kind: 'mini'; props: StatusMiniProps }
  | { kind: 'none'; label: string; title: string }
  | { kind: 'pill'; pill: ReturnType<typeof statusPillView> };

/**
 * Компактная шкала для списков и плиток (прототип `scaleMini`): «2/3» и название, под ним — когда
 * поставлен, в подсказке — кто.
 */
export function miniView(
  t: Translate,
  input: Pick<ScaleInput, 'scale' | 'status' | 'history' | 'confirm' | 'mark' | 'markLabel'>,
): MiniView {
  const { scale, status, history } = input;
  const name = statusName(t, scale, status);
  if (isNoScale(scale, status))
    return { kind: 'none', label: name, title: t('status.no_scale', { name }) };
  const pos = scalePosition(scale, status, input.confirm ? { confirm: true } : {});
  if (!pos) return { kind: 'pill', pill: statusPillView(t, scale, status) };
  const mark = input.mark ? statusPillView(t, scale, input.mark) : null;
  const step = t('status.step_of', { i: pos.index + 1, n: pos.steps.length, name });
  const last = history.at(-1);
  return {
    kind: 'mini',
    props: {
      count: pos.steps.length,
      index: pos.index,
      tone: statusLook(scale, status).tone,
      label: name,
      side: !!pos.side,
      title: mark ? `${step} · ${input.markLabel ?? mark.label}` : step,
      at: last ? formatMomentRu(last.at) : null,
      atTitle: last
        ? t('status.set_at_by', {
            at: formatMomentRu(last.at),
            who: last.actor ?? t('status.system'),
          })
        : undefined,
      mark,
    },
  };
}

/**
 * Текст отметки подтверждения сдачи (прототип `repConfTxt`): «Ждёт подтверждения · N дн.» — дней с
 * последней сдачи по Бишкеку; «Подтвердил <кто>» — по последнему подтверждению (система — название).
 */
export function confirmMarkLabel(
  t: Translate,
  history: readonly StatusEvent[],
  mark: string,
  now: Date,
): string {
  const name = statusName(t, 'report', mark);
  if (mark === 'waiting') {
    const since = lastSet(history, 'submitted') ?? now;
    const n = Math.max(0, diffDays(bishkekDate(now), bishkekDate(since)));
    return t('status.mark_waiting_days', { name, n });
  }
  const by = [...history].reverse().find((e) => e.to === mark)?.actor;
  return by ? t('status.mark_confirmed_by', { who: by }) : name;
}

/**
 * «История статусов» (прототип `statusHistHtml`): строки по порядку (компонент показывает сверху
 * новые), сколько запись была в каждом статусе — до следующей смены или до `now`, и итог по статусам.
 */
export function historyView(
  t: Translate,
  scale: StatusScaleKey,
  history: readonly StatusEvent[],
  now: Date,
): { rows: StatusHistoryRow[]; totals: { label: string; duration: string }[] } {
  const durations = statusDurations(history, now);
  return {
    rows: history.map((e, i) => ({
      key: `${e.at.getTime()}-${i}`,
      at: formatMomentRu(e.at),
      from: e.from ? statusName(t, scale, e.from) : null,
      to: statusPillView(t, scale, e.to),
      actor: e.actor ?? t('status.system'),
      note: e.reason,
      rollback: e.rollback,
      file: e.file ?? null,
      duration: durationLabel(t, durations[i]!),
      now: i === history.length - 1,
    })),
    totals: statusTotals(history, now).map((s) => ({
      label: statusName(t, scale, s.status),
      duration: durationLabel(t, s.ms),
    })),
  };
}

/** Заголовок окна отката: «Откатить: «Сдан» → «В работе»». */
export function rollbackTitle(t: Translate, scale: StatusScaleKey, from: string, to: string) {
  return t('status.rollback_title', {
    from: statusName(t, scale, from),
    to: statusName(t, scale, to),
  });
}

export function scaleLabels(t: Translate): StatusScaleLabels {
  return {
    moveTo: (name) => t('status.move_to', { name }),
    rollbackTo: (name) => t('status.rollback_to', { name }),
    rollbackMark: t('status.rollback_mark'),
    sideOnStep: (n, name) => t('status.side_on_step', { n, name }),
  };
}

export function historyLabels(t: Translate): StatusHistoryLabels {
  return {
    when: t('status.col_when'),
    status: t('status.col_status'),
    who: t('status.col_who'),
    note: t('status.col_note'),
    inStatus: t('status.col_duration'),
    now: t('status.now'),
    rollback: t('status.rollback'),
    whoLine: (name) => t('status.who', { name }),
  };
}

export function rollbackLabels(t: Translate): RollbackDialogLabels {
  return {
    reason: t('status.rollback_reason'),
    placeholder: t('status.rollback_placeholder'),
    hint: t('status.rollback_hint'),
    ok: t('status.rollback_ok'),
    required: t('status.rollback_reason_required'),
  };
}
