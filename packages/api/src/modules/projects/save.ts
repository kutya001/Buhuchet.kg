import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import {
  addProjectWork,
  createProject,
  projectCard,
  projectOf,
  setProjectStatus,
  setProjectWorkDone,
  updateProject,
  type LockedProject,
  type Tx,
} from '@buhuchet/db';
import {
  hasPermission,
  projectCancelable,
  projectWorksEditable,
  scaleBack,
  type AccessSubject,
  type Feature,
} from '@buhuchet/domain';
import {
  OkResponse,
  ProjectCard,
  ProjectEditRequest,
  ProjectIdParam,
  ProjectRequest,
  ProjectSaved,
  ProjectStatusRequest,
  ProjectWorkDoneRequest,
  ProjectWorkParam,
  ProjectWorkRequest,
} from '@buhuchet/shared';
import type { ApiDeps } from '../../deps';
import type { AppEnv } from '../../env';
import { apiFail, versionedSaveResponses } from '../../errors';
import { requirePermission } from '../../middleware/access';
import { subjectOf, todayOf, translateOf } from '../contractors/common';
import { cardBody } from './card';
import {
  body,
  canKeepProjects,
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
 * Изменения проекта (задача 2.26; прототип modules/projects.js `projectDlg`, `projActions`,
 * `setProjStatus`, `openProject`; ui/status-scale.js `stepTo`, `rollbackDlg` для `proj`): «Создать
 * проект», «Изменить», шаги шкалы, «Отменить проект», откат, работы в карточке. Вести проект — право
 * «Вести проекты и разовые услуги» (прототип `can('projects')`); отмечать и добавлять работы — ещё и
 * ответственный проекта (прототип `mine`). Проект — только видимый сотруднику (`projectVisibility`).
 */

/** Без права видеть деньги стоимость не меняется (прототип `projectDlg`: `if (mv) o.plan = plan`). */
function planOf(
  subject: AccessSubject,
  features: Readonly<Record<Feature, boolean>>,
  plan: number | null,
  before: number | null,
): number | null {
  return projectMoneyVisible(subject, features) ? plan : before;
}

const worksOf = (works: { name: string; executorId: string; due: string | null; id?: string }[]) =>
  works.map((w) => ({
    ...(w.id ? { id: w.id } : {}),
    name: w.name,
    executorEmployeeId: w.executorId,
    due: w.due,
  }));

/** Проект под блокировкой: видимый сотруднику; не виден — «не найден». */
const locked = (tx: Tx, subject: AccessSubject, id: string): Promise<LockedProject> =>
  projectOf(tx, id, projectWhere(subject), true);

const fieldErrors = {
  description:
    'Нет названия или дат, окончание раньше начала, нет ответственных, главный не из них, стоимость меньше полученного, работа без исполнителя',
  content: error,
};

export const projectCreateRoute = createRoute({
  method: 'post',
  path: '/projects',
  tags: ['projects'],
  summary: '«Создать проект»',
  middleware: [requirePermission('projects')] as const,
  request: { body: body(ProjectRequest) },
  responses: {
    201: { description: 'Проект создан', content: json(ProjectSaved) },
    400: fieldErrors,
    401: unauthorized,
    403: off('«Вести проекты и разовые услуги»'),
    409: { description: 'Контрагент в архиве', content: error },
  },
});

/** «Создать проект» (прототип `projectDlg` без `p0`): контрагент — в области группы «Проекты». */
export function projectCreateHandler(
  deps: ApiDeps,
): RouteHandler<typeof projectCreateRoute, AppEnv> {
  return async (c) => {
    const input = c.req.valid('json');
    const subject = subjectOf(c);
    const saved = await inProjects(deps, c, (tx, features) =>
      createProject(
        tx,
        {
          contractorId: input.contractorId,
          status: input.status,
          name: input.name,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          description: input.description,
          plan: planOf(subject, features, input.plan, null),
          members: input.members,
          lead: input.lead,
          works: worksOf(input.works),
        },
        { scope: projectCreateScope(subject) },
      ),
    );
    return c.json(saved, 201);
  };
}

export const projectEditRoute = createRoute({
  method: 'put',
  path: '/projects/{id}',
  tags: ['projects'],
  summary: '«Сохранить» в окне «Изменить проект»',
  middleware: [requirePermission('projects')] as const,
  request: { params: ProjectIdParam, body: body(ProjectEditRequest) },
  responses: {
    200: {
      description: 'Сохранено; изменения — в истории «было → стало»',
      content: json(OkResponse),
    },
    400: fieldErrors,
    401: unauthorized,
    403: off('«Вести проекты и разовые услуги»'),
    ...versionedSaveResponses,
    404: notFound,
    409: { description: 'Проект изменён другим пользователем', content: error },
  },
});

/**
 * «Изменить» (прототип `projectDlg` с `p0`): поля, ответственные, работы; статус меняется только на
 * шкале. Сделанные работы остаются.
 */
export function projectEditHandler(deps: ApiDeps): RouteHandler<typeof projectEditRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const subject = subjectOf(c);
    await inProjects(deps, c, async (tx, features) => {
      const l = await locked(tx, subject, id);
      const before = l.project.plan == null ? null : Number(l.project.plan);
      return updateProject(tx, l, {
        version: input.version,
        name: input.name,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        description: input.description,
        plan: planOf(subject, features, input.plan, before),
        members: input.members,
        lead: input.lead,
        works: worksOf(input.works),
      });
    });
    return c.json({ ok: true as const }, 200);
  };
}

export const projectStatusRoute = createRoute({
  method: 'post',
  path: '/projects/{id}/status',
  tags: ['projects'],
  summary: 'Статус проекта: шаг по шкале, «Отменить проект», откат на шаг',
  middleware: [requirePermission('projects')] as const,
  request: { params: ProjectIdParam, body: body(ProjectStatusRequest) },
  responses: {
    200: { description: 'Статус сменён; запись в «Истории статусов»', content: json(ProjectCard) },
    400: { description: 'Откат без причины', content: error },
    401: unauthorized,
    403: off('«Вести проекты и разовые услуги» (у отката — ещё «Откат статусов»)'),
    ...versionedSaveResponses,
    404: notFound,
    409: {
      description: 'Такого шага у проекта нет или проект изменён другим пользователем',
      content: error,
    },
  },
});

/**
 * Смена статуса (прототип `projActions`, `stepTo`, `rollbackDlg`): «В работу», «Завершить», «Отменить
 * проект» — право «Вести проекты»; «Откатить в «…»» — ещё «Откат статусов» и причина. Откат — шаг назад
 * по шкале (`scaleBack`), остальное — шаг вперёд или отмена.
 */
export function projectStatusHandler(
  deps: ApiDeps,
): RouteHandler<typeof projectStatusRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const { to, version, reason } = c.req.valid('json');
    const subject = subjectOf(c);
    const t = await translateOf(deps);
    const out = await inProjects(deps, c, async (tx, features) => {
      const l = await locked(tx, subject, id);
      const rollback = scaleBack('project', l.project.status) === to;
      if (rollback && !hasPermission(subject, 'rollback')) {
        apiFail(403, 'forbidden', 'Нужно право «Откат статусов»');
      }
      if (rollback && !reason) {
        apiFail(400, 'status.rollback_reason_required', 'Укажите причину отката', {
          field: 'reason',
        });
      }
      if (to === 'cancelled' && !projectCancelable(l.project.status)) {
        apiFail(409, 'project_status_invalid', 'Такой смены статуса у проекта нет');
      }
      await setProjectStatus(tx, l, to, { rollback, reason: reason ?? null, version });
      const card = (await projectCard(tx, id, undefined))!;
      return cardBody(tx, card, { subject, features, today: todayOf(deps), t });
    });
    return c.json(out, 200);
  };
}

/** Работы карточки: «Вести проекты» или ответственный проекта (прототип `openProject`: `mine`). */
function requireWorks(subject: AccessSubject, l: LockedProject): void {
  const viewer = { ...projectViewerOf(subject), canKeep: canKeepProjects(subject) };
  if (!projectWorksEditable(viewer, { members: l.members, status: l.project.status })) {
    apiFail(
      403,
      'project_work_add_forbidden',
      'Добавлять и отмечать работы может ответственный проекта или сотрудник с правом «Вести проекты и разовые услуги»',
    );
  }
}

export const projectWorkAddRoute = createRoute({
  method: 'post',
  path: '/projects/{id}/works',
  tags: ['projects'],
  summary: '«Добавить работу» в карточке проекта',
  middleware: [requirePermission('projView')] as const,
  request: { params: ProjectIdParam, body: body(ProjectWorkRequest) },
  responses: {
    201: { description: 'Работа добавлена; запись в истории', content: json(ProjectSaved) },
    400: { description: 'Нет названия, исполнитель не из ответственных', content: error },
    401: unauthorized,
    403: off('«Вести проекты и разовые услуги» и сотрудник не ответственный проекта'),
    404: notFound,
  },
});

export function projectWorkAddHandler(
  deps: ApiDeps,
): RouteHandler<typeof projectWorkAddRoute, AppEnv> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const subject = subjectOf(c);
    const saved = await inProjects(deps, c, async (tx) => {
      const l = await locked(tx, subject, id);
      requireWorks(subject, l);
      return addProjectWork(tx, l, {
        name: input.name,
        executorEmployeeId: input.executorId,
        due: input.due,
      });
    });
    return c.json(saved, 201);
  };
}

export const projectWorkDoneRoute = createRoute({
  method: 'put',
  path: '/projects/{id}/works/{workId}/done',
  tags: ['projects'],
  summary: 'Галочка «Сделано» у работы проекта',
  middleware: [requirePermission('projView')] as const,
  request: { params: ProjectWorkParam, body: body(ProjectWorkDoneRequest) },
  responses: {
    200: { description: 'Отмечено; запись в истории', content: json(OkResponse) },
    401: unauthorized,
    403: off('«Вести проекты и разовые услуги» и сотрудник не ответственный проекта'),
    404: { description: 'Нет такого проекта или работы', content: error },
  },
});

export function projectWorkDoneHandler(
  deps: ApiDeps,
): RouteHandler<typeof projectWorkDoneRoute, AppEnv> {
  return async (c) => {
    const { id, workId } = c.req.valid('param');
    const { done } = c.req.valid('json');
    const subject = subjectOf(c);
    await inProjects(deps, c, async (tx) => {
      const l = await locked(tx, subject, id);
      requireWorks(subject, l);
      return setProjectWorkDone(tx, l, workId, done);
    });
    return c.json({ ok: true as const }, 200);
  };
}
