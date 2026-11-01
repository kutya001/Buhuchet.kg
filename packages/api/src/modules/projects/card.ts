import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  contractorProjects,
  projectCard,
  projectFormData,
  readStatusHistory,
  taskContractorOf,
  type ProjectCard as ProjectCardRecord,
} from '@buhuchet/db';
import {
  hasPermission,
  projectOverdue,
  projectWorkOverdue,
  projectWorksEditable,
  taskOverdue,
  type AccessSubject,
  type Feature,
  type HistoryAction,
  type IsoDate,
  type ProjectStatus,
  type TaskStatus,
} from '@buhuchet/domain';
import {
  ContractorProjects,
  ProjectCard,
  ProjectForm,
  ProjectFormQuery,
  ProjectIdParam,
  type ProjectCard as ProjectCardBody,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail } from '../../errors';
import { requirePermission } from '../../middleware/access';
import { subjectOf, todayOf } from '../contractors/common';
import { cpScopeOf } from '../tasks/common';
import {
  canKeepProjects,
  canTaskProjects,
  error,
  inProjects,
  json,
  notFound,
  off,
  projectCreateScope,
  projectMoneyVisible,
  projectViewerOf,
  projectWhere,
  unauthorized,
} from './common';

/*
 * Карточка проекта, окно проекта и вкладка «Проекты» карточки контрагента (задача 2.26; прототип
 * modules/projects.js `openProject`, `projectDlg`; modules/contractor-card.js).
 */

/** Блок «Файлы» карточки: «Файлы в карточках» включены и есть право «Просматривать файлы». */
const filesBlock = (subject: AccessSubject, features: Readonly<Record<Feature, boolean>>) =>
  features.files && hasPermission(subject, 'filesView');

/** Карточка для ответа API: деньги и задачи — тому, кто их видит. */
export async function cardBody(
  tx: Parameters<typeof readStatusHistory>[0],
  card: ProjectCardRecord,
  ctx: { subject: AccessSubject; features: Readonly<Record<Feature, boolean>>; today: IsoDate },
): Promise<ProjectCardBody> {
  const { subject, features, today } = ctx;
  const p = card.project;
  const status = p.status as ProjectStatus;
  const files = filesBlock(subject, features);
  const statuses = await readStatusHistory(tx, 'project', p.id);
  const viewer = { ...projectViewerOf(subject), canKeep: canKeepProjects(subject) };
  return {
    id: p.id,
    version: p.version,
    name: p.name,
    contractor: {
      id: card.contractor.id,
      name: card.contractor.name,
      archived: card.contractor.archived,
    },
    status,
    startsOn: p.startsOn,
    endsOn: p.endsOn,
    description: p.description,
    overdue: projectOverdue({ status, endsOn: p.endsOn }, today),
    lead: { id: p.leadEmployeeId, name: card.leadName },
    members: card.memberNames,
    money: projectMoneyVisible(subject, features)
      ? { plan: p.plan == null ? null : Number(p.plan), paid: card.paid }
      : null,
    works: card.works.map((w) => ({
      ...w,
      overdue: projectWorkOverdue({ done: w.done, due: w.due }, today),
    })),
    tasks: features.tasks
      ? card.tasks.map((t) => ({
          id: t.id,
          title: t.title,
          executorName: t.executorName,
          dueDate: t.dueDate,
          term: t.term as 'day' | 'month',
          status: t.status as TaskStatus,
          overdue: taskOverdue({ status: t.status as TaskStatus, dueDate: t.dueDate }, today),
        }))
      : null,
    files,
    statusHistory: statuses.map((h) => ({ ...h, at: h.at.toISOString(), file: null })),
    // Записи о файлах — тому, кто видит файлы.
    history: card.history
      .filter((h) => files || (h.action !== 'file_attach' && h.action !== 'file_delete'))
      .map((h) => ({
        id: h.id,
        at: h.at.toISOString(),
        actor: h.actorName,
        action: h.action as HistoryAction,
        changes: (h.changes as { field: string; from?: unknown; to?: unknown }[]) ?? [],
        reason: h.reason,
      })),
    names: card.names,
    audit: {
      createdAt: p.createdAt.toISOString(),
      createdBy: card.createdName,
      updatedAt: (p.updatedAt ?? p.createdAt).toISOString(),
      updatedBy: card.updatedName ?? card.createdName,
    },
    can: {
      keep: canKeepProjects(subject),
      works: projectWorksEditable(viewer, { members: card.members, status }),
      rollback: hasPermission(subject, 'rollback'),
      task: canTaskProjects(subject, features),
    },
  };
}

export const projectCardRoute = createRoute({
  method: 'get',
  path: '/projects/{id}',
  tags: ['projects'],
  summary: 'Карточка проекта',
  middleware: [requirePermission('projView')] as const,
  request: { params: ProjectIdParam },
  responses: {
    200: {
      description:
        'Шкала, «История статусов», срок, ответственные, деньги, работы, задачи, история; что можно сделать',
      content: json(ProjectCard),
    },
    401: unauthorized,
    403: off('«Просматривать проекты»'),
    404: notFound,
  },
});

/** Карточка проекта (прототип `openProject`): невидимый проект — «не найден», как чужой организации. */
export function projectCardHandler(deps: ApiDeps): RouteHandler<typeof projectCardRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const out = await inProjects(deps, c, async (tx, features) => {
      const card = await projectCard(tx, id, projectWhere(subject));
      if (!card) apiFail(404, 'project_not_found', 'Проект не найден');
      return cardBody(tx, card, { subject, features, today: todayOf(deps) });
    });
    c.header('Cache-Control', 'no-store');
    return c.json(out, 200);
  };
}

export const projectFormRoute = createRoute({
  method: 'get',
  path: '/projects/form',
  tags: ['projects'],
  summary: 'Окно проекта: контрагенты и сотрудники',
  middleware: [requirePermission('projects')] as const,
  request: { query: ProjectFormQuery },
  responses: {
    200: {
      description:
        'Контрагенты области группы «Проекты контрагентов» не в архиве, действующие сотрудники, кто открыл окно',
      content: json(ProjectForm),
    },
    401: unauthorized,
    403: off('«Вести проекты и разовые услуги»'),
  },
});

export function projectFormHandler(deps: ApiDeps): RouteHandler<typeof projectFormRoute, AppEnv> {
  return async (c) => {
    const { contractorId } = c.req.valid('query');
    const subject = subjectOf(c);
    const out = await inProjects(deps, c, async (tx, features) => {
      const data = await projectFormData(tx, projectCreateScope(subject), contractorId ?? null);
      return {
        contractors: data.contractors,
        employees: data.employees,
        me: subject.employeeId ?? null,
        today: todayOf(deps),
        money: projectMoneyVisible(subject, features),
      };
    });
    c.header('Cache-Control', 'no-store');
    return c.json(out, 200);
  };
}

export const contractorProjectsRoute = createRoute({
  method: 'get',
  path: '/contractors/{id}/projects',
  tags: ['projects'],
  summary: 'Вкладка «Проекты» карточки контрагента',
  middleware: [requirePermission('cpView'), requirePermission('projView')] as const,
  request: { params: ProjectIdParam },
  responses: {
    200: {
      description: 'Проекты контрагента: срок, статус, главный; деньги — тому, кто их видит',
      content: json(ContractorProjects),
    },
    401: unauthorized,
    403: off('«Просматривать контрагентов» или «Просматривать проекты»'),
    404: { description: 'Нет такого контрагента или он вне области сотрудника', content: error },
  },
});

/**
 * Вкладка «Проекты» (прототип contractor-card.js): проекты контрагента, которого сотрудник видит; из них
 * — те, что он видит в модуле (прототип показывает все проекты контрагента).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#Г-10
export function contractorProjectsHandler(
  deps: ApiDeps,
): RouteHandler<typeof contractorProjectsRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const subject = subjectOf(c);
    const out = await inProjects(deps, c, async (tx, features) => {
      const cp = await taskContractorOf(tx, id, cpScopeOf(subject));
      if (!cp) apiFail(404, 'contractor_not_found', 'Контрагент не найден');
      const money = projectMoneyVisible(subject, features);
      const items = await contractorProjects(tx, id, projectWhere(subject));
      return {
        items: items.map((p) => ({
          id: p.id,
          name: p.name,
          startsOn: p.startsOn,
          endsOn: p.endsOn,
          status: p.status,
          leadName: p.leadName,
          money: money ? { plan: p.plan, paid: p.paid } : null,
        })),
        canCreate: canKeepProjects(subject) && !cp.archived,
        money,
      };
    });
    c.header('Cache-Control', 'no-store');
    return c.json(out, 200);
  };
}
