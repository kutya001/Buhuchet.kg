import { randomUUID } from 'node:crypto';
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { orgFileKey } from '@buhuchet/adapters';
import type { DocumentReader } from '@buhuchet/adapters/documents';
import {
  findContractorByInn,
  insertPendingFile,
  pendingRegdocs,
  regdocsDicts,
  releaseRateLimit,
  takeRateLimit,
  withOrgContext,
  type FileRecord,
  type RateLimit,
} from '@buhuchet/db';
import {
  FILE_UPLOAD_LINK_SECONDS,
  fileUploadProblem,
  RD_KEYS,
  RD_MAX_BYTES,
  rdExtract,
  rdToCp,
  rdUnsupported,
  type RdDicts,
  type RdDoc,
  type RdKind,
  type RdResult,
} from '@buhuchet/domain';
import {
  FileUploadTicket,
  RegdocsRecognized,
  RegdocsRecognizeRequest,
  RegdocsUploadStart,
  type RegdocsFile,
  type RegdocsFileError,
  type RegdocsResult,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { FILES_SECTION, UPLOAD_RATE_LIMIT } from '../files/files';
import { error, ownEmployeeOf, subjectOf } from './common';

/*
 * «Из свидетельства и выписки» (Бета; задача 2.17; ТЗ «Контрагенты» → «Создание контрагента из
 * свидетельства и выписки (Бета)»; прототип modules/contractor-regdocs.js — regDocsDlg, rdRun): браузер
 * кладёт PDF в хранилище по подписанной ссылке, «Распознать» читает документы на сервере платформы
 * (текстовый слой, иначе распознавание скана — переходник `documents`) и разбирает их правилами прототипа
 * (@buhuchet/domain, `rdExtract`, `rdToCp`). Документы до сохранения контрагента — незаконченные
 * загрузки этого пользователя: «Сохранить» прикрепляет их к контрагенту, остальные убирает задача
 * очистки через сутки. Право — «Создавать и изменять контрагентов», как на создание (ТЗ).
 */

const noAuth = { description: 'Нет входа', content: error };
const noRight = {
  description: 'Нет права «Просматривать контрагентов» или «Создавать и изменять контрагентов»',
  content: error,
};

/**
 * «Распознать» одного пользователя: одно одновременно (документ читается до минуты, скан — дольше
 * текста) и не больше 30 за час. Не отпущенное (сбой процесса) перестаёт мешать через 5 минут.
 */
export const REGDOCS_RATE_LIMIT: RateLimit = {
  kind: 'cp_regdocs',
  max: 30,
  windowSeconds: 3600,
  leaseSeconds: 300,
};

let defaultReader: Promise<DocumentReader> | null = null;

/**
 * Чтение PDF: из зависимостей (тесты) или настоящее — библиотеки чтения и распознавания загружаются при
 * первом «Распознать», остальное API и worker их не тянут.
 */
function readerOf(deps: ApiDeps): Promise<DocumentReader> {
  if (deps.documents) return Promise.resolve(deps.documents);
  defaultReader ??= import('@buhuchet/adapters/documents')
    .then((m) => m.createDocumentReader())
    .catch((e: unknown) => {
      defaultReader = null;
      throw e;
    });
  return defaultReader;
}

const isPdfName = (name: string) => /\.pdf$/i.test(name);

export const regdocsUploadRoute = createRoute({
  method: 'post',
  path: '/contractors/regdocs/uploads',
  tags: ['contractors'],
  summary: 'Документ «Из свидетельства и выписки»: ссылка на хранилище на 2 минуты',
  middleware: [requirePermission('cpView'), requirePermission('createCp')] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: RegdocsUploadStart } } },
  },
  responses: {
    201: {
      description: 'Загрузка начата: куда и с какими заголовками положить PDF',
      content: { 'application/json': { schema: FileUploadTicket } },
    },
    400: { description: 'Не PDF, больше 10 МБ или неверное имя файла', content: error },
    401: noAuth,
    403: noRight,
    429: { description: 'Больше 300 загрузок файлов за час', content: error },
  },
});

/**
 * Начать загрузку документа (прототип regDocsDlg → addFiles: «Загрузите PDF до 10 МБ»): запись
 * «pending» вида «contractor» без контрагента и подписанная ссылка с этим размером и типом. Файл
 * виден только загрузившему — до «Сохранить», где он прикрепляется к контрагенту.
 */
export function regdocsUploadHandler(
  deps: ApiDeps,
): RouteHandler<typeof regdocsUploadRoute, AppEnv> {
  return async (c) => {
    const { name: raw, size } = c.req.valid('json');
    const name = raw.trim();
    if (fileUploadProblem({ name: raw, size }) || !isPdfName(name) || size > RD_MAX_BYTES) {
      apiFail(400, 'regdocs_file', 'Загрузите PDF до 10 МБ');
    }
    const ctx = orgContextOf(c);
    const id = randomUUID();
    const storageKey = orgFileKey(ctx.orgId, FILES_SECTION, id);
    const slot = await takeRateLimit(deps.db, UPLOAD_RATE_LIMIT, ctx.userId!);
    if (!slot.ok)
      apiFail(429, 'file_upload_limit', 'Слишком много загрузок за час. Попробуйте позже');
    await withOrgContext(deps.db, ctx, (tx) =>
      insertPendingFile(tx, {
        id,
        sourceKind: 'contractor',
        sourceId: null,
        contractorId: null,
        name,
        contentType: 'application/pdf',
        sizeBytes: size,
        storageKey,
      }),
    );
    // Срок — по настоящим часам: подпись хранилища ставит их же, а не часы демо-стенда (FIXED_NOW).
    const expiresAt = new Date(Date.now() + FILE_UPLOAD_LINK_SECONDS * 1000);
    const upload = await deps.storage.signedUploadUrl(storageKey, {
      expiresInSeconds: FILE_UPLOAD_LINK_SECONDS,
      contentType: 'application/pdf',
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

export const regdocsRecognizeRoute = createRoute({
  method: 'post',
  path: '/contractors/regdocs/recognize',
  tags: ['contractors'],
  summary: '«Распознать» документы «Из свидетельства и выписки»',
  middleware: [requirePermission('cpView'), requirePermission('createCp')] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: RegdocsRecognizeRequest } } },
  },
  responses: {
    200: {
      description:
        'Документы по порядку (вид или почему не распознан), ошибка итога, реквизиты для формы и контрагент с этим ИНН, если он уже есть',
      content: { 'application/json': { schema: RegdocsRecognized } },
    },
    400: { description: 'Неверный список документов', content: error },
    401: noAuth,
    403: noRight,
    429: {
      description: 'Идёт прежнее распознавание пользователя или за час их уже 30',
      content: error,
    },
  },
});

/** Документ после чтения: разобранный или почему не распознан (прототип rdRun: `x.state`, `x.msg`). */
type Read = { id: string; doc: RdDoc & { kind: RdKind } } | { id: string; error: RegdocsFileError };

/**
 * Прочитать и разобрать один документ: файл должен лежать в хранилище того же размера, что заявлен, и
 * не больше 10 МБ; ошибки чтения — словами прототипа.
 */
async function readOne(deps: ApiDeps, reader: DocumentReader, file: FileRecord): Promise<Read> {
  const fail = (error: RegdocsFileError): Read => ({ id: file.id, error });
  // Сначала размер в хранилище, потом сам файл: больше заявленного не читается в память.
  const stored = await deps.storage.stat(file.storageKey);
  if (!stored) return fail('upload');
  if (stored.size !== file.sizeBytes || stored.size > RD_MAX_BYTES) return fail('size');
  const bytes = await deps.storage.get(file.storageKey);
  if (!bytes) return fail('upload');
  if (bytes.length !== file.sizeBytes) return fail('size');
  const read = await reader.read(bytes);
  if (!read.ok) return fail(read.error === 'password' ? 'password' : 'read');
  const doc = rdExtract(read.doc);
  if (!doc.kind) return fail('kind');
  if (rdUnsupported(doc)) return fail('ip');
  return { id: file.id, doc: doc as RdDoc & { kind: RdKind } };
}

/** Итог для формы: у кодов ГКЭД — названия из справочника (подсказки выбора и подставленный код). */
function resultOut(res: RdResult, dicts: RdDicts): RegdocsResult {
  const names = new Map(dicts.gked.map((g) => [g.code, g.name]));
  const opt = (code: string) => ({ code, name: names.get(code) ?? '' });
  return {
    v: res.v,
    src: res.src,
    alt: res.alt,
    gk: res.gk
      ? {
          code: res.gk.code,
          name: res.gk.code ? (names.get(res.gk.code) ?? '') : '',
          choose: res.gk.choose.map(opt),
          like: res.gk.like.map(opt),
          raw: res.gk.raw,
          text: res.gk.text,
          src: res.gk.src,
          more: res.gk.more.map(opt),
        }
      : null,
    ugns: res.ugns,
    stopped: res.stopped,
    status: res.status,
    phoneBad: res.phoneBad,
  };
}

async function withRecognizeSlot<T>(deps: ApiDeps, c: Context<AppEnv>, run: () => Promise<T>) {
  const userId = c.get('session')!.userId;
  const slot = await takeRateLimit(deps.db, REGDOCS_RATE_LIMIT, userId);
  if (!slot.ok) {
    if (slot.reason === 'busy')
      apiFail(429, 'regdocs_busy', 'Предыдущие документы ещё распознаются');
    apiFail(429, 'regdocs_limit', 'Слишком много распознаваний документов за час');
  }
  try {
    return await run();
  } finally {
    await releaseRateLimit(deps.db, REGDOCS_RATE_LIMIT, userId, slot.ticket).catch((err: unknown) =>
      deps.logger.error({ err }, 'распознавание документов не отпущено'),
    );
  }
}

/**
 * «Распознать» (прототип rdRun): документы читаются по одному, у каждого — вид и дата выдачи или
 * почему не распознан; два документа одного вида, ни одного распознанного и документы разных
 * организаций — ошибка итога, формы нет. ИНН проверяется на повтор среди всех контрагентов
 * организации, включая архив; найденный вне области сотрудника — без номера.
 * Неудачные распознавания пишутся в журнал без содержимого документа (ТЗ «Как распознаётся»).
 */
export function regdocsRecognizeHandler(
  deps: ApiDeps,
): RouteHandler<typeof regdocsRecognizeRoute, AppEnv> {
  return async (c) => {
    const ids = [...new Set(c.req.valid('json').files)];
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const body = await withRecognizeSlot(deps, c, async () => {
      const [found, dicts] = await withOrgContext(deps.db, ctx, (tx) =>
        Promise.all([pendingRegdocs(tx, ids, ctx.userId!), regdocsDicts(tx)]),
      );
      const byId = new Map(found.map((f) => [f.id, f]));
      const reader = await readerOf(deps);
      const reads: Read[] = [];
      for (const id of ids) {
        const file = byId.get(id);
        reads.push(file ? await readOne(deps, reader, file) : { id, error: 'upload' });
      }
      const files: RegdocsFile[] = reads.map((r) =>
        'doc' in r
          ? { id: r.id, state: 'ok', kind: r.doc.kind, issued: r.doc.issued, error: null }
          : { id: r.id, state: 'bad', kind: null, issued: '', error: r.error },
      );
      for (const r of reads) {
        if ('error' in r)
          deps.logger.info({ regdocs: { error: r.error } }, 'документ не распознан');
      }
      const docs = reads.flatMap((r) => ('doc' in r ? [r.doc] : []));
      const empty = {
        files,
        error: null,
        sameKind: null,
        result: null,
        duplicate: null,
      } satisfies RegdocsRecognized;
      const same = docs.find((d, i) => docs.findIndex((x) => x.kind === d.kind) !== i);
      if (same) return { ...empty, error: 'same' as const, sameKind: same.kind };
      const out = rdToCp(docs, dicts);
      if (out.err)
        return { ...empty, error: out.err === 'diff' ? ('diff' as const) : ('none' as const) };
      const missing = RD_KEYS.filter((k) => out.res.v[k] === undefined);
      if (missing.length || !out.res.gk?.code) {
        deps.logger.info(
          { regdocs: { kinds: docs.map((d) => d.kind), missing, gked: !!out.res.gk?.code } },
          'документы распознаны не полностью',
        );
      }
      const inn = typeof out.res.v.inn === 'string' ? out.res.v.inn : '';
      const dup = inn
        ? await withOrgContext(deps.db, ctx, (tx) => findContractorByInn(tx, inn))
        : null;
      const own = ownEmployeeOf(subject);
      const visible = !!dup && (own === null || dup.responsibleEmployeeId === own);
      return {
        ...empty,
        result: resultOut(out.res, dicts),
        // Вне области сотрудника — без номера (не открыть), название — как в ответе формы (409).
        duplicate: dup
          ? { inn, id: visible ? dup.id : null, name: dup.name, archived: dup.archived }
          : null,
      };
    });
    return c.json(RegdocsRecognized.parse(body), 200);
  };
}
