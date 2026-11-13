import {
  bishkekDate,
  bishkekTime,
  formatDateRu,
  SECURITY_NOTICES,
  type SessionEndReason,
} from '@buhuchet/domain';
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

type HistoryChange = HistoryEntry['changes'][number];

const label = (t: Translate, field: string): string =>
  FIELD_KEYS[field] ? t(FIELD_KEYS[field]) : field;
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Одно изменение со значениями — как в истории прототипа (staff.js, profile.js): «Роль: А → Б»,
 * «Telegram привязан», «Заблокирован». null — значений нет, остаётся только название поля.
 */
function changeText(t: Translate, c: HistoryChange): string | null {
  if (c.field === 'telegram') {
    if (typeof c.to !== 'string' || !c.to) return t('accounts.card.hist.tg_unlinked');
    return typeof c.from === 'string' && c.from
      ? t('accounts.card.hist.tg_replaced', { from: c.from, to: c.to })
      : t('accounts.card.hist.tg_linked', { name: c.to });
  }
  // «Сообщения простым текстом» в «Мой профиль» (прототип profile.js, `#pf-tgplain`).
  if (c.field === 'telegramPlain' && typeof c.to === 'boolean') {
    return t(c.to ? 'accounts.card.hist.tg_plain_on' : 'accounts.card.hist.tg_plain_off');
  }
  // Блокировка сотрудника владельцем: `active` false — заблокирован.
  if (c.field === 'active' && typeof c.to === 'boolean') {
    return t(c.to ? 'accounts.card.hist.unblocked' : 'accounts.card.hist.blocked');
  }
  if (c.field === 'loginLocked' && c.to === false) return t('accounts.card.hist.login_unlock');
  if (typeof c.to !== 'string' || !c.to) return null;
  const field = capital(label(t, c.field));
  return typeof c.from === 'string' && c.from
    ? t('accounts.card.hist.value', { field, from: c.from, to: c.to })
    : t('accounts.card.hist.value_set', { field, to: c.to });
}

/**
 * «Это не я» под сообщением бота о безопасности (поток Т, задача Т4; прототип v101 tg-security.js,
 * запись истории): под каким сообщением нажали, сколько сеансов завершено, отвязан ли другой Telegram.
 * У администратора платформы вход не закрывается — «Все сеансы завершены».
 */
function notMeText(t: Translate, h: HistoryEntry): string {
  const of = (field: string) => h.changes.find((c) => c.field === field);
  const notice = of('notMe')?.to;
  const event =
    typeof notice === 'string' && (SECURITY_NOTICES as readonly string[]).includes(notice)
      ? t(`telegram.notme.event.${notice}`)
      : '';
  const locked = of('loginLocked')?.to === true;
  const sessions = Number(of('sessionsEnded')?.to) || 0;
  return [
    t(locked ? 'accounts.card.hist.not_me' : 'accounts.card.hist.not_me_admin', { event }),
    ...(sessions ? [t('accounts.card.hist.not_me_sessions', { n: sessions })] : []),
    ...(of('telegram') ? [t('accounts.card.hist.not_me_cut')] : []),
  ].join(', ');
}

/**
 * Что произошло — строкой «Истории». У действий с пояснением (сброс пароля, блокировка, открытие
 * карточки, завершение сеансов) — само пояснение; у остальных — по виду записи и изменениям: со
 * значениями «было → стало», где они есть (ТЗ: «кто, когда, было → стало»), остальные — «Изменено: …».
 */
export function accountHistoryText(t: Translate, h: HistoryEntry): string {
  // Бонусы сотрудника (прототип v84 `bonusOutDlg`, `bonusUndo`): основание списания — в причине записи.
  if (h.changes.some((c) => c.field === 'bonusOut'))
    return t('staff.bonus.hist.out', { note: h.reason ?? '' });
  if (h.changes.some((c) => c.field === 'bonusOutUndo')) return t('staff.bonus.hist.undo');
  if (h.reason) return h.reason;
  if (h.action === 'create') {
    return t(
      h.entity === 'employee'
        ? 'accounts.card.hist.employee_created'
        : 'accounts.card.hist.user_created',
    );
  }
  if (h.action === 'login_lock') return t('accounts.card.hist.login_lock');
  if (h.action === 'not_me') return notMeText(t, h);
  const valued = new Set<string>();
  const named = new Set<string>();
  const plain = new Set<string>();
  for (const c of h.changes) {
    const text = changeText(t, c);
    if (text) {
      valued.add(text);
      named.add(label(t, c.field));
    } else {
      plain.add(label(t, c.field));
    }
  }
  // Смена роли пишется двумя полями (`roleId`, `roleName`): «Роль: А → Б» уже сказала всё.
  const rest = [...plain].filter((f) => !named.has(f));
  const parts = [
    ...valued,
    ...(rest.length ? [t('accounts.card.hist.updated', { fields: rest.join(', ') })] : []),
  ];
  return parts.length ? parts.join('; ') : t('accounts.card.hist.changed');
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

/** «Ошибка» сообщения бота: подпись кода итога из словаря или ответ Telegram (как журнал «Телеграм»). */
export function telegramErrorText(t: Translate, error: string | null): string {
  if (!error) return t('tgadm.st.error');
  return error === 'recipient_unlinked' ? t('tgadm.err.unlinked') : error;
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
