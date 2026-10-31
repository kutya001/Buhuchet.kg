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
  'telegram.kind.broadcast': { ru: 'Объявление', section: S },
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
  'err.notify_boss_only': {
    ru: 'Режим и уведомления по отчётам других сотрудников — только владельцу и главному бухгалтеру',
    section: 'Ошибки',
  },
} as const satisfies Record<string, UiTextDefault>;
