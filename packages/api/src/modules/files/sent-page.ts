import { randomUUID } from 'node:crypto';
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  insertPendingSentFiles,
  isStorageRetryKey,
  keptSentFiles,
  pendingSentFiles,
  sentUploadState,
  storageRetryAdd,
  takeRateLimit,
  withOrgContext,
  type RateLimit,
  type SentFileRecord,
} from '@buhuchet/db';
import {
  FILE_MAX_BYTES,
  FILE_MESSAGES,
  FILE_SNIFF_BYTES,
  FILE_UPLOAD_LINK_SECONDS,
  fileContentProblem,
  fileContentType,
  isPageAddress,
  sentFileNote,
  sentFileRefusalText,
  sentFilesSendRefusal,
  sentUploadKey,
  sentUploadOn,
  type SentFileRefusal,
} from '@buhuchet/domain';
import {
  PageSentComplete,
  PageSentDone,
  PageSentStart,
  PageSentTicket,
  PublicPageParams,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import { subscriptionToday } from '../../subscription-access';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { pageAccess } from '../contractor-page/org-closed';
import { clientIpHash, pageTokenHash } from '../contractor-page/public';
import { bellContractor } from '../telegram/bell';
import { error } from './files';
import {
  finishSentFiles,
  notifySentFiles,
  SentFilesRefused,
  sentFileKey,
  sentLimitCheck,
} from './sent-add';
import { removeStoredObjects } from './storage-retry';

/*
 * «Отправить файл» на странице контрагента по ссылке (доработки 14.11.2026, блок 2; прототип v112
 * `pubUpDlg`): без входа, только в браузере, где страница открыта по коду (cookie этой ссылки), — как
 * файлы и Telegram страницы. Файл идёт мимо API: браузер кладёт его в хранилище по подписанной ссылке на
 * 2 минуты (под ключ загрузки `sentUploadKey`), «закончить» копирует его, сверяет размер и тип копии по
 * содержимому и делает файлы «Новыми». Всё, что страница не может делать, — одинаково «Страница
 * недоступна».
 */

/** Начатые отправки браузера за час: не больше 30 (сами файлы — ещё и 20 в сутки на контрагента). */
export const PAGE_SENT_RATE_LIMIT: RateLimit = { kind: 'cp_sent', max: 30, windowSeconds: 3600 };
/** Начатые отправки с одного адреса за час — со всех страниц вместе. */
export const PAGE_SENT_IP_RATE_LIMIT: RateLimit = {
  kind: 'cp_sent_ip',
  max: 60,
  windowSeconds: 3600,
};

const unavailable = (): never =>
  apiFail(404, 'page_unavailable', 'Страница недоступна. Обратитесь к вашему бухгалтеру.');

/** Отказ отправки: код, текст и подстановки (`files`, `n`) для текста словаря на экране. */
export function refuse(status: 400 | 409 | 429, r: SentFileRefusal): never {
  return apiFail(status, r.code, sentFileRefusalText(r), {
    ...(r.files ? { files: r.files.join(', ') } : {}),
    ...(r.n !== undefined ? { n: r.n } : {}),
  });
}

export const REFUSAL_STATUS: Record<SentFileRefusal['code'], 400 | 409 | 429> = {
  sent_none: 400,
  sent_too_many: 400,
  sent_too_large: 400,
  sent_forbidden: 400,
  sent_name_invalid: 400,
  sent_day_left: 429,
  sent_day_limit: 429,
  sent_off: 409,
  sent_reason_empty: 400,
  sent_reason_long: 400,
  sent_decided: 409,
  sent_mem_full: 409,
};

/** Открытая страница этого браузера: организация и контрагент; иначе — «Страница недоступна». */
export async function openPage(deps: ApiDeps, c: Context<AppEnv>, slug: string, inn: string) {
  c.header('Cache-Control', 'no-store');
  if (!isPageAddress(slug, inn)) return unavailable();
  const grantHash = pageTokenHash(c, deps);
  if (!grantHash) return unavailable();
  // Доступ организации закрыт по подписке — тоже «Страница недоступна» (п. К-24).
  const state = await pageAccess(deps, slug, inn, grantHash);
  if (state.state !== 'open') return unavailable();
  return { orgId: state.orgId, contractorId: state.contractorId, grantHash };
}

export const pageSentStartRoute = createRoute({
  method: 'post',
  path: '/page/{slug}/{inn}/sent',
  tags: ['files'],
  summary: '«Отправить файл» на странице контрагента: ссылки на хранилище на 2 минуты (без входа)',
  request: {
    params: PublicPageParams,
    body: { required: true, content: { 'application/json': { schema: PageSentStart } } },
  },
  responses: {
    201: {
      description: 'Отправка начата: куда и с какими заголовками положить каждый файл',
      content: { 'application/json': { schema: PageSentTicket } },
    },
    400: {
      description:
        'Ни одного файла, больше 10, файл больше 20 МБ, такие файлы не принимаются, неверное имя',
      content: error,
    },
    404: {
      description: 'Страница недоступна или не открыта в этом браузере (нет кода)',
      content: error,
    },
    409: {
      description:
        'Контрагенту сейчас нельзя отправлять файлы или память организации заполнена (`sent_mem_full`)',
      content: error,
    },
    429: { description: 'Больше 20 файлов в сутки или слишком много отправок', content: error },
  },
});

/**
 * Начать отправку: проверить файлы, страницу, галочки и лимиты, завести строки загрузки и подписать
 * ссылки на хранилище с этим размером и типом. Файлы станут «Новыми» после `…/sent/complete`.
 */
export function pageSentStartHandler(
  deps: ApiDeps,
): RouteHandler<typeof pageSentStartRoute, AppEnv> {
  return async (c) => {
    const { slug, inn } = c.req.valid('param');
    const body = c.req.valid('json');
    const page = await openPage(deps, c, slug, inn);
    const files = body.files.map((f) => ({ name: f.name.trim(), size: f.size }));
    const first = sentFilesSendRefusal(files, 0);
    if (first) refuse(REFUSAL_STATUS[first.code], first);
    const slot = await takeRateLimit(deps.db, PAGE_SENT_RATE_LIMIT, page.grantHash);
    const ipSlot = slot.ok
      ? await takeRateLimit(deps.db, PAGE_SENT_IP_RATE_LIMIT, clientIpHash(c, deps))
      : slot;
    if (!slot.ok || !ipSlot.ok) {
      apiFail(429, 'file_upload_limit', FILE_MESSAGES.file_upload_limit);
    }
    const comment = sentFileNote(body.comment ?? '') || null;
    const today = subscriptionToday(deps);
    const rows = files.map((f) => {
      const id = randomUUID();
      return {
        id,
        contractorId: page.contractorId,
        source: 'page' as const,
        comment,
        name: f.name,
        contentType: fileContentType(f.name),
        sizeBytes: f.size,
        storageKey: sentFileKey(page.orgId, id),
      };
    });
    try {
      await withOrgContext(deps.db, { orgId: page.orgId, userId: null }, async (tx) => {
        await sentLimitCheck(tx, page.contractorId, files, today);
        await insertPendingSentFiles(tx, rows);
      });
    } catch (err) {
      if (err instanceof SentFilesRefused) refuse(REFUSAL_STATUS[err.refusal.code], err.refusal);
      throw err;
    }
    // Срок — по настоящим часам: подпись хранилища ставит их же, а не часы демо-стенда (FIXED_NOW).
    const expiresAt = new Date(Date.now() + FILE_UPLOAD_LINK_SECONDS * 1000).toISOString();
    const items = [];
    for (const row of rows) {
      // Ссылка — на ключ загрузки, не на ключ файла: после проверки её ещё можно использовать.
      const upload = await deps.storage.signedUploadUrl(sentUploadKey(row.storageKey), {
        expiresInSeconds: FILE_UPLOAD_LINK_SECONDS,
        contentType: row.contentType,
        size: row.sizeBytes,
      });
      items.push({
        id: row.id,
        upload: { url: upload.url, method: 'PUT' as const, headers: upload.headers, expiresAt },
      });
    }
    return c.json({ items }, 201);
  };
}

export const pageSentCompleteRoute = createRoute({
  method: 'post',
  path: '/page/{slug}/{inn}/sent/complete',
  tags: ['files'],
  summary: 'Закончить отправку со страницы контрагента: файлы проверены и «Новые» (без входа)',
  request: {
    params: PublicPageParams,
    body: { required: true, content: { 'application/json': { schema: PageSentComplete } } },
  },
  responses: {
    200: {
      description: 'Файлы получил бухгалтер: они «Новые» в карточке контрагента',
      content: { 'application/json': { schema: PageSentDone } },
    },
    400: {
      description: 'Файл больше 20 МБ или такие файлы не принимаются (по содержимому)',
      content: error,
    },
    404: {
      description: 'Страница недоступна, не открыта в этом браузере или нет таких начатых отправок',
      content: error,
    },
    409: {
      description: 'Файл не дошёл до хранилища или контрагенту сейчас нельзя отправлять файлы',
      content: error,
    },
  },
});

type StoredProblem = 'missing' | 'large' | 'content';

/** Ключ проверочной копии: свой у каждого запроса, ссылки на него нет ни у кого. */
const checkKeyOf = (row: SentFileRecord) => `${row.storageKey}.chk-${randomUUID()}`;

/**
 * Копия загруженного файла под ключом проверки и что с ней не так: не дошёл, не тот размер или тип,
 * другое содержимое. Проверяется копия, а не загрузка: загрузку по ссылке можно перезаписать, копию —
 * нет.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#И-7
async function checkedCopy(
  deps: ApiDeps,
  row: SentFileRecord,
  checkKey: string,
): Promise<StoredProblem | null> {
  if (!(await deps.storage.copy(sentUploadKey(row.storageKey), checkKey))) return 'missing';
  const stored = await deps.storage.stat(checkKey);
  if (!stored) return 'missing';
  if (stored.size > FILE_MAX_BYTES) return 'large';
  if (stored.size !== row.sizeBytes || stored.contentType !== row.contentType) return 'missing';
  const head = await deps.storage.getRange(checkKey, 0, FILE_SNIFF_BYTES);
  if (!head) return 'missing';
  return fileContentProblem(row.name, head) ? 'content' : null;
}

/**
 * Удалить объекты хранилища; не вышло — в журнал и на повторное удаление (загрузку `.up` и проверочную
 * копию `.chk-…` задача по сроку не найдёт: строки у них нет).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#И-10
export async function removeObjects(deps: ApiDeps, keys: readonly string[]): Promise<void> {
  await removeStoredObjects(deps, keys, 'файлы от контрагентов: загрузка со страницы');
}

/**
 * Отправку не приняли после того, как её файлы легли под ключи файлов (выключили отправку, сбой
 * транзакции «закончить», опоздали к уже законченной): удалить только ничьи файлы (`keptSentFiles`).
 * Незаконченная строка остаётся со своим файлом задаче по расписанию: её мог закончить другой такой
 * же запрос того же браузера, а по ещё живой ссылке могут заново положить загрузку — задача удалит
 * обе вместе со строкой. «Новые» — файл того, кто их закончил. Сбой самой проверки не прячет исходный
 * отказ: файлы идут на повторное удаление, а оно само снимает ключи живых строк (те же правила).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#И-10
async function dropUnfinished(
  deps: ApiDeps,
  ctx: { orgId: string; userId: null },
  rows: readonly SentFileRecord[],
  written: readonly string[],
): Promise<void> {
  if (!written.length) return;
  try {
    const kept = await withOrgContext(deps.db, ctx, (tx) =>
      keptSentFiles(
        tx,
        rows.map((r) => r.id),
      ),
    );
    const own = new Set(written);
    await removeObjects(
      deps,
      rows.filter((r) => own.has(r.storageKey) && !kept.has(r.id)).map((r) => r.storageKey),
    );
  } catch (err) {
    deps.logger.error({ err }, 'файлы от контрагентов: положенные файлы не проверены после отказа');
    await storageRetryAdd(deps.db, written.filter(isStorageRetryKey)).catch((e: unknown) =>
      deps.logger.error(
        { err: e },
        'файлы от контрагентов: файлы не поставлены на повторное удаление',
      ),
    );
  }
}

/**
 * Проверить загруженные со страницы файлы и положить каждый под ключ файла (для «Отправить файл» и
 * «Я оплатил», блок 6): проверяется копия каждого файла, и под ключ файла ложится только она. Хоть один
 * не такой — отказ целиком (положенное удаляется), ответ называет плохие файлы. Загрузки и проверочные
 * копии удаляются в любом случае. Возвращает положенные ключи — их удаляет вызывающий, если отправку
 * потом не приняли.
 */
export async function storePageUploads(
  deps: ApiDeps,
  rows: readonly SentFileRecord[],
): Promise<string[]> {
  const checkKeys = rows.map(checkKeyOf);
  const problems: (StoredProblem | null)[] = [];
  const written: string[] = [];
  try {
    // Все копии — до конца, даже если одна упала: иначе уборка ниже пройдёт раньше, чем остальные
    // положат свои проверочные копии, и они останутся в хранилище.
    const checked = await Promise.allSettled(
      rows.map((r, i) => checkedCopy(deps, r, checkKeys[i]!)),
    );
    for (const one of checked) {
      if (one.status === 'rejected') throw one.reason;
      problems.push(one.value);
    }
    if (!problems.some((p) => p !== null)) {
      for (const [i, row] of rows.entries()) {
        if (!(await deps.storage.copy(checkKeys[i]!, row.storageKey))) {
          problems[i] = 'missing';
          break;
        }
        written.push(row.storageKey);
      }
    }
  } finally {
    // Загрузки и проверочные копии больше не нужны (загрузку по ссылке ещё могут положить заново —
    // её удалит задача по расписанию вместе со строкой).
    await removeObjects(deps, [...rows.map((r) => sentUploadKey(r.storageKey)), ...checkKeys]);
  }
  const named = (p: StoredProblem) => rows.filter((_, i) => problems[i] === p).map((r) => r.name);
  if (problems.some((p) => p !== null)) {
    await removeObjects(deps, written);
    if (named('content').length) refuse(400, { code: 'sent_forbidden', files: named('content') });
    if (named('large').length) refuse(400, { code: 'sent_too_large', files: named('large') });
    apiFail(409, 'file_not_uploaded', FILE_MESSAGES.file_not_uploaded);
  }
  return written;
}

/**
 * Закончить отправку: все файлы лежат в хранилище, их размер — заявленный, содержимое — того типа, что
 * в имени, и это не программа и не веб-страница. Проверяется копия каждого файла, и под ключ файла
 * ложится только она. Хоть один не такой — отправка не принимается целиком: ответ называет плохие
 * файлы, загрузки остаются незаконченными (их и оставшиеся файлы удалит задача по расписанию, а до
 * того они занимают место в пределе за сутки). Иначе — «Новые», история и сообщение ответственному.
 */
export function pageSentCompleteHandler(
  deps: ApiDeps,
): RouteHandler<typeof pageSentCompleteRoute, AppEnv> {
  return async (c) => {
    const { slug, inn } = c.req.valid('param');
    const { ids } = c.req.valid('json');
    const page = await openPage(deps, c, slug, inn);
    const ctx = { orgId: page.orgId, userId: null };
    const unique = [...new Set(ids)];
    const rows = await withOrgContext(deps.db, ctx, (tx) =>
      pendingSentFiles(tx, page.contractorId, unique),
    );
    if (rows.length !== unique.length) {
      return apiFail(404, 'not_found', 'Нет такой начатой отправки');
    }
    const written = await storePageUploads(deps, rows);
    // Строка не «Новая» после ошибки — незаконченная: её файлы удалит задача по расписанию (её не
    // встретит «закончить»: `SENT_COMPLETE_MINUTES`); закончила другая такая же отправка — файл её.
    const done = await withOrgContext(deps.db, ctx, async (tx) => {
      // Галочку могли выключить, пока файл загружался: тогда отправка не принимается.
      const state = await sentUploadState(tx, page.contractorId);
      if (!state || !sentUploadOn(state)) return false;
      await finishSentFiles(tx, {
        contractorId: page.contractorId,
        ids: rows.map((r) => r.id),
        names: rows.map((r) => r.name),
        source: 'page',
        comment: rows[0]!.comment,
      });
      await bellContractor(deps, tx, page.contractorId, {
        event: 'cp_file',
        sendId: rows[0]!.id,
        n: rows.length,
      });
      return true;
    }).catch(async (e: unknown) => {
      await dropUnfinished(deps, ctx, rows, written);
      throw e;
    });
    if (!done) {
      await dropUnfinished(deps, ctx, rows, written);
      refuse(409, { code: 'sent_off' });
    }
    await notifySentFiles(
      deps,
      page.orgId,
      page.contractorId,
      rows.map((r) => r.name),
    );
    return c.json({ sent: rows.length }, 200);
  };
}
