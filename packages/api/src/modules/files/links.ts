import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  feeLinkedHidden,
  fileFeeLinked,
  fileLinkKey,
  fileLinkLabels,
  fileLinksOf,
  linkableFiles,
  linkContractorName,
  linkFiles,
  unlinkFile,
  getFile,
  withOrgContext,
  writeHistory,
  type FileLinkTarget,
  type Tx,
} from '@buhuchet/db';
import {
  FILE_LINK_SOURCE_KINDS,
  hasPermission,
  type AccessSubject,
  type Feature,
  type FileLinkSourceKind,
} from '@buhuchet/domain';
import {
  FileLinkable,
  FileLinkAdd,
  FileLinkAdded,
  FileIdParam,
  FileSourceQuery,
  FileUnlinkQuery,
  type FileLinkInfo,
} from '@buhuchet/shared';
import type { SQL } from 'drizzle-orm';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import {
  canUpload,
  error,
  feeSeenFor,
  requireFilesFeature,
  sourceOf,
  subjectOf,
  visibleSource,
} from './files';

export { feeSeenFor };
import type { FileSourceRecord } from './sources';

/*
 * Один файл — несколько ссылок (доработки 16.11.2026, блок 2, этап 1; прототип v124 modules/files.js
 * `fLinkRecs`, `fPickDlg`, `fLinkAdd`, `fUnlink`; таблица `file_links`): файл контрагента — принятый чек,
 * накладная, акт, сверка, документы карточки, загруженный вручную с контрагентом — прикрепляется к его
 * записям ссылкой, без новой загрузки и копии: «Из файлов контрагента» и «Открепить» в блоке «Файлы»
 * записи. Прикрепить и открепить может тот, кто может прикреплять файлы к этой записи (`canUpload`:
 * право «Загружать файлы», область группы «Файловый менеджер», запись можно менять в её модуле); файл —
 * только свой загруженный файл того же контрагента. Файл, прикреплённый к оплате за обслуживание, видит
 * только тот, кто видит плату (прототип `fFeeHid`).
 */

const notFound = (): never => apiFail(404, 'not_found', 'Файл не найден');

const isLinkKind = (kind: string): kind is FileLinkSourceKind =>
  (FILE_LINK_SOURCE_KINDS as readonly string[]).includes(kind);

/**
 * Скрытые этому сотруднику файлы — прикреплённые к оплате за обслуживание, которую он не видит: условие
 * над `files` и присоединённым контрагентом файла (`contractors`); нет — undefined.
 */
export function feeHiddenSql(
  subject: AccessSubject,
  features: Readonly<Record<Feature, boolean>>,
  scope: SQL | undefined,
): SQL | undefined {
  if (!features.fee || !hasPermission(subject, 'fee')) return feeLinkedHidden(false);
  return scope ? feeLinkedHidden(scope) : undefined;
}

/**
 * Где ещё файлы (прототип `f.links`): записи, которые сотрудник видит в их модулях (`resolve` источника),
 * с тем, из чего экран собирает подпись, и сколько записей ему не видно. Отменённых и удалённых записей
 * нет в обоих числах. Сумму поступления целиком (с обслуживанием) видит только тот, кто видит плату.
 */
export async function fileLinkInfos(
  deps: ApiDeps,
  tx: Tx,
  subject: AccessSubject,
  features: Readonly<Record<Feature, boolean>>,
  fileIds: readonly string[],
): Promise<Map<string, { links: FileLinkInfo[]; hiddenLinks: number }>> {
  const out = new Map<string, { links: FileLinkInfo[]; hiddenLinks: number }>();
  const byFile = await fileLinksOf(tx, fileIds);
  if (byFile.size === 0) return out;
  const labels = await fileLinkLabels(tx, [...byFile.values()].flat());
  const seen = new Map<string, FileSourceRecord | null>();
  for (const [fileId, targets] of byFile) {
    const links: FileLinkInfo[] = [];
    let hiddenLinks = 0;
    for (const target of targets) {
      const key = fileLinkKey(target);
      const label = labels.get(key);
      if (!label) continue;
      if (!seen.has(key)) {
        const record = await sourceOf(deps, target.kind)?.resolve(tx, subject, target.id);
        seen.set(key, record ?? null);
      }
      const record = seen.get(key);
      if (!record?.contractor) {
        hiddenLinks++;
        continue;
      }
      const whole =
        target.kind === 'receipt' &&
        label.total !== null &&
        feeSeenFor(subject, features, record.contractor);
      links.push({
        kind: target.kind,
        id: target.id,
        parentId: label.parentId,
        date: label.date,
        amount: whole ? label.total : label.amount,
        name: label.name,
        op: label.op,
        report: label.report,
      });
    }
    out.set(fileId, { links, hiddenLinks });
  }
  return out;
}

/**
 * Запись контрагента, к файлам которой сотрудник прикрепляет ссылкой: вид с ссылками, запись видна
 * (иначе 404), её файлы можно менять (иначе 403).
 */
async function linkRecord(
  deps: ApiDeps,
  tx: Tx,
  subject: AccessSubject,
  kind: string,
  id: string,
): Promise<{
  target: FileLinkTarget;
  record: FileSourceRecord & { contractor: { id: string; responsibleEmployeeId: string | null } };
}> {
  if (!isLinkKind(kind)) return notFound();
  const record = await visibleSource(deps, tx, subject, kind, id);
  if (!record.contractor) return notFound();
  if (!canUpload(subject, record)) apiFail(403, 'forbidden', 'Нет права на это действие');
  return {
    target: { kind, id },
    record: record as FileSourceRecord & {
      contractor: { id: string; responsibleEmployeeId: string | null };
    },
  };
}

export const linkableRoute = createRoute({
  method: 'get',
  path: '/files/linkable',
  tags: ['files'],
  summary: '«Из файлов контрагента»: файлы контрагента записи, которые можно прикрепить ссылкой',
  middleware: [requirePermission('filesView'), requirePermission('filesUpload')] as const,
  request: { query: FileSourceQuery },
  responses: {
    200: {
      description: 'Файлы контрагента записи, кроме уже прикреплённых к ней, сначала новые',
      content: { 'application/json': { schema: FileLinkable } },
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Нет права «Загружать файлы», файлы записи нельзя менять или «Файлы в карточках» выключены',
      content: error,
    },
    404: { description: 'Записи нет, она вне области или у неё нет контрагента', content: error },
  },
});

export function linkableHandler(deps: ApiDeps): RouteHandler<typeof linkableRoute, AppEnv> {
  return async (c) => {
    const { kind, id } = c.req.valid('query');
    if (!id) return notFound();
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const body = await withOrgContext(deps.db, ctx, async (tx) => {
      const features = await requireFilesFeature(tx, ctx.orgId);
      const { target, record } = await linkRecord(deps, tx, subject, kind, id);
      const hidden = feeSeenFor(subject, features, record.contractor)
        ? undefined
        : feeLinkedHidden(false);
      const all = await linkableFiles(tx, record.contractor.id, hidden);
      const infos = await fileLinkInfos(
        deps,
        tx,
        subject,
        features,
        all.map((f) => f.id),
      );
      const linkedHere = (fileId: string) =>
        (infos.get(fileId)?.links ?? []).some((l) => l.kind === target.kind && l.id === target.id);
      const items = all
        .filter((f) => !linkedHere(f.id))
        .map((f) => ({
          id: f.id,
          name: f.name,
          contentType: f.contentType,
          size: f.sizeBytes,
          kind: f.sourceKind,
          note: f.note,
          uploadedAt: f.createdAt.toISOString(),
          links: infos.get(f.id)?.links ?? [],
        }));
      return {
        contractor: {
          id: record.contractor.id,
          name: await linkContractorName(tx, record.contractor.id),
        },
        items,
        allLinked: items.length === 0 && all.length > 0,
      };
    });
    return c.json(body, 200);
  };
}

export const linkAddRoute = createRoute({
  method: 'post',
  path: '/files/links',
  tags: ['files'],
  summary: '«Прикрепить» из файлов контрагента: файлы ссылкой к записи, без копии',
  middleware: [requirePermission('filesView'), requirePermission('filesUpload')] as const,
  request: { body: { required: true, content: { 'application/json': { schema: FileLinkAdd } } } },
  responses: {
    200: {
      description: 'Прикреплены (в истории записи — «Прикреплён из файлов контрагента»)',
      content: { 'application/json': { schema: FileLinkAdded } },
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Нет права «Загружать файлы», файлы записи нельзя менять или «Файлы в карточках» выключены',
      content: error,
    },
    404: {
      description:
        'Записи нет или она вне области; файла нет, он другого контрагента, не загружен или не прикрепляется ссылкой',
      content: error,
    },
  },
});

/**
 * «Прикрепить: N» окна «Из файлов контрагента» и выбранные в форме записи файлы после её сохранения
 * (прототип `fLinkAdd`, `fPickSave`): ссылки и запись «Прикреплён из файлов контрагента: …» в истории
 * записи — одной транзакцией; уже прикреплённые к записи пропускаются.
 */
export function linkAddHandler(deps: ApiDeps): RouteHandler<typeof linkAddRoute, AppEnv> {
  return async (c) => {
    const { kind, id, fileIds } = c.req.valid('json');
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const body = await withOrgContext(deps.db, ctx, async (tx) => {
      const features = await requireFilesFeature(tx, ctx.orgId);
      const { target, record } = await linkRecord(deps, tx, subject, kind, id);
      const added = await linkTo(tx, subject, features, target, record, fileIds);
      if (!added) return notFound();
      return { added };
    });
    return c.json(body, 200);
  };
}

/**
 * Прикрепить файлы контрагента ссылкой к видимой записи, которую можно менять, — с записью в её
 * историю; null — какой-то файл не подходит (другой контрагент, не загружен, не прикрепляется ссылкой,
 * прикреплён к оплате за обслуживание, которую сотрудник не видит). Общая часть «Прикрепить» и «Принять»
 * чек вместе с деньгами (`files/sent.ts`).
 */
export async function linkTo(
  tx: Tx,
  subject: AccessSubject,
  features: Readonly<Record<Feature, boolean>>,
  target: FileLinkTarget,
  record: FileSourceRecord & { contractor: { id: string; responsibleEmployeeId: string | null } },
  fileIds: readonly string[],
): Promise<{ id: string; name: string }[] | null> {
  const hidden = feeSeenFor(subject, features, record.contractor)
    ? undefined
    : feeLinkedHidden(false);
  const added = await linkFiles(tx, target, record.contractor.id, fileIds, hidden);
  if (!added) return null;
  for (const file of added) {
    await writeHistory(tx, {
      ...record.history(file.id),
      action: 'file_attach',
      changes: [
        { field: 'file', to: file.name },
        { field: 'link', to: true },
      ],
    });
  }
  return added.map((f) => ({ id: f.id, name: f.name }));
}

export const unlinkRoute = createRoute({
  method: 'delete',
  path: '/files/{id}/links',
  tags: ['files'],
  summary: '«Открепить» файл от записи: файл остаётся у контрагента',
  middleware: [requirePermission('filesView'), requirePermission('filesUpload')] as const,
  request: { params: FileIdParam, query: FileUnlinkQuery },
  responses: {
    200: {
      description: 'Откреплён (в истории записи — «Откреплён файл … он остался в файлах контрагента»)',
      content: { 'application/json': { schema: z.object({ id: z.uuid() }) } },
    },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Нет права «Загружать файлы», файлы записи нельзя менять или «Файлы в карточках» выключены',
      content: error,
    },
    404: { description: 'Записи или ссылки нет, запись вне области', content: error },
  },
});

/** «Открепить» (прототип `fUnlink`): убирается только ссылка, в истории записи — «Откреплён файл». */
export function unlinkHandler(deps: ApiDeps): RouteHandler<typeof unlinkRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { kind, sourceId } = c.req.valid('query');
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    await withOrgContext(deps.db, ctx, async (tx) => {
      const features = await requireFilesFeature(tx, ctx.orgId);
      const { target, record } = await linkRecord(deps, tx, subject, kind, sourceId);
      const file = await getFile(tx, id);
      if (!file || file.state !== 'ready') return notFound();
      // Файл оплаты за обслуживание, которую сотрудник не видит, для него как будто не прикреплён.
      if (!feeSeenFor(subject, features, record.contractor) && (await fileFeeLinked(tx, id))) {
        return notFound();
      }
      if (!(await unlinkFile(tx, target, id))) return notFound();
      await writeHistory(tx, {
        ...record.history(id),
        action: 'file_delete',
        changes: [
          { field: 'file', from: file.name },
          { field: 'link', to: true },
        ],
      });
    });
    return c.json({ id }, 200);
  };
}
