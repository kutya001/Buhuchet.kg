import { z } from 'zod';
import { IsoDate, RecordVersion, Uuid } from './common';
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

/** Примечание к файлу — не длиннее стольких знаков. */
export const FILE_NOTE_MAX = 1000;

/**
 * Начать загрузку: куда, имя и размер файла (тип сервер определяет по расширению сам) и необязательное
 * примечание (прототип v95 `attachDlg`: одно на все выбранные файлы). У ручной загрузки Файлового
 * менеджера — ещё контрагент (необязательно).
 */
export const FileUploadStart = z
  .strictObject({
    source: FileSource,
    // Длину и знаки имени проверяет правило загрузки (`fileUploadProblem`): ответ — «Неверное имя файла».
    name: z.string().min(1).max(1000),
    size: z.number().int().nonnegative(),
    contractorId: Uuid.nullable().optional(),
    note: z.string().trim().max(FILE_NOTE_MAX).optional(),
    /**
     * «Показывать контрагенту на его странице» окна «Загрузить файл» (решение заказчика 06.11.2026):
     * false — файл контрагента сразу скрыт со страницы; у общего файла не действует.
     */
    page: z.boolean().optional(),
  })
  .refine((b) => b.source.kind === 'manual' || (!b.contractorId && b.page === undefined), {
    message: 'Контрагент и показ на странице — только у ручной загрузки',
  });
export type FileUploadStart = z.infer<typeof FileUploadStart>;

/**
 * Показ файла на странице контрагента (решение заказчика 06.11.2026, прототип v74 `pgFileOk`,
 * `pgFileHid`): только у файла контрагента не задачи при включённой «Странице контрагента по ссылке»,
 * иначе null; `canChange` — «Скрыть со страницы контрагента» доступно (право «Управлять страницей
 * контрагента» в его области).
 */
export const FilePage = z.object({ hidden: z.boolean(), canChange: z.boolean() });
export type FilePage = z.infer<typeof FilePage>;

/** «Скрыть со страницы контрагента» (true) и «Показать на странице контрагента» (false). */
export const FilePageInput = z.strictObject({ hidden: z.boolean() });

/**
 * Ссылка файла контрагента на его запись (доработки 16.11.2026, блок 2; прототип v124 `fLinkRecs`):
 * вид и номер записи (`FILE_LINK_SOURCE_KINDS`), услуга оплаты услуги или проект транша (`parentId`) и
 * то, из чего экран собирает подпись по словарю: дата, сумма в тыйынах, название услуги или проекта, вид
 * финансовой операции, отчёт (вид коротко, период).
 */
export const FileLinkInfo = z.object({
  kind: FileSourceKind,
  id: Uuid,
  parentId: Uuid.nullable(),
  date: IsoDate.nullable(),
  amount: z.number().int().nullable(),
  name: z.string().nullable(),
  op: z.string().nullable(),
  report: z
    .object({
      short: z.string(),
      period: z.enum(['M', 'Q', 'H', 'Y']),
      start: IsoDate,
      event: IsoDate.nullable(),
    })
    .nullable(),
});
export type FileLinkInfo = z.infer<typeof FileLinkInfo>;

/**
 * Где ещё файл (прототип v124 `f.links`): записи, которые сотрудник видит, и сколько ещё записей ему не
 * видно (для «Удалить отовсюду?»).
 */
export const FileLinks = z.object({
  links: z.array(FileLinkInfo),
  hiddenLinks: z.number().int().nonnegative(),
});
export type FileLinks = z.infer<typeof FileLinks>;

/**
 * Файл в блоке «Файлы»: кто и когда загрузил, примечание, что с ним может этот пользователь: удалить,
 * изменить (название и примечание — право «Загружать файлы» и право менять запись) и заменить (тот,
 * кто может и изменить, и удалить: прежний файл при замене пропадает).
 */
export const FileItem = z.object({
  id: Uuid,
  name: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  note: z.string().nullable(),
  uploadedBy: z.string().nullable(),
  uploadedAt: z.iso.datetime(),
  canDelete: z.boolean(),
  canEdit: z.boolean(),
  canReplace: z.boolean(),
  page: FilePage.nullable(),
  /**
   * Прикреплён к записи ссылкой из файлов контрагента (доработки 16.11.2026, блок 2): вместо «Удалить» —
   * «Открепить» (`canUnlink`), файл остаётся у контрагента.
   */
  linked: z.boolean(),
  canUnlink: z.boolean(),
  version: RecordVersion,
});
export type FileItem = z.infer<typeof FileItem>;

/**
 * «Изменить файл» (прототип v95 `fileEditDlg`): название целиком (расширение остаётся прежним, при
 * замене — берётся от нового файла), примечание (пусто — убрать) и, если файл заменяют, номер
 * загрузки, начатой `POST /api/files/{id}/replacement`; с версией, которую видел пользователь.
 */
export const FileEdit = z.strictObject({
  version: RecordVersion,
  // Длину и знаки названия проверяет правило домена (`fileRenameProblem`): ответ — код под полем.
  name: z.string().max(1000),
  note: z.string().trim().max(FILE_NOTE_MAX),
  uploadId: Uuid.optional(),
});
export type FileEdit = z.infer<typeof FileEdit>;

/** Начать замену файла: имя и размер нового файла (тип сервер определяет по расширению сам). */
export const FileReplaceStart = z.strictObject({
  name: z.string().min(1).max(1000),
  size: z.number().int().nonnegative(),
});
export type FileReplaceStart = z.infer<typeof FileReplaceStart>;

/**
 * Файлы записи и можно ли прикреплять новые; `canLink` — кнопка «Из файлов контрагента» (у записи
 * контрагента, файлы которой можно менять).
 */
export const FileList = z.object({
  items: z.array(FileItem),
  canUpload: z.boolean(),
  canLink: z.boolean(),
});
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
 * загрузил, примечание; можно ли его удалить, изменить и заменить этому пользователю (право и сутки —
 * запись в архиве проверит само действие); `replaced` — кто и когда заменил файл (прототип v95).
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
  canEdit: z.boolean(),
  canReplace: z.boolean(),
  replaced: z.object({ by: z.string().nullable(), at: z.iso.datetime() }).nullable(),
  page: FilePage.nullable(),
  /** Где ещё файл контрагента (ссылки, блок 2): «Источник», «Перейти к источнику», «Удалить отовсюду?». */
  ...FileLinks.shape,
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

/**
 * Контрагенты окна «Загрузить файл»: не в архиве, в области группы «Файловый менеджер»; `inn` — для
 * поиска в списке (прототип v93).
 */
export const FileFormContractors = z.object({
  items: z.array(z.object({ id: Uuid, name: z.string(), inn: z.string() })),
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

/** Запись, к которой прикрепляют или от которой открепляют файл ссылкой. */
export const FileLinkSource = z.strictObject({ kind: FileSourceKind, id: Uuid });
export type FileLinkSource = z.infer<typeof FileLinkSource>;

/** «Из файлов контрагента» → «Прикрепить: N»: какие файлы контрагента прикрепить ссылкой к записи. */
export const FileLinkAdd = z.strictObject({
  kind: FileSourceKind,
  id: Uuid,
  fileIds: z.array(Uuid).min(1).max(50),
});
export type FileLinkAdd = z.infer<typeof FileLinkAdd>;

/** Что прикреплено (уже прикреплённые к записи — нет). */
export const FileLinkAdded = z.object({
  added: z.array(z.object({ id: Uuid, name: z.string() })),
});
export type FileLinkAdded = z.infer<typeof FileLinkAdded>;

/** «Открепить»: файл и запись, от которой его открепляют. */
export const FileUnlinkQuery = z.strictObject({ kind: FileSourceKind, sourceId: Uuid });

/**
 * Окно «Из файлов контрагента» (прототип v124 `fPickDlg`): контрагент записи и его файлы — файлы
 * карточки, принятые от него и загруженные вручную с ним, кроме уже прикреплённых к записи: откуда файл
 * (`kind`), когда загружен, примечание и где ещё он прикреплён.
 */
export const FileLinkable = z.object({
  contractor: z.object({ id: Uuid, name: z.string() }),
  items: z.array(
    z.object({
      id: Uuid,
      name: z.string(),
      contentType: z.string(),
      size: z.number().int().nonnegative(),
      kind: FileSourceKind,
      note: z.string().nullable(),
      uploadedAt: z.iso.datetime(),
      links: z.array(FileLinkInfo),
    }),
  ),
  /** Файлы контрагента есть, но все уже прикреплены к записи. */
  allLinked: z.boolean(),
});
export type FileLinkable = z.infer<typeof FileLinkable>;

/** Где ещё файл — перед удалением (`Удалить отовсюду?`). */
export const FileLinksBody = FileLinks;
