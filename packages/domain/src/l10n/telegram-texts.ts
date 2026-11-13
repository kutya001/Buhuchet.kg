import type { UiTextDefault } from './texts';

const S = 'Telegram';
const P = 'Профиль';

/**
 * Тексты уведомлений в Telegram (задача 2.25; ТЗ «Уведомления в Telegram»): части сообщения за день и
 * сводки на неделю (основные строки — шаблоны «Справочников платформы»), ссылка в сообщении, подписи
 * видов сообщений журнала отправок и блок «Уведомления в Telegram» в «Мой профиль» (прототип
 * modules/profile.js — `NMODES`, `NKINDS`, `notifyBox`, `bindNotify`).
 */
export const TELEGRAM_TEXTS = {
  'telegram.open': { ru: 'Открыть в Buhuchet.kg: {link}', section: S },
  'telegram.more': { ru: 'и ещё {n}', section: S },
  'telegram.unlinked': { ru: '{report} ({name}: не привязан Telegram)', section: S },
  'telegram.unassigned': { ru: '{report} (ответственный не назначен)', section: S },
  'telegram.item.report': { ru: '{type} за {period} — {contractor}', section: S },
  // Сообщение об одном отчёте с кнопками (прототип v97 `tgRepMsg`, `tgConfMsg`, `tgDueTxt`).
  'telegram.item.report_name': { ru: '{type} за {period}', section: S },
  'telegram.item.report_full': { ru: '{name}, {contractor}', section: S },
  'telegram.item.due': { ru: 'срок {date}', section: S },
  'telegram.item.due_over': { ru: 'просрочен на {n} дн.', section: S },
  'telegram.item.due_today': { ru: 'сегодня последний день', section: S },
  'telegram.item.due_in': { ru: 'через {n} дн.', section: S },
  'telegram.item.submitted': { ru: 'сдан {date}', section: S },
  'telegram.done.work': { ru: '✓ В работе', section: S },
  'telegram.done.submitted': { ru: '✓ Сдан', section: S },
  'telegram.done.task': { ru: '✓ Выполнена', section: S },
  'telegram.done.confirmed': { ru: '✓ Подтверждено', section: S },
  'telegram.done.returned': { ru: '↩ Возвращён', section: S },
  'telegram.done.cancelled': { ru: 'Отменено', section: S },
  // Отметка у записи истории, сделанной кнопкой или ответом в чате бота (прототип `histVia`).
  'telegram.via': { ru: 'через Telegram', section: S },
  'telegram.photo_name': { ru: 'Фото из Telegram {date}.jpg', section: S },
  'telegram.file_name': { ru: 'Файл из Telegram {date}', section: S },
  'telegram.week.contractor': { ru: '• {contractor}: {what}', section: S },
  'telegram.week.sub': { ru: 'сдать {list}', section: S },
  'telegram.week.pay': { ru: 'оплатить {list}', section: S },
  'telegram.week.over': { ru: 'просрочено {list}', section: S },
  'telegram.kind.reminders': { ru: 'Напоминания за день', section: S },
  'telegram.kind.task_new': { ru: 'Новая задача', section: S },
  'telegram.kind.task_on_confirm': { ru: 'Задача ждёт подтверждения', section: S },
  'telegram.kind.task_confirmed': { ru: 'Задача подтверждена', section: S },
  'telegram.kind.task_rework': { ru: 'Задача на доработку', section: S },
  'telegram.kind.task_cancelled': { ru: 'Задача отменена', section: S },
  'telegram.kind.report_fix': { ru: 'Возврат на исправление', section: S },
  'telegram.kind.code': { ru: 'Код восстановления', section: S },
  'telegram.kind.linked': { ru: 'Telegram привязан', section: S },
  'telegram.kind.relinked': { ru: 'Привязан другой Telegram', section: S },
  'telegram.kind.unlinked': { ru: 'Telegram отвязан', section: S },
  'telegram.kind.pass_changed': { ru: 'Пароль изменён', section: S },
  'telegram.kind.pass_reset': { ru: 'Пароль сброшен', section: S },
  'telegram.kind.login_locked': { ru: 'Вход заблокирован', section: S },
  'telegram.kind.broadcast': { ru: 'Объявление', section: S },
  'telegram.kind.lead': { ru: 'Заявка с сайта', section: S },
  'telegram.kind.alert': { ru: 'Сбой в работе сайта', section: S },
  'telegram.kind.relink_code': { ru: 'Код замены Telegram', section: S },
  'telegram.kind.page_closed': { ru: 'Страница контрагента закрыта', section: S },
  'telegram.kind.bot_test': { ru: 'Проверка бота', section: S },
  'telegram.kind.task_started': { ru: 'Задача взята в работу', section: S },
  'telegram.kind.task_done': { ru: 'Задача выполнена', section: S },
  'telegram.kind.bot_ask': { ru: 'Просьба бота прислать ответ', section: S },
  'profile.notify': { ru: 'Уведомления в Telegram', section: P },
  'profile.notify.modes': { ru: 'Какие уведомления получать', section: P },
  'profile.notify.mode.all': { ru: 'Все', section: P },
  'profile.notify.mode.all_hint': {
    ru: 'Сроки и просрочки отчётов всех сотрудников, задачи, сводка за неделю',
    section: P,
  },
  'profile.notify.mode.digest': { ru: 'Только просрочки и сводка', section: P },
  'profile.notify.mode.digest_hint': {
    ru: 'Без ежедневных напоминаний о сроках: только просрочки, ручные задачи и сводка по понедельникам',
    section: P,
  },
  'profile.notify.mode.manual': { ru: 'Только ручные задачи', section: P },
  'profile.notify.mode.manual_hint': {
    ru: 'Новые задачи, поставленные вручную, их комментарии и выполнение. Регулярные задачи по отчётам не приходят',
    section: P,
  },
  'profile.notify.staff_note': {
    ru: 'Вы получаете напоминания по своим отчётам и задачам. Владелец и главный бухгалтер получают ещё и по всей организации, если не выбрали другой режим.',
    section: P,
  },
  'profile.notify.mine': {
    ru: 'По моим отчётам: за N дней, в день срока и при просрочке — приходят всегда, отключить нельзя',
    section: P,
  },
  'profile.notify.mine_aria': { ru: 'Напоминания по моим отчётам', section: P },
  'profile.notify.kind.before': {
    ru: 'Напоминания за N дней до срока по отчётам других сотрудников',
    section: P,
  },
  'profile.notify.kind.over': { ru: 'Просрочки по отчётам других сотрудников', section: P },
  'profile.notify.kind.tasks': { ru: 'Ручные задачи: новые, комментарии, выполнение', section: P },
  'profile.notify.kind.regtasks': { ru: 'Регулярные задачи по отчётам', section: P },
  'profile.notify.kind.week': { ru: 'Сводка за неделю по понедельникам', section: P },
  'profile.notify.boss_hint': {
    ru: 'Режим и переключатели меняют только уведомления по отчётам других сотрудников и по задачам. Отключённый переключатель — это то, что не входит в выбранный режим.',
    section: P,
  },
  'profile.notify.staff_hint': {
    ru: 'Напоминания по вашим отчётам нельзя отключить: их получаете вы, главный бухгалтер и владелец.',
    section: P,
  },
  'profile.notify.mode_saved': { ru: 'Режим уведомлений сохранён', section: P },
  'profile.notify.on': { ru: 'Включено', section: P },
  'profile.notify.off': { ru: 'Отключено', section: P },
  'profile.notify.history_mode': { ru: 'Уведомления: {mode}', section: P },
  'profile.notify.history_kind': { ru: 'Уведомления: «{kind}» {state}', section: P },
  'profile.notify.history_on': { ru: 'включено', section: P },
  'profile.notify.history_off': { ru: 'отключено', section: P },
  'profile.tg_test': { ru: 'Проверить бота', section: P },
  'profile.tg_test_sent': { ru: 'Бот прислал проверочное сообщение в {name}', section: P },
  'profile.tg_plain': { ru: 'Сообщения простым текстом', section: P },
  'profile.tg_plain_hint': {
    ru: 'Бот присылает таблицы и раскрывающиеся разделы. Включите, если в вашем Telegram они показываются неверно (старая версия приложения). Кнопки под сообщениями останутся.',
    section: P,
  },
  'profile.tg_plain_on': { ru: 'Бот будет присылать простой текст', section: P },
  'profile.tg_plain_off': { ru: 'Бот будет присылать таблицы', section: P },
  'err.bot_test_limit': {
    ru: 'Слишком много проверок бота. Попробуйте через час',
    section: 'Ошибки',
  },
  'err.bot_test_failed': {
    ru: 'Telegram не принял сообщение. Попробуйте позже',
    section: 'Ошибки',
  },
  'err.telegram_not_linked': { ru: 'Сначала привяжите Telegram', section: 'Ошибки' },
  'err.notify_boss_only': {
    ru: 'Режим и уведомления по отчётам других сотрудников — только владельцу и главному бухгалтеру',
    section: 'Ошибки',
  },
} as const satisfies Record<string, UiTextDefault>;
