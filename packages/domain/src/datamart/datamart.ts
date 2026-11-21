/**
 * «Витрина данных» (доработки 20.11.2026: Витрина данных, блоки 1–8): шаблоны SQL администратора
 * платформы, доступ шаблона, токены и журнал запросов. Таблицы — миграция 0165 (этап 0), исполнитель
 * запросов и роли базы только для чтения — отдельным PR, экраны и внешний адрес — этапы 1–3.
 */

/** Для кого шаблон: для организаций или только для Админки (блок 2). */
export const DM_AUDIENCES = ['org', 'admin'] as const;
/** Каким организациям виден шаблон: всем или выбранным (блок 2). */
export const DM_ACCESS = ['all', 'selected'] as const;
/** Состояние шаблона: черновик, опубликован, выключен, сломан (проверка после выпуска и ночью). */
export const DM_TEMPLATE_STATES = ['draft', 'published', 'off', 'broken'] as const;
/** Модуль шаблона: сотрудник видит шаблон, если у него есть право просмотра этого модуля (блок 2, пункт 6). */
export const DM_MODULES = ['cps', 'reports', 'fin', 'projects', 'kpi', 'staff'] as const;
/**
 * Типы столбцов шаблона (блок 2, пункт 5; прототип `DM_CT`): `cp` — скрытый столбец «Контрагент» для
 * области «Свои» (в «Выводе» и во внешнем ответе его нет).
 */
export const DM_COLUMN_TYPES = [
  'text',
  'num',
  'money',
  'date',
  'datetime',
  'month',
  'bool',
  'cp',
] as const;
/** Откуда запрос журнала: вкладка «Вывод» или внешний адрес по токену. */
export const DM_REQUEST_VIA = ['screen', 'api'] as const;
export const DM_REQUEST_OUTCOMES = [
  'ok',
  'denied',
  'bad_param',
  'rate',
  'timeout',
  'broken',
  'closed',
  'error',
] as const;

/** Токен действует не дольше 180 дней (блок 5). */
export const DM_TOKEN_MAX_DAYS = 180;
/** Журнал запросов хранится 90 дней (блок 6). */
export const DM_REQUEST_KEEP_DAYS = 90;

/** Код шаблона для адреса: латиница, цифры и «-», например reports-due (блок 2, пункт 2). */
export const DM_CODE_RE = '^[a-z0-9][a-z0-9-]{1,59}$';
/** Текст запроса шаблона — до 20 000 знаков. */
export const DM_QUERY_MAX = 20_000;
/** Начало токена, которое видно в списке после закрытия окна: «bk_a1b2…» (блок 5, пункт 6). */
export const DM_TOKEN_PREFIX_RE = '^bk_[A-Za-z0-9]{4,8}$';
