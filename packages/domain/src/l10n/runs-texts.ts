import type { UiTextDefault } from './texts';

const S = 'Админка';

/**
 * Тексты Админки → «Запуски» (решение заказчика 17.11.2026; прототип v132 admin/runs.js и
 * core/registry.js, ADM runs): модуль меню, вкладки «Задачи» и «Запуски», окно «Запуск». Названия задач — `alert.job.<имя>` (alerts-texts.ts), «Что
 * делает» — `runs.what.<имя>`, «Что сделано» с числом — `runs.done.<имя>` (точки и дефисы имени — «_»).
 */
export const RUNS_TEXTS = {
  'nav.runs': { ru: 'Запуски', section: 'Меню' },
  'nav.short.runs': { ru: 'Запуски', section: 'Меню' },
  'nav.desc.runs': {
    ru: 'Задачи по расписанию и журнал их запусков: что запускалось, когда, с каким итогом и ошибкой. Только просмотр: запустить задачу или изменить расписание отсюда нельзя.',
    section: 'Меню',
  },
  'tab.runs.jobs': { ru: 'Задачи', section: 'Вкладки' },
  'tab.runs.runs': { ru: 'Запуски', section: 'Вкладки' },
  // Плашки.
  'runs.plate.ok': { ru: 'Работают', section: S },
  'runs.plate.ok_value': { ru: '{n} из {total}', section: S },
  'runs.plate.fail': { ru: 'Падают', section: S },
  'runs.plate.fail_sub': { ru: 'три неудачи подряд', section: S },
  'runs.plate.miss': { ru: 'Не запускались', section: S },
  'runs.plate.miss_sub': { ru: 'пропущен запуск', section: S },
  'runs.plate.err': { ru: 'Ошибок за сутки', section: S },
  // Столбцы «Задач» и «Запусков».
  'runs.col.title': { ru: 'Задача', section: S },
  'runs.col.every': { ru: 'Как часто', section: S },
  'runs.col.last': { ru: 'Последний запуск', section: S },
  'runs.col.ok': { ru: 'Последний успех', section: S },
  'runs.col.fails': { ru: 'Неудач подряд', section: S },
  'runs.col.state': { ru: 'Состояние', section: S },
  'runs.col.what': { ru: 'Что делает', section: S },
  'runs.col.name': { ru: 'Служебное имя', section: S },
  'runs.col.start': { ru: 'Начало', section: S },
  'runs.col.st': { ru: 'Итог', section: S },
  'runs.col.dur': { ru: 'Длительность', section: S },
  'runs.col.tr': { ru: 'Попытка', section: S },
  'runs.col.done': { ru: 'Что сделано', section: S },
  'runs.col.err': { ru: 'Ошибка', section: S },
  'runs.col.slot': { ru: 'За какое время', section: S },
  'runs.col.end': { ru: 'Окончание', section: S },
  'runs.state.ok': { ru: 'Работает', section: S },
  'runs.state.failing': { ru: 'Падает', section: S },
  'runs.state.missed': { ru: 'Не запускалась', section: S },
  'runs.st.ok': { ru: 'Успешно', section: S },
  'runs.st.error': { ru: 'Ошибка', section: S },
  'runs.st.running': { ru: 'Выполняется', section: S },
  // «Как часто» — по расписанию задачи, время — по Бишкеку.
  'runs.every.minute': { ru: 'Каждую минуту', section: S },
  'runs.every.minutes.one': { ru: 'Каждую {n} минуту', section: S },
  'runs.every.minutes.few': { ru: 'Каждые {n} минуты', section: S },
  'runs.every.minutes.many': { ru: 'Каждые {n} минут', section: S },
  'runs.every.hourly': { ru: 'Каждый час в :{minute}', section: S },
  'runs.every.daily': { ru: 'Каждый день в {time}', section: S },
  'runs.every.times.one': { ru: '{n} раз в сутки: {times}', section: S },
  'runs.every.times.few': { ru: '{n} раза в сутки: {times}', section: S },
  'runs.every.times.many': { ru: '{n} раз в сутки: {times}', section: S },
  'runs.every.other': { ru: 'По расписанию {cron}', section: S },
  'runs.try': { ru: '{n} из {max}', section: S },
  'runs.dur.s': { ru: '{s} с', section: S },
  'runs.dur.m': { ru: '{m} мин {s} с', section: S },
  'runs.jobs.count.one': { ru: '{n} задача', section: S },
  'runs.jobs.count.few': { ru: '{n} задачи', section: S },
  'runs.jobs.count.many': { ru: '{n} задач', section: S },
  'runs.count.one': { ru: '{n} запуск', section: S },
  'runs.count.few': { ru: '{n} запуска', section: S },
  'runs.count.many': { ru: '{n} запусков', section: S },
  'runs.menu.runs': { ru: 'Запуски задачи', section: S },
  'runs.menu.open': { ru: 'Открыть запуск', section: S },
  // Переключатели журнала запусков.
  'runs.seg.kind': { ru: 'Какие запуски', section: S },
  'runs.seg.imp': { ru: 'Важные', section: S },
  'runs.seg.imp_title': { ru: 'Ошибки и запуски, которые что-то сделали', section: S },
  'runs.seg.all': { ru: 'Все', section: S },
  'runs.seg.period': { ru: 'Период', section: S },
  'runs.per.1': { ru: 'Сегодня', section: S },
  'runs.per.7': { ru: '7 дней', section: S },
  'runs.per.30': { ru: '30 дней', section: S },
  'runs.note': { ru: 'Время — по Бишкеку · журнал хранится 30 дней', section: S },
  'runs.empty': { ru: 'Запусков за период нет', section: S },
  'runs.empty.imp': {
    ru: 'Ошибок нет, пустые успешные запуски скрыты. Переключите на «Все» или выберите период длиннее.',
    section: S,
  },
  'runs.empty.all': { ru: 'Выберите период длиннее.', section: S },
  // Окно «Запуск».
  'runs.card.sub': { ru: 'попытка {try}', section: S },
  'runs.card.running': { ru: 'ещё выполняется', section: S },
  'runs.card.error': { ru: 'Ошибка', section: S },
  'runs.card.copy': { ru: 'Скопировать', section: S },
  'runs.card.copied': { ru: 'Текст ошибки скопирован', section: S },
  'runs.card.attempts': { ru: 'Другие попытки этого запуска', section: S },
  'runs.card.attempt': { ru: 'Попытка {try}', section: S },
  'runs.card.attempts_hint': {
    ru: 'Неудачный запуск сайт повторяет сам через 2 и через 10 минут — всего не больше трёх попыток.',
    section: S,
  },
  'runs.card.alert': { ru: 'Администраторам отправлено сообщение о сбое · {at} ·', section: S },
  'runs.card.alert_open': { ru: 'открыть в журнале Telegram', section: S },
  'runs.card.missing': { ru: 'Запуск не найден: журнал хранится 30 дней', section: S },
  // «Что сделано».
  'runs.done.nothing': { ru: 'Нечего делать', section: S },
  'runs.done.any': { ru: 'Сделано: {n}', section: S },
  'runs.done.telegram_send': { ru: 'Отправлено сообщений: {n}', section: S },
  'runs.done.telegram_reminders': { ru: 'Поставлено в очередь сообщений: {n}', section: S },
  'runs.done.telegram_bell_day': { ru: 'Добавлено строк колокольчика: {n}', section: S },
  'runs.done.telegram_bell_cleanup': { ru: 'Удалено строк колокольчика: {n}', section: S },
  'runs.done.reports_create_due': { ru: 'Создано отчётов: {n}', section: S },
  'runs.done.contractors_sync_service_status': { ru: 'Изменено статусов: {n}', section: S },
  'runs.done.files_erase_deleted': { ru: 'Стёрто файлов: {n}', section: S },
  'runs.done.kb_cleanup_video_uploads': { ru: 'Удалено загрузок видео: {n}', section: S },
  'runs.done.files_storage_reconcile': { ru: 'Проверено объектов хранилища: {n}', section: S },
  'runs.done.subs_reminders': { ru: 'Напоминаний об оплате: {n}', section: S },
  'runs.done.subs_memory_checks': { ru: 'Сообщений о памяти и чеках: {n}', section: S },
  'runs.done.dm_token_expiry': { ru: 'Напоминаний о сроке токенов: {n}', section: S },
  'runs.done.auth_cleanup_login_attempts': { ru: 'Удалено записей: {n}', section: S },
  'runs.done.system_cleanup_rate_limits': { ru: 'Удалено записей: {n}', section: S },
  'runs.done.contractor_page_cleanup_grants': { ru: 'Удалено записей: {n}', section: S },
  'runs.done.system_cleanup_scheduler_runs': {
    ru: 'Удалено запусков и сообщений бота: {n}',
    section: S,
  },
  // «Что делает».
  'runs.what.telegram_send': {
    ru: 'Отправляет очередь сообщений бота пачками по 25, ошибки повторяет до 5 раз',
    section: S,
  },
  'runs.what.telegram_reminders': {
    ru: 'Напоминания о сроках за 7 и 3 дня и в день срока, сводка недели — в час каждой организации',
    section: S,
  },
  'runs.what.telegram_register_webhook': {
    ru: 'Сообщает Telegram адрес сайта и меню команд бота, проверяет доставку обновлений',
    section: S,
  },
  'runs.what.telegram_bell_day': {
    ru: 'Кладёт строку «Сроки на сегодня» в колокольчик в час напоминаний',
    section: S,
  },
  'runs.what.telegram_bell_cleanup': {
    ru: 'Удаляет строки колокольчика старше 90 дней',
    section: S,
  },
  'runs.what.reports_create_due': {
    ru: 'Создаёт отчёты по назначениям контрагентов на новые периоды',
    section: S,
  },
  'runs.what.contractors_sync_service_status': {
    ru: 'Переводит контрагентов в «Приостановлен» и обратно по датам обслуживания',
    section: S,
  },
  'runs.what.contractor_page_telegram_pay': {
    ru: 'Отправляет клиентам контрагентов сообщение «К оплате» в день организации',
    section: S,
  },
  'runs.what.contractor_page_telegram_debt': {
    ru: 'Напоминает клиентам о долге за обслуживание',
    section: S,
  },
  'runs.what.contractor_page_cleanup_grants': {
    ru: 'Удаляет истёкшие входы на страницу контрагента и ссылки «Подключить Telegram»',
    section: S,
  },
  'runs.what.platform_dicts_dues_recalc': {
    ru: 'Пересчитывает сроки отчётов после правки праздников и видов отчётов',
    section: S,
  },
  'runs.what.files_cleanup_pending': {
    ru: 'Убирает загрузки файлов, которые не закончились за сутки',
    section: S,
  },
  'runs.what.files_sent_purge': {
    ru: 'Удаляет файлы со страницы контрагента, которые не приняли за 30 дней',
    section: S,
  },
  'runs.what.files_erase_deleted': {
    ru: 'Стирает из хранилища файлы, удалённые больше суток назад',
    section: S,
  },
  'runs.what.files_storage_reconcile': {
    ru: 'Сверяет записи файлов с хранилищем: лишние файлы в хранилище и записи без файла — в итог для модуля «Файлы»; сама ничего не удаляет',
    section: S,
  },
  'runs.what.subs_reminders': {
    ru: 'Напоминает владельцам об оплате подписки за 7 дней до «Оплачено до» и каждый день до оплаты — в час напоминаний организации; после чека не напоминает',
    section: S,
  },
  'runs.what.subs_memory_checks': {
    ru: 'Память 80 % и 100 % — владельцам один раз, пока занятое не опустится ниже порога; непроверенные чеки — повтор администраторам, через 3 дня — пометка «Ждёт проверки больше 3 дней»',
    section: S,
  },
  'runs.what.dm_token_expiry': {
    ru: 'Напоминает владельцам организации в Telegram и колокольчик за 7 дней до конца срока API-токена — один раз на токен',
    section: S,
  },
  'runs.what.files_storage_retry': {
    ru: 'Повторяет удаление файлов из хранилища, если с первого раза не получилось',
    section: S,
  },
  'runs.what.kb_cleanup_video_uploads': {
    ru: 'Удаляет видео «Базы знаний», загрузку которых бросили',
    section: S,
  },
  'runs.what.leads_docs_purge': { ru: 'Удаляет файлы отклонённых заявок через 7 дней', section: S },
  'runs.what.auth_cleanup_login_attempts': {
    ru: 'Забывает неверные пароли старше часа',
    section: S,
  },
  'runs.what.auth_watch_login_locks': {
    ru: 'Сообщает администраторам о частых блокировках входа',
    section: S,
  },
  'runs.what.system_cleanup_rate_limits': {
    ru: 'Удаляет счётчики выгрузок «В Excel» старше суток',
    section: S,
  },
  'runs.what.system_cleanup_scheduler_runs': {
    ru: 'Удаляет запуски старше 30 дней, переписку бота и журнал запросов «Витрины данных» старше 90 дней',
    section: S,
  },
} as const satisfies Record<string, UiTextDefault>;
