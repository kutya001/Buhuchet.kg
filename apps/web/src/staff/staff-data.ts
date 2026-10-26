'use client';

import { Employee, OrgPolicy, PhoneCodes, RoleList } from '@buhuchet/shared';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '../api-client';

/**
 * Данные окон модуля «Сотрудники» через TanStack Query: карточка сотрудника, все роли для выбора,
 * роль новых сотрудников из учётной политики, коды телефонов. Окно с полями открывается, когда
 * данные уже есть (`ensureQueryData`): фокус сразу встаёт в первое поле. После правки —
 * `useStaffRefresh`.
 */

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

const json = async <T>(res: JsonResponse, parse: (v: unknown) => T, what: string) => {
  if (!res.ok) throw new Error(`${what}: ${res.status}`);
  return parse(await res.json());
};

/** Справочник «Коды телефонов» — один раз за сеанс страницы. */
export const phoneCodesQuery = queryOptions({
  queryKey: ['phone-codes'],
  queryFn: async () =>
    json(await api.api['phone-codes'].$get(), (v) => PhoneCodes.parse(v).items, 'phone-codes'),
  staleTime: Infinity,
});

/** Все роли организации по названию — для «Роль» в формах (только с правом «Сотрудники и роли»). */
export const allRolesQuery = queryOptions({
  queryKey: ['roles', 'all'],
  queryFn: async () =>
    json(
      await api.api.roles.$get({ query: { size: 'all', sort: 'name.asc' } }),
      (v) => RoleList.parse(v).items,
      'roles',
    ),
});

/** Учётная политика: роль новых сотрудников (прототип `ORG.defaultRole`) и включённые модули. */
export const policyQuery = queryOptions({
  queryKey: ['org', 'policy'],
  queryFn: async () => json(await api.api.org.policy.$get(), (v) => OrgPolicy.parse(v), 'policy'),
});

/** Карточка сотрудника. */
export const employeeQuery = (id: string) =>
  queryOptions({
    queryKey: ['staff', id],
    queryFn: async () =>
      json(
        await api.api.staff[':id'].$get({ param: { id } }),
        (v) => Employee.parse(v),
        'employee',
      ),
  });

export function useEmployee(id: string) {
  return useQuery(employeeQuery(id));
}

/**
 * После правки сотрудника или роли — перечитать всё, что её показывает: карточки, списки сотрудников
 * и ролей, роли для выбора.
 */
export function useStaffRefresh() {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: ['staff'] });
    void client.invalidateQueries({ queryKey: ['roles'] });
    void client.invalidateQueries({ queryKey: ['role'] });
    void client.invalidateQueries({ queryKey: ['list', 'staff.list'] });
    void client.invalidateQueries({ queryKey: ['list', 'staff.roles'] });
  }, [client]);
}
