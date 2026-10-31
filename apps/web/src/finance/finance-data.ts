'use client';

import {
  EmployeeAccount,
  OperationWindow,
  TaxReminder,
  TransferForm,
  type CorrectionRequest,
  type TransferRequest,
  type WriteOffRequest,
} from '@buhuchet/shared';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { useMoneyRefresh } from '../money/tax-data';

/**
 * Данные остатка контрагента и окна операции (задача 2.20): «Списать в бонус», «Вернуть остаток»,
 * «Перевод», окно операции с удалением и обратной записью, вкладка «Счёт» сотрудника, «Напомнить в
 * WhatsApp» о налоге. После записи перечитываются деньги контрагента, отчёты, карточка, окна операций и
 * счета сотрудников.
 */

/** Окно «Перевод на счёт сотрудника»: сколько можно и кому. */
export const transferFormQuery = (id: string) =>
  queryOptions({
    queryKey: ['finance', 'transfer-form', id],
    queryFn: async () => {
      const res = await api.api.contractors[':id']['transfer-form'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return TransferForm.parse(await res.json());
    },
    staleTime: 0,
  });

/** Окно финансовой операции. */
export const operationQuery = (id: string) =>
  queryOptions({
    queryKey: ['finance', 'operation', id],
    queryFn: async () => {
      const res = await api.api['money-operations'][':id'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return OperationWindow.parse(await res.json());
    },
  });

/** Вкладка «Счёт» карточки сотрудника. */
export const employeeAccountQuery = (id: string) =>
  queryOptions({
    queryKey: ['finance', 'account', id],
    queryFn: async () => {
      const res = await api.api.staff[':id'].account.$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return EmployeeAccount.parse(await res.json());
    },
  });

/** Окно «Напомнить в WhatsApp» о налоге по отчёту. */
export const taxReminderQuery = (id: string) =>
  queryOptions({
    queryKey: ['finance', 'tax-reminder', id],
    queryFn: async () => {
      const res = await api.api.reports[':id']['tax-reminder'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return TaxReminder.parse(await res.json());
    },
    staleTime: 0,
  });

/** Перечитать всё, что меняют операции с остатком. */
export function useFinanceRefresh() {
  const client = useQueryClient();
  const money = useMoneyRefresh();
  return useCallback(() => {
    money();
    void client.invalidateQueries({ queryKey: ['finance'] });
    void client.invalidateQueries({ queryKey: ['fees'] });
  }, [client, money]);
}

/** «Списать» и «Записать возврат». */
export function writeOff(id: string, json: WriteOffRequest) {
  return callApi(() => api.api.contractors[':id']['write-offs'].$post({ param: { id }, json }));
}

/** «Перевести». */
export function transfer(id: string, json: TransferRequest) {
  return callApi(() => api.api.contractors[':id'].transfers.$post({ param: { id }, json }));
}

/** «Удалить», «Отменить списание», «Отменить возврат» — с причиной. */
export function deleteOperation(id: string, reason: string) {
  return callApi(() =>
    api.api['money-operations'][':id'].delete.$post({ param: { id }, json: { reason } }),
  );
}

/** «Записать» обратную запись к поступлению. */
export function correctReceipt(id: string, json: CorrectionRequest) {
  return callApi(() =>
    api.api['money-operations'][':id'].corrections.$post({ param: { id }, json }),
  );
}

/** «Открыть WhatsApp»: нажатие пишется в историю отчёта. */
export function logTaxReminder(id: string) {
  return callApi(() => api.api.reports[':id']['tax-reminder'].$post({ param: { id } }));
}
