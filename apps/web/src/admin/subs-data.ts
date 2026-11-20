'use client';

import {
  AdminSubscriptionCard,
  AdminSubscriptionList,
  AdminSubscriptionPlans,
  AdminSubscriptionSettings,
  AdminSubscriptionsSummary,
  ListValues,
  type AdminSubscriptionRow,
  type SubscriptionConfirmRequest,
  type SubscriptionEditRequest,
  type SubscriptionPlanRequest,
  type SubscriptionPlanUpdate,
  type SubscriptionRejectRequest,
  type SubscriptionSettingsUpdate,
} from '@buhuchet/shared';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import type { FetchListPage } from '../lists/use-list-page';

/*
 * Данные вкладки «Подписки» Админки → «Организации» (доработки 20.11.2026, блок 6; прототип
 * admin/subs-admin.js; этап 1, П3): список организаций с плашками, окно «Подписка организации», чек,
 * «Подтвердить оплату», «Отклонить», «Изменить подписку», «Виды подписок», «Цены и реквизиты».
 * После записи — `useSubsRefresh`.
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

const json = async <T>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

const subs = api.api.admin.subscriptions;
const plans = api.api.admin['subscription-plans'];
const settings = api.api.admin['subscription-settings'];

export const SUBS_KEY = ['admin', 'subs'] as const;

export const fetchSubscriptions: FetchListPage<AdminSubscriptionRow> = async (params) =>
  json(await subs.$get({ query: params }), (v) => AdminSubscriptionList.parse(v));

/** Значения столбца для фильтра-галочек; `q` — «Найти значение». */
export const fetchSubscriptionValues = async (col: string, q?: string) =>
  json(await subs.values.$get({ query: q ? { col, q } : { col } }), (v) => ListValues.parse(v));

/** Плашки и счётчик вкладки: организаций по статусам, чеков дольше срока, ждут проверки. */
export const subsSummaryQuery = queryOptions({
  queryKey: [...SUBS_KEY, 'summary'],
  queryFn: async () => json(await subs.summary.$get(), (v) => AdminSubscriptionsSummary.parse(v)),
});

/** Окно «Подписка организации» и вкладка «Подписка» карточки организации. */
export const subCardQuery = (orgId: string) =>
  queryOptions({
    queryKey: [...SUBS_KEY, 'card', orgId],
    queryFn: async () =>
      json(await subs[':orgId'].$get({ param: { orgId } }), (v) => AdminSubscriptionCard.parse(v)),
    retry: false,
  });

/** «Виды подписок» с «Историей изменений» видов и цен. */
export const subPlansQuery = queryOptions({
  queryKey: [...SUBS_KEY, 'plans'],
  queryFn: async () => json(await plans.$get(), (v) => AdminSubscriptionPlans.parse(v)),
});

/** «Цены и реквизиты». */
export const subSettingsQuery = queryOptions({
  queryKey: [...SUBS_KEY, 'settings'],
  queryFn: async () => json(await settings.$get(), (v) => AdminSubscriptionSettings.parse(v)),
});

export function confirmSubPayment(id: string, body: SubscriptionConfirmRequest) {
  return callApi(() => subs.payments[':id'].confirm.$post({ param: { id }, json: body }));
}

export function rejectSubPayment(id: string, body: SubscriptionRejectRequest) {
  return callApi(() => subs.payments[':id'].reject.$post({ param: { id }, json: body }));
}

/** «Изменить подписку» / «Поставить подписку»: ответ — окно подписки. */
export function editSubscription(orgId: string, body: SubscriptionEditRequest) {
  return callApi(() => subs[':orgId'].$put({ param: { orgId }, json: body }));
}

export function createSubPlan(body: SubscriptionPlanRequest) {
  return callApi(() => plans.$post({ json: body }));
}

export function updateSubPlan(id: string, body: SubscriptionPlanUpdate) {
  return callApi(() => plans[':id'].$put({ param: { id }, json: body }));
}

export function deleteSubPlan(id: string, version: number) {
  return callApi(() =>
    plans[':id'].$delete({ param: { id }, query: { version: String(version) } }),
  );
}

export function saveSubSettings(body: SubscriptionSettingsUpdate) {
  return callApi(() => settings.$put({ json: body }));
}

/**
 * После проверки чека, «Изменить подписку», правки видов и цен — перечитать список с плашками, окна
 * подписки, виды и цены, список организаций Админки (там тоже видна подписка) и открытую карточку
 * организации: её «История» показывает изменение подписки сразу (ключ — `ORG_CARD_KEY`, typical-mistakes № 44).
 */
export function useSubsRefresh() {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: SUBS_KEY });
    void client.invalidateQueries({ queryKey: ['admin', 'org-card'] });
    void client.invalidateQueries({ queryKey: ['list', 'orgs.subs'] });
    void client.invalidateQueries({ queryKey: ['list', 'orgs.list'] });
    void client.invalidateQueries({ queryKey: ['admin', 'orgs-summary'] });
  }, [client]);
}
