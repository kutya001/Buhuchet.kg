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
 * владельца, у роли с сотрудниками и у роли новых сотрудников по учётной политике. Остальные отказы
 * (роль есть только у заблокированных, роль с правами «выдаёт только владелец») проверяет сервер.
 */
export function roleMenu({
  canDelete,
  defaultRoleId,
  t,
  run,
}: {
  canDelete: boolean;
  /** Роль новых сотрудников из учётной политики. */
  defaultRoleId: string | null | undefined;
  t: Translate;
  run: RoleMenuRun;
}): (r: RoleListItem) => ActionEntry[] {
  return (r) => {
    const list: ActionEntry[] = [
      { id: 'open', label: t('roles.action.open'), icon: 'shield', run: () => run.open(r) },
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
