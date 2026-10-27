import type { RoleListItem } from '@buhuchet/shared';
import type { ActionEntry } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/** Что делают пункты меню роли: открывают карточку, форму прав или вопрос об удалении. */
export interface RoleMenuRun {
  open: (r: RoleListItem) => void;
  edit: (r: RoleListItem) => void;
  remove: (r: RoleListItem) => void;
}

/**
 * Пункты меню роли (прототип modules/staff.js, roleActions): «Открыть» и «Изменить» — всем, кто видит
 * вкладку; у роли владельца «Изменить» недоступно: её права не меняются. С правом «Сотрудники и роли»
 * — ещё черта и красное «Удалить» (docs/deviations.md, п. 16): недоступно с причиной у роли
 * владельца, у роли с сотрудниками и у роли новых сотрудников («Моя организация» → «Настройки»).
 * Роль, которую не владелец видит только для чтения (`readOnly`: своя, с правами «выдаёт только
 * владелец», шире своей), — только «Открыть» (ТЗ, решение заказчика 27.10.2026: недоступные кнопки
 * скрыты). Роль, которая есть только у заблокированных, не удалит сервер.
 */
export function roleMenu({
  canDelete,
  defaultRoleId,
  t,
  run,
}: {
  canDelete: boolean;
  /** Роль новых сотрудников («Моя организация» → «Настройки»). */
  defaultRoleId: string | null | undefined;
  t: Translate;
  run: RoleMenuRun;
}): (r: RoleListItem) => ActionEntry[] {
  return (r) => {
    const open: ActionEntry = {
      id: 'open',
      label: t('roles.action.open'),
      icon: 'shield',
      run: () => run.open(r),
    };
    if (r.readOnly) return [open];
    const list: ActionEntry[] = [
      open,
      {
        id: 'edit',
        label: t('roles.action.edit'),
        icon: 'edit',
        disabled: r.isOwner,
        reason: r.isOwner ? t('roles.lock.owner_role') : undefined,
        run: () => run.edit(r),
      },
    ];
    if (!canDelete) return list;
    const reason = r.isOwner
      ? t('err.owner_role.delete')
      : r.employees > 0
        ? t('err.role_in_use')
        : r.id === defaultRoleId
          ? t('err.role_is_default')
          : undefined;
    return [
      ...list,
      { id: 'sep', separator: true },
      {
        id: 'delete',
        label: t('roles.action.delete'),
        icon: 'trash',
        danger: true,
        disabled: reason !== undefined,
        reason,
        run: () => run.remove(r),
      },
    ];
  };
}
