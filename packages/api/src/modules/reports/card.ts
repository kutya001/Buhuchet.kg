import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  activeReportTypes,
  assignableType,
  changeReportDue,
  changeReportResponsible,
  createManualReport,
  createRevision,
  dueChangeReason,
  getContractor,
  getReportCard,
  orgMenuSettings,
  penaltyOf,
  reportFileTarget,
  reportSubmitView,
  withOrgContext,
  type ReportCard as ReportCardData,
  type Tx,
} from '@buhuchet/db';
import {
  canSeeContractor,
  formatText,
  ORG_REPORT_TYPE_MESSAGES,
  penaltyText,
  REPORT_MESSAGES,
  reportFileRequired,
  reportMarkOf,
  reportReceiptRequired,
  socfundCapHint,
  socfundCapText,
  socfundRatesText,
  socfundShort,
  socfundState,
  type AccessSubject,
  type IsoDate,
  type SocfundDict,
  type SocfundTariffId,
  type Translate,
} from '@buhuchet/domain';
import {
  ManualReportCreate,
  ReportCard,
  ReportDueChange,
  ReportIdParam,
  ReportResponsibleChange,
  ReportRevisionCreate,
  ManualReportSaved,
  ReportSaved,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { reportCardMoney } from '../money/tax';
import { checkResponsible, subjectOf, todayOf } from '../contractors/common';
import { socfundContext, socfundSubjectOf } from '../contractors/socfund-view';
import {
  assigneeScopeOf,
  error,
  ownReportsEmployeeOf,
  reportScopeOf,
  withReportErrors,
} from './common';
import { reportRowBody } from './list';

/*
 * Карточка отчёта и действия задачи 2.06 (прототип modules/report-card.js, reports.js: «Изменить срок»,
 * «Разовый отчёт», «Создать уточнённый»; экран карточки — задача 2.14).
 */

/** Записи истории модуля файлов: в них имя файла. */
const FILE_ACTIONS: ReadonlySet<string> = new Set(['file_attach', 'file_delete']);

/**
 * Видит ли сотрудник файлы отчёта (как модуль файлов и карточка задачи): «Файлы в карточках», право
 * «Просматривать файлы» и область группы «Файловый менеджер» по контрагенту отчёта.
 */
const reportFilesVisible = (
  subject: AccessSubject,
  contractor: { responsibleEmployeeId: string | null } | undefined,
  filesOn: boolean,
) => filesOn && !!contractor && canSeeContractor(subject, 'files', contractor);

type HistoryOut = ReportCard['history'][number];

/**
 * История без имён файлов — тому, кто файлов отчёта не видит: без записей модуля файлов и без строк
 * «Прикреплены файлы» у сдачи и подтверждения; запись, в которой были только файлы, уходит.
 */
const historyWithoutFiles = (history: HistoryOut[]) =>
  history.flatMap((h) => {
    if (FILE_ACTIONS.has(h.action)) return [];
    const changes = h.changes.filter((x) => x.field !== 'files');
    return changes.length === 0 && h.changes.length > 0 ? [] : [{ ...h, changes }];
  });

function notFound(): never {
  apiFail(404, 'report_not_found', 'Отчёт не найден');
}

/** Причина из справочника «Причины изменения срока отчёта»: есть и действует. */
async function reasonName(tx: Tx, code: string): Promise<string> {
  const reason = await dueChangeReason(tx, code);
  if (!reason?.active) {
    apiFail(400, 'reason_invalid', REPORT_MESSAGES.reason_invalid, { field: 'reasonCode' });
  }
  return reason.name;
}

export const getReportRoute = createRoute({
  method: 'get',
  path: '/reports/{id}',
  tags: ['reports'],
  summary: 'Карточка отчёта',
  middleware: [requirePermission('repView')] as const,
  request: { params: ReportIdParam },
  responses: {
    200: {
      description:
        'Отчёт: поля строки списка, назначение, журнал изменений срока, «История статусов», версии периода, строки суммы, файлы, возврат на исправление и история',
      content: { 'application/json': { schema: ReportCard } },
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Просматривать отчёты»', content: error },
    404: { description: 'Нет такого отчёта или он вне области сотрудника', content: error },
  },
});

/** Тариф кратко: название, итоговая ставка, ставки одной строкой и предельная база. */
function socfundBrief(dict: SocfundDict, id: SocfundTariffId | null, t: Translate) {
  const x = id ? dict.tariffs.find((y) => y.id === id) : undefined;
  return x
    ? {
        id: x.id,
        short: socfundShort(x),
        total: x.total,
        rates: socfundRatesText(x, t),
        cap: socfundCapText(x, t),
      }
    : null;
}

/**
 * Тариф Соцфонда и подсказка о пене для карточки отчёта (ТЗ «Связь с отчётами», «Пеня (информационно)»;
 * прототип report-card.js, sfPeniNote): тариф — у вида со взносами (STI-161), если он нужен контрагенту;
 * пеня — у просроченного по виду, у налога которого есть пеня; примерная — от неоплаченной суммы.
 */
async function socfundOfReport(tx: Tx, card: ReportCardData, today: IsoDate, t: Translate) {
  const [penalty, contractor, types] = await Promise.all([
    penaltyOf(tx, card.type.code),
    getContractor(tx, card.contractor.id, { scope: undefined, today }),
    activeReportTypes(tx, card.contractor.id),
  ]);
  const penaltyNote = penaltyText(
    {
      dueDate: card.dueDate,
      payDue: card.payDue,
      overdue: card.overdue,
      payOverdue: card.payOverdue,
      amount: card.amount,
      paid: card.paid,
    },
    penalty,
    today,
    t,
  );
  if (!contractor) return { socfund: null, penalty: penaltyNote };
  const { dict, form } = await socfundContext(
    tx,
    contractor.gked?.code ?? null,
    contractor.form.code,
  );
  if (!dict.reportTypes.includes(card.type.code)) return { socfund: null, penalty: penaltyNote };
  const st = socfundState(
    socfundSubjectOf(
      {
        kind: contractor.kind,
        bases: contractor.bases.map((b) => b.code),
        gked: contractor.gked?.code ?? null,
        benefits: contractor.benefits.map((b) => b.code),
        flags: contractor.socfundFlags,
      },
      form,
      types,
    ),
    contractor.socfundTariff,
    dict,
  );
  return {
    socfund: st && {
      tariff: socfundBrief(dict, st.choice?.id ?? null, t),
      auto: socfundBrief(dict, st.auto.tariff, t),
      capHint: socfundCapHint(dict.tariffs.find((x) => x.id === st.choice?.id) ?? null, t),
    },
    penalty: penaltyNote,
  };
}

export function getReportHandler(deps: ApiDeps): RouteHandler<typeof getReportRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const texts = await serverTexts(deps);
    const t: Translate = (key, params) => formatText(texts(key), params);
    const today = todayOf(deps);
    const subject = subjectOf(c);
    const out = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const settings = await orgMenuSettings(tx, orgContextOf(c).orgId);
      const taxpay = settings.features.taxpay;
      const card = await getReportCard(tx, id, {
        t: texts,
        today,
        scope: reportScopeOf(subject),
        taxpay,
      });
      if (!card) return null;
      const [view, socfund, target] = await Promise.all([
        reportSubmitView(tx, id, t),
        socfundOfReport(tx, card, today, t),
        reportFileTarget(tx, id, undefined),
      ]);
      const contractor = target?.contractor;
      const filesVisible = reportFilesVisible(subject, contractor, settings.features.files);
      const money = taxpay
        ? await reportCardMoney(tx, card, subject, contractor, filesVisible)
        : null;
      return { card, view, settings, ...socfund, contractor, filesVisible, money };
    });
    if (!out) notFound();
    const { card, view, settings, socfund, penalty, contractor, filesVisible, money } = out;
    const confirmOn = settings.reportConfirm;
    const filesOn = settings.features.files;
    // «Повторять эту сумму» меняет назначение контрагента: галочка — только у своего контрагента.
    const own = ownReportsEmployeeOf(subject);
    const ownContractor = !own || contractor?.responsibleEmployeeId === own;
    const history = view.history.map((h) => ({ ...h, at: h.at.toISOString() }));
    const body: ReportCard = {
      ...reportRowBody(card),
      dueChanges: card.dueChanges.map((d) => ({ ...d, at: d.at.toISOString() })),
      statusHistory: card.statusHistory.map((h) => ({
        ...h,
        at: h.at.toISOString(),
        ...(h.file === undefined ? {} : { file: filesVisible ? h.file : null }),
      })),
      socfund,
      penalty,
      mark: reportMarkOf(
        { status: card.status, act: card.act, confirmed: card.confirmedAt !== null },
        confirmOn,
      ),
      confirmNote: view.confirmNote,
      lines: view.lines,
      lineDefs: view.lineDefs,
      payments: view.payments,
      files: filesVisible ? view.files : [],
      filesOn,
      fileRequired: reportFileRequired(view, { confirmOn, filesOn }),
      receiptRequired: reportReceiptRequired(view, { filesOn }),
      repeat: ownContractor ? view.repeat : null,
      fix: view.fix && { ...view.fix, at: view.fix.at.toISOString() },
      history: filesVisible ? history : historyWithoutFiles(history),
      taxpay: settings.features.taxpay,
      payFirst: settings.payFirst,
      money,
    };
    return c.json(body, 200);
  };
}

export const changeReportDueRoute = createRoute({
  method: 'post',
  path: '/reports/{id}/due',
  tags: ['reports'],
  summary: '«Изменить срок» отчёта',
  middleware: [requirePermission('repDue')] as const,
  request: {
    params: ReportIdParam,
    body: { required: true, content: { 'application/json': { schema: ReportDueChange } } },
  },
  responses: {
    200: {
      description: 'Срок изменён (или совпал с прежним)',
      content: { 'application/json': { schema: ReportSaved } },
    },
    400: { description: 'Неверная дата или причина', content: error },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Изменять срок отчёта»', content: error },
    ...versionedSaveResponses,
    409: {
      description:
        'Отчёт изменён другим пользователем, уже сдан, это прежняя версия или вид «Уплата»',
      content: error,
    },
  },
});

/**
 * «Изменить срок» (ТЗ: новый срок, причина из справочника платформы, комментарий; запись в историю;
 * изменённый вручную срок не пересчитывается; прототип dueEditDlg).
 */
export function changeReportDueHandler(
  deps: ApiDeps,
): RouteHandler<typeof changeReportDueRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, due, reasonCode, comment } = c.req.valid('json');
    const saved = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const name = await reasonName(tx, reasonCode);
      return withReportErrors(() =>
        changeReportDue(
          tx,
          id,
          { due, reasonCode, reasonName: name, comment },
          { version, today: todayOf(deps), scope: reportScopeOf(subjectOf(c)) },
        ),
      );
    });
    return c.json({ id: saved.id, version: saved.version }, 200);
  };
}

export const changeReportResponsibleRoute = createRoute({
  method: 'patch',
  path: '/reports/{id}/responsible',
  tags: ['reports'],
  summary: '«сменить» ответственного в карточке отчёта',
  middleware: [requirePermission('assign')] as const,
  request: {
    params: ReportIdParam,
    body: {
      required: true,
      content: { 'application/json': { schema: ReportResponsibleChange } },
    },
  },
  responses: {
    200: {
      description: 'Ответственный изменён (или совпал с прежним)',
      content: { 'application/json': { schema: ReportSaved } },
    },
    400: { description: 'Нет такого сотрудника или он отключён', content: error },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Назначать отчёты контрагентам»', content: error },
    ...versionedSaveResponses,
    409: {
      description: 'Отчёт изменён другим пользователем или это прежняя версия',
      content: error,
    },
  },
});

/**
 * «сменить» (прототип report-card.js, `#rc-resp`: меню действующих сотрудников, право «Назначать
 * отчёты»): «Ответственный: было → стало» в истории отчёта; область — как у карточки (п. А-2).
 */
export function changeReportResponsibleHandler(
  deps: ApiDeps,
): RouteHandler<typeof changeReportResponsibleRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version, responsibleEmployeeId } = c.req.valid('json');
    const saved = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      await checkResponsible(tx, responsibleEmployeeId);
      return withReportErrors(() =>
        changeReportResponsible(tx, id, responsibleEmployeeId, {
          version,
          scope: reportScopeOf(subjectOf(c)),
        }),
      );
    });
    return c.json({ id: saved.id, version: saved.version }, 200);
  };
}

export const createManualReportRoute = createRoute({
  method: 'post',
  path: '/reports',
  tags: ['reports'],
  summary: '«+ Добавить» → «Разовый отчёт»',
  middleware: [requirePermission('changeStatus')] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: ManualReportCreate } } },
  },
  responses: {
    201: {
      description: 'Отчёт создан; срок — после переноса с нерабочего дня',
      content: { 'application/json': { schema: ManualReportSaved } },
    },
    400: {
      description: 'Неверные данные: нет месяца, даты события, срока или причины',
      content: error,
    },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Менять статус сдачи»', content: error },
    404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
    409: {
      description:
        'Такой отчёт уже есть; вид не подключён или отключён в каталоге; контрагент в архиве',
      content: error,
    },
  },
});

/**
 * «Разовый отчёт» (ТЗ: пропущенный период или отчёт по запросу органа; вид — из подключённых и
 * действующих; у разового вида — дата события, срок от неё по правилу вида; в историю — «Создан
 * вручную (причина)»; прототип adhocDlg). Отчёт можно создать и за прошлый период.
 */
export function createManualReportHandler(
  deps: ApiDeps,
): RouteHandler<typeof createManualReportRoute, AppEnv> {
  return async (c) => {
    const body = c.req.valid('json');
    const saved = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const type = await assignableType(tx, body.reportTypeCode);
      if (!type) {
        apiFail(400, 'validation_failed', 'Нет такого вида отчёта', { field: 'reportTypeCode' });
      }
      if (!type.enabled) {
        apiFail(
          409,
          'report_type_not_connected',
          ORG_REPORT_TYPE_MESSAGES.report_type_not_connected,
          {
            field: 'reportTypeCode',
          },
        );
      }
      if (!type.active) {
        apiFail(409, 'report_type_inactive', ORG_REPORT_TYPE_MESSAGES.report_type_inactive, {
          field: 'reportTypeCode',
        });
      }
      if (type.oneOff && !body.eventDate) {
        apiFail(400, 'event_date_required', REPORT_MESSAGES.event_date_required, {
          field: 'eventDate',
        });
      }
      if (!type.oneOff && !body.month) {
        apiFail(400, 'month_required', REPORT_MESSAGES.month_required, { field: 'month' });
      }
      if (!type.oneOff && !body.due) {
        apiFail(400, 'due_required', REPORT_MESSAGES.due_required, { field: 'due' });
      }
      const name = await reasonName(tx, body.reasonCode);
      return withReportErrors(
        () =>
          createManualReport(
            tx,
            {
              contractorId: body.contractorId,
              reportTypeCode: body.reportTypeCode,
              month: type.oneOff ? null : body.month,
              eventDate: type.oneOff ? body.eventDate : null,
              due: body.due,
              reasonCode: body.reasonCode,
              reasonName: name,
            },
            { today: todayOf(deps), scope: assigneeScopeOf(subjectOf(c)) },
          ),
        { eventDate: type.oneOff },
      );
    });
    return c.json({ id: saved.id, version: saved.version, dueDate: saved.dueDate }, 201);
  };
}

export const createRevisionRoute = createRoute({
  method: 'post',
  path: '/reports/{id}/revision',
  tags: ['reports'],
  summary: '«Создать уточнённый» отчёт',
  middleware: [requirePermission('changeStatus')] as const,
  request: {
    params: ReportIdParam,
    body: { required: true, content: { 'application/json': { schema: ReportRevisionCreate } } },
  },
  responses: {
    201: {
      description: 'Новая версия того же периода',
      content: { 'application/json': { schema: ReportSaved } },
    },
    400: { description: 'Неверные данные запроса', content: error },
    401: { description: 'Нет входа', content: error },
    403: { description: 'Нет права «Менять статус сдачи»', content: error },
    ...versionedSaveResponses,
    409: {
      description:
        'Отчёт изменён другим пользователем, не сдан, это прежняя версия или вид «Уплата»',
      content: error,
    },
  },
});

/**
 * «Создать уточнённый» (ТЗ «Уточнённые отчёты»: у сданного — новая версия со своей суммой, сроком и
 * статусами; прежняя не меняется и уходит из списка по умолчанию; прототип createRevision).
 */
export function createRevisionHandler(
  deps: ApiDeps,
): RouteHandler<typeof createRevisionRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { version } = c.req.valid('json');
    const created = await withOrgContext(deps.db, orgContextOf(c), (tx) =>
      withReportErrors(() =>
        createRevision(tx, id, {
          version,
          today: todayOf(deps),
          scope: reportScopeOf(subjectOf(c)),
        }),
      ),
    );
    return c.json({ id: created.id, version: created.version }, 201);
  };
}
