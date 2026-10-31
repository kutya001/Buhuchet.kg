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
  transfer: (e: Employee) => void;
}

/**
 * Пункты меню сотрудника (прототип modules/staff.js, empActions): «Открыть карточку» — всем, кто видит
 * список. С правом «Сотрудники и роли» — ещё «Изменить» (ФИО и телефон, docs/deviations.md, п. 16;
 * владельца меняет только он сам — `canEditEmployee`), а у того, кого можно вести (`manageable` с
 * сервера), — «Сменить роль», владельцу ещё «Сбросить пароль» (docs/deviations.md п. 11, решение
 * заказчика 30.10.2026: право «Сотрудники и роли» пароль не сбрасывает), черта и «Заблокировать»
 * (красным) или у заблокированного — «Разблокировать». Где вести нельзя — у владельца организации,
 * у себя, у сотрудника с правами «выдаёт только владелец» и с ролью шире своей, — этих пунктов нет
 * (ТЗ, решение заказчика 27.10.2026: недоступные кнопки скрыты; прототип core/org.js, empLocked).
 * «Передать контрагентов» — с правом «Сотрудники и роли» у всех, кроме владельца, и у тех, кого вести
 * нельзя (как в прототипе — до проверки `empLocked`); без закреплённых контрагентов (`cps` — 0) —
 * бледным с причиной, число неизвестно (null) — доступно. `card` — меню кнопки «Действия» в
 * карточке: без «Открыть карточку» и без «Изменить» — в карточке это отдельная кнопка (ТЗ
 * «Сотрудники»: «кнопкой «Изменить» в карточке сотрудника»).
 */
export function staffMenu({
  canManage,
  isOwner,
  employeeId,
  t,
  run,
  cps = () => null,
  card = false,
}: {
  canManage: boolean;
  /** Вошедший — владелец организации: только у него «Сбросить пароль». */
  isOwner: boolean;
  /** Вошедший сотрудник. */
  employeeId: string | null;
  t: Translate;
  run: StaffMenuRun;
  /** Сколько контрагентов закреплено за сотрудником; null — неизвестно. */
  cps?: (e: Employee) => number | null;
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
    const transfer: ActionEntry[] = e.role.isOwner
      ? []
      : [
          {
            id: 'transfer',
            label: t('cp.transfer.title'),
            icon: 'refresh',
            run: () => run.transfer(e),
            ...(cps(e) === 0 ? { disabled: true, reason: t('cp.transfer.none') } : {}),
          },
        ];
    if (!e.manageable) return [...open, ...edit, ...transfer];
    return [
      ...open,
      ...edit,
      ...transfer,
      {
        id: 'change-role',
        label: t('staff.action.change_role'),
        icon: 'shield',
        run: () => run.changeRole(e),
      },
      ...(isOwner
        ? [
            {
              id: 'reset-password',
              label: t('staff.action.reset_password'),
              icon: 'key',
              run: () => run.resetPassword(e),
            } satisfies ActionEntry,
          ]
        : []),
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
