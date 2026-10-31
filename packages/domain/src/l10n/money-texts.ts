import { REQUISITE_MESSAGES } from '../money/requisites';
import { MONEY_MESSAGES } from '../money/tax';
import type { UiTextDefault } from './texts';

const S = 'Деньги';
const E = 'Ошибки';

/**
 * Тексты реквизитов для переводов (задача 2.18; прототип modules/org.js — счета организации,
 * modules/profile.js — «Мои реквизиты для переводов», modules/staff.js — реквизиты в карточке
 * сотрудника, core/requisites.js — виды, назначение и строка реквизита для сообщений).
 */
export const MONEY_TEXTS = {
  'money.col.kind': { ru: 'Вид', section: S },
  'money.col.bank': { ru: 'Банк или кошелёк', section: S },
  'money.col.number': { ru: 'Номер', section: S },
  'money.col.holder': { ru: 'Получатель', section: S },
  'money.col.purpose': { ru: 'Назначение', section: S },
  'money.col.main': { ru: 'Основной', section: S },
  'money.kind.org_acc': { ru: 'Расчётный счёт', section: S },
  'money.kind.wallet': { ru: 'Счёт или кошелёк', section: S },
  'money.kind.phone': { ru: 'Перевод по номеру телефона', section: S },
  'money.kind.label': { ru: 'Вид реквизита', section: S },
  'money.purpose.both': { ru: 'Налоги и обслуживание', section: S },
  'money.purpose.tax': { ru: 'Налоги', section: S },
  'money.purpose.fee': { ru: 'Обслуживание', section: S },
  'money.main.tax': { ru: 'Основной для налогов', section: S },
  'money.main.fee': { ru: 'Основной для обслуживания', section: S },
  'money.main': { ru: 'Основной', section: S },
  'money.main.tag': { ru: 'основной', section: S },
  'money.bik_value': { ru: 'БИК {bik}', section: S },
  'money.edit': { ru: 'Изменить', section: S },
  'money.delete': { ru: 'Удалить', section: S },
  'money.load_error': { ru: 'Не удалось загрузить реквизиты', section: S },

  // «Моя организация» → «Реквизиты для приёма денег от контрагентов»
  'money.org.title': { ru: 'Реквизиты для приёма денег от контрагентов', section: S },
  'money.org.add': { ru: 'Добавить счёт', section: S },
  'money.org.empty': { ru: 'Счетов пока нет', section: S },
  'money.org.hint': {
    ru: 'Расчётный счёт или перевод по номеру телефона (M-Bank, Бакай Банк, О!Банк и другие). Юрлица часто не могут переводить на карты физлиц — тогда контрагент переводит деньги на налоги сюда; это выбирается в карточке контрагента. Основные счета для налогов и для обслуживания подставляются в напоминания в WhatsApp и в «Как оплатить» на странице контрагента.',
    section: S,
  },
  'money.org.edit_aria': { ru: 'Изменить счёт', section: S },
  'money.org.delete_aria': { ru: 'Удалить счёт', section: S },
  'money.org.dialog.new': { ru: 'Счёт организации', section: S },
  'money.org.dialog.edit': { ru: 'Изменить счёт организации', section: S },
  'money.org.dialog.sub': {
    ru: 'Куда контрагенты переводят деньги на налоги и за обслуживание',
    section: S,
  },
  'money.org.field.bank': { ru: 'Банк', section: S },
  'money.org.field.bik': { ru: 'БИК', section: S },
  'money.org.field.account': { ru: 'Расчётный счёт', section: S },
  'money.org.field.holder_hint': {
    ru: 'Так, как его видит отправитель в приложении банка, например «ОсОО Ахти»',
    section: S,
  },
  'money.org.field.purpose_hint': {
    ru: 'Для чего контрагенты переводят на этот счёт',
    section: S,
  },
  'money.org.field.banks_hint': {
    ru: 'По номеру переводят внутри одного банка или кошелька, поэтому отметьте все, где открыт этот номер. В списке — только провайдеры с переводами по номеру телефона.',
    section: S,
  },
  'money.org.main_tax_hint': {
    ru: 'Подставляется в напоминания о налогах и в «Как оплатить» на странице контрагентов, которые переводят деньги на налоги на счёт организации',
    section: S,
  },
  'money.org.main_fee_hint': {
    ru: 'Подставляется в напоминание о долге за обслуживание и в «Как оплатить»',
    section: S,
  },
  'money.org.added': { ru: 'Счёт добавлен', section: S },
  'money.org.changed': { ru: 'Счёт изменён', section: S },
  'money.org.deleted': { ru: 'Счёт удалён', section: S },
  'money.org.delete_title': { ru: 'Удалить счёт {bank}?', section: S },
  'money.org.delete_text': {
    ru: 'Счёт пропадёт из реквизитов для контрагентов. Прошлые поступления не меняются.',
    section: S,
  },

  // «Мой профиль» → «Мои реквизиты для переводов» и карточка сотрудника
  'money.wallets.title': { ru: 'Мои реквизиты для переводов', section: S },
  'money.wallets.empty': {
    ru: 'Реквизитов нет. Без них кнопка «Напомнить в WhatsApp» не сможет подставить, куда переводить деньги.',
    section: S,
  },
  'money.wallets.hint': {
    ru: 'Счёт или кошелёк — или перевод по номеру телефона, привязанному к нескольким банкам и кошелькам. Видны вам, владельцу и главному бухгалтеру. Провайдер выбирается из справочника платформы.',
    section: S,
  },
  'money.wallets.make_main': { ru: 'Сделать основным', section: S },
  'money.wallets.edit_aria': { ru: 'Изменить реквизит', section: S },
  'money.wallets.delete_aria': { ru: 'Удалить реквизит', section: S },
  'money.wallets.dialog.new': { ru: 'Новый реквизит', section: S },
  'money.wallets.dialog.edit': { ru: 'Изменить реквизит', section: S },
  'money.wallets.dialog.sub': { ru: 'Куда контрагенты переводят деньги на налоги', section: S },
  'money.wallets.field.bank': { ru: 'Банковский провайдер', section: S },
  'money.wallets.field.number': { ru: 'Номер счёта или кошелька', section: S },
  'money.wallets.field.holder': { ru: 'Имя получателя', section: S },
  'money.wallets.field.holder_hint': {
    ru: 'Необязательно; так, как его видит отправитель, например «Асанов А.»',
    section: S,
  },
  'money.wallets.field.banks_hint': {
    ru: 'Отметьте все, где открыт этот номер: по номеру переводят внутри одного банка или кошелька',
    section: S,
  },
  'money.wallets.added': { ru: 'Реквизит добавлен', section: S },
  'money.wallets.changed': { ru: 'Реквизит изменён', section: S },
  'money.wallets.deleted': { ru: 'Реквизит удалён', section: S },
  'money.wallets.delete_title': { ru: 'Удалить реквизит?', section: S },
  'money.wallets.delete_text': {
    ru: '{bank} {number} больше не будет подставляться в напоминания.',
    section: S,
  },
  'money.staff.title': { ru: 'Реквизиты для переводов', section: S },
  'money.staff.empty': {
    ru: 'Реквизитов нет — сотрудник добавляет их в своём профиле',
    section: S,
  },

  // Поля обеих форм
  'money.field.phone': { ru: 'Номер телефона', section: S },
  'money.field.banks': { ru: 'Банки и кошельки, к которым привязан номер', section: S },
  'money.err.phone': {
    ru: 'Введите номер полностью: {n} цифр после кода страны',
    section: E,
  },

  // Реквизит одной строкой для сообщений контрагенту (прототип rqTxt)
  'money.req.text.phone': { ru: 'Перевод по номеру {phone} ({banks}){holder}', section: S },
  'money.req.text.account': { ru: '{bank}: р/с {account}, БИК {bik}{holder}', section: S },
  'money.req.text.wallet': { ru: '{bank}: {account}', section: S },
  'money.req.text.holder': { ru: ', получатель {name}', section: S },

  'err.bank_required': { ru: REQUISITE_MESSAGES.bank_required, section: E },
  'err.bank_unavailable': { ru: REQUISITE_MESSAGES.bank_unavailable, section: E },
  'err.account_no_invalid': { ru: REQUISITE_MESSAGES.account_no_invalid, section: E },
  'err.bik_invalid': { ru: REQUISITE_MESSAGES.bik_invalid, section: E },
  'err.wallet_no_invalid': { ru: REQUISITE_MESSAGES.wallet_no_invalid, section: E },
  'err.phone_banks_required': { ru: REQUISITE_MESSAGES.phone_banks_required, section: E },
  'err.invalid_phone': { ru: REQUISITE_MESSAGES.invalid_phone, section: E },
} as const satisfies Record<string, UiTextDefault>;

const R = 'Отчёты для сдачи';

/**
 * Тексты отказов денежных действий (`err.<код>`, вариант — `err.<код>.<вариант>`); `contractor_archived`
 * — общий текст словаря контрагентов.
 */
type MoneyErrCode = Exclude<keyof typeof MONEY_MESSAGES, 'contractor_archived'>;
const MONEY_ERR_TEXTS = Object.fromEntries(
  Object.entries(MONEY_MESSAGES)
    .filter(([code]) => code !== 'contractor_archived')
    .map(([code, ru]) => [`err.${code}`, { ru, section: E }]),
) as { readonly [K in MoneyErrCode as `err.${K}`]: UiTextDefault };

/**
 * Тексты денег по отчётам (задача 2.19; прототип modules/reports.js — столбцы и «Принять»,
 * modules/report-card.js — суммы и график оплаты, ui/status-scale.js — payDlg, submitDlg,
 * rollbackDlg('pay'), modules/contractors.js — inDlg, modules/contractor-card.js — вкладка «Деньги»,
 * «Файл при поступлении», «Деньги на налоги переводит», «Баланс по контрагенту»).
 */
export const TAX_MONEY_TEXTS = {
  // Столбцы и строка сумм на плитке
  'report.col.received': { ru: 'Получено от контрагента', section: R },
  'report.col.received_short': { ru: 'Получено', section: R },
  'report.col.paid': { ru: 'Оплачено в бюджет', section: R },
  'report.col.paid_short': { ru: 'Оплачено', section: R },
  'report.col.left': { ru: 'Осталось оплатить', section: R },
  'report.col.payment_status': { ru: 'Статус оплаты', section: R },
  'report.col.funds': { ru: 'Деньги (сверка)', section: R },
  'report.overdue.pay': { ru: 'Оплата', section: R },
  'report.overdue.both': { ru: 'Сдача и оплата', section: R },
  'report.funds.paid': { ru: 'Оплачено', section: R },
  'report.funds.enough': { ru: 'Достаточно', section: R },
  'report.funds.short': { ru: 'Недостача', section: R },
  'report.funds.short_title': { ru: 'Не хватает {amount}', section: R },
  'report.pay.overdue': { ru: 'просрочено', section: R },
  'report.pay.overdue_title': { ru: 'Срок оплаты прошёл', section: R },
  'report.receive.short': { ru: 'Принять', section: R },
  'report.receive.title': { ru: 'Принять деньги от контрагента под этот отчёт', section: R },
  'report.reason.after_payment': { ru: 'сдача — после оплаты', section: R },
  'report.tab.paid_month': { ru: 'оплачено {amount}', section: R },

  // Меню и кнопки отчёта
  'report.act.receive': { ru: 'Принять деньги', section: R },
  'report.act.receive_sub': { ru: 'Поступление от контрагента под этот отчёт', section: R },
  'report.act.mark_paid': { ru: 'Отметить оплаченным', section: R },
  'report.act.pay_short': {
    ru: 'Денег контрагента не хватает — или «Оплатил контрагент сам»',
    section: R,
  },
  'report.act.pay_short_n': {
    ru: 'Денег контрагента не хватает: {amount} — или «Оплатил контрагент сам»',
    section: R,
  },
  'report.act.money_no': { ru: 'Нет права на учёт денег', section: R },
  'report.pay_first.why': {
    ru: 'Сначала оплатите налог: к уплате {amount}, оплачено {paid}',
    section: R,
  },
  'report.pay_first.note': {
    ru: 'Отчёт «Сдача + уплата» отмечается сданным после оплаты полностью или частично: «Принять деньги» → «Отметить оплаченным» → «Сдан».',
    section: R,
  },
  'report.pay_first.submit_note': {
    ru: 'Отчёт «Сдача + уплата» отмечается сданным после оплаты налога. Нулевой отчёт — впишите 0. Если сумма больше 0, она сохранится, а «Сдан» можно будет поставить после «Отметить оплаченным».',
    section: R,
  },
  'report.pay_first.saved': {
    ru: '{why}. Сумма сохранена: примите деньги и отметьте оплату, потом «Сдан».',
    section: R,
  },
  'report.pay_first.batch_note': {
    ru: '{n} без оплаты помечены «Нет оплаты» и не отмечаются: «Сдан» ставится после оплаты налога.',
    section: R,
  },
  'report.pay_first.pill': { ru: 'Нет оплаты', section: R },
  'report.pay_first.scale_hint': { ru: '«Сдан»: {why}', section: R },
  'report.pay_first.all_unpaid': {
    ru: 'Выбранные отчёты не оплачены: «Сдан» ставится после оплаты налога',
    section: R,
  },
  'report.submit.done_many_skip_pay': {
    ru: 'Сданными отмечено: {n}; без оплаты не отмечено: {m}',
    section: R,
  },
  'report.submit.done_many_skip_both': {
    ru: 'Сданными отмечено: {n}; без файла не отмечено: {m}; без оплаты не отмечено: {k}',
    section: R,
  },

  // Карточка отчёта: суммы, график оплаты, деньги контрагента
  'report.money.received_full': { ru: 'получено полностью', section: R },
  'report.money.received_part': { ru: 'получено частично', section: R },
  'report.money.received_wait': { ru: 'ожидаем', section: R },
  'report.money.self_paid': { ru: 'оплатил контрагент сам: {amount}', section: R },
  'report.money.over': { ru: '+{amount} пеня/переплата', section: R },
  'report.money.pay_overdue': { ru: 'срок оплаты прошёл', section: R },
  'report.money.pay_due': { ru: 'Срок оплаты', section: R },
  'report.money.funds': { ru: 'Деньги контрагента', section: R },
  'report.money.schedule': { ru: 'График оплаты · {n}', section: R },
  'report.money.schedule.one': { ru: '{n} платёж', section: R },
  'report.money.schedule.few': { ru: '{n} платежа', section: R },
  'report.money.schedule.many': { ru: '{n} платежей', section: R },
  'report.money.col_due': { ru: 'Срок', section: R },
  'report.money.col_amount': { ru: 'Сумма', section: R },
  'report.money.col_paid': { ru: 'Оплачено', section: R },
  'report.money.col_status': { ru: 'Статус', section: R },
  'report.money.event_pay': { ru: 'Оплата в бюджет {amount}', section: R },
  'report.money.event_cancel': { ru: 'откат: отменена оплата {amount}', section: R },
  'report.hist.payment': { ru: 'Оплата в бюджет {amount} от {date}', section: R },
  'report.hist.payment_self': { ru: ' (оплатил контрагент сам)', section: R },
  'report.hist.payment_over': { ru: ' (больше суммы к уплате на {amount})', section: R },
  'report.hist.payment_cancel': { ru: 'Отменена оплата в бюджет {amount} от {date}', section: R },
  'report.hist.amount_set': { ru: 'Сумма к уплате: {amount}', section: R },

  // «Оплата налога в бюджет»
  'money.pay.title': { ru: 'Оплата налога в бюджет', section: S },
  'money.pay.due': { ru: 'К уплате', section: S },
  'money.pay.already': { ru: 'Уже оплачено', section: S },
  'money.pay.available': { ru: 'Деньги контрагента на счёте', section: S },
  'money.pay.self': { ru: 'Оплатил контрагент сам', section: S },
  'money.pay.self_hint': {
    ru: 'Контрагент сам перечислил налог в бюджет: деньги с наших счетов не списываются, в журнале операций — «Оплата контрагентом напрямую»',
    section: S,
  },
  'money.pay.date': { ru: 'Дата оплаты', section: S },
  'money.pay.amount': { ru: 'Оплачено в бюджет, сом', section: S },
  'money.pay.amount_hint': {
    ru: 'Может отличаться от суммы к уплате, например на пеню',
    section: S,
  },
  'money.pay.file': { ru: 'Платёжное поручение', section: S },
  'money.pay.file_hint': {
    ru: 'Необязательно; файл появится в карточке отчёта и в «Файловом менеджере»',
    section: S,
  },
  'money.pay.lock': {
    ru: 'Налог контрагента оплачивается только его деньгами. Это правило не отключается.',
    section: S,
  },
  'money.pay.lock_short': {
    ru: 'Сейчас денег не хватает: примите деньги или отметьте «Оплатил контрагент сам».',
    section: S,
  },
  'money.pay.ok': { ru: 'Отметить оплаченным', section: S },
  'money.pay.done': { ru: 'Оплата отмечена', section: S },
  'money.pay.done_self': { ru: 'Оплата контрагентом напрямую отмечена', section: S },
  'money.pay.not_enough_short': {
    ru: 'Денег контрагента на этот отчёт не хватает: {amount}. Примите деньги или отметьте «Оплатил контрагент сам»',
    section: S,
  },
  'money.pay.not_enough_available': {
    ru: 'Денег контрагента на этот отчёт не хватает: доступно {amount}. Примите деньги или отметьте «Оплатил контрагент сам»',
    section: S,
  },
  'money.amount_invalid': { ru: 'Введите сумму больше нуля', section: E },
  'money.files_saved_partly': {
    ru: 'Записано, но файл «{name}» не загружен: {error}. Прикрепите его в «Файловом менеджере»',
    section: S,
  },

  // Откат шкалы оплаты
  'money.cancel.title': { ru: 'Отменить запись об оплате', section: S },
  'money.cancel.effect': {
    ru: 'Оплата {amount} от {date} будет отменена: сумма вернётся в свободный остаток контрагента на счёте, статус оплаты станет «{status}».',
    section: S,
  },
  'money.cancel.done': { ru: 'Оплата отменена', section: S },

  // «Поступление от контрагента»
  'money.in.title': { ru: 'Поступление от контрагента', section: S },
  'money.in.contractor': { ru: 'Контрагент', section: S },
  'money.in.contractor_required': { ru: 'Выберите контрагента', section: S },
  'money.in.sub_org': { ru: '{name} · на счёт организации', section: S },
  'money.in.sub_emp': { ru: '{name} · на счёт {holder}', section: S },
  'money.in.total': { ru: 'Общая сумма, сом', section: S },
  'money.in.total_hint': { ru: 'Сколько всего перевёл контрагент', section: S },
  'money.in.date': { ru: 'Дата', section: S },
  'money.in.detail': { ru: 'Детализация: за что эти деньги', section: S },
  'money.in.auto': { ru: 'Распределить по срокам', section: S },
  'money.in.col_report': { ru: 'Отчёт', section: S },
  'money.in.col_period': { ru: 'Период', section: S },
  'money.in.col_pay_due': { ru: 'Срок оплаты', section: S },
  'money.in.col_sum': { ru: 'К уплате', section: S },
  'money.in.col_already': { ru: 'Уже получено', section: S },
  'money.in.col_already_title': {
    ru: 'Уже получено от контрагента под этот отчёт (или уже оплачено)',
    section: S,
  },
  'money.in.col_now': { ru: 'Распределить сейчас', section: S },
  'money.in.col_left': { ru: 'Осталось', section: S },
  'money.in.row_aria': { ru: 'Распределить на {report}', section: S },
  'money.in.total_row': { ru: 'Итого', section: S },
  'money.in.all_received': {
    ru: 'Деньги на все неоплаченные налоги ({n}) уже получены — эта сумма станет авансом контрагента.',
    section: S,
  },
  'money.in.no_unpaid': {
    ru: 'Неоплаченных налогов нет — вся сумма станет авансом контрагента.',
    section: S,
  },
  'money.in.sumline': { ru: 'Детализация:', section: S },
  'money.in.over': { ru: 'больше общей суммы на {amount}', section: S },
  'money.in.advance': { ru: 'аванс {amount}', section: S },
  'money.in.match': { ru: 'сходится', section: S },
  'money.in.hint': {
    ru: 'Общая сумма должна быть не меньше суммы строк, излишек остаётся авансом контрагента.',
    section: S,
  },
  'money.in.files': { ru: 'Файлы: платёжка, чек, скрин перевода', section: S },
  'money.in.files_need': { ru: 'Для этого контрагента файл обязателен', section: S },
  'money.in.files_need_have': {
    ru: 'Для этого контрагента файл обязателен: уже приложено {n}',
    section: S,
  },
  'money.in.total_less': {
    ru: 'Сумма детализации больше общей на {amount}: общая сумма должна быть не меньше',
    section: E,
  },
  'money.in.ok': { ru: 'Записать поступление', section: S },
  'money.in.done': { ru: 'Поступление записано', section: S },
  'money.in.load_error': { ru: 'Не удалось загрузить неоплаченные отчёты', section: S },

  // Вкладка «Деньги» карточки контрагента
  'cp.card.tab.money': { ru: 'Деньги', section: S },
  'money.tab.period': { ru: 'Сверка по сроку оплаты до конца месяца:', section: S },
  'money.tab.need': { ru: 'Нужно оплатить', section: S },
  'money.tab.need_sub': { ru: 'отчётов: {n}', section: S },
  'money.tab.need_none': { ru: 'неоплаченных нет', section: S },
  'money.tab.have': { ru: 'Поступило и не потрачено', section: S },
  'money.tab.have_org': { ru: 'на счёте организации', section: S },
  'money.tab.have_emp': { ru: 'на счёте сотрудника', section: S },
  'money.tab.verdict.short': { ru: 'Недостача', section: S },
  'money.tab.verdict.enough': { ru: 'Достаточно', section: S },
  'money.tab.verdict.enough_surplus': { ru: 'Достаточно, излишек', section: S },
  'money.tab.verdict.surplus': { ru: 'Излишек', section: S },
  'money.tab.later': {
    ru: 'Отложено под отчёты с более поздним сроком: {amount} ({list})',
    section: S,
  },
  'money.tab.later_item': { ru: '{report}, до {date}', section: S },
  'money.tab.receive': { ru: 'Поступление', section: S },
  'money.tab.need_title': { ru: 'Что нужно оплатить · {n}', section: S },
  'money.tab.need_empty': { ru: 'Неоплаченных налогов с таким сроком нет', section: S },
  'money.tab.col_report': { ru: 'Отчёт', section: S },
  'money.tab.col_pay_due': { ru: 'Срок оплаты', section: S },
  'money.tab.col_left': { ru: 'Осталось', section: S },
  'money.tab.total': { ru: 'Итого', section: S },
  'money.tab.hint_org': {
    ru: 'Деньги на счёте организации; тратит их ответственный бухгалтер этого контрагента. Налог контрагента оплачивается только его деньгами.',
    section: S,
  },
  'money.tab.hint_emp': {
    ru: 'Деньги на счёте сотрудника {name}. Налог контрагента оплачивается только его деньгами.',
    section: S,
  },
  'money.tab.ops_title': { ru: 'Операции · {n}', section: S },
  'money.tab.ops_empty': { ru: 'Операций пока не было', section: S },
  'money.tab.ops_hint': {
    ru: 'Нажмите на операцию — откроется её окно: там видно, кто и когда её внёс, и её можно изменить или удалить с причиной.',
    section: S,
  },
  'money.tab.col_date': { ru: 'Дата', section: S },
  'money.tab.col_op': { ru: 'Операция', section: S },
  'money.tab.col_basis': { ru: 'Основание', section: S },
  'money.tab.col_author': { ru: 'Автор', section: S },
  'money.tab.col_amount': { ru: 'Сумма', section: S },
  'money.tab.load_error': { ru: 'Не удалось загрузить деньги контрагента', section: S },
  'money.op.in': { ru: 'Поступление', section: S },
  'money.op.pay': { ru: 'Оплата налога', section: S },
  'money.op.bonus': { ru: 'Списание в бонус', section: S },
  'money.op.refund': { ru: 'Возврат контрагенту', section: S },
  'money.op.back': { ru: 'Возврат по уточнённому', section: S },
  'money.op.corr': { ru: 'Обратная запись', section: S },
  'money.op.xfer': { ru: 'Перевод на счёт сотрудника', section: S },
  'money.op.basis_in': { ru: 'За {list}', section: S },
  'money.op.basis_advance': { ru: 'Аванс', section: S },
  'money.op.self': { ru: 'Оплата контрагентом напрямую', section: S },
  'money.op.basis_self': { ru: 'Оплата контрагентом напрямую · {report}', section: S },

  // «Основное» карточки контрагента: деньги
  'cp.col.need_file': { ru: 'Файл к поступлению обязателен', section: S },
  'money.cp.need_file': { ru: 'Файл при поступлении', section: S },
  'money.cp.need_file_on': { ru: 'обязательно требовать', section: S },
  'money.cp.need_file_hint': {
    ru: 'Поступление от контрагента нельзя сохранить без скрина перевода или квитанции',
    section: S,
  },
  'money.cp.pays_to': { ru: 'Деньги на налоги переводит', section: S },
  'money.cp.pays_to.emp': { ru: 'на кошелёк ответственного', section: S },
  'money.cp.pays_to.org': { ru: 'на счёт организации', section: S },
  'money.cp.saved': { ru: 'Сохранено', section: S },
  'money.cp.balance': { ru: 'Баланс по контрагенту', section: S },
  'money.cp.received': { ru: 'Получено от контрагента', section: S },
  'money.cp.paid': { ru: 'Оплачено в бюджет', section: S },
  'money.cp.self_paid': { ru: 'из них контрагент оплатил сам: {amount}', section: S },
  'money.cp.bonus': { ru: 'Списано в бонус', section: S },
  'money.cp.available': { ru: 'Остаток на счёте', section: S },

  // История контрагента
  'cp.hist.receipt': { ru: 'Поступление {amount}', section: S },
  'cp.hist.receipt_for': { ru: 'Поступление {amount}: {list}', section: S },
  'cp.hist.receipt_advance': { ru: 'аванс — {amount}', section: S },
  'cp.hist.receipt_file': { ru: 'Поступление · {text}', section: S },
  'cp.hist.need_file_on': {
    ru: 'Включено: обязательно требовать прикрепления при поступлении от контрагента',
    section: S,
  },
  'cp.hist.need_file_off': { ru: 'Выключено требование файла при поступлении', section: S },
  'cp.hist.pays_to': { ru: 'Деньги на налоги: {to}', section: S },

  ...MONEY_ERR_TEXTS,
} as const satisfies Record<string, UiTextDefault>;
