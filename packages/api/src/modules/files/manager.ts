import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  contractorScope,
  exportFiles,
  fileFormContractors,
  fileKindCounts,
  listFilesPage,
  listFileValues,
  orgMenuSettings,
  withOrgContext,
  type FileListOptions,
  type FileListParts,
  type FileManagerRow,
  type ListTexts,
  type Tx,
} from '@buhuchet/db';
import {
  fileDeleteRefusal,
  fileManagerPlates,
  filePreviewKind,
  hasPermission,
  scopeOf,
  type AccessSubject,
  type Feature,
  type FileSourceKind,
} from '@buhuchet/domain';
import {
  FileFormContractors,
  FileIdParam,
  FileLink,
  FileManagerList,
  FileManagerSummary,
  FileUsage,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  type FileManagerRow as FileManagerRowBody,
} from '@buhuchet/shared';
import type { SQL } from 'drizzle-orm';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import {
  downloadLink,
  error,
  fileReadResponses,
  realNow,
  requireFilesFeature,
  subjectOf,
  visibleFile,
} from './files';
import { FILE_SOURCES, type FileListSource } from './sources';

/*
 * «Файловый менеджер» (задача 2.29; ТЗ «Файловый менеджер»; прототип modules/files.js — `renderFiles`,
 * `openFile`, `uploadDlg`; modules/org.js — «Хранилище файлов»): все файлы организации в одном списке с
 * источником, плашки по видам источника, просмотр картинок и PDF в окне, контрагенты окна ручной
 * загрузки и занятый объём. Видит модуль право «Просматривать файлы» при включённых «Файлах в
 * карточках»; файлы — в области группы «Файловый менеджер» по контрагенту файла и только те, запись-
 * источник которых сотрудник видит в её модуле (`FileListSource.list`). Загрузка и удаление — методами
 * блока «Файлы» (files.ts).
 */

const noAuth = { description: 'Нет входа', content: error };
const offOrNoRight = {
  description: 'Нет права «Просматривать файлы» или «Файлы в карточках» выключены',
  content: error,
};

/** Область «Свои контрагенты» группы «Файловый менеджер» — условие над контрагентом файла. */
export function filesScopeOf(subject: AccessSubject): SQL | undefined {
  return contractorScope(scopeOf(subject, 'files') === 'own' ? subject.employeeId : null);
}

/** Виды источника, файлы которых сотрудник видит, и что у них в «Источнике». */
function listParts(
  deps: ApiDeps,
  subject: AccessSubject,
  features: Readonly<Record<Feature, boolean>>,
  t: ListTexts,
): FileListParts {
  // Подменённые в тестах источники без списка (`deps.fileSources`) в Файловом менеджере не видны.
  const sources = (deps.fileSources ?? FILE_SOURCES) as Readonly<
    Record<string, Partial<FileListSource>>
  >;
  const parts: Partial<Record<string, ReturnType<FileListSource['list']>>> = {};
  for (const [kind, source] of Object.entries(sources)) {
    const part = source.list?.({ subject, features, t }) ?? null;
    if (part) parts[kind] = part;
  }
  return parts as FileListParts;
}

/** Условия списка того, кто смотрит, — в транзакции организации: функции учётной политики. */
async function listOptions(
  deps: ApiDeps,
  tx: Tx,
  c: Context<AppEnv>,
  t: ListTexts,
): Promise<FileListOptions> {
  const subject = subjectOf(c);
  const { features } = await orgMenuSettings(tx, orgContextOf(c).orgId);
  return { t, scope: filesScopeOf(subject), parts: listParts(deps, subject, features, t) };
}

/** Строка для ответа: можно ли удалить — по праву «Удалять файлы» и суткам для своего файла. */
function rowBody(r: FileManagerRow, subject: AccessSubject, userId: string, now: Date) {
  const body: FileManagerRowBody = {
    id: r.id,
    name: r.name,
    contentType: r.contentType,
    size: r.sizeBytes,
    kind: r.sourceKind,
    sourceId: r.sourceId,
    source: r.source,
    sourceRef: r.sourceRef,
    contractor: r.contractor,
    note: r.note,
    uploadedBy: r.uploadedBy,
    uploadedAt: r.createdAt.toISOString(),
    canDelete:
      fileDeleteRefusal(
        { uploadedBy: r.createdBy, uploadedAt: r.createdAt },
        { userId, canDeleteAny: hasPermission(subject, 'filesDelete'), now },
      ) === null,
    audit: {
      createdAt: r.createdAt.toISOString(),
      createdBy: r.uploadedBy,
      updatedAt: r.updatedAt.toISOString(),
      updatedBy: r.uploadedBy,
    },
    version: r.version,
  };
  return body;
}

export const listManagerRoute = createRoute({
  method: 'get',
  path: '/files/manager',
  tags: ['files'],
  summary: 'Файловый менеджер: страница списка всех файлов',
  middleware: [requirePermission('filesView')] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description:
        'Видимые файлы организации с источником; сортировка, фильтры, поиск и группы — на сервере',
      content: { 'application/json': { schema: FileManagerList } },
    },
    ...listQueryResponses,
    401: noAuth,
    403: offOrNoRight,
  },
});

export function listManagerHandler(deps: ApiDeps): RouteHandler<typeof listManagerRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const t = await serverTexts(deps);
    const now = realNow();
    const page = await withOrgContext(deps.db, ctx, async (tx) => {
      await requireFilesFeature(tx, ctx.orgId);
      return listFilesPage(tx, query, await listOptions(deps, tx, c, t));
    });
    return c.json(
      {
        items: page.rows.map((r) => rowBody(r, subject, ctx.userId!, now)),
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

export const managerValuesRoute = createRoute({
  method: 'get',
  path: '/files/manager/values',
  tags: ['files'],
  summary: 'Значения столбца Файлового менеджера для фильтра',
  middleware: [requirePermission('filesView')] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом видимых файлов',
      content: { 'application/json': { schema: ListValues } },
    },
    ...listQueryResponses,
    401: noAuth,
    403: offOrNoRight,
  },
});

export function managerValuesHandler(
  deps: ApiDeps,
): RouteHandler<typeof managerValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const ctx = orgContextOf(c);
    const t = await serverTexts(deps);
    const values = await withOrgContext(deps.db, ctx, async (tx) => {
      await requireFilesFeature(tx, ctx.orgId);
      return listFileValues(tx, col, await listOptions(deps, tx, c, t), q);
    });
    return c.json(values, 200);
  };
}

export const exportManagerRoute = createRoute({
  method: 'get',
  path: '/files/manager/export',
  tags: ['files'],
  summary: 'Файловый менеджер в Excel',
  middleware: [requirePermission('filesView'), requirePermission('export')] as const,
  request: { query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со всеми видимыми файлами под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    401: noAuth,
    403: {
      description: 'Нет права «Выгружать в Excel» или «Просматривать файлы»; функция выключена',
      content: error,
    },
  },
});

export function exportManagerHandler(
  deps: ApiDeps,
): RouteHandler<typeof exportManagerRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const ctx = orgContextOf(c);
    const t = await serverTexts(deps);
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const result = await withOrgContext(deps.db, { ...ctx, kind: 'export' }, async (tx) => {
        await requireFilesFeature(tx, ctx.orgId);
        return exportFiles(tx, query, keys, await listOptions(deps, tx, c, t));
      });
      return xlsxResponse(c, {
        title: t('nav.files'),
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

export const managerSummaryRoute = createRoute({
  method: 'get',
  path: '/files/manager/summary',
  tags: ['files'],
  summary: 'Плашки Файлового менеджера и можно ли загружать вручную',
  middleware: [requirePermission('filesView')] as const,
  responses: {
    200: {
      description:
        'Виды источника с видимыми файлами по порядку модулей и «Загружено вручную» — последней',
      content: { 'application/json': { schema: FileManagerSummary } },
    },
    401: noAuth,
    403: offOrNoRight,
  },
});

export function managerSummaryHandler(
  deps: ApiDeps,
): RouteHandler<typeof managerSummaryRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    const t = await serverTexts(deps);
    const counts = await withOrgContext(deps.db, ctx, async (tx) => {
      await requireFilesFeature(tx, ctx.orgId);
      return fileKindCounts(tx, await listOptions(deps, tx, c, t));
    });
    return c.json(
      {
        plates: fileManagerPlates(counts.kinds as Partial<Record<FileSourceKind, number>>),
        canUpload: hasPermission(subjectOf(c), 'filesUpload'),
      },
      200,
    );
  };
}

export const formContractorsRoute = createRoute({
  method: 'get',
  path: '/files/manager/contractors',
  tags: ['files'],
  summary: 'Контрагенты окна «Загрузить файл»',
  middleware: [requirePermission('filesUpload')] as const,
  responses: {
    200: {
      description: 'Контрагенты не в архиве в области группы «Файловый менеджер», по названию',
      content: { 'application/json': { schema: FileFormContractors } },
    },
    401: noAuth,
    403: {
      description: 'Нет права «Загружать файлы» или «Файлы в карточках» выключены',
      content: error,
    },
  },
});

export function formContractorsHandler(
  deps: ApiDeps,
): RouteHandler<typeof formContractorsRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    const items = await withOrgContext(deps.db, ctx, async (tx) => {
      await requireFilesFeature(tx, ctx.orgId);
      return fileFormContractors(tx, filesScopeOf(subjectOf(c)));
    });
    return c.json({ items }, 200);
  };
}

export const fileUsageRoute = createRoute({
  method: 'get',
  path: '/files/usage',
  tags: ['files'],
  summary: 'Хранилище файлов: занятый объём и число файлов',
  middleware: [requirePermission('filesView')] as const,
  responses: {
    200: {
      description:
        'Сколько занимают файлы, которые сотрудник видит в Файловом менеджере (у владельца — все)',
      content: { 'application/json': { schema: FileUsage } },
    },
    401: noAuth,
    403: { description: 'Нет права «Просматривать файлы»', content: error },
  },
});

/**
 * «Хранилище файлов» в «Моя организация» → «Настройки» (прототип: `allFiles()` → «Занято … · файлов:
 * N»): те же файлы, что сотрудник видит в Файловом менеджере. Учётная политика не проверяется: файлы
 * занимают место и при выключенных «Файлах в карточках».
 */
export function fileUsageHandler(deps: ApiDeps): RouteHandler<typeof fileUsageRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    const t = await serverTexts(deps);
    const usage = await withOrgContext(deps.db, ctx, async (tx) =>
      fileKindCounts(tx, await listOptions(deps, tx, c, t)),
    );
    return c.json({ bytes: usage.bytes, count: usage.count }, 200);
  };
}

export const fileViewRoute = createRoute({
  method: 'get',
  path: '/files/{id}/view',
  tags: ['files'],
  summary: 'Ссылка на просмотр картинки или PDF в окне файла на 15 минут',
  middleware: [requirePermission('filesView')] as const,
  request: { params: FileIdParam },
  responses: {
    200: {
      description: 'Подписанная ссылка: файл открывается в браузере, а не скачивается',
      content: { 'application/json': { schema: FileLink } },
    },
    400: { description: 'Файл не картинка и не PDF — его только скачать', content: error },
    ...fileReadResponses,
  },
});

/** Просмотр в окне (ТЗ: «просмотр изображений и PDF в окне, остальное скачивается»). */
export function fileViewHandler(deps: ApiDeps): RouteHandler<typeof fileViewRoute, AppEnv> {
  return async (c) => {
    const { file } = await visibleFile(deps, c, c.req.valid('param').id);
    if (!filePreviewKind(file.contentType)) {
      apiFail(400, 'file_no_preview', 'Этот файл не открывается в окне: скачайте его');
    }
    return c.json(await downloadLink(deps, file, { contentType: file.contentType }), 200);
  };
}
