'use client';

import {
  Contractor,
  ContractorFormOptions,
  ContractorGkedNotes,
  ContractorSocfundCheck,
  GkedSearchResult,
  type ContractorGkedCheckRequest,
  type ContractorSocfundCheckRequest,
} from '@buhuchet/shared';
import { keepPreviousData, queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiFailure } from '../api-client';

/*
 * Данные формы контрагента (задача 2.09): значения полей, поиск по ГКЭД, сверка набранного с ГКЭД и
 * тариф Соцфонда по набранным признакам (форма ничего не сохраняет до «Сохранить»), сам контрагент для
 * «Изменить». После сохранения — `useContractorsRefresh`.
 */

/** Сотрудники для «Ответственный бухгалтер», ответственный по умолчанию и видна ли плата. */
export const formOptionsQuery = queryOptions({
  queryKey: ['contractors', 'form-options'],
  queryFn: async () => {
    const res = await api.api.contractors['form-options'].$get();
    if (!res.ok) throw await apiFailure(res);
    return ContractorFormOptions.parse(await res.json());
  },
});

/** Окно выбора ГКЭД: справочник платформы меняется редко — ответ на строку поиска не перечитывается. */
export const gkedSearchQuery = (q: string) =>
  queryOptions({
    queryKey: ['contractors', 'gked-search', q],
    queryFn: async () => {
      const res = await api.api.contractors['gked-search'].$get({ query: { q } });
      if (!res.ok) throw await apiFailure(res);
      return GkedSearchResult.parse(await res.json());
    },
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });

/** Предупреждения ГКЭД под полями формы; пока перечитывается, видны прежние. */
export const gkedCheckQuery = (req: ContractorGkedCheckRequest) =>
  queryOptions({
    queryKey: ['contractors', 'gked-check', req],
    queryFn: async () => {
      const res = await api.api.contractors['gked-check'].$post({ json: req });
      if (!res.ok) throw await apiFailure(res);
      return ContractorGkedNotes.parse(await res.json());
    },
    placeholderData: keepPreviousData,
  });

/** Тариф Соцфонда по набранным значениям (блок «Тариф Соцфонда» формы). */
export const socfundCheckQuery = (req: ContractorSocfundCheckRequest) =>
  queryOptions({
    queryKey: ['contractors', 'socfund-check', req],
    queryFn: async () => {
      const res = await api.api.contractors['socfund-check'].$post({ json: req });
      if (!res.ok) throw await apiFailure(res);
      return ContractorSocfundCheck.parse(await res.json());
    },
    placeholderData: keepPreviousData,
  });

/** Контрагент для «Изменить» и карточки. */
export const contractorQuery = (id: string) =>
  queryOptions({
    queryKey: ['contractors', 'card', id],
    queryFn: async () => {
      const res = await api.api.contractors[':id'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return Contractor.parse(await res.json());
    },
  });

/** После сохранения контрагента — перечитать всё о контрагентах: список, карточку, подбор, отчёты. */
export function useContractorsRefresh() {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: ['contractors'] });
    void client.invalidateQueries({ queryKey: ['list'] });
  }, [client]);
}
