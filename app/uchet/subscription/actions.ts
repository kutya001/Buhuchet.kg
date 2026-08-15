'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { mockPaymentSchema, PLAN_PRICES } from '@/types/subscription.types';
import type {
  ActionResponse,
  SubscriptionPlan,
  LandingPricingPlan,
  SubscriptionRenewalRequest,
} from '@/types/database.types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSafeAction } from '@/lib/auth/safe-action';
import { getCompanyEffectiveLimits, CompanyEffectiveLimits } from '@/lib/auth/subscription-lock';

export interface CompanySubscriptionDetails {
  limits: CompanyEffectiveLimits;
  plans: LandingPricingPlan[];
  renewalRequests: SubscriptionRenewalRequest[];
}

/**
 * Получение подробной информации о подписке, квотах, планах и истории заявок
 */
export async function getCompanySubscriptionDetailsAction(): Promise<ActionResponse<CompanySubscriptionDetails>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const adminSupabase = await createAdminClient();
    const { data: profile } = await adminSupabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single();

    if (!profile?.company_id) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    const [limits, plansRes, requestsRes] = await Promise.all([
      getCompanyEffectiveLimits(profile.company_id),
      adminSupabase
        .from('landing_pricing_plans')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      adminSupabase
        .from('subscription_renewal_requests')
        .select('*, requested_by_user:users!requested_by_user_id(full_name, email), target_plan:landing_pricing_plans!target_plan_id(*)')
        .eq('company_id', profile.company_id)
        .order('created_at', { ascending: false }),
    ]);

    return {
      success: true,
      data: {
        limits,
        plans: (plansRes.data || []) as LandingPricingPlan[],
        renewalRequests: (requestsRes.data || []) as SubscriptionRenewalRequest[],
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой получения данных подписки';
    return { success: false, error: errorMsg };
  }
}

/**
 * Создание заявки на продление или смену тарифного плана
 */
export const createRenewalRequestAction = createSafeAction(
  z.object({
    target_plan_id: z.string().min(1, 'Выберите тарифный план'),
    billing_period_months: z.number().int().min(1).max(12),
    comment: z.string().max(1000, 'Комментарий не должен превышать 1000 символов').optional(),
  }),
  async ({ target_plan_id, billing_period_months, comment }, ctx) => {
    if (!ctx.companyId) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    const adminSupabase = await createAdminClient();

    // Проверяем существование тарифа
    const { data: plan } = await adminSupabase
      .from('landing_pricing_plans')
      .select('id, name')
      .eq('id', target_plan_id)
      .maybeSingle();

    if (!plan) {
      return { success: false, error: 'Выбранный тарифный план не найден' };
    }

    // Создаем заявку
    const { data: request, error: insertError } = await adminSupabase
      .from('subscription_renewal_requests')
      .insert({
        company_id: ctx.companyId,
        requested_by_user_id: ctx.userId,
        target_plan_id,
        billing_period_months,
        comment: comment?.trim() || null,
        status: 'pending',
      })
      .select()
      .single();

    if (insertError) {
      return { success: false, error: `Ошибка создания заявки: ${insertError.message}` };
    }

    revalidatePath('/uchet/subscription');
    revalidatePath('/uchet/company');
    revalidatePath('/admin/subscriptions');

    return { success: true, data: request };
  }
);

/**
 * Имитационная оплата подписки через QR (для быстрого тестирования)
 */
export async function processMockPaymentAction(
  formData: FormData
): Promise<ActionResponse<{ paymentId: string; newExpiresAt: string }>> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const { data: profile } = await supabase
      .from('users')
      .select('company_id, role, is_super_admin')
      .eq('id', user.id)
      .single();

    if (!profile?.company_id) {
      return { success: false, error: 'У вас нет привязанной компании' };
    }

    if (profile.role !== 'owner' && !profile.is_super_admin) {
      return { success: false, error: 'Только Владелец может оплачивать подписку' };
    }

    const rawPlan = formData.get('planType')?.toString() || 'start';
    const rawPeriod = formData.get('periodMonths')?.toString() || '1';
    const rawMethod = formData.get('paymentMethod')?.toString() || 'qr_mbank';

    const validation = mockPaymentSchema.safeParse({
      planType: rawPlan,
      periodMonths: rawPeriod,
      paymentMethod: rawMethod,
    });

    if (!validation.success) {
      const errStr = validation.error.issues.map((i) => i.message).join(', ');
      return { success: false, error: errStr };
    }

    const { planType, periodMonths, paymentMethod } = validation.data;
    const months = Number(periodMonths);

    const baseMonthlyPrice = 2490;
    const finalAmount = baseMonthlyPrice * months;

    const adminSupabase = await createAdminClient();

    const { data: payment, error: paymentError } = await adminSupabase
      .from('subscription_payments')
      .insert({
        company_id: profile.company_id,
        amount: finalAmount,
        payment_method: paymentMethod,
        status: 'completed',
        is_mock: true,
      })
      .select()
      .single();

    if (paymentError || !payment) {
      return { success: false, error: `Ошибка проведения платежа: ${paymentError?.message}` };
    }

    const { data: currentSub } = await adminSupabase
      .from('subscriptions')
      .select('expires_at')
      .eq('company_id', profile.company_id)
      .maybeSingle();

    let startDate = new Date();
    if (currentSub?.expires_at && new Date(currentSub.expires_at) > new Date()) {
      startDate = new Date(currentSub.expires_at);
    }
    const newExpiresAt = new Date(startDate);
    newExpiresAt.setMonth(newExpiresAt.getMonth() + months);

    const { error: subError } = await adminSupabase
      .from('subscriptions')
      .upsert({
        company_id: profile.company_id,
        plan_type: planType,
        status: 'active',
        expires_at: newExpiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (subError) {
      return { success: false, error: `Ошибка обновления подписки: ${subError.message}` };
    }

    revalidatePath('/uchet/subscription');
    revalidatePath('/uchet');

    return {
      success: true,
      data: {
        paymentId: payment.id,
        newExpiresAt: newExpiresAt.toISOString(),
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Ошибка при обработке платежа';
    return { success: false, error: errorMsg };
  }
}
