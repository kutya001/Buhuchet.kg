'use client';

import type { LeadState } from '@buhuchet/domain';
import {
  AdminLeadCard,
  AdminLeadList,
  AdminLeadSummary,
  ListValues,
  type AdminLead,
  type LeadNoteRequest,
  type LeadStatusRequest,
} from '@buhuchet/shared';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import type { FetchListPage } from '../lists/use-list-page';

/*
 * Данные вкладки «Заявки» Админки → «Организации» (задача #165; прототип admin/leads.js): страница
 * списка, значения фильтра, число новых (счётчик вкладки и плитка «Заявки с сайта»), окно заявки,
 * смена статуса, заметка, удаление. После записи — `useLeadsRefresh`.
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

const json = async <T>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

const leads = api.api.admin.leads;

/** Что о заявке знают правила меню, шкалы и смены статуса (`@buhuchet/domain`, admin/leads.ts). */
export const leadState = (l: AdminLead): LeadState => ({
  status: l.status,
  statusBefore: l.statusBefore,
  hasOrg: l.org !== null,
});

export const fetchLeads: FetchListPage<AdminLeadList['items'][number]> = async (params) =>
  json(await leads.$get({ query: params }), (v) => AdminLeadList.parse(v));

/** Значения столбца для фильтра-галочек; `q` — «Найти значение». */
export const fetchLeadValues = async (col: string, q?: string) =>
  json(await leads.values.$get({ query: q ? { col, q } : { col } }), (v) => ListValues.parse(v));

/** Заявок «Новая»: счётчик вкладки «Заявки» и плитка «Заявки с сайта» (прототип `leadNew`). */
export const leadSummaryQuery = queryOptions({
  queryKey: ['admin', 'leads', 'summary'],
  queryFn: async () => json(await leads.summary.$get(), (v) => AdminLeadSummary.parse(v)),
});

/** Окно заявки. */
export const leadCardQuery = (id: string) =>
  queryOptions({
    queryKey: ['admin', 'leads', 'card', id],
    queryFn: async () =>
      json(await leads[':id'].$get({ param: { id } }), (v) => AdminLeadCard.parse(v)),
    retry: false,
  });

export function setLeadStatus(id: string, body: LeadStatusRequest) {
  return callApi(() => leads[':id'].status.$post({ param: { id }, json: body }));
}

export function saveLeadNote(id: string, body: LeadNoteRequest) {
  return callApi(() => leads[':id'].note.$post({ param: { id }, json: body }));
}

export function removeLead(id: string) {
  return callApi(() => leads[':id'].$delete({ param: { id } }));
}

/**
 * После смены статуса, заметки, удаления и «Создать организацию» — перечитать список, число новых,
 * окно заявки и список организаций с плашками.
 */
export function useLeadsRefresh() {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: ['admin', 'leads'] });
    void client.invalidateQueries({ queryKey: ['list', 'orgs.leads'] });
    void client.invalidateQueries({ queryKey: ['list', 'orgs.list'] });
    void client.invalidateQueries({ queryKey: ['admin', 'orgs-summary'] });
  }, [client]);
}
