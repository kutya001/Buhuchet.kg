import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { SuperAdminShell } from './super-admin-shell';

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Проверяем флаг is_super_admin в таблице users
  const { data: profile } = await supabase
    .from('users')
    .select('full_name, is_super_admin')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.is_super_admin) {
    redirect('/dashboard');
  }

  return (
    <SuperAdminShell userName={profile.full_name || 'Суперадминистратор'}>
      {children}
    </SuperAdminShell>
  );
}
