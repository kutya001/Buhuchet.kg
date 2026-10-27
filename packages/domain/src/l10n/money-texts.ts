import { REQUISITE_MESSAGES } from '../money/requisites';
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
