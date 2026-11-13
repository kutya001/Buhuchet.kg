import {
  projectCancelable,
  scaleBack,
  scaleNext,
  type ProjectStatus,
  type UiTextKey,
} from '@buhuchet/domain';
import type { ProjectCard, ProjectEditRequest } from '@buhuchet/shared';
import type { BoardValue, GridKanban } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';
import { boardSumText } from '../lists/board-sum';

/**
 * Доска проектов (прототип v85 modules/projects.js, `projKanban`; docs/deviations.md п. О-77):
 * столбцы — статус (по умолчанию), контрагент, главный. Перетаскиванием меняются статус (шаг по
 * шкале, «Отменён» — с вопросом) и главный незавершённого проекта.
 */
export const PROJECT_BOARD_BY = ['status', 'cp', 'lead'];

/** Порядок столбцов статуса (прототип `order.status`). */
const PROJECT_BOARD_ORDER = { status: ['planned', 'in_progress', 'done', 'cancelled'] };

/** Столбцы статуса, которые видны и пустыми (прототип `show.status`). */
const PROJECT_BOARD_STATUS_SHOWN = ['planned', 'in_progress', 'done'] as const;

/**
 * Доска списка проектов: `leads` — главные по видимым проектам (их столбцы видны и пустыми, когда
 * фильтр убрал записи); `drop` — перенос карточки.
 */
export function projectKanban<Row>(
  t: Translate,
  leads: readonly BoardValue[],
  drop: ((row: Row, key: string, to: BoardValue) => void) | undefined,
): GridKanban<Row> {
  return {
    by: PROJECT_BOARD_BY,
    def: 'status',
    order: PROJECT_BOARD_ORDER,
    show: {
      status: PROJECT_BOARD_STATUS_SHOWN.map((s) => ({
        key: s,
        label: t(`status.project.${s}`),
      })),
      lead: leads,
    },
    sum: boardSumText,
    ...(drop ? { drop } : {}),
  };
}

/** Что делает перенос проекта: шаг статуса, вопрос об отмене, смена главного, ничего или отказ. */
export type ProjectMove =
  | { kind: 'status'; to: ProjectStatus }
  | { kind: 'cancel' }
  | { kind: 'lead'; employeeId: string }
  | { kind: 'none' }
  | { kind: 'refusal'; key: UiTextKey };

/**
 * Перенос проекта в столбец `to` доски по столбцу списка `key` (прототип `projKanban.drop`): с правом
 * «Вести проекты и разовые услуги»; по статусу — шаг вперёд по шкале сразу, «Отменён» у активного —
 * после вопроса, остальное — отказ (откат — только из меню проекта); по главному — у незавершённого
 * проекта, в столбец сотрудника.
 */
export function projectMove(
  p: { status: ProjectStatus; lead: { id: string } },
  canEdit: boolean,
  key: string,
  to: string,
): ProjectMove {
  if (!canEdit) return { kind: 'refusal', key: 'proj.board.no_right' };
  if (key === 'status') {
    if (to === p.status) return { kind: 'none' };
    if (scaleNext('project', p.status).includes(to))
      return { kind: 'status', to: to as ProjectStatus };
    if (to === 'cancelled' && projectCancelable(p.status)) return { kind: 'cancel' };
    return {
      kind: 'refusal',
      key: scaleBack('project', p.status) === to ? 'proj.board.no_move_back' : 'proj.board.no_move',
    };
  }
  if (key === 'lead') {
    if (!to) return { kind: 'refusal', key: 'proj.board.pick_employee' };
    if (!projectCancelable(p.status)) return { kind: 'refusal', key: 'proj.board.lead_open' };
    if (to === p.lead.id) return { kind: 'none' };
    return { kind: 'lead', employeeId: to };
  }
  return { kind: 'refusal', key: 'proj.board.only' };
}

/**
 * Запрос «главный — другой сотрудник» (прототип: `p.lead = e.id`, нового главного добавляет в
 * ответственные): остальные поля проекта и работы — как в свежей карточке. Стоимость без права видеть
 * деньги сервер не меняет.
 */
export function leadChangeBody(card: ProjectCard, leadId: string): ProjectEditRequest {
  const members = card.members.map((m) => m.id);
  return {
    version: card.version,
    name: card.name,
    startsOn: card.startsOn,
    endsOn: card.endsOn,
    description: card.description,
    plan: card.money?.plan ?? null,
    members: members.includes(leadId) ? members : [...members, leadId],
    lead: leadId,
    works: card.works.map((w) => ({
      id: w.id,
      name: w.name,
      executorId: w.executor.id,
      due: w.due,
    })),
  };
}
