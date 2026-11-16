import type { UiTextDefault } from './texts';

const S = 'Колокольчик';

/**
 * Фразы строк колокольчика (доработки 16.11.2026, блок 3; поток Т; прототип v122 `modules/bell.js`):
 * что случилось — одной фразой, без имени контрагента (его панель показывает отдельно). Тексты самой
 * панели (значок, фильтры, «Прочитать все») — поток И.
 */
export const BELL_TEXTS = {
  'bell.line.day': { ru: 'Сроки на сегодня: {list}', section: S },
  'bell.line.day.none': { ru: 'нет', section: S },
  'bell.line.day.reports.one': { ru: '{n} отчёт', section: S },
  'bell.line.day.reports.few': { ru: '{n} отчёта', section: S },
  'bell.line.day.reports.many': { ru: '{n} отчётов', section: S },
  'bell.line.day.pay.one': { ru: '{n} оплата', section: S },
  'bell.line.day.pay.few': { ru: '{n} оплаты', section: S },
  'bell.line.day.pay.many': { ru: '{n} оплат', section: S },
  'bell.line.day.over': { ru: '; просрочено {n}', section: S },
  'bell.line.day.soon': { ru: '; скоро {n}', section: S },
  'bell.line.conf_wait': { ru: 'Ждут подтверждения сдачи: {n}', section: S },
  'bell.line.task_day': { ru: 'Задачи: {list}', section: S },
  'bell.line.task_day.soon': { ru: 'завтра срок {n}', section: S },
  'bell.line.task_day.over': { ru: 'просрочено {n}', section: S },
  'bell.line.task_day.wait': { ru: 'ждут подтверждения {n}', section: S },
  'bell.line.week': { ru: 'Сводка недели: сдать {sub}, просрочено {over}', section: S },
  'bell.line.week.debt': { ru: ', должников за обслуживание {n}', section: S },
  'bell.line.task.new': { ru: 'Новая задача: {task}', section: S },
  'bell.line.task.on_confirm': { ru: 'Ждёт подтверждения: {task}', section: S },
  'bell.line.task.confirmed': { ru: 'Задача подтверждена: {task}', section: S },
  'bell.line.task.rework': { ru: 'Задача на доработке: {task}', section: S },
  'bell.line.task.cancelled': { ru: 'Задача отменена: {task}', section: S },
  'bell.line.task.started': { ru: 'Задача взята в работу: {task}', section: S },
  'bell.line.task.done': { ru: 'Задача выполнена: {task}', section: S },
  'bell.line.reason': { ru: '. Причина: {reason}', section: S },
  'bell.line.report_fix': { ru: 'На исправление: {report}', section: S },
  'bell.line.nudge': { ru: '{name} напоминает о просроченном: {n}', section: S },
  'bell.line.cp_file.one': { ru: 'Новый файл от контрагента', section: S },
  'bell.line.cp_file.many': { ru: 'Новые файлы от контрагента: {n}', section: S },
  'bell.line.cp_paid.page': {
    ru: 'Сообщил об оплате: {what} — {sum}, чек в «Отправленных файлах»',
    section: S,
  },
  'bell.line.cp_paid.tax': { ru: 'налоги', section: S },
  'bell.line.cp_paid.tax_month': { ru: 'налоги за {month}', section: S },
  'bell.line.cp_paid.fee': { ru: 'обслуживание', section: S },
  'bell.line.cp_paid.fee_month': { ru: 'обслуживание за {month}', section: S },
  'bell.line.cp_paid.tg': {
    ru: 'Сообщил в Telegram об оплате налогов за {month}: {sum}',
    section: S,
  },
  'bell.line.fee_paid': { ru: 'Сообщил в Telegram об оплате за обслуживание: {sum}', section: S },
  'bell.line.cp_tg_request': { ru: 'Просит подключить Telegram: {name}', section: S },
  'bell.line.cp_question': { ru: 'Вопрос из Telegram: {text}', section: S },
  // Приёмка «Колокольчик против Telegram» (доработки 16.11.2026, этап 2; прототип v126).
  'bell.line.cp_no_req': {
    ru: 'Не отправлено «К оплате» за {month}: нет реквизитов для перевода',
    section: S,
  },
  'bell.line.page_closed': {
    ru: 'Страница закрыта: {n} неверных кодов за сутки, откроется после смены кода',
    section: S,
  },
  'bell.line.login_locked': { ru: 'Вход заблокирован: 10 неверных паролей подряд', section: S },
  'bell.line.login_locked.staff': {
    ru: 'Вход сотрудника {name} заблокирован: 10 неверных паролей подряд',
    section: S,
  },
  'bell.line.not_me': {
    ru: 'Сотрудник {name} нажал «Это не я»: вход закрыт, выдайте новый пароль',
    section: S,
  },
  'bell.line.broadcast': { ru: 'Сообщение платформы: {text}', section: S },
  'bell.line.lead': { ru: 'Новая заявка с сайта: {name}', section: S },
} as const satisfies Record<string, UiTextDefault>;
