import { randomUUID } from 'node:crypto';
import { orgFileKey } from '@buhuchet/adapters';
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { takeRateLimit, withOrgContext } from '@buhuchet/db';
import { FILE_MESSAGES } from '@buhuchet/domain';
import { SentFileAttach, SentFileAttached, SentFileIdParam } from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { attachStoredFile } from './attach';
import {
  dropObjects,
  error,
  FILES_SECTION,
  requireFilesFeature,
  subjectOf,
  UPLOAD_RATE_LIMIT,
  visibleSource,
} from './files';
import { visibleSent } from './sent';

/*
 * Принятый чек — сразу к деньгам (просьба заказчика 15.11.2026, прототип v119): «Принять» у чека из
 * Telegram или со страницы контрагента открывает «Поступление от контрагента» или «Принять оплату за
 * обслуживание», и сам чек уже стоит в поле файлов. После сохранения записи денег окно прикрепляет к ней
 * копию принятого файла — второй раз его не скачивают и не загружают. Копия, а не ссылка: файл
 * контрагента и файл записи денег удаляются независимо, как любые файлы записей.
 */

const notFound = (): never => apiFail(404, 'not_found', 'Файл не найден');

export const sentAttachRoute = createRoute({
  method: 'post',
  path: '/files/sent/{id}/attach',
  tags: ['files'],
  summary: 'Прикрепить принятый чек контрагента к поступлению или оплате за обслуживание',
  middleware: [requirePermission('filesView'), requirePermission('filesUpload')] as const,
  request: {
    params: SentFileIdParam,
    body: { required: true, content: { 'application/json': { schema: SentFileAttach } } },
  },
  responses: {
    201: {
      description:
        'Копия принятого файла прикреплена к записи денег (в её истории — «Прикреплён файл»)',
      content: { 'application/json': { schema: SentFileAttached } },
    },
    400: { description: 'Неверное тело запроса', content: error },
    401: { description: 'Нет входа', content: error },
    403: {
      description:
        'Нет права «Просматривать файлы» или «Загружать файлы», нельзя менять запись денег или «Файлы в карточках» выключены',
      content: error,
    },
    404: {
      description:
        'Файл не принят, удалён из файлов контрагента или вне области; записи денег нет, она не видна или другого контрагента',
      content: error,
    },
    409: { description: 'Принятого файла нет в хранилище', content: error },
    429: { description: 'Слишком много загрузок за час', content: error },
  },
});

/**
 * Прикрепить: принятый файл виден сотруднику (область «Файловый менеджер»), запись денег — того же
 * контрагента, и её файлы он может менять (как загрузка с сайта: `attachStoredFile`). Копия ложится в
 * хранилище до транзакции и удаляется при отказе; в пределе загрузок пользователя за час.
 */
export function sentAttachHandler(deps: ApiDeps): RouteHandler<typeof sentAttachRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { source } = c.req.valid('json');
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const slot = await takeRateLimit(deps.db, UPLOAD_RATE_LIMIT, ctx.userId!);
    if (!slot.ok) apiFail(429, 'file_upload_limit', FILE_MESSAGES.file_upload_limit);
    const seen = await withOrgContext(deps.db, ctx, async (tx) => {
      await requireFilesFeature(tx, ctx.orgId);
      return (await visibleSent(tx, subject, id)).file;
    });
    if (seen.status !== 'accepted' || !seen.fileStorageKey) return notFound();
    const fileId = randomUUID();
    const key = orgFileKey(ctx.orgId, FILES_SECTION, fileId);
    if (!(await deps.storage.copy(seen.fileStorageKey, key))) {
      apiFail(409, 'file_not_uploaded', FILE_MESSAGES.file_not_uploaded);
    }
    try {
      const stored = await deps.storage.stat(key);
      if (!stored) apiFail(409, 'file_not_uploaded', FILE_MESSAGES.file_not_uploaded);
      const attached = await withOrgContext(deps.db, ctx, async (tx) => {
        const { file, contractor } = await visibleSent(tx, subject, id);
        // Файл контрагента могли удалить (или заменить), пока копировалась его копия.
        if (file.status !== 'accepted' || file.fileStorageKey !== seen.fileStorageKey) {
          return notFound();
        }
        const record = await visibleSource(deps, tx, subject, source.kind, source.id);
        // Чек одного контрагента к деньгам другого не прикрепить.
        if (record.contractor?.id !== contractor.id) return notFound();
        const done = await attachStoredFile(deps, tx, subject, ctx.orgId, {
          id: fileId,
          source,
          name: file.name,
          size: stored!.size,
          contentType: file.contentType,
          storageKey: key,
          note: null,
        });
        if (done === 'files_off') return apiFail(403, 'files_off', FILE_MESSAGES.files_off);
        if (done === 'not_found') return notFound();
        if (done === 'forbidden') return apiFail(403, 'forbidden', 'Нет права на это действие');
        return done;
      });
      return c.json(attached, 201);
    } catch (err) {
      await dropObjects(deps, [key]);
      throw err;
    }
  };
}
