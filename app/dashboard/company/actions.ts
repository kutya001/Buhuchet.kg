'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { ActionResponse, Company } from '@/types/database.types';
import { revalidatePath } from 'next/cache';

/**
 * Обновление даты закрытия месяца/периода организации
 */
export async function updateClosedPeriodAction(
  closedPeriodUntil: string | null
): Promise<ActionResponse<Company>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const { data: prof } = await supabase
      .from('users')
      .select('company_id, role, is_super_admin')
      .eq('id', user.id)
      .single();

    if (!prof?.company_id && !prof?.is_super_admin) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    // Проверка прав: Только Руководитель (owner) или Суперадмин может закрывать период
    if (prof.role !== 'owner' && !prof.is_super_admin) {
      return { success: false, error: 'Право закрытия периода доступно только Руководителю компании' };
    }

    const adminSupabase = await createAdminClient();
    const { data: updatedCompany, error } = await adminSupabase
      .from('companies')
      .update({
        closed_period_until: closedPeriodUntil ? closedPeriodUntil : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', prof.company_id)
      .select('*')
      .single();

    if (error || !updatedCompany) {
      return { success: false, error: ` Ошибка сохранения закрытия периода: ${error?.message}` };
    }

    revalidatePath('/dashboard/company');
    revalidatePath('/dashboard/documents');
    return { success: true, data: updatedCompany as Company };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Сбой при фиксации даты закрытия периода';
    return { success: false, error: msg };
  }
}
