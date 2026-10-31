'use client';

import {
  ContractorFees,
  FeePaymentForm,
  FeeReminder,
  type FeePaymentRequest,
  type TariffRequest,
} from '@buhuchet/shared';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { useMoneyRefresh } from '../money/tax-data';

/**
 * Данные платы за обслуживание (задача 2.21): вкладка «Обслуживание» карточки контрагента, окна «Новая
 * ставка», «Принять оплату за обслуживание» и «Напомнить в WhatsApp». После ставки, оплаты и
 * напоминания перечитываются вкладка, карточка (история, «Долг за обслуживание»), список контрагентов
 * (плашка «Должники», столбец долга), деньги и файлы.
 */

/** Вкладка «Обслуживание». */
export const contractorFeesQuery = (id: string) =>
  queryOptions({
    queryKey: ['fees', 'contractor', id],
    queryFn: async () => {
      const res = await api.api.contractors[':id'].fees.$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return ContractorFees.parse(await res.json());
    },
  });

/** Окно «Принять оплату за обслуживание»: неоплаченные месяцы и распределение по умолчанию. */
export const feePaymentFormQuery = (id: string) =>
  queryOptions({
    queryKey: ['fees', 'payment-form', id],
    queryFn: async () => {
      const res = await api.api.contractors[':id']['fee-payment-form'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return FeePaymentForm.parse(await res.json());
    },
    staleTime: 0,
  });

/** Окно «Напомнить в WhatsApp» о долге за обслуживание. */
export const feeReminderQuery = (id: string) =>
  queryOptions({
    queryKey: ['fees', 'reminder', id],
    queryFn: async () => {
      const res = await api.api.contractors[':id']['fee-reminder'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return FeeReminder.parse(await res.json());
    },
    staleTime: 0,
  });

/** Перечитать всё, что меняет плата за обслуживание. */
export function useFeesRefresh() {
  const client = useQueryClient();
  const money = useMoneyRefresh();
  return useCallback(() => {
    money();
    void client.invalidateQueries({ queryKey: ['fees'] });
  }, [client, money]);
}

/** «Добавить в журнал»: новая ставка обслуживания. */
export function addTariff(id: string, json: TariffRequest) {
  return callApi(() => api.api.contractors[':id'].tariffs.$post({ param: { id }, json }));
}

/** «Принять оплату»: файлы окно загружает к оплате после ответа. */
export function createFeePayment(id: string, json: FeePaymentRequest) {
  return callApi(() => api.api.contractors[':id']['fee-payments'].$post({ param: { id }, json }));
}

/** «Открыть WhatsApp»: нажатие пишется в историю контрагента. */
export function logFeeReminder(id: string) {
  return callApi(() => api.api.contractors[':id']['fee-reminder'].$post({ param: { id } }));
}
