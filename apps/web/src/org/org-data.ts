'use client';

import { OrgPolicy, OrgPolicyHistory, OrgProfile, OrgRoleOptions } from '@buhuchet/shared';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { api, apiFailure } from '../api-client';

/**
 * Данные модуля «Моя организация» через TanStack Query: «Основное», учётная политика и настройки,
 * история учётной политики, роли для «Роли по умолчанию». После сохранения — `useOrgRefresh`.
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

const json = async <T>(res: JsonResponse, parse: (v: unknown) => T) => {
  if (!res.ok) throw await apiFailure(res);
  return parse(await res.json());
};

/** «Основное»: название, ИНН, адрес, телефон, руководитель, адрес страницы, ссылка на логотип. */
export const orgProfileQuery = queryOptions({
  queryKey: ['org', 'profile'],
  queryFn: async () => json(await api.api.org.$get(), (v) => OrgProfile.parse(v)),
});

/** Учётная политика и настройки; роль новых сотрудников (прототип `ORG.defaultRole`). */
export const policyQuery = queryOptions({
  queryKey: ['org', 'policy'],
  queryFn: async () => json(await api.api.org.policy.$get(), (v) => OrgPolicy.parse(v)),
});

/** «История изменений учётной политики»: сначала новые. */
export const policyHistoryQuery = queryOptions({
  queryKey: ['org', 'policy-history'],
  queryFn: async () =>
    json(await api.api.org.policy.history.$get(), (v) => OrgPolicyHistory.parse(v)),
});

/** Роли для «Роли по умолчанию» — только с правом «Настройки и учётная политика». */
export const roleOptionsQuery = queryOptions({
  queryKey: ['org', 'role-options'],
  queryFn: async () =>
    json(await api.api.org['role-options'].$get(), (v) => OrgRoleOptions.parse(v).items),
});

/**
 * После сохранения: перечитать данные модуля, а с `shell` — и оболочку: название организации в левой
 * панели и модули меню приходят с сервера (`/api/auth/me` в макете), отключённая функция пропадает из
 * меню сразу (прототип refreshAll).
 */
export function useOrgRefresh() {
  const client = useQueryClient();
  const router = useRouter();
  return useCallback(
    (shell = true) => {
      void client.invalidateQueries({ queryKey: ['org'] });
      if (shell) router.refresh();
    },
    [client, router],
  );
}
