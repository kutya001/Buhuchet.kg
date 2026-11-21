import { DATAMART_OUT_TEXTS } from './datamart-out-texts';
import { DATAMART_OUTPUT_TEXTS } from './datamart-output-texts';
import type { UiTextDefault } from './texts';

const S = 'Витрина данных';
const E = 'Ошибки';

/**
 * Тексты «Витрины данных» → «API Токены» (доработки 20.11.2026: Витрина данных, блок 5; поток Т, этап 1,
 * П14; прототип v153–v155 `modules/vitrina.js`: `renderDmTok`, `dmNewDlg`, `dmShowTok`, `dmTokDlg`,
 * `dmRevoke`, `dmReissue`, `dmTokSt`, `core/registry.js` ADM dm). Модуль меню — пока только Админки:
 * у организации модуль, «Вывод» и «Шаблоны» добавляет этап 2 (описание модуля у организации — своим
 * ключом). Отказы методов — `err.dm_token_*`.
 */
export const DATAMART_TEXTS = {
  'nav.dm': { ru: 'Витрина данных', section: 'Меню' },
  'nav.short.dm': { ru: 'Витрина', section: 'Меню' },
  'nav.desc.dm': {
    ru: 'Шаблоны отчётов на SQL для организаций и платформы, их вывод, API-токены и журнал запросов.',
    section: 'Меню',
  },
  'tab.dm.tok': { ru: 'API Токены', section: 'Вкладки' },
  'add.dm.tok': { ru: 'Токен', section: 'Добавление' },
  // Над списком.
  'dm.tok.note': {
    ru: 'Токен — ключ, по которому внешняя программа (Excel, Power BI, 1С) получает результат одного шаблона, только для чтения. Срок — до 180 дней, токен показывается один раз при создании; действующих — не больше {max}.',
    section: S,
  },
  'dm.tok.note_admin': {
    ru: 'Токен — ключ, по которому внешняя программа (Excel, Power BI, 1С) получает результат одного шаблона, только для чтения. Срок — до 180 дней, токен показывается один раз при создании. Здесь ваши токены к шаблонам администратора и токены всех организаций: токен организации можно только отозвать, например при утечке.',
    section: S,
  },
  'dm.tok.api_off': {
    ru: 'Внешний доступ по API выключен. Включить его может владелец в «Моя организация». Пока он выключен, выпуск токенов недоступен, а выпущенные токены не отвечают.',
    section: S,
  },
  'dm.tok.api_off_open': { ru: 'Открыть настройки', section: S },
  'dm.tok.demo_title': { ru: 'В демо-версии токены не выпускаются', section: S },
  'dm.tok.demo_text': {
    ru: 'Демо-организация открыта всем. В своей организации владелец включает «Внешний доступ по API», и токены выпускают здесь.',
    section: S,
  },
  'dm.tok.empty_title': { ru: 'Токенов пока нет', section: S },
  'dm.tok.empty_admin': {
    ru: 'Выпустите токен к шаблону администратора кнопкой «+ Токен».',
    section: S,
  },
  'dm.tok.empty_org': {
    ru: 'Токен выпускают кнопкой «+ Токен» или «Выпустить токен» в каталоге шаблонов.',
    section: S,
  },
  'dm.tok.count.one': { ru: '{n} токен', section: S },
  'dm.tok.count.few': { ru: '{n} токена', section: S },
  'dm.tok.count.many': { ru: '{n} токенов', section: S },
  // Столбцы списка и строки окна токена.
  'dm.tok.col.name': { ru: 'Название', section: S },
  'dm.tok.col.st': { ru: 'Состояние', section: S },
  'dm.tok.col.org': { ru: 'Организация', section: S },
  'dm.tok.col.tpl': { ru: 'Шаблон', section: S },
  'dm.tok.col.by': { ru: 'Кто создал', section: S },
  'dm.tok.col.at': { ru: 'Создан', section: S },
  'dm.tok.col.till': { ru: 'Действует до', section: S },
  'dm.tok.col.last': { ru: 'Последний запрос', section: S },
  'dm.tok.col.n30': { ru: 'Запросов за 30 дней', section: S },
  'dm.tok.col.token': { ru: 'Токен', section: S },
  'dm.tok.col.prev': { ru: 'Заменил токен', section: S },
  // Состояние токена и почему он не отвечает (прототип `dmTokSt`).
  'dm.tok.state.active': { ru: 'Действует', section: S },
  'dm.tok.state.stopped': { ru: 'Остановлен', section: S },
  'dm.tok.state.expired': { ru: 'Истёк', section: S },
  'dm.tok.state.revoked': { ru: 'Отозван', section: S },
  'dm.tok.stop.tpl_off': { ru: 'Шаблон отключён', section: S },
  'dm.tok.stop.tpl_broken': { ru: 'Шаблон временно не работает', section: S },
  'dm.tok.stop.no_access': { ru: 'Организацию убрали из доступа шаблона', section: S },
  'dm.tok.stop.org_blocked': { ru: 'Организация заблокирована', section: S },
  'dm.tok.stop.sub_closed': { ru: 'Доступ закрыт по подписке', section: S },
  'dm.tok.stop.api_off': { ru: 'Внешний доступ по API выключен', section: S },
  'dm.tok.revoked_note': { ru: '{at}, {who}', section: S },
  'dm.tok.reissued_note': { ru: 'Перевыпущен: работает до {till}', section: S },
  'dm.tok.who_admin': { ru: 'Администратор платформы', section: S },
  'dm.tok.who_left': { ru: '{name} (уволен)', section: S },
  // Меню строки и кнопки окна токена.
  'dm.tok.act.open': { ru: 'Открыть', section: S },
  'dm.tok.act.reissue': { ru: 'Перевыпустить', section: S },
  'dm.tok.act.revoke': { ru: 'Отозвать', section: S },
  // «Новый API-токен» (прототип `dmNewDlg`).
  'dm.tok.new.title': { ru: 'Новый API-токен', section: S },
  'dm.tok.new.sub_admin': {
    ru: 'Токен администратора платформы к шаблону «Для администратора»',
    section: S,
  },
  'dm.tok.new.sub_org': {
    ru: 'Токен организации: работает и после увольнения сотрудника, который его создал',
    section: S,
  },
  'dm.tok.new.tpl': { ru: 'Шаблон', section: S },
  'dm.tok.new.tpl_hint': {
    ru: 'Один токен открывает один шаблон; к шаблону можно выпустить несколько токенов — по одному на подключение',
    section: S,
  },
  'dm.tok.new.name': { ru: 'Название', section: S },
  'dm.tok.new.name_ph': { ru: 'Например: Power BI директора', section: S },
  'dm.tok.new.name_hint': {
    ru: 'Чтобы потом понять, какую программу отключит «Отозвать»',
    section: S,
  },
  'dm.tok.new.term': { ru: 'Срок', section: S },
  'dm.tok.new.term_hint': {
    ru: 'Не больше 180 дней. Продления нет: срок истёк — выпустите новый',
    section: S,
  },
  'dm.tok.term.one': { ru: '{n} день', section: S },
  'dm.tok.term.few': { ru: '{n} дня', section: S },
  'dm.tok.term.many': { ru: '{n} дней', section: S },
  'dm.tok.new.ok': { ru: 'Создать', section: S },
  // Группы шаблонов в поле «Шаблон» (прототип `dmOptHtml`, `DM_MODS`).
  'dm.group.admin': { ru: 'Для администратора', section: S },
  'dm.mod.cps': { ru: 'Контрагенты', section: S },
  'dm.mod.reports': { ru: 'Отчеты для сдачи', section: S },
  'dm.mod.fin': { ru: 'Финансовые операции по контрагентам', section: S },
  'dm.mod.projects': { ru: 'Проекты контрагентов', section: S },
  'dm.mod.kpi': { ru: 'Показатели контрагентов', section: S },
  'dm.mod.staff': { ru: 'Сотрудники', section: S },
  'dm.mod.other': { ru: 'Прочее', section: S },
  // Токен один раз (прототип `dmShowTok`).
  'dm.tok.show.title': { ru: 'Скопируйте токен. Больше он не покажется', section: S },
  'dm.tok.show.sub': { ru: '{name} · {tpl} · действует до {till}', section: S },
  'dm.tok.show.copy': { ru: 'Скопировать', section: S },
  'dm.tok.show.copied': { ru: 'Токен скопирован', section: S },
  'dm.tok.show.hint': {
    ru: 'В системе остаются только первые знаки: {prefix}… Потеряли токен — перевыпустите его.',
    section: S,
  },
  'dm.tok.show.done': { ru: 'Готово, токен сохранён', section: S },
  // Журнал запросов токена в его окне (прототип `dmTokDlg`).
  'dm.tok.log.title': { ru: 'Журнал запросов · {n}', section: S },
  'dm.tok.log.at': { ru: 'Когда', section: S },
  'dm.tok.log.params': { ru: 'Параметры', section: S },
  'dm.tok.log.rows': { ru: 'Строк', section: S },
  'dm.tok.log.ms': { ru: 'Время, мс', section: S },
  'dm.tok.log.res': { ru: 'Итог', section: S },
  'dm.tok.log.ip': { ru: 'Адрес', section: S },
  'dm.tok.log.empty': { ru: 'Запросов по этому токену ещё не было', section: S },
  'dm.tok.log.keep': { ru: 'Журнал хранится 90 дней.', section: S },
  'dm.res.ok': { ru: 'Успешно', section: S },
  'dm.res.error': { ru: 'Ошибка', section: S },
  // «Отозвать» и «Перевыпустить» (прототип `dmRevoke`, `dmReissue`).
  'dm.tok.revoke.title': { ru: 'Отозвать токен?', section: S },
  'dm.tok.revoke.text': {
    ru: 'Токен «{name}» перестанет работать сразу. Вернуть его нельзя: понадобится — выпустите новый.',
    section: S,
  },
  'dm.tok.revoke.text_other': {
    ru: 'Токен «{name}» перестанет работать сразу; организация «{org}» увидит, что его отозвал администратор платформы. Вернуть его нельзя: понадобится — выпустите новый.',
    section: S,
  },
  'dm.tok.revoke.ok': { ru: 'Отозвать', section: S },
  'dm.tok.revoke.done': { ru: 'Токен отозван', section: S },
  'dm.tok.reissue.title': { ru: 'Перевыпустить токен?', section: S },
  'dm.tok.reissue.text': {
    ru: 'Новый токен — с тем же шаблоном, названием и сроком. Старый {prefix}… проработает ещё 24 часа, чтобы вы успели заменить его в программе.',
    section: S,
  },
  'dm.tok.reissue.ok': { ru: 'Перевыпустить', section: S },
  // Отказы методов токенов (прототип: уведомления `dmNewDlg` и ошибки полей окна).
  'err.dm_token_demo': {
    ru: 'В демо-версии токены не выпускаются: демо-организация открыта всем',
    section: E,
  },
  'err.dm_token_no_right': { ru: 'Нужно право «Управлять API-токенами»', section: E },
  'err.dm_token_api_off': {
    ru: 'Внешний доступ по API выключен. Включить его может владелец в «Моя организация»',
    section: E,
  },
  'err.dm_token_sub_closed': {
    ru: 'Доступ закрыт по подписке: токены не выпускаются до оплаты',
    section: E,
  },
  'err.dm_token_limit': {
    ru: 'Действующих токенов уже {max}: отзовите ненужный',
    section: E,
  },
  'err.dm_token_no_templates': { ru: 'Нет опубликованных шаблонов для токена', section: E },
  'err.dm_token_template': {
    ru: 'Шаблон недоступен для токена: он не опубликован или к нему нет доступа',
    section: E,
  },
  'err.dm_token_term': { ru: 'Срок токена — 7, 30, 90 или 180 дней', section: E },
  'err.dm_token_name_required': { ru: 'Введите название', section: E },
  'err.dm_token_name_long': { ru: 'Название — не длиннее {max} знаков', section: E },
  'err.dm_token_name_taken': { ru: 'Токен с таким названием уже действует', section: E },
  'err.dm_token_dead': { ru: 'Токен уже отозван или истёк', section: E },
  'err.dm_token_reissued': { ru: 'Токен уже перевыпущен', section: E },
  'err.dm_token_not_mine': {
    ru: 'Токен организации можно только отозвать',
    section: E,
  },
  'err.dm_token_rate': {
    ru: 'Слишком много новых токенов за час. Попробуйте позже',
    section: E,
  },
  // «Вывод» и каталог «Шаблоны» (этап 2, П3–П4).
  ...DATAMART_OUTPUT_TEXTS,
  // Экраны «Вывод», каталог «Шаблоны» и «Попросить шаблон» (этап 2, П6–П7, поток И).
  ...DATAMART_OUT_TEXTS,
} as const satisfies Record<string, UiTextDefault>;
