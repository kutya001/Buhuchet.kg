import type { UiTextDefault } from './texts';

const S = 'Файлы';
const FM = 'Файловый менеджер';

/**
 * Один файл — несколько ссылок (доработки 16.11.2026, блок 2; прототип v124 modules/files.js —
 * `fLinkRecs`, `fPickDlg`, `fPickRow`, `fUnlink`, `fDelDlg`, `fGoActs`; modules/services.js `filesBox`):
 * строка файла контрагента в блоке «Файлы» записи, окно «Из файлов контрагента», подписи записей в
 * «Источнике» и «также у …», «Удалить отовсюду?» и записи истории.
 */
export const FILES_LINKS_TEXTS = {
  // Блок «Файлы» записи: файл контрагента, прикреплённый ссылкой.
  'files.link.pick': { ru: 'Из файлов контрагента', section: S },
  'files.link.also_cp': { ru: 'также в файлах контрагента', section: S },
  'files.link.unlink': { ru: 'Открепить', section: S },
  'files.link.unlink_title': {
    ru: 'Убрать файл из этой записи: в файлах контрагента он останется',
    section: S,
  },
  'files.link.unlink_aria': { ru: 'Открепить {name}', section: S },
  'files.link.unlinked': { ru: 'Файл откреплён: он остался в файлах контрагента', section: S },
  'files.link.linked_one': { ru: 'Файл прикреплён из файлов контрагента', section: S },
  'files.link.linked_n': { ru: 'Прикреплено из файлов контрагента: {n}', section: S },
  // Окно «Из файлов контрагента» и строка формы новой записи.
  'files.pick.title': { ru: 'Из файлов контрагента', section: S },
  'files.pick.search': { ru: 'Найти по названию или примечанию', section: S },
  'files.pick.search_aria': { ru: 'Найти файл', section: S },
  'files.pick.none': { ru: 'Ничего не найдено', section: S },
  'files.pick.row': { ru: '{base} · {date} · {ext}, {size}', section: S },
  'files.pick.also': { ru: 'также у {list}', section: S },
  'files.pick.hint': { ru: 'Прикрепится ссылкой, без копии', section: S },
  'files.pick.empty': { ru: 'У контрагента пока нет файлов', section: S },
  'files.pick.all_linked': { ru: 'Все файлы контрагента уже прикреплены', section: S },
  'files.pick.empty_text': {
    ru: 'Сюда попадают файлы карточки контрагента, принятые «Отправленные файлы» и загруженные вручную с этим контрагентом.',
    section: S,
  },
  'files.pick.cancel': { ru: 'Отмена', section: S },
  'files.pick.ok': { ru: 'Прикрепить', section: S },
  'files.pick.ok_n': { ru: 'Прикрепить: {n}', section: S },
  'files.pick.load_error': { ru: 'Не удалось загрузить файлы контрагента', section: S },
  'files.pick.row_x': { ru: 'Не прикреплять', section: S },
  'files.pick.row_x_aria': { ru: 'Не прикреплять {name}', section: S },
  'files.pick.choose_cp': { ru: 'Сначала выберите контрагента', section: S },
  'files.pick.link_failed': {
    ru: 'Запись сохранена, но файлы контрагента не прикреплены: {error}',
    section: S,
  },
  // Подписи записей (прототип `fLinkRecs`): nm — «Перейти к источнику: …» и «Удалить отовсюду?»,
  // gen — «также у …», src — «Источник» в Файловом менеджере.
  'files.link.nm.receipt': { ru: 'Поступление от {date}', section: FM },
  'files.link.gen.receipt': { ru: 'поступления от {date}', section: FM },
  'files.link.src.receipt': { ru: 'Поступление {date}, {amount}', section: FM },
  'files.link.nm.tax_payment': { ru: 'Оплата налога от {date}', section: FM },
  'files.link.gen.tax_payment': { ru: 'оплаты налога от {date}', section: FM },
  'files.link.src.tax_payment': { ru: 'Оплата {report} — {amount} от {date}', section: FM },
  'files.link.src.tax_payment_plain': { ru: 'Оплата налога {date}, {amount}', section: FM },
  'files.link.nm.money_operation': { ru: '{op} от {date}', section: FM },
  'files.link.gen.money_operation': { ru: 'операции «{op}» от {date}', section: FM },
  'files.link.src.money_operation': { ru: '{op} {date}, {amount}', section: FM },
  'files.link.nm.fee_payment': { ru: 'Оплата за обслуживание от {date}', section: FM },
  'files.link.gen.fee_payment': { ru: 'оплаты за обслуживание от {date}', section: FM },
  'files.link.src.fee_payment': { ru: 'Оплата за обслуживание {date}, {amount}', section: FM },
  'files.link.nm.report': { ru: 'Отчёт {report}', section: FM },
  'files.link.gen.report': { ru: 'отчёта {report}', section: FM },
  'files.link.src.report': { ru: 'Отчёт {report}', section: FM },
  'files.link.report': { ru: '{short} · {period}', section: FM },
  // Отчёт оплаты налога: «НДС 10.2026» (прототип v124 `fLinkRecs`: `Оплата ${T[r.t].short} ${r.plabel}`).
  'files.link.report_pay': { ru: '{short} {period}', section: FM },
  'files.link.nm.one_off_service': { ru: 'Разовая услуга «{name}»', section: FM },
  'files.link.gen.one_off_service': { ru: 'разовой услуги «{name}»', section: FM },
  'files.link.src.one_off_service': { ru: 'Разовая услуга «{name}»', section: FM },
  'files.link.nm.one_off_service_payment': { ru: 'Оплата разовой услуги от {date}', section: FM },
  'files.link.gen.one_off_service_payment': {
    ru: 'оплаты разовой услуги «{name}» от {date}',
    section: FM,
  },
  'files.link.src.one_off_service_payment': {
    ru: 'Оплата разовой услуги «{name}» {date}, {amount}',
    section: FM,
  },
  'files.link.nm.project': { ru: 'Проект «{name}»', section: FM },
  'files.link.gen.project': { ru: 'проекта «{name}»', section: FM },
  'files.link.src.project': { ru: 'Проект «{name}»', section: FM },
  'files.link.nm.project_payment': { ru: 'Оплата по проекту от {date}', section: FM },
  'files.link.gen.project_payment': { ru: 'оплаты по проекту «{name}» от {date}', section: FM },
  'files.link.src.project_payment': {
    ru: 'Оплата по проекту «{name}» {date}, {amount}',
    section: FM,
  },
  // Файловый менеджер: «Перейти к источнику» по каждой ссылке и «Удалить отовсюду?» (прототип `fGoActs`, `fDelDlg`).
  'files.act.source_cp': { ru: 'Перейти к источнику: файлы контрагента', section: FM },
  'files.act.source_to': { ru: 'Перейти к источнику: {name}', section: FM },
  'files.act.delete_all': { ru: 'Удалить отовсюду', section: FM },
  'files.delete.linked': {
    ru: 'Файл прикреплён ещё к: {list}. Удалить отовсюду? Файл пропадёт из файлов контрагента, из этих записей и из Файлового менеджера; удаление записывается в историю каждой записи.',
    section: FM,
  },
  'files.delete.hidden.one': { ru: 'ещё {n} запись, которых вам не видно', section: FM },
  'files.delete.hidden.few': { ru: 'ещё {n} записи, которых вам не видно', section: FM },
  'files.delete.hidden.many': { ru: 'ещё {n} записей, которых вам не видно', section: FM },
  'files.deleted_all': { ru: 'Файл удалён отовсюду', section: FM },
  'files.window.cp_files': { ru: 'Файлы контрагента', section: FM },
  // Записи истории записи (прототип `fLinkAdd`, `fUnlink`, `fDelDlg`).
  'files.hist.linked': { ru: 'Прикреплены из файлов контрагента: {name}', section: S },
  'files.hist.unlinked': {
    ru: 'Откреплён файл «{name}»: он остался в файлах контрагента',
    section: S,
  },
  'files.hist.deleted_linked': {
    ru: 'Удалён файл «{name}» (был прикреплён из файлов контрагента)',
    section: S,
  },
} as const satisfies Record<string, UiTextDefault>;
