/**
 * Админка → «Учётные записи» (ТЗ «Админка» → «Модуль учётных записей»; прототип admin/accounts-orgs.js,
 * renderAccounts и accActions).
 *
 * Блокировок у учётной записи две, и они не снимают друг друга (docs/decisions.md, п. 17): администратор
 * платформы блокирует учётную запись (`users.blocked`), владелец организации — сотрудника
 * (`employees.active = false`). Войти нельзя ни при одной. В прототипе флаг один, поэтому статус
 * «Заблокирован владельцем» — отдельный (docs/deviations.md, п. 49).
 */
export const ACCOUNT_STATUSES = ['active', 'blocked', 'owner_blocked'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/**
 * Статус учётной записи в списке: блокировка администратором платформы главнее — её видно и тогда,
 * когда сотрудника заблокировал и владелец.
 */
export function accountStatus(account: {
  blocked: boolean;
  employeeActive: boolean;
}): AccountStatus {
  if (account.blocked) return 'blocked';
  return account.employeeActive ? 'active' : 'owner_blocked';
}

/**
 * Почему с учётной записью ничего нельзя сделать из Админки: `self` — это сам администратор (прототип:
 * пункт «Это вы»), `platform_admin` — другой администратор платформы (их учётные записи ведёт служебная
 * команда `pnpm db:create-admin`, у них нет организации и истории). null — можно сбросить пароль,
 * заблокировать и разблокировать.
 */
export function accountActionRefusal(
  actorUserId: string,
  account: { id: string; isPlatformAdmin: boolean },
): 'self' | 'platform_admin' | null {
  if (account.id === actorUserId) return 'self';
  if (account.isPlatformAdmin) return 'platform_admin';
  return null;
}
