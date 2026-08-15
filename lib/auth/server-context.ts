import { cache } from 'react';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export interface ServerUserContext {
  userId: string;
  companyId: string | null;
  role: string | null;
  roleId: string | null;
  isSuperAdmin: boolean;
  hasActiveCompany: boolean;
  membershipStatus: 'active' | 'pending' | 'none';
}

/**
 * Получение серверного контекста пользователя (userId, companyId, role, isSuperAdmin, hasActiveCompany).
 * Мемоизировано через React cache() для исключения дублирующих DB-запросов в рамках одного HTTP запроса.
 */
export const getSeverUserContext = cache(async (): Promise<ServerUserContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const adminSupabase = await createAdminClient();
  const { data: prof } = await adminSupabase
    .from('users')
    .select('company_id, role, role_id, is_super_admin')
    .eq('id', user.id)
    .single();

  const companyId = prof?.company_id || null;
  const role = prof?.role || null;
  const roleId = prof?.role_id || null;
  const isSuperAdmin = !!prof?.is_super_admin;

  let hasActiveCompany = false;
  let membershipStatus: 'active' | 'pending' | 'none' = 'none';

  if (isSuperAdmin) {
    hasActiveCompany = true;
    membershipStatus = 'active';
  } else if (companyId) {
    if (role === 'owner') {
      hasActiveCompany = true;
      membershipStatus = 'active';
    } else if (roleId) {
      hasActiveCompany = true;
      membershipStatus = 'active';
    } else {
      hasActiveCompany = false;
      membershipStatus = 'pending';
    }
  } else {
    hasActiveCompany = false;
    membershipStatus = 'none';
  }

  return {
    userId: user.id,
    companyId,
    role,
    roleId,
    isSuperAdmin,
    hasActiveCompany,
    membershipStatus,
  };
});

