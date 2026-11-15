import { randomUUID } from 'node:crypto';
import { createRoute, type RouteHandler, type z } from '@hono/zod-openapi';
import {
  contractorPageOrg,
  contractorPageTarget,
  getContractorPage,
  getSentFile,
  insertPagePayClaim,
  insertPendingSentFiles,
  loadEmployeeAccess,
  markSentFilesReady,
  pageContractorFacts,
  pendingSentFiles,
  releaseRateLimit,
  sentUploadState,
  takeRateLimit,
  withOrgContext,
  writeContractorPageHistory,
  type RateLimit,
  type SentFileRecord,
  type Tx,
} from '@buhuchet/db';
import {
  bishkekDate,
  FILE_MESSAGES,
  FILE_UPLOAD_LINK_SECONDS,
  fileContentType,
  formatSomWithUnit,
  isPageAddress,
  monthLabel,
  PAGE_CODE_TG_MAX,
  pageOpenMonths,
  pagePaidProblems,
  pagePaidSentNote,
  pageVisibleSections,
  sentFileNote,
  sentUploadKey,
  sentUploadOn,
  type IsoDate,
  type PayClaimPurpose,
  type Translate,
  type YearMonth,
} from '@buhuchet/domain';
import {
  ApiError,
  PageForgot,
  PagePaidComplete,
  PagePaidDone,
  PagePaidStart,
  PageSentTicket,
  PublicPageParams,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { translateOf } from '../contractors/common';
import {
  openPage,
  PAGE_SENT_IP_RATE_LIMIT,
  PAGE_SENT_RATE_LIMIT,
  refuse,
  REFUSAL_STATUS,
  removeObjects,
  storePageUploads,
} from '../files/sent-page';
import { SentFilesRefused, sentFileKey, sentLimitCheck } from '../files/sent-add';
import { botText } from '../telegram/bot';
import { sendPageCode } from '../telegram/client/code';
import { flushEvents } from '../telegram/outbox';
import { queueStaffNotice, seesFee } from '../telegram/client/pay';
import { clientIpHash } from './public';
import { contractorPageBody } from './view';

/*
 * «Я оплатил» и «Забыли код? Прислать в Telegram» на странице контрагента по ссылке (доработки
 * 14.11.2026, блок 6, этап 3, поток К; прототип v116 modules/cp-paid.js `pubPaidDlg`, `pubForgot`).
 *
 * «Я оплатил» — это не оплата: клиент сообщает, что перевёл деньги, и прикладывает чек. Чек — файл
 * «Отправленных файлов» со статусом «Новый» (тот же путь, что «Отправить файл»: подписанная ссылка на
 * хранилище, проверка копии), сообщение об оплате ждёт, пока бухгалтер не примет деньги этого вида или
 * не отклонит чек. Что можно сообщить (карточка «Как оплатить», месяцы с остатком) считает сервер по
 * тем же разделам, что видит клиент: скрытый раздел ничего не открывает.
 */

const error = { 'application/json': { schema: ApiError } };

const unavailable = (): never =>
  apiFail(404, 'page_unavailable', 'Страница недоступна. Обратитесь к вашему бухгалтеру.');

/** Что клиент может сообщить об оплате: те же разделы и суммы, что на его странице. */
interface PaidContext {
  /** Можно отправлять файлы со страницы (прототип `pgPaidOn` = `sntUpOn`). */
  upload: boolean;
  /** Карточка «Как оплатить» этого назначения показана (у неё есть строка «Я оплатил»). */
  card: Record<PayClaimPurpose, boolean>;
  /** Месяцы с остатком к оплате налогов (прототип `pgOpenMonths`) и с долгом за обслуживание. */
  months: Record<PayClaimPurpose, YearMonth[]>;
  responsibleEmployeeId: string | null;
}

async function paidContext(
  tx: Tx,
  o: { orgId: string; contractorId: string; today: IsoDate; t: Translate },
): Promise<PaidContext | null> {
  const org = await contractorPageOrg(tx, o.orgId);
  const own = await getContractorPage(tx, o.contractorId);
  const facts = await pageContractorFacts(tx, o.contractorId);
  if (!org || !own || !facts) return null;
  const state = await sentUploadState(tx, o.contractorId);
  const upload = !!state && sentUploadOn(state);
  const empty = { tax: [], fee: [] };
  const base = { responsibleEmployeeId: facts.responsibleEmployeeId };
  if (!upload) return { upload, card: { tax: false, fee: false }, months: empty, ...base };
  const sections = pageVisibleSections(org.pageSections, org.features, own.hiddenSections);
  const body = await contractorPageBody(tx, {
    orgId: o.orgId,
    contractorId: o.contractorId,
    sections,
    features: org.features,
    today: o.today,
    t: o.t,
  });
  if (!body) return null;
  return {
    upload,
    card: { tax: !!body.pay?.tax, fee: !!body.pay?.fee },
    months: {
      // ОТКЛОНЕНИЕ: docs/deviations.md#К-14 — месяцы налогов только при показанных «Отчётах»: иначе
      // «За какой месяц — осталось …» открыл бы суммы скрытого раздела.
      tax: pageOpenMonths(body.reports?.months ?? []).map((m) => m.month),
      fee: (body.fee?.months ?? [])
        .filter((m) => m.charge - m.got > 0)
        .map((m) => m.month)
        .sort(),
    },
    ...base,
  };
}

/** Что неверно в «Я оплатил» — 400 с полем и кодом текста `pub.paid.err.<код>`. */
function checkPaid(
  ctx: PaidContext | null,
  o: {
    purpose: PayClaimPurpose;
    month: YearMonth | null;
    amount: number;
    file: { name: string; size: number };
  },
): PaidContext {
  if (!ctx) return unavailable();
  // Галочку «Отправлять файлы» выключили, пока окно было открыто (прототип: тост и окно не открыть).
  if (!ctx.upload) {
    return apiFail(409, 'page_paid_off', 'Ваш бухгалтер сейчас не принимает файлы через страницу');
  }
  if (!ctx.card[o.purpose]) return unavailable();
  const [problem] = pagePaidProblems({ ...o, months: ctx.months[o.purpose] });
  if (problem) {
    return apiFail(400, 'page_paid_invalid', 'Проверьте поля «Я оплатил»', {
      field: problem.field,
      problem: problem.code,
    });
  }
  return ctx;
}

/**
 * Комментарий чека в «Отправленных файлах»: «Чек: налоги за сентябрь 2026. <комментарий>» — без суммы.
 * Его видят все, кому видны «Отправленные файлы», а сумма налогов и платы за обслуживание — только тем,
 * кто может принять эти деньги (`payFor`), поэтому она остаётся в сообщении об оплате.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#К-14
const paidNote = (
  t: Translate,
  purpose: PayClaimPurpose,
  month: YearMonth | null,
  comment: string | null,
) =>
  pagePaidSentNote(
    month
      ? t(`pub.paid.note.${purpose}_month`, { month: monthLabel(month).toLowerCase() })
      : t(`pub.paid.note.${purpose}`),
    comment,
  );

export const pagePaidStartRoute = createRoute({
  method: 'post',
  path: '/page/{slug}/{inn}/paid',
  tags: ['contractor-page'],
  summary: '«Я оплатил» на странице контрагента: ссылка на хранилище для чека (без входа)',
  request: {
    params: PublicPageParams,
    body: { required: true, content: { 'application/json': { schema: PagePaidStart } } },
  },
  responses: {
    201: {
      description: 'Чек можно положить в хранилище: куда и с какими заголовками (2 минуты)',
      content: { 'application/json': { schema: PageSentTicket } },
    },
    400: {
      description:
        'Сумма не больше нуля или слишком большая, месяц не из списка, нет чека, чек не фото и не PDF или больше 20 МБ (`page_paid_invalid`: поле и код в `details`)',
      content: error,
    },
    404: {
      description: 'Страница недоступна, не открыта в этом браузере или «Как оплатить» не показан',
      content: error,
    },
    409: { description: 'Контрагенту сейчас нельзя отправлять файлы', content: error },
    429: { description: 'Больше 20 файлов в сутки или слишком много отправок', content: error },
  },
});

/**
 * Начать «Я оплатил»: страница этого браузера, что можно сообщить, пределы файлов и частоты — как у
 * «Отправить файл»; чек — незаконченная загрузка с комментарием «Чек: …» без суммы. Сообщение об оплате появится
 * после `…/paid/complete`.
 */
export function pagePaidStartHandler(
  deps: ApiDeps,
): RouteHandler<typeof pagePaidStartRoute, AppEnv> {
  return async (c) => {
    const { slug, inn } = c.req.valid('param');
    const body = c.req.valid('json');
    const page = await openPage(deps, c, slug, inn);
    const file = { name: body.file.name.trim(), size: body.file.size };
    const slot = await takeRateLimit(deps.db, PAGE_SENT_RATE_LIMIT, page.grantHash);
    const ipSlot = slot.ok
      ? await takeRateLimit(deps.db, PAGE_SENT_IP_RATE_LIMIT, clientIpHash(c, deps))
      : slot;
    if (!slot.ok || !ipSlot.ok) {
      apiFail(429, 'file_upload_limit', FILE_MESSAGES.file_upload_limit);
    }
    const t = await translateOf(deps);
    const today = bishkekDate(deps.clock.now());
    const comment = sentFileNote(body.comment ?? '') || null;
    const id = randomUUID();
    const row = {
      id,
      contractorId: page.contractorId,
      source: 'page' as const,
      comment: paidNote(t, body.purpose, body.month, comment),
      name: file.name,
      contentType: fileContentType(file.name),
      sizeBytes: file.size,
      storageKey: sentFileKey(page.orgId, id),
    };
    try {
      await withOrgContext(deps.db, { orgId: page.orgId, userId: null }, async (tx) => {
        const ctx = await paidContext(tx, { ...page, today, t });
        checkPaid(ctx, { ...body, file });
        await sentLimitCheck(tx, page.contractorId, [file]);
        await insertPendingSentFiles(tx, [row]);
      });
    } catch (err) {
      if (err instanceof SentFilesRefused) refuse(REFUSAL_STATUS[err.refusal.code], err.refusal);
      throw err;
    }
    // Срок — по настоящим часам: подпись хранилища ставит их же (как у «Отправить файл»).
    const expiresAt = new Date(Date.now() + FILE_UPLOAD_LINK_SECONDS * 1000).toISOString();
    const upload = await deps.storage.signedUploadUrl(sentUploadKey(row.storageKey), {
      expiresInSeconds: FILE_UPLOAD_LINK_SECONDS,
      contentType: row.contentType,
      size: row.sizeBytes,
    });
    return c.json(
      {
        items: [
          {
            id,
            upload: { url: upload.url, method: 'PUT' as const, headers: upload.headers, expiresAt },
          },
        ],
      },
      201,
    );
  };
}

export const pagePaidCompleteRoute = createRoute({
  method: 'post',
  path: '/page/{slug}/{inn}/paid/complete',
  tags: ['contractor-page'],
  summary: 'Закончить «Я оплатил»: чек «Новый», сообщение об оплате ждёт подтверждения (без входа)',
  request: {
    params: PublicPageParams,
    body: { required: true, content: { 'application/json': { schema: PagePaidComplete } } },
  },
  responses: {
    200: {
      description: 'Сообщение об оплате и чек отправлены бухгалтеру',
      content: { 'application/json': { schema: PagePaidDone } },
    },
    400: {
      description:
        'Поля «Я оплатил» больше не подходят, чек больше 20 МБ или не фото и не PDF (по содержимому)',
      content: error,
    },
    404: {
      description: 'Страница недоступна, не открыта в этом браузере или нет такого начатого чека',
      content: error,
    },
    409: {
      description:
        'Чек не дошёл до хранилища, этот чек уже отправляется или контрагенту сейчас нельзя отправлять файлы',
      content: error,
    },
    429: { description: 'Слишком много попыток закончить этот чек', content: error },
  },
});

/**
 * «Закончить» одного чека — по одному (`leaseSeconds`: пока чек кладётся в хранилище, второй такой же
 * запрос — «уже отправляется»): второй не удалит положенный первым чек, если сам получит отказ.
 */
export const PAGE_PAID_COMPLETE_ONCE: RateLimit = {
  kind: 'cp_paid_done',
  max: 10,
  windowSeconds: 3600,
  leaseSeconds: 300,
};

/**
 * Закончить «Я оплатил»: чек этого браузера с тем же назначением и месяцем (комментарий чека совпадает
 * с посчитанным заново), проверка копии чека, затем одной транзакцией — чек «Новый», сообщение об
 * оплате «ждёт подтверждения» с этим чеком и запись в историю от имени контрагента. Ответственному —
 * сообщение в Telegram после транзакции (прототип `tgSvc(…, 'Контрагент сообщил об оплате')`).
 */
export function pagePaidCompleteHandler(
  deps: ApiDeps,
): RouteHandler<typeof pagePaidCompleteRoute, AppEnv> {
  return async (c) => {
    const { slug, inn } = c.req.valid('param');
    const body = c.req.valid('json');
    const page = await openPage(deps, c, slug, inn);
    const lease = await takeRateLimit(deps.db, PAGE_PAID_COMPLETE_ONCE, body.id);
    if (!lease.ok) {
      if (lease.reason === 'busy') apiFail(409, 'page_paid_busy', 'Этот чек уже отправляется');
      apiFail(429, 'file_upload_limit', FILE_MESSAGES.file_upload_limit);
    }
    try {
      return await completePaid(deps, c, page, body);
    } finally {
      await releaseRateLimit(deps.db, PAGE_PAID_COMPLETE_ONCE, body.id, lease.ticket);
    }
  };
}

async function completePaid(
  deps: ApiDeps,
  c: Parameters<RouteHandler<typeof pagePaidCompleteRoute, AppEnv>>[0],
  page: Awaited<ReturnType<typeof openPage>>,
  body: z.infer<typeof PagePaidComplete>,
) {
  const ctxDb = { orgId: page.orgId, userId: null };
  const t = await translateOf(deps);
  const today = bishkekDate(deps.clock.now());
  const comment = sentFileNote(body.comment ?? '') || null;
  const note = paidNote(t, body.purpose, body.month, comment);
  const ownRow = (rows: SentFileRecord[]) => {
    const row = rows[0];
    // Чек начат не этим «Я оплатил» (другие назначение и месяц или обычная отправка) — его нет;
    // сумму заново проверяет `checkPaid`.
    if (!row || row.comment !== note) return apiFail(404, 'not_found', 'Нет такого начатого чека');
    return row;
  };
  const row = await withOrgContext(deps.db, ctxDb, async (tx) => {
    const found = ownRow(await pendingSentFiles(tx, page.contractorId, [body.id]));
    checkPaid(await paidContext(tx, { ...page, today, t }), {
      ...body,
      file: { name: found.name, size: found.sizeBytes },
    });
    return found;
  });
  const written = await storePageUploads(deps, [row]);
  // Чек уже «Новый» (его закончил другой запрос, когда аренда истекла) — объект его, не удалять.
  const dropWritten = async () => {
    const now = await withOrgContext(deps.db, ctxDb, (tx) => getSentFile(tx, row.id));
    if (now?.state !== 'ready') await removeObjects(deps, written);
  };
  const what = (purpose: PayClaimPurpose, month: YearMonth | null) =>
    month
      ? t(`pub.paid.staff.${purpose}_month`, { month: monthLabel(month) })
      : t(`pub.paid.staff.${purpose}`);
  // Отказ после загрузки (страницу или раздел скрыли, месяц оплачен) — положенный чек удаляется.
  const done = await withOrgContext(deps.db, ctxDb, async (tx) => {
    // Галочку могли выключить, пока чек загружался: тогда сообщение не принимается.
    const ctx = await paidContext(tx, { ...page, today, t });
    if (!ctx?.upload) return null;
    ownRow(await pendingSentFiles(tx, page.contractorId, [row.id]));
    // Раздел и месяцы — заново: за время загрузки «Как оплатить» могли скрыть, месяц — оплатить.
    checkPaid(ctx, { ...body, file: { name: row.name, size: row.sizeBytes } });
    // Чек — «Новый»: в «Отправленных файлах» его видно с комментарием «Чек: …» (как в прототипе,
    // одна запись истории — об оплате).
    await markSentFilesReady(tx, [row.id]);
    await insertPagePayClaim(tx, {
      contractorId: page.contractorId,
      purpose: body.purpose,
      month: body.month,
      amount: body.amount,
      comment,
      sentFileId: row.id,
    });
    await writeContractorPageHistory(tx, page.contractorId, 'page_paid', {
      changes: [
        {
          field: body.purpose === 'tax' ? 'pagePaid' : 'pagePaidFee',
          to: {
            purpose: body.purpose,
            month: body.month,
            amount: body.amount,
            file: row.name,
            note: comment,
          },
        },
      ],
    });
    return queueStaffNotice(
      tx,
      deps,
      page.contractorId,
      t('cppage.tg.staff.paid_heading'),
      (contractor) =>
        botText(
          deps,
          'tgCpPagePaidStaff',
          {
            контрагент: contractor,
            что: what(body.purpose, body.month),
            сумма: formatSomWithUnit(body.amount),
          },
          tx,
        ),
      // ОТКЛОНЕНИЕ: docs/deviations.md#К-10 — сумма платы за обслуживание только тому, кто её видит.
      body.purpose === 'fee'
        ? {
            allowed: async (employeeId) =>
              seesFee(await loadEmployeeAccess(tx, employeeId), {
                responsibleEmployeeId: ctx.responsibleEmployeeId,
              }),
          }
        : {},
    );
  }).catch(async (e: unknown) => {
    await dropWritten();
    throw e;
  });
  if (!done) {
    await dropWritten();
    refuse(409, { code: 'sent_off' });
  }
  await flushEvents(deps, page.orgId, done);
  return c.json({ ok: true as const }, 200);
}

/** «Забыли код?» с одного адреса за час — со всех страниц вместе. */
export const PAGE_FORGOT_IP_RATE_LIMIT: RateLimit = {
  kind: 'cp_forgot_ip',
  max: 10,
  windowSeconds: 3600,
};

export const pageForgotRoute = createRoute({
  method: 'post',
  path: '/page/{slug}/{inn}/forgot',
  tags: ['contractor-page'],
  summary: '«Забыли код? Прислать в Telegram» на странице контрагента (без входа)',
  request: { params: PublicPageParams },
  responses: {
    200: {
      description:
        'Код отправлен в подключённый Telegram (`sent`), Telegram не подключён (`none`), уже присылали 3 раза за сутки (`limit`) или страница закрыта (`closed`)',
      content: { 'application/json': { schema: PageForgot } },
    },
    404: { description: '«Страница недоступна»', content: error },
    429: { description: 'Слишком много запросов с этого адреса', content: error },
  },
});

/**
 * «Забыли код?» (прототип `pubForgot`): код уходит только в Telegram, подключённый к этой странице, —
 * в ответе нет ни кода, ни имён чатов, только итог. Неизвестная, выключенная или архивная страница —
 * «Страница недоступна», как у ввода кода.
 */
export function pageForgotHandler(deps: ApiDeps): RouteHandler<typeof pageForgotRoute, AppEnv> {
  return async (c) => {
    const { slug, inn } = c.req.valid('param');
    c.header('Cache-Control', 'no-store');
    if (!isPageAddress(slug, inn)) return unavailable();
    // Предел с адреса — до поиска страницы: подбор адресов и ИНН тоже его тратит.
    const ip = await takeRateLimit(deps.db, PAGE_FORGOT_IP_RATE_LIMIT, clientIpHash(c, deps));
    if (!ip.ok) {
      return apiFail(
        429,
        'page_forgot_limit',
        'Слишком много запросов. Попробуйте позже или спросите код у вашего бухгалтера',
      );
    }
    const target = await contractorPageTarget(deps.db, slug, inn);
    if (!target) return unavailable();
    const r = await sendPageCode(deps, { ...target, via: 'page' });
    if (r.outcome === 'unavailable') return unavailable();
    return c.json({ outcome: r.outcome, limit: PAGE_CODE_TG_MAX }, 200);
  };
}
