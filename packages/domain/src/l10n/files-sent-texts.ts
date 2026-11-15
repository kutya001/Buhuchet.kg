import { SENT_FILE_MESSAGES, type SentFileProblem } from '../files/sent';
import type { UiTextDefault } from './texts';

const S = 'Файлы от контрагентов';

/**
 * Файлы от контрагентов (доработки 14.11.2026, блок 2; прототип v112 `modules/cp-sent.js`): сообщение
 * ответственному в Telegram, записи истории контрагента, подписи источника и отказы API.
 */
export const FILES_SENT_TEXTS = {
  // Источник принятого файла в «Файловом менеджере» и на странице контрагента (прототип `allFiles`, `pubFiles`).
  'files.src.sent': { ru: 'От контрагента', section: S },
  'pub.files.rel.sent': { ru: 'Отправлен вами', section: S },
  // Вид принятого файла в «Файловом менеджере» — «Контрагент», как у документов контрагента (`FILE_LIST_KIND_OF`).
  'files.kind.sent_file': { ru: 'Контрагент', section: S },
  // Раздел «Отправленные файлы» карточки контрагента и вкладка «Файлы от контрагентов» (прототип `sntBox`, `renderSent`).
  'files.sent.title': { ru: 'Отправленные файлы', section: S },
  'files.sent.new': { ru: 'Новых', section: S },
  'files.sent.hint': {
    ru: 'Файлы, которые контрагент прислал со своей страницы или через Telegram. Принятый файл становится обычным файлом контрагента с источником «От контрагента» и виден на его странице в разделе «Файлы»; непринятые («Новый» и «Отклонён») удаляются через 30 дней после отправки.',
    section: S,
  },
  'files.tab.all': { ru: 'Все файлы', section: S },
  'files.tab.sent': { ru: 'Файлы от контрагентов', section: S },
  'files.sent.badge': { ru: 'Новые файлы от контрагентов', section: S },
  'files.sent.col.name': { ru: 'Файл', section: S },
  'files.sent.col.cp': { ru: 'Контрагент', section: S },
  'files.sent.col.st': { ru: 'Статус', section: S },
  'files.sent.col.src': { ru: 'Откуда', section: S },
  'files.sent.col.who': { ru: 'Кто отправил', section: S },
  'files.sent.col.at': { ru: 'Когда', section: S },
  'files.sent.col.note': { ru: 'Комментарий', section: S },
  'files.sent.col.resp': { ru: 'Ответственный', section: S },
  'files.sent.col.left': { ru: 'Удалится через, дн.', section: S },
  'files.sent.col.left_short': { ru: 'Удалится', section: S },
  'files.sent.col.ord': { ru: 'Порядок: новые сначала', section: S },
  'files.sent.st.new': { ru: 'Новый', section: S },
  'files.sent.st.accepted': { ru: 'Принят', section: S },
  'files.sent.st.rejected': { ru: 'Отклонён', section: S },
  'files.sent.src.page': { ru: 'Страница', section: S },
  'files.sent.src.telegram': { ru: 'Telegram', section: S },
  'files.sent.who.page': { ru: 'Контрагент', section: S },
  'files.sent.left.one': { ru: 'Удалится через {n} день', section: S },
  'files.sent.left.few': { ru: 'Удалится через {n} дня', section: S },
  'files.sent.left.many': { ru: 'Удалится через {n} дней', section: S },
  'files.sent.left.today': { ru: 'Удалится сегодня', section: S },
  'files.sent.in.one': { ru: 'через {n} день', section: S },
  'files.sent.in.few': { ru: 'через {n} дня', section: S },
  'files.sent.in.many': { ru: 'через {n} дней', section: S },
  'files.sent.in.today': { ru: 'сегодня', section: S },
  'files.sent.count.one': { ru: '{n} файл', section: S },
  'files.sent.count.few': { ru: '{n} файла', section: S },
  'files.sent.count.many': { ru: '{n} файлов', section: S },
  'files.sent.empty.title': { ru: 'Контрагенты пока ничего не присылали', section: S },
  'files.sent.empty.text': {
    ru: 'Файлы со страницы контрагента и из Telegram появятся здесь со статусом «Новый»',
    section: S,
  },
  'files.sent.accept': { ru: 'Принять', section: S },
  'files.sent.reject': { ru: 'Отклонить', section: S },
  'files.sent.open_cp': { ru: 'Открыть контрагента', section: S },
  'files.sent.why': { ru: 'Нужно право «Загружать файлы»', section: S },
  'files.sent.accepted': { ru: 'Файл принят: он среди файлов контрагента', section: S },
  'files.sent.rejected': { ru: 'Файл отклонён, контрагент увидит причину', section: S },
  'files.sent.view.sub': { ru: 'От контрагента · {src}', section: S },
  'files.sent.view.purge': { ru: 'Удаление', section: S },
  'files.sent.view.decided': { ru: '{who}, {at}', section: S },
  'files.sent.reject.title': { ru: 'Отклонить файл', section: S },
  'files.sent.reject.reason': { ru: 'Причина', section: S },
  'files.sent.reject.placeholder': {
    ru: 'Например: не тот месяц, пришлите выписку за октябрь',
    section: S,
  },
  'files.sent.reject.hint': {
    ru: 'Контрагент увидит причину на своей странице. Отклонённый файл удалится через 30 дней после отправки',
    section: S,
  },
  // Галочка «Контрагент может отправлять файлы»: учётная политика (под разделом страницы «Файлы») и блок «Страница контрагента».
  'files.sent.upload': { ru: 'Контрагент может отправлять файлы', section: S },
  'files.sent.upload.policy_hint': {
    ru: 'Кнопка «Отправить файл» в разделе «Файлы» страницы и приём файлов от контрагента в Telegram. У отдельного контрагента можно выключить в его карточке',
    section: S,
  },
  'files.sent.upload.label': { ru: 'Файлы от контрагента', section: S },
  'files.sent.upload.hint': {
    ru: 'Кнопка «Отправить файл» в разделе «Файлы» страницы и приём файлов в Telegram',
    section: S,
  },
  'files.sent.upload.org_off': {
    ru: 'Выключено для всех контрагентов в учётной политике',
    section: S,
  },
  'files.sent.upload.on': { ru: 'Контрагент может отправлять файлы', section: S },
  'files.sent.upload.off': { ru: 'Контрагент не может отправлять файлы', section: S },
  'files.sent.hist.upload': {
    ru: 'Контрагент может отправлять файлы: {state}',
    section: S,
  },
  // Страница контрагента по ссылке (прототип `pubSentHtml`, `pubUpDlg`).
  'err.sent_upload_org_off': {
    ru: 'Выключено для всех контрагентов в учётной политике',
    section: 'Ошибки',
  },
  'pub.sent.send': { ru: 'Отправить файл', section: S },
  'pub.sent.hint': {
    ru: 'Документы для бухгалтера: до 10 файлов за раз, до 20 МБ каждый',
    section: S,
  },
  'pub.sent.list': { ru: 'Отправленные вами', section: S },
  'pub.sent.reason': { ru: 'Причина: {reason}', section: S },
  'pub.sent.tg': { ru: 'из Telegram', section: S },
  'pub.sent.dlg.sub': { ru: 'Файлы получит ваш бухгалтер', section: S },
  'pub.sent.dlg.files': { ru: 'Файлы', section: S },
  'pub.sent.dlg.files_hint': {
    ru: 'До 10 файлов за раз, до 20 МБ каждый. Программы, сценарии и веб-страницы не принимаются',
    section: S,
  },
  'pub.sent.dlg.note': { ru: 'Комментарий', section: S },
  'pub.sent.dlg.note_placeholder': { ru: 'Необязательно: что это за документы', section: S },
  'pub.sent.dlg.ok': { ru: 'Отправить', section: S },
  'pub.sent.done.one': { ru: 'Файл отправлен бухгалтеру', section: S },
  'pub.sent.done.many': { ru: 'Файлы отправлены бухгалтеру: {n}', section: S },
  'pub.foot.upload': {
    ru: 'На странице можно смотреть свои данные, отправлять файлы бухгалтеру и сообщать об оплате. Вопросы — вашему бухгалтеру.',
    section: S,
  },
  // Сообщение ответственному (прототип `sntNotify`): одно на отправку.
  'files.sent.tg.one': { ru: 'Новый файл от контрагента\n{contractor}: {names}', section: S },
  'files.sent.tg.many': {
    ru: 'Новые файлы от контрагента: {n}\n{contractor}: {names}',
    section: S,
  },
  // Тому, кто файлы на сайте не видит, — без контрагента и имён, как текст `sntNotify` прототипа.
  'files.sent.tg.one.bare': { ru: 'Новый файл от контрагента', section: S },
  'files.sent.tg.many.bare': { ru: 'Новые файлы от контрагента: {n}', section: S },
  // История контрагента (прототип `pubUpDlg`, `sntAccept`, `sntRejectDlg`, `sntPurge`).
  'files.sent.hist.send.one': { ru: 'Контрагент отправил со страницы файл: {names}', section: S },
  'files.sent.hist.send.many': {
    ru: 'Контрагент отправил со страницы файлы: {names}',
    section: S,
  },
  // Из Telegram (прототип v115 `pgFileIn`): с именем чата в Telegram; чек — «чек».
  'files.sent.hist.send_tg.one': {
    ru: 'Контрагент отправил через Telegram («{who}») файл: {names}',
    section: S,
  },
  'files.sent.hist.send_tg.many': {
    ru: 'Контрагент отправил через Telegram («{who}») файлы: {names}',
    section: S,
  },
  'files.sent.hist.send_tg.receipt': {
    ru: 'Контрагент отправил через Telegram («{who}») чек: {names}',
    section: S,
  },
  'files.sent.hist.send_tg_anon.one': {
    ru: 'Контрагент отправил через Telegram файл: {names}',
    section: S,
  },
  'files.sent.hist.send_tg_anon.many': {
    ru: 'Контрагент отправил через Telegram файлы: {names}',
    section: S,
  },
  'files.sent.hist.send_tg_anon.receipt': {
    ru: 'Контрагент отправил через Telegram чек: {names}',
    section: S,
  },
  'files.sent.hist.note': { ru: '{text}. Комментарий: {note}', section: S },
  'files.sent.hist.accept': { ru: 'Принят файл от контрагента «{name}»', section: S },
  'files.sent.hist.accept_as': {
    ru: 'Принят файл от контрагента «{name}» (сохранён как «{saved}»)',
    section: S,
  },
  'files.sent.hist.reject': { ru: 'Отклонён файл от контрагента «{name}»: {reason}', section: S },
  'files.sent.hist.purge': {
    ru: 'Удалён непринятый файл от контрагента «{name}»: прошло 30 дней после отправки',
    section: S,
  },
  ...(Object.fromEntries(
    Object.entries(SENT_FILE_MESSAGES).map(([code, ru]) => [
      `err.${code}`,
      { ru, section: 'Ошибки' },
    ]),
  ) as Record<`err.${SentFileProblem}`, UiTextDefault>),
} as const satisfies Record<string, UiTextDefault>;
