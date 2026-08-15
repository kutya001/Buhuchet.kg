'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { ActionResponse, Company } from '@/types/database.types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { validateKyrgyzINN } from '@/lib/validators/inn';

const onboardingSchema = z.object({
  name: z.string().min(2, { message: 'Укажите официальное наименование организации' }),
  inn: z.string().superRefine((val, ctx) => {
    const res = validateKyrgyzINN(val);
    if (!res.isValid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: res.error || 'Некорректный ИНН Кыргызской Республики',
      });
    }
  }),
  industry: z.string().min(1, { message: 'Выберите отрасль компании' }),
  email: z.string().email({ message: 'Укажите корректный контактный E-mail' }),
  phone: z.string().min(6, { message: 'Укажите контактный телефон' }),
  legal_address: z.string().min(3, { message: 'Укажите юридический адрес' }),
  director_name: z.string().min(2, { message: 'Укажите ФИО руководителя' }),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;

export async function createCompanyOnboardingAction(data: OnboardingInput): Promise<ActionResponse<Company>> {
  try {
    const supabase = await createClient();
    const adminSupabase = await createAdminClient();

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

    // 1. Создаем компанию со статусом pending_approval используя adminSupabase для гарантированного считывания
    const { data: company, error: compError } = await adminSupabase
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
    const { error: userError } = await adminSupabase
      .from('users')
      .upsert({
        id: user.id,
        email: user.email!,
        full_name: user.user_metadata?.full_name || director_name || 'Руководитель',
        company_id: company.id,
        role: 'owner',
        updated_at: new Date().toISOString(),
      });

    if (userError) {
      return { success: false, error: `Ошибка привязки пользователя: ${userError.message}` };
    }

    revalidatePath('/uchet');
    revalidatePath('/uchet/pending');
    return { success: true, data: company as Company };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при онбординге организации';
    return { success: false, error: errorMsg };
  }
}

export async function resubmitCompanyForModerationAction(
  companyId: string,
  data: OnboardingInput
): Promise<ActionResponse<Company>> {
  try {
    const adminSupabase = await createAdminClient();

    const validation = onboardingSchema.safeParse(data);
    if (!validation.success) {
      const errStr = validation.error.issues.map((i) => i.message).join(', ');
      return { success: false, error: errStr };
    }

    const { name, inn, industry, email, phone, legal_address, director_name } = validation.data;

    // Повторно отправляем на модерацию (pending_approval), очищая замечания
    const { data: company, error } = await adminSupabase
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

    revalidatePath('/uchet');
    revalidatePath('/uchet/pending');
    return { success: true, data: company as Company };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при повторной отправке на модерацию';
    return { success: false, error: errorMsg };
  }
}

/**
 * Поиск активных компаний в КР по ИНН или названию для подачи заявки сотрудника
 */
export async function searchActiveCompaniesAction(
  query: string
): Promise<ActionResponse<Array<Partial<Company>>>> {
  try {
    if (!query || query.trim().length < 2) {
      return { success: true, data: [] };
    }

    const adminSupabase = await createAdminClient();
    const cleanQuery = query.trim();

    const { data: companies, error } = await adminSupabase
      .from('companies')
      .select('id, name, inn, director_name, legal_address, industry')
      .or(`name.ilike.%${cleanQuery}%,inn.ilike.%${cleanQuery}%`)
      .limit(10);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: companies || [] };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой поиска компаний' };
  }
}

/**
 * Подача заявки сотрудника на привязку к выбранной организации
 */
export async function createEmployeeJoinRequestAction(data: {
  companyId: string;
  position: string;
  fullName: string;
  phone: string;
}): Promise<ActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    if (!data.companyId) {
      return { success: false, error: 'Выберите целевую компанию из списка' };
    }

    if (!data.fullName || data.fullName.trim().length < 2) {
      return { success: false, error: 'Укажите ваше полное ФИО' };
    }

    const adminSupabase = await createAdminClient();

    const { error: userErr } = await adminSupabase
      .from('users')
      .upsert({
        id: user.id,
        email: user.email!,
        full_name: data.fullName.trim(),
        phone: data.phone ? data.phone.trim() : null,
        company_id: data.companyId,
        position: data.position ? data.position.trim() : 'Сотрудник',
        role: null,
        updated_at: new Date().toISOString(),
      });

    if (userErr) {
      return { success: false, error: `Ошибка подачи заявки: ${userErr.message}` };
    }

    revalidatePath('/uchet');
    revalidatePath('/uchet/employees');
    revalidatePath('/uchet/pending');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой подачи заявки сотрудника' };
  }
}
