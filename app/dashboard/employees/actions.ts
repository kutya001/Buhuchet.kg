'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { ActionResponse, UserProfile, CompanyRole, RolePermissions } from '@/types/database.types';
import { revalidatePath } from 'next/cache';

async function getUserContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
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
 * 1. Получение реестра сотрудников компании с пагинацией
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
 * 2. Получение списка ролей компании
 */
export async function getCompanyRolesAction(): Promise<ActionResponse<CompanyRole[]>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || (!ctx.companyId && !ctx.isSuperAdmin)) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    const adminSupabase = await createAdminClient();

    // Автоматический сидинг базовых ролей при первом запросе
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

    let fetchedRoles = (roles || []) as CompanyRole[];

    // Если ролей нет (например RPC не отработал), создаем дефолтные через API
    if (fetchedRoles.length === 0 && ctx.companyId) {
      const defaultRoles = [
        {
          company_id: ctx.companyId,
          name: 'Главный Бухгалтер',
          description: 'Полный доступ к документам, контрагентам и финансам. Управление сотрудниками.',
          is_system: true,
          permissions: { documents: ['view', 'create', 'edit', 'delete'], counterparties: ['view', 'create', 'edit', 'delete'] }
        },
        {
          company_id: ctx.companyId,
          name: 'Менеджер по продажам',
          description: 'Создание и отправка первичной документации (накладные, акты).',
          is_system: true,
          permissions: { documents: ['view', 'create'], counterparties: ['view'] }
        },
        {
          company_id: ctx.companyId,
          name: 'Аудитор (Чтение)',
          description: 'Режим только для чтения. Просмотр реестров без права редактирования.',
          is_system: true,
          permissions: { documents: ['view'], counterparties: ['view'], files: ['view'] }
        }
      ];
      
      const { data: insertedRoles } = await adminSupabase
        .from('company_roles')
        .insert(defaultRoles)
        .select('*');
        
      if (insertedRoles) {
        fetchedRoles = insertedRoles as CompanyRole[];
      }
    }

    // Добавляем системную роль Владельца
    const ownerRole: CompanyRole = {
      id: 'owner-system-role',
      company_id: ctx.companyId as string,
      name: 'Владелец (Owner)',
      description: 'Полный доступ ко всем модулям и настройкам компании. Эту роль нельзя изменить или удалить.',
      is_system: true,
      permissions: {
        documents: ['view', 'create', 'edit', 'delete'],
        files: ['view', 'create', 'edit', 'delete'],
        counterparties: ['view', 'create', 'edit', 'delete'],
        employees: ['view', 'create', 'edit', 'delete'],
        company: ['view', 'edit'],
      } as any,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return { success: true, data: [ownerRole, ...fetchedRoles] };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой загрузки ролей';
    return { success: false, error: errorMsg };
  }
}

/**
 * 3. Создание аккаунта нового сотрудника
 */
export async function createEmployeeAction(data: {
  full_name: string;
  email: string;
  phone?: string;
  position?: string;
  role_id?: string;
  password?: string;
}): Promise<ActionResponse<UserProfile>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Только авторизованный владелец организации может создавать сотрудников' };
    }

    if (!data.email || !data.full_name) {
      return { success: false, error: 'Укажите ФИО и Email/логин сотрудника' };
    }

    const tempPassword = data.password && data.password.trim().length >= 6 ? data.password.trim() : 'Buhuchet2026!';
    const adminSupabase = await createAdminClient();

    // Создаем пользователя в auth.users
    const { data: authUser, error: authError } = await adminSupabase.auth.admin.createUser({
      email: data.email.trim(),
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: data.full_name.trim(),
      },
    });

    if (authError || !authUser?.user) {
      return { success: false, error: `Ошибка создания аккаунта: ${authError?.message || 'Пользователь с таким Email уже существует'}` };
    }

    // Создаем профиль в публичной таблице users
    const { data: newProfile, error: profileError } = await adminSupabase
      .from('users')
      .insert({
        id: authUser.user.id,
        company_id: ctx.companyId,
        full_name: data.full_name.trim(),
        email: data.email.trim(),
        phone: data.phone?.trim() || null,
        position: data.position?.trim() || 'Сотрудник',
        role: 'manager',
        role_id: data.role_id || null,
        is_active: true,
        must_change_password: true,
      })
      .select('*, company_roles(*)')
      .single();

    if (profileError || !newProfile) {
      return { success: false, error: `Ошибка сохранения профиля сотрудника: ${profileError?.message}` };
    }

    revalidatePath('/dashboard/employees');
    return { success: true, data: newProfile as UserProfile };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при создании сотрудника';
    return { success: false, error: errorMsg };
  }
}

/**
 * 4. Обновление роли/должности сотрудника
 */
export async function updateEmployeeAction(
  employeeId: string,
  data: {
    full_name?: string;
    position?: string;
    role_id?: string;
    is_active?: boolean;
  }
): Promise<ActionResponse> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    const adminSupabase = await createAdminClient();

    const { data: targetUser } = await adminSupabase
      .from('users')
      .select('company_id, role')
      .eq('id', employeeId)
      .single();

    if (!targetUser || (targetUser.company_id !== ctx.companyId && !ctx.isSuperAdmin)) {
      return { success: false, error: 'Доступ запрещен: чужой сотрудник' };
    }

    // Запрет редактирования аккаунта Владельца любыми другими сотрудниками
    if (targetUser.role === 'owner' && ctx.role !== 'owner' && !ctx.isSuperAdmin) {
      return { success: false, error: 'Доступ запрещен: нельзя редактировать профиль Владельца организации' };
    }

    const { error } = await adminSupabase
      .from('users')
      .update({
        full_name: data.full_name,
        position: data.position,
        role_id: data.role_id || null,
        is_active: data.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', employeeId);

    if (error) {
      return { success: false, error: `Ошибка обновления сотрудника: ${error.message}` };
    }

    revalidatePath('/dashboard/employees');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой редактирования сотрудника';
    return { success: false, error: errorMsg };
  }
}

/**
 * 5. Сброс пароля сотрудника администратором
 */
export async function resetEmployeePasswordAction(
  employeeId: string,
  newPassword: string
): Promise<ActionResponse> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    if (!newPassword || newPassword.trim().length < 6) {
      return { success: false, error: 'Пароль должен состоять минимум из 6 символов' };
    }

    const adminSupabase = await createAdminClient();
    const { data: targetUser } = await adminSupabase
      .from('users')
      .select('company_id, role')
      .eq('id', employeeId)
      .single();

    if (!targetUser || (targetUser.company_id !== ctx.companyId && !ctx.isSuperAdmin)) {
      return { success: false, error: 'Доступ запрещен' };
    }

    // Запрет сброса пароля Владельца другими сотрудниками
    if (targetUser.role === 'owner' && ctx.role !== 'owner' && !ctx.isSuperAdmin) {
      return { success: false, error: 'Доступ запрещен: нельзя менять пароль Владельца организации' };
    }

    const { error: authErr } = await adminSupabase.auth.admin.updateUserById(employeeId, {
      password: newPassword.trim(),
    });

    if (authErr) {
      return { success: false, error: `Ошибка сброса пароля: ${authErr.message}` };
    }

    await adminSupabase
      .from('users')
      .update({ must_change_password: true, updated_at: new Date().toISOString() })
      .eq('id', employeeId);

    revalidatePath('/dashboard/employees');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой сброса пароля';
    return { success: false, error: errorMsg };
  }
}

/**
 * 6. Создание роли компании
 */
export async function createCompanyRoleAction(data: {
  name: string;
  description?: string;
  permissions?: RolePermissions;
}): Promise<ActionResponse<CompanyRole>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    if (!data.name || !data.name.trim()) {
      return { success: false, error: 'Укажите название роли' };
    }

    const adminSupabase = await createAdminClient();
    const { data: role, error } = await adminSupabase
      .from('company_roles')
      .insert({
        company_id: ctx.companyId,
        name: data.name.trim(),
        description: data.description?.trim() || null,
        is_system: false,
        permissions: data.permissions || {
          documents: { view: true, create: true, edit: true, send: true, accept: true },
          files: { view: true, upload: true },
          counterparties: { view: true },
          company: { view: true },
        },
      })
      .select()
      .single();

    if (error || !role) {
      return { success: false, error: `Ошибка создания роли: ${error?.message}` };
    }

    revalidatePath('/dashboard/employees');
    return { success: true, data: role as CompanyRole };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой создания роли';
    return { success: false, error: errorMsg };
  }
}

/**
 * 7. Обновление роли и матрицы доступов
 */
export async function updateCompanyRoleAction(
  roleId: string,
  data: {
    name?: string;
    description?: string;
    permissions?: RolePermissions;
  }
): Promise<ActionResponse> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    const adminSupabase = await createAdminClient();

    const { data: existingRole } = await adminSupabase
      .from('company_roles')
      .select('company_id')
      .eq('id', roleId)
      .single();

    if (!existingRole || (existingRole.company_id !== ctx.companyId && !ctx.isSuperAdmin)) {
      return { success: false, error: 'Доступ запрещен: чужая роль' };
    }

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (data.name) updatePayload.name = data.name.trim();
    if (data.description !== undefined) updatePayload.description = data.description.trim();
    if (data.permissions) updatePayload.permissions = data.permissions;

    const { error } = await adminSupabase
      .from('company_roles')
      .update(updatePayload)
      .eq('id', roleId);

    if (error) {
      return { success: false, error: `Ошибка обновления роли: ${error.message}` };
    }

    revalidatePath('/dashboard/employees');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой обновления роли';
    return { success: false, error: errorMsg };
  }
}

/**
 * 8. Удаление пользовательской роли (Запрет удаления системных ролей)
 */
export async function deleteCompanyRoleAction(roleId: string): Promise<ActionResponse> {
  try {
    const ctx = await getUserContext();
    if (!ctx || (!ctx.companyId && !ctx.isSuperAdmin)) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const adminSupabase = await createAdminClient();

    const { data: role, error: fetchErr } = await adminSupabase
      .from('company_roles')
      .select('id, name, is_system')
      .eq('id', roleId)
      .single();

    if (fetchErr || !role) {
      return { success: false, error: 'Роль не найдена' };
    }

    if (role.is_system || role.name === 'Владелец') {
      return { success: false, error: 'Запрещено удалять системную роль Владелец' };
    }

    const { error: delErr } = await adminSupabase
      .from('company_roles')
      .delete()
      .eq('id', roleId);

    if (delErr) {
      return { success: false, error: `Ошибка удаления роли: ${delErr.message}` };
    }

    revalidatePath('/dashboard/employees');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой удаления роли';
    return { success: false, error: errorMsg };
  }
}
