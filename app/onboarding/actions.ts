'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createCompanySchema } from '@/types/company.types';
import type { ActionResponse, Company } from '@/types/database.types';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function createCompanyAction(
  formData: FormData
): Promise<ActionResponse<Company>> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const rawName = formData.get('name')?.toString() || '';
    const rawInn = formData.get('inn')?.toString() || '';
    const rawAddress = formData.get('address')?.toString() || '';
    const rawPhone = formData.get('phone')?.toString() || '';

    const validation = createCompanySchema.safeParse({
      name: rawName,
      inn: rawInn,
      address: rawAddress,
      phone: rawPhone,
    });

    if (!validation.success) {
      const errorMsg = validation.error.issues.map((i) => i.message).join(', ');
      return { success: false, error: errorMsg };
    }

    const { name, inn, address, phone } = validation.data;

    // Используем админ-клиент для служебных операций создания тенанта
    const supabaseAdmin = createAdminClient();

    // 1. Проверяем, существует ли уже компания с таким ИНН
    const { data: existingCompany } = await supabaseAdmin
      .from('companies')
      .select('id')
      .eq('inn', inn)
      .single();

    if (existingCompany) {
      return {
        success: false,
        error: 'Организация с таким ИНН уже зарегистрирована в системе',
      };
    }

    // 2. Создаем компанию
    const { data: company, error: companyError } = await supabaseAdmin
      .from('companies')
      .insert({
        name,
        inn,
        address: address || null,
        phone: phone || null,
        is_active: true,
        storage_limit_gb: 10,
      })
      .select()
      .single();

    if (companyError || !company) {
      return {
        success: false,
        error: `Ошибка создания компании: ${companyError?.message || 'Неизвестный сбой'}`,
      };
    }

    // 3. Генерируем 14 дней Trial подписки
    const trialExpiresAt = new Date();
    trialExpiresAt.setDate(trialExpiresAt.getDate() + 14);

    const { error: subError } = await supabaseAdmin.from('subscriptions').insert({
      company_id: company.id,
      plan_type: 'basic',
      status: 'trial',
      expires_at: trialExpiresAt.toISOString(),
    });

    if (subError) {
      return {
        success: false,
        error: `Ошибка создания подписки: ${subError.message}`,
      };
    }

    // 4. Привязываем компанию к текущему пользователю и назначаем роль Owner
    const { error: userUpdateError } = await supabaseAdmin
      .from('users')
      .update({
        company_id: company.id,
        role: 'owner',
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (userUpdateError) {
      return {
        success: false,
        error: `Ошибка обновления профиля пользователя: ${userUpdateError.message}`,
      };
    }

    revalidatePath('/', 'layout');
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error ? err.message : 'Непредвиденная ошибка при онбординге';
    return { success: false, error: errorMsg };
  }

  redirect('/uchet');
}

/**
 * Получение списка активных компаний для выпадающего списка Onboarding (только id и name)
 */
export async function getPublicCompaniesListAction(): Promise<ActionResponse<{ id: string; name: string }[]>> {
  try {
    const adminSupabase = createAdminClient();
    const { data, error } = await adminSupabase
      .from('companies')
      .select('id, name')
      .eq('is_active', true)
      .order('name');

    if (error) {
      return { success: false, error: ` Ошибка получения списка организаций: ${error.message}` };
    }

    return { success: true, data: data || [] };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой получения компаний' };
  }
}

/**
 * Подача заявки сотрудником на присоединение к компании (со статусом 'pending')
 */
export async function submitJoinCompanyRequestAction(
  companyId: string,
  position?: string
): Promise<ActionResponse<{ message: string }>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const adminSupabase = createAdminClient();

    // Проверяем, нет ли уже поданной заявки
    const { data: existingUser } = await adminSupabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single();

    if (existingUser?.company_id) {
      return { success: false, error: 'Вы уже подали заявку или состояте в компании' };
    }

    // Записываем ID компании пользователю и ставим статус заявки
    const { error: updateError } = await adminSupabase
      .from('users')
      .update({
        company_id: companyId,
        position: position || 'Сотрудник',
        role: 'manager',
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updateError) {
      return { success: false, error: `Ошибка подачи заявки: ${updateError.message}` };
    }

    revalidatePath('/', 'layout');
    return { success: true, data: { message: 'Заявка успешно отправлена владельцу компании' } };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой подачи заявки' };
  }
}

