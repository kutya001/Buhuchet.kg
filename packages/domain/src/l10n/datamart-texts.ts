import { DATAMART_ADMIN_TEXTS } from './datamart-admin-texts';
import { DATAMART_OUT_TEXTS } from './datamart-out-texts';
import { DATAMART_OUTPUT_TEXTS } from './datamart-output-texts';
import type { UiTextDefault } from './texts';

const S = 'Витрина данных';
const E = 'Ошибки';

/**
 * Тексты «Витрины данных» → «API Токены» (доработки 20.11.2026: Витрина данных, блок 5; поток Т, этап 1,
 * П14; прототип v153–v155 `modules/vitrina.js`: `renderDmTok`, `dmNewDlg`, `dmShowTok`, `dmTokDlg`,
 * `dmRevoke`, `dmReissue`, `dmTokSt`, `core/registry.js` ADM и BIZ dm). Модуль меню — у Админки и у
 * организации (этап 3, П2; описание у организации — своим ключом `nav.desc.dm_org`), выключатель
 * «Внешний доступ по API» вкладки «Настройки» — `dm.api.*`. Отказы методов — `err.dm_token_*`.
 */
export const DATAMART_TEXTS = {
  'nav.dm': { ru: 'Витрина данных', section: 'Меню' },
  'nav.short.dm': { ru: 'Витрина', section: 'Меню' },
  'nav.desc.dm': {
    ru: 'Шаблоны отчётов на SQL для организаций и платформы, их вывод, API-токены и журнал запросов.',
    section: 'Меню',
  },
  // Описание модуля у организации (прототип v155 core/registry.js BIZ dm).
  'nav.desc.dm_org': {
    ru: 'Отчёты по готовым шаблонам в таблице как в Excel и выдача тех же данных внешним программам по API-токену.',
    section: 'Меню',
  },
  'tab.dm.tok': { ru: 'API Токены', section: 'Вкладки' },
  'tab.dm.log': { ru: 'Журнал запросов', section: 'Вкладки' },
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
  // «Моя организация» → «Настройки» → «Внешний доступ по API» (блок 5, пункт 9; этап 3, П2; прототип
  // v155 `dmApiBox`, `dmApiMount`).
  'dm.api.title': { ru: 'Внешний доступ по API', section: S },
  'dm.api.label': { ru: 'Выдавать данные внешним программам по API-токенам', section: S },
  'dm.api.tip': {
    ru: 'Токены выпускают в «Витрине данных» → «API Токены»: Excel, Power BI или 1С получают по ним результат одного шаблона, только для чтения. Пока выключено, выпуск токенов недоступен, а выпущенные токены не отвечают; после включения они снова работают.',
    section: S,
  },
  'dm.api.demo': { ru: 'В демо-версии токены не выпускаются', section: S },
  'dm.api.own': { ru: 'Включает и выключает только владелец', section: S },
  'dm.api.other': { ru: 'Включает и выключает владелец организации', section: S },
  'dm.api.live': { ru: '· действующих токенов: {n}', section: S },
  'dm.api.off_title': { ru: 'Выключить внешний доступ?', section: S },
  'dm.api.off_text': {
    ru: 'Действующих токенов: {n}. Они перестанут отвечать, пока доступ снова не включат; отзывать их не нужно.',
    section: S,
  },
  'dm.api.off_ok': { ru: 'Выключить', section: S },
  'dm.api.on_done': { ru: 'Внешний доступ по API включён', section: S },
  'dm.api.off_done': { ru: 'Внешний доступ по API выключен: токены не отвечают', section: S },
  // Строка истории организации (прототип: log('org', 'api', `Внешний доступ по API: включён`)).
  'dm.api.hist_on': { ru: 'Внешний доступ по API: включён', section: S },
  'dm.api.hist_off': { ru: 'Внешний доступ по API: выключен', section: S },
  // Отказы методов токенов (прототип: уведомления `dmNewDlg` и ошибки полей окна).
  'err.ext_api_demo': { ru: 'В демо-версии токены не выпускаются', section: E },
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
  // Ответы внешнего адреса по токену (блок 6, пункты 1, 4, 5; поток Т, этап 2, П11; прототип `dmHow`).
  'err.dm_ext_token': { ru: 'Токен не подходит или истёк', section: E },
  'err.dm_ext_token_in_url': {
    ru: 'Токен в адресе не принимается: передайте его в заголовке Authorization: Bearer',
    section: E,
  },
  'err.dm_ext_stopped': { ru: 'Доступ остановлен', section: E },
  'err.dm_ext_param': { ru: 'Неверный параметр: {param}', section: E },
  'err.dm_ext_rate': { ru: 'Слишком часто, повторите через {n} секунд', section: E },
  'err.dm_ext_timeout': { ru: 'Запрос выполнялся слишком долго', section: E },
  'err.dm_ext_broken': { ru: 'Шаблон временно не работает', section: E },
  // «Как подключить» в окне нового токена и окне своего токена (блок 6, пункт 6; поток Т, этап 2,
  // П12; просьба заказчика 21.11.2026, прототип v160 `dmHow`): общее — ссылка CSV, адрес, заголовок и
  // параметры по отдельности, ниже блок на каждую программу. В шагах `**…**` — жирным, `` `…` `` —
  // моноширинным, `{имя}` — кнопка, которая копирует значение.
  'dm.how.title': { ru: 'Как подключить', section: S },
  'dm.how.tap': { ru: 'Нажмите на адрес, параметр или код — он скопируется.', section: S },
  'dm.how.part': {
    ru: 'Здесь токен показан не целиком. Вместо {token} вставьте полный токен, сохранённый при выпуске; потеряли — перевыпустите.',
    section: S,
  },
  'dm.how.placeholder': { ru: 'bk_ВАШ_ТОКЕН', section: S },
  'dm.how.csv': { ru: 'Ссылка CSV', section: S },
  'dm.how.url': { ru: 'Адрес', section: S },
  'dm.how.header': { ru: 'Заголовок', section: S },
  'dm.how.col.param': { ru: 'Параметр', section: S },
  'dm.how.col.value': { ru: 'Значение', section: S },
  'dm.how.col.what': { ru: 'Что это', section: S },
  'dm.how.optional': { ru: 'необязательный', section: S },
  'dm.how.fmt.date': { ru: 'ГГГГ-ММ-ДД', section: S },
  'dm.how.fmt.month': { ru: 'ГГГГ-ММ', section: S },
  'dm.how.fmt.year': { ru: 'ГГГГ', section: S },
  'dm.how.copy_tip': { ru: 'Нажмите, чтобы скопировать', section: S },
  'dm.how.copy_code_tip': { ru: 'Нажмите, чтобы скопировать код', section: S },
  'dm.how.copy_code': { ru: 'Скопировать код', section: S },
  'dm.how.copied': { ru: 'Скопировано', section: S },
  'dm.how.code_copied': { ru: 'Код скопирован', section: S },
  'dm.how.token_plain': {
    ru: 'Токен хранится в файле открытым текстом: его видит каждый, у кого есть файл',
    section: S,
  },
  'dm.how.parts': {
    ru: 'В «Части URL-адреса» вставьте по одной строке, для каждой следующей — «Добавить часть»:',
    section: S,
  },
  'dm.how.hdr': {
    ru: '«Параметры заголовка HTTP-запроса»: слева {name}, справа {value}',
    section: S,
  },
  'dm.how.pq.title': { ru: 'Excel · Power Query', section: S },
  'dm.how.pq.sub': { ru: 'Таблица обновляется кнопкой «Обновить всё»', section: S },
  'dm.how.pq.h1': { ru: 'Способ 1. «Из Интернета» — быстро', section: S },
  'dm.how.pq.a1': { ru: 'Excel: «Данные» → «Из Интернета» → «Дополнительно».', section: S },
  'dm.how.pq.a4': {
    ru: '«ОК». Если Excel спросит, как входить, — «Анонимно» → «Подключение». В окне просмотра — «Загрузить».',
    section: S,
  },
  'dm.how.pq.a5': {
    ru: 'Поменять даты: «Данные» → «Запросы и подключения» → запрос → «Изменить» → шестерёнка у шага «Источник»: части адреса стоят отдельно.',
    section: S,
  },
  'dm.how.pq.h2': { ru: 'Способ 2. Параметры отдельно — удобно менять', section: S },
  'dm.how.pq.b1': {
    ru: '«Данные» → «Получить данные» → «Из других источников» → «Пустой запрос».',
    section: S,
  },
  'dm.how.pq.b2': {
    ru: '«Главная» → «Расширенный редактор»: замените весь текст кодом ниже → «Готово» → «Закрыть и загрузить».',
    section: S,
  },
  'dm.how.pq.b3': {
    ru: 'Параметры — отдельными строками в начале кода: поменяйте значение и нажмите «Обновить всё».',
    section: S,
  },
  'dm.how.pq.b4': {
    ru: 'Брать значение из ячейки: дайте ячейке имя (поле слева от строки формул), например {name}, и вместо значения в кавычках вставьте:',
    section: S,
  },
  'dm.how.pq.b4_privacy': {
    ru: 'Если Excel спросит об уровнях конфиденциальности — «Организационный» для обоих источников.',
    section: S,
  },
  'dm.how.vba.title': { ru: 'Excel · VBA', section: S },
  'dm.how.vba.sub': { ru: 'Макрос загружает таблицу на текущий лист', section: S },
  'dm.how.vba.a1': { ru: 'Alt+F11 → «Insert» → «Module», вставьте код.', section: S },
  'dm.how.vba.a2': {
    ru: 'Параметры — в начале кода; значение можно брать из ячейки: {cell}',
    section: S,
  },
  'dm.how.vba.a3': {
    ru: 'Alt+F8 → {macro} → «Выполнить». Сохраните книгу как «Книга Excel с поддержкой макросов» (.xlsm).',
    section: S,
  },
  'dm.how.gs.title': { ru: 'Google Таблицы', section: S },
  'dm.how.gs.sub': {
    ru: 'Через Apps Script: по адресу с заголовком Таблицы не загружают',
    section: S,
  },
  'dm.how.gs.a1': {
    ru: 'Таблица: «Расширения» → «Apps Script». Замените текст кодом ниже, сохраните.',
    section: S,
  },
  'dm.how.gs.a2': { ru: 'Выберите функцию {fn} → «Выполнить», разрешите доступ.', section: S },
  'dm.how.gs.a3': {
    ru: 'Обновлять само: «Триггеры» (будильник слева) → «Добавить триггер» → функция load → «По времени».',
    section: S,
  },
  'dm.how.gs.a4': { ru: 'Параметры — в начале кода, в PARAMS.', section: S },
  'dm.how.pbi.title': { ru: 'Power BI', section: S },
  'dm.how.pbi.sub': { ru: 'Отчёт обновляется по расписанию в службе Power BI', section: S },
  'dm.how.pbi.a1': { ru: '«Получить данные» → «Интернет» → «Дополнительно».', section: S },
  'dm.how.pbi.a4': { ru: '«ОК» → «Анонимно» → «Подключение» → «Загрузить».', section: S },
  'dm.how.pbi.h2': { ru: 'Параметры отдельно', section: S },
  'dm.how.pbi.b1': {
    ru: '«Получить данные» → «Пустой запрос» → «Расширенный редактор»: вставьте код ниже. Так работает и обновление по расписанию.',
    section: S,
  },
  'dm.how.pbi.b2': {
    ru: 'Менять без кода: «Преобразовать данные» → «Управление параметрами» → «Создать параметр» с тем же именем, например {name}, и уберите его строку из кода.',
    section: S,
  },
  'dm.how.c1.title': { ru: '1С', section: S },
  'dm.how.c1.sub': { ru: 'HTTPСоединение, ответ в JSON', section: S },
  'dm.how.c1.a1': { ru: 'В обработке или общем модуле (на сервере) вставьте код.', section: S },
  'dm.how.c1.a2': { ru: 'Параметры — в начале кода.', section: S },
  'dm.how.c1.a3': {
    ru: 'Строки — в Данные.rows; если Данные.next заполнен, запросите следующую страницу с {page}.',
    section: S,
  },
  'dm.how.oth.title': { ru: 'Другие сервисы', section: S },
  'dm.how.oth.sub': {
    ru: 'Любая программа, которая умеет GET-запрос с заголовком',
    section: S,
  },
  'dm.how.oth.a1': { ru: 'Адрес: {url}, параметры — после «?».', section: S },
  'dm.how.oth.a1_params': { ru: 'Адрес: {url}, параметры — после «?»: {params}.', section: S },
  'dm.how.oth.a2': {
    ru: 'Заголовок: {name} со значением {value}. В адресе токен не принимается.',
    section: S,
  },
  'dm.how.oth.a3': {
    ru: 'Таблица CSV — с {csv}, без него — JSON. Страница — 1 000 строк, больше — {limit}, следующая — {page}.',
    section: S,
  },
  'dm.how.answer': { ru: 'Пример ответа JSON', section: S },
  'dm.how.sample': { ru: 'Пример', section: S },
  'dm.how.limits': {
    ru: 'Деньги — числом в сомах. Пределы на токен: 1 запрос одновременно, 30 в минуту, 5 000 в сутки; сверх них — ответ 429, повторите через время из Retry-After.',
    section: S,
  },
  'dm.how.note': {
    ru: 'Данные уходят за пределы системы: за то, куда они попадут дальше, отвечает организация, выпустившая токен.',
    section: S,
  },
  // Комментарии в коде программ «Как подключить» (прототип v160 `dmHow`): код вставляют в Excel,
  // Google Таблицы, Power BI и 1С как есть.
  'dm.how.code.token': { ru: '1. Токен (полностью, вместе с bk_)', section: S },
  'dm.how.code.token_sheets': {
    ru: '1. Токен (полностью, вместе с bk_). Его видят все редакторы таблицы',
    section: S,
  },
  'dm.how.code.params': { ru: '2. Параметры: меняйте значения здесь', section: S },
  'dm.how.code.params_refresh': {
    ru: '2. Параметры: меняйте значения здесь, затем «Обновить»',
    section: S,
  },
  'dm.how.code.params_cells': {
    ru: '2. Параметры: впишите значения или берите из ячеек, например Range("B1").Text',
    section: S,
  },
  'dm.how.code.query': { ru: '3. Запрос — менять не нужно', section: S },
  'dm.how.code.load': { ru: '3. Загрузка — менять не нужно', section: S },
  'dm.how.code.parse': {
    ru: '4. Разбор CSV по кавычкам, по одной ячейке; текст, похожий на формулу, — с апострофом',
    section: S,
  },
  'dm.how.code.guard': { ru: 'текст, похожий на формулу, — с апострофом', section: S },
  'dm.how.code.error': { ru: 'Ошибка', section: S },
  'dm.how.code.data_1c': {
    ru: 'Данные.columns — столбцы, Данные.rows — строки, Данные.next — адрес следующей страницы (Неопределено, если её нет)',
    section: S,
  },
  'dm.how.code.row_1c': { ru: 'Строка.<код столбца>, например Строка.{key}', section: S },
  'dm.how.code.rows': { ru: 'строк', section: S },
  // Админка → «Журнал запросов» (блок 6, пункт 7; поток Т, этап 2, П11; прототип `renderDmLog`).
  'dm.log.plate.today': { ru: 'Запросов сегодня', section: S },
  'dm.log.plate.errors': { ru: 'Ошибок сегодня', section: S },
  'dm.log.plate.tokens': { ru: 'Действующих токенов', section: S },
  'dm.log.empty_title': { ru: 'Запросов пока не было', section: S },
  'dm.log.empty_text': { ru: 'Здесь появятся запросы внешних программ по токенам.', section: S },
  'dm.log.count.one': { ru: '{n} запрос', section: S },
  'dm.log.count.few': { ru: '{n} запроса', section: S },
  'dm.log.count.many': { ru: '{n} запросов', section: S },
  'dm.log.col.at': { ru: 'Когда', section: S },
  'dm.log.col.res': { ru: 'Итог', section: S },
  'dm.log.col.org': { ru: 'Организация', section: S },
  'dm.log.col.tok': { ru: 'Токен', section: S },
  'dm.log.col.tpl': { ru: 'Шаблон', section: S },
  'dm.log.col.params': { ru: 'Параметры', section: S },
  'dm.log.col.rows': { ru: 'Строк', section: S },
  'dm.log.col.ms': { ru: 'Время, мс', section: S },
  'dm.log.col.err': { ru: 'Ошибка', section: S },
  'dm.log.col.ip': { ru: 'Адрес', section: S },
  // Редактор шаблонов Админки (этап 2, П3).
  ...DATAMART_ADMIN_TEXTS,
  // Экраны «Вывод», каталог «Шаблоны» и «Попросить шаблон» (этап 2, П6–П7, поток И).
  ...DATAMART_OUT_TEXTS,
} as const satisfies Record<string, UiTextDefault>;
