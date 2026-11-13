'use client';

import {
  BonusBalanceList,
  BonusEmployee,
  BonusLogList,
  BonusSummary,
  ListValues,
  type BonusBalanceRow,
  type BonusLogRow,
  type BonusOutRequest,
} from '@buhuchet/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, apiFailure, callApi } from '../api-client';
import type { FetchListPage } from '../lists/use-list-page';

/**
 * Данные бонусов сотрудников (прототип v84 и v87: modules/staff.js — вкладка «Бонусы»; modules/services.js
 * — `bonusSum`, `bonusLog`, `bonusOutDlg`, `bonusUndo`). Ключи — под `['finance']`: после записи их
 * перечитывает `useFinanceRefresh` вместе со списками `staff.bonus…`.
 */

/** Плашки вкладки и что на ней доступно. */
export const bonusSummaryQuery = queryOptions({
  queryKey: ['finance', 'bonuses', 'summary'],
  queryFn: async () => {
    const res = await api.api.bonuses.summary.$get();
    if (!res.ok) throw await apiFailure(res);
    return BonusSummary.parse(await res.json());
  },
});

/** Окно сотрудника: накопления и «Списать бонус». */
export const bonusEmployeeQuery = (id: string) =>
  queryOptions({
    queryKey: ['finance', 'bonuses', 'employee', id],
    queryFn: async () => {
      const res = await api.api.bonuses.employees[':id'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return BonusEmployee.parse(await res.json());
    },
    staleTime: 0,
  });

export const fetchBonusBalances: FetchListPage<BonusBalanceRow> = async (params) => {
  const res = await api.api.bonuses.balances.$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return BonusBalanceList.parse(await res.json());
};

export const fetchBonusBalanceValues = async (col: string, q?: string) => {
  const res = await api.api.bonuses.balances.values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

/** Журнал: общий или одного сотрудника (`employeeId` — в параметрах запроса). */
export const fetchBonusLog: FetchListPage<BonusLogRow> = async (params) => {
  const res = await api.api.bonuses.log.$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return BonusLogList.parse(await res.json());
};

export const fetchBonusLogValues = async (
  extra: { employeeId?: string },
  col: string,
  q?: string,
) => {
  const res = await api.api.bonuses.log.values.$get({
    query: q ? { col, q, ...extra } : { col, ...extra },
  });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

/** «Списать бонус». */
export function writeOffBonus(employeeId: string, json: BonusOutRequest) {
  return callApi(() =>
    api.api.bonuses.employees[':id'].writeoffs.$post({ param: { id: employeeId }, json }),
  );
}

/** «Отменить списание». */
export function undoBonusWriteoff(id: string, version: number) {
  return callApi(() =>
    api.api['bonus-writeoffs'][':id'].undo.$post({ param: { id }, json: { version } }),
  );
}
