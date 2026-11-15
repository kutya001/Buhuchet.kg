import { createRoute, z, type RouteHandler } from '@hono/zod-openapi';
import {
  adminLeadById,
  adminLeadDocs,
  adminLeadEvents,
  adminLoginsLike,
  adminOrgByInn,
  adminLeadRecipients,
  adminNewLeadCount,
  deleteLead,
  exportAdminLeads,
  listAdminLeadsPage,
  listAdminLeadValues,
  setLeadAdminNote,
  setLeadStatus,
  withUserContext,
  type AdminLeadEventRecord,
  type AdminLeadRecord,
  type Tx,
} from '@buhuchet/db';
import {
  formatText,
  LEAD_APPROVE_MESSAGES,
  LEAD_MESSAGES,
  leadApproveRefusal,
  leadOwnerLogin,
  leadOwnerLoginBase,
  leadStatusChange,
  leadTgName,
  PLATFORM_ADMIN_NAME,
  RecordChangedError,
  type UiTextParams,
} from '@buhuchet/domain';
import {
  type AdminLead,
  AdminLeadCard,
  AdminLeadList,
  AdminLeadSummary,
  ApiError,
  LeadNoteRequest,
  LeadStatusRequest,
  ListExportParams,
  ListQueryParams,
  ListValues,
  ListValuesQuery,
  Uuid,
  type StatusHistoryEntry,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, listQueryOf, listQueryResponses, versionedSaveResponses } from '../../errors';
import { exportRateResponses, withExportSlot, xlsxContent, xlsxResponse } from '../../lists/export';
import { requirePlatformAdmin } from '../../middleware/access';
import { serverTexts } from '../l10n/texts';
import { sendLeadRefused } from '../telegram/lead-link';
import { removeLeadObjects } from './lead-uploads';

/*
 * Админка → «Организации» → «Заявки» (ТЗ «Админка» → «Вкладка «Заявки»»; прототип admin/leads.js):
 * список заявок с лендинга, окно заявки, смена статуса (шаг, «Отказ» с причиной, откат с причиной),
 * «Заметка администратора», «Удалить». Всё — только незаблокированному администратору платформы
 * (`requirePlatformAdmin`; представления и функции базы проверяют это ещё раз). «Создать организацию»
 * по заявке — `POST /admin/organizations` с `leadId` (./organizations.ts).
 */

const error = { 'application/json': { schema: ApiError } };
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });
const denied = {
  401: { description: 'Нет входа', content: error },
  403: { description: 'Не администратор платформы', content: error },
} as const;
const IdParam = z.object({ id: Uuid });

/** Тексты словаря с подстановками (`{name}`); годятся и спискам (`ListTexts`). */
export type Texts = (key: string, params?: UiTextParams) => string;

export async function textsOf(deps: ApiDeps): Promise<Texts> {
  const raw = await serverTexts(deps);
  return (key, params) => formatText(raw(key), params);
}

/** Записи истории посетителя сайта; остальные пишет администратор платформы. */
const GUEST_KINDS: ReadonlySet<string> = new Set(['created', 'repeat']);

const actorOf = (t: Texts, guest: boolean) => (guest ? t('leads.guest') : PLATFORM_ADMIN_NAME);

/** Автор записи истории: посетитель сайта, система (файлы удалены по сроку) или администратор. */
const eventActor = (t: Texts, kind: string) =>
  kind === 'docs' ? t('org.history.system') : actorOf(t, GUEST_KINDS.has(kind));

/** Заявка для ответа API: «Создал» — посетитель сайта, «Изменил» — он же или администратор. */
export function leadBody(r: AdminLeadRecord, t: Texts): AdminLead {
  return {
    id: r.id,
    at: r.createdAt.toISOString(),
    name: r.name,
    firm: r.firm,
    phone: r.phone,
    size: r.size,
    telegram: r.telegram,
    note: r.note,
    status: r.status,
    statusBefore: r.statusBefore,
    org: r.createdOrgId ? { id: r.createdOrgId, name: r.orgName ?? '' } : null,
    fromStand: r.fromStand,
    lastStatus: r.statusAt
      ? { at: r.statusAt.toISOString(), by: actorOf(t, r.statusByGuest) }
      : null,
    legalForm: r.legalForm,
    inn: r.inn,
    okpo: r.okpo,
    address: r.address,
    head: r.head,
    docs: r.legalForm ? r.docsCount : null,
    tgLinked: r.tgLinkedAt !== null,
    // Имя подключившего — как в истории заявки «Telegram подключён: @имя» (прототип `ldTgPill(o, true)`).
    tgName:
      r.tgLinkedAt === null
        ? null
        : leadTgName({ username: r.tgUsername, firstName: r.tgFirstName }),
    audit: {
      createdAt: r.createdAt.toISOString(),
      createdBy: t('leads.guest'),
      updatedAt: r.updatedAt.toISOString(),
      updatedBy: actorOf(t, r.updatedByGuest),
    },
    version: r.version,
  };
}

/**
 * «История статусов» заявки (прототип `statusHist` для `lead`): «Новая» от посетителя сайта с
 * комментарием «Заявка с сайта», дальше смены статуса с причиной отказа или отката и «Подключена» с
 * «создана организация «…»».
 */
export function leadStatusHistory(
  events: readonly AdminLeadEventRecord[],
  t: Texts,
  /** Заявка с документами: организацию по ней создаёт «Одобрить» (прототип v114: «одобрена: …»). */
  approved = false,
): StatusHistoryEntry[] {
  return events.flatMap((e): StatusHistoryEntry[] => {
    const at = e.at.toISOString();
    if (e.kind === 'created') {
      // Прототип (`statusHist` для `lead`): здесь всегда «Заявка с сайта»; отметка стенда — в «Истории».
      const reason = t('leads.hist.created');
      return [{ at, from: null, to: 'new', rollback: false, reason, actor: t('leads.guest') }];
    }
    if (!e.fromStatus || !e.toStatus || e.fromStatus === e.toStatus) return [];
    if (e.kind !== 'status' && e.kind !== 'rollback' && e.kind !== 'org') return [];
    const reason =
      e.kind === 'org'
        ? t(approved ? 'leads.hist.approved_note' : 'leads.hist.org_note', { name: e.text ?? '' })
        : (e.text ?? null);
    return [
      {
        at,
        from: e.fromStatus,
        to: e.toStatus,
        rollback: e.kind === 'rollback',
        reason,
        actor: PLATFORM_ADMIN_NAME,
        // Статус сменили кнопкой или ответом в чате бота (поток Т, задача Т6).
        ...(e.via ? { via: e.via } : {}),
      },
    ];
  });
}

/**
 * «Одобрить» заявки с документами без организации (прототип v114 ldApproveWhy, ldLoginOf): почему
 * неактивна — по порядку прототипа, с ИНН и названием уже созданной организации; логин владельца — по
 * имени заявителя, свободный на платформе.
 */
export async function leadApproveInfo(tx: Tx, lead: AdminLeadRecord, t: Texts) {
  const taken = lead.inn ? await adminOrgByInn(tx, lead.inn) : null;
  const refusal = leadApproveRefusal({
    hasOrg: lead.createdOrgId !== null,
    status: lead.status,
    tgLinked: lead.tgLinkedAt !== null,
    docsState: lead.docsState,
    inn: lead.inn,
    innTaken: taken !== null,
  });
  const logins = await adminLoginsLike(tx, leadOwnerLoginBase(lead.name, lead.firm));
  return {
    refusal,
    message: refusal
      ? formatText(t(`err.${refusal}`) || LEAD_APPROVE_MESSAGES[refusal], {
          inn: lead.inn ?? '',
          name: taken?.name ?? '',
        })
      : null,
    login: leadOwnerLogin(lead.name, lead.firm, (l) => logins.has(l)),
    takenOrg: taken,
  };
}

/** Окно заявки; заявки нет (или не администратор) — 404. */
async function leadCard(tx: Tx, id: string, t: Texts): Promise<AdminLeadCard> {
  const lead = await adminLeadById(tx, id);
  if (!lead) apiFail(404, 'lead_not_found', LEAD_MESSAGES.lead_not_found);
  const events = await adminLeadEvents(tx, id);
  const docs = lead.legalForm ? await adminLeadDocs(tx, id) : [];
  const gone = events.findLast((e) => e.kind === 'docs');
  const approve = lead.legalForm && !lead.createdOrgId ? await leadApproveInfo(tx, lead, t) : null;
  return {
    ...leadBody(lead, t),
    adminNote: lead.adminNote ?? '',
    docFiles: docs.map((d) => ({
      id: d.id,
      kind: d.kind,
      name: d.name,
      size: d.sizeBytes,
      pending: d.state !== 'ready',
    })),
    docsPurgeAt: lead.docsPurgeAt?.toISOString() ?? null,
    docsGoneAt: lead.legalForm && lead.docsCount === 0 && gone ? gone.at.toISOString() : null,
    approve: approve
      ? { refusal: approve.refusal, message: approve.message, login: approve.login }
      : null,
    statusHistory: leadStatusHistory(events, t, lead.legalForm !== null),
    history: events.map((e) => ({
      at: e.at.toISOString(),
      actor: eventActor(t, e.kind),
      kind: e.kind,
      from: e.fromStatus,
      to: e.toStatus,
      text: e.text,
      via: e.via ?? null,
    })),
  };
}

export const listLeadsRoute = createRoute({
  method: 'get',
  path: '/admin/leads',
  tags: ['admin'],
  summary: 'Заявки с сайта: страница списка',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListQueryParams },
  responses: {
    200: {
      description: 'Страница заявок: сортировка, страница, фильтры, поиск и группы — на сервере',
      content: json(AdminLeadList),
    },
    ...listQueryResponses,
    ...denied,
  },
});

/** Вкладка «Заявки» (прототип renderLeads): от новых к старым, отказанные — приглушённо на экране. */
export function listLeadsHandler(deps: ApiDeps): RouteHandler<typeof listLeadsRoute, AppEnv> {
  return async (c) => {
    const query = listQueryOf(c.req.valid('query'));
    const t = await textsOf(deps);
    const page = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listAdminLeadsPage(tx, query, t),
    );
    return c.json(
      {
        items: page.rows.map((r) => leadBody(r, t)),
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

export const leadValuesRoute = createRoute({
  method: 'get',
  path: '/admin/leads/values',
  tags: ['admin'],
  summary: 'Значения столбца вкладки «Заявки» для фильтра',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListValuesQuery },
  responses: {
    200: {
      description: 'Значения столбца с подписью и числом записей во всём списке',
      content: json(ListValues),
    },
    ...listQueryResponses,
    ...denied,
  },
});

export function leadValuesHandler(deps: ApiDeps): RouteHandler<typeof leadValuesRoute, AppEnv> {
  return async (c) => {
    const { col, q } = c.req.valid('query');
    const t = await textsOf(deps);
    const values = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      listAdminLeadValues(tx, col, t, q),
    );
    return c.json(values, 200);
  };
}

export const exportLeadsRoute = createRoute({
  method: 'get',
  path: '/admin/leads/export',
  tags: ['admin'],
  summary: 'Заявки с сайта в Excel',
  middleware: [requirePlatformAdmin] as const,
  request: { query: ListExportParams },
  responses: {
    200: {
      description: 'Файл Excel со всеми заявками под поиском и фильтрами',
      content: xlsxContent,
    },
    ...listQueryResponses,
    ...exportRateResponses,
    ...denied,
  },
});

export function exportLeadsHandler(deps: ApiDeps): RouteHandler<typeof exportLeadsRoute, AppEnv> {
  return async (c) => {
    const params = c.req.valid('query');
    const query = listQueryOf(params);
    const keys = [...new Set(params.cols.split(','))];
    const userId = c.get('session')!.userId;
    return withExportSlot(deps, userId, async () => {
      const t = await textsOf(deps);
      const result = await withUserContext(
        deps.db,
        userId,
        (tx) => exportAdminLeads(tx, query, keys, t),
        'export',
      );
      return xlsxResponse(c, {
        title: t('orgs.plate.leads'),
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

export const leadSummaryRoute = createRoute({
  method: 'get',
  path: '/admin/leads/summary',
  tags: ['admin'],
  summary: 'Новых заявок (счётчик вкладки, плитка «Заявки с сайта») и кому сообщить о заявке',
  middleware: [requirePlatformAdmin] as const,
  responses: {
    200: {
      description: 'Сколько заявок «Новая» и администраторов с привязанным Telegram',
      content: json(AdminLeadSummary),
    },
    ...denied,
  },
});

export function leadSummaryHandler(deps: ApiDeps): RouteHandler<typeof leadSummaryRoute, AppEnv> {
  return async (c) => {
    const body = await withUserContext(deps.db, c.get('session')!.userId, async (tx) => ({
      fresh: await adminNewLeadCount(tx),
      recipients: await adminLeadRecipients(tx),
    }));
    return c.json(body, 200);
  };
}

export const leadCardRoute = createRoute({
  method: 'get',
  path: '/admin/leads/{id}',
  tags: ['admin'],
  summary: 'Окно заявки',
  middleware: [requirePlatformAdmin] as const,
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Заявка, заметка администратора, история статусов и история',
      content: json(AdminLeadCard),
    },
    404: { description: 'Заявки нет', content: error },
    ...denied,
  },
});

export function leadCardHandler(deps: ApiDeps): RouteHandler<typeof leadCardRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const t = await textsOf(deps);
    const card = await withUserContext(deps.db, c.get('session')!.userId, (tx) =>
      leadCard(tx, id, t),
    );
    return c.json(card, 200);
  };
}

export const leadStatusRoute = createRoute({
  method: 'post',
  path: '/admin/leads/{id}/status',
  tags: ['admin'],
  summary: 'Статус заявки: «В работу», «Подключена», «Отказ», откат на шаг',
  middleware: [requirePlatformAdmin] as const,
  request: {
    params: IdParam,
    body: { required: true, content: json(LeadStatusRequest) },
  },
  responses: {
    200: { description: 'Статус сменён; запись в истории заявки', content: json(AdminLeadCard) },
    400: { description: '«Отказ» или откат без причины', content: error },
    ...denied,
    ...versionedSaveResponses,
    409: {
      description:
        'Такой смены статуса нет, «Подключена» с организацией не откатывается, у заявки с документами «Подключена» ставит «Одобрить» или заявку изменили',
      content: error,
    },
  },
});

/**
 * Смена статуса (прототип leadStep, leadRefuse, rollbackDlg для `lead`): шаг вперёд по шкале —
 * «В работу» у новой, «Подключена» из «В работе», если организацию не создавали; «Отказ» — у новой и в
 * работе, с причиной; откат на шаг — с причиной, в истории с пометкой «Откат», «Снять «Отказ»» —
 * в статус до отказа. Ставит и меняет статус только администратор платформы. Устаревшая версия —
 * 409 «запись изменена другим пользователем».
 */
export function leadStatusHandler(deps: ApiDeps): RouteHandler<typeof leadStatusRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { to, version, reason } = c.req.valid('json');
    const t = await textsOf(deps);
    const adminId = c.get('session')!.userId;
    const card = await withUserContext(deps.db, adminId, async (tx) => {
      const lead = await adminLeadById(tx, id);
      if (!lead) apiFail(404, 'lead_not_found', LEAD_MESSAGES.lead_not_found);
      if (lead.version !== version) throw new RecordChangedError('lead', id, lead.version);
      const change = leadStatusChange(
        { status: lead.status, statusBefore: lead.statusBefore, hasOrg: !!lead.createdOrgId },
        to,
      );
      if (change === 'locked') apiFail(409, 'lead_back_locked', LEAD_MESSAGES.lead_back_locked);
      if (!change) apiFail(409, 'lead_status_invalid', LEAD_MESSAGES.lead_status_invalid);
      // «Подключена» у заявки с документами без организации — только «Одобрить» (прототип v114 leadStep).
      if (change.kind === 'step' && to === 'connected' && lead.legalForm && !lead.createdOrgId) {
        apiFail(409, 'lead_has_docs', LEAD_APPROVE_MESSAGES.lead_has_docs);
      }
      if (change.kind === 'reject' && !reason) {
        apiFail(400, 'lead_reason_required', LEAD_MESSAGES.lead_reason_required, {
          field: 'reason',
        });
      }
      if (change.kind === 'rollback' && !reason) {
        apiFail(400, 'status.rollback_reason_required', 'Укажите причину отката', {
          field: 'reason',
        });
      }
      const next = await setLeadStatus(tx, {
        id,
        version,
        to,
        before: change.kind === 'reject' ? lead.status : null,
        rollback: change.kind === 'rollback',
        text: change.kind === 'step' ? null : (reason ?? null),
        now: deps.clock.now(),
      });
      if (next === null) throw new RecordChangedError('lead', id, version);
      return { card: await leadCard(tx, id, t), rejected: change.kind === 'reject' };
    });
    // «Отклонить»: заявителю с подключённым Telegram — причина отказа (поток Т; не бросает).
    if (card.rejected) await sendLeadRefused(deps, { leadId: id, adminId });
    return c.json(card.card, 200);
  };
}

export const leadNoteRoute = createRoute({
  method: 'post',
  path: '/admin/leads/{id}/note',
  tags: ['admin'],
  summary: '«Сохранить заметку» в окне заявки',
  middleware: [requirePlatformAdmin] as const,
  request: { params: IdParam, body: { required: true, content: json(LeadNoteRequest) } },
  responses: {
    200: {
      description: 'Заметка сохранена (или не изменилась); изменение — в истории заявки',
      content: json(AdminLeadCard),
    },
    400: { description: 'Неверные данные', content: error },
    ...denied,
    ...versionedSaveResponses,
  },
});

/**
 * «Заметка администратора» (прототип openLead): видит только администратор платформы; изменение
 * пишется в историю заявки, без изменений — ничего не пишется (на экране — «Изменений нет»).
 */
export function leadNoteHandler(deps: ApiDeps): RouteHandler<typeof leadNoteRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { note, version } = c.req.valid('json');
    const t = await textsOf(deps);
    const card = await withUserContext(deps.db, c.get('session')!.userId, async (tx) => {
      const lead = await adminLeadById(tx, id);
      if (!lead) apiFail(404, 'lead_not_found', LEAD_MESSAGES.lead_not_found);
      if (lead.version !== version) throw new RecordChangedError('lead', id, lead.version);
      if (note !== (lead.adminNote ?? '')) {
        const next = await setLeadAdminNote(tx, { id, version, note, now: deps.clock.now() });
        if (next === null) throw new RecordChangedError('lead', id, version);
      }
      return leadCard(tx, id, t);
    });
    return c.json(card, 200);
  };
}

export const deleteLeadRoute = createRoute({
  method: 'delete',
  path: '/admin/leads/{id}',
  tags: ['admin'],
  summary: 'Удалить заявку',
  middleware: [requirePlatformAdmin] as const,
  request: { params: IdParam },
  responses: {
    200: {
      description: 'Заявка стёрта вместе с историей и сообщением в журнале Telegram',
      content: json(z.object({ ok: z.literal(true) })),
    },
    404: { description: 'Заявки нет', content: error },
    ...denied,
  },
});

/**
 * «Удалить» (прототип leadDel): «Имя и телефон будут стёрты» — заявка стирается полностью, вместе с
 * документами: файлы удаляются из хранилища после транзакции (доработки 14.11.2026, блок 1).
 */
export function deleteLeadHandler(deps: ApiDeps): RouteHandler<typeof deleteLeadRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const keys = await withUserContext(deps.db, c.get('session')!.userId, async (tx) => {
      const docs = await adminLeadDocs(tx, id);
      return (await deleteLead(tx, id)) ? docs.map((d) => d.storageKey) : null;
    });
    if (!keys) apiFail(404, 'lead_not_found', LEAD_MESSAGES.lead_not_found);
    await removeLeadObjects(deps, keys);
    deps.logger.info({ requestId: c.get('requestId'), lead: id }, 'заявка удалена');
    return c.json({ ok: true as const }, 200);
  };
}
