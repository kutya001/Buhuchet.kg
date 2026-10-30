import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  activeReportTypes,
  assignableType,
  changeReportDue,
  createManualReport,
  createRevision,
  dueChangeReason,
  getContractor,
  getReportCard,
  orgMenuSettings,
  penaltyOf,
  reportSubmitView,
  withOrgContext,
  type ReportCard as ReportCardData,
  type Tx,
} from '@buhuchet/db';
import {
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
  ReportRevisionCreate,
  ReportSaved,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { orgContextOf, requirePermission } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { subjectOf, todayOf } from '../contractors/common';
import { socfundContext, socfundSubjectOf } from '../contractors/socfund-view';
import { assigneeScopeOf, error, reportScopeOf, withReportErrors } from './common';
import { reportRowBody } from './list';

/*
 * Карточка отчёта и действия задачи 2.06 (прототип modules/report-card.js, reports.js: «Изменить срок»,
 * «Разовый отчёт», «Создать уточнённый»; экран карточки — задача 2.14).
 */

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
 * пеня — у просроченного по виду, у налога которого есть пеня. Оплаченного по отчёту и просрочки оплаты
 * пока нет (деньги — поток В): пеня — у просроченной сдачи, примерная — от всей суммы к уплате.
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
      // Просрочку оплаты (прототип derive: payOverdue) и оплаченное передаст задача денег.
      payOverdue: false,
      amount: card.amount,
      paid: 0,
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
    const out = await withOrgContext(deps.db, orgContextOf(c), async (tx) => {
      const card = await getReportCard(tx, id, {
        t: texts,
        today,
        scope: reportScopeOf(subjectOf(c)),
      });
      if (!card) return null;
      const [view, settings, socfund] = await Promise.all([
        reportSubmitView(tx, id, t),
        orgMenuSettings(tx, orgContextOf(c).orgId),
        socfundOfReport(tx, card, today, t),
      ]);
      return { card, view, settings, ...socfund };
    });
    if (!out) notFound();
    const { card, view, settings, socfund, penalty } = out;
    const confirmOn = settings.reportConfirm;
    const filesOn = settings.features.files;
    const body: ReportCard = {
      ...reportRowBody(card),
      dueChanges: card.dueChanges.map((d) => ({ ...d, at: d.at.toISOString() })),
      statusHistory: card.statusHistory.map((h) => ({ ...h, at: h.at.toISOString() })),
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
      files: filesOn ? view.files : [],
      filesOn,
      fileRequired: reportFileRequired(view, { confirmOn, filesOn }),
      receiptRequired: reportReceiptRequired(view, { filesOn }),
      repeat: view.repeat,
      fix: view.fix && { ...view.fix, at: view.fix.at.toISOString() },
      history: view.history.map((h) => ({ ...h, at: h.at.toISOString() })),
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
    201: { description: 'Отчёт создан', content: { 'application/json': { schema: ReportSaved } } },
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
    return c.json({ id: saved.id, version: saved.version }, 201);
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
