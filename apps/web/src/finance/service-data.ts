'use client';

import {
  ServiceCard,
  ServiceForm,
  ServicePaymentWindow,
  type ServiceEditRequest,
  type ServicePaymentEditRequest,
  type ServicePaymentRequest,
  type ServiceRequest,
} from '@buhuchet/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, apiFailure, callApi } from '../api-client';

/**
 * Данные разовых услуг (задача 2.22; прототип modules/services.js): окно «Разовая услуга», карточка
 * услуги, окно оплаты и записи. Ключи — под `['finance']`: после записи их перечитывает
 * `useFinanceRefresh` вместе с журналом и плашками.
 */

/** Окно «Разовая услуга»: контрагенты области, исполнители, кто по умолчанию. */
export const serviceFormQuery = (contractorId: string | null) =>
  queryOptions({
    queryKey: ['finance', 'service-form', contractorId],
    queryFn: async () => {
      const res = await api.api['one-off-services'].form.$get({
        query: contractorId ? { contractorId } : {},
      });
      if (!res.ok) throw await apiFailure(res);
      return ServiceForm.parse(await res.json());
    },
    staleTime: 0,
  });

/** Карточка разовой услуги. */
export const serviceCardQuery = (id: string) =>
  queryOptions({
    queryKey: ['finance', 'service', id],
    queryFn: async () => {
      const res = await api.api['one-off-services'][':id'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return ServiceCard.parse(await res.json());
    },
  });

/** Окно оплаты разовой услуги. */
export const servicePaymentQuery = (id: string) =>
  queryOptions({
    queryKey: ['finance', 'service-payment', id],
    queryFn: async () => {
      const res = await api.api['one-off-service-payments'][':id'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return ServicePaymentWindow.parse(await res.json());
    },
  });

/** «Добавить услугу». */
export function createService(json: ServiceRequest) {
  return callApi(() => api.api['one-off-services'].$post({ json }));
}

/** «Сохранить» в окне «Изменить разовую услугу». */
export function editService(id: string, json: ServiceEditRequest) {
  return callApi(() => api.api['one-off-services'][':id'].$put({ param: { id }, json }));
}

/** «Удалить» услугу — с причиной. */
export function deleteService(id: string, reason: string) {
  return callApi(() =>
    api.api['one-off-services'][':id'].delete.$post({ param: { id }, json: { reason } }),
  );
}

/** «Записать оплату». */
export function payService(id: string, json: ServicePaymentRequest) {
  return callApi(() => api.api['one-off-services'][':id'].payments.$post({ param: { id }, json }));
}

/** «Сохранить» в окне «Изменить: оплата разовой услуги». */
export function editServicePayment(id: string, json: ServicePaymentEditRequest) {
  return callApi(() => api.api['one-off-service-payments'][':id'].$put({ param: { id }, json }));
}

/** «Удалить» оплату разовой услуги — с причиной. */
export function deleteServicePayment(id: string, reason: string) {
  return callApi(() =>
    api.api['one-off-service-payments'][':id'].delete.$post({ param: { id }, json: { reason } }),
  );
}
