'use client';

import { ContractorMoney, ReceiptForm } from '@buhuchet/shared';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { pickedFilesProblem, uploadFile } from '../files/files-data';
import type { ApiErrorLike, Translate } from '../l10n/translate';
import { useReportsRefresh } from '../reports/reports-data';

/**
 * Данные денег по отчётам (задача 2.19): вкладка «Деньги» контрагента и окно «Поступление от
 * контрагента». После поступления, оплаты и её отмены перечитываются отчёты, деньги контрагента, его
 * карточка (история, «Баланс по контрагенту») и файлы.
 */

/** Вкладка «Деньги»: сверка за месяц `YYYY-MM` (по умолчанию — текущий). */
export const contractorMoneyQuery = (id: string, month: string | null) =>
  queryOptions({
    queryKey: ['money', 'contractor', id, month ?? 'current'],
    queryFn: async () => {
      const res = await api.api.contractors[':id'].money.$get({
        param: { id },
        query: month ? { month } : {},
      });
      if (!res.ok) throw await apiFailure(res);
      return ContractorMoney.parse(await res.json());
    },
  });

/** Неоплаченные отчёты контрагента для детализации поступления. */
export const receiptFormQuery = (id: string) =>
  queryOptions({
    queryKey: ['money', 'receipt-form', id],
    queryFn: async () => {
      const res = await api.api.contractors[':id']['receipt-form'].$get({ param: { id } });
      if (!res.ok) throw await apiFailure(res);
      return ReceiptForm.parse(await res.json());
    },
    staleTime: 0,
  });

/** Перечитать всё, что меняют деньги по отчётам. */
export function useMoneyRefresh() {
  const client = useQueryClient();
  const reports = useReportsRefresh();
  return useCallback(() => {
    reports();
    void client.invalidateQueries({ queryKey: ['money', 'contractor'] });
    void client.invalidateQueries({ queryKey: ['contractors'] });
    void client.invalidateQueries({ queryKey: ['files'] });
    void client.invalidateQueries({ queryKey: ['list', 'cps'] });
  }, [client, reports]);
}

/**
 * Загрузить файлы к записанной операции (источник «Поступление», «Оплата налога» или «Оплата за
 * обслуживание»). Операция уже сохранена — ошибка загрузки возвращается текстом, а не отменяет запись.
 */
export async function uploadMoneyFiles(
  t: Translate,
  errorText: (e: ApiErrorLike) => string,
  source: { kind: 'receipt' | 'tax_payment' | 'fee_payment'; id: string },
  picked: readonly File[],
): Promise<string | null> {
  for (const file of picked) {
    const res = await uploadFile(source, file);
    if (!res.ok)
      return t('money.files_saved_partly', { name: file.name, error: errorText(res.error) });
  }
  return null;
}

/** Файлы, выбранные в окне: слишком большие — текст ошибки поля, иначе null. */
export function pickedMoneyFilesProblem(
  t: Translate,
  errorText: (e: ApiErrorLike) => string,
  picked: readonly File[],
): string | null {
  const problem = pickedFilesProblem(picked);
  if (!problem) return null;
  return 'names' in problem
    ? t('files.too_large', { names: problem.names })
    : t('files.upload_failed', {
        name: problem.name,
        error: errorText({ code: problem.code, message: '' }),
      });
}

/**
 * «Файл при поступлении», «Деньги на налоги переводит» и «Платит одной суммой» на «Основном» карточки
 * контрагента.
 */
export function saveMoneySettings(
  id: string,
  body: { version: number; needReceiptFile?: boolean; paysTo?: 'emp' | 'org'; oneSum?: boolean },
) {
  return callApi(() =>
    api.api.contractors[':id']['money-settings'].$patch({ param: { id }, json: body }),
  );
}
