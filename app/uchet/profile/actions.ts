'use server';

import { createClient } from '@/lib/supabase/server';
import { updateProfileSchema } from '@/types/profile.types';
import type { ActionResponse, UserProfile } from '@/types/database.types';
import { revalidatePath } from 'next/cache';

/**
 * Обновление личных данных профиля (ФИО, Телефон)
 */
export async function updatePersonalProfileDataAction(params: {
  fullName: string;
  phone: string;
}): Promise<ActionResponse<UserProfile>> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const validationResult = updateProfileSchema.safeParse({
      full_name: params.fullName,
      phone: params.phone,
    });

    if (!validationResult.success) {
      const errorMsg = validationResult.error.issues
        .map((issue) => issue.message)
        .join(', ');
      return { success: false, error: errorMsg };
    }

    const { full_name, phone } = validationResult.data;

    const { data: updatedProfile, error: updateError } = await supabase
      .from('users')
      .update({
        full_name,
        phone: phone || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .select()
      .single();

    if (updateError) {
      return {
        success: false,
        error: `Ошибка при обновлении профиля: ${updateError.message}`,
      };
    }

    revalidatePath('/uchet/profile');
    revalidatePath('/uchet');

    return {
      success: true,
      data: updatedProfile as UserProfile,
    };
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : 'Неизвестная ошибка при сохранении профиля';
    return { success: false, error: errorMessage };
  }
}

/**
 * Смена пароля авторизованного пользователя через Supabase Auth
 */
export async function updatePasswordAction(
  newPassword: string,
  confirmPassword: string
): Promise<ActionResponse<{ message: string }>> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    if (!newPassword || newPassword.length < 8) {
      return { success: false, error: 'Пароль должен содержать минимум 8 символов' };
    }

    if (newPassword !== confirmPassword) {
      return { success: false, error: 'Новые пароли не совпадают' };
    }

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: { message: 'Пароль успешно изменён' } };
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : 'Сбой при изменении пароля';
    return { success: false, error: errorMessage };
  }
}

/**
 * Совместимость с предыдущими вызовами updateProfileAction
 */
export async function updateProfileAction(
  formData: FormData
): Promise<ActionResponse<UserProfile>> {
  const rawFullName = formData.get('full_name')?.toString() || '';
  const rawPhone = formData.get('phone')?.toString() || '';
  return updatePersonalProfileDataAction({ fullName: rawFullName, phone: rawPhone });
}
