'use client';

import { ContractorPage } from '@buhuchet/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, apiFailure } from '../api-client';

/**
 * Блок «Страница контрагента» карточки (задача 2.42) через TanStack Query. Функция выключена в учётной
 * политике — null: блока в карточке нет. Действия отвечают блоком целиком — его кладут в кэш.
 */
export const contractorPageQuery = (contractorId: string) =>
  queryOptions({
    queryKey: ['contractor-page', contractorId],
    queryFn: async (): Promise<ContractorPage | null> => {
      const res = await api.api.contractors[':id'].page.$get({ param: { id: contractorId } });
      if (res.ok) return ContractorPage.parse(await res.json());
      const failure = await apiFailure(res);
      if (failure.error.code === 'cppage_off') return null;
      throw failure;
    },
  });
