import type { ApiErrorLike, Translate } from '../l10n/translate';

/**
 * Текст ошибки входа — из словаря refDB v59, как в прототипе (core/login.js `LG_T`): один для любого
 * логина, о блокировке — только после верного пароля (docs/deviations.md, п. 4); у администратора
 * платформы — свой вариант. Остальные ответы (сеть, лимит запросов) — по коду, как везде.
 */
export function loginErrorText(
  t: Translate,
  errorText: (error: ApiErrorLike) => string,
  error: ApiErrorLike,
): string {
  const variant = (error.details as { variant?: unknown } | undefined)?.variant;
  switch (error.code) {
    case 'invalid_credentials':
      return t('auth.bad_login');
    case 'login_locked':
      return t('auth.locked');
    case 'org_blocked':
      return t('auth.org_blocked');
    case 'employee_blocked':
      return t('auth.user_blocked');
    case 'user_blocked':
      return variant ? errorText(error) : t('auth.user_blocked');
    default:
      return errorText(error);
  }
}
