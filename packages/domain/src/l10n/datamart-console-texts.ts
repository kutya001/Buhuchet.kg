import type { UiTextDefault } from './texts';

const S = 'Витрина данных';

/**
 * Тексты консоли запросов «Витрины данных» Админки (доработки 27.11.2026: консоль запросов, блоки 1, 3–5;
 * этап 1, П4–П6; прототип v166 `modules/vitrina-console.js`: `renderDmCon`, `dmcSide`, `dmcRun`,
 * `dmcResDraw`, `dmcMineDlg`, `dmcPhone`, `DMC_FN`, `DMC_WARN`, `dmcFieldCard`; `admin/techdocs.js`
 * `td-con`, `td-tpl`; `modules/vitrina.js` `dmTplToCon`). Отказы методов консоли — `err.dm_console_*`
 * (`datamart-admin-texts.ts`).
 */
export const DATAMART_CONSOLE_TEXTS = {
  'tab.dm.con': { ru: 'Консоль', section: 'Вкладки' },
  // Левая панель
  'dm.con.side.db': { ru: 'База', section: S },
  'dm.con.side.api': { ru: 'Методы API', section: S },
  'dm.con.side.pre': { ru: 'Заготовки', section: S },
  'dm.con.side.mine': { ru: 'Мои запросы', section: S },
  'dm.con.q.db': { ru: 'Таблица или поле, можно по-русски', section: S },
  'dm.con.q.api': { ru: 'Метод или адрес', section: S },
  'dm.con.q.mine': { ru: 'Название или текст', section: S },
  'dm.con.nothing': { ru: 'Ничего не нашлось', section: S },
  'dm.con.group_other': { ru: 'Прочее', section: S },
  'dm.con.insert': { ru: 'Вставить в запрос', section: S },
  'dm.con.closed': { ru: 'закрыто для организаций', section: S },
  'dm.con.no_desc': { ru: 'нет описания', section: S },
  'dm.con.schema': { ru: 'Показать на схеме', section: S },
  'dm.con.api.hint': {
    ru: 'Методы чтения (GET). Кнопки передают запрос в консоль, сами ничего не выполняют.',
    section: S,
  },
  'dm.con.api.card': { ru: 'Карточка метода', section: S },
  'dm.con.api.open': { ru: 'Открыть в консоли', section: S },
  'dm.con.api.tpl': { ru: 'Создать шаблон на основе', section: S },
  'dm.con.api.code': { ru: 'У метода нет точного SQL: запрос написан кодом', section: S },
  'dm.con.api.not_select': {
    ru: 'Запрос метода не SELECT: шаблон из него не сделать',
    section: S,
  },
  'dm.con.pre.text': {
    ru: 'Частые запросы и образцы конструкций. Удалённые и заменённые записи уже исключены, деньги — в тыйынах.',
    section: S,
  },
  'dm.con.pre.sys': { ru: 'Готовые шаблоны · {n}', section: S },
  'dm.con.pre.rep_resp': { ru: 'Отчёты контрагентов с ответственным', section: S },
  'dm.con.pre.rep_resp.d': {
    ru: 'Отчёт, срок, статус и ответственный сотрудник; замененные отчёты исключены',
    section: S,
  },
  'dm.con.pre.by_month': { ru: 'Итоги по месяцам: отчёты и налоги', section: S },
  'dm.con.pre.by_month.d': {
    ru: 'Группировка по месяцу срока: число отчётов и сумма налогов в сомах',
    section: S,
  },
  'dm.con.pre.tax_debt': { ru: 'Долг по оплате налогов', section: S },
  'dm.con.pre.tax_debt.d': {
    ru: 'Начислено, оплачено и остаток по контрагенту — только где есть долг',
    section: S,
  },
  'dm.con.pre.with': { ru: 'Подзапрос WITH: отчёты и оплаты без задвоения', section: S },
  'dm.con.pre.with.d': {
    ru: 'Каждая таблица считается своим подзапросом и соединяется с контрагентом — суммы не задваиваются',
    section: S,
  },
  'dm.con.pre.som': { ru: 'Перевод тыйынов в сомы', section: S },
  'dm.con.pre.som.d': {
    ru: 'В базе деньги — целые тыйыны: делим на 100.0 и округляем до копеек (тыйынов)',
    section: S,
  },
  'dm.con.pre.overdue': { ru: 'Просроченные отчёты на сегодня', section: S },
  'dm.con.pre.overdue.d': {
    ru: 'Срок прошёл, отчёт не сдан; сколько дней просрочки',
    section: S,
  },
  'dm.con.pre.fee_period': { ru: 'Оплаты за обслуживание за период', section: S },
  'dm.con.pre.fee_period.d': {
    ru: 'Параметры :date_from и :date_to; удалённые оплаты исключены',
    section: S,
  },
  'dm.con.pre.ops_month': { ru: 'Операции по деньгам за месяц', section: S },
  'dm.con.pre.ops_month.d': {
    ru: 'Параметр :month (ГГГГ-ММ); отменённые операции исключены',
    section: S,
  },
  'dm.con.pre.filter': { ru: 'Задачи сотрудников: FILTER', section: S },
  'dm.con.pre.filter.d': {
    ru: 'Число задач по статусам в одной строке на сотрудника — агрегат с FILTER',
    section: S,
  },
  'dm.con.pre.window': { ru: 'Нарастающий итог: оконная функция', section: S },
  'dm.con.pre.window.d': {
    ru: 'sum(…) OVER (PARTITION BY … ORDER BY …) — налоги контрагента нарастающим итогом',
    section: S,
  },
  'dm.con.pre.no_resp': { ru: 'Контрагенты без ответственного', section: S },
  'dm.con.pre.no_resp.d': {
    ru: 'Обслуживаемые контрагенты, за которыми не закреплён сотрудник',
    section: S,
  },
  'dm.con.mine.tab': { ru: 'Мои запросы · {n}', section: S },
  'dm.con.hist.tab': { ru: 'История · {n}', section: S },
  'dm.con.mine.none': {
    ru: 'Сохранённых запросов нет. «Сохранить в Мои запросы» над редактором. Их видите только вы.',
    section: S,
  },
  'dm.con.hist.none': { ru: 'Запусков ещё не было. Здесь — ваши последние 100.', section: S },
  'dm.con.hist.rows': { ru: 'строк {n}', section: S },
  'dm.con.from_hist': { ru: 'Из истории', section: S },
  'dm.con.outcome.ok': { ru: 'Успешно', section: S },
  'dm.con.outcome.error': { ru: 'Ошибка', section: S },
  'dm.con.outcome.timeout': { ru: 'Долго', section: S },
  'dm.con.outcome.stopped': { ru: 'Остановлен', section: S },
  'dm.con.outcome.refused': { ru: 'Отказ', section: S },
  'dm.con.mine.del': { ru: 'Удалить', section: S },
  'dm.con.mine.del_title': { ru: 'Удалить запрос?', section: S },
  'dm.con.mine.del_text': { ru: '«{name}» пропадёт из «Моих запросов».', section: S },
  'dm.con.mine.deleted': { ru: 'Запрос удалён', section: S },
  // Вкладки запросов и кнопки
  'dm.con.tab.name': { ru: 'Запрос {n}', section: S },
  'dm.con.tab.new': { ru: 'Новая вкладка запроса', section: S },
  'dm.con.tab.close': { ru: 'Закрыть вкладку', section: S },
  'dm.con.run': { ru: 'Выполнить', section: S },
  'dm.con.run_title': {
    ru: 'Ctrl+Enter: выделенный текст, без выделения — оператор под курсором',
    section: S,
  },
  'dm.con.stop': { ru: 'Остановить', section: S },
  'dm.con.stop_idle': { ru: 'Запрос не выполняется', section: S },
  'dm.con.plan': { ru: 'План запроса', section: S },
  'dm.con.format': { ru: 'Форматировать', section: S },
  'dm.con.xl': { ru: 'В Excel', section: S },
  'dm.con.xl_wait': { ru: 'Сначала выполните запрос', section: S },
  'dm.con.save_mine': { ru: 'Сохранить в Мои запросы', section: S },
  'dm.con.save_tpl': { ru: 'Сохранить в шаблон', section: S },
  'dm.con.query': { ru: 'Запрос', section: S },
  // Над редактором: запрос метода API и шаблона
  'dm.con.warn': {
    ru: 'Шаблон возьмёт только запрос метода. Права, область и расчёты, которые метод делает в коде, в шаблон не переходят',
    section: S,
  },
  'dm.con.from': { ru: 'Метод {method}.', section: S },
  'dm.con.changed': { ru: 'Что заменено: {list}.', section: S },
  'dm.con.replace': { ru: 'Что заменить: {list}.', section: S },
  'dm.con.tpl_of': {
    ru: 'Запрос шаблона «{name}»: «Сохранить в шаблон» пишет в этот шаблон',
    section: S,
  },
  'dm.con.tpl_sys': {
    ru: 'Запрос шаблона «{name}»: «Сохранить в шаблон» пишет в этот шаблон — готовый шаблон платформы сохраняется только копией',
    section: S,
  },
  'dm.con.tpl_copy': { ru: 'Готовый шаблон платформы сохраняется копией', section: S },
  'dm.con.par_hint': {
    ru: 'Значение уходит в базу как данные и в текст запроса не вклеивается',
    section: S,
  },
  // «Выполнить» и результат
  'dm.con.no_stmt': { ru: 'Нет запроса под курсором', section: S },
  'dm.con.one_stmt': {
    ru: 'В базу уходит один оператор: выделите один запрос или поставьте курсор на него',
    section: S,
  },
  'dm.con.param_missing': {
    ru: 'Укажите значение параметра :{name} — полоска полей над результатом',
    section: S,
  },
  'dm.con.som': { ru: '{name} · сом', section: S },
  'dm.con.money_note': { ru: 'Деньги — в сомах, в базе тыйыны', section: S },
  'dm.con.plan_hint': {
    ru: '«План запроса» — оценка запроса базой без выполнения: сколько строк и насколько тяжёлый запрос. В журнал консоли он не пишется.',
    section: S,
  },
  'dm.con.plan_rows': { ru: 'строк ≈ {n}', section: S },
  'dm.con.plan_cost': { ru: 'стоимость {n}', section: S },
  // «Сохранить в Мои запросы»
  'dm.con.mine.title': { ru: 'Сохранить в Мои запросы', section: S },
  'dm.con.mine.title_edit': { ru: 'Сохранить запрос', section: S },
  'dm.con.mine.sub': {
    ru: 'Видите только вы. Это не шаблон: организации его не видят',
    section: S,
  },
  'dm.con.mine.name': { ru: 'Название', section: S },
  'dm.con.mine.name_req': { ru: 'Введите название', section: S },
  'dm.con.mine.too_long': { ru: 'Запрос длиннее {n} знаков', section: S },
  'dm.con.mine.as_new': { ru: 'Сохранить как новый', section: S },
  'dm.con.mine.saved': { ru: 'Запрос сохранён в «Мои запросы»', section: S },
  // Телефон
  'dm.con.phone_note': {
    ru: 'На телефоне — «Мои запросы», запуск и результат. Писать запросы — на ПК.',
    section: S,
  },
  'dm.con.phone_none': {
    ru: 'Сохранённых запросов нет: сохраните запрос в консоли на ПК.',
    section: S,
  },
  // «Выполнять как» (этап 2, П7; прототип v167 `#dmc-as`)
  'dm.con.as': { ru: 'Выполнять как', section: S },
  'dm.con.as.adm': { ru: 'Администратор', section: S },
  'dm.con.as.org': { ru: 'Организация «{name}»', section: S },
  'dm.con.as.org_demo': { ru: 'Организация «{name}» (демо)', section: S },
  'dm.con.as.hint_adm': {
    ru: 'Роль шаблонов администратора: все организации, без секретов; до 60 секунд',
    section: S,
  },
  'dm.con.as.hint_org': {
    ru: 'Запрос идёт ролью организаций от «{name}»: видно ровно то, что видит она, таблицы платформы закрыты. Пределы — как у «Показать»: 15 секунд, 50 000 строк',
    section: S,
  },
  'dm.con.res_as': { ru: 'Выполнено как организация «{name}»', section: S },
  'dm.con.hist.as': { ru: 'как «{name}»', section: S },
  // Подсказки и карточка редактора (блок 3)
  'dm.con.money': { ru: 'Деньги', section: S },
  'dm.con.money_tag': { ru: 'деньги в тыйынах', section: S },
  'dm.con.more_refs': { ru: 'ещё {n}', section: S },
  'dm.con.kw': { ru: 'Слово SQL', section: S },
  'dm.con.alias': { ru: 'Псевдоним: {table}', section: S },
  'dm.con.join': { ru: 'Условие по связи таблиц', section: S },
  'dm.con.no_table': { ru: 'Таблицы «{table}» нет в базе', section: S },
  'dm.con.no_field': { ru: 'Поля «{field}» нет в таблице «{table}»', section: S },
  'dm.con.org_closed': {
    ru: 'Таблица {table} — данные платформы, организациям закрыта',
    section: S,
  },
  'dm.con.err_line': { ru: 'Строка {n}: {error}', section: S },
  'dm.con.fn.sum': { ru: 'Сумма значений', section: S },
  'dm.con.fn.count': { ru: 'Число строк', section: S },
  'dm.con.fn.avg': { ru: 'Среднее', section: S },
  'dm.con.fn.min': { ru: 'Наименьшее', section: S },
  'dm.con.fn.max': { ru: 'Наибольшее', section: S },
  'dm.con.fn.coalesce': { ru: 'Первое непустое', section: S },
  'dm.con.fn.nullif': { ru: 'Пусто, если равно', section: S },
  'dm.con.fn.round': { ru: 'Округлить: тыйыны → сомы', section: S },
  'dm.con.fn.date_trunc': { ru: 'Начало месяца, года', section: S },
  'dm.con.fn.to_char': { ru: 'Дата текстом', section: S },
  'dm.con.fn.extract': { ru: 'Год, месяц из даты', section: S },
  'dm.con.fn.current_date': { ru: 'Сегодня', section: S },
  'dm.con.fn.now': { ru: 'Сейчас', section: S },
  'dm.con.fn.string_agg': { ru: 'Склеить строки', section: S },
  'dm.con.fn.greatest': { ru: 'Большее из', section: S },
  'dm.con.fn.least': { ru: 'Меньшее из', section: S },
  'dm.con.fn.lower': { ru: 'Строчными', section: S },
  'dm.con.fn.upper': { ru: 'Заглавными', section: S },
  'dm.con.fn.trim': { ru: 'Без пробелов по краям', section: S },
  'dm.con.fn.concat': { ru: 'Склеить текст', section: S },
  // «Шаблоны»: «Открыть в консоли» в меню строки и в окне шаблона (блок 4, пункт 3); окно шаблона из
  // консоли (блок 1, пункт 7; блок 4, пункт 5; прототип v166 `dmEdit`)
  'dm.tpl.act.console': { ru: 'Открыть в консоли', section: S },
  'dm.ed.sql_changed': { ru: 'Изменено: запрос', section: S },
  'dm.ed.new_sub_con': {
    ru: 'Из консоли: запрос и столбцы последнего запуска уже стоят. Черновик — организации увидят шаблон после проверки и публикации',
    section: S,
  },
  // Пометки перестройки метода API (`dmMethodToSelect`, код → `dm.con.rw.<код>`).
  'dm.con.rw.view': { ru: 'CREATE VIEW {name} … AS SELECT → SELECT', section: S },
  'dm.con.rw.checks': {
    ru: 'Убраны проверки «это администратор» и «моя организация»: их делает роль базы',
    section: S,
  },
  'dm.con.rw.param': { ru: '{from} → :{name}', section: S },
  'dm.con.rw.user': { ru: 'app.current_user_id() → :{name}', section: S },
  'dm.con.rw.money': {
    ru: 'Деньги остаются в тыйынах: столбцам {list} поставлен тип «Деньги»',
    section: S,
  },
  'dm.con.rw.table_param': {
    ru: ':{name} стоит на месте таблицы (в коде метода — таблица Drizzle): впишите имя таблицы',
    section: S,
  },
  'dm.con.rw.denied': {
    ru: '«{word}» консоли нельзя: запрос метода не только читает — замените или уберите',
    section: S,
  },
  'dm.con.rw.lock': {
    ru: 'Запрос метода блокирует строки: уберите FOR UPDATE и подобное',
    section: S,
  },
  'dm.con.rw.svc': {
    ru: 'Служебные функции и представления помечены «-- замените»: {list}',
    section: S,
  },
  'dm.con.rw.cut': { ru: 'Текст метода в описании обрезан: допишите запрос', section: S },
  'dm.con.rw.closed_tables': { ru: 'Таблицы консоли не видно: {list} — замените', section: S },
  'dm.con.rw.closed_fields': { ru: 'Поля консоли не видно: {list} — замените', section: S },
  'dm.con.rw.svc_comment': {
    ru: 'замените: {list} — служебная функция или представление базы, шаблону недоступно',
    section: S,
  },
  'dm.con.ref_by': { ru: '→ {table} по {field}', section: S },
  // Быстрая проверка по ходу набора (прототип `dmcIssues`).
  'dm.con.q.unclosed': { ru: 'Кавычка не закрыта', section: S },
  'dm.con.q.paren': { ru: 'Скобка не закрыта', section: S },
  'dm.con.q.extra': { ru: 'Лишняя закрывающая скобка', section: S },
  'dm.con.q.no_alias': {
    ru: 'Дайте столбцу имя через AS: без него нет столбца вывода',
    section: S,
  },
  // Консоль, этап 2, П7: автостолбец при «Сохранить в шаблон» (прототип `dmcToTpl`).
  'dm.con.cp_auto': {
    ru: 'Добавлен столбец contractor_id — «Контрагент (для области)»',
    section: S,
  },
  'dm.con.cp_auto_mod': {
    ru: 'Добавлен столбец contractor_id — «Контрагент (для области)». Модуль шаблона: «{module}»',
    section: S,
  },
  // Консоль, этап 2, П9: «Собрать запрос» (прототип v167 vitrina-builder.js).
  'dm.con.rw.built': { ru: 'Собрано по таблицам метода: {list}', section: S },
  'dm.b.title': { ru: 'Собрать запрос', section: S },
  'dm.b.sub': { ru: 'Отмечено {n} из {max} · путь связей — по внешним ключам базы', section: S },
  'dm.b.sub_method': {
    ru: 'Отмечено {n} из {max} · путь связей — по внешним ключам базы · таблицы метода {method}',
    section: S,
  },
  'dm.b.cut': {
    ru: 'У метода больше {max} таблиц: отмечены первые {max}. Лишние уберите, нужные добавьте ниже.',
    section: S,
  },
  'dm.b.via': { ru: 'промежуточная', section: S },
  'dm.b.del': { ru: 'Убрать таблицу', section: S },
  'dm.b.via_hint': {
    ru: 'Прямой связи нет: система добавила «{name}», чтобы соединить таблицы.',
    section: S,
  },
  'dm.b.link': { ru: 'Связь: {link}', section: S },
  'dm.b.link_many': { ru: 'Связь: {link} — много строк на одну «{parent}»', section: S },
  'dm.b.first': { ru: 'Первая таблица: от неё идёт запрос', section: S },
  'dm.b.path': { ru: 'Путь связей · {n}', section: S },
  'dm.b.path_hint': { ru: 'Несколько путей: выберите, по какой связи соединять', section: S },
  'dm.b.none': {
    ru: '«{name}»: связи с остальными таблицами не нашлось за {depth} шага. Уберите её или добавьте таблицу, через которую они связаны.',
    section: S,
  },
  'dm.b.none_del': { ru: 'Убрать', section: S },
  'dm.b.add': { ru: 'Добавить таблицу', section: S },
  'dm.b.rows': { ru: 'Какие строки', section: S },
  'dm.b.left': { ru: 'Все строки первой таблицы, даже без пары', section: S },
  'dm.b.inner': { ru: 'Только строки с парой', section: S },
  'dm.b.alive': {
    ru: 'Удалённые и заменённые записи исключены сразу: deleted_at IS NULL, NOT superseded — суммы совпадут с программой',
    section: S,
  },
  'dm.b.dbl': { ru: 'Суммы задвоятся.', section: S },
  'dm.b.dbl_text': {
    ru: '{list} — много строк на одного: каждая строка одной таблицы повторится для каждой строки другой.',
    section: S,
  },
  'dm.b.dbl_sep': {
    ru: '«Считать итоги отдельно» — каждая из них считается своим подзапросом.',
    section: S,
  },
  'dm.b.and': { ru: 'и', section: S },
  'dm.b.sep': { ru: 'Считать итоги отдельно', section: S },
  'dm.b.sep_on': { ru: 'Итоги считаются отдельно', section: S },
  'dm.b.name': { ru: 'Сборка: {list}', section: S },
  'dm.b.no_db': { ru: 'Нет описания базы: сборщик берёт связи из него', section: S },
  'dm.b.no_method_tables': { ru: 'У метода нет таблиц базы, которые он читает', section: S },
  'dm.b.no_tables': { ru: 'Отметьте хотя бы одну таблицу', section: S },
  'dm.b.none_list': { ru: '—', section: S },
  'dm.b.method': { ru: 'Собрать запрос по таблицам метода', section: S },
  'dm.b.pick': { ru: 'Собрать запрос', section: S },
  'dm.b.pick_hint': {
    ru: 'Нажмите на таблицы, которые соединить: до {max}. Отмечено {n}.',
    section: S,
  },
  'dm.b.pick_hint_list': {
    ru: 'Нажмите на таблицы, которые соединить: до {max}. Отмечено {n}: {list}.',
    section: S,
  },
  'dm.b.pick_go': { ru: 'Собрать · {n}', section: S },
} as const satisfies Record<string, UiTextDefault>;
