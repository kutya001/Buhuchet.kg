'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import type { ActionResponse, FileCategory, FeatureFlag, UserProfile, Company } from '@/types/database.types';
import { revalidatePath } from 'next/cache';

// Одобрить и Активировать компанию
export async function approveCompanyAction(companyId: string): Promise<ActionResponse> {
  try {
    const supabaseAdmin = createAdminClient();

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

// Вернуть компанию на доработку с указанием замечаний
export async function rejectCompanyWithCommentAction(
  companyId: string,
  comment: string
): Promise<ActionResponse> {
  try {
    if (!comment || comment.trim().length < 3) {
      return { success: false, error: 'Укажите понятную причину возврата заявки на доработку' };
    }

    const supabaseAdmin = createAdminClient();

    const { error } = await supabaseAdmin
      .from('companies')
      .update({
        status: 'requires_changes',
        moderation_comment: comment,
        updated_at: new Date().toISOString(),
      })
      .eq('id', companyId);

    if (error) {
      return { success: false, error: `Ошибка отклонения компании: ${error.message}` };
    }

    revalidatePath('/super-admin');
    revalidatePath('/dashboard');
    revalidatePath('/dashboard/pending');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при отправке на доработку';
    return { success: false, error: errorMsg };
  }
}

// Создание категории файлов
export async function createFileCategoryAction(
  name: string,
  description?: string,
  icon?: string
): Promise<ActionResponse<FileCategory>> {
  try {
    const supabaseAdmin = createAdminClient();

    const { data, error } = await supabaseAdmin
      .from('file_categories')
      .insert({
        name,
        description: description || null,
        icon: icon || 'FileText',
        is_active: true,
      })
      .select()
      .single();

    if (error || !data) {
      return { success: false, error: `Ошибка создания категории: ${error?.message}` };
    }

    revalidatePath('/super-admin');
    return { success: true, data: data as FileCategory };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при создании категории';
    return { success: false, error: errorMsg };
  }
}

// Привязка пользователя к компании и смена роли
export async function updateUserCompanyAndRoleAction(
  userId: string,
  companyId: string | null,
  role: 'owner' | 'accountant' | 'manager',
  isSuperAdmin?: boolean
): Promise<ActionResponse> {
  try {
    const supabaseAdmin = createAdminClient();

    const { error } = await supabaseAdmin
      .from('users')
      .update({
        company_id: companyId || null,
        role,
        is_super_admin: isSuperAdmin ?? false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      return { success: false, error: `Ошибка обновления пользователя: ${error.message}` };
    }

    revalidatePath('/super-admin');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при обновлении профиля пользователя';
    return { success: false, error: errorMsg };
  }
}

// Переключение фичи (Feature Flag)
export async function toggleFeatureFlagAction(
  key: string,
  isEnabled: boolean
): Promise<ActionResponse> {
  try {
    const supabaseAdmin = createAdminClient();

    const { error } = await supabaseAdmin
      .from('feature_flags')
      .update({
        is_enabled: isEnabled,
        updated_at: new Date().toISOString(),
      })
      .eq('key', key);

    if (error) {
      return { success: false, error: `Ошибка переключения фичи: ${error.message}` };
    }

    revalidatePath('/super-admin');
    revalidatePath('/dashboard', 'layout');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при обновлении фичи';
    return { success: false, error: errorMsg };
  }
}

// Блокировка/Разблокировка компании
export async function toggleCompanyStatusAction(
  companyId: string,
  isActive: boolean
): Promise<ActionResponse> {
  try {
    const supabaseAdmin = createAdminClient();

    const { error } = await supabaseAdmin
      .from('companies')
      .update({
        is_active: isActive,
        status: isActive ? 'active' : 'blocked',
        updated_at: new Date().toISOString(),
      })
      .eq('id', companyId);

    if (error) {
      return { success: false, error: `Ошибка смены статуса компании: ${error.message}` };
    }

    revalidatePath('/super-admin');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при смене статуса компании';
    return { success: false, error: errorMsg };
  }
}
