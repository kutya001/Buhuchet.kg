'use client';

import {
  BonusRow,
  ClosedMonths,
  FeePaymentEditForm,
  FeePaymentWindow,
  FinJournalRow,
  FinSummary,
  ListValues,
  OperationEditForm,
  ReceiptEditForm,
  ReceiptJournalRow,
  listPageSchema,
  type FeePaymentEditRequest,
  type OperationEditRequest,
  type ReceiptEditRequest,
} from '@buhuchet/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, apiFailure, callApi } from '../api-client';
import type { FetchListPage } from '../lists/use-list-page';

/**
 * Данные модуля «Финансовые операции» (задача 2.22): журнал вкладки, «Журнал поступлений», плашки,
 * окна «Изменить», окно оплаты за обслуживание, «Списания в бонус» и закрытые месяцы. Ключи запросов —
 * под `['finance']`: после записи их перечитывает `useFinanceRefresh`.
 */

export type FinJournalTab = 'all' | 'tax' | 'fee' | 'wo';

const JournalList = listPageSchema(FinJournalRow);
const ReceiptList = listPageSchema(ReceiptJournalRow);
const BonusList = listPageSchema(BonusRow);

/** Свои параметры списка (`extra` у `useListPage`): вкладка и «Показать удалённые». */
export const journalExtra = (tab: FinJournalTab, deleted: boolean) => ({
  tab,
  deleted: deleted ? '1' : '0',
});
export const receiptExtra = (deleted: boolean) => ({ deleted: deleted ? '1' : '0' });

/** Страница журнала вкладки; вкладка и «Показать удалённые» — в `params` из `journalExtra`. */
export const fetchJournal: FetchListPage<FinJournalRow> = async (params) => {
  const res = await api.api.fin.journal.$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return JournalList.parse(await res.json());
};

export const fetchJournalValues =
  (extra: Readonly<Record<string, string>>) => async (col: string, q?: string) => {
    const res = await api.api.fin.journal.values.$get({
      query: { col, ...extra, ...(q ? { q } : {}) },
    });
    if (!res.ok) throw await apiFailure(res);
    return ListValues.parse(await res.json());
  };

export const fetchReceipts: FetchListPage<ReceiptJournalRow> = async (params) => {
  const res = await api.api.fin.receipts.$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return ReceiptList.parse(await res.json());
};

export const fetchReceiptValues =
  (extra: Readonly<Record<string, string>>) => async (col: string, q?: string) => {
    const res = await api.api.fin.receipts.values.$get({
      query: { col, ...extra, ...(q ? { q } : {}) },
    });
    if (!res.ok) throw await apiFailure(res);
    return ListValues.parse(await res.json());
  };

export const fetchBonuses: FetchListPage<BonusRow> = async (params) => {
  const res = await api.api.fin.bonuses.$get({ query: params });
  if (!res.ok) throw await apiFailure(res);
  return BonusList.parse(await res.json());
};

export const fetchBonusValues = async (col: string, q?: string) => {
  const res = await api.api.fin.bonuses.values.$get({ query: q ? { col, q } : { col } });
  if (!res.ok) throw await apiFailure(res);
  return ListValues.parse(await res.json());
};

/** Плашки модуля за текущий месяц. */
export const finSummaryQuery = queryOptions({
  queryKey: ['finance', 'summary'],
  queryFn: async () => {
    const res = await api.api.fin.summary.$get();
    if (!res.ok) throw await apiFailure(res);
    return FinSummary.parse(await res.json());
  },
});

/** Закрытые месяцы и «Закрыть <месяц>». */
export const closedMonthsQuery = queryOptions({
  queryKey: ['finance', 'months'],
  queryFn: async () => {
    const res = await api.api.fin.months.$get();
    if (!res.ok) throw await apiFailure(res);
    return ClosedMonths.parse(await res.json());
  },
});

/** Окно «Изменить: …» операции. */
export const operationEditFormQuery = (id: string) =>
  queryOptions({
    queryKey: ['finance', 'edit-form', id],
    queryFn: async () => {
      const res = await api.api['money-operations'][':id']['edit-form'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return OperationEditForm.parse(await res.json());
    },
    staleTime: 0,
    gcTime: 0,
  });

/** Окно «Изменить поступление». */
export const receiptEditFormQuery = (id: string) =>
  queryOptions({
    queryKey: ['finance', 'receipt-form', id],
    queryFn: async () => {
      const res = await api.api['money-operations'][':id']['receipt-form'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return ReceiptEditForm.parse(await res.json());
    },
    staleTime: 0,
    gcTime: 0,
  });

/** Окно оплаты за обслуживание. */
export const feePaymentQuery = (id: string) =>
  queryOptions({
    queryKey: ['finance', 'fee-payment', id],
    queryFn: async () => {
      const res = await api.api['fee-payments'][':id'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return FeePaymentWindow.parse(await res.json());
    },
  });

/** Окно «Изменить оплату за обслуживание». */
export const feePaymentEditFormQuery = (id: string) =>
  queryOptions({
    queryKey: ['finance', 'fee-edit-form', id],
    queryFn: async () => {
      const res = await api.api['fee-payments'][':id']['edit-form'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return FeePaymentEditForm.parse(await res.json());
    },
    staleTime: 0,
    gcTime: 0,
  });

/** «Сохранить» в окне «Изменить: …». */
export function editOperation(id: string, json: OperationEditRequest) {
  return callApi(() => api.api['money-operations'][':id'].$put({ param: { id }, json }));
}

/** «Сохранить» в окне «Изменить поступление». */
export function editReceipt(id: string, json: ReceiptEditRequest) {
  return callApi(() => api.api['money-operations'][':id'].receipt.$put({ param: { id }, json }));
}

/** «Сохранить» в окне «Изменить оплату за обслуживание». */
export function editFeePayment(id: string, json: FeePaymentEditRequest) {
  return callApi(() => api.api['fee-payments'][':id'].$put({ param: { id }, json }));
}

/** «Удалить» оплату за обслуживание — с причиной. */
export function deleteFeePayment(id: string, reason: string) {
  return callApi(() =>
    api.api['fee-payments'][':id'].delete.$post({ param: { id }, json: { reason } }),
  );
}

/** «Закрыть месяц». */
export function closeMonth(month: string) {
  return callApi(() => api.api.fin.months.close.$post({ json: { month } }));
}
