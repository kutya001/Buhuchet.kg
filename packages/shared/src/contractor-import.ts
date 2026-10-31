import {
  CP_IMPORT_CELL_MAX,
  CP_IMPORT_COLUMNS,
  CP_IMPORT_MAX_COLUMNS,
  CP_IMPORT_MAX_ROWS,
} from '@buhuchet/domain';
import { z } from 'zod';

/*
 * Загрузка контрагентов вставкой из Excel (задача 2.16; ТЗ «Загрузка текущих контрагентов при переходе
 * на систему»; прототип modules/contractor-import.js): строки вставки с выбранными колонками, проверка
 * строк, «ОК» и шаблон.
 */

/** Строки вставки: что означает каждая колонка и ячейки строк (до 500 строк). */
export const ContractorImportRequest = z.object({
  map: z.array(z.enum(CP_IMPORT_COLUMNS)).min(1).max(CP_IMPORT_MAX_COLUMNS),
  rows: z
    .array(z.array(z.string().max(CP_IMPORT_CELL_MAX)).max(CP_IMPORT_MAX_COLUMNS))
    .min(1)
    .max(CP_IMPORT_MAX_ROWS),
});
export type ContractorImportRequest = z.infer<typeof ContractorImportRequest>;

/** Строка после проверки: ошибки и предупреждения словами; без ошибок — «готова». */
export const ContractorImportRow = z.object({
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type ContractorImportRow = z.infer<typeof ContractorImportRow>;

/** «Проверить»: строки по порядку вставки и сколько готово к загрузке. */
export const ContractorImportCheck = z.object({
  rows: z.array(ContractorImportRow),
  ready: z.number().int().nonnegative(),
});
export type ContractorImportCheck = z.infer<typeof ContractorImportCheck>;

/** «ОК»: созданы готовые строки; `rows` — проверка всех строк вставки (с ошибками — пропущены). */
export const ContractorImportResult = ContractorImportCheck.extend({
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type ContractorImportResult = z.infer<typeof ContractorImportResult>;

/** Шаблон для окна «Шаблон загрузки контрагентов»: колонки с подсказками и лист кодов ГКЭД. */
export const ContractorImportTemplate = z.object({
  columns: z.array(
    z.object({
      key: z.enum(CP_IMPORT_COLUMNS),
      title: z.string(),
      required: z.boolean(),
      example: z.string(),
      hint: z.string(),
    }),
  ),
  gked: z.array(z.object({ code: z.string(), name: z.string(), section: z.string() })),
});
export type ContractorImportTemplate = z.infer<typeof ContractorImportTemplate>;
