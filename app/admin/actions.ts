'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { requireSuperAdminSession } from '@/lib/auth/server-context';
import { deleteR2ObjectsBatch } from '@/lib/r2';
import type { ActionResponse, Company, CompanyStatus, Document, FileCategory, LandingPricingPlan } from '@/types/database.types';
import { revalidatePath, unstable_cache } from 'next/cache';
import { z } from 'zod';
import { createSafeAction } from '@/lib/auth/safe-action';
import { sendCompanyVerificationTelegramNotification } from '@/lib/telegram/notifier';
import { formatBytes } from '@/lib/utils';

/**
 * Проверка прав суперадмина через централизованный серверный контекст
 */
async function checkSuperAdmin() {
  try {
    await requireSuperAdminSession();
    return true;
  } catch {
    return false;
  }
}

// -------------------------------------------------------------
// 1. УПРАВЛЕНИЕ ОРГАНИЗАЦИЯМИ (COMPANIES)
// -------------------------------------------------------------

/**
 * Получение полного профиля и статистики любой компании для суперадминистратора
 */
export async function getSuperAdminCompanyDetailsAction(companyId: string) {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();

    const { data: company, error } = await adminSupabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single();

    if (error || !company) {
      return { success: false, error: 'Организация не найдена' };
    }

    const { data: owner } = await adminSupabase
      .from('users')
      .select('full_name, email, phone')
      .eq('company_id', companyId)
      .eq('role', 'owner')
      .maybeSingle();

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

    return {
      success: true,
      data: {
        company: company as Company,
        owner: owner || null,
        stats: {
          totalFiles: filesData.length,
          totalDocuments: docsRes.count || 0,
          totalCounterparties: counterpartiesRes.count || 0,
          totalEmployees: employeesRes.count || 0,
          storageUsedBytes,
        },
      },
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой получения данных' };
  }
}

export async function getPendingCompaniesAction(): Promise<ActionResponse<Company[]>> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();
    const { data, error } = await adminSupabase
      .from('companies')
      .select('*')
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: false });

    if (error) return { success: false, error: error.message };
    return { success: true, data: data as Company[] };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой загрузки заявок' };
  }
}

export async function getAllCompaniesAdminAction(): Promise<ActionResponse<Company[]>> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();
    const { data, error } = await adminSupabase
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return { success: false, error: error.message };
    return { success: true, data: data as Company[] };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой загрузки списка всех компаний' };
  }
}

export async function createCompanyAdminAction(data: {
  name: string;
  inn: string;
  industry?: string;
  director_name?: string;
  email?: string;
  phone?: string;
  legal_address?: string;
  status?: CompanyStatus;
}): Promise<ActionResponse<Company>> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();
    const { data: comp, error } = await adminSupabase
      .from('companies')
      .insert({
        name: data.name,
        inn: data.inn,
        industry: data.industry || 'Услуги / Консалтинг',
        director_name: data.director_name || null,
        email: data.email || null,
        phone: data.phone || null,
        legal_address: data.legal_address || null,
        status: data.status || 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !comp) return { success: false, error: error?.message || 'Ошибка создания компании' };

    revalidatePath('/admin');
    return { success: true, data: comp as Company };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой при создании организации' };
  }
}

export async function approveCompanyAction(companyId: string): Promise<ActionResponse> {
  try {
    const adminSession = await requireSuperAdminSession();
    const adminSupabase = await createAdminClient();

    const { data: comp } = await adminSupabase
      .from('companies')
      .select('name')
      .eq('id', companyId)
      .single();

    const { error: rpcErr } = await adminSupabase.rpc('admin_approve_company_atomic', {
      p_company_id: companyId,
      p_admin_id: adminSession.userId,
    });

    if (rpcErr) {
      return { success: false, error: `Сбой активации компании: ${rpcErr.message}` };
    }

    sendCompanyVerificationTelegramNotification({
      companyId,
      companyName: comp?.name || 'Организация',
      status: 'active',
    }).catch((err) => console.error('[Telegram Notification Error]:', err));

    revalidatePath('/admin');
    revalidatePath('/admin/companies');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой одобрения компании' };
  }
}

export async function requestCompanyChangesAction(
  companyId: string,
  comment: string
): Promise<ActionResponse> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();
    const { data: comp } = await adminSupabase
      .from('companies')
      .select('name')
      .eq('id', companyId)
      .single();

    const { error } = await adminSupabase
      .from('companies')
      .update({
        status: 'requires_changes',
        moderation_comment: comment,
        updated_at: new Date().toISOString(),
      })
      .eq('id', companyId);

    if (error) return { success: false, error: error.message };

    sendCompanyVerificationTelegramNotification({
      companyId,
      companyName: comp?.name || 'Организация',
      status: 'requires_changes',
      comment,
    }).catch((err) => console.error('[Telegram Notification Error]:', err));

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой запроса изменений' };
  }
}

export async function blockCompanyAction(
  companyId: string,
  comment: string
): Promise<ActionResponse> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();
    const { data: comp } = await adminSupabase
      .from('companies')
      .select('name')
      .eq('id', companyId)
      .single();

    const { error } = await adminSupabase
      .from('companies')
      .update({
        status: 'blocked',
        moderation_comment: comment,
        updated_at: new Date().toISOString(),
      })
      .eq('id', companyId);

    if (error) return { success: false, error: error.message };

    sendCompanyVerificationTelegramNotification({
      companyId,
      companyName: comp?.name || 'Организация',
      status: 'blocked',
      comment,
    }).catch((err) => console.error('[Telegram Notification Error]:', err));

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой блокировки компании' };
  }
}

export async function updateCompanyAdminAction(
  companyId: string,
  updates: Partial<Company>
): Promise<ActionResponse> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();
    const { error } = await adminSupabase
      .from('companies')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', companyId);

    if (error) return { success: false, error: error.message };

    revalidatePath('/admin');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой при обновлении организации' };
  }
}

// -------------------------------------------------------------
// 2. УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ (USERS)
// -------------------------------------------------------------

export async function getAllUsersAdminAction(): Promise<ActionResponse<any[]>> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();

    // 1. Попытка запроса с явным указанием внешнего ключа users_company_id_fkey
    const { data: usersData, error: usersErr } = await adminSupabase
      .from('users')
      .select('*, company:companies!users_company_id_fkey(*)')
      .order('created_at', { ascending: false });

    if (usersErr) {
      console.error('[getAllUsersAdminAction join error]:', usersErr);

      // 2. Гарантированный fallback-запрос безJOIN в PostgREST при сбоях
      const { data: rawUsers, error: rawUsersErr } = await adminSupabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

      if (rawUsersErr) {
        return { success: false, error: rawUsersErr.message };
      }

      const compIds = Array.from(new Set(rawUsers.map((u) => u.company_id).filter(Boolean)));
      let companyMap: Record<string, any> = {};
      if (compIds.length > 0) {
        const { data: comps } = await adminSupabase
          .from('companies')
          .select('id, name, inn')
          .in('id', compIds);
        if (comps) {
          comps.forEach((c) => {
            companyMap[c.id] = c;
          });
        }
      }

      const fallbackUsers = rawUsers.map((u) => ({
        ...u,
        company: u.company_id ? companyMap[u.company_id] || null : null,
        companies: u.company_id ? companyMap[u.company_id] || null : null,
      }));

      return { success: true, data: fallbackUsers };
    }

    // Нормализация результатов для одинакового доступа u.companies и u.company
    const normalized = (usersData || []).map((u: any) => {
      const compObj = Array.isArray(u.company)
        ? u.company[0]
        : u.company || (Array.isArray(u.companies) ? u.companies[0] : u.companies) || null;
      return {
        ...u,
        company: compObj,
        companies: compObj,
      };
    });

    return { success: true, data: normalized };
  } catch (err: unknown) {
    console.error('[getAllUsersAdminAction exception]:', err);
    return { success: false, error: 'Сбой получения списка пользователей' };
  }
}

export async function updateUserAdminAction(
  userId: string,
  updates: {
    full_name?: string;
    email?: string;
    role?: 'owner' | 'accountant' | 'manager';
    company_id?: string | null;
    is_super_admin?: boolean;
  }
): Promise<ActionResponse> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();
    const { error } = await adminSupabase
      .from('users')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (error) return { success: false, error: error.message };

    revalidatePath('/admin');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой обновления профиля пользователя' };
  }
}

export async function deleteUserAdminAction(userId: string): Promise<ActionResponse> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();
    const { error } = await adminSupabase.from('users').delete().eq('id', userId);

    if (error) return { success: false, error: error.message };

    revalidatePath('/admin');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой при удалении пользователя' };
  }
}

/**
 * Административный сброс пароля пользователя с прямой синхронизацией Supabase Auth
 */
export async function resetUserPasswordAdminAction(
  userId: string,
  newPassword?: string
): Promise<ActionResponse<{ newPassword: string }>> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const passwordToSet =
      newPassword && newPassword.trim().length >= 6
        ? newPassword.trim()
        : Math.random().toString(36).substring(2, 10) + '!' + Math.floor(Math.random() * 90 + 10);

    const adminSupabase = await createAdminClient();

    // 1. Смена пароля учетной записи в Supabase Auth (GoTrue) через Service Role API
    const { error: authErr } = await adminSupabase.auth.admin.updateUserById(userId, {
      password: passwordToSet,
    });

    if (authErr) {
      return { success: false, error: `Ошибка сброса пароля в Auth: ${authErr.message}` };
    }

    // 2. Установка флага обязательной смены пароля при следующем входе
    await adminSupabase
      .from('users')
      .update({
        must_change_password: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    revalidatePath('/admin');
    return { success: true, data: { newPassword: passwordToSet } };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой операции сброса пароля';
    return { success: false, error: errorMsg };
  }
}

// -------------------------------------------------------------
// 3. УПРАВЛЕНИЕ ВСЕМИ B2B ДОКУМЕНТАМИ (DOCUMENTS)
// -------------------------------------------------------------

export async function getAllDocumentsAdminAction(): Promise<ActionResponse<any[]>> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();
    const { data: rawDocs, error } = await adminSupabase
      .from('documents')
      .select('*, sender_company:companies!sender_company_id(name), receiver_company:companies!receiver_company_id(name), counterparties(name), users:users!author_id(full_name, email)')
      .order('created_at', { ascending: false });

    if (error) return { success: false, error: error.message };

    // Трансформируем объекты для гарантированного отображения в UnifiedDataGrid
    const docs = (rawDocs || []).map((doc: any) => ({
      ...doc,
      company_name: doc.sender_company?.name || doc.receiver_company?.name || 'Организация не указана',
      counterparty_name: doc.counterparties?.name || '—',
      created_by_name: doc.users?.full_name || doc.users?.email || '—',
    }));

    return { success: true, data: docs };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой получения документов' };
  }
}

export async function updateDocumentAdminAction(
  docId: string,
  updates: Partial<Document>
): Promise<ActionResponse> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();
    const { error } = await adminSupabase
      .from('documents')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', docId);

    if (error) return { success: false, error: error.message };

    revalidatePath('/admin');
    revalidatePath('/uchet/documents');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой обновления документа' };
  }
}

export async function deleteDocumentAdminAction(docId: string): Promise<ActionResponse> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();
    const { error } = await adminSupabase.from('documents').delete().eq('id', docId);

    if (error) return { success: false, error: error.message };

    revalidatePath('/admin');
    revalidatePath('/uchet/documents');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой удаления документа' };
  }
}

// -------------------------------------------------------------
// 4. УПРАВЛЕНИЕ СПРАВОЧНИКАМИ (FILE CATEGORIES)
// -------------------------------------------------------------

export async function createFileCategoryAdminAction(
  name: string,
  code: string,
  description?: string
): Promise<ActionResponse<FileCategory>> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();
    const { data: cat, error } = await adminSupabase
      .from('file_categories')
      .insert({
        name,
        code,
        description: description || null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !cat) return { success: false, error: error?.message || 'Ошибка создания категории' };

    revalidatePath('/admin');
    return { success: true, data: cat as FileCategory };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой создания категории' };
  }
}

export async function updateFileCategoryAdminAction(
  catId: string,
  updates: Partial<FileCategory>
): Promise<ActionResponse> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();
    const { error } = await adminSupabase
      .from('file_categories')
      .update(updates)
      .eq('id', catId);

    if (error) return { success: false, error: error.message };

    revalidatePath('/admin');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой обновления категории' };
  }
}

export async function deleteFileCategoryAdminAction(catId: string): Promise<ActionResponse> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();
    const { error } = await adminSupabase.from('file_categories').delete().eq('id', catId);

    if (error) return { success: false, error: error.message };

    revalidatePath('/admin');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой удаления категории' };
  }
}

// -------------------------------------------------------------
// 5. МОДУЛЬ БАЗЫ ДАННЫХ (FULL ACCESS DATABASE INSPECTOR)
// -------------------------------------------------------------

const ALLOWED_INSPECTOR_TABLES = [
  'companies',
  'users',
  'documents',
  'files',
  'file_owners',
  'file_categories',
  'counterparties',
  'company_partnerships',
  'company_roles',
  'company_closed_periods',
  'subscriptions',
  'document_logs',
  'audit_logs',
  'pending_file_deletions',
  'telegram_connections',
  'telegram_logs',
  'telegram_verification_codes',
  'company_join_requests',
];

export async function inspectTableDataAdminAction(
  tableName: string,
  limit: number = 100
): Promise<ActionResponse<{ columns: string[]; rows: any[] }>> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    if (!ALLOWED_INSPECTOR_TABLES.includes(tableName)) {
      return { success: false, error: 'Указанная таблица недоступна для инспектора' };
    }

    const adminSupabase = await createAdminClient();
    const { data, error } = await adminSupabase
      .from(tableName as any)
      .select('*')
      .limit(limit);

    if (error) return { success: false, error: error.message };

    const rows = data || [];
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    return { success: true, data: { columns, rows } };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой инспектора БД' };
  }
}

export async function updateDbRowAdminAction(
  tableName: string,
  pkField: string,
  pkValue: any,
  updates: Record<string, any>
): Promise<ActionResponse> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    if (!ALLOWED_INSPECTOR_TABLES.includes(tableName)) {
      return { success: false, error: 'Таблица недоступна для редактирования' };
    }

    const adminSupabase = await createAdminClient();
    const { error } = await adminSupabase
      .from(tableName as any)
      .update(updates)
      .eq(pkField, pkValue);

    if (error) return { success: false, error: error.message };

    revalidatePath('/admin');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой обновления записи БД' };
  }
}

export async function deleteDbRowAdminAction(
  tableName: string,
  pkField: string,
  pkValue: any
): Promise<ActionResponse> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    if (!ALLOWED_INSPECTOR_TABLES.includes(tableName)) {
      return { success: false, error: 'Таблица недоступна для удаления' };
    }

    const adminSupabase = await createAdminClient();
    const { error } = await adminSupabase
      .from(tableName as any)
      .delete()
      .eq(pkField, pkValue);

    if (error) return { success: false, error: error.message };

    revalidatePath('/admin');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой удаления записи из БД' };
  }
}

/**
 * Мониторинг хранилища R2 и физических файлов CoW в Панели Суперадминистратора
 */
export async function getSuperAdminFilesMonitoringAction(): Promise<
  ActionResponse<{
    files: any[];
    stats: {
      totalPhysicalFilesCount: number;
      totalVirtualOwnersCount: number;
      totalPhysicalStorageBytes: number;
      savedStorageBytes: number;
      savedStorageFormatted: string;
      deduplicationSavingsPercent: string;
      topCompanies: Array<{ name: string; inn: string; filesCount: number; totalBytes: number; formattedSize: string }>;
    };
  }>
> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();

    // 1. Извлекаем все файлы
    const { data: rawFiles, error: filesErr } = await adminSupabase
      .from('files')
      .select('*, file_categories(*), companies:company_id(name, inn)')
      .order('created_at', { ascending: false });

    if (filesErr) return { success: false, error: filesErr.message };

    // 2. Извлекаем все записи file_owners с компаниями
    const { data: allOwners, error: ownersErr } = await adminSupabase
      .from('file_owners')
      .select('file_id, is_original_creator, companies:company_id(id, name, inn)');

    if (ownersErr) return { success: false, error: ownersErr.message };

    const ownersByFileMap = new Map<string, any[]>();
    const companyStorageMap = new Map<string, { name: string; inn: string; filesCount: number; totalBytes: number }>();

    (allOwners || []).forEach((o: any) => {
      const fId = o.file_id;
      const comp = Array.isArray(o.companies) ? o.companies[0] : o.companies;
      if (!ownersByFileMap.has(fId)) {
        ownersByFileMap.set(fId, []);
      }
      if (comp) {
        ownersByFileMap.get(fId)!.push({ ...comp, is_original_creator: o.is_original_creator });

        const compId = comp.id || comp.inn;
        if (!companyStorageMap.has(compId)) {
          companyStorageMap.set(compId, { name: comp.name || 'Компания', inn: comp.inn || '—', filesCount: 0, totalBytes: 0 });
        }
        const compStat = companyStorageMap.get(compId)!;
        compStat.filesCount++;
      }
    });

    let totalPhysicalStorageBytes = 0;
    let savedStorageBytes = 0;

    const files = (rawFiles || []).map((f: any) => {
      const fOwners = ownersByFileMap.get(f.id) || [];
      const ownersCount = fOwners.length || 1;
      const size = f.size_bytes || 0;

      totalPhysicalStorageBytes += size;
      if (ownersCount > 1) {
        savedStorageBytes += size * (ownersCount - 1);
      }

      const creatorComp = Array.isArray(f.companies) ? f.companies[0] : f.companies;
      if (creatorComp) {
        const cKey = creatorComp.id || creatorComp.inn;
        if (companyStorageMap.has(cKey)) {
          companyStorageMap.get(cKey)!.totalBytes += size;
        }
      }

      return {
        ...f,
        owners: fOwners,
        ownersCount,
        isCoWShared: ownersCount > 1,
      };
    });

    const totalPhysicalFilesCount = files.length;
    const totalVirtualOwnersCount = allOwners?.length || totalPhysicalFilesCount;
    const deduplicationSavingsPercent = totalVirtualOwnersCount > 0
      ? (((totalVirtualOwnersCount - totalPhysicalFilesCount) / totalVirtualOwnersCount) * 100).toFixed(1)
      : '0.0';

    const topCompanies = Array.from(companyStorageMap.values())
      .sort((a, b) => b.totalBytes - a.totalBytes)
      .slice(0, 10)
      .map((c) => ({ ...c, formattedSize: formatBytes(c.totalBytes) }));

    return {
      success: true,
      data: {
        files,
        stats: {
          totalPhysicalFilesCount,
          totalVirtualOwnersCount,
          totalPhysicalStorageBytes,
          savedStorageBytes,
          savedStorageFormatted: formatBytes(savedStorageBytes),
          deduplicationSavingsPercent,
          topCompanies,
        },
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Сбой мониторинга файлов';
    return { success: false, error: msg };
  }
}

/**
 * Получение системных деталей файла для суперадминистратора
 */
export const getSuperAdminFileDetailsAction = createSafeAction(
  z.object({ fileId: z.string().uuid() }),
  async ({ fileId }, ctx) => {
    if (!ctx.isSuperAdmin) {
      return { success: false, error: 'Доступ разрешен только Суперадминистратору' };
    }

    const adminSupabase = await createAdminClient();

    const { data: file, error } = await adminSupabase
      .from('files')
      .select('*, file_categories(*), companies:companies!company_id(name, inn)')
      .eq('id', fileId)
      .single();

    if (error || !file) {
      return { success: false, error: 'Файл не найден в системе' };
    }

    const { data: owners } = await adminSupabase
      .from('file_owners')
      .select('*, companies:companies!company_id(name, inn)')
      .eq('file_id', fileId);

    return {
      success: true,
      data: {
        ...file,
        owners: owners || [],
        ownersCount: owners?.length || 1,
      },
    };
  }
);

/**
 * Редактирование параметров файла суперадминистратором
 */
export const updateFileSuperAdminAction = createSafeAction(
  z.object({
    fileId: z.string().uuid(),
    fileName: z.string().min(1, 'Укажите название файла'),
    categoryId: z.string().uuid().nullable().optional(),
    description: z.string().optional(),
    comment: z.string().optional(),
  }),
  async ({ fileId, fileName, categoryId, description, comment }, ctx) => {
    if (!ctx.isSuperAdmin) {
      return { success: false, error: 'Доступ разрешен только Суперадминистратору' };
    }

    const adminSupabase = await createAdminClient();

    const { data: updated, error } = await adminSupabase
      .from('files')
      .update({
        file_name: fileName,
        category_id: categoryId || null,
        description: description || null,
        comment: comment || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', fileId)
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    // Аудит
    await adminSupabase.from('admin_audit_logs').insert({
      admin_id: ctx.userId,
      action: 'file_updated',
      target_type: 'file',
      target_id: fileId,
      details: { fileName, categoryId },
    });

    revalidatePath('/admin/files');
    return { success: true, data: updated };
  }
);

/**
 * Полное удаление файла суперадминистратором (БД + очередь очистки R2)
 */
export const deleteFileSuperAdminAction = createSafeAction(
  z.object({ fileId: z.string().uuid() }),
  async ({ fileId }, ctx) => {
    if (!ctx.isSuperAdmin) {
      return { success: false, error: 'Доступ разрешен только Суперадминистратору' };
    }

    const adminSupabase = await createAdminClient();

    // 1. Получаем путь к файлу
    const { data: file, error: fetchErr } = await adminSupabase
      .from('files')
      .select('id, file_name, file_path_r2')
      .eq('id', fileId)
      .maybeSingle();

    if (fetchErr || !file) {
      return { success: false, error: 'Файл не найден' };
    }

    // 2. Удаляем связи в file_owners
    await adminSupabase.from('file_owners').delete().eq('file_id', fileId);

    // 3. Удаляем запись из files
    const { error: delErr } = await adminSupabase.from('files').delete().eq('id', fileId);
    if (delErr) {
      return { success: false, error: delErr.message };
    }

    // 4. Добавляем в очередь удаления физического объекта из R2
    if (file.file_path_r2) {
      await adminSupabase.from('pending_file_deletions').insert({
        storage_key: file.file_path_r2,
        status: 'pending',
        attempts: 0,
      });
    }

    // 5. Аудит
    await adminSupabase.from('admin_audit_logs').insert({
      admin_id: ctx.userId,
      action: 'file_deleted',
      target_type: 'file',
      target_id: fileId,
      details: { file_name: file.file_name, storage_key: file.file_path_r2 },
    });

    revalidatePath('/admin/files');
    return { success: true };
  }
);

/**
 * Безопасное получение развернутых деталей компании для суперадминистратора
 */
export const getSuperAdminCompanyDetailsSafeAction = createSafeAction(
  z.object({ companyId: z.string().uuid() }),
  async ({ companyId }, ctx) => {
    if (!ctx.isSuperAdmin) {
      return { success: false, error: 'Доступ разрешен только Суперадминистратору' };
    }

    const adminSupabase = await createAdminClient();

    const { data: company, error } = await adminSupabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single();

    if (error || !company) {
      return { success: false, error: 'Организация не найдена' };
    }

    const { data: owner } = await adminSupabase
      .from('users')
      .select('full_name, email, phone, telegram_chat_id')
      .eq('company_id', companyId)
      .eq('role', 'owner')
      .maybeSingle();

    const [filesRes, docsRes, counterpartiesRes, employeesRes] = await Promise.all([
      adminSupabase.from('files').select('id, size_bytes').eq('company_id', companyId),
      adminSupabase.from('documents').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      adminSupabase
        .from('company_partnerships')
        .select('id', { count: 'exact', head: true })
        .or(`requester_company_id.eq.${companyId},target_company_id.eq.${companyId}`)
        .eq('status', 'accepted'),
      adminSupabase.from('users').select('id, full_name, email, role, is_active').eq('company_id', companyId),
    ]);

    const filesData = filesRes.data || [];
    const storageUsedBytes = filesData.reduce((acc, f) => acc + (Number(f.size_bytes) || 0), 0);

    return {
      success: true,
      data: {
        company: company as Company,
        owner: owner || null,
        employees: employeesRes.data || [],
        stats: {
          totalFiles: filesData.length,
          totalDocuments: docsRes.count || 0,
          totalCounterparties: counterpartiesRes.count || 0,
          totalEmployees: employeesRes.data?.length || 0,
          storageUsedBytes,
        },
      },
    };
  }
);

/**
 * Безопасное получение деталей пользователя для суперадминистратора
 */
export const getSuperAdminUserDetailsAction = createSafeAction(
  z.object({ userId: z.string().uuid() }),
  async ({ userId }, ctx) => {
    if (!ctx.isSuperAdmin) {
      return { success: false, error: 'Доступ разрешен только Суперадминистратору' };
    }

    const adminSupabase = await createAdminClient();

    const { data: user, error } = await adminSupabase
      .from('users')
      .select('*, companies:companies!company_id(id, name, inn, status)')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return { success: false, error: 'Пользователь не найден' };
    }

    return {
      success: true,
      data: user,
    };
  }
);

/**
 * Модульный SafeAction: Получение всех организаций для админки
 */
export const getCompaniesAdminAction = createSafeAction(
  z.object({}),
  async (_, ctx) => {
    if (!ctx.isSuperAdmin) {
      return { success: false, error: 'Доступ разрешен только Суперадминистратору' };
    }

    const adminSupabase = await createAdminClient();
    const { data, error } = await adminSupabase
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return { success: false, error: error.message };
    return { success: true, data: data as Company[] };
  }
);

/**
 * Модульный SafeAction: Получение всех пользователей для админки
 */
export const getUsersAdminAction = createSafeAction(
  z.object({}),
  async (_, ctx) => {
    if (!ctx.isSuperAdmin) {
      return { success: false, error: 'Доступ разрешен только Суперадминистратору' };
    }

    const adminSupabase = await createAdminClient();
    const { data, error } = await adminSupabase
      .from('users')
      .select('*, companies:companies!company_id(name, inn)')
      .order('created_at', { ascending: false });

    if (error) return { success: false, error: error.message };
    return { success: true, data: data || [] };
  }
);

/**
 * Модульный SafeAction: Статистика инспектора БД
 */
export const getInspectorStatsAdminAction = createSafeAction(
  z.object({}),
  async (_, ctx) => {
    if (!ctx.isSuperAdmin) {
      return { success: false, error: 'Доступ разрешен только Суперадминистратору' };
    }

    const adminSupabase = await createAdminClient();
    const [compRes, usersRes, docsRes, filesRes] = await Promise.all([
      adminSupabase.from('companies').select('id', { count: 'exact', head: true }),
      adminSupabase.from('users').select('id', { count: 'exact', head: true }),
      adminSupabase.from('documents').select('id', { count: 'exact', head: true }),
      adminSupabase.from('files').select('id, size_bytes'),
    ]);

    const totalFilesSize = (filesRes.data || []).reduce((acc, f) => acc + (Number(f.size_bytes) || 0), 0);

    return {
      success: true,
      data: {
        totalCompanies: compRes.count || 0,
        totalUsers: usersRes.count || 0,
        totalDocuments: docsRes.count || 0,
        totalFiles: filesRes.data?.length || 0,
        totalFilesSize,
      },
    };
  }
);

/**
 * Получение сводной аналитики платформы суперадмина (RPC + параллельный Promise.allSettled)
 */
export async function getPlatformSummaryStatsAction(): Promise<ActionResponse<any>> {
  try {
    await requireSuperAdminSession();
    const adminSupabase = await createAdminClient();

    // 1. Попытка вызова RPC
    const rpcRes = await adminSupabase.rpc('get_platform_summary_stats');
    if (!rpcRes.error && rpcRes.data) {
      return { success: true, data: rpcRes.data };
    }

    // 2. Резервная параллельная агрегация через Promise.allSettled
    const [companiesRes, pendingCompaniesRes, usersRes, filesRes, subsRes, docsRes] = await Promise.allSettled([
      adminSupabase.from('companies').select('id, status', { count: 'exact' }),
      adminSupabase.from('companies').select('id', { count: 'exact', head: true }).eq('status', 'pending_approval'),
      adminSupabase.from('users').select('id', { count: 'exact', head: true }),
      adminSupabase.from('files').select('size_bytes'),
      adminSupabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      adminSupabase.from('documents').select('id', { count: 'exact', head: true }),
    ]);

    const totalCompanies = companiesRes.status === 'fulfilled' ? companiesRes.value.count || 0 : 0;
    const pendingCompanies = pendingCompaniesRes.status === 'fulfilled' ? pendingCompaniesRes.value.count || 0 : 0;
    const activeCompanies = Math.max(0, totalCompanies - pendingCompanies);
    const totalUsers = usersRes.status === 'fulfilled' ? usersRes.value.count || 0 : 0;
    const totalDocs = docsRes.status === 'fulfilled' ? docsRes.value.count || 0 : 0;
    const activeSubs = subsRes.status === 'fulfilled' ? subsRes.value.count || 0 : 0;

    let storageUsed = 0;
    let totalFiles = 0;
    if (filesRes.status === 'fulfilled' && filesRes.value.data) {
      totalFiles = filesRes.value.data.length;
      storageUsed = filesRes.value.data.reduce((acc, f) => acc + (Number(f.size_bytes) || 0), 0);
    }

    const fallbackStats = {
      companies: { total: totalCompanies, active: activeCompanies, pending: pendingCompanies },
      users: { total: totalUsers },
      storage: { total_bytes: storageUsed, total_files: totalFiles },
      subscriptions: { active: activeSubs },
      documents: { total: totalDocs },
    };

    return { success: true, data: fallbackStats };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой получения статистики платформы' };
  }
}

/**
 * Обработка очереди физической очистки файлов R2
 */
export async function processStorageCleanupQueueAction(batchSize = 200): Promise<ActionResponse<{ processed: number; errors: string[] }>> {
  try {
    const adminSession = await requireSuperAdminSession();
    const adminSupabase = await createAdminClient();

    const { data: queueItems, error } = await adminSupabase
      .from('pending_file_deletions')
      .select('id, storage_key, attempts')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (error || !queueItems || queueItems.length === 0) {
      return { success: true, data: { processed: 0, errors: [] } };
    }

    const keys = queueItems.map((item) => item.storage_key).filter(Boolean);
    const { deletedCount, errors } = await deleteR2ObjectsBatch(keys);

    const ids = queueItems.map((item) => item.id);
    await adminSupabase
      .from('pending_file_deletions')
      .update({
        status: errors.length > 0 ? 'failed' : 'processed',
        processed_at: new Date().toISOString(),
        attempts: (queueItems[0].attempts || 0) + 1,
        error: errors.length > 0 ? errors.join('; ') : null,
      })
      .in('id', ids);

    // Запись аудита
    await adminSupabase.from('admin_audit_logs').insert({
      admin_id: adminSession.userId,
      action: 'storage_cleanup_processed',
      target_type: 'files',
      details: { processed: deletedCount, totalInBatch: queueItems.length, errors },
    });

    revalidatePath('/admin/files');
    return { success: true, data: { processed: deletedCount, errors } };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой очистки хранилища R2' };
  }
}

/**
 * Серверная пагинация организаций для суперадмина
 */
export async function getPaginatedCompaniesAdminAction(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
}): Promise<ActionResponse<{ companies: Company[]; total: number; page: number; pageSize: number }>> {
  try {
    await requireSuperAdminSession();
    const adminSupabase = await createAdminClient();

    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 25));
    const offset = (page - 1) * pageSize;

    let query = adminSupabase
      .from('companies')
      .select('*', { count: 'exact' });

    if (params.status && params.status !== 'all') {
      query = query.eq('status', params.status);
    }

    if (params.search && params.search.trim()) {
      const s = params.search.trim();
      query = query.or(`name.ilike.%${s}%,inn.ilike.%${s}%,director_name.ilike.%${s}%,email.ilike.%${s}%`);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        companies: (data || []) as Company[],
        total: count || 0,
        page,
        pageSize,
      },
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой выборки организаций' };
  }
}

/**
 * Серверная пагинация пользователей для суперадмина
 */
export async function getPaginatedUsersAdminAction(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  role?: string;
  companyId?: string;
}): Promise<ActionResponse<{ users: any[]; total: number; page: number; pageSize: number }>> {
  try {
    await requireSuperAdminSession();
    const adminSupabase = await createAdminClient();

    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 25));
    const offset = (page - 1) * pageSize;

    let query = adminSupabase
      .from('users')
      .select('*, company:companies(id, name, inn)', { count: 'exact' });

    if (params.role && params.role !== 'all') {
      query = query.eq('role', params.role);
    }

    if (params.companyId) {
      query = query.eq('company_id', params.companyId);
    }

    if (params.search && params.search.trim()) {
      const s = params.search.trim();
      query = query.or(`full_name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        users: data || [],
        total: count || 0,
        page,
        pageSize,
      },
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой выборки пользователей' };
  }
}

/**
 * Серверная пагинация файлов для суперадмина
 */
export async function getPaginatedFilesAdminAction(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  companyId?: string;
}): Promise<ActionResponse<{ files: any[]; total: number; page: number; pageSize: number }>> {
  try {
    await requireSuperAdminSession();
    const adminSupabase = await createAdminClient();

    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 25));
    const offset = (page - 1) * pageSize;

    let query = adminSupabase
      .from('files')
      .select('*, company:companies(id, name, inn), file_categories(name)', { count: 'exact' });

    if (params.companyId) {
      query = query.eq('company_id', params.companyId);
    }

    if (params.search && params.search.trim()) {
      const s = params.search.trim();
      query = query.or(`file_name.ilike.%${s}%,description.ilike.%${s}%`);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        files: data || [],
        total: count || 0,
        page,
        pageSize,
      },
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой выборки файлов' };
  }
}

/**
 * Получение всех подписок организаций для суперадминистратора
 */
export async function getAllSubscriptionsAdminAction(): Promise<ActionResponse<any[]>> {
  try {
    await requireSuperAdminSession();
    const adminSupabase = await createAdminClient();

    const { data, error } = await adminSupabase
      .from('subscriptions')
      .select('*, company:companies(id, name, inn)')
      .order('created_at', { ascending: false });

    if (error) return { success: false, error: error.message };
    return { success: true, data: data || [] };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой выборки подписок' };
  }
}

/**
 * Ручной запуск проверки просроченных тарифов
 */
export async function checkExpiredSubscriptionsAdminAction(): Promise<ActionResponse<{ updatedCount: number }>> {
  try {
    await requireSuperAdminSession();
    const adminSupabase = await createAdminClient();

    const { data, error } = await adminSupabase.rpc('cron_check_expired_subscriptions');
    if (error) return { success: false, error: error.message };

    revalidatePath('/admin/subscriptions');
    return { success: true, data: { updatedCount: data || 0 } };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой проверки подписок' };
  }
}

/**
 * Получение настраиваемых тарифов лендинга
 */
export async function getLandingPricingPlansAction(): Promise<ActionResponse<LandingPricingPlan[]>> {
  try {
    const adminSupabase = await createAdminClient();
    const { data, error } = await adminSupabase
      .from('landing_pricing_plans')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) return { success: false, error: error.message };
    return { success: true, data: (data || []) as LandingPricingPlan[] };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой выборки тарифов' };
  }
}

/**
 * Редактирование тарифа лендинга и лимитов суперадминистратором
 */
export const updateLandingPricingPlanAction = createSafeAction(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1, 'Укажите название тарифа'),
    price: z.string().min(1, 'Укажите стоимость'),
    period: z.string().default('сом/мес'),
    description: z.string().optional().nullable(),
    max_counterparties: z.number().int().min(1).default(10),
    max_employees: z.number().int().min(1).default(3),
    storage_limit_gb: z.number().min(0.1).default(1),
    is_telegram_enabled: z.boolean().default(false),
    is_popular: z.boolean().default(false),
    badge_text: z.string().optional().nullable(),
    features: z.array(z.string()).default([]),
    button_text: z.string().default('Выбрать тариф'),
  }),
  async (
    {
      id,
      name,
      price,
      period,
      description,
      max_counterparties,
      max_employees,
      storage_limit_gb,
      is_telegram_enabled,
      is_popular,
      badge_text,
      features,
      button_text,
    },
    ctx
  ) => {
    if (!ctx.isSuperAdmin) {
      return { success: false, error: 'Доступ разрешен только Суперадминистратору' };
    }

    const adminSupabase = await createAdminClient();
    const storage_limit_bytes = Math.round((storage_limit_gb || 1) * 1024 * 1024 * 1024);

    const updatePayload = {
      name,
      price,
      period,
      description: description || null,
      max_counterparties,
      max_employees,
      storage_limit_bytes,
      is_telegram_enabled,
      is_popular,
      badge_text: badge_text || null,
      features,
      button_text,
      updated_at: new Date().toISOString(),
    };

    const { data: updated, error } = await adminSupabase
      .from('landing_pricing_plans')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    // Синхронизируем pricing_plans
    const { error: syncError } = await adminSupabase
      .from('pricing_plans')
      .upsert({ id, ...updatePayload });

    if (syncError) {
      console.error('[Pricing plans sync error]:', syncError.message);
    }

    // Аудит
    await adminSupabase.from('admin_audit_logs').insert({
      admin_id: ctx.userId,
      action: 'pricing_plan_updated',
      target_type: 'subscription_plan',
      target_id: id,
      details: { name, price, max_counterparties, max_employees, storage_limit_gb, is_telegram_enabled },
    });

    revalidatePath('/');
    revalidatePath('/admin/subscriptions');
    revalidatePath('/uchet/subscription');
    return { success: true, data: updated as LandingPricingPlan };
  }
);

export const updatePricingPlanAction = updateLandingPricingPlanAction;

/**
 * Получение списка заявок на продление подписок для суперадминистратора
 */
export async function getAdminRenewalRequestsAction(params?: {
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<ActionResponse<{ requests: any[]; total: number; page: number; pageSize: number }>> {
  try {
    await requireSuperAdminSession();
    const adminSupabase = await createAdminClient();

    const page = Math.max(1, params?.page || 1);
    const pageSize = Math.min(100, Math.max(1, params?.pageSize || 25));
    const offset = (page - 1) * pageSize;

    let query = adminSupabase
      .from('subscription_renewal_requests')
      .select(
        '*, company:companies(id, name, inn, phone, email), requested_by_user:users!requested_by_user_id(id, full_name, email, phone), target_plan:landing_pricing_plans!target_plan_id(*), processed_by_user:users!processed_by_user_id(full_name)',
        { count: 'exact' }
      );

    if (params?.status && params.status !== 'all') {
      query = query.eq('status', params.status);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        requests: data || [],
        total: count || 0,
        page,
        pageSize,
      },
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой выборки заявок на продление' };
  }
}

/**
 * Одобрение заявки на продление подписки суперадминистратором
 */
export const approveRenewalRequestAction = createSafeAction(
  z.object({
    requestId: z.string().uuid('Некорректный ID заявки'),
    adminNotes: z.string().max(1000).optional(),
  }),
  async ({ requestId, adminNotes }, ctx) => {
    if (!ctx.isSuperAdmin) {
      return { success: false, error: 'Доступ разрешен только суперадминистратору' };
    }

    const adminSupabase = await createAdminClient();

    const { data, error } = await adminSupabase.rpc('admin_approve_renewal_request_atomic', {
      p_request_id: requestId,
      p_admin_id: ctx.userId,
      p_admin_notes: adminNotes?.trim() || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/admin/subscriptions');
    revalidatePath('/uchet/subscription');
    revalidatePath('/uchet');

    return { success: true, data };
  }
);

/**
 * Отклонение заявки на продление подписки суперадминистратором
 */
export const rejectRenewalRequestAction = createSafeAction(
  z.object({
    requestId: z.string().uuid('Некорректный ID заявки'),
    adminNotes: z.string().min(1, 'Укажите причину отклонения заявки').max(1000),
  }),
  async ({ requestId, adminNotes }, ctx) => {
    if (!ctx.isSuperAdmin) {
      return { success: false, error: 'Доступ разрешен только суперадминистратору' };
    }

    const adminSupabase = await createAdminClient();

    const { data: updated, error } = await adminSupabase
      .from('subscription_renewal_requests')
      .update({
        status: 'rejected',
        admin_notes: adminNotes.trim(),
        processed_by_user_id: ctx.userId,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .eq('status', 'pending')
      .select()
      .single();

    if (error || !updated) {
      return { success: false, error: error?.message || 'Заявка не найдена или уже обработана' };
    }

    // Аудит
    await adminSupabase.from('admin_audit_logs').insert({
      admin_id: ctx.userId,
      action: 'subscription_renewal_rejected',
      target_type: 'subscription_renewal_request',
      target_id: requestId,
      details: { admin_notes: adminNotes.trim() },
    });

    revalidatePath('/admin/subscriptions');
    revalidatePath('/uchet/subscription');

    return { success: true, data: updated };
  }
);

/**
 * Ручная настройка индивидуальных лимитов для организации
 */
export const updateCompanyCustomLimitsAction = createSafeAction(
  z.object({
    companyId: z.string().uuid(),
    custom_max_counterparties: z.number().int().min(1).nullable().optional(),
    custom_max_employees: z.number().int().min(1).nullable().optional(),
    custom_storage_limit_gb: z.number().min(0.1).nullable().optional(),
    custom_telegram_enabled: z.boolean().nullable().optional(),
  }),
  async (
    {
      companyId,
      custom_max_counterparties,
      custom_max_employees,
      custom_storage_limit_gb,
      custom_telegram_enabled,
    },
    ctx
  ) => {
    if (!ctx.isSuperAdmin) {
      return { success: false, error: 'Доступ разрешен только суперадминистратору' };
    }

    const adminSupabase = await createAdminClient();
    const custom_storage_limit_bytes =
      typeof custom_storage_limit_gb === 'number'
        ? Math.round(custom_storage_limit_gb * 1024 * 1024 * 1024)
        : custom_storage_limit_gb;

    const { data: updated, error } = await adminSupabase
      .from('companies')
      .update({
        custom_max_counterparties,
        custom_max_employees,
        custom_storage_limit_bytes,
        custom_telegram_enabled,
        updated_at: new Date().toISOString(),
      })
      .eq('id', companyId)
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    await adminSupabase.from('admin_audit_logs').insert({
      admin_id: ctx.userId,
      action: 'company_custom_limits_updated',
      target_type: 'company',
      target_id: companyId,
      details: {
        custom_max_counterparties,
        custom_max_employees,
        custom_storage_limit_bytes,
        custom_telegram_enabled,
      },
    });

    revalidatePath('/admin/companies');
    revalidatePath('/admin/subscriptions');
    revalidatePath('/uchet/subscription');

    return { success: true, data: updated };
  }
);

/**
 * Получение данных профиля суперадминистратора
 */
export async function getSuperAdminProfileDataAction(): Promise<ActionResponse<any>> {
  try {
    const session = await requireSuperAdminSession();
    const adminSupabase = await createAdminClient();

    const [userRes, telegramRes] = await Promise.all([
      adminSupabase.from('users').select('*, company_roles(*)').eq('id', session.userId).single(),
      adminSupabase.from('telegram_connections').select('*').eq('user_id', session.userId).maybeSingle(),
    ]);

    if (userRes.error || !userRes.data) {
      return { success: false, error: 'Пользователь не найден' };
    }

    return {
      success: true,
      data: {
        user: userRes.data,
        telegramConnection: telegramRes.data || null,
      },
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой получения профиля суперадминистратора' };
  }
}

/**
 * Обновление личного профиля суперадминистратора
 */
export const updateSuperAdminProfileAction = createSafeAction(
  z.object({
    full_name: z.string().min(2, 'ФИО должно содержать не менее 2 символов'),
    phone: z.string().optional().nullable(),
  }),
  async ({ full_name, phone }, ctx) => {
    if (!ctx.isSuperAdmin) {
      return { success: false, error: 'Доступ разрешен только суперадминистратору' };
    }

    const adminSupabase = await createAdminClient();

    const { data: updated, error } = await adminSupabase
      .from('users')
      .update({
        full_name,
        phone: phone || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ctx.userId)
      .select('*, company_roles(*)')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    // Аудит обновления профиля
    await adminSupabase.from('admin_audit_logs').insert({
      admin_id: ctx.userId,
      action: 'superadmin_profile_updated',
      target_type: 'user',
      target_id: ctx.userId,
      details: { full_name, phone },
    });

    revalidatePath('/admin/profile');
    revalidatePath('/admin');
    return { success: true, data: updated };
  }
);

/**
 * Серверная пагинация подписок организаций для суперадминистратора
 */
export async function getPaginatedSubscriptionsAdminAction(params: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
}): Promise<ActionResponse<{ subscriptions: any[]; total: number; page: number; pageSize: number }>> {
  try {
    await requireSuperAdminSession();
    const adminSupabase = await createAdminClient();

    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 25));
    const offset = (page - 1) * pageSize;

    let query = adminSupabase
      .from('subscriptions')
      .select('*, company:companies(id, name, inn)', { count: 'exact' });

    if (params.status && params.status !== 'all') {
      query = query.eq('status', params.status);
    }

    if (params.search && params.search.trim()) {
      const s = params.search.trim();
      query = query.or(`company.name.ilike.%${s}%,company.inn.ilike.%${s}%`);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        subscriptions: data || [],
        total: count || 0,
        page,
        pageSize,
      },
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Сбой выборки подписок' };
  }
}

export const getSuperAdminProfileAction = getSuperAdminProfileDataAction;

/**
 * Смена пароля текущего суперадминистратора
 */
export const updateSuperAdminPasswordAction = createSafeAction(
  z.object({
    newPassword: z.string().min(6, 'Пароль должен содержать не менее 6 символов'),
  }),
  async ({ newPassword }, ctx) => {
    if (!ctx.isSuperAdmin) {
      return { success: false, error: 'Доступ разрешен только суперадминистратору' };
    }

    const adminSupabase = await createAdminClient();
    const { error } = await adminSupabase.auth.admin.updateUserById(ctx.userId, {
      password: newPassword,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    await adminSupabase.from('admin_audit_logs').insert({
      admin_id: ctx.userId,
      action: 'superadmin_password_changed',
      target_type: 'user',
      target_id: ctx.userId,
      details: { timestamp: new Date().toISOString() },
    });

    return { success: true };
  }
);





