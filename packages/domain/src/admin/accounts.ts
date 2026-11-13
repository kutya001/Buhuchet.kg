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

/**
 * Состояния учётной записи цветными метками в карточке пользователя (ТЗ «Админка» → «Карточка
 * пользователя», шапка; прототип admin-cards.js, acStates): их может быть несколько — заблокирован и
 * не сменил временный пароль. Обе блокировки показываются отдельно (docs/deviations.md, п. 49).
 */
export const ACCOUNT_CARD_STATES = [
  'active',
  'blocked_admin',
  'blocked_owner',
  'login_locked',
  // Вход закрыт кнопкой «Это не я» под сообщением бота (прототип v101, acStates).
  'login_locked_not_me',
  'temp_password',
] as const;
export type AccountCardState = (typeof ACCOUNT_CARD_STATES)[number];

export function accountStates(account: {
  isPlatformAdmin: boolean;
  blocked: boolean;
  employeeActive: boolean;
  loginLocked: boolean;
  loginLockReason?: string | null;
  mustChangePassword: boolean;
}): AccountCardState[] {
  // Учётные записи администраторов платформы из Админки не меняются: только «Активен» или блокировка.
  if (account.isPlatformAdmin) return [account.blocked ? 'blocked_admin' : 'active'];
  const out: AccountCardState[] = [];
  if (account.blocked) out.push('blocked_admin');
  if (!account.employeeActive) out.push('blocked_owner');
  if (account.loginLocked) {
    out.push(account.loginLockReason === 'not_me' ? 'login_locked_not_me' : 'login_locked');
  }
  if (account.mustChangePassword) out.push('temp_password');
  return out.length ? out : ['active'];
}

/** Вкладки карточки пользователя: у администратора платформы — только три (прототип accCard). */
export const ACCOUNT_CARD_TABS = ['main', 'work', 'ses', 'kb', 'tg', 'hist'] as const;
export type AccountCardTab = (typeof ACCOUNT_CARD_TABS)[number];

export function accountCardTabs(isPlatformAdmin: boolean): AccountCardTab[] {
  return isPlatformAdmin ? ['main', 'ses', 'hist'] : [...ACCOUNT_CARD_TABS];
}
