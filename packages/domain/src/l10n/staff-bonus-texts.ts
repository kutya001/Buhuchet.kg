import type { UiTextDefault } from './texts';

const S = 'Бонусы сотрудников';

/**
 * Тексты бонусов сотрудников (прототип v84 и v87: modules/staff.js — вкладка «Бонусы», `bonusLogGrid`,
 * `bonusEmpDlg`, плашка «Накоплено бонусов» вкладки «Счёт»; modules/services.js — `serviceDlg`,
 * `serviceCard`, `bonusOutDlg`, `bonusUndo`). Отказы — `err.<код>` из `FIN_MESSAGES`.
 */
export const STAFF_BONUS_TEXTS = {
  // Вкладка «Бонусы»: разделы
  'staff.bonus.seg.label': { ru: 'Раздел бонусов', section: S },
  'staff.bonus.seg.bal': { ru: 'Остатки', section: S },
  'staff.bonus.seg.log': { ru: 'Начисления и списания', section: S },
  'staff.bonus.seg.cp': { ru: 'Остатки контрагентов', section: S },
  'staff.bonus.bal_note': {
    ru: 'Бонус начисляется при списании остатка контрагента и за разовую услугу после её полной оплаты, копится как остаток и списывается отдельно.',
    section: S,
  },
  'staff.bonus.log_note': {
    ru: 'Все начисления (со знаком «плюс») и списания бонусов.',
    section: S,
  },
  'staff.bonus.load_error': { ru: 'Не удалось загрузить бонусы', section: S },
  // Плашки
  'staff.bonus.plate.all': { ru: 'Накоплено бонусов', section: S },
  'staff.bonus.plate.all_sub': { ru: 'остаток у всех сотрудников', section: S },
  'staff.bonus.plate.bal': { ru: 'Остаток бонусов', section: S },
  'staff.bonus.plate.cp': { ru: 'Из остатков контрагентов', section: S },
  'staff.bonus.plate.svc': { ru: 'За разовые услуги', section: S },
  'staff.bonus.plate.out': { ru: 'Списано', section: S },
  'staff.bonus.plate.wait_sub': { ru: 'ожидает оплаты услуг: {amount}', section: S },
  // Столбцы «Остатков»
  'staff.bonus.col.fio': { ru: 'Сотрудник', section: S },
  'staff.bonus.col.role': { ru: 'Роль', section: S },
  'staff.bonus.col.cp': { ru: 'Из остатков контрагентов', section: S },
  'staff.bonus.col.svc': { ru: 'За разовые услуги', section: S },
  'staff.bonus.col.wait': { ru: 'Ожидает оплаты услуг', section: S },
  'staff.bonus.col.out': { ru: 'Списано', section: S },
  'staff.bonus.col.bal': { ru: 'Остаток бонусов', section: S },
  'staff.bonus.col.act': { ru: 'Списание', section: S },
  // Столбцы «Начислений и списаний»
  'staff.bonus.col.date': { ru: 'Дата', section: S },
  'staff.bonus.col.emp': { ru: 'Сотрудник', section: S },
  'staff.bonus.col.kind': { ru: 'Вид', section: S },
  'staff.bonus.col.contractor': { ru: 'Контрагент', section: S },
  'staff.bonus.col.what': { ru: 'Основание', section: S },
  'staff.bonus.col.sum': { ru: 'Сумма', section: S },
  'staff.bonus.col.by': { ru: 'Записал', section: S },
  'staff.bonus.kind.cp': { ru: 'Остаток контрагента', section: S },
  'staff.bonus.kind.svc': { ru: 'Разовая услуга', section: S },
  'staff.bonus.kind.wait': { ru: 'Ожидает оплаты услуги', section: S },
  'staff.bonus.kind.out': { ru: 'Списание', section: S },
  'staff.bonus.wait_what': { ru: '{name} · оплачено {paid} из {amount}', section: S },
  'staff.bonus.wait_tip': { ru: 'Начислится после полной оплаты услуги', section: S },
  'staff.bonus.rec.one': { ru: '{n} запись', section: S },
  'staff.bonus.rec.few': { ru: '{n} записи', section: S },
  'staff.bonus.rec.many': { ru: '{n} записей', section: S },
  'staff.bonus.empty': { ru: 'Начислений и списаний пока не было', section: S },
  // Действия
  'staff.bonus.act.log': { ru: 'Начисления и списания', section: S },
  'staff.bonus.act.out': { ru: 'Списать бонус', section: S },
  'staff.bonus.act.out_short': { ru: 'Списать', section: S },
  'staff.bonus.act.out_tip': { ru: 'Списать накопленный бонус', section: S },
  'staff.bonus.act.none': { ru: 'Накопленных бонусов нет', section: S },
  'staff.bonus.act.svc': { ru: 'Открыть услугу', section: S },
  'staff.bonus.act.op': { ru: 'Открыть операцию', section: S },
  'staff.bonus.act.card': { ru: 'Карточка контрагента', section: S },
  'staff.bonus.act.undo': { ru: 'Отменить списание', section: S },
  // Окно сотрудника
  'staff.bonus.emp_sub': { ru: 'Бонусы: начисления и списания', section: S },
  'staff.bonus.emp_done': { ru: 'Готово', section: S },
  // «Списать бонус»
  'staff.bonus.out.title': { ru: 'Списать бонус', section: S },
  'staff.bonus.out.sub': { ru: '{name} · накоплено {amount}', section: S },
  'staff.bonus.out.sum': { ru: 'Сумма, сом', section: S },
  'staff.bonus.out.sum_hint': { ru: 'Не больше остатка: {amount}', section: S },
  'staff.bonus.out.date': { ru: 'Дата', section: S },
  'staff.bonus.out.note': { ru: 'Основание', section: S },
  'staff.bonus.out.note_ph': { ru: 'Например: выдано с зарплатой за октябрь', section: S },
  'staff.bonus.out.info': {
    ru: 'Списание уменьшает накопленный остаток бонусов сотрудника. Деньги контрагентов и счёт сотрудника оно не меняет.',
    section: S,
  },
  'staff.bonus.out.cancel': { ru: 'Отмена', section: S },
  'staff.bonus.out.ok': { ru: 'Списать', section: S },
  'staff.bonus.out.done': { ru: 'Бонус списан: {amount}', section: S },
  // «Отменить списание бонуса?»
  'staff.bonus.undo.title': { ru: 'Отменить списание бонуса?', section: S },
  'staff.bonus.undo.text': {
    ru: '{name}: {amount} от {date} вернётся в накопленный остаток.',
    section: S,
  },
  'staff.bonus.undo.ok': { ru: 'Отменить списание', section: S },
  'staff.bonus.undo.done': { ru: 'Списание отменено', section: S },
  // История сотрудника в карточке пользователя Админки: без сумм, как остальные записи карточки
  'staff.bonus.hist.out': { ru: 'Списан бонус: {note}', section: S },
  'staff.bonus.hist.undo': { ru: 'Отменено списание бонуса', section: S },
  // Вкладка «Счёт» сотрудника: подпись плашки «Накоплено бонусов»
  'staff.bonus.acc.out': { ru: 'списано {amount}', section: S },
  'staff.bonus.acc.svc': { ru: 'в том числе за услуги {amount}', section: S },
  // Разовая услуга: строки бонусов в окне
  'fin.svc.bonus.label': { ru: 'Бонусы сотрудникам', section: S },
  'fin.svc.bonus.emp_pick': { ru: '— сотрудник —', section: S },
  'fin.svc.bonus.emp': { ru: 'Сотрудник', section: S },
  'fin.svc.bonus.amount_ph': { ru: 'Сумма, сом', section: S },
  'fin.svc.bonus.amount': { ru: 'Сумма бонуса, сом', section: S },
  'fin.svc.bonus.remove': { ru: 'Убрать', section: S },
  'fin.svc.bonus.remove_aria': { ru: 'Убрать бонус', section: S },
  'fin.svc.bonus.add': { ru: 'Добавить бонус', section: S },
  'fin.svc.bonus.hint': {
    ru: 'Бонус начисляется, когда услуга оплачена полностью, и копится у сотрудника как остаток. Списывается отдельно: Сотрудники → «Бонусы». В сумме не больше стоимости услуги.',
    section: S,
  },
  'fin.svc.bonus.note': {
    ru: 'Бонусы сотрудникам: {list}. Менять их может сотрудник с правом «Списывать остаток в бонус».',
    section: S,
  },
  'fin.svc.bonus.line': { ru: '{name} — {amount}', section: S },
  // Карточка разовой услуги
  'fin.svc.bonus.box': { ru: 'Бонусы сотрудникам · {amount}', section: S },
  'fin.svc.bonus.on': {
    ru: 'Начислены {date}, когда услуга оплачена полностью, и копятся как остаток бонусов. Списание — Сотрудники → «Бонусы».',
    section: S,
  },
  'fin.svc.bonus.wait': {
    ru: 'Ожидают оплаты услуги: начислятся, когда услуга будет оплачена полностью. Оплачено {paid} из {amount}.',
    section: S,
  },
  'fin.svc.bonus.deleted': { ru: 'Услуга удалена: бонусы не начислены.', section: S },
  // История разовой услуги
  'fin.svc.hist.bonuses': { ru: 'Бонусы сотрудникам: {list}', section: S },
  'fin.svc.hist.bonuses_off': { ru: 'Бонусы сотрудникам убраны', section: S },
} as const satisfies Record<string, UiTextDefault>;
