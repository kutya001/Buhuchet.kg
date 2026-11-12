import { bishkekDate, bishkekTime, formatDateRu, type SessionEndReason } from '@buhuchet/domain';
import type { UiTextKey } from '@buhuchet/domain';
import type { AdminUserCard } from '@buhuchet/shared';
import type { TimelineItem } from '@buhuchet/ui';
import type { Translate } from '../l10n/translate';

// Тексты карточки пользователя в Админке (прототип v83, admin/admin-cards.js: acHist, SES_COLS).

type HistoryEntry = AdminUserCard['history'][number];

/** Поле истории → ключ подписи; смена роли пишется двумя полями (`roleId`, `roleName`) — подпись одна. */
const FIELD_KEYS: Readonly<Record<string, UiTextKey>> = {
  fullName: 'accounts.card.hist.field.full_name',
  shortName: 'accounts.card.hist.field.short_name',
  login: 'accounts.card.hist.field.login',
  phone: 'accounts.card.hist.field.phone',
  roleId: 'accounts.card.hist.field.role',
  roleName: 'accounts.card.hist.field.role',
  passwordHash: 'accounts.card.hist.field.password',
  mustChangePassword: 'accounts.card.hist.field.temp_password',
  loginLocked: 'accounts.card.hist.field.login_locked',
  blocked: 'accounts.card.hist.field.blocked',
  active: 'accounts.card.hist.field.active',
  telegram: 'accounts.card.hist.field.telegram',
  notify: 'accounts.card.hist.field.notify',
};

/**
 * Что произошло — строкой «Истории». У действий с пояснением (сброс пароля, блокировка, открытие
 * карточки, завершение сеансов) — само пояснение; у остальных — по виду записи и изменённым полям.
 */
export function accountHistoryText(t: Translate, h: HistoryEntry): string {
  if (h.reason) return h.reason;
  if (h.action === 'create') {
    return t(
      h.entity === 'employee'
        ? 'accounts.card.hist.employee_created'
        : 'accounts.card.hist.user_created',
    );
  }
  if (h.action === 'login_lock') return t('accounts.card.hist.login_lock');
  const fields = [...new Set(h.fields.map((f) => (FIELD_KEYS[f] ? t(FIELD_KEYS[f]) : f)))];
  return fields.length
    ? t('accounts.card.hist.updated', { fields: fields.join(', ') })
    : t('accounts.card.hist.changed');
}

/** Кто: сотрудник организации, администратор платформы или «Система». */
export function accountHistoryWho(t: Translate, h: HistoryEntry): string {
  if (h.actor) return h.actor;
  return t(h.actorAdmin ? 'accounts.card.hist.admin' : 'status.system');
}

/** «История» карточки: сверху новые (порядок ответа сервера). */
export function accountHistoryItems(
  t: Translate,
  history: readonly HistoryEntry[],
): TimelineItem[] {
  return history.map((h) => {
    const at = new Date(h.at);
    return {
      id: h.id,
      date: formatDateRu(bishkekDate(at)),
      time: bishkekTime(at),
      text: accountHistoryText(t, h),
      who: accountHistoryWho(t, h),
    };
  });
}

/** Чем закрыт сеанс — рядом с меткой «Закрыт» (прототип `s.how`). */
export function sessionEndText(t: Translate, reason: SessionEndReason | null): string {
  return reason ? t(`accounts.card.ses.reason.${reason}`) : '';
}

/** Адрес карточки пользователя на странице «Учётные записи»: `#accounts/<логин>` (прототип admCardRoute). */
export const ACCOUNT_HASH = /^#accounts\/(.+)$/;

/** Логин из адреса `#accounts/<логин>`; не тот адрес или битая кодировка — null. */
export function accountHashLogin(hash: string): string | null {
  const m = ACCOUNT_HASH.exec(hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!).trim() || null;
  } catch {
    return null;
  }
}
