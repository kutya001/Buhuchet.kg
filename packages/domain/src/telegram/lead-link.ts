/*
 * Telegram заявителя — до создания организации (поток Т, доработки 14.11.2026, блок 1, пункты 2–3;
 * прототип v113 modules/tg-lead.js). После заявки — одноразовая ссылка на бота платформы на 24 часа
 * («/start l_<ключ>»): «Старт» подключает Telegram к заявке, бот отвечает «Заявка получена» (или
 * причиной отказа, если отказ уже был). После «Одобрить» Telegram заявителя становится Telegram
 * владельца, а бот присылает «Организация создана» и кнопку «Задать пароль»: страница на сайте, ссылка
 * действует 7 дней и один раз (новая отменяет прежнюю). Отказ — причина заявителю в Telegram.
 */

/** Ссылка «Подключить Telegram» после заявки действует, часов (прототип `LEAD_TG_TTL_H`). */
export const LEAD_TG_TTL_HOURS = 24;
/** Ссылка «Задать пароль» действует, дней (прототип `OWNER_SETUP_DAYS`). */
export const OWNER_SETUP_DAYS = 7;
/** Приставка параметра «/start» ссылки заявителя (прототип: `?start=l_<ключ>`). */
export const LEAD_TG_START_PREFIX = 'l_';
/** Ключ ссылки — 43 знака base64url (32 случайных байта, как у ссылки привязки Telegram). */
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Ключ из параметра «/start l_<ключ>»; null — это не ссылка заявителя. Ключ привязки сотрудника —
 * те же 43 знака без приставки и может сам начинаться с «l_»: его длина 43, а не 45.
 */
export function leadTgStartToken(payload: string | null): string | null {
  if (!payload?.startsWith(LEAD_TG_START_PREFIX)) return null;
  const key = payload.slice(LEAD_TG_START_PREFIX.length);
  return KEY_RE.test(key) ? key : null;
}

/** Ссылка на бота платформы для заявителя. */
export function leadTgUrl(botUsername: string, key: string): string {
  return `https://t.me/${botUsername}?start=${LEAD_TG_START_PREFIX}${key}`;
}

/** Похоже ли значение на ключ ссылки «Задать пароль»: чужое и мусор — без запроса к базе. */
export const isSetupKeyShape = (value: string) => KEY_RE.test(value);

/** Путь страницы «Задать пароль» (прототип `setPassUrl`: buhuchet.kg/setpass/<ключ>). */
export const setPasswordPath = (key: string) => `/setpass/${key}`;

/** Имя подключившего Telegram для истории заявки — «@имя» или имя из профиля Telegram. */
export function leadTgName(from: { username: string | null; firstName: string | null }): string {
  if (from.username) return `@${from.username}`;
  const first = [...(from.firstName ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim()]
    .slice(0, 64)
    .join('');
  return first || 'Telegram';
}
