'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { ActionResponse, UserProfile, CompanyRole } from '@/types/database.types';
import { revalidatePath, revalidateTag } from 'next/cache';

async function getUserContext() {
  const supabase = await createClient();
  const adminSupabase = await createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await adminSupabase
    .from('users')
    .select('*, company_roles(*)')
    .eq('id', user.id)
    .single();

  return {
    userId: user.id,
    userEmail: user.email,
    companyId: profile?.company_id,
    isSuperAdmin: !!profile?.is_super_admin,
    role: profile?.role,
    profile,
  };
}

/**
 * 1. Получение реестра активных сотрудников компании
 */
export async function getCompanyEmployeesAction(
  page: number = 1,
  limit: number = 25,
  searchQuery?: string
): Promise<ActionResponse<{ employees: UserProfile[]; totalCount: number }>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || (!ctx.companyId && !ctx.isSuperAdmin)) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    const adminSupabase = await createAdminClient();
    const from = (page - 1) * limit;
    const to = page * limit - 1;

    let query = adminSupabase
      .from('users')
      .select('*, company_roles(*)', { count: 'exact' });

    if (!ctx.isSuperAdmin && ctx.companyId) {
      query = query.eq('company_id', ctx.companyId);
    }

    if (searchQuery && searchQuery.trim().length > 0) {
      const q = `%${searchQuery.trim()}%`;
      query = query.or(`full_name.ilike.${q},email.ilike.${q},position.ilike.${q}`);
    }

    const { data: employees, count, error } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      return { success: false, error: `Ошибка загрузки сотрудников: ${error.message}` };
    }

    return {
      success: true,
      data: {
        employees: (employees || []) as UserProfile[],
        totalCount: count || 0,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при выгрузке сотрудников';
    return { success: false, error: errorMsg };
  }
}

/**
 * 2. Получение поступивших заявок сотрудников со статусом pending
 */
export async function getPendingRequestsAction(
  companyId: string
): Promise<ActionResponse<UserProfile[]>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || (ctx.companyId !== companyId && !ctx.isSuperAdmin)) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();
    const { data, error } = await adminSupabase
      .from('users')
      .select('*, company_roles(*)')
      .eq('company_id', companyId)
      .is('role_id', null)
      .neq('role', 'owner')
      .order('created_at', { ascending: false });

    if (error) {
      return { success: false, error: `Ошибка получения заявок: ${error.message}` };
    }

    return { success: true, data: (data || []) as UserProfile[] };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой получения заявок' };
  }
}

/**
 * 3. Принятие заявки сотрудника в штат
 */
export async function approveEmployeeRequestAction(params: {
  userId: string;
  roleId: string;
  position: string;
}): Promise<ActionResponse<{ message: string }>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || (ctx.role !== 'owner' && !ctx.isSuperAdmin)) {
      return { success: false, error: 'Принимать сотрудников может только Владелец компании' };
    }

    const adminSupabase = await createAdminClient();
    const { error } = await adminSupabase
      .from('users')
      .update({
        role_id: params.roleId,
        position: params.position || 'Сотрудник',
        role: 'manager',
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.userId);

    if (error) {
      return { success: false, error: `Ошибка принятия сотрудника: ${error.message}` };
    }

    revalidatePath('/dashboard/employees');
    return { success: true, data: { message: 'Сотрудник успешно зачислен в штат компании' } };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой утверждения заявки' };
  }
}

/**
 * 4. Отклонение заявки сотрудника
 */
export async function rejectEmployeeRequestAction(
  userId: string
): Promise<ActionResponse<{ message: string }>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || (ctx.role !== 'owner' && !ctx.isSuperAdmin)) {
      return { success: false, error: 'Отклонять заявки может только Владелец компании' };
    }

    const adminSupabase = await createAdminClient();
    const { error } = await adminSupabase
      .from('users')
      .update({
        company_id: null,
        position: null,
        role_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      return { success: false, error: `Ошибка отклонения заявки: ${error.message}` };
    }

    revalidatePath('/dashboard/employees');
    return { success: true, data: { message: 'Заявка сотрудника отклонена' } };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой отклонения заявки' };
  }
}

/**
 * 5. Редактирование ТОЛЬКО Роли и Должности сотрудника (Личные данные заблокированы)
 */
export async function updateEmployeeRoleAndPositionAction(params: {
  userId: string;
  roleId: string;
  position: string;
}): Promise<ActionResponse<{ message: string }>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || (ctx.role !== 'owner' && !ctx.isSuperAdmin)) {
      return { success: false, error: 'Изменять роли может только Владелец компании' };
    }

    const adminSupabase = await createAdminClient();
    const { error } = await adminSupabase
      .from('users')
      .update({
        role_id: params.roleId,
        position: params.position,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.userId);

    if (error) {
      return { success: false, error: `Ошибка обновления сотрудника: ${error.message}` };
    }

    revalidatePath('/dashboard/employees');
    return { success: true, data: { message: 'Роль и должность сотрудника успешно обновлены' } };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой обновления сотрудника' };
  }
}

/**
 * 6. Исключение сотрудника из компании
 */
export async function removeEmployeeAction(
  userId: string
): Promise<ActionResponse<{ message: string }>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || (ctx.role !== 'owner' && !ctx.isSuperAdmin)) {
      return { success: false, error: 'Исключать сотрудников может только Владелец компании' };
    }

    const adminSupabase = await createAdminClient();
    const { error } = await adminSupabase
      .from('users')
      .update({
        company_id: null,
        role_id: null,
        position: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) {
      return { success: false, error: `Ошибка исключения сотрудника: ${error.message}` };
    }

    revalidatePath('/dashboard/employees');
    return { success: true, data: { message: 'Сотрудник успешно исключен из штата компании' } };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой исключения сотрудника' };
  }
}

/**
 * 7. Получение списка ролей компании
 */
export async function getCompanyRolesAction(): Promise<ActionResponse<CompanyRole[]>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || (!ctx.companyId && !ctx.isSuperAdmin)) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    const adminSupabase = await createAdminClient();

    if (ctx.companyId) {
      await adminSupabase.rpc('seed_default_company_roles', { target_comp_id: ctx.companyId });
    }

    let query = adminSupabase.from('company_roles').select('*');
    if (!ctx.isSuperAdmin && ctx.companyId) {
      query = query.eq('company_id', ctx.companyId);
    }

    const { data: roles, error } = await query.order('created_at', { ascending: true });

    if (error) {
      return { success: false, error: `Ошибка загрузки ролей: ${error.message}` };
    }

    return { success: true, data: (roles || []) as CompanyRole[] };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой при выгрузке ролей' };
  }
}

/**
 * 8. Создание кастомной роли
 */
export async function createCompanyRoleAction(params: {
  name: string;
  description?: string;
  permissions?: any;
}): Promise<ActionResponse<CompanyRole>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || (!ctx.companyId && !ctx.isSuperAdmin)) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    const adminSupabase = await createAdminClient();
    const { data: role, error } = await adminSupabase
      .from('company_roles')
      .insert({
        company_id: ctx.companyId,
        name: params.name,
        description: params.description || null,
        is_system: false,
        permissions: params.permissions || {},
      })
      .select()
      .single();

    if (error || !role) {
      return { success: false, error: `Ошибка создания роли: ${error?.message}` };
    }

    revalidatePath('/dashboard/employees');
    revalidateTag('company-roles');
    return { success: true, data: role as CompanyRole };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой создания роли' };
  }
}

/**
 * 9. Обновление роли
 */
export async function updateCompanyRoleAction(
  roleId: string,
  params: { name?: string; description?: string; permissions?: any }
): Promise<ActionResponse<CompanyRole>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || (!ctx.companyId && !ctx.isSuperAdmin)) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    const adminSupabase = await createAdminClient();
    const { data: updated, error } = await adminSupabase
      .from('company_roles')
      .update({
        ...params,
        updated_at: new Date().toISOString(),
      })
      .eq('id', roleId)
      .select()
      .single();

    if (error || !updated) {
      return { success: false, error: `Ошибка обновления роли: ${error?.message}` };
    }

    revalidatePath('/dashboard/employees');
    revalidateTag('company-roles');
    return { success: true, data: updated as CompanyRole };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой обновления роли' };
  }
}

/**
 * 10. Удаление роли
 */
export async function deleteCompanyRoleAction(
  roleId: string
): Promise<ActionResponse<{ message: string }>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || (!ctx.companyId && !ctx.isSuperAdmin)) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    const adminSupabase = await createAdminClient();
    const { error } = await adminSupabase.from('company_roles').delete().eq('id', roleId);

    if (error) {
      return { success: false, error: `Ошибка удаления роли: ${error.message}` };
    }

    revalidatePath('/dashboard/employees');
    return { success: true, data: { message: 'Роль успешно удалена' } };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой удаления роли' };
  }
}
