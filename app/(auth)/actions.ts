'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

export async function signInAction(formData: FormData) {
  const email = (formData.get('email') as string)?.trim();
  const password = (formData.get('password') as string)?.trim();
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    const errorMessage = error.message === 'Invalid login credentials' 
      ? 'Неверный email или пароль' 
      : error.message;

    redirect(`/login?error=${encodeURIComponent(errorMessage)}`);
  }

  // Проверяем статус суперадмина для корректного контура
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let targetPath = '/uchet';
  if (user) {
    const { data: dbUser } = await supabase
      .from('users')
      .select('is_super_admin, company_id')
      .eq('id', user.id)
      .maybeSingle();

    if (dbUser?.is_super_admin) {
      targetPath = '/admin';
    } else if (!dbUser?.company_id) {
      targetPath = '/uchet/pending';
    }
  }

  revalidatePath('/', 'layout');
  redirect(targetPath);
}

export async function signUpAction(formData: FormData) {
  const email = (formData.get('email') as string)?.trim();
  const password = (formData.get('password') as string)?.trim();
  const fullName = (formData.get('fullName') as string)?.trim();
  const accountType = (formData.get('accountType') as string)?.trim() === 'employee' ? 'employee' : 'owner';
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        account_type: accountType,
      },
    },
  });

  if (error) {
    redirect(`/register?error=${encodeURIComponent(error.message)}`);
  }

  // Создаем запись в публичной таблице users с правами service_role (createAdminClient)
  if (data.user) {
    const isOwner = accountType === 'owner';
    const adminSupabase = await createAdminClient();

    await adminSupabase.from('users').upsert({
      id: data.user.id,
      email: data.user.email,
      full_name: fullName || (isOwner ? 'Руководитель' : 'Сотрудник'),
      role: isOwner ? 'owner' : 'manager',
      role_id: null,
      company_id: null,
      is_super_admin: false,
    });
  }

  revalidatePath('/', 'layout');

  if (accountType === 'employee') {
    redirect('/uchet/pending');
  } else {
    redirect('/onboarding');
  }
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
