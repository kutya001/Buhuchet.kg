'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { toggleCompanyActiveSchema, updateCompanySubscriptionSchema } from '@/types/admin.types';
import type { ActionResponse } from '@/types/database.types';
import { revalidatePath } from 'next/cache';

async function verifySuperAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return false;

  const { data: profile } = await supabase
    .from('users')
    .select('is_super_admin')
    .eq('id', user.id)
    .single();

  return !!profile?.is_super_admin;
}

export async function toggleCompanyStatusAction(
  companyId: string,
  isActive: boolean
): Promise<ActionResponse> {
  try {
    const isSuper = await verifySuperAdmin();
    if (!isSuper) {
      return { success: false, error: 'Доступ запрещен. Требуются права Суперадминистратора.' };
    }

    const validation = toggleCompanyActiveSchema.safeParse({ companyId, isActive });
    if (!validation.success) {
      return { success: false, error: 'Некорректные параметры запроса' };
    }

    const adminSupabase = createAdminClient();

    const { error } = await adminSupabase
      .from('companies')
      .update({
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', companyId);

    if (error) {
      return { success: false, error: `Ошибка изменения статуса компании: ${error.message}` };
    }

    revalidatePath('/super-admin');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Непредвиденная ошибка администратора';
    return { success: false, error: errorMsg };
  }
}

export async function updateCompanySubscriptionAction(
  formData: FormData
): Promise<ActionResponse> {
  try {
    const isSuper = await verifySuperAdmin();
    if (!isSuper) {
      return { success: false, error: 'Доступ запрещен. Требуются права Суперадминистратора.' };
    }

    const companyId = formData.get('companyId')?.toString() || '';
    const planType = formData.get('planType')?.toString() || 'basic';
    const daysToAdd = parseInt(formData.get('daysToAdd')?.toString() || '0', 10);
    const storageLimitGb = parseInt(formData.get('storageLimitGb')?.toString() || '10', 10);

    const validation = updateCompanySubscriptionSchema.safeParse({
      companyId,
      planType,
      daysToAdd,
      storageLimitGb,
    });

    if (!validation.success) {
      const errStr = validation.error.issues.map((i) => i.message).join(', ');
      return { success: false, error: errStr };
    }

    const adminSupabase = createAdminClient();

    // 1. Обновляем лимит памяти в таблице companies
    const { error: companyError } = await adminSupabase
      .from('companies')
      .update({
        storage_limit_gb: storageLimitGb,
        updated_at: new Date().toISOString(),
      })
      .eq('id', companyId);

    if (companyError) {
      return { success: false, error: `Ошибка обновления компании: ${companyError.message}` };
    }

    // 2. Получаем текущую подписку компании
    const { data: sub } = await adminSupabase
      .from('subscriptions')
      .select('expires_at')
      .eq('company_id', companyId)
      .single();

    let newExpiresAt = new Date();
    if (sub?.expires_at && new Date(sub.expires_at) > new Date()) {
      newExpiresAt = new Date(sub.expires_at);
    }
    if (daysToAdd > 0) {
      newExpiresAt.setDate(newExpiresAt.getDate() + daysToAdd);
    }

    // 3. Обновляем или создаем подписку
    const { error: subError } = await adminSupabase.from('subscriptions').upsert(
      {
        company_id: companyId,
        plan_type: planType,
        status: 'active',
        expires_at: newExpiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id' }
    );

    if (subError) {
      return { success: false, error: `Ошибка обновления подписки: ${subError.message}` };
    }

    revalidatePath('/super-admin');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Непредвиденная ошибка администратора';
    return { success: false, error: errorMsg };
  }
}
