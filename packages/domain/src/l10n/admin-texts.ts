import type { UiTextDefault } from './texts';

const S = 'Админка';

/**
 * Тексты Админки → «Учётные записи» (ТЗ «Админка» → «Модуль учётных записей»; прототип
 * admin/accounts-orgs.js, renderAccounts и accActions). «Пароль сброшен» и «Временный пароль:» — из
 * словаря «Сотрудников».
 */
export const ADMIN_ACCOUNTS_TEXTS = {
  'accounts.count.one': { ru: '{n} учётная запись', section: S },
  'accounts.count.few': { ru: '{n} учётные записи', section: S },
  'accounts.count.many': { ru: '{n} учётных записей', section: S },
  'accounts.col.login': { ru: 'Логин', section: S },
  'accounts.col.full_name': { ru: 'ФИО', section: S },
  'accounts.col.org': { ru: 'Организация', section: S },
  'accounts.col.role': { ru: 'Роль', section: S },
  'accounts.col.last_login': { ru: 'Последний вход', section: S },
  'accounts.col.active': { ru: 'Статус', section: S },
  'accounts.active': { ru: 'Активен', section: S },
  'accounts.blocked': { ru: 'Заблокирован', section: S },
  'accounts.owner_blocked': { ru: 'Заблокирован владельцем', section: S },
  'accounts.owner_blocked_hint': {
    ru: 'Сотрудника заблокировал владелец организации: снять эту блокировку может только он.',
    section: S,
  },
  'accounts.action.reset': { ru: 'Сбросить пароль', section: S },
  'accounts.action.block': { ru: 'Заблокировать', section: S },
  'accounts.action.unblock': { ru: 'Разблокировать', section: S },
  'accounts.self': { ru: 'Это вы', section: S },
  'accounts.block.title': { ru: 'Заблокировать {login}?', section: S },
  'accounts.block.text': {
    ru: 'Пользователь не сможет войти, его сеансы завершатся.',
    section: S,
  },
  'accounts.block.done': { ru: 'Учётная запись заблокирована', section: S },
  'accounts.unblock.done': { ru: 'Учётная запись разблокирована', section: S },
  'accounts.reset.sessions': { ru: 'Все сеансы пользователя завершены.', section: S },
  'accounts.reset.sessions_tg': {
    ru: 'Все сеансы пользователя завершены, бот сообщил о смене пароля в Telegram.',
    section: S,
  },
  'err.account_self': { ru: 'Это ваша учётная запись', section: 'Ошибки' },
  'err.account_platform_admin': {
    ru: 'Учётные записи администраторов платформы здесь не меняются',
    section: 'Ошибки',
  },
} as const satisfies Record<string, UiTextDefault>;

/**
 * Тексты Админки → «Локализация» (ТЗ «Модуль Локализация»; прототип admin/l10n.js, renderL10n):
 * плашки языков, заметка, список словаря и окно «Текст интерфейса». Ошибки правки — п. Д-1
 * docs/deviations.md.
 */
export const ADMIN_L10N_TEXTS = {
  'locale.count.one': { ru: '{n} строка', section: S },
  'locale.count.few': { ru: '{n} строки', section: S },
  'locale.count.many': { ru: '{n} строк', section: S },
  'locale.col.key': { ru: 'Ключ', section: S },
  'locale.col.text': { ru: 'Русский текст', section: S },
  'locale.col.section': { ru: 'Раздел', section: S },
  'locale.lang.ru': { ru: 'Русский', section: S },
  'locale.lang.default_on': { ru: 'язык по умолчанию · включён', section: S },
  'locale.share': { ru: '{n} %', section: S },
  'locale.add_lang': { ru: 'Добавить язык', section: S },
  'locale.add_lang_sub': {
    ru: 'Заложено в логику, пока не используется. Выбор языка в профиле появится, когда языков станет больше одного.',
    section: S,
  },
  'locale.note': { ru: 'Изменённый текст применяется без изменения кода.', section: S },
  'locale.action.edit': { ru: 'Изменить текст', section: S },
  'locale.edit.title': { ru: 'Текст интерфейса', section: S },
  'locale.edit.field': { ru: 'Русский', section: S },
  'locale.edit.hint': { ru: 'Изменение применится без изменения кода', section: S },
  'locale.saved': { ru: 'Текст сохранён', section: S },
  'locale.err.empty': { ru: 'Введите текст', section: 'Ошибки' },
  'err.ui_text_placeholders': {
    ru: 'Подстановки в тексте должны остаться прежними: {names}',
    section: 'Ошибки',
  },
  'err.ui_text_placeholders.none': {
    ru: 'Уберите подстановки в фигурных скобках: у этого текста их нет',
    section: 'Ошибки',
  },
} as const satisfies Record<string, UiTextDefault>;

/**
 * Тексты Админки → «Организации» (ТЗ «Админка» → «Модуль организаций»; прототип
 * admin/accounts-orgs.js, renderOrgs и addOrgDlg). Общие ошибки формы («Введите название», «ИНН —
 * 14 цифр», логин, временный пароль, «Такой логин уже занят на платформе») — из словаря «Моей
 * организации» и «Сотрудников».
 */
export const ADMIN_TEXTS = {
  'orgs.count.one': { ru: '{n} организация', section: S },
  'orgs.count.few': { ru: '{n} организации', section: S },
  'orgs.count.many': { ru: '{n} организаций', section: S },
  'orgs.col.name': { ru: 'Название', section: S },
  'orgs.col.inn': { ru: 'ИНН', section: S },
  'orgs.col.owner': { ru: 'Владелец (логин)', section: S },
  'orgs.col.slug': { ru: 'Адрес страницы', section: S },
  'orgs.col.contractors': { ru: 'Контрагентов', section: S },
  'orgs.col.employees': { ru: 'Сотрудников', section: S },
  'orgs.col.registered': { ru: 'Регистрация', section: S },
  'orgs.col.active': { ru: 'Статус', section: S },
  'orgs.active': { ru: 'Активна', section: S },
  'orgs.blocked': { ru: 'Заблокирована', section: S },
  'orgs.plate.active': { ru: 'Организаций', section: S },
  'orgs.plate.active_sub': { ru: 'активных', section: S },
  'orgs.plate.contractors': { ru: 'Контрагентов на платформе', section: S },
  'orgs.plate.users': { ru: 'Пользователей', section: S },
  'orgs.plate.requests': { ru: 'Запросы на добавление', section: S },
  'orgs.plate.requests_sub': { ru: 'в справочники', section: S },
  'orgs.action.block': { ru: 'Заблокировать', section: S },
  'orgs.action.unblock': { ru: 'Разблокировать', section: S },
  'orgs.demo_reason': { ru: 'Демо-организация стенда', section: S },
  'orgs.block.title': { ru: 'Заблокировать {name}?', section: S },
  'orgs.block.text': {
    ru: 'Никто из сотрудников организации не сможет войти. Данные сохранятся, разблокировать можно в любой момент.',
    section: S,
  },
  'orgs.block.reason': { ru: 'Заблокирована администратором', section: S },
  'orgs.block.done': { ru: 'Организация заблокирована', section: S },
  'orgs.unblock.done': { ru: 'Организация разблокирована', section: S },
  'orgs.new.title': { ru: 'Новая организация', section: S },
  'orgs.new.sub': { ru: 'Создаётся вместе с учётной записью владельца', section: S },
  'orgs.new.owner_fio': { ru: 'ФИО владельца', section: S },
  'orgs.new.owner_login': { ru: 'Логин владельца', section: S },
  'orgs.new.note': {
    ru: 'Организация получит копии шаблонов ролей «Главный бухгалтер» и «Бухгалтер» и учётную политику по умолчанию.',
    section: S,
  },
  'orgs.new.done': { ru: 'Организация и владелец созданы', section: S },
  'err.owner_fio_required': { ru: 'Введите ФИО', section: 'Ошибки' },
  'err.org_not_found': { ru: 'Организация не найдена', section: 'Ошибки' },
  'err.demo_org': { ru: 'Демо-организацию стенда не блокируют', section: 'Ошибки' },
} as const satisfies Record<string, UiTextDefault>;
