import { PAGE_MESSAGES } from '../contractor-page/page';
import type { UiTextDefault } from './texts';

const S = 'Страница контрагента';
const E = 'Ошибки';

/**
 * Тексты страницы контрагента по ссылке (задача 2.42; прототип modules/cp-page.js): блок «Страница
 * контрагента» карточки (`pgBox`), окна «Выключить», «Сменить код», «Включить у нескольких»
 * (`pgOffDlg`, `pgCodeDlg`, `pgEnable`), «Отправить ссылку в WhatsApp» (`waDlg`, `page`), страница без
 * входа — код, «Страница недоступна», перерыв (`pubDraw`), записи истории контрагента. Отказы — те же
 * строки, что у сервера (`PAGE_MESSAGES`).
 */
export const CONTRACTOR_PAGE_TEXTS = {
  'cppage.title': { ru: 'Страница контрагента', section: S },
  'cppage.state.on': { ru: 'Включена', section: S },
  'cppage.state.off': { ru: 'Выключена', section: S },
  'cppage.link': { ru: 'Ссылка', section: S },
  'cppage.link_title': { ru: 'Открыть страницу так, как её увидит контрагент', section: S },
  'cppage.code': { ru: 'Код доступа', section: S },
  'cppage.last': { ru: 'Последнее открытие', section: S },
  'cppage.last_none': { ru: 'контрагент ещё не открывал', section: S },
  'cppage.sections': { ru: 'Разделы страницы', section: S },
  'cppage.sections_hint': {
    ru: '«Ваш бухгалтер» видно всегда. Разделы для всех контрагентов — в учётной политике',
    section: S,
  },
  'cppage.off_hint': {
    ru: 'Контрагент откроет по ссылке и коду из 6 цифр свои отчёты, показатели и оплату за обслуживание — только для просмотра, без входа в программу.',
    section: S,
  },
  'cppage.archived_hint': { ru: 'Контрагент в архиве — страница выключена.', section: S },
  'cppage.btn.on': { ru: 'Включить', section: S },
  'cppage.btn.copy': { ru: 'Скопировать ссылку', section: S },
  'cppage.btn.wa': { ru: 'Отправить в WhatsApp', section: S },
  'cppage.btn.code': { ru: 'Сменить код', section: S },
  'cppage.btn.off': { ru: 'Выключить', section: S },
  'cppage.btn.bulk': { ru: 'Включить страницу', section: S },
  'cppage.toast.copied': { ru: 'Ссылка скопирована', section: S },
  'cppage.toast.on': { ru: 'Страница включена. Код доступа: {code}', section: S },
  'cppage.toast.already': { ru: 'Страница уже включена', section: S },
  'cppage.toast.off': { ru: 'Страница выключена', section: S },
  'cppage.toast.code': { ru: 'Новый код: {code}. Отправьте его контрагенту', section: S },
  'cppage.toast.shown': { ru: 'Раздел показывается на странице', section: S },
  'cppage.toast.hidden': { ru: 'Раздел скрыт на странице', section: S },
  'cppage.toast.logged': { ru: 'Записано в историю', section: S },
  'cppage.toast.bulk': {
    ru: 'Страница включена у {n} {cps}, у каждого свой код',
    section: S,
  },
  'cppage.toast.bulk_skip': {
    ru: 'Пропущено: {n} — уже включена или в архиве',
    section: S,
  },
  'cppage.toast.bulk_none': {
    ru: 'У выбранных контрагентов страница уже включена или они в архиве',
    section: S,
  },
  'cppage.cps.one': { ru: 'контрагента', section: S },
  'cppage.cps.few': { ru: 'контрагентов', section: S },
  'cppage.cps.many': { ru: 'контрагентов', section: S },
  'cppage.off.title': { ru: 'Выключить страницу контрагента?', section: S },
  'cppage.off.text': {
    ru: 'Ссылка перестанет открываться: контрагент увидит «Страница недоступна. Обратитесь к вашему бухгалтеру». Включить можно снова — с новым кодом.',
    section: S,
  },
  'cppage.code.title': { ru: 'Сменить код доступа?', section: S },
  'cppage.code.text': {
    ru: 'Старый код перестанет действовать сразу, в том числе в браузерах, где он запомнен. Новый код нужно будет отправить контрагенту.',
    section: S,
  },
  'cppage.bulk.title': { ru: 'Включить страницу у {n} {cps}?', section: S },
  'cppage.bulk.text': {
    ru: 'У каждого появится своя ссылка и свой код из 6 цифр. Отправить их контрагенту можно из его карточки: «Основное» → «Страница контрагента» → «Отправить в WhatsApp».',
    section: S,
  },
  'cppage.bulk.skip': {
    ru: 'Пропущено: {n} — страница уже включена или контрагент в архиве.',
    section: S,
  },
  'cppage.wa.title': { ru: 'Отправить ссылку в WhatsApp', section: S },
  'cppage.wa.no_phone': {
    ru: 'У контрагента нет номера телефона — сообщение отправить нельзя. Добавьте номер в карточке.',
    section: S,
  },
  'cppage.wa.text': { ru: 'Текст сообщения', section: S },
  'cppage.wa.hint': {
    ru: 'Шаблон ведёт администратор платформы. Здесь текст можно поправить перед отправкой.',
    section: S,
  },
  'cppage.wa.note': {
    ru: 'Сообщение откроется в WhatsApp на номер {phone}, отправляете его вы сами. Нажатие записывается в историю.',
    section: S,
  },
  'cppage.wa.go': { ru: 'Открыть WhatsApp', section: S },
  // Записи истории контрагента (прототип: log('cp', …)).
  'cppage.hist.page_on': { ru: 'Страница контрагента включена: создан код доступа', section: S },
  'cppage.hist.page_off': { ru: 'Страница контрагента выключена', section: S },
  'cppage.hist.page_code': { ru: 'Код доступа страницы контрагента изменён', section: S },
  'cppage.hist.page_copy': { ru: 'Скопирована ссылка на страницу контрагента', section: S },
  'cppage.hist.page_send': {
    ru: 'Ссылка на страницу контрагента с кодом отправлена в WhatsApp',
    section: S,
  },
  'cppage.hist.page_open': { ru: 'Страница контрагента открыта: {device}', section: S },
  'cppage.hist.page_lock': {
    ru: 'Страница контрагента: 5 неверных кодов подряд, ввод закрыт на 15 минут',
    section: S,
  },
  'cppage.hist.shown': { ru: 'Страница контрагента: раздел «{section}» показывается', section: S },
  'cppage.hist.hidden': { ru: 'Страница контрагента: раздел «{section}» скрыт', section: S },
  'cppage.hist.client': { ru: 'Контрагент', section: S },
  // Страница без входа (прототип pubDraw).
  'pub.meta_title': { ru: 'Страница контрагента', section: S },
  'pub.unavailable.title': { ru: 'Страница недоступна', section: S },
  'pub.unavailable.text': { ru: 'Обратитесь к вашему бухгалтеру.', section: S },
  'pub.code.title': { ru: 'Введите код доступа', section: S },
  'pub.code.text': { ru: 'Код из 6 цифр прислал ваш бухгалтер вместе со ссылкой.', section: S },
  'pub.code.label': { ru: 'Код доступа', section: S },
  'pub.code.open': { ru: 'Открыть', section: S },
  'pub.code.remember': { ru: 'В этом браузере код запомнится на 30 дней.', section: S },
  'pub.code.format': { ru: 'Введите 6 цифр', section: S },
  'pub.locked.title': { ru: 'Ввод кода временно закрыт', section: S },
  'pub.locked.text': {
    ru: 'Было 5 неверных кодов подряд. Попробуйте снова после {time} или попросите код у вашего бухгалтера.',
    section: S,
  },
  // ОТКЛОНЕНИЕ: docs/deviations.md#Е-2
  'pub.ip_locked.text': {
    ru: 'С этого адреса было слишком много неверных кодов. Попробуйте снова после {time} или попросите код у вашего бухгалтера.',
    section: S,
  },
  'pub.as_of': { ru: 'Данные на {at}', section: S },
  'pub.org_hint': { ru: 'ваша бухгалтерская компания', section: S },
  'pub.inn': { ru: 'ИНН', section: S },
  'pub.regime_none': { ru: 'режим налогообложения не указан', section: S },
  'pub.foot': { ru: 'Страница только для просмотра. Вопросы — вашему бухгалтеру.', section: S },
  'err.page_manage_right': { ru: PAGE_MESSAGES.page_manage_right, section: E },
  'err.page_send_right': { ru: PAGE_MESSAGES.page_send_right, section: E },
  'err.page_archived': { ru: PAGE_MESSAGES.page_archived, section: E },
  'err.page_off': { ru: PAGE_MESSAGES.page_off, section: E },
  'err.cppage_off': {
    ru: 'Функция «Страница контрагента по ссылке» выключена в учётной политике',
    section: E,
  },
  'err.page_unavailable': { ru: 'Страница недоступна. Обратитесь к вашему бухгалтеру.', section: E },
  'err.page_code_wrong': { ru: 'Неверный код. Осталось попыток: {triesLeft}', section: E },
  'err.page_locked': { ru: 'Ввод кода временно закрыт', section: E },
  'err.page_ip_locked': { ru: 'Ввод кода временно закрыт', section: E },
} as const satisfies Record<string, UiTextDefault>;
