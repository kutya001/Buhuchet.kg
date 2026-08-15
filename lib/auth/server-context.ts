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
    .maybeSingle();

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

/**
 * Получение текущего пользователя auth
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Получение прав текущего пользователя
 */
export const getUserPermissions = cache(async () => {
  const ctx = await getSeverUserContext();
  if (!ctx || !ctx.userId) return null;

  if (ctx.isSuperAdmin || ctx.role === 'owner') {
    return { isFullAccess: true };
  }

  if (!ctx.roleId) return { isFullAccess: false, permissions: {} };

  const adminSupabase = await createAdminClient();
  const { data: roleData } = await adminSupabase
    .from('company_roles')
    .select('permissions')
    .eq('id', ctx.roleId)
    .maybeSingle();

  return { isFullAccess: false, permissions: roleData?.permissions || {} };
});

/**
 * Строгая проверка прав суперадминистратора для Server Actions
 */
export const requireSuperAdminSession = cache(async (): Promise<{ userId: string; email: string; isSuperAdmin: true }> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('401 Unauthorized: Пользователь не авторизован');
  }

  const adminSupabase = await createAdminClient();
  const { data: profile } = await adminSupabase
    .from('users')
    .select('id, email, is_super_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.is_super_admin) {
    throw new Error('403 Forbidden: Доступ разрешен только Суперадминистратору платформы');
  }

  return {
    userId: user.id,
    email: user.email || profile.email,
    isSuperAdmin: true,
  };
});


