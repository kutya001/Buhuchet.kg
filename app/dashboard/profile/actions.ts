'use server';

import { createClient } from '@/lib/supabase/server';
import { updateProfileSchema } from '@/types/profile.types';
import type { ActionResponse, UserProfile } from '@/types/database.types';
import { revalidatePath } from 'next/cache';

export async function updateProfileAction(
  formData: FormData
): Promise<ActionResponse<UserProfile>> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const rawFullName = formData.get('full_name')?.toString() || '';
    const rawPhone = formData.get('phone')?.toString() || '';
    const rawSecondaryEmail = formData.get('secondary_email')?.toString() || '';

    const validationResult = updateProfileSchema.safeParse({
      full_name: rawFullName,
      phone: rawPhone,
      secondary_email: rawSecondaryEmail,
    });

    if (!validationResult.success) {
      const errorMsg = validationResult.error.issues
        .map((issue) => issue.message)
        .join(', ');
      return { success: false, error: errorMsg };
    }

    const { full_name, phone, secondary_email } = validationResult.data;

    // Обновляем запись профиля в таблице users
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

    revalidatePath('/dashboard/profile');
    revalidatePath('/dashboard');

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
