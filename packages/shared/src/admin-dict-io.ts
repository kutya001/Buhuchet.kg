import { ADMIN_VALUE_DICTS } from '@buhuchet/domain';
import { z } from 'zod';
import { AdminDuesPreview } from './admin-dicts';
import { Uuid } from './common';
import { listPageSchema } from './list';

/*
 * Админка → «Справочники платформы» → «Выгрузить» и «Загрузить» (задача 2.37; прототип
 * admin/platform-dicts-io.js: exportDlg, importDictDlg, renderLoads): файл справочника, сравнение
 * загрузки со справочником, «ОК, применить» и «Загрузки» с откатом.
 */

/** Выгрузка справочника: заголовки столбцов и строки — текстом ячеек, как в файле. */
export const AdminDictIoFile = z.object({
  header: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});
export type AdminDictIoFile = z.infer<typeof AdminDictIoFile>;

const Line = z.number().int().positive();

/** Изменённое поле строки: заголовок столбца, было и стало — текстом ячейки. */
export const AdminDictIoChange = z.object({
  title: z.string(),
  from: z.string(),
  to: z.string(),
});

const ChangedRow = z.object({
  line: Line,
  code: z.string(),
  name: z.string(),
  changes: z.array(AdminDictIoChange),
});

/**
 * Сравнение загрузки со справочником (прототип importDictDlg `compare`): «Будет добавлено»,
 * «Будет изменено», «Будет отключено», «Строк с ошибками» — по строкам файла; `same` — строк без
 * изменений. `stamp` — отметка справочника и файла: «ОК, применить» с другой отметкой — 409, сравнить
 * заново.
 */
export const AdminDictImportPreview = z.object({
  rows: z.number().int().nonnegative(),
  add: z.array(z.object({ line: Line, code: z.string(), name: z.string() })),
  change: z.array(ChangedRow),
  off: z.array(ChangedRow),
  errors: z.array(z.object({ line: Line, code: z.string(), errors: z.array(z.string()) })),
  same: z.number().int().nonnegative(),
  stamp: z.string(),
  /**
   * У скольких несданных отчётов в скольких организациях изменятся сроки; `null` — посчитать за минуту
   * не успели: сроки пересчитаются после применения.
   */
  dues: AdminDuesPreview.nullable(),
  /**
   * У видов отчётов: у скольких видов меняется «Что нужно сделать» и сколько отчётов по ним уже
   * создано — они остаются с прежним (прототип `actT`, `actR`).
   */
  act: z.object({
    types: z.number().int().nonnegative(),
    reports: z.number().int().nonnegative(),
  }),
});
export type AdminDictImportPreview = z.infer<typeof AdminDictImportPreview>;

export const AdminDictImportApplyQuery = z.object({
  stamp: z.string().regex(/^[0-9a-f]{64}$/),
});

/** Загрузка в «Загрузках»: когда, справочник, кто, сколько строк и что сделано; статус и откат. */
export const AdminDictLoad = z.object({
  id: Uuid,
  dict: z.enum(ADMIN_VALUE_DICTS),
  rows: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
  disabled: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  at: z.iso.datetime(),
  by: z.string().nullable(),
  rolledBackAt: z.iso.datetime().nullable(),
  rolledBackBy: z.string().nullable(),
  /** Последняя не откаченная — только её можно откатить. */
  last: z.boolean(),
});
export type AdminDictLoad = z.infer<typeof AdminDictLoad>;

export const AdminDictLoadList = listPageSchema(AdminDictLoad);
export type AdminDictLoadList = z.infer<typeof AdminDictLoadList>;

/** «ОК, применить»: запись «Загрузок» и что было в файле. */
export const AdminDictImportApplied = z.object({
  load: AdminDictLoad,
  preview: AdminDictImportPreview,
  /** Сроки пересчитаны не во всех организациях: остальные догонит задача по расписанию. */
  pending: z.boolean(),
});
export type AdminDictImportApplied = z.infer<typeof AdminDictImportApplied>;

export const AdminDictLoadIdParam = z.object({ id: Uuid });
