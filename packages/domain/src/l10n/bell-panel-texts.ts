import type { UiTextDefault } from './texts';

const S = 'Колокольчик';

/**
 * Значок колокольчика и панель «Уведомления» (доработки 16.11.2026, блок 3; поток И; прототип v123
 * `ui/bell-panel.js`). Фразы строк — `bell-texts.ts` потока Т.
 */
export const BELL_PANEL_TEXTS = {
  'bell.title': { ru: 'Уведомления', section: S },
  'bell.unseen': { ru: 'Уведомления: непросмотренных {n}', section: S },
  'bell.news_dot': { ru: 'Уведомления: есть новости', section: S },
  'bell.read_all': { ru: 'Прочитать все', section: S },
  'bell.read_all_done': { ru: 'Все уведомления прочитаны', section: S },
  'bell.tabs': { ru: 'Что показать', section: S },
  'bell.tab.all': { ru: 'Все', section: S },
  'bell.tab.reports': { ru: 'Отчёты', section: S },
  'bell.tab.tasks': { ru: 'Задачи', section: S },
  'bell.tab.files': { ru: 'Файлы', section: S },
  'bell.tab.money': { ru: 'Деньги', section: S },
  'bell.tab.news': { ru: 'Новости', section: S },
  'bell.empty': { ru: 'Новых уведомлений нет', section: S },
  'bell.show_all': { ru: 'Показать все', section: S },
  'bell.more': { ru: 'Показать ещё', section: S },
  'bell.unread': { ru: 'Не открыто', section: S },
  'bell.load_error': { ru: 'Не удалось загрузить уведомления', section: S },
  'bell.gone': { ru: 'Запись удалена или больше вам не доступна', section: S },
  'bell.group.today': { ru: 'Сегодня', section: S },
  'bell.group.yesterday': { ru: 'Вчера', section: S },
  'bell.group.earlier': { ru: 'Раньше', section: S },
  'bell.at.now': { ru: 'только что', section: S },
  'bell.at.min': { ru: '{n} мин назад', section: S },
  'bell.at.yesterday': { ru: 'вчера {hm}', section: S },
} as const satisfies Record<string, UiTextDefault>;
