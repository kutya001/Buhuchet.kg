import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  adminFileTrash,
  adminFileTrashRow,
  adminOrgFileCategories,
  adminOrgUsage,
  adminStorageCheck,
  adminStorageCheckItem,
  adminStorageExtraDelete,
  adminStorageFileKey,
  adminStorageSummary,
  exportAdminStorageFiles,
  fileTrashForRestore,
  getFile,
  listAdminStorageFilesPage,
  listAdminStorageFileValues,
  orgUsage,
  restoreFileTrash,
  STORAGE_EXTRA_MIN_HOURS,
  takeRateLimit,
  withOrgContext,
  withUserContext,
  writeHistory,
  writePlatformHistory,
  type AdminFileTrashRow,
  type AdminStorageCheckRow,
  type AdminStorageFile as AdminStorageFileRecord,
  type FileTrashRestoreOutcome,
  type RateLimit,
  type StorageExtraDeleteOutcome,
} from '@buhuchet/db';
import {
  ageHours,
  bishkekDate,
  FILE_LINK_SECONDS,
  FILE_TRASH_MESSAGES,
  filePreviewKind,
  fileTrashRestorable,
  lastTwelveMonths,
  memoryPct,
  PLATFORM_ADMIN_NAME,
  SUBSCRIPTION_GB_MB,
  SUBSCRIPTION_MB_BYTES,
  type AccessSubject,
  type FileTrashProblem,
} from '@buhuchet/domain';
import {
  AdminExtraDelete,
  AdminOrgFiles,
  AdminStorageCheck,
  AdminStorageCheckParam,
  AdminStorageFileExportQuery,
  AdminStorageFileLinkQuery,
  AdminStorageFileList,
  AdminStorageFileParam,
  AdminStorageFileQuery,
  AdminStorageFileValuesQuery,
  AdminStorageSummary,
  AdminTrashList,
  AdminTrashQuery,
  AdminTrashRestore,
  ApiError,
  FileLink,
  ListValues,
  Uuid,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import { z } from 'zod';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { sourceOf } from '../files/files';
import { serverTexts } from '../l10n/texts';

/*
 * Админка → «Файлы» и вкладка «Файлы» карточки организации (доработки 20.11.2026, пакет 2, блоки 3–5;
 * прототип v154 admin/admin-files.js, modules/file-trash.js; этап 1, П4–П6, поток И). Всё — только
 * администратору платформы: «Хранилище» (плашки, по месяцам, по организациям), «Все файлы» (общий
 * список), просмотр и скачивание любого файла подписанной ссылкой на 15 минут, «Ждут удаления» с
 * «Вернуть», «Проверка хранилища» с «Удалить» лишнего файла. Администратор файлы организаций только
 * смотрит и скачивает (решение заказчика 20.11.2026): не переименовывает, не заменяет и не удаляет —
 * кроме лишнего файла хранилища. Ключей хранилища в ответах нет; путь — только у лишнего файла сверки.
 */

const error = { 'application/json': { schema: ApiError } };
const json = <T>(schema: T) => ({ 'application/json': { schema } });
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;

type Texts = (key: string) => string;

const adminOf = (c: Context<AppEnv>) => c.get('session')!.userId;

/** Открытий файлов одним администратором — не больше стольких за час (листание окна просмотра — тоже). */
export const ADMIN_FILE_OPEN_RATE_LIMIT: RateLimit = {
  kind: 'admin_file_open',
  max: 300,
  windowSeconds: 3600,
};

/** «Загрузил» не сотрудником: сотрудник без ФИО — администратор платформы. */
function byText(t: Texts, o: { byUser: string | null; byName: string | null; via: string | null }) {
  if (o.byUser) return o.byName ?? PLATFORM_ADMIN_NAME;
  if (o.via === 'telegram') return t('afiles.by.telegram');
  if (o.via) return t('afiles.by.page');
  return t('afiles.by.system');
}

function fileOut(r: AdminStorageFileRecord, now: Date) {
  return {
    ...r,
    at: r.at.toISOString(),
    eraseAt: r.eraseAt ? r.eraseAt.toISOString() : null,
    restorable:
      r.kind === 'trash' &&
      r.why !== null &&
      fileTrashRestorable(r.why) &&
      r.eraseAt !== null &&
      r.eraseAt > now,
  };
}

// ───── «Хранилище» ─────

export const storageSummaryRoute = createRoute({
  method: 'get',
  path: '/admin/files/summary',
  tags: ['admin'],
  summary: '«Хранилище»: плашки, загружено по месяцам и память по организациям',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Сколько и какого объёма файлов по категориям',
      content: json(AdminStorageSummary),
    },
    ...denied,
  },
});

/** «Хранилище» (прототип `renderAFStore`): «Занято всего» — всё, что лежит, с платформой и «Ждут удаления». */
export function storageSummaryHandler(
  deps: ApiDeps,
): RouteHandler<typeof storageSummaryRoute, AppEnv> {
  return async (c) => {
    c.header('Cache-Control', 'no-store');
    const today = bishkekDate(deps.clock.now());
    const months = lastTwelveMonths(today);
    const { s, usage } = await withUserContext(deps.db, adminOf(c), async (tx) => ({
      s: await adminStorageSummary(tx, `${months[0]}-01`),
      usage: await adminOrgUsage(tx, today, { bytes: false }),
    }));
    const limits = new Map(usage.map((u) => [u.orgId, u.bytesLimit]));
    const parts = [s.org, s.sent, s.lead, s.rcpt, s.platform, s.trash];
    const byMonth = new Map(s.months.map((m) => [m.month, m.bytes]));
    return c.json(
      {
        total: {
          n: parts.reduce((a, p) => a + p.n, 0),
          bytes: parts.reduce((a, p) => a + p.bytes, 0),
        },
        org: s.org,
        sent: s.sent,
        lead: s.lead,
        platform: s.platform,
        rcpt: s.rcpt,
        trash: s.trash,
        diff: s.diff,
        checkedAt: s.checkedAt ? s.checkedAt.toISOString() : null,
        months: months.map((month) => ({ month, bytes: byMonth.get(month) ?? 0 })),
        orgs: s.orgs.map((o) => {
          const limitBytes = limits.get(o.orgId) ?? null;
          return {
            orgId: o.orgId,
            name: o.name,
            n: o.n,
            bytes: o.bytes,
            limitBytes,
            pct: memoryPct(o.bytes, limitBytes),
            last: o.last,
          };
        }),
      },
      200,
    );
  };
}

// ───── «Все файлы» ─────

export const storageFilesRoute = createRoute({
  method: 'get',
  path: '/admin/files',
  tags: ['admin'],
  summary: '«Все файлы»: страница списка (`org` — только файлы организации)',
  middleware: [requirePlatformAdmin] as const,
  request: { query: AdminStorageFileQuery },
  responses: {
    200: {
      description: 'Файлы всех организаций, заявок и ждущие стирания',
      content: json(AdminStorageFileList),
    },
    ...listQueryResponses,
    ...denied,
  },
});

export function storageFilesHandler(deps: ApiDeps): RouteHandler<typeof storageFilesRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const t = await serverTexts(deps);
    const now = deps.clock.now();
    const page = await withUserContext(deps.db, adminOf(c), (tx) =>
      listAdminStorageFilesPage(tx, query, t, params.org),
    );
    return c.json(
      {
        items: page.rows.map((r) => fileOut(r, now)),
        total: page.total,
        page: page.page,
        size: page.size,
        totals: page.totals,
        ...(page.groups ? { groups: page.groups, rowGroups: page.rowGroups } : {}),
      },
      200,
    );
  };
}

export const storageFileValuesRoute = createRoute({
  method: 'get',
  path: '/admin/files/values',
  tags: ['admin'],
  summary: '«Все файлы»: значения столбца для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { query: AdminStorageFileValuesQuery },
  responses: {
    200: { description: 'Значения столбца с подписью и числом файлов', content: json(ListValues) },
    ...listQueryResponses,
    ...denied,
  },
});

export function storageFileValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof storageFileValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q, org } = c.req.valid('query');
    const t = await serverTexts(deps);
    const values = await withUserContext(deps.db, adminOf(c), (tx) =>
      listAdminStorageFileValues(tx, col, t, q, org),
    );
    return c.json(values, 200);
  };
}

export const storageFileExportRoute = createRoute({
  method: 'get',
  path: '/admin/files/export',
  tags: ['admin'],
  summary: '«Все файлы» в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { query: AdminStorageFileExportQuery },
  responses: {
    200: { description: 'Файл Excel с файлами под поиском и фильтрами', content: xlsxContent },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

export function storageFileExportHandler(
  deps: ApiDeps,
): RouteHandler<typeof storageFileExportRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const userId = adminOf(c);
    return withExportSlot(deps, userId, async () => {
      const t = await serverTexts(deps);
      const result = await withUserContext(
        deps.db,
        userId,
        (tx) => exportAdminStorageFiles(tx, query, keys, t, params.org),
        'export',
      );
      return xlsxResponse(c, {
        title: `${t('nav.afiles')} — ${t('tab.afiles.all')}`,
        today: deps.clock.now(),
        columns: result.columns,
        rows: result.rows,
        more: result.more,
        total: result.total,
        t,
      });
    });
  };
}

// ───── Просмотр и скачивание ─────

export const storageFileLinkRoute = createRoute({
  method: 'get',
  path: '/admin/files/{kind}/{id}/link',
  tags: ['admin'],
  summary: 'Ссылка на любой файл на 15 минут: окно просмотра и «Скачать»',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminStorageFileParam, query: AdminStorageFileLinkQuery },
  responses: {
    200: { description: 'Подписанная ссылка на файл в хранилище', content: json(FileLink) },
    400: {
      description: 'В окне открывается только картинка и PDF (без `download=1`)',
      content: error,
    },
    ...denied,
    404: { description: 'Файла нет или он уже стёрт', content: error },
    429: { description: 'Больше 300 открытий файлов за час', content: error },
  },
});

/**
 * Ссылка на файл (прототип `afOpen`, `afDl`): то же окно просмотра, что у организаций. Отдельной записи о
 * просмотре и скачивании нет (решение заказчика 20.11.2026), поэтому чтение защищено как чтение карточки:
 * запрос только со своего сайта (`Sec-Fetch-Site`) и предел частоты на администратора. Без `download`
 * — только картинка и PDF с проверенным типом, остальное — вложением.
 */
export function storageFileLinkHandler(
  deps: ApiDeps,
): RouteHandler<typeof storageFileLinkRoute, AppEnv> {
  return async (c) => {
    c.header('Cache-Control', 'no-store');
    const site = c.req.header('sec-fetch-site');
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      apiFail(403, 'origin_mismatch', 'Запрос с другого сайта отклонён');
    }
    const { kind, id } = c.req.valid('param');
    const download = c.req.valid('query').download === '1';
    const userId = adminOf(c);
    const slot = await takeRateLimit(deps.db, ADMIN_FILE_OPEN_RATE_LIMIT, userId);
    if (!slot.ok)
      apiFail(429, 'file_open_limit', 'Слишком много открытых файлов. Попробуйте через час');
    const file = await withUserContext(deps.db, userId, (tx) => adminStorageFileKey(tx, kind, id));
    if (!file) apiFail(404, 'not_found', 'Файл не найден');
    const contentType = file!.contentType ?? 'application/octet-stream';
    if (!download && !filePreviewKind(contentType)) {
      apiFail(400, 'file_no_preview', 'Этот файл не открывается в окне: скачайте его');
    }
    const expiresAt = new Date(Date.now() + FILE_LINK_SECONDS * 1000);
    const url = await deps.storage.signedDownloadUrl(file!.storageKey, {
      expiresInSeconds: FILE_LINK_SECONDS,
      fileName: file!.name,
      ...(download ? {} : { inline: { contentType } }),
    });
    return c.json({ url, expiresAt: expiresAt.toISOString() }, 200);
  };
}

// ───── «Ждут удаления» и «Вернуть» ─────

function trashOut(t: Texts, r: AdminFileTrashRow, now: Date) {
  return {
    id: r.id,
    orgId: r.orgId,
    orgName: r.orgName,
    why: r.why,
    cpName: r.cpName,
    name: r.name,
    sizeBytes: Number(r.sizeBytes),
    src: r.source,
    byText: r.deletedBy ? (r.deletedByName ?? PLATFORM_ADMIN_NAME) : t('afiles.by.system'),
    deletedAt: r.deletedAt.toISOString(),
    eraseAt: r.eraseAt.toISOString(),
    restorable: fileTrashRestorable(r.why) && r.eraseAt > now,
    attempts: r.attempts,
  };
}

export const trashListRoute = createRoute({
  method: 'get',
  path: '/admin/files/trash',
  tags: ['admin'],
  summary: '«Ждут удаления»: удалённые файлы с датой стирания',
  middleware: [requirePlatformAdmin] as const,
  request: { query: AdminTrashQuery },
  responses: {
    200: {
      description: 'Файлы, которые ещё не стёрты и не возвращены',
      content: json(AdminTrashList),
    },
    400: { description: 'Номер организации неверного вида', content: error },
    ...denied,
  },
});

export function trashListHandler(deps: ApiDeps): RouteHandler<typeof trashListRoute, AppEnv> {
  return async (c) => {
    c.header('Cache-Control', 'no-store');
    const { org } = c.req.valid('query');
    const t = await serverTexts(deps);
    const now = deps.clock.now();
    const { rows, total } = await withUserContext(deps.db, adminOf(c), (tx) =>
      adminFileTrash(tx, org ? { orgId: org } : {}),
    );
    return c.json({ items: rows.map((r) => trashOut(t, r, now)), total }, 200);
  };
}

export const trashRestoreRoute = createRoute({
  method: 'post',
  path: '/admin/files/trash/{id}/restore',
  tags: ['admin'],
  summary: '«Вернуть» удалённый файл или лишний файл хранилища',
  middleware: [requirePlatformAdmin] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: { description: 'Файл снова там, где был', content: json(AdminTrashRestore) },
    400: { description: 'Номер неверного вида', content: error },
    ...denied,
    404: { description: 'Строки «Ждут удаления» нет', content: error },
    409: {
      description:
        'Вернуть нельзя: прежняя версия после замены (`file_back_rep`), непринятый от контрагента (`file_back_auto`), уже стёрт или возвращён (`file_back_gone`), запись файла удалена (`file_back_record`)',
      content: error,
    },
  },
});

const back = (code: FileTrashProblem): never => apiFail(409, code, FILE_TRASH_MESSAGES[code]);

/** Ответ функции базы «Вернуть» после проверок сервера — ошибкой; `ok` — ничего. */
function restoreOutcome(outcome: FileTrashRestoreOutcome): void {
  if (outcome === 'ok') return;
  if (outcome === 'denied') apiFail(403, 'forbidden', 'Нет права на это действие');
  if (outcome === 'missing') apiFail(404, 'not_found', 'Файл не найден');
  if (outcome === 'kind') back('file_back_rep');
  back('file_back_gone');
}

/**
 * Кто «видит» запись, чтобы проверить, жива ли она, и найти, куда писать историю: все права в
 * организации файла (RLS транзакции). Данные записи отсюда не отдаются.
 */
const restoreSubject = (userId: string): AccessSubject => ({
  employeeId: userId,
  isOwner: true,
  permissions: new Set(),
  scopes: {},
});

/**
 * «Вернуть» (доработки 20.11.2026, пакет 2, блок 5, пункт 4; прототип `ftRestore`, `afBackDlg`): только
 * удалённый сотрудником (`del`) и лишний файл хранилища (`extra`), пока срок не прошёл. Удалённый файл —
 * в транзакции его организации от имени администратора: сервер ещё раз проверяет, что запись файла жива
 * и контрагент тот же, а каждую прежнюю ссылку — что запись жива и того же контрагента (остальные не
 * ставятся); база под блокировкой строки сверяет срок и пишет. История — у записи файла (и записей
 * ссылок) и платформы, в той же транзакции.
 */
export function trashRestoreHandler(deps: ApiDeps): RouteHandler<typeof trashRestoreRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const userId = adminOf(c);
    const row = await withUserContext(deps.db, userId, (tx) => adminFileTrashRow(tx, id));
    if (!row) apiFail(404, 'not_found', 'Файл не найден');
    if (row!.why === 'rep') back('file_back_rep');
    if (row!.why === 'auto') back('file_back_auto');
    if (row!.why === 'extra') {
      await withUserContext(deps.db, userId, async (tx) => {
        restoreOutcome(await restoreFileTrash(tx, id, []));
        await writePlatformHistory(tx, {
          entity: 'storage_file',
          entityId: id,
          action: 'file_restore',
          changes: [
            { field: 'file', to: row!.name },
            { field: 'extra', to: true },
          ],
        });
      });
      return c.json({ id, restored: true as const }, 200);
    }
    if (!row!.orgId) apiFail(404, 'not_found', 'Файл не найден');
    await withOrgContext(deps.db, { orgId: row!.orgId!, userId }, async (tx) => {
      const trash = await fileTrashForRestore(tx, id);
      if (!trash) apiFail(404, 'not_found', 'Файл не найден');
      if (!trash!.live || !trash!.fileId) back('file_back_gone');
      const file = await getFile(tx, trash!.fileId!, { lock: true });
      if (!file || file.state !== 'deleted') back('file_back_gone');
      // Контрагент файла удалён (ключ файла стал пустым) — вернуть некуда.
      if (trash!.contractorId !== null && file!.contractorId !== trash!.contractorId) {
        back('file_back_record');
      }
      const subject = restoreSubject(userId);
      const record = await sourceOf(deps, file!.sourceKind)?.resolve(tx, subject, file!.sourceId, {
        contractorId: file!.contractorId,
      });
      if (!record) back('file_back_record');
      const links: { kind: string; id: string }[] = [];
      const linked = [];
      for (const link of trash!.links) {
        if (!file!.contractorId) break;
        const target = await sourceOf(deps, link.sourceKind)?.resolve(tx, subject, link.sourceId);
        if (!target || target.contractor?.id !== file!.contractorId) continue;
        links.push({ kind: link.sourceKind, id: link.sourceId });
        linked.push(target);
      }
      restoreOutcome(await restoreFileTrash(tx, id, links));
      await writeHistory(tx, {
        ...record!.history(file!.id),
        action: 'file_restore',
        changes: [{ field: 'file', to: file!.name }],
      });
      for (const target of linked) {
        await writeHistory(tx, {
          ...target.history(file!.id),
          action: 'file_restore',
          changes: [
            { field: 'file', to: file!.name },
            { field: 'linked', to: true },
          ],
        });
      }
      await writePlatformHistory(tx, {
        entity: 'storage_file',
        entityId: id,
        action: 'file_restore',
        changes: [
          { field: 'file', to: file!.name },
          { field: 'org', to: row!.orgName ?? null },
        ],
      });
    });
    return c.json({ id, restored: true as const }, 200);
  };
}

// ───── «Проверка хранилища» ─────

function checkOut(t: Texts, r: AdminStorageCheckRow, now: Date) {
  const extra = r.kind === 'extra';
  const age = extra && r.at ? ageHours(r.at, now) : null;
  return {
    id: r.id,
    kind: r.kind,
    path: extra ? r.path : null,
    orgId: r.orgId,
    orgName: r.orgName,
    name: r.name,
    cpName: r.cpName,
    src: r.src,
    byText: extra ? null : byText(t, r),
    sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes),
    at: r.at ? r.at.toISOString() : null,
    attempts: r.attempts,
    lastError: r.lastError,
    deletable: age !== null && age >= STORAGE_EXTRA_MIN_HOURS,
    ageHours: age,
  };
}

export const storageCheckRoute = createRoute({
  method: 'get',
  path: '/admin/files/check',
  tags: ['admin'],
  summary: '«Проверка хранилища»: четыре списка расхождений последней сверки',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: { description: 'Расхождения базы и хранилища', content: json(AdminStorageCheck) },
    ...denied,
  },
});

/** «Проверка хранилища» (прототип `renderAFCheck`): сама ничего не удаляет; ждущие стирания — не расхождение. */
export function storageCheckHandler(deps: ApiDeps): RouteHandler<typeof storageCheckRoute, AppEnv> {
  return async (c) => {
    c.header('Cache-Control', 'no-store');
    const t = await serverTexts(deps);
    const now = deps.clock.now();
    const { lists, checkedAt } = await withUserContext(deps.db, adminOf(c), (tx) =>
      adminStorageCheck(tx),
    );
    const list = (k: keyof typeof lists) => ({
      items: lists[k].rows.map((r) => checkOut(t, r, now)),
      total: lists[k].total,
    });
    return c.json(
      {
        checkedAt: checkedAt ? checkedAt.toISOString() : null,
        missing: list('missing'),
        extra: list('extra'),
        stuck: list('stuck'),
        failed: list('failed'),
      },
      200,
    );
  };
}

export const extraDeleteRoute = createRoute({
  method: 'post',
  path: '/admin/files/check/{id}/delete',
  tags: ['admin'],
  summary: '«Удалить» лишний файл хранилища: сутки ждёт стирания в «Ждут удаления»',
  middleware: [requirePlatformAdmin] as const,
  request: { params: AdminStorageCheckParam },
  responses: {
    200: {
      description: 'Строка «Ждут удаления» и когда файл сотрётся',
      content: json(AdminExtraDelete),
    },
    400: { description: 'Номер неверного вида', content: error },
    ...denied,
    404: {
      description: 'Файла уже нет в списке расхождений (`storage_extra_missing`)',
      content: error,
    },
    409: {
      description:
        'Удалить нельзя: файл младше суток (`storage_extra_young`), у файла появилась запись в базе (`storage_extra_in_use`, строка убрана из расхождений), уже ждёт стирания (`storage_extra_waiting`), не файл организации или заявки (`storage_extra_platform`)',
      content: error,
    },
  },
});

/**
 * «Удалить» лишний файл (решение заказчика 20.11.2026, вопрос 7 плана; прототип `afExtraDel`): по одному,
 * только старше суток. Перед удалением база ещё раз смотрит, не появилась ли у ключа запись: появилась —
 * строка уходит из расхождений, а удаление отменяется (и это записывается, как в прототипе). Удалённый
 * файл сутки ждёт стирания и его можно «Вернуть». Отказ «появилась запись» отвечается после записи.
 */
export function extraDeleteHandler(deps: ApiDeps): RouteHandler<typeof extraDeleteRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const result = await withUserContext(deps.db, adminOf(c), async (tx) => {
      const item = await adminStorageCheckItem(tx, id);
      const done = await adminStorageExtraDelete(tx, id);
      if (item && (done.outcome === 'ok' || done.outcome === 'in_use')) {
        await writePlatformHistory(tx, {
          entity: 'storage_file',
          entityId: done.trashId ?? String(id),
          action: 'storage_delete',
          changes: [
            { field: 'path', to: item.path },
            { field: 'size', to: item.sizeBytes === null ? null : Number(item.sizeBytes) },
            ...(done.outcome === 'in_use' ? [{ field: 'cancelled', to: true }] : []),
          ],
        });
      }
      const [trash] = done.trashId ? [await adminFileTrashRow(tx, done.trashId)] : [null];
      return { outcome: done.outcome, trashId: done.trashId, eraseAt: trash?.eraseAt ?? null };
    });
    const outcome: StorageExtraDeleteOutcome = result.outcome;
    if (outcome === 'ok' && result.trashId && result.eraseAt) {
      return c.json({ trashId: result.trashId, eraseAt: result.eraseAt.toISOString() }, 200);
    }
    if (outcome === 'denied') apiFail(403, 'forbidden', 'Нет права на это действие');
    if (outcome === 'young')
      apiFail(409, 'storage_extra_young', FILE_TRASH_MESSAGES.storage_extra_young);
    if (outcome === 'in_use')
      apiFail(409, 'storage_extra_in_use', FILE_TRASH_MESSAGES.storage_extra_in_use);
    if (outcome === 'waiting')
      apiFail(409, 'storage_extra_waiting', FILE_TRASH_MESSAGES.storage_extra_waiting);
    if (outcome === 'platform')
      apiFail(409, 'storage_extra_platform', FILE_TRASH_MESSAGES.storage_extra_platform);
    return apiFail(404, 'storage_extra_missing', FILE_TRASH_MESSAGES.storage_extra_missing);
  };
}

// ───── Вкладка «Файлы» карточки организации ─────

export const orgFilesRoute = createRoute({
  method: 'get',
  path: '/admin/organizations/{id}/files',
  tags: ['admin'],
  summary: 'Вкладка «Файлы» карточки организации: память и «Объём по категориям»',
  middleware: [requirePlatformAdmin] as const,
  request: { params: z.object({ id: Uuid }) },
  responses: {
    200: { description: 'Память организации и объём по источникам', content: json(AdminOrgFiles) },
    400: { description: 'Номер организации неверного вида', content: error },
    ...denied,
    404: { description: 'Организации нет', content: error },
  },
});

/**
 * Память и категории (прототип `afMemBar`, `ocFilesGrids`): занято — то же число, что у владельца на
 * экране «Подписка» (`app.org_usage`), «В цену входит» — предел без купленного сверх. Список файлов
 * вкладки — «Все файлы» с `org` (без столбца «Организация»).
 */
export function orgFilesHandler(deps: ApiDeps): RouteHandler<typeof orgFilesRoute, AppEnv> {
  return async (c) => {
    c.header('Cache-Control', 'no-store');
    const { id } = c.req.valid('param');
    const today = bishkekDate(deps.clock.now());
    const data = await withOrgContext(deps.db, { orgId: id, userId: adminOf(c) }, async (tx) => {
      const usage = await orgUsage(tx, today);
      if (!usage) return null;
      return { usage, categories: await adminOrgFileCategories(tx, id) };
    });
    if (!data) apiFail(404, 'not_found', 'Организация не найдена');
    const { usage, categories } = data!;
    const usedBytes = usage.bytesUsed ?? 0;
    const limitBytes = usage.bytesLimit;
    const extraGb = limitBytes === null ? null : (usage.extraGb ?? 0);
    return c.json(
      {
        usedBytes,
        limitBytes,
        pct: memoryPct(usedBytes, limitBytes),
        includedBytes:
          limitBytes === null
            ? null
            : Math.max(0, limitBytes - (extraGb ?? 0) * SUBSCRIPTION_GB_MB * SUBSCRIPTION_MB_BYTES),
        extraGb,
        categories,
      },
      200,
    );
  };
}
