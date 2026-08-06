'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { ActionResponse, Company } from '@/types/database.types';
import type { CompanyProfileStats } from '@/types/company.types';
import { revalidatePath } from 'next/cache';

/**
 * Получение агрегированной статистики профиля компании
 */
export async function getCompanyProfileStatsAction(
  targetCompanyId?: string
): Promise<ActionResponse<CompanyProfileStats>> {
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
      .select('company_id, is_super_admin')
      .eq('id', user.id)
      .single();

    const companyId = targetCompanyId || prof?.company_id;

    if (!companyId) {
      return { success: false, error: 'Организация не указана' };
    }

    const adminSupabase = await createAdminClient();

    const [filesRes, docsRes, counterpartiesRes, employeesRes] = await Promise.all([
      adminSupabase.from('files').select('id, size_bytes').eq('company_id', companyId),
      adminSupabase.from('documents').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      adminSupabase
        .from('company_partnerships')
        .select('id', { count: 'exact', head: true })
        .or(`requester_company_id.eq.${companyId},target_company_id.eq.${companyId}`)
        .eq('status', 'accepted'),
      adminSupabase.from('users').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    ]);

    const filesData = filesRes.data || [];
    const storageUsedBytes = filesData.reduce((acc, f) => acc + (Number(f.size_bytes) || 0), 0);

    const stats: CompanyProfileStats = {
      totalFiles: filesData.length,
      totalDocuments: docsRes.count || 0,
      totalCounterparties: counterpartiesRes.count || 0,
      totalEmployees: employeesRes.count || 0,
      storageUsedBytes,
    };

    return { success: true, data: stats };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Ошибка подсчета статистики';
    return { success: false, error: msg };
  }
}

/**
 * Обновление реквизитов организации (Строгая валидация прав Владельца)
 */
export async function updateCompanyProfileAction(
  companyId: string,
  data: Partial<Company>
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

    if (!prof?.company_id || prof.company_id !== companyId) {
      if (!prof?.is_super_admin) {
        return { success: false, error: 'Вы не привязаны к этой организации' };
      }
    }

    // Жесткое ограничение: Изменять профиль может ТОЛЬКО Владелец компании (или суперадмин)
    if (prof.role !== 'owner' && !prof.is_super_admin) {
      return {
        success: false,
        error: 'Доступ запрещен: Изменять профиль организации может только её владелец.',
      };
    }

    const adminSupabase = await createAdminClient();

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.legal_form !== undefined) updatePayload.legal_form = data.legal_form;
    if (data.inn !== undefined) updatePayload.inn = data.inn;
    if (data.industry !== undefined) updatePayload.industry = data.industry;
    if (data.director_name !== undefined) updatePayload.director_name = data.director_name;
    if (data.phone !== undefined) updatePayload.phone = data.phone;
    if (data.email !== undefined) updatePayload.email = data.email;
    if (data.legal_address !== undefined) updatePayload.legal_address = data.legal_address;
    if (data.address !== undefined) updatePayload.address = data.address;
    if (data.privacy_settings !== undefined) updatePayload.privacy_settings = data.privacy_settings;

    const { data: updated, error } = await adminSupabase
      .from('companies')
      .update(updatePayload)
      .eq('id', companyId)
      .select('*')
      .single();

    if (error || !updated) {
      return { success: false, error: error?.message || 'Ошибка обновления профиля' };
    }

    revalidatePath('/dashboard/company');
    return { success: true, data: updated as Company };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой обновления' };
  }
}

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
      return { success: false, error: `Ошибка сохранения закрытия периода: ${error?.message}` };
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
