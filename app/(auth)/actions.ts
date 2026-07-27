'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ActionResponse } from '@/types/database.types';

const loginSchema = z.object({
  email: z.string().email({ message: 'Введите корректный адрес электронной почты' }),
  password: z.string().min(6, { message: 'Пароль должен содержать минимум 6 символов' }),
});

export async function loginAction(formData: FormData): Promise<ActionResponse<{ userId: string }>> {
  try {
    const rawEmail = formData.get('email');
    const rawPassword = formData.get('password');

    const validatedFields = loginSchema.safeParse({
      email: rawEmail,
      password: rawPassword,
    });

    if (!validatedFields.success) {
      const errorMessage = validatedFields.error.issues.map((issue) => issue.message).join(', ');
      return { success: false, error: errorMessage };
    }

    const { email, password } = validatedFields.data;
    const supabase = await createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return {
        success: false,
        error: error.message === 'Invalid login credentials' 
          ? 'Неверный email или пароль' 
          : error.message,
      };
    }

    if (!data.user) {
      return { success: false, error: 'Пользователь не найден' };
    }

    revalidatePath('/', 'layout');
    return { success: true, data: { userId: data.user.id } };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Произошла непредвиденная ошибка при входе';
    return { success: false, error: errorMessage };
  }
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
