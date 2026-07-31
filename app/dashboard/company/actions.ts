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

/**
 * Обновление ОПФ, реквизитов и настроек приватности компании
 */
export async function updateCompanyPrivacyAndDetailsAction(params: {
  legalForm?: string;
  phone?: string;
  email?: string;
  address?: string;
  privacySettings?: { show_phone: boolean; show_email: boolean; show_address: boolean };
}): Promise<ActionResponse<Company>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { success: false, error: 'Пользователь не авторизован' };

    const { data: prof } = await supabase
      .from('users')
      .select('company_id, role, is_super_admin')
      .eq('id', user.id)
      .single();

    if (!prof?.company_id) return { success: false, error: 'Пользователь не привязан к компании' };

    const adminSupabase = await createAdminClient();
    const updatePayload: Record<string, any> = { updated_at: new Date().toISOString() };

    if (params.legalForm) updatePayload.legal_form = params.legalForm;
    if (params.phone !== undefined) updatePayload.phone = params.phone;
    if (params.email !== undefined) updatePayload.email = params.email;
    if (params.address !== undefined) updatePayload.address = params.address;
    if (params.privacySettings) updatePayload.privacy_settings = params.privacySettings;

    const { data: updated, error } = await adminSupabase
      .from('companies')
      .update(updatePayload)
      .eq('id', prof.company_id)
      .select('*')
      .single();

    if (error || !updated) return { success: false, error: error?.message || 'Ошибка обновления' };

    revalidatePath('/dashboard/company');
    return { success: true, data: updated as Company };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой обновления' };
  }
}
