import { randomUUID } from 'node:crypto';
import { orgFileKey } from '@buhuchet/adapters';
import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  acceptSentFile,
  contractorDocumentNames,
  exportSentFiles,
  getContractorPage,
  getSentFile,
  listContractorSentFiles,
  listSentFilesPage,
  listSentFileValues,
  orgMenuSettings,
  rejectReceiptClaims,
  rejectSentFile,
  SentFileDecidedError,
  sentContractor,
  sentFilePays,
  sentFilesNewCount,
  sentReceiptTargetDate,
  sentUploadState,
  updateWithHistory,
  withOrgContext,
  writeHistory,
  schema,
  type ListTexts,
  type SentFilePay,
  type SentFileRecord,
  type Tx,
} from '@buhuchet/db';
import {
  acceptedFileName,
  bishkekDate,
  canSeeContractor,
  FILE_LINK_SECONDS,
  FILE_MESSAGES,
  filePreviewKind,
  hasPermission,
  PAGE_MESSAGES,
  pageManageRefusal,
  pageOrgSections,
  SENT_FILE_MESSAGES,
  sentFileDaysLeft,
  sentFileReason,
  sentUploadKey,
  type AccessSubject,
  type Feature,
  type IsoDate,
} from '@buhuchet/domain';
import {
  FileLink,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  SentContractorParam,
  SentFileAccept,
  SentFileAccepted,
  SentFileCount,
  type SentFileDecided,
  SentFileIdParam,
  SentFileItem,
  SentFileLinkQuery,
  SentFileList,
  SentFileListPage,
  SentFileReject,
  SentUploadState,
  SentUploadSwitch,
  type SentFileItem as SentFileItemBody,
} from '@buhuchet/shared';
import type { Context } from 'hono';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses, versionedSaveResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { orgContextOf, requireEmployee, requirePermission } from '../../middleware/access';
import { contractorOf } from '../contractor-page/card';
import { serverTexts } from '../l10n/texts';
import {
  canUpload,
  error,
  FILES_SECTION,
  realNow,
  requireFilesFeature,
  subjectOf,
  visibleSource,
} from './files';
import { linkTo } from './links';
import type { FileSourceRecord } from './sources';
import { filesScopeOf } from './manager';
import { removeStoredObjects } from './storage-retry';

/*
 * Файлы от контрагентов глазами сотрудника (доработки 14.11.2026, блок 2; прототип v112
 * `modules/cp-sent.js`): раздел «Отправленные файлы» карточки контрагента (`sntBox`), вкладка «Файлы от
 * контрагентов» Файлового менеджера (`renderSent`) со счётчиком новых (`sntNew`), «Принять» (`sntAccept`)
 * и «Отклонить» с причиной (`sntRejectDlg`), галочка «Контрагент может отправлять файлы» блока «Страница
 * контрагента» (`pgBox`). Видит право «Просматривать файлы» в области группы «Файловый менеджер»
 * (`sntRows`: `visCps(true,'files')`), решает — ещё и «Загружать файлы» (`sntCan`). Функция «Файлы в
 * карточках» выключена — файлов нет совсем (403 `files_off`); вкладка и счётчик — только при «Странице
 * контрагента по ссылке» (`filesTabs`, `sntNew`).
 */

const notFound = (): never => apiFail(404, 'not_found', 'Файл не найден');

/**
 * «Сегодня» для «Удалится через N дней»: время отправки ставит база по настоящим часам, поэтому и день —
 * по ним, а не по часам демо-стенда (FIXED_NOW); так же считает удаление (`sent-purge.ts`).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#И-7
const sentToday = () => bishkekDate(realNow());
const cppageOff = (): never =>
  apiFail(
    403,
    'cppage_off',
    'Функция «Страница контрагента по ссылке» выключена в учётной политике',
  );

const noAuth = { description: 'Нет входа', content: error };
const offOrNoRight = {
  description:
    'Нет права «Просматривать файлы», выключены «Файлы в карточках» или «Страница контрагента по ссылке»',
  content: error,
};

/** Отправленный файл для ответа: что видит сотрудник и может ли решить по нему. */
function itemOf(
  r: SentFileRecord,
  contractor: { id: string; name: string },
  today: IsoDate,
  canDecide: boolean,
  pay: SentFilePay | null = null,
): SentFileItemBody {
  return {
    id: r.id,
    contractor: { id: contractor.id, name: contractor.name },
    name: r.name,
    contentType: r.contentType,
    size: r.sizeBytes,
    source: r.source,
    senderName: r.source === 'telegram' ? r.senderName : null,
    comment: r.comment,
    status: r.status,
    rejectReason: r.rejectReason,
    decidedBy: r.decidedByName,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    sentAt: r.createdAt.toISOString(),
    sentDate: r.sentDate,
    daysLeft: sentFileDaysLeft(r, today),
    fileId: r.status === 'accepted' ? r.fileId : null,
    canDecide,
    pay: r.status === 'new' && canDecide ? pay : null,
    version: r.version,
  };
}

/**
 * Чек к оплате у нового файла (доработки 14.11.2026, блок 4, пункт 4; прототип v115 `pgRcptMoney`): его
 * сумма уходит только тому, кто может сразу принять эти деньги, — у него «Принять» открывает окно денег,
 * а рядом — «Принять только файл» (доработки 16.11.2026, блок 1; прототип v121 `sntPayOpen`); иначе
 * файл принимается сразу. Налоги —
 * «Учёт оплаты налогов» и право «Учёт денег» в области «Финансовых операций» (как окно «Поступление от
 * контрагента»); обслуживание — «Плата за обслуживание» и права «Видеть плату» и «Менять ставку» в
 * области «Контрагентов» (как «Принять оплату за обслуживание», прототип `feeAccOk`). Контрагент в архиве
 * — без денег.
 */
export function payFor(
  pay: SentFilePay | undefined,
  o: {
    subject: AccessSubject;
    features: Readonly<Record<Feature, boolean>>;
    contractor: { responsibleEmployeeId: string | null; archived: boolean };
  },
): SentFilePay | null {
  if (!pay || o.contractor.archived) return null;
  const { subject, features, contractor } = o;
  const ok =
    pay.purpose === 'tax'
      ? features.taxpay &&
        hasPermission(subject, 'money') &&
        canSeeContractor(subject, 'fin', contractor)
      : features.fee &&
        hasPermission(subject, 'fee') &&
        hasPermission(subject, 'tariff') &&
        canSeeContractor(subject, 'cps', contractor);
  return ok ? pay : null;
}

/** Принять и отклонить — у того, кто видит файл и может загружать файлы (прототип `sntCan`). */
const canDecideOf = (subject: AccessSubject) => hasPermission(subject, 'filesUpload');

/**
 * Загруженный отправленный файл контрагента, которого сотрудник видит в области группы «Файловый
 * менеджер»; иначе — 404 (чужой и вне области не отличить от несуществующего).
 */
export async function visibleSent(tx: Tx, subject: AccessSubject, id: string) {
  const file = await getSentFile(tx, id);
  if (!file || file.state !== 'ready') return notFound();
  const contractor = await sentContractor(tx, file.contractorId);
  if (!contractor || !canSeeContractor(subject, 'files', contractor)) return notFound();
  return { file, contractor };
}

/** Вкладка и счётчик — при «Файлах в карточках» и «Странице контрагента по ссылке». */
export async function requireSentTab(
  tx: Tx,
  orgId: string,
): Promise<Readonly<Record<Feature, boolean>>> {
  const features = await requireFilesFeature(tx, orgId);
  if (!features.cppage) cppageOff();
  return features;
}

/** Чеки среди новых файлов: что оплачено — только тому, кто может сразу принять эти деньги. */
async function paysOf(
  tx: Tx,
  rows: readonly SentFileRecord[],
  o: {
    subject: AccessSubject;
    features: Readonly<Record<Feature, boolean>>;
    contractorOf: (r: SentFileRecord) => {
      responsibleEmployeeId: string | null;
      archived: boolean;
    };
  },
): Promise<Map<string, SentFilePay>> {
  const ids = rows.filter((r) => r.status === 'new').map((r) => r.id);
  const pays = await sentFilePays(tx, ids);
  const out = new Map<string, SentFilePay>();
  for (const r of rows) {
    const pay = payFor(pays.get(r.id), {
      subject: o.subject,
      features: o.features,
      contractor: o.contractorOf(r),
    });
    if (pay) out.set(r.id, pay);
  }
  return out;
}

/**
 * Решение уже принято — 409 `sent_decided` (файл решили, пока сотрудник смотрел): в `details` — кто и
 * как решил, для сообщения окна денег «Чек уже принял <имя> — поступление сохранено без него» (прототип
 * v121 `pgRcptSave`).
 */
function decidedFail(file: SentFileRecord | null): never {
  const details: SentFileDecided | undefined =
    file && file.status !== 'new' ? { status: file.status, by: file.decidedByName } : undefined;
  return apiFail(409, 'sent_decided', SENT_FILE_MESSAGES.sent_decided, details);
}

async function decided<T>(
  deps: ApiDeps,
  ctx: ReturnType<typeof orgContextOf>,
  id: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof SentFileDecidedError) {
      // Транзакция решения откатилась — кто решил, читается заново.
      return decidedFail(await withOrgContext(deps.db, ctx, (tx) => getSentFile(tx, id)));
    }
    throw err;
  }
}

/* ═════════════ Раздел «Отправленные файлы» карточки контрагента ═════════════ */

export const contractorSentRoute = createRoute({
  method: 'get',
  path: '/contractors/{id}/sent-files',
  tags: ['files'],
  summary: '«Отправленные файлы» контрагента: от новых к старым и сколько новых',
  middleware: [requirePermission('filesView')] as const,
  request: { params: SentContractorParam },
  responses: {
    200: {
      description: 'Файлы, которые контрагент прислал со страницы и из Telegram',
      content: { 'application/json': { schema: SentFileList } },
    },
    401: noAuth,
    403: {
      description: 'Нет права «Просматривать файлы» или «Файлы в карточках» выключены',
      content: error,
    },
    404: { description: 'Контрагента нет или он вне области', content: error },
  },
});

export function contractorSentHandler(
  deps: ApiDeps,
): RouteHandler<typeof contractorSentRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const today = sentToday();
    const body = await withOrgContext(deps.db, ctx, async (tx) => {
      const features = await requireFilesFeature(tx, ctx.orgId);
      const contractor = await sentContractor(tx, id);
      if (!contractor || !canSeeContractor(subject, 'files', contractor)) {
        apiFail(404, 'contractor_not_found', 'Контрагент не найден');
      }
      const rows = await listContractorSentFiles(tx, id);
      const canDecide = canDecideOf(subject);
      const pays = canDecide
        ? await paysOf(tx, rows, { subject, features, contractorOf: () => contractor! })
        : new Map<string, SentFilePay>();
      return {
        items: rows.map((r) => itemOf(r, contractor!, today, canDecide, pays.get(r.id))),
        newCount: rows.filter((r) => r.status === 'new').length,
      };
    });
    return c.json(body, 200);
  };
}

/* ═════════════ Вкладка «Файлы от контрагентов» Файлового менеджера ═════════════ */

function listOptions(subject: AccessSubject, t: ListTexts, today: IsoDate) {
  return { t, scope: filesScopeOf(subject), today };
}

export const sentListRoute = createRoute({
  method: 'get',
  path: '/files/sent',
  tags: ['files'],
  summary: '«Файлы от контрагентов»: страница списка',
  middleware: [requirePermission('filesView')] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description:
        'Файлы контрагентов в области сотрудника; сортировка, фильтры, поиск и группы — на сервере',
      content: { 'application/json': { schema: SentFileListPage } },
    },
    ...listQueryResponses,
    401: noAuth,
    403: offOrNoRight,
  },
});

export function sentListHandler(deps: ApiDeps): RouteHandler<typeof sentListRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const t = await serverTexts(deps);
    const today = sentToday();
    const canDecide = canDecideOf(subject);
    const { page, pays } = await withOrgContext(deps.db, ctx, async (tx) => {
      const features = await requireSentTab(tx, ctx.orgId);
      const page = await listSentFilesPage(tx, query, listOptions(subject, t, today));
      const byId = new Map(page.rows.map((r) => [r.id, r.contractor]));
      const pays = canDecide
        ? await paysOf(tx, page.rows, {
            subject,
            features,
            contractorOf: (r) => byId.get(r.id)!,
          })
        : new Map<string, SentFilePay>();
      return { page, pays };
    });
    return c.json(
      {
        items: page.rows.map((r) => ({
          ...itemOf(r, r.contractor, today, canDecide, pays.get(r.id)),
          responsible: r.responsibleName,
        })),
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

export const sentValuesRoute = createRoute({
  method: 'get',
  path: '/files/sent/values',
  tags: ['files'],
  summary: 'Значения столбца «Файлов от контрагентов» для фильтра',
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

export function sentValuesHandler(deps: ApiDeps): RouteHandler<typeof sentValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const ctx = orgContextOf(c);
    const t = await serverTexts(deps);
    const values = await withOrgContext(deps.db, ctx, async (tx) => {
      await requireSentTab(tx, ctx.orgId);
      return listSentFileValues(tx, col, listOptions(subjectOf(c), t, sentToday()), q);
    });
    return c.json(values, 200);
  };
}

export const sentExportRoute = createRoute({
  method: 'get',
  path: '/files/sent/export',
  tags: ['files'],
  summary: '«Файлы от контрагентов» в Excel',
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
    403: offOrNoRight,
  },
});

export function sentExportHandler(deps: ApiDeps): RouteHandler<typeof sentExportRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const ctx = orgContextOf(c);
    const t = await serverTexts(deps);
    return withExportSlot(deps, c.get('session')!.userId, async () => {
      const result = await withOrgContext(deps.db, { ...ctx, kind: 'export' }, async (tx) => {
        await requireSentTab(tx, ctx.orgId);
        return exportSentFiles(tx, query, keys, listOptions(subjectOf(c), t, sentToday()));
      });
      return xlsxResponse(c, {
        title: t('files.tab.sent'),
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

export const sentCountRoute = createRoute({
  method: 'get',
  path: '/files/sent/count',
  tags: ['files'],
  summary: 'Сколько новых файлов от контрагентов — у «Файлового менеджера» в меню и на вкладке',
  middleware: [requireEmployee] as const,
  responses: {
    200: {
      description: 'Число новых файлов в области сотрудника; null — вкладки у него нет',
      content: { 'application/json': { schema: SentFileCount } },
    },
    401: noAuth,
    403: { description: 'Не сотрудник организации', content: error },
  },
});

export function sentCountHandler(deps: ApiDeps): RouteHandler<typeof sentCountRoute, AppEnv> {
  return async (c) => {
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const count = await withOrgContext(deps.db, ctx, async (tx) => {
      const { features } = await orgMenuSettings(tx, ctx.orgId);
      if (!features.files || !features.cppage || !hasPermission(subject, 'filesView')) return null;
      return sentFilesNewCount(tx, filesScopeOf(subject));
    });
    return c.json({ count }, 200);
  };
}

/* ═════════════ «Принять», «Отклонить», ссылка ═════════════ */

const decideResponses = {
  401: noAuth,
  403: {
    description:
      'Нет права «Просматривать файлы» или «Загружать файлы»; «Файлы в карточках» выключены',
    content: error,
  },
  404: { description: 'Файла нет или контрагент вне области', content: error },
  409: {
    description:
      'Файл уже принят или отклонён (`sent_decided`), запись изменена (`record_changed`) или файла нет в хранилище',
    content: error,
  },
} as const;

export const sentAcceptRoute = createRoute({
  method: 'post',
  path: '/files/sent/{id}/accept',
  tags: ['files'],
  summary:
    '«Принять» файл от контрагента: он становится файлом контрагента «От контрагента», чек — ещё и файлом записи денег',
  middleware: [requirePermission('filesView'), requirePermission('filesUpload')] as const,
  request: {
    params: SentFileIdParam,
    body: { required: true, content: { 'application/json': { schema: SentFileAccept } } },
  },
  responses: {
    200: {
      description:
        'Принят: файл среди файлов контрагента (занятое имя — «Имя (2).pdf»); с `attach` — и у записи денег',
      content: { 'application/json': { schema: SentFileAccepted } },
    },
    ...decideResponses,
    403: {
      description:
        'Нет права «Просматривать файлы» или «Загружать файлы»; «Файлы в карточках» выключены; с `attach` — нельзя менять файлы записи денег, имя или размер файла не годятся для файлов записей',
      content: error,
    },
    404: {
      description:
        'Файла нет или контрагент вне области; с `attach` — записи денег нет, она не видна или другого контрагента',
      content: error,
    },
    429: { description: 'С `attach` — слишком много загрузок за час', content: error },
  },
});

/**
 * «Принять» (прототип `sntAccept`): копия файла ложится в хранилище файлов организации до транзакции,
 * в транзакции — файл контрагента с источником «От контрагента» (занятое имя — «Имя (2).pdf»),
 * «Принят» и запись в историю контрагента; после — отправленный объект удаляется. Не вышло — копия
 * удаляется.
 *
 * С `attach` — «Сохранить» в окне денег с чеком (доработки 16.11.2026, блок 1; прототип v121
 * `pgRcptSave`): деньги уже записаны своим запросом, а чек принимается и прикрепляется к ним одной
 * транзакцией — «Принят файл «…» — прикреплён к поступлению от ДД.ММ.ГГГГ». До этого чек остаётся
 * «Новый»: «Отменить» в окне денег ничего не меняет. Прикрепляется вторая копия (а не ссылка — до
 * блока 2), по правилам загрузки с сайта: та же запись того же контрагента, `attachStoredFile`, предел
 * загрузок пользователя. Чек уже решил другой сотрудник — 409 `sent_decided` с `details` (кто и как),
 * деньги остаются без чека.
 */
export function sentAcceptHandler(deps: ApiDeps): RouteHandler<typeof sentAcceptRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, attach } = c.req.valid('json');
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const seen = await withOrgContext(deps.db, ctx, async (tx) => {
      await requireFilesFeature(tx, ctx.orgId);
      return (await visibleSent(tx, subject, id)).file;
    });
    if (seen.status !== 'new') decidedFail(seen);
    const fileId = randomUUID();
    const key = orgFileKey(ctx.orgId, FILES_SECTION, fileId);
    const today = sentToday();
    let body: SentFileItemBody;
    try {
      if (!(await deps.storage.copy(seen.storageKey, key))) {
        apiFail(409, 'file_not_uploaded', FILE_MESSAGES.file_not_uploaded);
      }
      body = await decided(deps, ctx, id, () =>
        withOrgContext(deps.db, ctx, async (tx) => {
          const features = await requireFilesFeature(tx, ctx.orgId);
          const { file, contractor } = await visibleSent(tx, subject, id);
          const record = attach
            ? await visibleSource(deps, tx, subject, attach.kind, attach.id)
            : null;
          // Чек одного контрагента к деньгам другого не прикрепить; файлы записи должно быть можно менять.
          if (record && record.contractor?.id !== contractor.id) notFound();
          if (record && !canUpload(subject, record)) {
            apiFail(403, 'forbidden', 'Нет права на это действие');
          }
          const name = acceptedFileName(
            file.name,
            await contractorDocumentNames(tx, contractor.id),
          );
          await acceptSentFile(tx, {
            id,
            version,
            file: {
              id: fileId,
              sourceKind: 'sent_file',
              sourceId: null,
              contractorId: contractor.id,
              name,
              contentType: file.contentType,
              sizeBytes: file.sizeBytes,
              storageKey: key,
              note: file.comment,
            },
          });
          const to =
            attach && record
              ? await linkReceipt(tx, subject, features, attach, record, fileId)
              : null;
          await writeHistory(tx, {
            entity: 'sent_file',
            entityId: id,
            action: 'sent_file_accept',
            contractorId: contractor.id,
            changes: [
              { field: 'file', to: file.name },
              ...(name !== file.name ? [{ field: 'savedAs', to: name }] : []),
              ...(to ? [to] : []),
            ],
          });
          return itemOf((await getSentFile(tx, id))!, contractor, today, true);
        }),
      );
    } catch (err) {
      await removeStoredObjects(deps, [key], 'файлы от контрагентов: копия после отказа');
      throw err;
    }
    // Принятый не удаляется задачей по расписанию: и загрузку со страницы по ссылке — сейчас; не
    // удалось — повторит задача `files.storage-retry`.
    await removeStoredObjects(
      deps,
      [seen.storageKey, sentUploadKey(seen.storageKey)],
      'файлы от контрагентов: принятый в «отправленных»',
    );
    return c.json(body, 200);
  };
}

/**
 * Принятый чек — к записи денег ссылкой (доработки 16.11.2026, блок 2; прототип v124 `pgRcptSave`): тот
 * же файл контрагента, без копии; в истории записи — «Прикреплён из файлов контрагента». Ответ — поле
 * истории контрагента «к поступлению от …» или «к оплате за обслуживание от …» (дата оплаты — только
 * тому, кто видит плату: `FEE_FIELDS`).
 */
async function linkReceipt(
  tx: Tx,
  subject: AccessSubject,
  features: Readonly<Record<Feature, boolean>>,
  target: { kind: 'receipt' | 'fee_payment'; id: string },
  record: FileSourceRecord,
  fileId: string,
): Promise<{ field: 'receipt' | 'feePayment'; to: IsoDate }> {
  const added = record.contractor
    ? await linkTo(
        tx,
        subject,
        features,
        target,
        { ...record, contractor: record.contractor },
        [fileId],
      )
    : null;
  if (!added?.length) notFound();
  const date = await sentReceiptTargetDate(tx, target);
  if (!date) notFound();
  return { field: target.kind === 'receipt' ? 'receipt' : 'feePayment', to: date! };
}

export const sentRejectRoute = createRoute({
  method: 'post',
  path: '/files/sent/{id}/reject',
  tags: ['files'],
  summary: '«Отклонить» файл от контрагента с причиной',
  middleware: [requirePermission('filesView'), requirePermission('filesUpload')] as const,
  request: {
    params: SentFileIdParam,
    body: { required: true, content: { 'application/json': { schema: SentFileReject } } },
  },
  responses: {
    200: {
      description: 'Отклонён: контрагент видит причину на своей странице',
      content: { 'application/json': { schema: SentFileItem } },
    },
    400: { description: 'Причина пустая или длиннее 300 знаков', content: error },
    ...decideResponses,
  },
});

/** «Отклонить» (прототип `sntRejectDlg`): причина обязательна, запись в историю контрагента. */
export function sentRejectHandler(deps: ApiDeps): RouteHandler<typeof sentRejectRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const checked = sentFileReason(input.reason);
    if ('problem' in checked) {
      apiFail(400, checked.problem, SENT_FILE_MESSAGES[checked.problem]);
    }
    const reason = (checked as { reason: string }).reason;
    const ctx = orgContextOf(c);
    const subject = subjectOf(c);
    const today = sentToday();
    const body = await decided(deps, ctx, id, () =>
      withOrgContext(deps.db, ctx, async (tx) => {
        await requireFilesFeature(tx, ctx.orgId);
        const { file, contractor } = await visibleSent(tx, subject, id);
        await rejectSentFile(tx, { id, version: input.version, reason });
        // Отклонённый чек — и сообщение об оплате с ним отклонено: у месяца снова «Не оплачено» или
        // «Частично» (доработки 14.11.2026, блок 6; прототип v116 `pgClaimReject`).
        await rejectReceiptClaims(tx, id);
        await writeHistory(tx, {
          entity: 'sent_file',
          entityId: id,
          action: 'sent_file_reject',
          contractorId: contractor.id,
          changes: [{ field: 'file', to: file.name }],
          reason,
        });
        return itemOf((await getSentFile(tx, id))!, contractor, today, true);
      }),
    );
    return c.json(body, 200);
  };
}

export const sentLinkRoute = createRoute({
  method: 'get',
  path: '/files/sent/{id}/link',
  tags: ['files'],
  summary: 'Ссылка на файл от контрагента на 15 минут: скачать или открыть в окне',
  middleware: [requirePermission('filesView')] as const,
  request: { params: SentFileIdParam, query: SentFileLinkQuery },
  responses: {
    200: {
      description: 'Подписанная ссылка на файл в хранилище',
      content: { 'application/json': { schema: FileLink } },
    },
    400: { description: 'Открыть в окне можно только картинку и PDF', content: error },
    401: noAuth,
    403: {
      description: 'Нет права «Просматривать файлы» или «Файлы в карточках» выключены',
      content: error,
    },
    404: { description: 'Файла нет, он удалён или контрагент вне области', content: error },
  },
});

/**
 * Скачать и открыть (прототип `sntActs`, `sntOpen`): у принятого — файл контрагента, пока его не
 * удалили; открыть в окне — только картинку и PDF (хранилище отдаёт их с проверенным типом).
 */
export function sentLinkHandler(deps: ApiDeps): RouteHandler<typeof sentLinkRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const download = c.req.valid('query').download === '1';
    const ctx = orgContextOf(c);
    const file = await withOrgContext(deps.db, ctx, async (tx) => {
      await requireFilesFeature(tx, ctx.orgId);
      return (await visibleSent(tx, subjectOf(c), id)).file;
    });
    const key = file.status === 'accepted' ? file.fileStorageKey : file.storageKey;
    if (!key) notFound();
    if (!download && !filePreviewKind(file.contentType)) {
      apiFail(400, 'file_no_preview', FILE_MESSAGES.file_no_preview);
    }
    const expiresAt = new Date(Date.now() + FILE_LINK_SECONDS * 1000);
    const url = await deps.storage.signedDownloadUrl(key!, {
      expiresInSeconds: FILE_LINK_SECONDS,
      fileName: file.name,
      ...(download ? {} : { inline: { contentType: file.contentType } }),
    });
    return c.json({ url, expiresAt: expiresAt.toISOString() }, 200);
  };
}

/* ═════════════ Галочка «Контрагент может отправлять файлы» у контрагента ═════════════ */

/** Строка блока «Страница контрагента»: показана ли, галочки и можно ли менять. */
async function uploadStateOf(
  tx: Tx,
  deps: ApiDeps,
  c: Context<AppEnv>,
  id: string,
): Promise<SentUploadState> {
  const { org, cp } = await contractorOf(tx, deps, c, id);
  const page = await getContractorPage(tx, id);
  const archived = cp.serviceStatus === 'archived';
  const shown =
    !!page?.enabled &&
    !archived &&
    pageOrgSections(org.pageSections, org.features).includes('files');
  const subject = subjectOf(c);
  const manage = pageManageRefusal(
    {
      canManage: hasPermission(subject, 'cpPage'),
      isResponsible: cp.responsible?.id === subject.employeeId,
    },
    archived,
  );
  const upload = await sentUploadState(tx, id);
  return {
    shown,
    on: upload?.contractorUpload ?? true,
    orgOn: upload?.orgUpload ?? true,
    manage: manage === 'page_manage_right' || manage === 'page_archived' ? manage : null,
    version: page?.version ?? null,
  };
}

export const sentUploadRoute = createRoute({
  method: 'get',
  path: '/contractors/{id}/page/sent-upload',
  tags: ['files'],
  summary: '«Файлы от контрагента» блока «Страница контрагента»: галочки и можно ли менять',
  middleware: [requirePermission('cpView')] as const,
  request: { params: SentContractorParam },
  responses: {
    200: {
      description: 'Показана ли строка, галочки контрагента и учётной политики',
      content: { 'application/json': { schema: SentUploadState } },
    },
    401: noAuth,
    403: { description: 'Страница контрагента выключена или нет права', content: error },
    404: { description: 'Контрагента нет или он вне области', content: error },
  },
});

export function sentUploadHandler(deps: ApiDeps): RouteHandler<typeof sentUploadRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      uploadStateOf(tx, deps, c, id),
    );
    return c.json(body, 200);
  };
}

export const sentUploadSetRoute = createRoute({
  method: 'post',
  path: '/contractors/{id}/page/sent-upload',
  tags: ['files'],
  summary: '«Контрагент может отправлять файлы» у контрагента: включить или выключить',
  middleware: [requirePermission('cpView')] as const,
  request: {
    params: SentContractorParam,
    body: { required: true, content: { 'application/json': { schema: SentUploadSwitch } } },
  },
  responses: {
    200: {
      description: 'Сохранено — строка блока заново',
      content: { 'application/json': { schema: SentUploadState } },
    },
    ...versionedSaveResponses,
    401: noAuth,
    403: {
      description: 'Нет права «Управлять страницей контрагента» или страница выключена',
      content: error,
    },
    409: {
      description:
        'Страница выключена или контрагент в архиве, галочка выключена в учётной политике (`sent_upload_org_off`) или запись изменена',
      content: error,
    },
  },
});

/**
 * Сотрудник с правом «Управлять страницей контрагента» включает или выключает отправку файлов у
 * контрагента (прототип `pgBox`, `data-pg-up`): только при включённой странице и галочке учётной
 * политики; история контрагента — в той же транзакции (поле `filesUpload` страницы).
 */
export function sentUploadSetHandler(
  deps: ApiDeps,
): RouteHandler<typeof sentUploadSetRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const body = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const state = await uploadStateOf(tx, deps, c, id);
      if (state.manage) {
        apiFail(
          state.manage === 'page_archived' ? 409 : 403,
          state.manage,
          PAGE_MESSAGES[state.manage],
        );
      }
      if (!state.shown || state.version === null) {
        apiFail(409, 'page_off', PAGE_MESSAGES.page_off);
      }
      if (!state.orgOn) {
        apiFail(409, 'sent_upload_org_off', 'Выключено для всех контрагентов в учётной политике');
      }
      await updateWithHistory(tx, {
        table: schema.contractorPages,
        entity: 'contractor_page',
        key: schema.contractorPages.contractorId,
        id,
        version: input.version,
        patch: { filesUpload: input.on },
        contractorId: id,
      });
      return uploadStateOf(tx, deps, c, id);
    });
    return c.json(body, 200);
  };
}
