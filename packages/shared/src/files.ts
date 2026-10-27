import { z } from 'zod';
import { RecordVersion, Uuid } from './common';

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

/** Начать загрузку: куда, имя и размер файла (тип сервер определяет по расширению сам). */
export const FileUploadStart = z.strictObject({
  source: FileSource,
  // Длину и знаки имени проверяет правило загрузки (`fileUploadProblem`): ответ — «Неверное имя файла».
  name: z.string().min(1).max(1000),
  size: z.number().int().nonnegative(),
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

/** Удаление — с версией, которую видел пользователь. */
export const FileVersionQuery = z.object({ version: z.coerce.number().int().nonnegative() });

/** Ссылка «скачать файл» для страниц и «Истории статусов»: сервер проверит право и отдаст файл. */
export function fileDownloadPath(id: string): string {
  return `/api/files/${encodeURIComponent(id)}/download`;
}
