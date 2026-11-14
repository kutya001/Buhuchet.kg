import { MONTH_PAY_MESSAGES } from '../reports/month-pay';
import type { UiTextDefault } from './texts';

const S = 'Отчеты для сдачи';
const E = 'Ошибки';

/**
 * «К сдаче и к оплате по месяцам» (решение заказчика 13.11.2026, прототип v90
 * `modules/report-months.js`): вкладка «Отчёты к сдаче» карточки контрагента и вкладка «По месяцам»
 * модуля «Отчеты для сдачи».
 */
export const REPORT_MONTHS_TEXTS = {
  // Заголовок месяца: «За октябрь 2026» (прототип `rmTitle`).
  'report.months.title': { ru: 'За {month} {y}', section: S },
  // Итог месяца одной строкой (прототип `rmSumHtml`).
  'report.months.late': { ru: 'просрочено {n}', section: S },
  'report.months.submitted': { ru: 'сдано {done} из {n}', section: S },
  'report.months.to_pay': { ru: 'к уплате {amount}', section: S },
  'report.months.to_pay_left': { ru: 'к уплате {amount} · осталось {left}', section: S },
  'report.months.to_pay_paid': { ru: 'к уплате {amount} · оплачено', section: S },
  'report.months.no_amount': { ru: 'без суммы {n}', section: S },
  'report.months.no_amount_title': { ru: 'Сумма к уплате ещё не указана', section: S },
  'report.months.due_one': { ru: 'срок {date}', section: S },
  'report.months.due_range': { ru: 'сроки {from}–{to}', section: S },
  // Таблица месяца (прототип `rmMonthHtml`, `rmRowHtml`).
  'report.months.col.report': { ru: 'Отчёт', section: S },
  'report.months.total': { ru: 'Итого за месяц', section: S },
  'report.months.total_left': { ru: 'осталось {amount}', section: S },
  'report.months.table': { ru: 'Отчёты {title}', section: S },
  'report.months.row_menu': { ru: 'Действия с отчётом', section: S },
  'report.months.fold': { ru: 'Свернуть месяц', section: S },
  'report.months.unfold': { ru: 'Раскрыть месяц', section: S },
  // Вкладка «Отчёты к сдаче» карточки контрагента (прототип `rmCardHtml`).
  'report.months.mode.label': { ru: 'Как показать отчёты', section: S },
  'report.months.mode.months': { ru: 'По месяцам', section: S },
  'report.months.mode.list': { ru: 'Списком', section: S },
  'report.months.left_all': { ru: 'Осталось оплатить:', section: S },
  'report.months.closed': { ru: 'Закрытые месяцы · {n}', section: S },
  'report.months.empty.none': {
    ru: 'Отчётов у контрагента пока нет: назначьте их на вкладке «Подбор отчётов»',
    section: S,
  },
  'report.months.empty.sub': { ru: 'Все отчёты сданы', section: S },
  'report.months.empty.pay': { ru: 'Неоплаченных налогов нет', section: S },
  'report.months.empty.all': {
    ru: 'Всё сдано и оплачено. Прошлые месяцы — по галочке «Закрытые месяцы»',
    section: S,
  },
  'report.months.hint': {
    ru: 'Месяц отчёта — месяц, которым заканчивается его период: квартальные и годовые отчёты стоят в последнем месяце периода. Нажмите на отчёт — откроется его карточка; «⋯» — действия: статус, сумма, оплата.',
    section: S,
  },
  'report.months.load_error': { ru: 'Не удалось загрузить отчёты', section: S },
  // Блок «К оплате клиенту» под месяцем в карточке контрагента (задача К4; прототип v94 `rmPayHtml`,
  // `rmPayMount`).
  'report.months.pay.title': { ru: 'К оплате клиенту', section: S },
  'report.months.pay.label': { ru: 'К оплате клиенту {title}', section: S },
  'report.months.pay.due': { ru: 'до {date}', section: S },
  'report.months.pay.no_amount': { ru: 'без суммы {n} — в сообщение не войдут', section: S },
  'report.months.pay.copy': { ru: 'Скопировать для клиента', section: S },
  'report.months.pay.copied': { ru: 'Текст для клиента скопирован', section: S },
  'report.months.pay.hist': { ru: 'Скопирован текст «К оплате» за {month}: {total}', section: S },
  'err.month_pay_empty': { ru: MONTH_PAY_MESSAGES.month_pay_empty, section: E },
  'err.month_pay_requisite_hidden': {
    ru: MONTH_PAY_MESSAGES.month_pay_requisite_hidden,
    section: E,
  },
  'err.month_pay_partial': { ru: MONTH_PAY_MESSAGES.month_pay_partial, section: E },
  'report.months.pay.load_error': { ru: 'Не удалось подготовить текст для клиента', section: S },
  'report.months.pay.send': { ru: 'Отправить в Telegram', section: S },
  'report.months.pay.send_title': { ru: 'Отправить «К оплате» в Telegram?', section: S },
  'report.months.pay.send_text': {
    ru: 'Клиент получит в Telegram налоги {title}: {total} до {date}',
    section: S,
  },
  'report.months.pay.send_no_amount': {
    ru: '. Отчётов без суммы — {n}: в сообщение они не войдут',
    section: S,
  },
  'report.months.pay.send_recipients': { ru: '. Получателей: {n}.', section: S },
  'report.months.pay.send_ok': { ru: 'Отправить', section: S },
  'report.months.pay.sent': {
    ru: '«К оплате» отправлено в Telegram: получателей — {n}',
    section: S,
  },
  // Вкладка «По месяцам» модуля (прототип `rmRender`).
  'report.months.now': { ru: 'Прошлый месяц', section: S },
  'report.months.now_title': { ru: 'Месяц, отчёты за который сдаются сейчас', section: S },
  'report.months.head_hint': {
    ru: 'Что сдать и оплатить за месяц: по каким контрагентам и к какому сроку',
    section: S,
  },
  'report.months.cps.one': { ru: '{n} контрагент', section: S },
  'report.months.cps.few': { ru: '{n} контрагента', section: S },
  'report.months.cps.many': { ru: '{n} контрагентов', section: S },
  'report.months.empty.title': { ru: '{title} отчётов нет', section: S },
  'report.months.empty.move': { ru: 'Выберите другой месяц стрелками.', section: S },
  'report.months.empty.quick': {
    ru: 'По выбранной плашке за этот месяц ничего не осталось.',
    section: S,
  },
} as const satisfies Record<string, UiTextDefault>;
