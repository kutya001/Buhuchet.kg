import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard/DashboardShell';

export default async function DashboardLayout({
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

  // Параллельное получение профиля и компании
  const { data: profile } = await supabase
    .from('users')
    .select('*, companies(*)')
    .eq('id', user.id)
    .single();

  const company = Array.isArray(profile?.companies) ? profile?.companies[0] : profile?.companies;

  return (
    <DashboardShell
      userEmail={user.email || ''}
      fullName={profile?.full_name}
      companyName={company?.name}
      companyInn={company?.inn}
      isSuperAdmin={!!profile?.is_super_admin}
    >
      {children}
    </DashboardShell>
  );
}
