import { OPEN_REPORT_STATUSES, reportNotRequiredAllowed } from '@buhuchet/domain';
import type { ReportRow } from '@buhuchet/shared';
import type { BoardValue, GridKanban } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';
import { boardSumText } from '../lists/board-sum';
import { payFirstWhy } from '../money/report-money';
import { statusName } from '../status/status-view';
import { reportFacts, type ReportActor } from './report-menu';

/**
 * Доска отчётов (прототип modules/reports.js, `repKanban`): столбцы — статус сдачи (по умолчанию),
 * ответственный, контрагент, вид отчёта, период, «Что сделать», орган, статус оплаты, просрочка.
 * Перенос карточки по статусу делает то же, что действие в меню отчёта (те же права и окна), по
 * ответственному — меняет ответственного за отчёт.
 */
export const REPORT_BOARD_BY = [
  'status',
  'responsible',
  'cp',
  'type',
  'period',
  'act',
  'organ',
  'paymentStatus',
  'overdue',
];

/** Порядок столбцов (прототип `order`): у вида «Уплата» статуса сдачи нет — столбец «(Пусто)», последним. */
const REPORT_BOARD_ORDER = {
  status: ['todo', 'in_progress', 'needs_fix', 'submitted', 'not_required'],
  paymentStatus: ['unpaid', 'partial', 'paid'],
};

/** Столбцы статусов, которые видны и пустыми (прототип `show.status`). */
const REPORT_BOARD_STATUS_SHOWN = ['todo', 'in_progress', 'submitted'] as const;

/**
 * Доска списка отчётов: `employees` — сотрудники, столбцы «Столбцы: Ответственный», видные и без
 * отчётов (тому, кто назначает отчёты); `drop` — перенос карточки, нет — доска для просмотра.
 */
export function reportKanban<Row>(
  t: Translate,
  employees: readonly { id: string; shortName: string }[],
  drop: ((row: Row, key: string, to: BoardValue) => void) | undefined,
): GridKanban<Row> {
  return {
    by: REPORT_BOARD_BY,
    def: 'status',
    order: REPORT_BOARD_ORDER,
    show: {
      status: REPORT_BOARD_STATUS_SHOWN.map((s) => ({ key: s, label: statusName(t, 'report', s) })),
      responsible: employees.map((e) => ({ key: e.id, label: e.shortName })),
    },
    sum: boardSumText,
    ...(drop ? { drop } : {}),
  };
}

/**
 * Сотрудники-столбцы доски отчётов: действующие, за которыми закреплены контрагенты (не в архиве);
 * числа закреплённых неизвестны или пришли не все — все действующие.
 */
export function boardEmployees<E extends { id: string }>(
  employees: readonly E[],
  withContractors: { counts: ReadonlyMap<string, number>; complete: boolean } | undefined,
): E[] {
  if (!withContractors?.complete) return [...employees];
  return employees.filter((e) => (withContractors.counts.get(e.id) ?? 0) > 0);
}

/** Что делает перенос отчёта: действие меню, смена ответственного, ничего или отказ с причиной. */
export type ReportMove =
  | { kind: 'action'; action: 'start' | 'submit' | 'reject' | 'not_required' }
  | { kind: 'responsible'; employeeId: string }
  | { kind: 'none' }
  | { kind: 'refusal'; text: string };

/**
 * Перенос отчёта в столбец `to` доски по столбцу списка `key` (прототип `repKanban.drop`): по
 * ответственному — смена ответственного (право «Назначать отчёты», столбец работающего сотрудника);
 * по статусу — «Взять в работу», «Отметить сданным» (при «Сдаче только после оплаты» — после оплаты),
 * «Требует исправления» у сданного, «Не требуется»; у вида «Уплата» статуса сдачи нет. По остальным
 * столбцам перенос ничего не меняет. `active` — действующие сотрудники, если список известен.
 */
export function reportMove(
  t: Translate,
  r: ReportRow,
  actor: ReportActor,
  key: string,
  to: BoardValue,
  active?: readonly string[],
): ReportMove {
  const bad = (text: string): ReportMove => ({ kind: 'refusal', text });
  if (key === 'responsible') {
    if (!actor.can.assign) return bad(t('report.board.need_assign'));
    if (!to.key || (active && !active.includes(to.key)))
      return bad(t('report.board.pick_employee'));
    if (to.key === r.responsible?.id) return { kind: 'none' };
    return { kind: 'responsible', employeeId: to.key };
  }
  if (key !== 'status') return bad(t('report.board.only'));
  if (r.act === 'pay') return bad(t('report.board.pay_only'));
  if (!actor.can.changeStatus) return bad(t('report.menu.no_status'));
  const st = r.status;
  if (to.key === 'in_progress' && st === 'todo') return { kind: 'action', action: 'start' };
  if (to.key === 'submitted' && OPEN_REPORT_STATUSES.has(st)) {
    const why = payFirstWhy(t, r, actor.taxpay && actor.payFirst);
    return why ? bad(why) : { kind: 'action', action: 'submit' };
  }
  if (to.key === 'needs_fix' && st === 'submitted') return { kind: 'action', action: 'reject' };
  if (to.key === 'not_required' && reportNotRequiredAllowed(reportFacts(r), actor.confirmOn))
    return { kind: 'action', action: 'not_required' };
  const names = { from: statusName(t, 'report', st), to: to.label };
  return bad(t(st === 'submitted' ? 'report.board.no_move_back' : 'report.board.no_move', names));
}
