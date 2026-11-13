import { randomUUID } from 'node:crypto';
import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import { orgFileKey } from '@buhuchet/adapters';
import {
  changeFile,
  dropPendingFile,
  getFile,
  takeRateLimit,
  insertPendingFile,
  listSourceFiles,
  markFileDeleted,
  markFileReady,
  orgMenuSettings,
  setFilePageHidden,
  withOrgContext,
  writeHistory,
  type FileRecord,
  type RateLimit,
  type Tx,
} from '@buhuchet/db';
import {
  canSeeContractor,
  cleanFileNote,
  FILE_LINK_SECONDS,
  FILE_MAX_BYTES,
  FILE_MESSAGES,
  FILE_UPLOAD_LINK_SECONDS,
  FILE_UPLOADS_PER_HOUR,
  fileContentType,
  fileDeleteRefusal,
  fileNameParts,
  fileRenameProblem,
  fileUploadProblem,
  hasPermission,
  PAGE_MESSAGES,
  pageFileApplies,
  RecordChangedError,
  type AccessSubject,
  type Feature,
} from '@buhuchet/domain';
import {
  ApiError,
  FileEdit,
  FileIdParam,
  FileItem,
  FileLink,
  FileList,
  FilePage,
  FilePageInput,
  FileReplaceStart,
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
 * модуле; он же меняет название и примечание файла (прототип v95, «Изменить файл»), а заменяет файл
 * тот, кто может ещё и удалить его; удаляет свой файл в течение суток или любой — с правом «Удалять
 * файлы». Функция учётной
 * политики «Файлы в карточках» выключена — файлов нет совсем. Сам файл идёт мимо API: браузер кладёт
 * его в хранилище по подписанной ссылке, API проверяет размер и делает файл видимым.
 */

export const error = { 'application/json': { schema: ApiError } };

const notFound = (): never => apiFail(404, 'not_found', 'Файл не найден');

/** Раздел ключа хранилища: `org/<org_id>/files/<id>` (ограничение files_key_check в базе). */
export const FILES_SECTION = 'files';

type FileSources = Readonly<Record<string, FileSource>>;

/** Источник файлов по виду: только свои ключи реестра (`constructor`, `__proto__` — не источники). */
export function sourceOf(deps: ApiDeps, kind: string): FileSource | undefined {
  const sources: FileSources = deps.fileSources ?? FILE_SOURCES;
  return Object.hasOwn(sources, kind) ? sources[kind] : undefined;
}

/** Начатые загрузки пользователя за час (незаконченные лежат в хранилище сутки до очистки). */
export const UPLOAD_RATE_LIMIT: RateLimit = {
  kind: 'file_upload',
  max: FILE_UPLOADS_PER_HOUR,
  windowSeconds: 3600,
};

export function subjectOf(c: Context<AppEnv>): AccessSubject {
  return c.get('access')!.subject;
}

/** Функция «Файлы в карточках» выключена — 403 `files_off`; ответ — функции учётной политики. */
export async function requireFilesFeature(
  tx: Tx,
  orgId: string,
): Promise<Readonly<Record<Feature, boolean>>> {
  const { features } = await orgMenuSettings(tx, orgId);
  if (!features.files) apiFail(403, 'files_off', FILE_MESSAGES.files_off);
  return features;
}

/**
 * Показ файла на странице контрагента (решение заказчика 06.11.2026, прототип v74 `pgFileOk`,
 * `pgFileAct`): у файла контрагента не задачи при включённой «Странице контрагента по ссылке»;
 * менять — право «Управлять страницей контрагента» в его области (группа «Контрагенты»).
 */
export function filePageOf(
  file: { sourceKind: string; contractorId: string | null; pageHidden: boolean },
  contractor: { id: string; responsibleEmployeeId: string | null } | null,
  subject: AccessSubject,
  cppage: boolean,
): FilePage | null {
  if (!cppage || !contractor || !pageFileApplies(file)) return null;
  return {
    hidden: file.pageHidden,
    canChange: hasPermission(subject, 'cpPage') && canSeeContractor(subject, 'cps', contractor),
  };
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

/** Файл блока «Файлы» для ответа: можно ли удалить, изменить и заменить — этому сотруднику сейчас. */
function itemBody(
  file: FileRecord,
  record: FileSourceRecord,
  subject: AccessSubject,
  userId: string,
  now: Date,
  cppage: boolean,
): FileItemBody {
  const canDelete = deleteRefusal(subject, record, file, userId, now) === null;
  const canEdit = canUpload(subject, record);
  return {
    id: file.id,
    name: file.name,
    contentType: file.contentType,
    size: file.sizeBytes,
    note: file.note,
    uploadedBy: file.uploadedBy,
    uploadedAt: file.createdAt.toISOString(),
    canDelete,
    canEdit,
    canReplace: canEdit && canDelete,
    page: filePageOf(file, record.contractor, subject, cppage),
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
      const features = await requireFilesFeature(tx, ctx.orgId);
      const record = await visibleSource(deps, tx, subject, kind, id ?? null);
      const items = await listSourceFiles(tx, kind, id ?? null);
      return {
        items: items.map((f) => itemBody(f, record, subject, ctx.userId!, now, features.cppage)),
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
      description:
        'Файл больше 20 МБ, такой тип не загружается, неверное имя; файлы источника, который прикрепляет их своим действием',
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
    const { source, name: rawName, size, contractorId = null, note, page } = c.req.valid('json');
    const problem = fileUploadProblem({ name: rawName, size });
    if (problem) apiFail(400, problem, FILE_MESSAGES[problem]);
    const name = rawName.trim();
    if (sourceOf(deps, source.kind)?.ownUpload) {
      apiFail(400, 'validation_failed', 'Такие файлы прикрепляются только своим действием', {
        field: 'source',
      });
    }
    const contentType = fileContentType(name);
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const id = randomUUID();
    const storageKey = orgFileKey(ctx.orgId, FILES_SECTION, id);
    // Предел — до транзакции и на `db`: проверка держит блокировку пользователя до своего конца.
    const slot = await takeRateLimit(deps.db, UPLOAD_RATE_LIMIT, ctx.userId!);
    if (!slot.ok) apiFail(429, 'file_upload_limit', FILE_MESSAGES.file_upload_limit);
    await withOrgContext(deps.db, ctx, async (tx) => {
      const features = await requireFilesFeature(tx, ctx.orgId);
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
        note: cleanFileNote(note ?? '') || null,
        // Галочка «Показывать контрагенту на его странице» снята (только при «Странице контрагента»).
        pageHidden: page === false && features.cppage && record.contractor !== null,
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
 * Файл начатой загрузки дошёл до хранилища и он тот, что заявлен: размер и тип подписаны в ссылке, но
 * проверяются ещё раз — не всякое хранилище S3 сверяет подпись типа одинаково. Не тот файл удаляется
 * вместе с записью загрузки.
 */
async function checkStored(
  deps: ApiDeps,
  ctx: ReturnType<typeof orgContextOf>,
  pending: FileRecord,
): Promise<void> {
  const stored = await deps.storage.stat(pending.storageKey);
  if (!stored) apiFail(409, 'file_not_uploaded', FILE_MESSAGES.file_not_uploaded);
  if (
    stored.size !== pending.sizeBytes ||
    stored.size > FILE_MAX_BYTES ||
    stored.contentType !== pending.contentType
  ) {
    await withOrgContext(deps.db, ctx, (tx) => dropPendingFile(tx, pending.id));
    await dropObject(deps, pending.storageKey);
    if (stored.size > FILE_MAX_BYTES) apiFail(400, 'file_too_large', FILE_MESSAGES.file_too_large);
    apiFail(409, 'file_not_uploaded', FILE_MESSAGES.file_not_uploaded);
  }
}

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
    // Загрузка-замена файлом записи не становится: её заканчивает «Изменить файл» (`PATCH /files/{id}`).
    if (
      !pending ||
      pending.state !== 'pending' ||
      pending.createdBy !== ctx.userId ||
      pending.replacesId !== null
    ) {
      return notFound();
    }
    await checkStored(deps, ctx, pending);
    const now = realNow();
    const body = await withOrgContext(deps.db, ctx, async (tx) => {
      const file = await getFile(tx, id, { lock: true });
      if (!file || file.state !== 'pending') return notFound();
      const features = await requireFilesFeature(tx, ctx.orgId);
      const record = await visibleSource(deps, tx, subject, file.sourceKind, file.sourceId, file);
      if (!canUpload(subject, record)) apiFail(403, 'forbidden', 'Нет права на это действие');
      await markFileReady(tx, id);
      await writeHistory(tx, {
        ...record.history(id),
        action: 'file_attach',
        // Примечание — в той же записи истории (прототип v95: «Прикреплены файлы: …. Примечание: …»).
        changes: [
          { field: 'file', to: file.name },
          ...(file.note ? [{ field: 'note', to: file.note }] : []),
        ],
      });
      // Загружен скрытым со страницы контрагента — и это в истории (прототип v74 uploadDlg → pgFileSet).
      if (file.pageHidden) {
        await writeHistory(tx, {
          ...record.history(id),
          action: 'file_hide',
          changes: [{ field: 'file', to: file.name }],
        });
      }
      const ready = (await getFile(tx, id))!;
      return itemBody(ready, record, subject, ctx.userId!, now, features.cppage);
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

export const filePageRoute = createRoute({
  method: 'post',
  path: '/files/{id}/page',
  tags: ['files'],
  summary: 'Скрыть файл со страницы контрагента или снова показать на ней',
  middleware: [requirePermission('filesView'), requirePermission('cpPage')] as const,
  request: {
    params: FileIdParam,
    body: { required: true, content: { 'application/json': { schema: FilePageInput } } },
  },
  responses: {
    200: {
      description:
        'Отметка файла (в истории записи — «Файл «…» скрыт со страницы контрагента» или «снова показывается на странице контрагента»; уже такая — без записи)',
      content: { 'application/json': { schema: FilePage } },
    },
    400: {
      description: 'Файл не контрагента или файл задачи — на страницу не попадает',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Нет права «Управлять страницей контрагента» или «Просматривать файлы», контрагент вне области; «Файлы в карточках» или «Страница контрагента по ссылке» выключены',
      content: error,
    },
    404: { description: 'Файла нет, он удалён или вне области', content: error },
  },
});

/**
 * «Скрыть со страницы контрагента» / «Показать на странице контрагента» (решение заказчика 06.11.2026,
 * прототип v74 `pgFileSet`; ТЗ «Файловый менеджер» → «Показ файла на странице контрагента»): из
 * Файлового менеджера, блока «Файлы» записи и вкладки «Файлы» карточки; право «Управлять страницей
 * контрагента» в области группы «Контрагенты»; смена пишется в историю записи файла.
 */
export function filePageHandler(deps: ApiDeps): RouteHandler<typeof filePageRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { hidden } = c.req.valid('json');
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const body = await withOrgContext(deps.db, ctx, async (tx) => {
      const file = await getFile(tx, id, { lock: true });
      if (!file || file.state !== 'ready') return notFound();
      const features = await requireFilesFeature(tx, ctx.orgId);
      if (!features.cppage) {
        apiFail(
          403,
          'cppage_off',
          'Функция «Страница контрагента по ссылке» выключена в учётной политике',
        );
      }
      const record = await visibleSource(deps, tx, subject, file.sourceKind, file.sourceId, file);
      const page = filePageOf(file, record.contractor, subject, true);
      if (!page) {
        apiFail(400, 'validation_failed', 'Этот файл не показывается на странице контрагента', {
          field: 'id',
        });
      }
      if (!page.canChange) apiFail(403, 'page_manage_right', PAGE_MESSAGES.page_manage_right);
      if (await setFilePageHidden(tx, id, hidden)) {
        await writeHistory(tx, {
          ...record.history(id),
          action: hidden ? 'file_hide' : 'file_show',
          changes: [{ field: 'file', to: file.name }],
        });
      }
      return { hidden, canChange: true };
    });
    return c.json(body, 200);
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

/** Одна строка названия: пробелы и переносы — одним пробелом (прототип v95 `fileEditDlg`). */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export const startReplaceRoute = createRoute({
  method: 'post',
  path: '/files/{id}/replacement',
  tags: ['files'],
  summary: 'Начать замену файла: ссылка на хранилище для нового файла на 2 минуты',
  middleware: [requirePermission('filesView'), requirePermission('filesUpload')] as const,
  request: {
    params: FileIdParam,
    body: { required: true, content: { 'application/json': { schema: FileReplaceStart } } },
  },
  responses: {
    201: {
      description:
        'Замена начата: куда и с какими заголовками положить новый файл; прежний остаётся на месте, пока замену не сохранит «Изменить файл»',
      content: { 'application/json': { schema: FileUploadTicket } },
    },
    400: { description: 'Файл больше 20 МБ, такой тип не загружается, неверное имя', content: error },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Нет права «Загружать файлы» или менять запись; заменить чужой файл без права «Удалять файлы», свой — позже суток; «Файлы в карточках» выключены',
      content: error,
    },
    404: { description: 'Файла нет, он удалён или вне области', content: error },
    429: { description: 'Больше 300 загрузок за час', content: error },
  },
});

/**
 * Начать замену файла (прототип v95 `fileEditDlg`, поле «Заменить файл»): проверить новый файл и права,
 * завести загрузку-замену «pending» этого файла и подписать ссылку на хранилище. Прежний файл виден и
 * скачивается, пока замену не сохранит `PATCH /files/{id}` с номером этой загрузки.
 */
export function startReplaceHandler(deps: ApiDeps): RouteHandler<typeof startReplaceRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { name: rawName, size } = c.req.valid('json');
    const problem = fileUploadProblem({ name: rawName, size });
    if (problem) apiFail(400, problem, FILE_MESSAGES[problem]);
    const name = rawName.trim();
    const contentType = fileContentType(name);
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const now = realNow();
    const uploadId = randomUUID();
    const storageKey = orgFileKey(ctx.orgId, FILES_SECTION, uploadId);
    const slot = await takeRateLimit(deps.db, UPLOAD_RATE_LIMIT, ctx.userId!);
    if (!slot.ok) apiFail(429, 'file_upload_limit', FILE_MESSAGES.file_upload_limit);
    await withOrgContext(deps.db, ctx, async (tx) => {
      const file = await getFile(tx, id);
      if (!file || file.state !== 'ready') return notFound();
      await requireFilesFeature(tx, ctx.orgId);
      const record = await visibleSource(deps, tx, subject, file.sourceKind, file.sourceId, file);
      if (!canUpload(subject, record)) apiFail(403, 'forbidden', 'Нет права на это действие');
      if (deleteRefusal(subject, record, file, ctx.userId!, now) !== null) {
        apiFail(403, 'file_replace_forbidden', FILE_MESSAGES.file_replace_forbidden);
      }
      await insertPendingFile(tx, {
        id: uploadId,
        sourceKind: file.sourceKind,
        sourceId: file.sourceId,
        contractorId: file.contractorId,
        name,
        contentType,
        sizeBytes: size,
        storageKey,
        replacesId: file.id,
      });
    });
    const expiresAt = new Date(Date.now() + FILE_UPLOAD_LINK_SECONDS * 1000);
    const upload = await deps.storage.signedUploadUrl(storageKey, {
      expiresInSeconds: FILE_UPLOAD_LINK_SECONDS,
      contentType,
      size,
    });
    return c.json(
      {
        id: uploadId,
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

export const editFileRoute = createRoute({
  method: 'patch',
  path: '/files/{id}',
  tags: ['files'],
  summary: 'Изменить файл записи: название, примечание, замена файла',
  middleware: [requirePermission('filesView'), requirePermission('filesUpload')] as const,
  request: {
    params: FileIdParam,
    body: { required: true, content: { 'application/json': { schema: FileEdit } } },
  },
  responses: {
    200: {
      description:
        'Файл после правки (в истории записи — что изменилось: название, примечание, замена; без изменений — без записи)',
      content: { 'application/json': { schema: FileItem } },
    },
    400: {
      description:
        'Название пустое, длиннее 255 знаков, со знаками \\ / : * ? " < > | или меняет расширение; новый файл больше 20 МБ',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Нет права «Загружать файлы» или менять запись; заменить чужой файл без права «Удалять файлы», свой — позже суток; «Файлы в карточках» выключены',
      content: error,
    },
    ...versionedSaveResponses,
  },
});

/**
 * «Изменить файл» (прототип v95 `fileEditDlg`): название (расширение остаётся прежним, при замене — от
 * нового файла), примечание и замена файла. Название и примечание меняет право «Загружать файлы» и
 * право менять запись; заменяет тот, кто может ещё и удалить файл: прежний файл при замене пропадает
 * из хранилища. Номер файла остаётся прежним — ссылки из «Истории статусов» ведут на новый файл. Что
 * изменилось — одной записью истории записи-источника.
 */
export function editFileHandler(deps: ApiDeps): RouteHandler<typeof editFileRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, name: rawName, note: rawNote, uploadId } = c.req.valid('json');
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const now = realNow();
    let upload: FileRecord | null = null;
    if (uploadId) {
      upload = await withOrgContext(deps.db, ctx, (tx) => getFile(tx, uploadId));
      // Чужая, законченная или начатая для другого файла загрузка — как несуществующая.
      if (
        !upload ||
        upload.state !== 'pending' ||
        upload.createdBy !== ctx.userId ||
        upload.replacesId !== id
      ) {
        return notFound();
      }
      await checkStored(deps, ctx, upload);
    }
    const { body, replacedKey } = await withOrgContext(deps.db, ctx, async (tx) => {
      const file = await getFile(tx, id, { lock: true });
      if (!file || file.state !== 'ready') return notFound();
      const features = await requireFilesFeature(tx, ctx.orgId);
      const record = await visibleSource(deps, tx, subject, file.sourceKind, file.sourceId, file);
      if (!canUpload(subject, record)) apiFail(403, 'forbidden', 'Нет права на это действие');
      if (upload && deleteRefusal(subject, record, file, ctx.userId!, now) !== null) {
        apiFail(403, 'file_replace_forbidden', FILE_MESSAGES.file_replace_forbidden);
      }
      if (file.version !== version) throw new RecordChangedError('file', id, file.version);
      // Расширение правка не меняет: прежнее, при замене — нового файла.
      const [, ext] = fileNameParts(upload ? upload.name : file.name);
      const name = oneLine(rawName);
      const base = name.endsWith(ext) ? name.slice(0, name.length - ext.length) : name;
      const problem = name.endsWith(ext) ? fileRenameProblem(base, ext) : 'file_name_invalid';
      if (problem) apiFail(400, problem, FILE_MESSAGES[problem], { field: 'name' });
      const note = cleanFileNote(rawNote) || null;
      const changes = [
        ...(name !== file.name ? [{ field: 'name', from: file.name, to: name }] : []),
        ...(note !== file.note ? [{ field: 'note', from: file.note, to: note }] : []),
        ...(upload ? [{ field: 'size', from: file.sizeBytes, to: upload.sizeBytes }] : []),
      ];
      // Ничего не изменилось — ни новой версии, ни записи в истории (как в прототипе).
      if (!changes.length) {
        return {
          body: itemBody(file, record, subject, ctx.userId!, now, features.cppage),
          replacedKey: null,
        };
      }
      const replacedKey = await changeFile(tx, id, version, {
        name,
        note,
        ...(upload ? { replacementId: upload.id } : {}),
      });
      await writeHistory(tx, {
        ...record.history(id),
        action: 'file_edit',
        changes: [{ field: 'file', to: name }, ...changes],
      });
      const saved = (await getFile(tx, id))!;
      return {
        body: itemBody(saved, record, subject, ctx.userId!, now, features.cppage),
        replacedKey,
      };
    });
    // Прежний файл стирается из хранилища после сохранения: ссылки на него больше нет.
    if (replacedKey) await dropObject(deps, replacedKey);
    return c.json(body, 200);
  };
}
