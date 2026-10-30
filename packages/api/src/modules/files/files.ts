import { randomUUID } from 'node:crypto';
import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { orgFileKey } from '@buhuchet/adapters';
import {
  dropPendingFile,
  getFile,
  takeRateLimit,
  insertPendingFile,
  listSourceFiles,
  markFileDeleted,
  markFileReady,
  orgMenuSettings,
  withOrgContext,
  writeHistory,
  type FileRecord,
  type RateLimit,
  type Tx,
} from '@buhuchet/db';
import {
  canSeeContractor,
  FILE_LINK_SECONDS,
  FILE_MAX_BYTES,
  FILE_MESSAGES,
  FILE_UPLOAD_LINK_SECONDS,
  FILE_UPLOADS_PER_HOUR,
  fileContentType,
  fileDeleteRefusal,
  fileUploadProblem,
  hasPermission,
  type AccessSubject,
} from '@buhuchet/domain';
import {
  ApiError,
  FileIdParam,
  FileItem,
  FileLink,
  FileList,
  FileSourceQuery,
  FileUploadStart,
  FileUploadTicket,
  FileVersionQuery,
  type FileItem as FileItemBody,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { FILE_SOURCES, type FileSource, type FileSourceRecord } from './sources';

/*
 * Файлы записей (задача 2.04; ТЗ «Файловый менеджер»; прототип modules/services.js — `filesBox`,
 * modules/files.js — правила). Видит файлы право «Просматривать файлы» в области группы «Файловый
 * менеджер» и тот, кто видит саму запись; прикрепляет — «Загружать файлы» и право менять запись в её
 * модуле; удаляет свой файл в течение суток или любой — с правом «Удалять файлы». Функция учётной
 * политики «Файлы в карточках» выключена — файлов нет совсем. Сам файл идёт мимо API: браузер кладёт
 * его в хранилище по подписанной ссылке, API проверяет размер и делает файл видимым.
 */

export const error = { 'application/json': { schema: ApiError } };

const notFound = (): never => apiFail(404, 'not_found', 'Файл не найден');

/** Раздел ключа хранилища: `org/<org_id>/files/<id>` (ограничение files_key_check в базе). */
const FILES_SECTION = 'files';

type FileSources = Readonly<Record<string, FileSource>>;

/** Источник файлов по виду: только свои ключи реестра (`constructor`, `__proto__` — не источники). */
export function sourceOf(deps: ApiDeps, kind: string): FileSource | undefined {
  const sources: FileSources = deps.fileSources ?? FILE_SOURCES;
  return Object.hasOwn(sources, kind) ? sources[kind] : undefined;
}

/** Начатые загрузки пользователя за час (незаконченные лежат в хранилище сутки до очистки). */
const UPLOAD_RATE_LIMIT: RateLimit = {
  kind: 'file_upload',
  max: FILE_UPLOADS_PER_HOUR,
  windowSeconds: 3600,
};

export function subjectOf(c: Context<AppEnv>): AccessSubject {
  return c.get('access')!.subject;
}

/** Функция «Файлы в карточках» выключена — 403 `files_off`. */
export async function requireFilesFeature(tx: Tx, orgId: string): Promise<void> {
  const { features } = await orgMenuSettings(tx, orgId);
  if (!features.files) apiFail(403, 'files_off', FILE_MESSAGES.files_off);
}

/** Видит ли сотрудник файлы записи: право просмотра и область группы «Файловый менеджер». */
export function canView(subject: AccessSubject, record: FileSourceRecord): boolean {
  if (!hasPermission(subject, 'filesView')) return false;
  return !record.contractor || canSeeContractor(subject, 'files', record.contractor);
}

function canUpload(subject: AccessSubject, record: FileSourceRecord): boolean {
  return canView(subject, record) && record.editable && hasPermission(subject, 'filesUpload');
}

export function deleteRefusal(
  subject: AccessSubject,
  record: FileSourceRecord,
  file: FileRecord,
  userId: string,
  now: Date,
): 'forbidden' | 'file_delete_forbidden' | null {
  if (!record.editable) return 'forbidden';
  return fileDeleteRefusal(
    { uploadedBy: file.createdBy, uploadedAt: file.createdAt },
    { userId, canDeleteAny: hasPermission(subject, 'filesDelete'), now },
  );
}

/**
 * Запись-источник, файлы которой сотрудник видит; иначе — 404 (чужую запись и запись вне области не
 * отличить от несуществующей).
 */
async function visibleSource(
  deps: ApiDeps,
  tx: Tx,
  subject: AccessSubject,
  kind: string,
  id: string | null,
  own?: { contractorId: string | null },
): Promise<FileSourceRecord> {
  const source = sourceOf(deps, kind);
  const record = source ? await source.resolve(tx, subject, id, own) : null;
  if (!record || !canView(subject, record)) return notFound();
  return record;
}

/** Файл блока «Файлы» для ответа: можно ли удалить — для этого сотрудника сейчас. */
function itemBody(
  file: FileRecord,
  record: FileSourceRecord,
  subject: AccessSubject,
  userId: string,
  now: Date,
): FileItemBody {
  return {
    id: file.id,
    name: file.name,
    contentType: file.contentType,
    size: file.sizeBytes,
    uploadedBy: file.uploadedBy,
    uploadedAt: file.createdAt.toISOString(),
    canDelete: deleteRefusal(subject, record, file, userId, now) === null,
    version: file.version,
  };
}

/**
 * «Сейчас» для правила «свой файл — в течение суток»: время загрузки ставит база по настоящим часам,
 * поэтому и сравнение — с настоящими часами, а не с часами демо-стенда (FIXED_NOW).
 */
export const realNow = () => new Date();

/** Удалить файл из хранилища, не роняя метод: запись в базе уже верная, лишний файл не опасен. */
async function dropObject(deps: ApiDeps, key: string): Promise<void> {
  try {
    await deps.storage.delete(key);
  } catch (err) {
    deps.logger.error({ err }, 'файлы: не удалось удалить файл из хранилища');
  }
}

/** Удалить файлы из хранилища после фиксации — например, файлы удалённого контрагента. */
export async function dropObjects(deps: ApiDeps, keys: readonly string[]): Promise<void> {
  for (const key of keys) await dropObject(deps, key);
}

export const listFilesRoute = createRoute({
  method: 'get',
  path: '/files',
  tags: ['files'],
  summary: 'Файлы записи (блок «Файлы» карточки)',
  middleware: [requirePermission('filesView')] as const,
  request: { query: FileSourceQuery },
  responses: {
    200: {
      description: 'Файлы записи по порядку загрузки и можно ли прикреплять новые',
      content: { 'application/json': { schema: FileList } },
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Нет права «Просматривать файлы» или «Файлы в карточках» выключены',
      content: error,
    },
    404: { description: 'Записи нет или она вне области', content: error },
  },
});

export function listFilesHandler(deps: ApiDeps): RouteHandler<typeof listFilesRoute, AppEnv> {
  return async (c) => {
    const { kind, id } = c.req.valid('query');
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const now = realNow();
    const body = await withOrgContext(deps.db, ctx, async (tx) => {
      await requireFilesFeature(tx, ctx.orgId);
      const record = await visibleSource(deps, tx, subject, kind, id ?? null);
      const items = await listSourceFiles(tx, kind, id ?? null);
      return {
        items: items.map((f) => itemBody(f, record, subject, ctx.userId!, now)),
        canUpload: canUpload(subject, record),
      };
    });
    return c.json(body, 200);
  };
}

export const startUploadRoute = createRoute({
  method: 'post',
  path: '/files/uploads',
  tags: ['files'],
  summary: 'Начать загрузку файла к записи: ссылка на хранилище на 2 минуты',
  middleware: [requirePermission('filesUpload')] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: FileUploadStart } } },
  },
  responses: {
    201: {
      description: 'Загрузка начата: куда и с какими заголовками положить файл',
      content: { 'application/json': { schema: FileUploadTicket } },
    },
    400: {
      description: 'Файл больше 20 МБ, такой тип не загружается, неверное имя',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Нет права «Загружать файлы» или менять запись; «Файлы в карточках» выключены',
      content: error,
    },
    404: { description: 'Записи нет или она вне области', content: error },
    429: { description: 'Больше 300 загрузок за час', content: error },
  },
});

/**
 * Начать загрузку (прототип `bindFiles` → «Файлы прикреплены»): проверить файл и права, завести запись
 * «pending» и подписать ссылку на хранилище с этим размером и типом. Файл станет виден в записи после
 * `POST /files/{id}/complete`.
 */
export function startUploadHandler(deps: ApiDeps): RouteHandler<typeof startUploadRoute, AppEnv> {
  return async (c) => {
    const { source, name: rawName, size, contractorId = null, note } = c.req.valid('json');
    const problem = fileUploadProblem({ name: rawName, size });
    if (problem) apiFail(400, problem, FILE_MESSAGES[problem]);
    const name = rawName.trim();
    const contentType = fileContentType(name);
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const id = randomUUID();
    const storageKey = orgFileKey(ctx.orgId, FILES_SECTION, id);
    // Предел — до транзакции и на `db`: проверка держит блокировку пользователя до своего конца.
    const slot = await takeRateLimit(deps.db, UPLOAD_RATE_LIMIT, ctx.userId!);
    if (!slot.ok) apiFail(429, 'file_upload_limit', FILE_MESSAGES.file_upload_limit);
    await withOrgContext(deps.db, ctx, async (tx) => {
      await requireFilesFeature(tx, ctx.orgId);
      const record = await visibleSource(deps, tx, subject, source.kind, source.id, {
        contractorId,
      });
      if (!canUpload(subject, record)) apiFail(403, 'forbidden', 'Нет права на это действие');
      await insertPendingFile(tx, {
        id,
        sourceKind: source.kind,
        sourceId: source.id,
        contractorId: record.contractor?.id ?? null,
        name,
        contentType,
        sizeBytes: size,
        storageKey,
        note: note || null,
      });
    });
    // Срок — по настоящим часам: подпись хранилища ставит их же, а не часы демо-стенда (FIXED_NOW).
    const expiresAt = new Date(Date.now() + FILE_UPLOAD_LINK_SECONDS * 1000);
    const upload = await deps.storage.signedUploadUrl(storageKey, {
      expiresInSeconds: FILE_UPLOAD_LINK_SECONDS,
      contentType,
      size,
    });
    return c.json(
      {
        id,
        upload: {
          url: upload.url,
          method: 'PUT' as const,
          headers: upload.headers,
          expiresAt: expiresAt.toISOString(),
        },
      },
      201,
    );
  };
}

export const completeUploadRoute = createRoute({
  method: 'post',
  path: '/files/{id}/complete',
  tags: ['files'],
  summary: 'Закончить загрузку: файл в хранилище проверен и виден в записи',
  middleware: [requirePermission('filesUpload')] as const,
  request: { params: FileIdParam },
  responses: {
    200: {
      description: 'Файл прикреплён к записи (в истории записи — «Прикреплён файл»)',
      content: { 'application/json': { schema: FileItem } },
    },
    400: { description: 'Файл больше 20 МБ', content: error },
    401: { description: 'Нет входа', content: error },
    403: {
      description: 'Нет права «Загружать файлы» или менять запись; «Файлы в карточках» выключены',
      content: error,
    },
    404: { description: 'Нет такой начатой загрузки этого пользователя', content: error },
    409: { description: 'Файл не дошёл до хранилища или он не тот, что заявлен', content: error },
  },
});

/**
 * Закончить загрузку: файл лежит в хранилище и его размер — тот, что заявлен (не больше 20 МБ). Закончить
 * может только тот, кто начал. Файл не того размера удаляется вместе с записью.
 */
export function completeUploadHandler(
  deps: ApiDeps,
): RouteHandler<typeof completeUploadRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const pending = await withOrgContext(deps.db, ctx, (tx) => getFile(tx, id));
    if (!pending || pending.state !== 'pending' || pending.createdBy !== ctx.userId) {
      return notFound();
    }
    const stored = await deps.storage.stat(pending.storageKey);
    if (!stored) apiFail(409, 'file_not_uploaded', FILE_MESSAGES.file_not_uploaded);
    // Размер и тип подписаны в ссылке, но проверяются ещё раз: не всякое хранилище S3 сверяет подпись
    // типа одинаково.
    if (
      stored.size !== pending.sizeBytes ||
      stored.size > FILE_MAX_BYTES ||
      stored.contentType !== pending.contentType
    ) {
      await withOrgContext(deps.db, ctx, (tx) => dropPendingFile(tx, id));
      await dropObject(deps, pending.storageKey);
      if (stored.size > FILE_MAX_BYTES)
        apiFail(400, 'file_too_large', FILE_MESSAGES.file_too_large);
      apiFail(409, 'file_not_uploaded', FILE_MESSAGES.file_not_uploaded);
    }
    const now = realNow();
    const body = await withOrgContext(deps.db, ctx, async (tx) => {
      const file = await getFile(tx, id, { lock: true });
      if (!file || file.state !== 'pending') return notFound();
      await requireFilesFeature(tx, ctx.orgId);
      const record = await visibleSource(deps, tx, subject, file.sourceKind, file.sourceId, file);
      if (!canUpload(subject, record)) apiFail(403, 'forbidden', 'Нет права на это действие');
      await markFileReady(tx, id);
      await writeHistory(tx, {
        ...record.history(id),
        action: 'file_attach',
        changes: [{ field: 'file', to: file.name }],
      });
      const ready = (await getFile(tx, id))!;
      return itemBody(ready, record, subject, ctx.userId!, now);
    });
    return c.json(body, 200);
  };
}

/** Файл, который сотрудник видит: загружен, не удалён, запись-источник видна. */
export async function visibleFile(
  deps: ApiDeps,
  c: Context<AppEnv>,
  id: string,
): Promise<{ file: FileRecord; record: FileSourceRecord }> {
  const ctx = orgContextOf(c);
  return withOrgContext(deps.db, ctx, async (tx) => {
    const file = await getFile(tx, id);
    if (!file || file.state !== 'ready') return notFound();
    await requireFilesFeature(tx, ctx.orgId);
    const record = await visibleSource(
      deps,
      tx,
      subjectOf(c),
      file.sourceKind,
      file.sourceId,
      file,
    );
    return { file, record };
  });
}

/**
 * Ссылка на файл на 15 минут: файл отдаётся вложением с его именем; `inline` — для просмотра в окне
 * (только картинки и PDF: хранилище отдаёт их с проверенным типом, а не тем, что лежит у файла).
 */
export async function downloadLink(
  deps: ApiDeps,
  file: FileRecord,
  inline?: { contentType: string },
): Promise<FileLink> {
  const expiresAt = new Date(Date.now() + FILE_LINK_SECONDS * 1000);
  const url = await deps.storage.signedDownloadUrl(file.storageKey, {
    expiresInSeconds: FILE_LINK_SECONDS,
    fileName: file.name,
    ...(inline ? { inline } : {}),
  });
  return { url, expiresAt: expiresAt.toISOString() };
}

export const fileReadResponses = {
  401: { description: 'Нет входа', content: error },
  403: {
    description: 'Нет права «Просматривать файлы» или «Файлы в карточках» выключены',
    content: error,
  },
  404: { description: 'Файла нет, он удалён или вне области', content: error },
} as const;

export const fileLinkRoute = createRoute({
  method: 'get',
  path: '/files/{id}/link',
  tags: ['files'],
  summary: 'Ссылка на скачивание файла на 15 минут',
  middleware: [requirePermission('filesView')] as const,
  request: { params: FileIdParam },
  responses: {
    200: {
      description: 'Подписанная ссылка на файл в хранилище',
      content: { 'application/json': { schema: FileLink } },
    },
    ...fileReadResponses,
  },
});

export function fileLinkHandler(deps: ApiDeps): RouteHandler<typeof fileLinkRoute, AppEnv> {
  return async (c) => {
    const { file } = await visibleFile(deps, c, c.req.valid('param').id);
    return c.json(await downloadLink(deps, file), 200);
  };
}

export const downloadFileRoute = createRoute({
  method: 'get',
  path: '/files/{id}/download',
  tags: ['files'],
  summary: 'Скачать файл: переход на подписанную ссылку (для ссылок на странице)',
  middleware: [requirePermission('filesView')] as const,
  request: { params: FileIdParam },
  responses: {
    302: { description: 'Переход на подписанную ссылку на 15 минут' },
    ...fileReadResponses,
  },
});

export function downloadFileHandler(deps: ApiDeps): RouteHandler<typeof downloadFileRoute, AppEnv> {
  return async (c) => {
    const { file } = await visibleFile(deps, c, c.req.valid('param').id);
    return c.redirect((await downloadLink(deps, file)).url, 302);
  };
}

export const deleteFileRoute = createRoute({
  method: 'delete',
  path: '/files/{id}',
  tags: ['files'],
  summary: 'Удалить файл записи',
  middleware: [requirePermission('filesView')] as const,
  request: { params: FileIdParam, query: FileVersionQuery },
  responses: {
    200: {
      description: 'Файл удалён (в истории записи — «Удалён файл»)',
      content: { 'application/json': { schema: z.object({ id: z.uuid() }) } },
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Чужой файл без права «Удалять файлы», свой — позже суток; нет права менять запись',
      content: error,
    },
    ...versionedSaveResponses,
  },
});

/**
 * Удалить файл (прототип: «Удалить файл «…»?» → «Файл удалён»): из записи и из Файлового менеджера; в
 * истории записи — «Удалён файл». Сам файл стирается из хранилища после сохранения.
 */
export function deleteFileHandler(deps: ApiDeps): RouteHandler<typeof deleteFileRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('query');
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const now = realNow();
    const key = await withOrgContext(deps.db, ctx, async (tx) => {
      const file = await getFile(tx, id);
      if (!file || file.state !== 'ready') return notFound();
      await requireFilesFeature(tx, ctx.orgId);
      const record = await visibleSource(deps, tx, subject, file.sourceKind, file.sourceId, file);
      const refusal = deleteRefusal(subject, record, file, ctx.userId!, now);
      if (refusal === 'forbidden') apiFail(403, 'forbidden', 'Нет права на это действие');
      if (refusal) apiFail(403, refusal, FILE_MESSAGES[refusal]);
      await markFileDeleted(tx, id, version);
      await writeHistory(tx, {
        ...record.history(id),
        action: 'file_delete',
        changes: [{ field: 'file', from: file.name }],
      });
      return file.storageKey;
    });
    await dropObject(deps, key);
    return c.json({ id }, 200);
  };
}
