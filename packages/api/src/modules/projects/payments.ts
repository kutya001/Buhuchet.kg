import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  addProjectPayment,
  deleteProjectPayment,
  editProjectPayment,
  listSourceFiles,
  projectOf,
  projectPaymentCard,
  projectPaymentLines,
  projectPaymentOf,
  type ProjectPaymentHistoryRow,
  type Tx,
} from '@buhuchet/db';
import {
  opAmountLimit,
  opLock,
  type AccessSubject,
  type Feature,
  type HistoryAction,
  type Translate,
  type UiTextKey,
} from '@buhuchet/domain';
import {
  OkResponse,
  OperationDeleteRequest,
  OperationEdited,
  ProjectIdParam,
  ProjectPaymentEditRequest,
  ProjectPaymentRequest,
  ProjectPaymentWindow,
  ProjectSaved,
  type ProjectCard,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { requireEmployee, requirePermission } from '../../middleware/access';
import { subjectOf, todayOf, translateOf } from '../contractors/common';
import { historyFilesSeen, lockFail, moneyFilesSeen, type OpLockInfo } from '../finance/common';
import { checkUpload, viewOnlyOnce, type ViewOnly } from '../finance/services';
import { withMoneyErrors } from '../money/common';
import {
  body,
  canKeepProjects,
  error,
  inProjects,
  json,
  notFound,
  off,
  projectMoneyVisible,
  projectWhere,
  trancheWhere,
  tranchesSeen,
  unauthorized,
} from './common';

/*
 * Оплаты по проекту — транши (задача 2.26, часть 2; ТЗ «Оплата по проекту траншами», «Окно оплаты»;
 * прототип modules/projects.js — `projPay` → `tranchDlg`, «Оплаты (транши)» в `openProject`;
 * modules/fin-op.js — `opWin`, `opEditDlg`, `opDelDlg` с `src: 'pt'`). Транши видит тот, кто видит
 * проект и деньги проектов (прототип `moneyVis`); записывает, изменяет и удаляет — право «Вести проекты
 * и разовые услуги» (прототип `opPerm` → `projects`). Всё — при включённых «Проектах контрагентов».
 */

const payNotFound = {
  description: 'Нет такого транша или сотрудник не видит его проект',
  content: error,
};

type Lock = OpLockInfo | null;

/** Транш не виден по правам (нет денег проектов или ни проектов, ни журнала) — 403. */
function requireSeen(subject: AccessSubject, features: Readonly<Record<Feature, boolean>>) {
  if (!tranchesSeen(subject, features.finops) || !projectMoneyVisible(subject, features))
    apiFail(403, 'forbidden', 'Нет права на это действие');
}

/**
 * Замок транша (прототип opLock с `pt`): удалён, нет права «Вести проекты» — «Только просмотр»,
 * контрагент в архиве — только просмотр.
 */
export async function projectPaymentLock(
  t: Translate,
  subject: AccessSubject,
  p: { deleted: boolean; archived: boolean },
  act: 'edit' | 'del',
  viewOnlyOf: ViewOnly,
): Promise<Lock> {
  const code = opLock(
    {
      kind: 'pt',
      deleted: p.deleted,
      canKind: canKeepProjects(subject),
      canArchiveRest: false,
      canMoney: false,
      archived: p.archived,
      monthClosed: false,
      receiptPart: false,
    },
    act,
  );
  if (!code) return null;
  if (code === 'op_view_only') return viewOnlyOf();
  return { code, text: t(`err.${code}` as UiTextKey) };
}

/**
 * Блок «Оплаты (транши)» карточки проекта (прототип `openProject`: `p.pays.filter(x => !x.del)`): по
 * дате, файлы — тому, кто видит файлы карточки; замки меню строки одни на все транши проекта.
 */
export async function paymentsOfCard(
  tx: Tx,
  t: Translate,
  subject: AccessSubject,
  projectId: string,
  ctx: { archived: boolean; files: boolean },
): Promise<NonNullable<ProjectCard['payments']>> {
  const lines = await projectPaymentLines(tx, projectId);
  if (!lines.length) return [];
  const viewOnly = viewOnlyOnce(tx, t);
  const facts = { deleted: false, archived: ctx.archived };
  const [edit, del] = await Promise.all([
    projectPaymentLock(t, subject, facts, 'edit', viewOnly),
    projectPaymentLock(t, subject, facts, 'del', viewOnly),
  ]);
  return lines.map((l) => ({ ...l, files: ctx.files ? l.files : [], locks: { edit, del } }));
}

const historyOut = (id: string, rows: readonly ProjectPaymentHistoryRow[]) =>
  rows.map((h) => ({
    id: h.id,
    at: h.at.toISOString(),
    actor: h.actorName,
    action: h.action as HistoryAction,
    paymentId: id,
    changes: h.changes as { field: string; from?: unknown; to?: unknown }[],
    reason: h.reason,
  }));

/* ───────────── «Записать оплату» ───────────── */

export const projectPayRoute = createRoute({
  method: 'post',
  path: '/projects/{id}/payments',
  tags: ['projects'],
  summary: '«Записать оплату» по проекту — транш',
  middleware: [requirePermission('projects')] as const,
  request: { params: ProjectIdParam, body: body(ProjectPaymentRequest) },
  responses: {
    201: { description: 'Транш записан; файлы окно загрузит к нему', content: json(ProjectSaved) },
    400: {
      description:
        'Сумма не больше нуля или больше остатка планируемой стоимости; дата позже сегодня',
      content: error,
    },
    401: unauthorized,
    403: off('«Вести проекты и разовые услуги» или «Загружать файлы»'),
    404: notFound,
    409: {
      description: 'Проект отменён или получена вся планируемая стоимость',
      content: error,
    },
  },
});

/** «Записать оплату» (прототип `projPay` → `tranchDlg`): проект — видимый сотруднику. */
export function projectPayHandler(deps: ApiDeps): RouteHandler<typeof projectPayRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const subject = subjectOf(c);
    const saved = await inProjects(deps, c, (tx, features) =>
      withMoneyErrors(async () => {
        checkUpload(subject, features, input.files);
        return addProjectPayment(
          tx,
          await projectOf(tx, id, projectWhere(subject), true),
          { amount: input.amount, date: input.date, note: input.note ?? '' },
          { today: todayOf(deps) },
        );
      }),
    );
    return c.json(saved, 201);
  };
}

/* ───────────── Окно транша ───────────── */

export const projectPaymentWindowRoute = createRoute({
  method: 'get',
  path: '/project-payments/{id}',
  tags: ['projects'],
  summary: 'Окно оплаты по проекту — транша',
  middleware: [requireEmployee] as const,
  request: { params: ProjectIdParam },
  responses: {
    200: {
      description: 'Сумма, дата, проект и «получено», кто внёс, что можно сделать, история',
      content: json(ProjectPaymentWindow),
    },
    401: unauthorized,
    403: off(
      '«Просматривать проекты» или «Просматривать финансовые операции» и права видеть деньги проектов',
    ),
    404: payNotFound,
  },
});

export function projectPaymentWindowHandler(
  deps: ApiDeps,
): RouteHandler<typeof projectPaymentWindowRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const res = await inProjects(deps, c, async (tx, features) => {
      requireSeen(subject, features);
      // Транш невидимого проекта — «не найден» (прототип открывает окно из любой строки журнала).
      // ОТКЛОНЕНИЕ: docs/deviations.md#Г-11
      const card = await projectPaymentCard(tx, id, trancheWhere(subject));
      if (!card) return null;
      const { payment: p, project } = card;
      const facts = { deleted: !!p.deletedAt, archived: card.contractor.archived };
      const viewOnly = viewOnlyOnce(tx, t);
      const [edit, del] = await Promise.all([
        projectPaymentLock(t, subject, facts, 'edit', viewOnly),
        projectPaymentLock(t, subject, facts, 'del', viewOnly),
      ]);
      const amount = Number(p.amount);
      const plan = project.plan === null ? null : Number(project.plan);
      const limit = opAmountLimit('pt', amount, {
        available: 0,
        free: 0,
        orgHeld: 0,
        project: { plan, paid: card.paid },
      });
      const filesSeen = moneyFilesSeen(subject, features.files, card.contractor);
      const files = filesSeen ? (await listSourceFiles(tx, 'project_payment', id)).length : null;
      const out: ProjectPaymentWindow = {
        id: p.id,
        version: p.version,
        contractor: {
          id: card.contractor.id,
          name: card.contractor.name,
          archived: card.contractor.archived,
        },
        project: { id: project.id, name: project.name, plan, paid: card.paid },
        date: p.paidOn,
        amount,
        note: p.note,
        edited: p.edited,
        created: { name: card.createdName, at: p.createdAt.toISOString() },
        updated: {
          name: card.updatedName ?? card.createdName,
          at: (p.updatedAt ?? p.createdAt).toISOString(),
        },
        deleted: p.deletedAt
          ? { name: card.deletedName, at: p.deletedAt.toISOString(), reason: p.deleteReason ?? '' }
          : null,
        locks: { edit, del },
        max: limit ? Math.max(0, limit.max) : null,
        files,
        today: todayOf(deps),
        history: historyOut(id, historyFilesSeen(card.history, filesSeen)),
      };
      return out;
    });
    if (!res) apiFail(404, 'not_found', 'Оплата не найдена');
    c.header('Cache-Control', 'no-store');
    return c.json(res, 200);
  };
}

/** Транш под блокировкой для действия: проект виден сотруднику, замок — отказом. */
async function lockedPayment(
  tx: Tx,
  t: Translate,
  subject: AccessSubject,
  id: string,
  act: 'edit' | 'del',
) {
  const locked = await projectPaymentOf(tx, id, projectWhere(subject), true);
  const lock = await projectPaymentLock(
    t,
    subject,
    { deleted: !!locked.payment.deletedAt, archived: locked.contractor.archived },
    act,
    viewOnlyOnce(tx, t),
  );
  if (lock) lockFail(lock);
  return locked;
}

/* ───────────── «Изменить» и «Удалить» ───────────── */

export const projectPaymentEditRoute = createRoute({
  method: 'put',
  path: '/project-payments/{id}',
  tags: ['projects'],
  summary: '«Сохранить» в окне «Изменить: оплата по проекту»',
  middleware: [requirePermission('projects')] as const,
  request: { params: ProjectIdParam, body: body(ProjectPaymentEditRequest) },
  responses: {
    200: { description: 'Сохранено (или без изменений)', content: json(OperationEdited) },
    400: {
      description:
        'Сумма больше планируемой стоимости без остальных траншей; дата позже сегодня; нет причины',
      content: error,
    },
    401: unauthorized,
    403: off('«Вести проекты и разовые услуги»'),
    404: payNotFound,
    409: {
      description: 'Транш удалён, контрагент в архиве или запись изменена другим пользователем',
      content: error,
    },
  },
});

export function projectPaymentEditHandler(
  deps: ApiDeps,
): RouteHandler<typeof projectPaymentEditRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const out = await inProjects(deps, c, (tx) =>
      withMoneyErrors(async () =>
        editProjectPayment(
          tx,
          await lockedPayment(tx, t, subject, id, 'edit'),
          {
            version: input.version,
            amount: input.amount,
            date: input.date,
            note: input.note ?? '',
            reason: input.reason ?? '',
          },
          { today: todayOf(deps) },
        ),
      ),
    );
    return c.json(out, 200);
  };
}

export const projectPaymentDeleteRoute = createRoute({
  method: 'post',
  path: '/project-payments/{id}/delete',
  tags: ['projects'],
  summary: '«Удалить» оплату по проекту — транш',
  middleware: [requirePermission('projects')] as const,
  request: { params: ProjectIdParam, body: body(OperationDeleteRequest) },
  responses: {
    200: {
      description: 'Транш удалён с причиной; «получено» по проекту уменьшилось',
      content: json(OkResponse),
    },
    400: { description: 'Нет причины', content: error },
    401: unauthorized,
    403: off('«Вести проекты и разовые услуги»'),
    404: payNotFound,
    409: { description: 'Транш уже удалён, контрагент в архиве', content: error },
  },
});

export function projectPaymentDeleteHandler(
  deps: ApiDeps,
): RouteHandler<typeof projectPaymentDeleteRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    await inProjects(deps, c, (tx) =>
      withMoneyErrors(async () =>
        deleteProjectPayment(tx, await lockedPayment(tx, t, subject, id, 'del'), reason),
      ),
    );
    return c.json({ ok: true as const }, 200);
  };
}
