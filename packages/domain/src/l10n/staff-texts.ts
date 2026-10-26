import type { UiTextDefault } from './texts';

/**
 * Тексты модуля «Сотрудники» (задача #14 — список; прототип modules/staff.js, renderStaff): подписи
 * столбцов и значения. Окна сотрудника и роли добавит задача #18.
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
} as const satisfies Record<string, UiTextDefault>;
