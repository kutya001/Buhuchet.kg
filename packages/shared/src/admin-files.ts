import {
  ADMIN_FILE_CATS,
  ADMIN_FILE_KINDS,
  ADMIN_FILE_STATES,
  FILE_TRASH_WHY,
  STORAGE_CHECK_LISTS,
} from '@buhuchet/domain';
import { z } from 'zod';
import { IsoDate, Uuid } from './common';
import { ListExportParams, ListQueryParams, ListValuesQuery, listPageSchema } from './list';

/*
 * Модуль «Файлы» Админки и вкладка «Файлы» карточки организации (доработки 20.11.2026, пакет 2,
 * блоки 3–5; прототип admin/admin-files.js; этап 1, П4–П6, поток И). Ключей хранилища в ответах нет:
 * файл открывается подписанной ссылкой на 15 минут, путь есть только у лишнего файла сверки.
 */

const Moment = z.iso.datetime();

/** Сколько и какого объёма (байт). */
export const CountBytes = z.object({ n: z.number().int(), bytes: z.number().int() });

/** Строка «Все файлы» (прототип `afOrgRows`): подписи — готовым текстом, как в ячейках. */
export const AdminStorageFile = z.object({
  kind: z.enum(ADMIN_FILE_KINDS),
  id: Uuid,
  orgId: Uuid.nullable(),
  /** Организация или «<фирма> (заявка)». */
  orgText: z.string().nullable(),
  contractorId: Uuid.nullable(),
  cpName: z.string().nullable(),
  cpInn: z.string().nullable(),
  cat: z.enum(ADMIN_FILE_CATS),
  /** Код главного «Источника» (`afiles.src.<код>`). */
  src: z.string(),
  srcText: z.string(),
  name: z.string(),
  contentType: z.string().nullable(),
  sizeBytes: z.number().int(),
  note: z.string().nullable(),
  byText: z.string(),
  at: Moment,
  state: z.enum(ADMIN_FILE_STATES),
  /** Входит ли в память организации. */
  mem: z.boolean(),
  /** Когда сотрётся — у удалённого. */
  eraseAt: Moment.nullable(),
  why: z.enum(FILE_TRASH_WHY).nullable(),
  /** «Вернуть» доступно (удалён сотрудником, срок не прошёл). */
  restorable: z.boolean(),
});
export type AdminStorageFile = z.infer<typeof AdminStorageFile>;
export const AdminStorageFileList = listPageSchema(AdminStorageFile);

/** Только файлы организации (вкладка «Файлы» карточки и строка «По организациям»). */
const orgScope = { org: Uuid.optional() };
export const AdminStorageFileQuery = ListQueryParams.extend(orgScope);
export const AdminStorageFileValuesQuery = ListValuesQuery.extend(orgScope);
export const AdminStorageFileExportQuery = ListExportParams.extend(orgScope);

/** Ссылка на файл: `download=1` — вложением (окно просмотра читает любой файл), без — только картинка и PDF. */
export const AdminStorageFileLinkQuery = z.strictObject({ download: z.enum(['1']).optional() });

/** «Ждут удаления» одной организации или все. */
export const AdminTrashQuery = z.strictObject({ org: Uuid.optional() });

/** Строка «По организациям» «Хранилища» (прототип `af-orgs`). */
export const AdminStorageOrg = z.object({
  orgId: Uuid,
  name: z.string(),
  n: z.number().int(),
  bytes: z.number().int(),
  /** Предел памяти из подписки, байт; null — подписки нет (у демо — тоже). */
  limitBytes: z.number().int().nullable(),
  pct: z.number().nullable(),
  last: IsoDate.nullable(),
});

/** «Хранилище» (блок 3, пункт 3; прототип `renderAFStore`). */
export const AdminStorageSummary = z.object({
  total: CountBytes,
  org: CountBytes,
  sent: CountBytes,
  lead: CountBytes,
  platform: CountBytes,
  rcpt: CountBytes,
  trash: CountBytes,
  diff: z.number().int(),
  checkedAt: Moment.nullable(),
  /** 12 месяцев до текущего, байт загружено. */
  months: z.array(z.object({ month: z.string(), bytes: z.number().int() })),
  orgs: z.array(AdminStorageOrg),
});
export type AdminStorageSummary = z.infer<typeof AdminStorageSummary>;

/** Строка «Ждут удаления» (прототип `afTrashDlg`). */
export const AdminTrashRow = z.object({
  id: Uuid,
  orgId: Uuid.nullable(),
  orgName: z.string().nullable(),
  why: z.enum(FILE_TRASH_WHY),
  cpName: z.string().nullable(),
  name: z.string(),
  sizeBytes: z.number().int(),
  /** Код «Источника» (`afiles.src.<код>`). */
  src: z.string().nullable(),
  byText: z.string(),
  deletedAt: Moment,
  eraseAt: Moment,
  restorable: z.boolean(),
  /** Пробовали стереть и не вышло. */
  attempts: z.number().int(),
});
export type AdminTrashRow = z.infer<typeof AdminTrashRow>;
export const AdminTrashList = z.object({
  items: z.array(AdminTrashRow),
  total: z.number().int(),
});

/** «Вернуть»: ответ — что вышло. */
export const AdminTrashRestore = z.object({ id: Uuid, restored: z.literal(true) });

/** Строка «Проверки хранилища» (прототип `renderAFCheck`). */
export const AdminStorageCheckRow = z.object({
  id: z.number().int(),
  kind: z.enum(STORAGE_CHECK_LISTS),
  /** Путь в хранилище — только у лишнего файла. */
  path: z.string().nullable(),
  orgId: Uuid.nullable(),
  orgName: z.string().nullable(),
  name: z.string().nullable(),
  cpName: z.string().nullable(),
  src: z.string().nullable(),
  byText: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  at: Moment.nullable(),
  attempts: z.number().int().nullable(),
  /** Код последней ошибки стирания (`afiles.err.<код>`). */
  lastError: z.string().nullable(),
  /** Старше суток — «Удалить» лишнего доступно. */
  deletable: z.boolean(),
  ageHours: z.number().int().nullable(),
});
export type AdminStorageCheckRow = z.infer<typeof AdminStorageCheckRow>;
export const AdminStorageCheck = z.object({
  checkedAt: Moment.nullable(),
  missing: z.object({ items: z.array(AdminStorageCheckRow), total: z.number().int() }),
  extra: z.object({ items: z.array(AdminStorageCheckRow), total: z.number().int() }),
  stuck: z.object({ items: z.array(AdminStorageCheckRow), total: z.number().int() }),
  failed: z.object({ items: z.array(AdminStorageCheckRow), total: z.number().int() }),
});
export type AdminStorageCheck = z.infer<typeof AdminStorageCheck>;

/** Номер строки «Проверки хранилища». */
export const AdminStorageCheckParam = z.object({ id: z.coerce.number().int().positive() });

/** «Удалить» лишний файл: строка «Ждут удаления». */
export const AdminExtraDelete = z.object({ trashId: Uuid, eraseAt: Moment });

/** Строка «Все файлы» в адресе: вид и номер. */
export const AdminStorageFileParam = z.object({ kind: z.enum(ADMIN_FILE_KINDS), id: Uuid });

/** Файлы карточки организации: память и «Объём по категориям» (прототип `ocFilesTab`). */
export const AdminOrgFiles = z.object({
  usedBytes: z.number().int(),
  limitBytes: z.number().int().nullable(),
  pct: z.number().nullable(),
  /** В цену входит, байт (база и места пакета); null — подписки нет. */
  includedBytes: z.number().int().nullable(),
  extraGb: z.number().int().nullable(),
  categories: z.array(z.object({ src: z.string(), n: z.number().int(), bytes: z.number().int() })),
});
export type AdminOrgFiles = z.infer<typeof AdminOrgFiles>;
