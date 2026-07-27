'use server';

import { createClient } from '@/lib/supabase/server';
import { mockPaymentSchema, PLAN_PRICES } from '@/types/subscription.types';
import type { ActionResponse, SubscriptionPlan } from '@/types/database.types';
import { revalidatePath } from 'next/cache';

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

    // Получаем профиль пользователя и его компанию
    const { data: profile } = await supabase
      .from('users')
      .select('company_id, role, is_super_admin')
      .eq('id', user.id)
      .single();

    if (!profile?.company_id) {
      return { success: false, error: 'У вас нет привязанной компании' };
    }

    if (profile.role !== 'owner' && !profile.is_super_admin) {
      return { success: false, error: 'Только Владелец (Owner) может уплачивать подписку' };
    }

    const rawPlan = formData.get('planType')?.toString() || 'basic';
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

    // Расчет цены со скидкой
    const baseMonthlyPrice = PLAN_PRICES[planType as SubscriptionPlan].pricePerMonth;
    let discountPercent = 0;
    if (periodMonths === 3) discountPercent = 10;
    if (periodMonths === 6) discountPercent = 15;
    if (periodMonths === 12) discountPercent = 20;

    const totalPriceWithoutDiscount = baseMonthlyPrice * periodMonths;
    const finalAmount = Math.round(totalPriceWithoutDiscount * (1 - discountPercent / 100));

    // 1. Фиксируем запись об имитационной оплате
    const { data: payment, error: paymentError } = await supabase
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

    // 2. Рассчитываем новую дату окончания подписки
    const { data: currentSub } = await supabase
      .from('subscriptions')
      .select('expires_at')
      .eq('company_id', profile.company_id)
      .single();

    let startDate = new Date();
    if (currentSub?.expires_at && new Date(currentSub.expires_at) > new Date()) {
      startDate = new Date(currentSub.expires_at);
    }
    const newExpiresAt = new Date(startDate);
    newExpiresAt.setMonth(newExpiresAt.getMonth() + periodMonths);

    // 3. Обновляем статус подписки компании
    const { error: subError } = await supabase
      .from('subscriptions')
      .upsert({
        company_id: profile.company_id,
        plan_type: planType,
        status: 'active',
        expires_at: newExpiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (subError) {
      return { success: false, error: `Ошибка обновления статуса подписки: ${subError.message}` };
    }

    // 4. Обновляем лимит памяти компании в зависимости от выбранного тарифа
    const targetStorageGb = PLAN_PRICES[planType as SubscriptionPlan].storageGb;
    await supabase
      .from('companies')
      .update({ storage_limit_gb: targetStorageGb })
      .eq('id', profile.company_id);

    revalidatePath('/dashboard/subscription');
    revalidatePath('/dashboard');

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
