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
