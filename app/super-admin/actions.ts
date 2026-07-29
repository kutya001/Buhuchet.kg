'use server';

import { createAdminClient } from '@/lib/supabase/server';
import type { ActionResponse, FileCategory, FeatureFlag, UserProfile, Company } from '@/types/database.types';
import { revalidatePath } from 'next/cache';

// Одобрить и Активировать компанию
export async function approveCompanyAction(companyId: string): Promise<ActionResponse> {
  try {
    const supabaseAdmin = await createAdminClient();

    const { error } = await supabaseAdmin
      .from('companies')
      .update({
        status: 'active',
        is_active: true,
        moderation_comment: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', companyId);

    if (error) {
      return { success: false, error: `Ошибка активации компании: ${error.message}` };
    }

    revalidatePath('/super-admin');
    revalidatePath('/dashboard');
    revalidatePath('/dashboard/pending');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при одобрении компании';
    return { success: false, error: errorMsg };
  }
}

// Отклонить / Вернуть на доработку с комментарием
export async function requestCompanyChangesAction(
  companyId: string,
  comment: string
): Promise<ActionResponse> {
  try {
    if (!comment || comment.trim().length < 3) {
      return { success: false, error: 'Укажите понятную причину возврата заявки на доработку' };
    }

    const supabaseAdmin = await createAdminClient();

    const { error } = await supabaseAdmin
      .from('companies')
      .update({
        status: 'requires_changes',
        moderation_comment: comment,
        updated_at: new Date().toISOString(),
      })
      .eq('id', companyId);

    if (error) {
      return { success: false, error: `Ошибка отправки замечаний: ${error.message}` };
    }

    revalidatePath('/super-admin');
    revalidatePath('/dashboard');
    revalidatePath('/dashboard/pending');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при отправке замечаний';
    return { success: false, error: errorMsg };
  }
}

// Заблокировать компанию
export async function blockCompanyAction(
  companyId: string,
  comment: string
): Promise<ActionResponse> {
  try {
    const supabaseAdmin = await createAdminClient();

    const { error } = await supabaseAdmin
      .from('companies')
      .update({
        status: 'blocked',
        is_active: false,
        moderation_comment: comment,
        updated_at: new Date().toISOString(),
      })
      .eq('id', companyId);

    if (error) {
      return { success: false, error: `Ошибка блокировки: ${error.message}` };
    }

    revalidatePath('/super-admin');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при блокировке компании';
    return { success: false, error: errorMsg };
  }
}

// Редактирование любых реквизитов организации суперадмином
export async function updateCompanyAdminAction(
  companyId: string,
  data: {
    name?: string;
    inn?: string;
    industry?: string;
    status?: 'pending_approval' | 'active' | 'requires_changes' | 'blocked';
    legal_address?: string;
    director_name?: string;
    email?: string;
    phone?: string;
    moderation_comment?: string | null;
  }
): Promise<ActionResponse<Company>> {
  try {
    const supabaseAdmin = await createAdminClient();

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (data.name) updatePayload.name = data.name;
    if (data.inn) updatePayload.inn = data.inn;
    if (data.industry) updatePayload.industry = data.industry;
    if (data.status) {
      updatePayload.status = data.status;
      updatePayload.is_active = data.status === 'active';
    }
    if (data.legal_address) {
      updatePayload.legal_address = data.legal_address;
      updatePayload.address = data.legal_address;
    }
    if (data.director_name) updatePayload.director_name = data.director_name;
    if (data.email) updatePayload.email = data.email;
    if (data.phone) updatePayload.phone = data.phone;
    if (data.moderation_comment !== undefined) updatePayload.moderation_comment = data.moderation_comment;

    const { data: updated, error } = await supabaseAdmin
      .from('companies')
      .update(updatePayload)
      .eq('id', companyId)
      .select()
      .single();

    if (error || !updated) {
      return { success: false, error: `Ошибка обновления компании: ${error?.message}` };
    }

    revalidatePath('/super-admin');
    revalidatePath('/dashboard');
    return { success: true, data: updated as Company };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при обновлении организации';
    return { success: false, error: errorMsg };
  }
}

// Получить компании на модерации
export async function getPendingCompaniesAction(): Promise<ActionResponse<Company[]>> {
  try {
    const supabaseAdmin = await createAdminClient();

    const { data, error } = await supabaseAdmin
      .from('companies')
      .select('*')
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: false });

    if (error) {
      return { success: false, error: `Ошибка загрузки модерации: ${error.message}` };
    }

    return { success: true, data: (data as Company[]) || [] };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой чтения модерации';
    return { success: false, error: errorMsg };
  }
}

// Получить все компании системы
export async function getAllCompaniesAdminAction(): Promise<ActionResponse<Company[]>> {
  try {
    const supabaseAdmin = await createAdminClient();

    const { data, error } = await supabaseAdmin
      .from('companies')
      .select('*')
      .order('name');

    if (error) {
      return { success: false, error: `Ошибка загрузки компаний: ${error.message}` };
    }

    return { success: true, data: (data as Company[]) || [] };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой чтения списка организаций';
    return { success: false, error: errorMsg };
  }
}

// ПОЛЬЗОВАТЕЛИ СИСТЕМЫ (Суперадминка)
export async function getAllUsersAdminAction(): Promise<ActionResponse<any[]>> {
  try {
    const supabaseAdmin = await createAdminClient();

    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select('*, companies(id, name, inn)')
      .order('created_at', { ascending: false });

    if (error) {
      return { success: false, error: `Ошибка загрузки пользователей: ${error.message}` };
    }

    return { success: true, data: users || [] };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой чтения реестра пользователей';
    return { success: false, error: errorMsg };
  }
}

// Редактирование профиля пользователя суперадмином
export async function updateUserAdminAction(
  userId: string,
  data: {
    full_name?: string;
    email?: string;
    role?: 'owner' | 'accountant' | 'manager';
    company_id?: string | null;
    is_super_admin?: boolean;
  }
): Promise<ActionResponse> {
  try {
    const supabaseAdmin = await createAdminClient();

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (data.full_name !== undefined) updatePayload.full_name = data.full_name;
    if (data.email !== undefined) updatePayload.email = data.email;
    if (data.role !== undefined) updatePayload.role = data.role;
    if (data.company_id !== undefined) updatePayload.company_id = data.company_id;
    if (data.is_super_admin !== undefined) updatePayload.is_super_admin = data.is_super_admin;

    const { error } = await supabaseAdmin
      .from('users')
      .update(updatePayload)
      .eq('id', userId);

    if (error) {
      return { success: false, error: `Ошибка обновления пользователя: ${error.message}` };
    }

    revalidatePath('/super-admin');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой обновления пользователя';
    return { success: false, error: errorMsg };
  }
}

// Удаление пользователя из системы
export async function deleteUserAdminAction(userId: string): Promise<ActionResponse> {
  try {
    const supabaseAdmin = await createAdminClient();

    // Удаляем из auth.users и public.users
    await supabaseAdmin.auth.admin.deleteUser(userId);
    const { error } = await supabaseAdmin.from('users').delete().eq('id', userId);

    if (error) {
      return { success: false, error: `Ошибка удаления пользователя из БД: ${error.message}` };
    }

    revalidatePath('/super-admin');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при удалении пользователя';
    return { success: false, error: errorMsg };
  }
}
