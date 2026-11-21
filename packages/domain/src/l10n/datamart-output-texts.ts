import type { UiTextDefault } from './texts';

const E = 'Ошибки';

/**
 * Отказы «Вывода» «Витрины данных» (доработки 20.11.2026: Витрина данных, блок 4, пункты 3–4; блок 6,
 * пункт 5; общий план 20.11, этап 2, П3–П4; прототип v155 `modules/vitrina.js` `dmDraw`, `dmParRead`).
 * Подписи экрана «Вывод» и каталога — у потока И.
 */
export const DATAMART_OUTPUT_TEXTS = {
  'err.dm_template_not_found': { ru: 'Шаблон не найден или недоступен', section: E },
  'err.dm_template_broken': {
    ru: 'Шаблон временно не работает. Администратор уже знает',
    section: E,
  },
  'err.dm_bad_param': { ru: 'Неверный параметр: {param}', section: E },
  'err.dm_org_required': { ru: 'Выберите организацию', section: E },
  'err.dm_timeout': {
    ru: 'Запрос выполнялся слишком долго. Уточните параметры',
    section: E,
  },
  'err.dm_busy': { ru: 'Предыдущий запрос ещё выполняется', section: E },
  'err.dm_rate': { ru: 'Слишком много запросов. Попробуйте через минуту', section: E },
  // Запись в историю организации, когда администратор платформы открыл шаблон «глазами организации».
  'dm.out.history_porg': {
    ru: 'Открыт шаблон витрины данных «{name}» глазами организации',
    section: 'Витрина данных',
  },
} as const satisfies Record<string, UiTextDefault>;
