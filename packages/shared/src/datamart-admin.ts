import {
  DM_ACCESS,
  DM_AUDIENCES,
  DM_CODE_RE,
  DM_COLUMN_TYPES,
  DM_COLUMNS_MAX,
  DM_DESCRIPTION_MAX,
  DM_EXTRA_PERMISSIONS,
  DM_FIELD_RE,
  DM_LABEL_MAX,
  DM_MODULES,
  DM_NAME_MAX,
  DM_ORGS_MAX,
  DM_PARAM_DEFAULTS,
  DM_PARAM_TYPES,
  DM_PARAMS_MAX,
  DM_QUERY_MAX,
  DM_REASON_MAX,
  DM_TEMPLATE_STATES,
} from '@buhuchet/domain';
import { z } from 'zod';
import { Uuid } from './common';
import { listPageSchema } from './list';

/*
 * Админка → «Витрина данных» → «Шаблоны» (доработки 20.11.2026: Витрина данных, блок 2, пункты 2–7;
 * блок 3, пункт 1; общий план 20.11, этап 2, П3; прототип v155 `modules/vitrina.js`: `renderDmTplAdm`,
 * `dmEdit`, `dmCopy`, `dmStateDlg`). Все методы — `/api/admin/dm/templates…`, только администратор
 * платформы. Названия шаблона, параметров и столбцов — русские, вводит администратор (в словарь не
 * входят); подписи состояний, видов и модулей — словарь (`dm.tpl.state.<код>`, `dm.tpl.kind.<код>`,
 * `dm.mod.<код>`).
 */

/** Номер шаблона в пути. */
export const DmTemplateIdParam = z.object({ id: Uuid });

/** Строка списка (прототип grid `dm-tpl`). */
export const DmAdminTemplateRow = z.object({
  id: Uuid,
  name: z.string(),
  code: z.string(),
  /** Готовый шаблон платформы — метка «готовый». */
  builtin: z.boolean(),
  audience: z.enum(DM_AUDIENCES),
  state: z.enum(DM_TEMPLATE_STATES),
  /** «Организаций пользуется»: действующие токены и запросы за 30 дней; у шаблона Админки — пусто. */
  orgs: z.number().int().nonnegative().nullable(),
  /** «Токенов»: действующих. */
  toks: z.number().int().nonnegative(),
  checkedAt: z.iso.datetime().nullable(),
  module: z.enum(DM_MODULES).nullable(),
  /** Меню строки «⋯»: «Отключить» (не черновик и не отключён), «Включить» (отключён). */
  canOff: z.boolean(),
  canOn: z.boolean(),
});
export type DmAdminTemplateRow = z.infer<typeof DmAdminTemplateRow>;

export const DmAdminTemplateList = listPageSchema(DmAdminTemplateRow);
export type DmAdminTemplateList = z.infer<typeof DmAdminTemplateList>;

/** Параметр шаблона в окне (прототип таблица «Параметры»). */
export const DmTemplateParamInput = z.object({
  code: z.string().regex(new RegExp(DM_FIELD_RE)),
  name: z.string().trim().min(1).max(DM_LABEL_MAX),
  type: z.enum(DM_PARAM_TYPES),
  required: z.boolean(),
  /** Значение по умолчанию словом (`month`, `today`…); пусто — нет. */
  default: z.enum(DM_PARAM_DEFAULTS).nullable(),
});
export type DmTemplateParamInput = z.infer<typeof DmTemplateParamInput>;

/** Столбец шаблона в окне (прототип таблица «Столбцы»); `cp` — «Контрагент (для области)». */
export const DmTemplateColumnInput = z.object({
  code: z.string().regex(new RegExp(DM_FIELD_RE)),
  name: z.string().trim().min(1).max(DM_LABEL_MAX),
  type: z.enum(DM_COLUMN_TYPES),
  total: z.boolean(),
});
export type DmTemplateColumnInput = z.infer<typeof DmTemplateColumnInput>;

/** Что вводит администратор в окне шаблона (прототип `dmEdit` → `st`). */
const DmTemplateFields = z.object({
  name: z.string().trim().min(1).max(DM_NAME_MAX),
  code: z.string().trim().regex(new RegExp(DM_CODE_RE)),
  description: z.string().max(DM_DESCRIPTION_MAX).nullable(),
  audience: z.enum(DM_AUDIENCES),
  /** Модуль шаблона «Для организаций»; у шаблона Админки не учитывается. */
  module: z.enum(DM_MODULES).nullable(),
  /** «Ещё одно право»: «Видеть плату за обслуживание» или пусто. */
  needPermission: z.enum(DM_EXTRA_PERMISSIONS).nullable(),
  access: z.enum(DM_ACCESS),
  /** Организации доступа «Выбранные». */
  orgIds: z.array(Uuid).max(DM_ORGS_MAX).default([]),
  query: z.string().min(1).max(DM_QUERY_MAX),
  params: z.array(DmTemplateParamInput).max(DM_PARAMS_MAX),
  columns: z.array(DmTemplateColumnInput).max(DM_COLUMNS_MAX),
  /**
   * «Опубликовать»: сервер сам проверяет запрос на `checkOrgId` (у шаблона Админки — на своих данных) и
   * публикует только при успехе. Правка запроса опубликованного шаблона проверяется так же.
   */
  publish: z.boolean().default(false),
  /** Организация проверки (у шаблона «Для организаций»); пусто — демо-организация. */
  checkOrgId: Uuid.nullable().default(null),
});

/** «+ Шаблон» → «Сохранить черновик» или «Опубликовать». */
export const DmTemplateCreate = DmTemplateFields;
export type DmTemplateCreate = z.infer<typeof DmTemplateCreate>;

/** «Сохранить» открытого шаблона: с версией записи. */
export const DmTemplateSave = DmTemplateFields.extend({ version: z.number().int().positive() });
export type DmTemplateSave = z.infer<typeof DmTemplateSave>;

/** «Проверить»: запрос и параметры окна как есть, ещё не сохранённые. */
export const DmTemplateCheckInput = z.object({
  /** Открытый шаблон: у опубликованного прежние столбцы не должны пропасть. */
  templateId: Uuid.nullable().default(null),
  audience: z.enum(DM_AUDIENCES),
  query: z.string().min(1).max(DM_QUERY_MAX),
  params: z.array(DmTemplateParamInput).max(DM_PARAMS_MAX).default([]),
  columns: z.array(DmTemplateColumnInput).max(DM_COLUMNS_MAX).default([]),
  checkOrgId: Uuid.nullable().default(null),
});
export type DmTemplateCheckInput = z.infer<typeof DmTemplateCheckInput>;

/** Почему проверка не прошла (ключ словаря: `sql` — `err.dm_sql_<sql>`, остальные — `err.dm_check_<код>`). */
export const DM_CHECK_PROBLEMS = [
  'sql',
  'no_columns',
  'bad_name',
  'dup_name',
  'removed',
  'timeout',
  'failed',
] as const;

/**
 * Итог «Проверить» (блок 3, пункт 1): первые 100 строк, сколько всего, время; параметры и столбцы
 * окна после проверки (прототип `syncPars` и столбцы ответа). Не прошла — почему и текст базы.
 */
export const DmTemplateCheckResult = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    /** На какой организации; у шаблона Админки — пусто. */
    orgName: z.string().nullable(),
    n: z.number().int().nonnegative(),
    /** Строк больше, чем отдаёт «Вывод» (50 000): показано число первых. */
    more: z.boolean(),
    ms: z.number().int().nonnegative(),
    params: z.array(DmTemplateParamInput),
    columns: z.array(DmTemplateColumnInput),
    /** Первые 100 строк: значения по порядку `columns` (деньги — тыйыны, как отдала база). */
    rows: z.array(z.array(z.unknown())),
  }),
  z.object({
    ok: z.literal(false),
    problem: z.enum(DM_CHECK_PROBLEMS),
    /** Готовый текст отказа: у `failed` — с текстом базы. */
    message: z.string(),
    /** Параметры после разбора запроса (если разобрался). */
    params: z.array(DmTemplateParamInput),
  }),
]);
export type DmTemplateCheckResult = z.infer<typeof DmTemplateCheckResult>;

/** Строка истории шаблона (прототип `t.hist`): сначала новые. */
export const DmTemplateHistoryItem = z.object({
  at: z.iso.datetime(),
  /** «Администратор платформы» или «Система» (проверка после выпуска и ночью). */
  who: z.string(),
  what: z.string(),
});

/** Окно шаблона (прототип `dmEdit`): всё, включая текст запроса и историю. */
export const DmAdminTemplateCard = z.object({
  id: Uuid,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  audience: z.enum(DM_AUDIENCES),
  module: z.enum(DM_MODULES).nullable(),
  needPermission: z.enum(DM_EXTRA_PERMISSIONS).nullable(),
  access: z.enum(DM_ACCESS),
  orgIds: z.array(Uuid),
  state: z.enum(DM_TEMPLATE_STATES),
  /** Готовый: только смотреть и проверять, изменить — копией. */
  builtin: z.boolean(),
  /** Опубликованный (и отключённый, и сломанный): код и вид не меняются, столбцы только добавляются. */
  locked: z.boolean(),
  query: z.string(),
  params: z.array(DmTemplateParamInput),
  columns: z.array(DmTemplateColumnInput),
  version: z.number().int().positive(),
  checkedAt: z.iso.datetime().nullable(),
  checkedOrgName: z.string().nullable(),
  /** Текст базы последней неудачной проверки (у «Сломан»). */
  checkError: z.string().nullable(),
  copiedFromName: z.string().nullable(),
  /** Действующих токенов и в скольких организациях (предупреждение перед сохранением и «Отключить»). */
  toks: z.number().int().nonnegative(),
  tokOrgs: z.number().int().nonnegative(),
  orgs: z.number().int().nonnegative().nullable(),
  canOff: z.boolean(),
  canOn: z.boolean(),
  history: z.array(DmTemplateHistoryItem),
});
export type DmAdminTemplateCard = z.infer<typeof DmAdminTemplateCard>;

/** Организация для доступа «Выбранные» и «Проверить на организации»: демо — первой. */
export const DmTemplateOrgOption = z.object({
  id: Uuid,
  name: z.string(),
  demo: z.boolean(),
  blocked: z.boolean(),
});

/** Данные окна шаблона: организации. */
export const DmTemplateEditorForm = z.object({ orgs: z.array(DmTemplateOrgOption) });
export type DmTemplateEditorForm = z.infer<typeof DmTemplateEditorForm>;

/** «Отключить» и «Включить» (прототип `dmStateDlg`): причина обязательна. */
export const DmTemplateStateInput = z.object({
  to: z.enum(['off', 'published']),
  reason: z.string().trim().min(1).max(DM_REASON_MAX),
  version: z.number().int().positive(),
});
export type DmTemplateStateInput = z.infer<typeof DmTemplateStateInput>;
