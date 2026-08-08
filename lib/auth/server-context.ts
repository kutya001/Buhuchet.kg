import { createClient, createAdminClient } from '@/lib/supabase/server';

export interface ServerUserContext {
  userId: string;
  companyId: string | null;
  role: string | null;
  isSuperAdmin: boolean;
}

/**
 * Получение серверного контекста пользователя (userId, companyId, role, isSuperAdmin)
 */
export async function getSeverUserContext(): Promise<ServerUserContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const adminSupabase = await createAdminClient();
  const { data: prof } = await adminSupabase
    .from('users')
    .select('company_id, role, is_super_admin')
    .eq('id', user.id)
    .single();

  return {
    userId: user.id,
    companyId: prof?.company_id || null,
    role: prof?.role || null,
    isSuperAdmin: !!prof?.is_super_admin,
  };
}
