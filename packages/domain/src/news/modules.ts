import { KB_MODULE_TITLES } from '../kb/admin';
import type { UiTextKey } from '../l10n/texts';
import { MENU_MODULES, menuModules, type BusinessModuleId } from '../org/modules';
import { hasPermission, type AccessSubject } from '../roles/access';
import type { Feature } from '../roles/permissions';

/*
 * «Модули» новости и второй текст «Для администратора платформы» (доработки 16.11.2026, блок 4,
 * пункты 1–3; прототип v123 modules/kb-news.js NEWS_MODS, newsModOk, newsModsOk; admin/news.js
 * NEWS_TECH). Новость с модулями видит тот, у кого есть хотя бы один из них; без модулей — все.
 */

/**
 * Что можно отметить в «Модулях»: модули организации по порядку меню и «Плата за обслуживание» — это
 * не модуль, а функция со своим правом «Видеть плату за обслуживание» (прототип v123: так работает
 * сценарий приёмки «бухгалтер без права не видит новость про обслуживание»).
 */
export type NewsModule = BusinessModuleId | 'fee';

export const NEWS_MODULES: readonly NewsModule[] = [...MENU_MODULES.map((m) => m.id), 'fee'];

/** Не больше модулей у одной новости (то же ограничение `news_modules_check` в базе). */
export const NEWS_MODULES_MAX = 30;

export function isNewsModule(value: string): value is NewsModule {
  return (NEWS_MODULES as readonly string[]).includes(value);
}

/** Название модуля новости — ключ словаря (у модулей — их название в меню). */
export function newsModuleTitle(module: NewsModule): UiTextKey {
  return module === 'fee' ? 'news.mod.fee' : KB_MODULE_TITLES[module];
}

/**
 * Модули новостей, которые есть у сотрудника (прототип newsModOk): модули его меню — функция учётной
 * политики и право — и «Плата за обслуживание» при функции и праве «Видеть плату за обслуживание».
 */
export function newsModulesOf(
  subject: AccessSubject,
  features: Readonly<Partial<Record<Feature, boolean>>>,
): NewsModule[] {
  const fee = features.fee === true && hasPermission(subject, 'fee');
  return [...menuModules(subject, features), ...(fee ? (['fee'] as const) : [])];
}

/**
 * Видна ли новость по модулям (прототип newsModsOk): без модулей — всем, иначе — если есть хотя бы
 * один. `mine` null — администратор платформы: ему видны все.
 */
export function newsModulesSeen(
  modules: readonly string[],
  mine: readonly string[] | null,
): boolean {
  return mine === null || modules.length === 0 || modules.some((m) => mine.includes(m));
}

export type NewsModulesProblem =
  'news_modules_unknown' | 'news_modules_duplicate' | 'news_modules_too_many';

/**
 * Что не так со списком модулей: больше `NEWS_MODULES_MAX` (предел базы; проверяется первым — длинный
 * список дальше не разбирается), незнакомый код или повтор.
 */
export function newsModulesProblem(codes: readonly string[]): NewsModulesProblem | null {
  if (codes.length > NEWS_MODULES_MAX) return 'news_modules_too_many';
  if (codes.some((c) => !isNewsModule(c))) return 'news_modules_unknown';
  if (new Set(codes).size !== codes.length) return 'news_modules_duplicate';
  return null;
}

/** Модули по порядку `NEWS_MODULES` без повторов — так их сохраняет окно новости. */
export function newsModulesOrdered(codes: readonly string[]): NewsModule[] {
  return NEWS_MODULES.filter((m) => codes.includes(m));
}

/**
 * Слова, которых не должно быть в тексте для пользователей (прототип v123 NEWS_TECH): редактор
 * предупреждает, сохранить это не мешает. Всё техническое — во второй текст.
 */
export const NEWS_TECH_WORDS: readonly (readonly [word: string, test: RegExp])[] = [
  ['прототип', /прототип/i],
  ['миграция', /миграци/i],
  ['стенд', /(^|[^а-яё])стенд/i],
  ['поток', /(^|[^а-яё])поток/i],
  ['PR', /(^|[^A-Za-z])PR([^A-Za-z]|$)/],
  ['справочник платформы', /справочник(ах|ами|ов|и|е|а|у)? платформы/i],
];

/** Какие слова из `NEWS_TECH_WORDS` есть в тексте — по порядку списка. */
export function newsTechWords(text: string): string[] {
  return NEWS_TECH_WORDS.filter(([, test]) => test.test(text)).map(([word]) => word);
}
