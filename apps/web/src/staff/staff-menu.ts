import type { Employee } from '@buhuchet/shared';
import type { ActionEntry } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/** Что делают пункты меню сотрудника: открывают окно или отправляют запрос. */
export interface StaffMenuRun {
  open: (e: Employee) => void;
  edit: (e: Employee) => void;
  changeRole: (e: Employee) => void;
  resetPassword: (e: Employee) => void;
  block: (e: Employee) => void;
  unblock: (e: Employee) => void;
}

/**
 * Пункты меню сотрудника (прототип modules/staff.js, empActions): «Открыть карточку» — всем, кто видит
 * список. С правом «Сотрудники и роли» — ещё «Изменить» (ФИО и телефон, docs/deviations.md, п. 16;
 * владельца меняет только он сам — `canEditEmployee`), а у того, кого можно вести (`manageable` с
 * сервера), — «Сменить роль», «Сбросить пароль», черта и «Заблокировать» (красным) или у
 * заблокированного — «Разблокировать». Где вести нельзя — у владельца организации, у себя, у
 * сотрудника с правами «выдаёт только владелец» и с ролью шире своей, — этих пунктов нет (ТЗ, решение
 * заказчика 27.10.2026: недоступные кнопки скрыты; прототип core/org.js, empLocked). «Передать
 * контрагентов» добавит модуль «Контрагенты» (поток А). `card` — меню кнопки «Действия» в карточке:
 * без «Открыть карточку» и без «Изменить» — в карточке это отдельная кнопка (ТЗ «Сотрудники»:
 * «кнопкой «Изменить» в карточке сотрудника»).
 */
export function staffMenu({
  canManage,
  employeeId,
  t,
  run,
  card = false,
}: {
  canManage: boolean;
  /** Вошедший сотрудник. */
  employeeId: string | null;
  t: Translate;
  run: StaffMenuRun;
  card?: boolean;
}): (e: Employee) => ActionEntry[] {
  return (e) => {
    const open: ActionEntry[] = card
      ? []
      : [{ id: 'open', label: t('staff.action.open'), icon: 'user', run: () => run.open(e) }];
    const edit: ActionEntry[] =
      card || !canEditEmployee(canManage, employeeId, e)
        ? []
        : [{ id: 'edit', label: t('staff.action.edit'), icon: 'edit', run: () => run.edit(e) }];
    if (!canManage) return open;
    if (!e.manageable) return [...open, ...edit];
    return [
      ...open,
      ...edit,
      {
        id: 'change-role',
        label: t('staff.action.change_role'),
        icon: 'shield',
        run: () => run.changeRole(e),
      },
      {
        id: 'reset-password',
        label: t('staff.action.reset_password'),
        icon: 'key',
        run: () => run.resetPassword(e),
      },
      { id: 'sep', separator: true },
      e.active
        ? {
            id: 'block',
            label: t('staff.action.block'),
            icon: 'lock',
            danger: true,
            run: () => run.block(e),
          }
        : {
            id: 'unblock',
            label: t('staff.action.unblock'),
            icon: 'key',
            run: () => run.unblock(e),
          },
    ];
  };
}

/**
 * Можно ли «Изменить» ФИО и телефон сотрудника (docs/deviations.md, п. 16): с правом «Сотрудники и
 * роли» — у любого не владельца, в том числе у себя; ФИО и телефон владельца — только сам владелец.
 */
export function canEditEmployee(
  canManage: boolean,
  employeeId: string | null,
  e: Pick<Employee, 'id' | 'role'>,
): boolean {
  return canManage && (!e.role.isOwner || e.id === employeeId);
}
