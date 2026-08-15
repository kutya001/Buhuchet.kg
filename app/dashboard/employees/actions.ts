'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { ActionResponse, UserProfile, CompanyRole } from '@/types/database.types';
import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { createSafeAction } from '@/lib/auth/safe-action';
import { sendTelegramMessage } from '@/lib/telegram/notifier';

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
    .maybeSingle();

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
 * Получение профиля текущего пользователя для модуля сотрудников
 */
export async function getMyEmployeeProfileInfoAction(): Promise<ActionResponse<UserProfile>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.userId) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const adminSupabase = await createAdminClient();
    const { data: prof, error } = await adminSupabase
      .from('users')
      .select('*, companies(*), company_roles(*)')
      .eq('id', ctx.userId)
      .single();

    if (error || !prof) {
      return { success: false, error: error?.message || 'Профиль не найден' };
    }

    return { success: true, data: prof as UserProfile };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой получения профиля' };
  }
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
 * 2. Получение списка ожидающих заявок на вступление (из company_join_requests и users)
 */
export async function getPendingRequestsAction(
  companyId?: string
): Promise<ActionResponse<any[]>> {
  try {
    const ctx = await getUserContext();
    const targetCompId = companyId || ctx?.companyId;

    if (!targetCompId) {
      return { success: false, error: 'Идентификатор организации не определен' };
    }

    if (!ctx || (ctx.companyId && ctx.companyId !== targetCompId && !ctx.isSuperAdmin)) {
      return { success: false, error: 'Доступ к заявкам организации запрещен' };
    }

    const adminSupabase = await createAdminClient();

    // 1. Загружаем активные заявки из таблицы company_join_requests
    const { data: joinReqs, error: joinErr } = await adminSupabase
      .from('company_join_requests')
      .select('id, company_id, user_id, position_note, status, created_at')
      .eq('company_id', targetCompId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (joinErr) {
      console.error('[getPendingRequestsAction] Ошибка чтения company_join_requests:', joinErr);
    }

    const requestsList: any[] = [];

    if (joinReqs && joinReqs.length > 0) {
      const userIds = Array.from(new Set(joinReqs.map((r) => r.user_id)));
      const { data: usersList } = await adminSupabase
        .from('users')
        .select('id, full_name, email, phone')
        .in('id', userIds);

      const usersMap = new Map(usersList?.map((u) => [u.id, u]) || []);

      for (const r of joinReqs) {
        const u = usersMap.get(r.user_id);
        requestsList.push({
          id: r.user_id,
          requestId: r.id,
          full_name: u?.full_name || 'Кандидат',
          email: u?.email || '—',
          phone: u?.phone || '—',
          position: r.position_note || 'Сотрудник',
          created_at: r.created_at,
        });
      }
    }

    // 2. Дополнительно подтягиваем кандидатов из users (legacy fallback)
    const existingUserIds = new Set(requestsList.map((r) => r.id));
    const { data: legacyUsers } = await adminSupabase
      .from('users')
      .select('id, full_name, email, phone, position, created_at, company_roles(*)')
      .eq('company_id', targetCompId)
      .is('role_id', null)
      .neq('role', 'owner')
      .order('created_at', { ascending: false });

    if (legacyUsers && legacyUsers.length > 0) {
      for (const u of legacyUsers) {
        if (!existingUserIds.has(u.id)) {
          requestsList.push({
            id: u.id,
            requestId: undefined,
            full_name: u.full_name,
            email: u.email,
            phone: u.phone || '—',
            position: u.position || 'Сотрудник',
            created_at: u.created_at,
          });
        }
      }
    }

    return { success: true, data: requestsList };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой получения заявок' };
  }
}

/**
 * 3. Принятие заявки сотрудника в штат с назначением роли RBAC
 */
export async function approveEmployeeRequestAction(params: {
  userId: string;
  requestId?: string;
  roleId: string;
  position: string;
}): Promise<ActionResponse<{ message: string }>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || (ctx.role !== 'owner' && !ctx.isSuperAdmin)) {
      return { success: false, error: 'Принимать сотрудников может только Владелец компании' };
    }

    const adminSupabase = await createAdminClient();

    // 1. Обновляем пользователя в users
    const { error: userError } = await adminSupabase
      .from('users')
      .update({
        company_id: ctx.companyId,
        role_id: params.roleId,
        position: params.position || 'Сотрудник',
        role: 'manager',
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.userId);

    if (userError) {
      return { success: false, error: `Ошибка принятия сотрудника: ${userError.message}` };
    }

    // 2. Если есть requestId, обновляем статус в company_join_requests
    if (params.requestId) {
      await adminSupabase
        .from('company_join_requests')
        .update({
          status: 'approved',
          reviewed_by: ctx.userId,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.requestId);
    } else {
      // Иначе закрываем любые открытые заявки этого пользователя в эту компанию
      await adminSupabase
        .from('company_join_requests')
        .update({
          status: 'approved',
          reviewed_by: ctx.userId,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', params.userId)
        .eq('company_id', ctx.companyId)
        .eq('status', 'pending');
    }

    // 3. Отправляем Telegram-уведомление сотруднику (если у него привязан бот)
    const { data: userConn } = await adminSupabase
      .from('telegram_connections')
      .select('telegram_chat_id')
      .eq('user_id', params.userId)
      .maybeSingle();

    if (userConn?.telegram_chat_id) {
      const { data: comp } = await adminSupabase
        .from('companies')
        .select('name')
        .eq('id', ctx.companyId)
        .single();

      const { data: roleData } = await adminSupabase
        .from('company_roles')
        .select('name')
        .eq('id', params.roleId)
        .single();

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://buhuchet.kg';
      const msg =
        `🎉 **Ваша заявка на вступление одобрена!**\n\n` +
        `🏢 **Организация:** ${comp?.name || 'Компания'}\n` +
        `💼 **Должность:** ${params.position || 'Сотрудник'}\n` +
        `🛡️ **Назначенная роль:** ${roleData?.name || 'Менеджер'}\n\n` +
        `Ваша рабочая область разблокирована. Вы можете приступать к работе!\n\n` +
        `🔗 **Войти в систему:**\n${baseUrl}/dashboard`;

      await sendTelegramMessage(userConn.telegram_chat_id, msg);
    }

    revalidatePath('/dashboard/employees');
    revalidatePath('/dashboard/pending');
    revalidatePath('/dashboard');
    return { success: true, data: { message: 'Сотрудник успешно зачислен в штат компании' } };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой утверждения заявки' };
  }
}

/**
 * 4. Отклонение заявки сотрудника
 */
export async function rejectEmployeeRequestAction(params: {
  userId: string;
  requestId?: string;
  reason?: string;
}): Promise<ActionResponse<{ message: string }>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || (ctx.role !== 'owner' && !ctx.isSuperAdmin)) {
      return { success: false, error: 'Отклонять заявки может только Владелец компании' };
    }

    const adminSupabase = await createAdminClient();

    // 1. Очищаем привязку в users, если она была установлена
    await adminSupabase
      .from('users')
      .update({
        company_id: null,
        position: null,
        role_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.userId)
      .eq('company_id', ctx.companyId)
      .is('role_id', null);

    // 2. Обновляем статус в company_join_requests
    if (params.requestId) {
      await adminSupabase
        .from('company_join_requests')
        .update({
          status: 'rejected',
          reviewed_by: ctx.userId,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.requestId);
    } else {
      await adminSupabase
        .from('company_join_requests')
        .update({
          status: 'rejected',
          reviewed_by: ctx.userId,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', params.userId)
        .eq('company_id', ctx.companyId)
        .eq('status', 'pending');
    }

    // 3. Отправляем Telegram-уведомление сотруднику (если есть привязка)
    const { data: userConn } = await adminSupabase
      .from('telegram_connections')
      .select('telegram_chat_id')
      .eq('user_id', params.userId)
      .maybeSingle();

    if (userConn?.telegram_chat_id) {
      const { data: comp } = await adminSupabase
        .from('companies')
        .select('name')
        .eq('id', ctx.companyId)
        .single();

      const reasonStr = params.reason ? `\n💬 **Причина:** _${params.reason}_\n` : '';
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://buhuchet.kg';
      const msg =
        `❌ **Заявка на вступление отклонена**\n\n` +
        `🏢 **Организация:** ${comp?.name || 'Компания'}${reasonStr}\n` +
        `Вы можете найти другую организацию в панели поиска:\n\n` +
        `🔗 **Подать новую заявку:**\n${baseUrl}/dashboard/pending`;

      await sendTelegramMessage(userConn.telegram_chat_id, msg);
    }

    revalidatePath('/dashboard/employees');
    revalidatePath('/dashboard/pending');
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
    if (ctx.companyId) {
      revalidateTag(`company:${ctx.companyId}:roles`);
    } else {
      revalidateTag('company-roles');
    }
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
    if (ctx.companyId) {
      revalidateTag(`company:${ctx.companyId}:roles`);
    } else {
      revalidateTag('company-roles');
    }
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
    if (ctx.companyId) {
      revalidateTag(`company:${ctx.companyId}:roles`);
    } else {
      revalidateTag('company-roles');
    }
    return { success: true, data: { message: 'Роль успешно удалена' } };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой удаления роли' };
  }
}

/**
 * Получение подробной информации о сотруднике для формы просмотра
 */
export const getEmployeeDetailsAction = createSafeAction(
  z.object({ employeeId: z.string().uuid() }),
  async ({ employeeId }, ctx) => {
    const adminSupabase = await createAdminClient();

    const { data: employee, error } = await adminSupabase
      .from('users')
      .select('*, company_roles(*), companies:companies!company_id(*), telegram_connections(*)')
      .eq('id', employeeId)
      .single();

    if (error || !employee) {
      return { success: false, error: 'Сотрудник не найден в системе' };
    }

    if (employee.company_id !== ctx.companyId && !ctx.isSuperAdmin) {
      return { success: false, error: 'Доступ к карточке сотрудника запрещен' };
    }

    return {
      success: true,
      data: employee,
    };
  }
);
