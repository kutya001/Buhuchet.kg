import type { UiTextDefault } from './texts';

const S = 'Админка';

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
  'orgs.err.owner_fio': { ru: 'Введите ФИО', section: 'Ошибки' },
  'err.owner_fio_required': { ru: 'Введите ФИО владельца', section: 'Ошибки' },
  'err.org_not_found': { ru: 'Организация не найдена', section: 'Ошибки' },
  'err.demo_org': { ru: 'Демо-организацию стенда не блокируют', section: 'Ошибки' },
} as const satisfies Record<string, UiTextDefault>;
