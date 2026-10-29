import { z } from 'zod';
import { RecordVersion, Uuid } from './common';
import { listPageSchema } from './list';

/**
 * Файлы записей (задача 2.04; ТЗ «Файловый менеджер»): блок «Файлы» в карточке записи — список,
 * загрузка мимо API по подписанной ссылке, скачивание по ссылке на 15 минут, удаление.
 */

/** Вид записи-источника: латиница и «_» (`FILE_SOURCE_KINDS` в @buhuchet/domain). */
export const FileSourceKind = z.string().regex(/^[a-z_]{1,40}$/);

/** Запись, к которой прикреплены файлы: вид и номер (у «Загружен вручную» номера нет). */
export const FileSource = z.strictObject({ kind: FileSourceKind, id: Uuid.nullable() });
export type FileSource = z.infer<typeof FileSource>;

/** Запрос файлов записи: `?kind=…&id=…` (без `id` — запись без номера). */
export const FileSourceQuery = z.strictObject({ kind: FileSourceKind, id: Uuid.optional() });

/** Комментарий ручной загрузки — не длиннее стольких знаков. */
export const FILE_NOTE_MAX = 1000;

/**
 * Начать загрузку: куда, имя и размер файла (тип сервер определяет по расширению сам). У ручной
 * загрузки Файлового менеджера — ещё контрагент (необязательно) и комментарий.
 */
export const FileUploadStart = z
  .strictObject({
    source: FileSource,
    // Длину и знаки имени проверяет правило загрузки (`fileUploadProblem`): ответ — «Неверное имя файла».
    name: z.string().min(1).max(1000),
    size: z.number().int().nonnegative(),
    contractorId: Uuid.nullable().optional(),
    note: z.string().trim().max(FILE_NOTE_MAX).optional(),
  })
  .refine((b) => b.source.kind === 'manual' || (!b.contractorId && !b.note), {
    message: 'Контрагент и комментарий — только у ручной загрузки',
  });
export type FileUploadStart = z.infer<typeof FileUploadStart>;

/** Файл в блоке «Файлы»: кто и когда загрузил, можно ли его удалить этому пользователю. */
export const FileItem = z.object({
  id: Uuid,
  name: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  uploadedBy: z.string().nullable(),
  uploadedAt: z.iso.datetime(),
  canDelete: z.boolean(),
  version: RecordVersion,
});
export type FileItem = z.infer<typeof FileItem>;

/** Файлы записи и можно ли прикреплять новые. */
export const FileList = z.object({ items: z.array(FileItem), canUpload: z.boolean() });
export type FileList = z.infer<typeof FileList>;

/**
 * Загрузка начата: браузер кладёт файл в хранилище запросом `PUT` по ссылке с этими заголовками (размер
 * и тип подписаны — другой файл хранилище не примет), затем вызывает `POST /api/files/{id}/complete`.
 */
export const FileUploadTicket = z.object({
  id: Uuid,
  upload: z.object({
    url: z.string(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime(),
  }),
});
export type FileUploadTicket = z.infer<typeof FileUploadTicket>;

/** Ссылка на скачивание файла из хранилища на 15 минут. */
export const FileLink = z.object({ url: z.string(), expiresAt: z.iso.datetime() });
export type FileLink = z.infer<typeof FileLink>;

export const FileIdParam = z.object({ id: Uuid });

/**
 * Строка «Файлового менеджера» (задача 2.29; прототип modules/files.js, `allFiles`): файл, откуда он
 * (вид и номер записи-источника, источник как на экране), контрагент (null — общий файл), кто и когда
 * загрузил, комментарий ручной загрузки; можно ли его удалить этому пользователю (право и сутки — запись
 * в архиве проверит удаление).
 */
export const FileManagerRow = z.object({
  id: Uuid,
  name: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  kind: FileSourceKind,
  sourceId: Uuid.nullable(),
  source: z.string(),
  /** Чем ещё найти запись-источник: месяц значения показателя «2026-09». */
  sourceRef: z.string().nullable(),
  contractor: z.object({ id: Uuid, name: z.string() }).nullable(),
  note: z.string().nullable(),
  uploadedBy: z.string().nullable(),
  uploadedAt: z.iso.datetime(),
  canDelete: z.boolean(),
  audit: z.object({
    createdAt: z.iso.datetime(),
    createdBy: z.string().nullable(),
    updatedAt: z.iso.datetime(),
    updatedBy: z.string().nullable(),
  }),
  version: RecordVersion,
});
export type FileManagerRow = z.infer<typeof FileManagerRow>;

export const FileManagerList = listPageSchema(FileManagerRow);
export type FileManagerList = z.infer<typeof FileManagerList>;

/** Плашки по видам источника (у вида — число видимых файлов) и можно ли загружать вручную. */
export const FileManagerSummary = z.object({
  plates: z.array(z.object({ kind: FileSourceKind, count: z.number().int().nonnegative() })),
  canUpload: z.boolean(),
  /** Видимых файлов нет совсем — «Здесь будут все файлы организации» (пустой модуль). */
  empty: z.boolean(),
});
export type FileManagerSummary = z.infer<typeof FileManagerSummary>;

/** Контрагенты окна «Загрузить файл»: не в архиве, в области группы «Файловый менеджер». */
export const FileFormContractors = z.object({
  items: z.array(z.object({ id: Uuid, name: z.string() })),
});
export type FileFormContractors = z.infer<typeof FileFormContractors>;

/** «Хранилище файлов» в «Моя организация» → «Настройки»: сколько занято и сколько файлов. */
export const FileUsage = z.object({
  bytes: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
});
export type FileUsage = z.infer<typeof FileUsage>;

/** Удаление — с версией, которую видел пользователь. */
export const FileVersionQuery = z.object({ version: z.coerce.number().int().nonnegative() });

/** Ссылка «скачать файл» для страниц и «Истории статусов»: сервер проверит право и отдаст файл. */
export function fileDownloadPath(id: string): string {
  return `/api/files/${encodeURIComponent(id)}/download`;
}
