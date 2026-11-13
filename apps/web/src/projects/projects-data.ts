'use client';

import {
  ContractorProjects,
  ListValues,
  ProjectCard,
  ProjectForm,
  ProjectPaymentWindow,
  ProjectSummary,
  TaskProjects,
  type ProjectEditRequest,
  type ProjectPaymentEditRequest,
  type ProjectPaymentRequest,
  type ProjectRequest,
  type ProjectStatusRequest,
  type ProjectWorkRequest,
} from '@buhuchet/shared';
import type { ShellCount } from '@buhuchet/ui';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { useFinanceRefresh } from '../finance/finance-data';

/**
 * Данные модуля «Проекты контрагентов» (задача 2.26; прототип modules/projects.js): числа вкладок и
 * плашки, карточка проекта, окно «Новый проект» / «Изменить проект», вкладка «Проекты» карточки
 * контрагента, поле «Проект» формы задачи. После записи — `useProjectsRefresh`.
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

const json = async <T>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

/**
 * Главные по проектам вкладки — столбцы доски «по главному», видные и пустыми (прототип v85
 * `projKanban`, `show.lead`). Значения — того же списка, что видит сотрудник.
 */
export const boardLeadQuery = (tab: 'active' | 'all' | 'mine') =>
  queryOptions({
    queryKey: ['projects', 'board-lead', tab],
    queryFn: async () => {
      const res = await api.api.projects.values.$get({ query: { col: 'lead', tab } });
      if (!res.ok) throw await apiFailure(res);
      return ListValues.parse(await res.json())
        .items.filter((v) => v.value !== '' && v.label !== null)
        .map((v) => ({ key: v.value, label: v.label ?? '' }));
    },
  });

/** Числа вкладок, плашки и что сотрудник может (прототип `projTabs`, `renderProjects`). */
export const projectSummaryQuery = queryOptions({
  queryKey: ['projects', 'summary'],
  queryFn: async () => json(await api.api.projects.summary.$get(), (v) => ProjectSummary.parse(v)),
});

/**
 * Числа у вкладок (прототип `projTabs`): «Активные» и «Мои» — активные проекты; у «Все» числа нет.
 * Нулевой счётчик не показывается.
 */
export const projectTabCountsQuery = queryOptions({
  queryKey: ['projects', 'summary'],
  queryFn: async () => json(await api.api.projects.summary.$get(), (v) => ProjectSummary.parse(v)),
  select: (s): Partial<Record<string, ShellCount>> => ({
    active: s.active ? { value: s.active } : undefined,
    mine: s.mine ? { value: s.mine } : undefined,
  }),
});

/** Карточка проекта. */
export const projectCardQuery = (id: string) =>
  queryOptions({
    queryKey: ['projects', 'card', id],
    queryFn: async () =>
      json(await api.api.projects[':id'].$get({ param: { id } }), (v) => ProjectCard.parse(v)),
  });

/** Окно проекта: контрагенты области, действующие сотрудники, сегодня, поле стоимости. */
export const projectFormQuery = (contractorId: string | null) =>
  queryOptions({
    queryKey: ['projects', 'form', contractorId],
    queryFn: async () =>
      json(await api.api.projects.form.$get({ query: contractorId ? { contractorId } : {} }), (v) =>
        ProjectForm.parse(v),
      ),
    staleTime: 0,
  });

/** Вкладка «Проекты» карточки контрагента. */
export const contractorProjectsQuery = (contractorId: string) =>
  queryOptions({
    queryKey: ['projects', 'contractor', contractorId],
    queryFn: async () =>
      json(await api.api.contractors[':id'].projects.$get({ param: { id: contractorId } }), (v) =>
        ContractorProjects.parse(v),
      ),
  });

/** Поле «Проект» формы задачи: активные проекты контрагента и уже выбранный. */
export const taskProjectsQuery = (contractorId: string, current: string | null) =>
  queryOptions({
    queryKey: ['projects', 'for-task', contractorId, current],
    queryFn: async () =>
      json(
        await api.api.tasks['form-projects'].$get({
          query: current ? { contractorId, current } : { contractorId },
        }),
        (v) => TaskProjects.parse(v),
      ),
    staleTime: 0,
  });

/** «Создать проект». */
export function createProject(json: ProjectRequest) {
  return callApi(() => api.api.projects.$post({ json }));
}

/** «Сохранить» в окне «Изменить проект». */
export function editProject(id: string, json: ProjectEditRequest) {
  return callApi(() => api.api.projects[':id'].$put({ param: { id }, json }));
}

/** Смена статуса: шаг, «Отменить проект», откат с причиной. */
export function setProjectStatus(id: string, json: ProjectStatusRequest) {
  return callApi(() => api.api.projects[':id'].status.$post({ param: { id }, json }));
}

/** «Добавить работу» в карточке. */
export function addProjectWork(id: string, json: ProjectWorkRequest) {
  return callApi(() => api.api.projects[':id'].works.$post({ param: { id }, json }));
}

/** Галочка «Сделано» у работы. */
export function setProjectWorkDone(id: string, workId: string, done: boolean) {
  return callApi(() =>
    api.api.projects[':id'].works[':workId'].done.$put({
      param: { id, workId },
      json: { done },
    }),
  );
}

/** Окно транша (оплаты по проекту). */
export const projectPaymentQuery = (id: string) =>
  queryOptions({
    queryKey: ['projects', 'payment', id],
    queryFn: async () =>
      json(await api.api['project-payments'][':id'].$get({ param: { id } }), (v) =>
        ProjectPaymentWindow.parse(v),
      ),
  });

/** «Записать оплату» по проекту — транш. */
export function payProject(id: string, json: ProjectPaymentRequest) {
  return callApi(() => api.api.projects[':id'].payments.$post({ param: { id }, json }));
}

/** «Сохранить» в окне «Изменить: оплата по проекту». */
export function editProjectPayment(id: string, json: ProjectPaymentEditRequest) {
  return callApi(() => api.api['project-payments'][':id'].$put({ param: { id }, json }));
}

/** «Удалить» транш с причиной. */
export function deleteProjectPayment(id: string, reason: string) {
  return callApi(() =>
    api.api['project-payments'][':id'].delete.$post({ param: { id }, json: { reason } }),
  );
}

/**
 * После записи — перечитать всё, что показывает проекты: списки вкладок, числа, карточки, вкладку
 * контрагента и его историю, задачи (столбец и карточка «Проект»), файлы проекта.
 */
export function useProjectsRefresh() {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: ['projects'] });
    for (const tab of ['active', 'all', 'mine'])
      void client.invalidateQueries({ queryKey: ['list', `projects.${tab}`] });
    void client.invalidateQueries({ queryKey: ['contractors', 'history'] });
    void client.invalidateQueries({ queryKey: ['files', 'project'] });
  }, [client]);
}

/**
 * После записи транша — и проекты (карточка, «получено», плашки), и «Финансовые операции» (строки
 * журнала, плашка «Проекты и разовые услуги»), и файлы транша.
 */
export function usePaymentsRefresh() {
  const client = useQueryClient();
  const projects = useProjectsRefresh();
  const finance = useFinanceRefresh();
  return useCallback(() => {
    projects();
    finance();
    void client.invalidateQueries({ queryKey: ['files', 'project_payment'] });
  }, [client, projects, finance]);
}
