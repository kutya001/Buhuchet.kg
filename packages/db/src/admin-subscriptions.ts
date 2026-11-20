import type { SubscriptionEditPlan } from '@buhuchet/domain';
import { asc, eq } from 'drizzle-orm';
import type { Tx } from './client';
import { subscriptionPlans, subscriptionSettings } from './schema';

/*
 * Админка → «Подписки» (доработки 20.11.2026, блок 6; прототип admin/subs-admin.js). Подписку
 * организации ставит и меняет только администратор платформы: политики `org_subscriptions` и функции
 * базы; здесь — чтение для его окон и проверок.
 */

/** Что нужно проверке подписки от администратора (`subscriptionEditProblems`): шаг, порог, виды. */
export interface SubscriptionTerms {
  prices: { seatStep: number; extraDiscountOver: number };
  plans: SubscriptionEditPlan[];
}

/**
 * Шаг пакета и порог дополнительной скидки из «Цен и реквизитов» (строки нет — как в прототипе:
 * 10 и 150) и все виды подписки по порядку. Только `tx` открытой транзакции.
 */
export async function subscriptionTerms(tx: Tx): Promise<SubscriptionTerms> {
  const [settings] = await tx
    .select({
      seatStep: subscriptionSettings.seatStep,
      extraDiscountOver: subscriptionSettings.extraDiscountOver,
    })
    .from(subscriptionSettings)
    .where(eq(subscriptionSettings.id, 1));
  const plans = await tx
    .select({
      id: subscriptionPlans.id,
      discountPct: subscriptionPlans.discountPct,
      active: subscriptionPlans.active,
    })
    .from(subscriptionPlans)
    .orderBy(asc(subscriptionPlans.sortOrder), asc(subscriptionPlans.id));
  return { prices: settings ?? { seatStep: 10, extraDiscountOver: 150 }, plans };
}
