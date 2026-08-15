'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { ActionResponse, Company } from '@/types/database.types';
import type { CompanyProfileStats, ClosedPeriod, ClosedPeriodItem, YearClosedPeriodsSummary } from '@/types/company.types';
import { revalidatePath, revalidateTag } from 'next/cache';
import { validateKyrgyzINN } from '@/lib/validators/inn';
import { hasPermission, requirePermission } from '@/lib/auth/permissions';

/**
 * Получение агрегированной статистики профиля компании
 */
export async function getCompanyProfileStatsAction(
  targetCompanyId?: string
): Promise<ActionResponse<CompanyProfileStats>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const { data: prof } = await supabase
      .from('users')
      .select('company_id, is_super_admin')
      .eq('id', user.id)
      .single();

    const companyId = targetCompanyId || prof?.company_id;

    if (!companyId) {
      return { success: false, error: 'Организация не указана' };
    }

    const adminSupabase = await createAdminClient();

    const [filesRes, docsRes, counterpartiesRes, employeesRes] = await Promise.all([
      adminSupabase.from('files').select('id, size_bytes').eq('company_id', companyId),
      adminSupabase.from('documents').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      adminSupabase
        .from('company_partnerships')
        .select('id', { count: 'exact', head: true })
        .or(`requester_company_id.eq.${companyId},target_company_id.eq.${companyId}`)
        .eq('status', 'accepted'),
      adminSupabase.from('users').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    ]);

    const filesData = filesRes.data || [];
    const storageUsedBytes = filesData.reduce((acc, f) => acc + (Number(f.size_bytes) || 0), 0);

    const stats: CompanyProfileStats = {
      totalFiles: filesData.length,
      totalDocuments: docsRes.count || 0,
      totalCounterparties: counterpartiesRes.count || 0,
      totalEmployees: employeesRes.count || 0,
      storageUsedBytes,
    };

    return { success: true, data: stats };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Ошибка подсчета статистики';
    return { success: false, error: msg };
  }
}

/**
 * Обновление реквизитов организации (Строгая валидация прав Владельца)
 */
export async function updateCompanyProfileAction(
  companyId: string,
  data: Partial<Company>
): Promise<ActionResponse<Company>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const { data: prof } = await supabase
      .from('users')
      .select('company_id, role, is_super_admin')
      .eq('id', user.id)
      .single();

    if (!prof?.company_id || prof.company_id !== companyId) {
      if (!prof?.is_super_admin) {
        return { success: false, error: 'Вы не привязаны к этой организации' };
      }
    }

    // Жесткое ограничение: Изменять профиль может ТОЛЬКО Владелец компании (или суперадмин)
    if (prof.role !== 'owner' && !prof.is_super_admin) {
      return {
        success: false,
        error: 'Доступ запрещен: Изменять профиль организации может только её владелец.',
      };
    }

    const adminSupabase = await createAdminClient();

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.legal_form !== undefined) updatePayload.legal_form = data.legal_form;
    if (data.inn !== undefined) {
      const innValidation = validateKyrgyzINN(data.inn);
      if (!innValidation.isValid) {
        return { success: false, error: innValidation.error || 'Некорректный ИНН Кыргызской Республики' };
      }
      updatePayload.inn = data.inn;
    }
    if (data.okpo !== undefined) updatePayload.okpo = data.okpo;
    if (data.industry !== undefined) updatePayload.industry = data.industry;
    if (data.director_name !== undefined) updatePayload.director_name = data.director_name;
    if (data.phone !== undefined) updatePayload.phone = data.phone;
    if (data.email !== undefined) updatePayload.email = data.email;
    if (data.legal_address !== undefined) updatePayload.legal_address = data.legal_address;
    if (data.address !== undefined) updatePayload.address = data.address;
    if (data.checking_account !== undefined) updatePayload.checking_account = data.checking_account;
    if (data.bic !== undefined) updatePayload.bic = data.bic;
    if (data.bank_name !== undefined) updatePayload.bank_name = data.bank_name;
    if (data.corr_account !== undefined) updatePayload.corr_account = data.corr_account;
    if (data.currency !== undefined) updatePayload.currency = data.currency;
    if (data.privacy_settings !== undefined) updatePayload.privacy_settings = data.privacy_settings;

    const { data: updated, error } = await adminSupabase
      .from('companies')
      .update(updatePayload)
      .eq('id', companyId)
      .select('*')
      .single();

    if (error || !updated) {
      return { success: false, error: error?.message || 'Ошибка обновления профиля' };
    }

    revalidatePath('/uchet/company');
    return { success: true, data: updated as Company };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой обновления' };
  }
}

/**
 * Обновление даты закрытия месяца/периода организации
 */
export async function updateClosedPeriodAction(
  closedPeriodUntil: string | null
): Promise<ActionResponse<Company>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const { data: prof } = await supabase
      .from('users')
      .select('company_id, role, is_super_admin')
      .eq('id', user.id)
      .single();

    if (!prof?.company_id && !prof?.is_super_admin) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    if (prof.role !== 'owner' && !prof.is_super_admin) {
      return { success: false, error: 'Право закрытия периода доступно только Руководителю компании' };
    }

    const adminSupabase = await createAdminClient();
    const { data: updatedCompany, error } = await adminSupabase
      .from('companies')
      .update({
        closed_period_until: closedPeriodUntil ? closedPeriodUntil : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', prof.company_id)
      .select('*')
      .single();

    if (error || !updatedCompany) {
      return { success: false, error: `Ошибка сохранения закрытия периода: ${error?.message}` };
    }

    revalidatePath('/uchet/company');
    revalidatePath('/uchet/documents');
    return { success: true, data: updatedCompany as Company };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Сбой при фиксации даты закрытия периода';
    return { success: false, error: msg };
  }
}

/**
 * Обновление ОПФ, реквизитов и настроек приватности компании
 */
export async function updateCompanyPrivacyAndDetailsAction(params: {
  legalForm?: string;
  phone?: string;
  email?: string;
  address?: string;
  privacySettings?: { show_phone: boolean; show_email: boolean; show_address: boolean };
}): Promise<ActionResponse<Company>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { success: false, error: 'Пользователь не авторизован' };

    const { data: prof } = await supabase
      .from('users')
      .select('company_id, role, is_super_admin')
      .eq('id', user.id)
      .single();

    if (!prof?.company_id) return { success: false, error: 'Пользователь не привязан к компании' };

    const adminSupabase = await createAdminClient();
    const updatePayload: Record<string, any> = { updated_at: new Date().toISOString() };

    if (params.legalForm) updatePayload.legal_form = params.legalForm;
    if (params.phone !== undefined) updatePayload.phone = params.phone;
    if (params.email !== undefined) updatePayload.email = params.email;
    if (params.address !== undefined) updatePayload.address = params.address;
    if (params.privacySettings) updatePayload.privacy_settings = params.privacySettings;

    const { data: updated, error } = await adminSupabase
      .from('companies')
      .update(updatePayload)
      .eq('id', prof.company_id)
      .select('*')
      .single();

    if (error || !updated) return { success: false, error: error?.message || 'Ошибка обновления' };

    revalidatePath('/uchet/company');
    revalidateTag('companies-catalog');
    return { success: true, data: updated as Company };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой обновления' };
  }
}

/**
 * Получение полной карточки компании и профиля текущего пользователя
 */
export async function getCompanyProfileDataAction(): Promise<
  ActionResponse<{ company: Company; userProfile: any }>
> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const adminSupabase = await createAdminClient();

    const { data: userProfile, error: userErr } = await adminSupabase
      .from('users')
      .select('*, company_roles(*)')
      .eq('id', user.id)
      .single();

    if (userErr || !userProfile) {
      return { success: false, error: 'Профиль пользователя не найден' };
    }

    if (!userProfile.company_id) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    const { data: company, error: compErr } = await adminSupabase
      .from('companies')
      .select('*')
      .eq('id', userProfile.company_id)
      .single();

    if (compErr || !company) {
      return { success: false, error: 'Данные организации не найдены' };
    }

    return {
      success: true,
      data: {
        company: company as Company,
        userProfile,
      },
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой загрузки данных компании' };
  }
}

const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

/**
 * Получение списка закрытых периодов компании за выбранный год
 */
export async function getCompanyClosedPeriodsAction(
  selectedYear: number
): Promise<ActionResponse<YearClosedPeriodsSummary>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const adminSupabase = await createAdminClient();
    const { data: userProfile } = await adminSupabase
      .from('users')
      .select('*, company_roles(*)')
      .eq('id', user.id)
      .maybeSingle();

    if (!userProfile?.company_id) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    // Проверка прав на просмотр закрытых периодов
    if (!hasPermission(userProfile, 'company', 'periods_view') && !hasPermission(userProfile, 'company', 'tab_periods')) {
      return { success: false, error: '403 Forbidden: Нет доступа к журналу закрытых периодов' };
    }

    // Запрашиваем записи закрытия за выбранный год
    const { data: dbRecords } = await adminSupabase
      .from('company_closed_periods')
      .select('*, closed_by_user:users!closed_by(full_name, email), opened_by_user:users!opened_by(full_name, email)')
      .eq('company_id', userProfile.company_id)
      .eq('year', selectedYear);

    const recordMap = new Map<number, any>();
    if (dbRecords) {
      dbRecords.forEach((r) => recordMap.set(r.month, r));
    }

    const periods: ClosedPeriodItem[] = [];
    let closedCount = 0;

    for (let m = 1; m <= 12; m++) {
      const rec = recordMap.get(m);
      const isDocLocked = rec ? (rec.lock_documents ?? (rec.status === 'closed')) : false;
      const isFileLocked = rec ? (rec.lock_files ?? (rec.status === 'closed')) : false;
      
      let computedStatus: 'open' | 'partial' | 'closed' = 'open';
      if (isDocLocked && isFileLocked) {
        computedStatus = 'closed';
        closedCount++;
      } else if (isDocLocked || isFileLocked) {
        computedStatus = 'partial';
      }

      const closedByUser = rec?.closed_by_user
        ? rec.closed_by_user.full_name || rec.closed_by_user.email
        : null;
      const openedByUser = rec?.opened_by_user
        ? rec.opened_by_user.full_name || rec.opened_by_user.email
        : null;

      periods.push({
        id: rec?.id,
        year: selectedYear,
        month: m,
        monthName: MONTH_NAMES_RU[m - 1],
        status: computedStatus,
        lock_documents: isDocLocked,
        lock_files: isFileLocked,
        closed_at: rec?.closed_at || null,
        closed_by_user: closedByUser,
        opened_at: rec?.opened_at || null,
        opened_by_user: openedByUser,
        comment: rec?.comment || rec?.reason || null,
        reason: rec?.reason || rec?.comment || null,
      });
    }

    return {
      success: true,
      data: {
        year: selectedYear,
        totalMonths: 12,
        closedCount,
        openCount: 12 - closedCount,
        periods,
      },
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой получения журнала закрытых периодов' };
  }
}

/**
 * Получение всех записей закрытых периодов для UnifiedDataGrid
 */
export async function getAllClosedPeriodsAction(): Promise<ActionResponse<ClosedPeriod[]>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const adminSupabase = await createAdminClient();
    const { data: userProfile } = await adminSupabase
      .from('users')
      .select('*, company_roles(*)')
      .eq('id', user.id)
      .maybeSingle();

    if (!userProfile?.company_id) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    if (!hasPermission(userProfile, 'company', 'periods_view') && !hasPermission(userProfile, 'company', 'tab_periods')) {
      return { success: false, error: '403 Forbidden: Нет доступа к журналу закрытых периодов' };
    }

    const { data: dbRecords, error: fetchErr } = await adminSupabase
      .from('company_closed_periods')
      .select('*, closed_by_user:users!closed_by(full_name, email)')
      .eq('company_id', userProfile.company_id)
      .order('year', { ascending: false })
      .order('month', { ascending: false });

    if (fetchErr) {
      return { success: false, error: `Ошибка загрузки периодов: ${fetchErr.message}` };
    }

    const result: ClosedPeriod[] = (dbRecords || []).map((r) => {
      const isDoc = r.lock_documents ?? (r.status === 'closed');
      const isFile = r.lock_files ?? (r.status === 'closed');
      const status: 'open' | 'partial' | 'closed' = isDoc && isFile ? 'closed' : isDoc || isFile ? 'partial' : 'open';

      return {
        id: r.id,
        company_id: r.company_id,
        year: r.year,
        month: r.month,
        monthName: MONTH_NAMES_RU[r.month - 1],
        lock_documents: isDoc,
        lock_files: isFile,
        status,
        reason: r.reason || r.comment,
        comment: r.comment || r.reason,
        closed_by: r.closed_by,
        closed_by_user: r.closed_by_user ? r.closed_by_user.full_name || r.closed_by_user.email : null,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
    });

    return { success: true, data: result };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой получения журнала закрытых периодов' };
  }
}

/**
 * Сохранение / Создание закрытого периода с гранулярными флагами
 */
export async function saveClosedPeriodAction(params: {
  year: number;
  month: number;
  lockDocuments: boolean;
  lockFiles: boolean;
  reason?: string;
}): Promise<ActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const adminSupabase = await createAdminClient();
    const { data: userProfile } = await adminSupabase
      .from('users')
      .select('*, company_roles(*)')
      .eq('id', user.id)
      .maybeSingle();

    if (!userProfile?.company_id && !userProfile?.is_super_admin) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    if (!hasPermission(userProfile, 'company', 'periods_manage')) {
      return {
        success: false,
        error: '403 Forbidden: Управление закрытием периодов доступно только Руководителю или Главному Бухгалтеру',
      };
    }

    const isAllLocked = params.lockDocuments && params.lockFiles;
    const isAnyLocked = params.lockDocuments || params.lockFiles;
    const status = isAllLocked ? 'closed' : isAnyLocked ? 'partial' : 'open';

    const payload: Record<string, any> = {
      company_id: userProfile.company_id,
      year: params.year,
      month: params.month,
      lock_documents: params.lockDocuments,
      lock_files: params.lockFiles,
      status,
      reason: params.reason ? params.reason.trim() : null,
      comment: params.reason ? params.reason.trim() : null,
      closed_by: user.id,
      closed_at: isAnyLocked ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await adminSupabase
      .from('company_closed_periods')
      .upsert(payload, { onConflict: 'company_id,year,month' });

    if (error) {
      return { success: false, error: `Ошибка сохранения периода: ${error.message}` };
    }

    revalidatePath('/uchet/company');
    revalidatePath('/uchet/documents');
    revalidatePath('/uchet/files');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой сохранения периода' };
  }
}

/**
 * Полное открытие периода (снятие всех блокировок)
 */
export async function reopenFullPeriodAction(params: {
  year: number;
  month: number;
  reason?: string;
}): Promise<ActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const adminSupabase = await createAdminClient();
    const { data: userProfile } = await adminSupabase
      .from('users')
      .select('*, company_roles(*)')
      .eq('id', user.id)
      .maybeSingle();

    if (!userProfile?.company_id && !userProfile?.is_super_admin) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    if (!hasPermission(userProfile, 'company', 'periods_manage')) {
      return {
        success: false,
        error: '403 Forbidden: Управление закрытием периодов доступно только Руководителю или Главному Бухгалтеру',
      };
    }

    const { error } = await adminSupabase
      .from('company_closed_periods')
      .delete()
      .eq('company_id', userProfile.company_id)
      .eq('year', params.year)
      .eq('month', params.month);

    if (error) {
      return { success: false, error: `Ошибка открытия периода: ${error.message}` };
    }

    revalidatePath('/uchet/company');
    revalidatePath('/uchet/documents');
    revalidatePath('/uchet/files');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой открытия периода' };
  }
}

/**
 * Точечное переключение блокировки конкретного модуля (Документооборот / Файлы)
 */
export async function toggleModuleLockAction(params: {
  year: number;
  month: number;
  moduleKey: 'documents' | 'files';
  isLocked: boolean;
}): Promise<ActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const adminSupabase = await createAdminClient();
    const { data: userProfile } = await adminSupabase
      .from('users')
      .select('*, company_roles(*)')
      .eq('id', user.id)
      .maybeSingle();

    if (!userProfile?.company_id && !userProfile?.is_super_admin) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    if (!hasPermission(userProfile, 'company', 'periods_manage')) {
      return {
        success: false,
        error: '403 Forbidden: Управление закрытием периодов доступно только Руководителю или Главному Бухгалтеру',
      };
    }

    // Получаем текущую запись периода
    const { data: existing } = await adminSupabase
      .from('company_closed_periods')
      .select('*')
      .eq('company_id', userProfile.company_id)
      .eq('year', params.year)
      .eq('month', params.month)
      .maybeSingle();

    const currentDocLock = existing ? (existing.lock_documents ?? (existing.status === 'closed')) : false;
    const currentFileLock = existing ? (existing.lock_files ?? (existing.status === 'closed')) : false;

    const newDocLock = params.moduleKey === 'documents' ? params.isLocked : currentDocLock;
    const newFileLock = params.moduleKey === 'files' ? params.isLocked : currentFileLock;

    const status = newDocLock && newFileLock ? 'closed' : newDocLock || newFileLock ? 'partial' : 'open';

    const { error } = await adminSupabase
      .from('company_closed_periods')
      .upsert(
        {
          company_id: userProfile.company_id,
          year: params.year,
          month: params.month,
          lock_documents: newDocLock,
          lock_files: newFileLock,
          status,
          closed_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_id,year,month' }
      );

    if (error) {
      return { success: false, error: `Ошибка переключения блокировки: ${error.message}` };
    }

    revalidatePath('/uchet/company');
    revalidatePath('/uchet/documents');
    revalidatePath('/uchet/files');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой переключения модуля' };
  }
}

/**
 * Переключение статуса закрытия периода (Совместимость со старыми вызовами)
 */
export async function toggleCompanyClosedPeriodAction(params: {
  year: number;
  month: number;
  targetStatus: 'open' | 'closed';
  comment?: string;
}): Promise<ActionResponse> {
  const isClose = params.targetStatus === 'closed';
  return saveClosedPeriodAction({
    year: params.year,
    month: params.month,
    lockDocuments: isClose,
    lockFiles: isClose,
    reason: params.comment,
  });
}
