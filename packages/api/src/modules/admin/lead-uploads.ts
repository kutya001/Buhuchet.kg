import { randomUUID } from 'node:crypto';
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import type { DocumentReader } from '@buhuchet/adapters/documents';
import {
  dropLeadUpload,
  leadDraftDocs,
  leadRdForms,
  leadUploadKey,
  leadUploadOf,
  markLeadUploadRead,
  releaseRateLimit,
  startLeadUpload,
  takeRateLimit,
  type RateLimit,
} from '@buhuchet/db';
import {
  FILE_UPLOAD_LINK_SECONDS,
  LEAD_DOC_CONTENT_TYPE,
  LEAD_DOC_MAX_BYTES,
  LEAD_READ_ALL_LIMIT,
  LEAD_READ_LIMIT,
  LEAD_READ_TIMEOUT_MS,
  LEAD_READ_WINDOW_SECONDS,
  LEAD_UPLOAD_ALL_LIMIT,
  LEAD_UPLOAD_LIMIT,
  LEAD_UPLOAD_MESSAGES,
  leadDocStoredName,
  leadDocValues,
  rdExtract,
  rdToCp,
  type RdDoc,
} from '@buhuchet/domain';
import {
  ApiError,
  LeadDocsRead,
  LeadUploadParams,
  LeadUploadRead,
  LeadUploadStart,
  LeadUploadTicket,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { alertTexts, sendPlatformAlert } from '../../jobs/alerts';
import { removeStoredObjects } from '../files/storage-retry';
import { leadIpSubject } from './leads';

/*
 * Документы формы «Оставить заявку» (доработки 14.11.2026, блок 1; прототип v114 modules/lead-docs.js —
 * ldDocsBind, ldDocErr, ldParse). Без входа, как сама заявка (`PUBLIC_PATHS` в middleware/session.ts).
 * Файл идёт мимо API (предел тела запроса у Vercel — 4,5 МБ, документ — до 20 МБ): браузер кладёт PDF в
 * хранилище по подписанной ссылке на 2 минуты под ключ загрузки черновика, «прочитать» проверяет размер
 * и начало файла («%PDF-»: тип — по содержимому, а не по имени) и разбирает текст тем же разбором, что
 * «Из свидетельства и выписки» карточки контрагента, — без распознавания сканов (ТЗ: «скан без
 * текстового слоя — поля пустые и заполняются вручную»). Черновик связывает документы одной формы до
 * отправки; номер черновика знает только браузер заявителя, через сутки черновик с файлами удаляет
 * задача по расписанию. Пределы — по адресу и на всю платформу.
 */

const error = { 'application/json': { schema: ApiError } };

/** Начатые загрузки с одного адреса за час. */
export const LEAD_UPLOAD_RATE_LIMIT: RateLimit = {
  kind: 'lead_upload',
  max: LEAD_UPLOAD_LIMIT,
  windowSeconds: 3600,
};
/** Начатые загрузки со всех адресов за час: место в хранилище не забить с многих адресов сразу. */
export const LEAD_UPLOAD_ALL_RATE_LIMIT: RateLimit = {
  kind: 'lead_upload_all',
  max: LEAD_UPLOAD_ALL_LIMIT,
  windowSeconds: 3600,
};
/** Чтение документа: по одному одновременно с адреса и не больше 20 за час. */
export const LEAD_READ_RATE_LIMIT: RateLimit = {
  kind: 'lead_read',
  max: LEAD_READ_LIMIT,
  windowSeconds: LEAD_READ_WINDOW_SECONDS,
  leaseSeconds: 60,
};
/** Разборы документов со всех адресов за час: разбор идёт в процессе сайта. */
// ОТКЛОНЕНИЕ: docs/deviations.md#И-10
export const LEAD_READ_ALL_RATE_LIMIT: RateLimit = {
  kind: 'lead_read_all',
  max: LEAD_READ_ALL_LIMIT,
  windowSeconds: 3600,
};
/** Оповещение администратору платформы о сработавшем общем пределе — не чаще раза в час. */
const LEAD_LIMIT_ALERT_EVERY_SECONDS = 3600;

const PDF_MAGIC = '%PDF-';

let defaultReader: Promise<DocumentReader> | null = null;

/**
 * Чтение PDF заявки: из зависимостей (тесты) или настоящее, без распознавания сканов и не дольше 20
 * секунд на документ. Библиотеки грузятся при первом чтении.
 */
function leadReaderOf(deps: ApiDeps): Promise<DocumentReader> {
  if (deps.documents) return Promise.resolve(deps.documents);
  defaultReader ??= import('@buhuchet/adapters/documents')
    .then((m) => m.createDocumentReader({ ocrPages: 0, timeoutMs: LEAD_READ_TIMEOUT_MS }))
    .catch((e: unknown) => {
      defaultReader = null;
      throw e;
    });
  return defaultReader;
}

/**
 * Удалить объекты хранилища заявки; не вышло — в журнал и на повторное удаление (задача
 * `files.storage-retry`): после «Одобрить» и «Удалить» строк заявки уже нет, задача удаления по сроку
 * такой файл не найдёт.
 */
export async function removeLeadObjects(deps: ApiDeps, keys: readonly string[]): Promise<void> {
  await removeStoredObjects(deps, keys, 'заявка');
}

/**
 * Сработал общий предел загрузок или разборов со всех адресов — оповещение администратору платформы (не
 * чаще раза в час): настоящие заявители в это время получают отказ. Не бросает.
 */
async function leadLimitAlert(deps: ApiDeps): Promise<void> {
  try {
    const t = await alertTexts(deps);
    await sendPlatformAlert(deps, {
      key: 'lead-uploads',
      everySeconds: LEAD_LIMIT_ALERT_EVERY_SECONDS,
      text: t('alert.lead_uploads', { max: LEAD_UPLOAD_ALL_LIMIT, readMax: LEAD_READ_ALL_LIMIT }),
    });
  } catch (err) {
    deps.logger.error({ err }, 'заявка: оповещение о пределе загрузок не отправлено');
  }
}

/** Начало файла в хранилище — «%PDF-»: тип документа по содержимому. */
export async function isStoredPdf(deps: ApiDeps, key: string): Promise<boolean> {
  const head = await deps.storage.getRange(key, 0, PDF_MAGIC.length);
  return !!head && Buffer.from(head).toString('latin1') === PDF_MAGIC;
}

export const leadUploadStartRoute = createRoute({
  method: 'post',
  path: '/leads/uploads',
  tags: ['leads'],
  summary: 'Документ формы «Оставить заявку»: ссылка на хранилище на 2 минуты (без входа)',
  request: {
    body: { required: true, content: { 'application/json': { schema: LeadUploadStart } } },
  },
  responses: {
    201: {
      description: 'Загрузка начата: куда и с какими заголовками положить PDF, черновик документов',
      content: { 'application/json': { schema: LeadUploadTicket } },
    },
    400: {
      description:
        'Неверные данные: вид документа, имя, размер больше 20 МБ; имя со знаками смены направления письма, управляющими знаками или точкой в конце — «Только PDF»',
      content: error,
    },
    429: { description: 'Слишком много загрузок с этого адреса за час', content: error },
  },
});

/**
 * Начать загрузку документа (прототип v114 ldDocsBind): строка черновика с видом, именем и размером
 * (новый файл того же вида заменяет прежний — прежний удаляется из хранилища) и подписанная ссылка с
 * этим размером и типом PDF. Имя хранится с «.pdf» на конце (`leadDocStoredName`): с ним документ
 * потом переходит в файлы организации.
 */
export function leadUploadStartHandler(
  deps: ApiDeps,
): RouteHandler<typeof leadUploadStartRoute, AppEnv> {
  return async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = c.req.valid('json');
    const name = leadDocStoredName(body.name);
    if (!name) return apiFail(400, 'lead_doc_pdf', 'Только PDF');
    const slot = await takeRateLimit(deps.db, LEAD_UPLOAD_RATE_LIMIT, leadIpSubject(c, deps));
    if (!slot.ok) apiFail(429, 'lead_upload_limit', LEAD_UPLOAD_MESSAGES.lead_upload_limit);
    const all = await takeRateLimit(deps.db, LEAD_UPLOAD_ALL_RATE_LIMIT, 'all');
    if (!all.ok) {
      await leadLimitAlert(deps);
      apiFail(429, 'lead_upload_limit', LEAD_UPLOAD_MESSAGES.lead_upload_limit);
    }
    const id = randomUUID();
    const started = await startLeadUpload(deps.db, {
      draft: body.draft,
      id,
      kind: body.kind,
      name,
      size: body.size,
      now: deps.clock.now(),
    });
    if (started.replaced) await removeLeadObjects(deps, [leadUploadKey(started.replaced)]);
    // Срок — по настоящим часам: подпись хранилища ставит их же, а не часы демо-стенда (FIXED_NOW).
    const expiresAt = new Date(Date.now() + FILE_UPLOAD_LINK_SECONDS * 1000).toISOString();
    const upload = await deps.storage.signedUploadUrl(leadUploadKey(id), {
      expiresInSeconds: FILE_UPLOAD_LINK_SECONDS,
      contentType: LEAD_DOC_CONTENT_TYPE,
      size: body.size,
    });
    return c.json(
      {
        id,
        draft: started.draft,
        upload: { url: upload.url, method: 'PUT' as const, headers: upload.headers, expiresAt },
      },
      201,
    );
  };
}

export const leadUploadReadRoute = createRoute({
  method: 'post',
  path: '/leads/uploads/{id}/read',
  tags: ['leads'],
  summary: 'Прочитать документ формы «Оставить заявку»: данные для полей (без входа)',
  request: {
    params: LeadUploadParams,
    body: { required: true, content: { 'application/json': { schema: LeadUploadRead } } },
  },
  responses: {
    200: {
      description:
        'Документ проверен; что нашёл разбор по всем документам черновика: данные, ничего или документы разных организаций',
      content: { 'application/json': { schema: LeadDocsRead } },
    },
    400: {
      description: 'Не PDF или файл больше 20 МБ («Только PDF», «Файл больше 20 МБ»)',
      content: error,
    },
    404: { description: 'Нет такой загрузки в этом черновике', content: error },
    409: { description: 'Файл не дошёл до хранилища', content: error },
    429: { description: 'Идёт прежнее чтение с этого адреса или за час их уже 20', content: error },
  },
});

/** Разобранный документ для черновика — без текста документа (его не храним). */
const docOf = (doc: RdDoc): RdDoc => ({ ...doc, text: '' });

/**
 * Прочитать документ (прототип v114 ldDocErr, ldParse): файл в хранилище — заявленного размера и PDF по
 * содержимому, иначе строка и файл убираются («Только PDF», «Файл больше 20 МБ»); текст разбирается, а
 * итог считается по всем проверенным документам черновика — как у прототипа после каждого выбора файла.
 */
export function leadUploadReadHandler(
  deps: ApiDeps,
): RouteHandler<typeof leadUploadReadRoute, AppEnv> {
  return async (c) => {
    c.header('Cache-Control', 'no-store');
    const { id } = c.req.valid('param');
    const { draft } = c.req.valid('json');
    const subject = leadIpSubject(c, deps);
    const slot = await takeRateLimit(deps.db, LEAD_READ_RATE_LIMIT, subject);
    if (!slot.ok) {
      if (slot.reason === 'busy')
        apiFail(429, 'lead_read_busy', LEAD_UPLOAD_MESSAGES.lead_read_busy);
      apiFail(429, 'lead_read_limit', LEAD_UPLOAD_MESSAGES.lead_read_limit);
    }
    try {
      const upload = await leadUploadOf(deps.db, id, draft);
      if (!upload) return apiFail(404, 'not_found', 'Нет такой загрузки');
      // Уже прочитан (повтор запроса) — итог по сохранённому разбору, без нового скачивания и разбора.
      if (upload.state !== 'ready') await readLeadUpload(deps, id, draft, upload.sizeBytes);
      const docs = await leadDraftDocs(deps.db, draft, deps.clock.now());
      const parsed = docs.flatMap((d) => (d.state === 'ready' && d.doc ? [d.doc as RdDoc] : []));
      const forms = parsed.length ? await leadRdForms(deps.db) : [];
      const out = parsed.length ? rdToCp(parsed, { forms, offices: [], gked: [] }) : null;
      const { found, values } = leadDocValues(out);
      return c.json(
        {
          found,
          values,
          docs: docs.map((d) => ({ id: d.id, kind: d.kind, name: d.name })),
        },
        200,
      );
    } finally {
      await releaseRateLimit(deps.db, LEAD_READ_RATE_LIMIT, subject, slot.ticket).catch(
        (err: unknown) => deps.logger.error({ err }, 'чтение документа заявки не отпущено'),
      );
    }
  };
}

/**
 * Проверить и разобрать загруженный документ: файл в хранилище — заявленного размера и PDF по
 * содержимому, иначе строка и файл убираются («Только PDF», «Файл больше 20 МБ»); разбор сохраняется в
 * строке черновика. Разборов со всех адресов — не больше `LEAD_READ_ALL_LIMIT` за час.
 */
async function readLeadUpload(
  deps: ApiDeps,
  id: string,
  draft: string,
  sizeBytes: number,
): Promise<void> {
  const all = await takeRateLimit(deps.db, LEAD_READ_ALL_RATE_LIMIT, 'all');
  if (!all.ok) {
    await leadLimitAlert(deps);
    apiFail(429, 'lead_read_limit', LEAD_UPLOAD_MESSAGES.lead_read_limit);
  }
  const key = leadUploadKey(id);
  const stored = await deps.storage.stat(key);
  if (!stored) return apiFail(409, 'lead_upload_missing', LEAD_UPLOAD_MESSAGES.lead_upload_missing);
  // Отказ — через `return await`: иначе отказ ждал бы, пока `finally` отпускает предел, без
  // обработчика (необработанное отклонение).
  const refuse = async (code: 'lead_doc_pdf' | 'lead_doc_big'): Promise<never> => {
    await dropLeadUpload(deps.db, id, draft);
    await removeLeadObjects(deps, [key]);
    return code === 'lead_doc_big'
      ? apiFail(400, code, 'Файл больше 20 МБ')
      : apiFail(400, code, 'Только PDF');
  };
  if (stored.size > LEAD_DOC_MAX_BYTES) return await refuse('lead_doc_big');
  if (stored.size !== sizeBytes) {
    return apiFail(409, 'lead_upload_missing', LEAD_UPLOAD_MESSAGES.lead_upload_missing);
  }
  if (!(await isStoredPdf(deps, key))) return await refuse('lead_doc_pdf');
  const bytes = await deps.storage.get(key);
  if (!bytes || bytes.length !== sizeBytes) {
    return apiFail(409, 'lead_upload_missing', LEAD_UPLOAD_MESSAGES.lead_upload_missing);
  }
  const reader = await leadReaderOf(deps);
  const read = await reader.read(bytes);
  // Не прочитался (пароль, повреждён, скан без текста) — документ остаётся, поля заполняют вручную.
  const doc = read.ok ? rdExtract(read.doc) : null;
  if (!(await markLeadUploadRead(deps.db, id, draft, doc?.kind ? docOf(doc) : null))) {
    return apiFail(404, 'not_found', 'Нет такой загрузки');
  }
}
