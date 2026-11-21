import {
  DM_AUDIENCES,
  DM_CODE_RE,
  DM_COLUMN_TYPES,
  DM_MODULES,
  DM_PARAM_TYPES,
  DM_TEXT_PARAM_MAX,
} from '@buhuchet/domain';
import { z } from 'zod';
import { Uuid } from './common';

/*
 * «Витрина данных» → «Вывод» и каталог «Шаблоны» (доработки 20.11.2026: Витрина данных, блоки 3–4;
 * общий план 20.11, этап 2, П3–П4; прототип v155 `modules/vitrina.js`: `dmOutList`, `renderDmOut`,
 * `dmDraw`, `renderDmTpl`). Организация — `GET /api/dm/output` и `POST /api/dm/output/run` (право
 * «Смотреть витрину данных»), Админка — `GET /api/admin/dm/output` и `POST /api/admin/dm/output/run`.
 * Текста запроса в ответах нет. Скрытый столбец «Контрагент» (вид `cp`) в ответах тоже не отдаётся:
 * по нему сервер оставляет сотруднику с областью «Свои» только строки его контрагентов.
 */

/** Параметр шаблона для формы над таблицей (прототип `dmParHtml`). */
export const DmParam = z.object({
  /** Код в запросе `:month` и в адресе `?month=`. */
  code: z.string(),
  name: z.string(),
  type: z.enum(DM_PARAM_TYPES),
  required: z.boolean(),
  /** Значение по умолчанию словом шаблона (`month`, `today`…) или само значение; пусто — нет. */
  default: z.string().nullable(),
  /** Оно же на сегодня по Бишкеку (прототип `dmDef`): «2026-11», «2026-11-21»; пусто — нет. */
  value: z.string().nullable(),
});
export type DmParam = z.infer<typeof DmParam>;

/** Столбец таблицы (блок 2, пункт 5): деньги в ответе «Вывода» — тыйыны, на экране «1 250,50». */
export const DmColumn = z.object({
  code: z.string(),
  name: z.string(),
  /** Без `cp`: столбец «Контрагент» не показывается. */
  type: z.enum(DM_COLUMN_TYPES),
  /** Строка итогов по столбцу. */
  total: z.boolean(),
});
export type DmColumn = z.infer<typeof DmColumn>;

/** Шаблон в выборе «Вывода» и карточке каталога (прототип `dmOptHtml`, `renderDmTpl`). */
export const DmTemplateCard = z.object({
  id: Uuid,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** «Для организаций» или «Для администратора» (группа выбора в Админке). */
  audience: z.enum(DM_AUDIENCES),
  /** Модуль шаблона «Для организаций» (группа каталога); у шаблона Админки — пусто. */
  module: z.enum(DM_MODULES).nullable(),
  /** Ещё одно обязательное право (у «Видеть плату за обслуживание» — подпись в карточке). */
  needPermission: z.string().nullable(),
  /** «Сломан» — «Шаблон временно не работает. Администратор уже знает». */
  state: z.enum(['published', 'broken']),
  params: z.array(DmParam),
  columns: z.array(DmColumn),
});
export type DmTemplateCard = z.infer<typeof DmTemplateCard>;

/** Каталог «Вывода» и «Шаблонов»: шаблоны по названию и что можно делать. */
export const DmCatalog = z.object({
  items: z.array(DmTemplateCard),
  /** «В Excel» — общее право «Выгружать в Excel» (у Админки — всегда). */
  canExport: z.boolean(),
  /** «Выпустить токен» в каталоге: право «Управлять API-токенами» и не демо-организация. */
  canTokens: z.boolean(),
});
export type DmCatalog = z.infer<typeof DmCatalog>;

/**
 * «Показать»: код шаблона и значения параметров как в форме (`"2026-11"`, пусто — `null`); параметр,
 * которого нет в запросе, берёт значение по умолчанию; лишние отбрасываются.
 */
export const DmRunInput = z.object({
  code: z.string().regex(new RegExp(DM_CODE_RE)),
  params: z.record(z.string().max(60), z.string().max(DM_TEXT_PARAM_MAX).nullable()).default({}),
});
export type DmRunInput = z.infer<typeof DmRunInput>;

/** «Показать» в Админке: у шаблона «Для организаций» — «Глазами организации» (обязательно). */
export const DmAdminRunInput = DmRunInput.extend({ orgId: Uuid.optional() });
export type DmAdminRunInput = z.infer<typeof DmAdminRunInput>;

/**
 * Результат (прототип `dmDraw`): столбцы шаблона без «Контрагента» и строки — значения по порядку
 * столбцов, как их отдала база (деньги — тыйыны, даты — «2026-11-21», месяц — «2026-11»).
 */
export const DmRunResult = z.object({
  columns: z.array(DmColumn),
  rows: z.array(z.array(z.unknown())),
  /** Строк больше `max`: показаны первые (блок 4, пункт 3). */
  more: z.boolean(),
  max: z.number().int().positive(),
  /** «Выполнено за N мс». */
  ms: z.number().int().nonnegative(),
  /** У Админки «глазами организации» — её название; иначе пусто. */
  orgName: z.string().nullable(),
});
export type DmRunResult = z.infer<typeof DmRunResult>;

/**
 * Отказы «Показать» (ключи словаря `err.<код>`): 400 `dm_bad_param` (`details`: `{ param, why }`, `why` —
 * `type`, `required` или `range`; прототип `dmParRead`), 400 `dm_org_required`, 404
 * `dm_template_not_found`, 409 `dm_template_broken` (у Админки в `details.error` — текст базы), 429
 * `dm_busy` (предыдущий запрос ещё идёт) и `dm_rate`, 503 `dm_timeout` («Запрос выполнялся слишком
 * долго. Уточните параметры»).
 */
export const DM_RUN_ERRORS = [
  'dm_bad_param',
  'dm_org_required',
  'dm_template_not_found',
  'dm_template_broken',
  'dm_busy',
  'dm_rate',
  'dm_timeout',
] as const;

/** `details` отказа `dm_bad_param`. */
export const DmBadParam = z.object({
  param: z.string(),
  why: z.enum(['type', 'required', 'range']),
});
export type DmBadParam = z.infer<typeof DmBadParam>;
