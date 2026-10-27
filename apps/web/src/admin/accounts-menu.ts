import { accountActionRefusal } from '@buhuchet/domain';
import type { AdminUser } from '@buhuchet/shared';
import type { ActionEntry } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

/** Что делают пункты меню учётной записи. */
export interface AccountMenuRun {
  resetPassword: (u: AdminUser) => void;
  block: (u: AdminUser) => void;
  unblock: (u: AdminUser) => void;
}

/**
 * Пункты меню учётной записи в Админке (прототип admin/accounts-orgs.js, accActions): «Сбросить
 * пароль», черта и «Заблокировать» (красным, после вопроса) или у заблокированной администратором —
 * «Разблокировать» (сразу). Блокировку сотрудника владельцем администратор не снимает: у такой записи
 * «Заблокировать» (docs/deviations.md, п. 49). На своей строке — недоступный пункт «Это вы», как в
 * прототипе; у других администраторов платформы пунктов нет (`accountActionRefusal`).
 */
export function accountMenu({
  userId,
  t,
  run,
}: {
  /** Вошедший администратор. */
  userId: string;
  t: Translate;
  run: AccountMenuRun;
}): (u: AdminUser) => ActionEntry[] {
  return (u) => {
    const refusal = accountActionRefusal(userId, u);
    if (refusal === 'self') {
      return [
        { id: 'self', label: t('accounts.self'), icon: 'user', disabled: true, run: () => {} },
      ];
    }
    if (refusal) return [];
    return [
      {
        id: 'reset-password',
        label: t('accounts.action.reset'),
        icon: 'key',
        run: () => run.resetPassword(u),
      },
      { id: 'sep', separator: true },
      u.blocked
        ? {
            id: 'unblock',
            label: t('accounts.action.unblock'),
            icon: 'key',
            run: () => run.unblock(u),
          }
        : {
            id: 'block',
            label: t('accounts.action.block'),
            icon: 'lock',
            danger: true,
            run: () => run.block(u),
          },
    ];
  };
}
