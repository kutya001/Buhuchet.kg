import type { UiTextKey } from '@buhuchet/domain';
import type { Employee, RoleListItem } from '@buhuchet/shared';
import type { BoardValue, GridKanban } from '@buhuchet/ui';

/**
 * Доска сотрудников (прототип v85 modules/staff.js, `staffKanban`; docs/deviations.md п. О-77):
 * столбцы — роль (по умолчанию), статус, Telegram. Перетаскиванием меняется только роль — с вопросом
 * и теми же ограничениями, что «Сменить роль»; блокировка — только из меню сотрудника.
 */
export const STAFF_BOARD_BY = ['role', 'active', 'telegram'];

/**
 * Доска списка сотрудников: `roles` — роли организации (их столбцы видны и пустыми, по порядку
 * списка ролей); `drop` — перенос карточки.
 */
export function staffKanban<Row>(
  roles: readonly BoardValue[],
  drop: ((row: Row, key: string, to: BoardValue) => void) | undefined,
): GridKanban<Row> {
  return {
    by: STAFF_BOARD_BY,
    def: 'role',
    order: { role: roles.map((r) => r.key), active: ['active', 'blocked'] },
    show: { role: roles },
    ...(drop ? { drop } : {}),
  };
}

/**
 * Столбцы ролей по порядку списка ролей прототипа (`ROLES`: владелец, роли из шаблонов, новые — в
 * конец): роль владельца первой, остальные — по времени создания; роли, созданные одновременно (вместе
 * с организацией), остаются в порядке списка — по названию.
 */
export function boardRoles(
  roles: readonly Pick<RoleListItem, 'id' | 'name' | 'isOwner' | 'audit'>[],
): BoardValue[] {
  return [...roles]
    .sort(
      (a, b) =>
        Number(b.isOwner) - Number(a.isOwner) ||
        (a.audit.createdAt < b.audit.createdAt
          ? -1
          : a.audit.createdAt > b.audit.createdAt
            ? 1
            : 0),
    )
    .map((r) => ({ key: r.id, label: r.name }));
}

/** Что делает перенос сотрудника: вопрос о смене роли, ничего или отказ с причиной. */
export type StaffMove =
  { kind: 'role'; roleId: string } | { kind: 'none' } | { kind: 'refusal'; key: UiTextKey };

/**
 * Перенос сотрудника в столбец `to` доски по столбцу списка `key` (прототип `staffKanban.drop`):
 * только по роли, с правом «Сотрудники и роли», не у владельца и не у того, кого вести нельзя
 * (`manageable` с сервера), в роль, которую можно назначить (не роль владельца, не своя, не с правами
 * «выдаёт только владелец» и не шире своей — как в окне «Сменить роль»). `roles` — роли организации,
 * если список известен: без него роль проверит сервер.
 */
export function staffMove(
  e: Pick<Employee, 'role' | 'manageable'>,
  canManage: boolean,
  key: string,
  to: string,
  roles?: readonly Pick<RoleListItem, 'id' | 'isOwner' | 'readOnly'>[],
): StaffMove {
  if (key !== 'role') return { kind: 'refusal', key: 'staff.board.only' };
  if (!canManage) return { kind: 'refusal', key: 'staff.board.no_right' };
  if (e.role.isOwner) return { kind: 'refusal', key: 'staff.board.owner' };
  if (!e.manageable) return { kind: 'refusal', key: 'staff.board.locked' };
  if (to === e.role.id) return { kind: 'none' };
  const role = roles?.find((r) => r.id === to);
  if (roles && !role) return { kind: 'refusal', key: 'staff.board.role_locked' };
  if (role?.isOwner) return { kind: 'refusal', key: 'staff.board.owner_one' };
  if (role?.readOnly) return { kind: 'refusal', key: 'staff.board.role_locked' };
  return { kind: 'role', roleId: to };
}
