import React from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { CompanyBlockedView } from '@/components/dashboard/CompanyBlockedView';

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

  // Параллельное получение профиля, компании и ролей
  const { data: profile } = await supabase
    .from('users')
    .select('*, companies(*), company_roles(*)')
    .eq('id', user.id)
    .single();

  const company = Array.isArray(profile?.companies) ? profile?.companies[0] : profile?.companies;

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
