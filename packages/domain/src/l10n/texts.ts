import { ADMIN_ACCOUNTS_TEXTS, ADMIN_L10N_TEXTS, ADMIN_TEXTS } from './admin-texts';
import { AUTH_TEXTS } from './auth-texts';
import { DICTS_TEXTS } from './dicts-texts';
import { FILES_TEXTS } from './files-texts';
import { GRID_TEXTS } from './grid-texts';
import { MONEY_TEXTS } from './money-texts';
import { ORG_TEXTS } from './org-texts';
import { SHELL_TEXTS } from './shell-texts';
import { STAFF_TEXTS } from './staff-texts';
import { STATUS_TEXTS } from './status-texts';

/**
 * Языки интерфейса (ТЗ, Админка → «Локализация»). Сейчас язык один — русский; добавление языка
 * заложено: у каждого текста словаря есть язык, непереведённые тексты показываются на русском.
 */
export const UI_LANGUAGES = ['ru'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];
export const DEFAULT_UI_LANGUAGE: UiLanguage = 'ru';

export interface UiTextDefault {
  /** Русский текст по умолчанию; `{имя}` — подстановка (`formatText`). */
  ru: string;
  /** Раздел в списке «Локализации» (как `sec` в refDB.json). */
  section: string;
}

/** Тексты служебных страниц: описание сайта, «здоровье». */
const SYSTEM_TEXTS = {
  'app.description': {
    ru: 'Учёт сдачи налоговых отчётов для бухгалтерских организаций',
    section: 'Система',
  },
  'health.title': { ru: 'Проверка работы системы', section: 'Система' },
  'health.state': { ru: 'Состояние', section: 'Система' },
  'health.checking': { ru: 'Проверяем…', section: 'Система' },
  'health.api_down': { ru: 'API не отвечает', section: 'Система' },
  'health.all_ok': { ru: 'Всё работает', section: 'Система' },
  'health.degraded': { ru: 'Есть неполадки', section: 'Система' },
  'health.check.database': { ru: 'База данных', section: 'Система' },
  'health.check.storage': { ru: 'Хранилище файлов', section: 'Система' },
  'health.check_ok': { ru: '{name}: доступна', section: 'Система' },
  'health.check_error': { ru: '{name}: недоступна', section: 'Система' },
  'health.version': { ru: 'Версия', section: 'Система' },
  'health.environment': { ru: 'Среда', section: 'Система' },
  'health.today': { ru: 'Сегодня (Бишкек)', section: 'Система' },
} as const satisfies Record<string, UiTextDefault>;

/**
 * Начальное наполнение словаря текстами экранов продукта — вместе с разделом `localization`
 * refDB.json (там — тексты, которые завёл прототип). Экраны берут текст не отсюда, а из словаря
 * (`useT` в apps/web): текст, поправленный в словаре, заменяет этот без изменения кода. Ключ,
 * который есть и в refDB.json, пишется с тем же текстом (это проверяет тест наполнения). Тексты
 * разложены по файлам экранов: служебные — здесь, оболочки — `shell-texts.ts`, входа и «Мой профиль» —
 * `auth-texts.ts`, списков — `grid-texts.ts`, сотрудников — `staff-texts.ts`, шкалы и истории статусов —
 * `status-texts.ts`, «Моей организации» — `org-texts.ts`, Админки — `admin-texts.ts`, «Справочников» и сроков
 * видов отчётов словами — `dicts-texts.ts`, реквизитов для переводов — `money-texts.ts`, блока «Файлы» —
 * `files-texts.ts`.
 */
export const UI_TEXTS = {
  ...SYSTEM_TEXTS,
  ...SHELL_TEXTS,
  ...AUTH_TEXTS,
  ...GRID_TEXTS,
  ...STAFF_TEXTS,
  ...STATUS_TEXTS,
  ...ORG_TEXTS,
  ...ADMIN_ACCOUNTS_TEXTS,
  ...ADMIN_L10N_TEXTS,
  ...ADMIN_TEXTS,
  ...DICTS_TEXTS,
  ...MONEY_TEXTS,
  ...FILES_TEXTS,
} as const satisfies Record<string, UiTextDefault>;

/** Ключ текста интерфейса: только из `UI_TEXTS`, поэтому опечатка в ключе — ошибка типов. */
export type UiTextKey = keyof typeof UI_TEXTS;

/** Подстановки в текст: `{from}`, `{total}` и т. п. */
export type UiTextParams = Readonly<Record<string, string | number>>;

/** Текст по ключу из словаря с подстановками `{имя}` (`useT` на экране, тексты словаря на сервере). */
export type Translate = (key: UiTextKey, params?: UiTextParams) => string;

/** Текст с подстановками: `{имя}` заменяется значением; подстановки без значения остаются как есть. */
export function formatText(template: string, params?: UiTextParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );
}

/** Тексты по умолчанию одного языка: ключ → текст. */
export function defaultUiTexts(): Record<string, string> {
  return Object.fromEntries(Object.entries(UI_TEXTS).map(([key, value]) => [key, value.ru]));
}
