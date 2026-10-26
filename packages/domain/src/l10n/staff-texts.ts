import type { UiTextDefault } from './texts';

/**
 * Тексты модуля «Сотрудники» (задача #14 — список; прототип modules/staff.js, renderStaff): подписи
 * столбцов и значения; действия в списке (задача #16; прототип empActions, blockDlg). Окна
 * сотрудника и роли добавит задача #18.
 */
export const STAFF_TEXTS = {
  'staff.count.one': { ru: '{n} сотрудник', section: 'Сотрудники' },
  'staff.count.few': { ru: '{n} сотрудника', section: 'Сотрудники' },
  'staff.count.many': { ru: '{n} сотрудников', section: 'Сотрудники' },
  'staff.col.full_name': { ru: 'ФИО', section: 'Сотрудники' },
  'staff.col.login': { ru: 'Логин', section: 'Сотрудники' },
  'staff.col.phone': { ru: 'Телефон', section: 'Сотрудники' },
  'staff.col.role': { ru: 'Роль', section: 'Сотрудники' },
  'staff.col.telegram': { ru: 'Telegram', section: 'Сотрудники' },
  'staff.col.last_login': { ru: 'Последний вход', section: 'Сотрудники' },
  'staff.col.active': { ru: 'Статус', section: 'Сотрудники' },
  'staff.active': { ru: 'Активен', section: 'Сотрудники' },
  'staff.blocked': { ru: 'Заблокирован', section: 'Сотрудники' },
  'staff.telegram.linked': { ru: 'Привязан', section: 'Сотрудники' },
  'staff.telegram.none': { ru: 'Не привязан', section: 'Сотрудники' },
  'staff.telegram.linked_pill': { ru: 'привязан', section: 'Сотрудники' },
  'staff.telegram.none_pill': { ru: 'не привязан', section: 'Сотрудники' },
  'staff.action.reset_password': { ru: 'Сбросить пароль', section: 'Сотрудники' },
  'staff.action.block': { ru: 'Заблокировать', section: 'Сотрудники' },
  'staff.action.unblock': { ru: 'Разблокировать', section: 'Сотрудники' },
  'staff.action.block_self': { ru: 'Нельзя заблокировать себя', section: 'Сотрудники' },
  'staff.block.title': { ru: 'Заблокировать {name}?', section: 'Сотрудники' },
  'staff.block.text': {
    ru: 'Сотрудник не сможет войти. Его история сохранится.',
    section: 'Сотрудники',
  },
  'staff.block.done': { ru: 'Сотрудник заблокирован', section: 'Сотрудники' },
  'staff.unblock.done': { ru: 'Сотрудник разблокирован', section: 'Сотрудники' },
  'staff.reset.title': { ru: 'Пароль сброшен', section: 'Сотрудники' },
  'staff.reset.password': { ru: 'Временный пароль:', section: 'Сотрудники' },
  'staff.reset.text': {
    ru: 'Передайте его сотруднику лично. При первом входе нужно будет задать свой пароль. Все прежние сеансы завершены.',
    section: 'Сотрудники',
  },
} as const satisfies Record<string, UiTextDefault>;
