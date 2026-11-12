import type { ContractorRow } from '@buhuchet/shared';
import type { BoardValue, GridKanban } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';
import { boardSumText } from '../lists/board-sum';

/**
 * Доска контрагентов (прототип modules/contractors.js, `cpKanban`): столбцы — ответственный (по
 * умолчанию), статус обслуживания, режим, тип обслуживания, форма, налоговый орган, тариф Соцфонда.
 * Перетаскиванием меняется только ответственный — с подтверждением, как «Сменить ответственного».
 */
export const CONTRACTOR_BOARD_BY = [
  'responsible',
  'service',
  'regime',
  'kind',
  'form',
  'taxOffice',
  'socfund',
];

/** Порядок столбцов статуса обслуживания (прототип `order.svc`). */
const CONTRACTOR_BOARD_ORDER = { service: ['active', 'paused', 'archived'] };

/** Столбцы статуса обслуживания, которые видны и пустыми (прототип `show.svc`). */
const CONTRACTOR_BOARD_SERVICE_SHOWN = ['active', 'paused'] as const;

/**
 * Доска списка контрагентов: `employees` — сотрудники, за которыми закреплены видимые контрагенты
 * (их столбцы видны и пустыми, когда фильтр убрал записи); `drop` — перенос карточки, нет — доска для
 * просмотра.
 */
export function contractorKanban<Row>(
  t: Translate,
  employees: readonly BoardValue[],
  drop: ((row: Row, key: string, to: BoardValue) => void) | undefined,
): GridKanban<Row> {
  return {
    by: CONTRACTOR_BOARD_BY,
    def: 'responsible',
    order: CONTRACTOR_BOARD_ORDER,
    show: {
      responsible: employees,
      service: CONTRACTOR_BOARD_SERVICE_SHOWN.map((s) => ({
        key: s,
        label: t(`status.service.${s}`),
      })),
    },
    sum: boardSumText,
    ...(drop ? { drop } : {}),
  };
}

/** Что делает перенос контрагента: вопрос о смене ответственного, ничего или отказ с причиной. */
export type ContractorMove =
  | { kind: 'responsible'; employeeId: string }
  | { kind: 'none' }
  | {
      kind: 'refusal';
      key: 'cp.board.only' | 'cp.board.no_right' | 'cp.board.archived' | 'cp.board.pick_employee';
    };

/**
 * Перенос контрагента в столбец `to` доски по столбцу списка `key` (прототип `cpKanban.drop`): только
 * по ответственному, с правом «Назначать отчёты» или «Создавать и изменять контрагентов», не у
 * архивного, в столбец сотрудника. `active` — действующие сотрудники, если список известен.
 */
export function contractorMove(
  c: Pick<ContractorRow, 'serviceStatus' | 'responsible'>,
  rights: { assign: boolean; createCp: boolean },
  key: string,
  to: string,
  active?: readonly string[],
): ContractorMove {
  if (key !== 'responsible') return { kind: 'refusal', key: 'cp.board.only' };
  if (!rights.assign && !rights.createCp) return { kind: 'refusal', key: 'cp.board.no_right' };
  if (c.serviceStatus === 'archived') return { kind: 'refusal', key: 'cp.board.archived' };
  if (!to || (active && !active.includes(to)))
    return { kind: 'refusal', key: 'cp.board.pick_employee' };
  if (to === c.responsible?.id) return { kind: 'none' };
  return { kind: 'responsible', employeeId: to };
}
