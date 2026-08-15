import React from 'react';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { CompanyBlockedView } from '@/components/dashboard/CompanyBlockedView';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const adminSupabase = await createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Получение профиля и привязанной компании с помощью adminSupabase
  const { data: profile } = await adminSupabase
    .from('users')
    .select('*, company_roles(*)')
    .eq('id', user.id)
    .single();

  let company = null;
  if (profile?.company_id) {
    const { data: comp } = await adminSupabase
      .from('companies')
      .select('*')
      .eq('id', profile.company_id)
      .single();
    company = comp;
  }

  // 🔒 ЕСЛИ ОРГАНИЗАЦИЯ ЗАБЛОКИРОВАНА СУПЕРАДМИНИСТРАТОРОМ
  if (company?.status === 'blocked' && !profile?.is_super_admin) {
    return (
      <CompanyBlockedView
        companyName={company.name}
        companyInn={company.inn}
        moderationComment={company.moderation_comment}
      />
    );
  }

  return (
    <DashboardShell
      userEmail={user.email || ''}
      fullName={profile?.full_name}
      companyName={company?.name}
      companyInn={company?.inn}
      isSuperAdmin={!!profile?.is_super_admin}
      userProfile={profile}
    >
      {children}
    </DashboardShell>
  );
}
