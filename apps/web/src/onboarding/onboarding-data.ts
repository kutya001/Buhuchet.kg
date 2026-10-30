'use client';

import { Onboarding } from '@buhuchet/shared';
import { queryOptions } from '@tanstack/react-query';
import { api, apiFailure } from '../api-client';

/**
 * Данные первого запуска организации (задача 2.33, docs/decisions.md п. Г-4): что открыть после входа,
 * тексты экранов и вопросы опросника. «Применить» — `callApi` в окне приветствия (ответ 409 — «Запись
 * изменена другим пользователем»).
 */

/** Приветствие вошедшего: что открыть после входа, состояние опросника, тексты. */
export const onboardingQuery = queryOptions({
  queryKey: ['onboarding'],
  queryFn: async () => {
    const res = await api.api.onboarding.$get();
    if (!res.ok) throw await apiFailure(res);
    return Onboarding.parse(await res.json());
  },
});

/** Приветствие открылось: само оно больше не откроется (у владельца — пока опросник не пройден). */
export async function markWelcomeSeen(): Promise<void> {
  await api.api.onboarding.seen.$post();
}

/** «Позже» или «Закрыть» до опросника: действует основной набор, опросник — в учётной политике. */
export async function postponeOnboarding(): Promise<void> {
  await api.api.onboarding.later.$post();
}
