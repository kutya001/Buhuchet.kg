import type { UiTextDefault } from './texts';

const S = 'Админка';
const E = 'Ошибки';

/**
 * Тексты Админки → «Телеграм» задачи 2.41 (прототип admin/telegram.js): «Журнал» (плашки, столбцы,
 * «Повторить отправку», «Повторить ошибки»), «Бот платформы» (вебхук, «Заменить токен», очередь
 * отправки) и «Рассылка». Подписи видов сообщений — `telegram.kind.*` (telegram-texts.ts).
 */
export const TELEGRAM_ADMIN_TEXTS = {
  // «Журнал».
  'tgadm.plate.queue': { ru: 'В очереди', section: S },
  'tgadm.plate.queue_sub': { ru: 'отправляются пачками', section: S },
  'tgadm.plate.errors': { ru: 'Ошибки отправки', section: S },
  'tgadm.plate.errors_sub': { ru: 'после 5 повторов', section: S },
  'tgadm.plate.sent': { ru: 'Отправлено сегодня', section: S },
  'tgadm.col.at': { ru: 'Время', section: S },
  'tgadm.col.to': { ru: 'Получатель', section: S },
  'tgadm.col.org': { ru: 'Организация', section: S },
  'tgadm.col.kind': { ru: 'Тип сообщения', section: S },
  'tgadm.col.st': { ru: 'Статус', section: S },
  'tgadm.col.tries': { ru: 'Попыток', section: S },
  'tgadm.col.err': { ru: 'Ошибка', section: S },
  'tgadm.org.platform': { ru: 'Платформа', section: S },
  'tgadm.org.stand': { ru: 'Тестовый стенд', section: S },
  'tgadm.st.sent': { ru: 'Отправлено', section: S },
  'tgadm.st.pending': { ru: 'Ожидает', section: S },
  'tgadm.st.error': { ru: 'Ошибка', section: S },
  'tgadm.err.unlinked': {
    ru: 'Получатель отвязал или сменил Telegram либо заблокирован: в прежний чат сообщение не отправляется',
    section: S,
  },
  'tgadm.count.one': { ru: '{n} сообщение', section: S },
  'tgadm.count.few': { ru: '{n} сообщения', section: S },
  'tgadm.count.many': { ru: '{n} сообщений', section: S },
  'tgadm.retry': { ru: 'Повторить отправку', section: S },
  'tgadm.retry.not_error': { ru: 'Повтор доступен только для ошибок', section: S },
  'tgadm.retry.code': {
    ru: 'Код восстановления повторно не отправляется: пользователь запросит новый',
    section: S,
  },
  'tgadm.retry.relink_code': {
    ru: 'Код замены Telegram повторно не отправляется: пользователь запросит новый',
    section: S,
  },
  'tgadm.retry.done': { ru: 'Сообщение снова в очереди', section: S },
  'tgadm.retry.none': { ru: 'Сообщение уже не в «Ошибке»: журнал обновлён', section: S },
  'tgadm.retry.bulk': { ru: 'Повторить ошибки', section: S },
  'tgadm.retry.bulk_done': { ru: 'Поставлено в очередь: {n}', section: S },
  'tgadm.retry.bulk_codes': {
    ru: '; коды повторно не отправляются ({n})',
    section: S,
  },
  // «Бот платформы».
  'tgadm.bot.title': { ru: 'Бот платформы', section: S },
  'tgadm.bot.url': { ru: 'Адрес вебхука', section: S },
  'tgadm.bot.state': { ru: 'Состояние', section: S },
  'tgadm.bot.checked': { ru: 'Проверено', section: S },
  'tgadm.bot.checked_at': { ru: 'сегодня в {hm}', section: S },
  'tgadm.bot.ok': { ru: 'Работает', section: S },
  'tgadm.bot.bad': { ru: 'Ошибка', section: S },
  'tgadm.bot.problem.delivery': { ru: 'Последняя ошибка Telegram:', section: S },
  'tgadm.bot.problem.no_bot': {
    ru: 'Бот не подключён: в настройках окружения сайта не заданы переменные бота',
    section: S,
  },
  'tgadm.bot.problem.unreachable': {
    ru: 'Telegram не ответил на проверку. Повторите через минуту',
    section: S,
  },
  'tgadm.bot.problem.not_set': {
    ru: 'Вебхук не поставлен: сайт ставит его сам каждые 10 минут, если адрес сайта начинается с https://',
    section: S,
  },
  'tgadm.bot.problem.other_url': {
    ru: 'Telegram присылает обновления на другой адрес:',
    section: S,
  },
  'tgadm.bot.check': { ru: 'Проверить вебхук', section: S },
  'tgadm.bot.token': { ru: 'Заменить токен', section: S },
  'tgadm.bot.hint': {
    ru: 'Вебхук сайт ставит сам при каждой выкладке. Токен бота здесь не вводится и не показывается.',
    section: S,
  },
  'tgadm.bot.check_ok': { ru: 'Вебхук работает · проверено {hm}', section: S },
  'tgadm.bot.check_again': { ru: 'Вебхук снова работает · проверено {hm}', section: S },
  'tgadm.bot.check_bad': { ru: 'Вебхук не работает · проверено {hm}', section: S },
  'tgadm.token.title': { ru: 'Как заменить токен бота', section: S },
  'tgadm.token.sub': { ru: 'Токен хранится только в настройках проекта Vercel', section: S },
  'tgadm.token.step1': { ru: 'Получите новый токен у @BotFather в Telegram.', section: S },
  'tgadm.token.step2': {
    ru: 'Откройте проект сайта в Vercel → «Settings» → «Environment Variables» и замените значение переменной с токеном бота.',
    section: S,
  },
  'tgadm.token.step3': {
    ru: 'Пересоберите сайт: «Deployments» → «Redeploy». При выкладке сайт сам поставит вебхук с новым токеном, старый токен перестанет работать.',
    section: S,
  },
  'tgadm.token.step4': { ru: 'Вернитесь сюда и нажмите «Проверить вебхук».', section: S },
  'tgadm.token.note': {
    ru: 'Ввести или посмотреть токен в Админке нельзя: так он не попадёт в базу данных и в журналы.',
    section: S,
  },
  'tgadm.token.ok': { ru: 'Понятно', section: S },
  'tgadm.queue.title': { ru: 'Очередь отправки', section: S },
  'tgadm.queue.text': {
    ru: 'Ежедневная задача по расписанию кладёт сообщения в очередь и отправляет их небольшими пачками с паузой, чтобы уложиться в лимиты Telegram и время функции.',
    section: S,
  },
  'tgadm.queue.batch': { ru: 'Размер пачки', section: S },
  'tgadm.queue.pause': { ru: 'Пауза', section: S },
  'tgadm.queue.pause_v': { ru: '{s} секунды', section: S },
  'tgadm.queue.tries': { ru: 'Повторов при ошибке', section: S },
  'tgadm.queue.tries_v': { ru: '{n}, затем «Ошибка»', section: S },
  'tgadm.queue.digest': { ru: 'Сводка', section: S },
  'tgadm.queue.digest_v': { ru: 'по понедельникам, 09:00', section: S },
  // «Рассылка».
  'tgadm.cast.to': { ru: 'Кому', section: S },
  'tgadm.cast.all': { ru: 'Всем пользователям платформы', section: S },
  'tgadm.cast.text': { ru: 'Текст объявления', section: S },
  'tgadm.cast.placeholder': {
    ru: 'Например: 15 ноября с 22:00 до 23:00 плановые работы, платформа будет недоступна.',
    section: S,
  },
  'tgadm.cast.hint': { ru: 'Сообщение получат только те, кто привязал Telegram.', section: S },
  'tgadm.cast.go': { ru: 'Поставить в очередь', section: S },
  'tgadm.cast.done.one': { ru: 'В очереди: {n} сообщение', section: S },
  'tgadm.cast.done.few': { ru: 'В очереди: {n} сообщения', section: S },
  'tgadm.cast.done.many': { ru: 'В очереди: {n} сообщений', section: S },
  'tgadm.cast.err.text_required': { ru: 'Введите текст', section: E },
  'tgadm.cast.err.text_too_long': { ru: 'Не длиннее 4096 знаков', section: E },
  'err.broadcast_org': {
    ru: 'Организация не найдена или заблокирована: выберите другую',
    section: E,
  },
} satisfies Record<string, UiTextDefault>;
