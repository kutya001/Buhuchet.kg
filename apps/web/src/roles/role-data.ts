'use client';

import { PermissionCatalog, Role } from '@buhuchet/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '../api-client';

/**
 * Данные карточки и формы роли через TanStack Query: справочник «Права ролей» (названия и описания —
 * один раз за сеанс страницы) и роль с правами и областью. После правки — `useStaffRefresh`.
 */

/** Справочник «Права ролей» в порядке формы. */
export const permissionCatalogQuery = queryOptions({
  queryKey: ['permissions'],
  queryFn: async () => {
    const res = await api.api.permissions.$get();
    if (!res.ok) throw new Error(`permissions: ${res.status}`);
    return PermissionCatalog.parse(await res.json()).items;
  },
  staleTime: Infinity,
});

/** Роль: права и область групп. */
export const roleQuery = (id: string) =>
  queryOptions({
    queryKey: ['role', id],
    queryFn: async () => {
      const res = await api.api.roles[':id'].$get({ param: { id } });
      if (!res.ok) throw new Error(`role: ${res.status}`);
      return Role.parse(await res.json());
    },
  });
