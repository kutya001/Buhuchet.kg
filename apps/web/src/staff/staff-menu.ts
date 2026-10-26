import type { Employee } from '@buhuchet/shared';
import type { ActionEntry } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/** Что делают пункты меню сотрудника: открывают окно или отправляют запрос. */
export interface StaffMenuRun {
  resetPassword: (e: Employee) => void;
  block: (e: Employee) => void;
  unblock: (e: Employee) => void;
}

/**
 * Пункты меню сотрудника в списке (прототип modules/staff.js, empActions). Без права «Сотрудники и
 * роли» меню нет совсем (undefined — у списка нет столбца «⋯»); у владельца организации пунктов нет
 * («⋯» на его строке не показывается). Остальным: «Сбросить пароль», черта и «Заблокировать» (красным)
 * или у заблокированного — «Разблокировать». На своей строке «Сбросить пароль» и «Заблокировать»
 * недоступны с причиной: себя не блокируют, а свой пароль меняют в «Мой профиль». Остальные запреты
 * проверяет сервер (docs/deviations.md, п. 15).
 */
export function staffMenu({
  canManage,
  employeeId,
  t,
  run,
}: {
  canManage: boolean;
  /** Вошедший сотрудник. */
  employeeId: string | null;
  t: Translate;
  run: StaffMenuRun;
}): ((e: Employee) => ActionEntry[]) | undefined {
  if (!canManage) return undefined;
  return (e) => {
    if (e.role.isOwner) return [];
    const self = e.id === employeeId;
    return [
      {
        id: 'reset-password',
        label: t('staff.action.reset_password'),
        icon: 'key',
        disabled: self,
        reason: self ? t('staff.action.reset_self') : undefined,
        run: () => run.resetPassword(e),
      },
      { id: 'sep', separator: true },
      e.active
        ? {
            id: 'block',
            label: t('staff.action.block'),
            icon: 'lock',
            danger: true,
            disabled: self,
            reason: self ? t('staff.action.block_self') : undefined,
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
