import { foreignKeyViolation, subscriptionTerms, type Tx } from '@buhuchet/db';
import {
  SUBSCRIPTION_EDIT_MESSAGES,
  SUBSCRIPTION_NEW_ORG_FREE_REASON,
  SUBSCRIPTION_NEW_ORG_REASON,
  subscriptionEditDiscount,
  subscriptionEditProblems,
  type IsoDate,
  type SubscriptionEditProblem,
} from '@buhuchet/domain';
import type { NewOrgSubscriptionRequest } from '@buhuchet/shared';
import { apiFail } from '../../errors';

/*
 * Подписка от администратора платформы (доработки 20.11.2026, блок 6; прототип admin/subs-admin.js):
 * блок «Подписка» окна «Новая организация», дальше — вкладка «Подписки» Админки.
 */

/** Отказ по полю подписки: 400 с кодом словаря (`err.<код>`), полем и подстановками текста. */
export function subscriptionEditFail(problem: SubscriptionEditProblem): never {
  const params = problem.params ?? {};
  const message = SUBSCRIPTION_EDIT_MESSAGES[problem.code].replace(/\{(\w+)\}/g, (all, key) =>
    key in params ? String(params[key]) : all,
  );
  return apiFail(400, problem.code, message, { field: problem.field, ...params });
}

/** Внешний ключ на вид подписки: вид выключили или удалили, пока администратор заполнял окно. */
const PLAN_FK = 'org_subscriptions_plan_id_subscription_plans_id_fk';
export const isSubscriptionPlanGone = (err: unknown) => foreignKeyViolation(err) === PLAN_FK;

/**
 * Блок «Подписка» новой организации — для `createOrganization`: проверки `subEditRead` прототипа,
 * дополнительная скидка — только при пакете больше порога (иначе 0, `subEditBind`), причина — как в
 * `subNewOrgSave`. Блока нет — `null`: у организации «Нет подписки» (прототип `subNewOrgHtml`).
 */
export async function newOrgSubscription(tx: Tx, body: NewOrgSubscriptionRequest | undefined) {
  if (!body) return null;
  const { prices, plans } = await subscriptionTerms(tx);
  const [problem] = subscriptionEditProblems(body, prices, plans);
  if (problem) subscriptionEditFail(problem);
  return {
    planId: body.planId,
    seats: body.seats,
    extraGb: body.extraGb,
    paidUntil: body.paidUntil as IsoDate,
    extraDiscountPct: subscriptionEditDiscount(body, prices),
    free: body.free,
    reason: body.free ? SUBSCRIPTION_NEW_ORG_FREE_REASON : SUBSCRIPTION_NEW_ORG_REASON,
  };
}
