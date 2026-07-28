'use server';

import { createClient } from '@/lib/supabase/server';
import type { ActionResponse, Company } from '@/types/database.types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const onboardingSchema = z.object({
  name: z.string().min(2, { message: 'Укажите официальное наименование организации' }),
  inn: z.string().length(14, { message: 'ИНН Кыргызстана должен состоять строго из 14 цифр' }),
  industry: z.string().min(1, { message: 'Выберите отрасль компании' }),
  email: z.string().email({ message: 'Укажите корректный контактный E-mail' }),
  phone: z.string().min(6, { message: 'Укажите контактный телефон' }),
  legal_address: z.string().min(3, { message: 'Укажите юридический адрес' }),
  director_name: z.string().min(2, { message: 'Укажите ФИО руководителя' }),
});

export async function createCompanyOnboardingAction(data: any): Promise<ActionResponse<Company>> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const validation = onboardingSchema.safeParse(data);
    if (!validation.success) {
      const errStr = validation.error.issues.map((i) => i.message).join(', ');
      return { success: false, error: errStr };
    }

    const { name, inn, industry, email, phone, legal_address, director_name } = validation.data;

    // 1. Создаем компанию со статусом pending_approval
    const { data: company, error: compError } = await supabase
      .from('companies')
      .insert({
        name,
        inn,
        industry,
        email,
        phone,
        legal_address,
        director_name,
        address: legal_address,
        status: 'pending_approval',
        is_active: true,
      })
      .select()
      .single();

    if (compError || !company) {
      return { success: false, error: `Ошибка создания компании: ${compError?.message}` };
    }

    // 2. Привязываем пользователя к компании и назначаем роль owner
    const { error: userError } = await supabase
      .from('users')
      .update({
        company_id: company.id,
        role: 'owner',
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (userError) {
      return { success: false, error: `Ошибка привязки пользователя: ${userError.message}` };
    }

    revalidatePath('/dashboard');
    revalidatePath('/dashboard/pending');
    return { success: true, data: company as Company };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при онбординге организации';
    return { success: false, error: errorMsg };
  }
}

export async function resubmitCompanyForModerationAction(
  companyId: string,
  data: any
): Promise<ActionResponse<Company>> {
  try {
    const supabase = await createClient();

    const validation = onboardingSchema.safeParse(data);
    if (!validation.success) {
      const errStr = validation.error.issues.map((i) => i.message).join(', ');
      return { success: false, error: errStr };
    }

    const { name, inn, industry, email, phone, legal_address, director_name } = validation.data;

    // Повторно отправляем на модерацию (pending_approval), очищая замечания
    const { data: company, error } = await supabase
      .from('companies')
      .update({
        name,
        inn,
        industry,
        email,
        phone,
        legal_address,
        director_name,
        address: legal_address,
        status: 'pending_approval',
        moderation_comment: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', companyId)
      .select()
      .single();

    if (error || !company) {
      return { success: false, error: `Ошибка обновления реквизитов: ${error?.message}` };
    }

    revalidatePath('/dashboard');
    revalidatePath('/dashboard/pending');
    return { success: true, data: company as Company };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при повторной отправке на модерацию';
    return { success: false, error: errorMsg };
  }
}
