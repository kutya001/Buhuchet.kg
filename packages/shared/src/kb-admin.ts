import {
  KB_ADMIN_LISTS,
  KB_ARTICLE_AUDIENCES,
  KB_HISTORY_SECTIONS,
  KB_LEVEL_SETS,
} from '@buhuchet/domain';
import { z } from 'zod';
import { RecordVersion } from './common';
import { listPageSchema } from './list';

/*
 * Админка → «База знаний (содержимое)» (задача 2.39, docs/decisions.md п. Д-11): «Шаги уроков»,
 * «Статьи», «Уровни». Длины ограничены с запасом — точные правила (200 знаков названия и т. п.)
 * проверяет домен с текстом ошибки под полем.
 */

const Code = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const short = z.string().max(2000);

export const AdminKbListParam = z.object({ list: z.enum(KB_ADMIN_LISTS) });
export const AdminKbCodeParam = z.object({ id: Code });

/** Строка списка: код, версия записи, значения столбцов и признаки для ячеек и меню строки. */
export const AdminKbRow = z.object({
  id: z.string(),
  version: RecordVersion,
  active: z.boolean(),
  /** Шаг добавлен администратором: «Новое». */
  isNew: z.boolean(),
  star: z.boolean(),
  /** Шаг можно поднять или опустить в своём модуле программы. */
  canUp: z.boolean(),
  canDown: z.boolean(),
  values: z.record(z.string(), z.union([z.string(), z.number()])),
});
export type AdminKbRow = z.infer<typeof AdminKbRow>;

export const AdminKbRowList = listPageSchema(AdminKbRow);
export type AdminKbRowList = z.infer<typeof AdminKbRowList>;

/** Поля окна «Шаг урока». */
export const AdminKbStepFields = z.object({
  g: Code,
  t: short,
  w: short,
  learn: z.boolean(),
  art: z.union([Code, z.literal('')]),
  star: z.boolean(),
  perm: z.string().max(64),
  featk: z.string().max(64),
  evk: z.string().max(64),
  active: z.boolean(),
});

export const AdminKbStepCreate = AdminKbStepFields.extend({ mod: z.string().max(64) });
export type AdminKbStepCreate = z.infer<typeof AdminKbStepCreate>;

export const AdminKbStepUpdate = AdminKbStepFields.extend({ version: RecordVersion });
export type AdminKbStepUpdate = z.infer<typeof AdminKbStepUpdate>;

export const AdminKbStep = AdminKbStepFields.extend({
  id: z.string(),
  ord: z.number(),
  isNew: z.boolean(),
  mod: z.string().nullable(),
  /** Модуль шага: «Просмотр модуля «…»», место для «Перейти». */
  module: z.string().nullable(),
  version: RecordVersion,
});
export type AdminKbStep = z.infer<typeof AdminKbStep>;

export const AdminKbMove = z.object({ dir: z.enum(['up', 'down']), version: RecordVersion });
export const AdminKbActive = z.object({ active: z.boolean(), version: RecordVersion });

/** Поля окна «Статья». */
export const AdminKbArticleFields = z.object({
  sec: short,
  t: short,
  mod: z.string().max(64),
  perm: z.string().max(64),
  aud: z.enum(KB_ARTICLE_AUDIENCES),
  active: z.boolean(),
  html: z.string().max(200_000),
});
export type AdminKbArticleFields = z.infer<typeof AdminKbArticleFields>;

export const AdminKbArticleUpdate = AdminKbArticleFields.extend({ version: RecordVersion });
export type AdminKbArticleUpdate = z.infer<typeof AdminKbArticleUpdate>;

export const AdminKbArticle = AdminKbArticleFields.extend({
  id: z.string(),
  version: RecordVersion,
});
export type AdminKbArticle = z.infer<typeof AdminKbArticle>;

/** Предпросмотр статьи из окна (прототип kbArtDlg с несохранённым текстом). */
export const AdminKbArticlePreview = z.object({
  t: short,
  sec: short,
  mod: z.string().max(64),
  html: z.string().max(200_000),
});

const Level = z.object({ n: z.string().max(200), p: z.number() });

export const AdminKbLevels = z.object({
  business: z.array(Level),
  admin: z.array(Level),
  version: RecordVersion,
});
export type AdminKbLevels = z.infer<typeof AdminKbLevels>;

export const AdminKbLevelSetParam = z.object({ set: z.enum(KB_LEVEL_SETS) });
export const AdminKbLevelsUpdate = z.object({
  levels: z.array(Level).min(1).max(20),
  version: RecordVersion,
});
export type AdminKbLevelsUpdate = z.infer<typeof AdminKbLevelsUpdate>;
export const AdminKbLevelsSaved = AdminKbLevels.extend({ changed: z.boolean() });

/** Справочники окон: модули программы, статьи, права, шаги со своим сценарием показа. */
export const AdminKbMeta = z.object({
  groups: z.array(z.object({ id: z.string(), t: z.string(), adm: z.boolean() })),
  articles: z.array(z.object({ id: z.string(), sec: z.string(), t: z.string() })),
  permissions: z.array(z.object({ id: z.string(), name: z.string() })),
  shows: z.record(z.string(), z.number().int().nonnegative()),
});
export type AdminKbMeta = z.infer<typeof AdminKbMeta>;

const HistoryValue: z.ZodType<unknown> = z.unknown();

export const AdminKbHistoryParam = z.object({ section: z.enum(KB_HISTORY_SECTIONS) });

/** «История изменений · N» вкладки: последние записи, сначала новые. */
export const AdminKbHistory = z.object({
  total: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      id: z.string(),
      at: z.iso.datetime(),
      actor: z.string().nullable(),
      section: z.enum(KB_HISTORY_SECTIONS),
      code: z.string(),
      action: z.string(),
      label: z.string(),
      changes: z.array(
        z.object({ field: z.string(), from: HistoryValue.optional(), to: HistoryValue.optional() }),
      ),
    }),
  ),
});
export type AdminKbHistory = z.infer<typeof AdminKbHistory>;
