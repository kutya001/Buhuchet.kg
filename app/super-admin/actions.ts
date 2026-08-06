'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { ActionResponse, Company, CompanyStatus, Document, FileCategory } from '@/types/database.types';
import { revalidatePath } from 'next/cache';

/**
 * Проверка прав суперадмина
 */
async function checkSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return false;

  const { data: profile } = await supabase
    .from('users')
    .select('is_super_admin')
    .eq('id', user.id)
    .single();

  return profile?.is_super_admin === true;
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

    revalidatePath('/super-admin');
    return { success: true, data: comp as Company };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой при создании организации' };
  }
}

export async function approveCompanyAction(companyId: string): Promise<ActionResponse> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const adminSupabase = await createAdminClient();
    const { error } = await adminSupabase
      .from('companies')
      .update({
        status: 'active',
        moderation_comment: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', companyId);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой одобрения компании' };
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
    const { error } = await adminSupabase
      .from('companies')
      .update({
        status: 'requires_changes',
        moderation_comment: comment,
        updated_at: new Date().toISOString(),
      })
      .eq('id', companyId);

    if (error) return { success: false, error: error.message };
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
    const { error } = await adminSupabase
      .from('companies')
      .update({
        status: 'blocked',
        moderation_comment: comment,
        updated_at: new Date().toISOString(),
      })
      .eq('id', companyId);

    if (error) return { success: false, error: error.message };
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

    revalidatePath('/super-admin');
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
    const { data, error } = await adminSupabase
      .from('users')
      .select('*, companies(*)')
      .order('created_at', { ascending: false });

    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (err: unknown) {
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

    revalidatePath('/super-admin');
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

    revalidatePath('/super-admin');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой при удалении пользователя' };
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
    const { data, error } = await adminSupabase
      .from('documents')
      .select('*, sender_company:companies!sender_company_id(*), receiver_company:companies!receiver_company_id(*), users(*)')
      .order('created_at', { ascending: false });

    if (error) return { success: false, error: error.message };
    return { success: true, data };
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

    revalidatePath('/super-admin');
    revalidatePath('/dashboard/documents');
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

    revalidatePath('/super-admin');
    revalidatePath('/dashboard/documents');
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

    revalidatePath('/super-admin');
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

    revalidatePath('/super-admin');
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

    revalidatePath('/super-admin');
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой удаления категории' };
  }
}

// -------------------------------------------------------------
// 5. МОДУЛЬ БАЗЫ ДАННЫХ (READ-ONLY DATABASE INSPECTOR)
// -------------------------------------------------------------

export async function inspectTableDataAdminAction(
  tableName: string,
  limit: number = 50
): Promise<ActionResponse<{ columns: string[]; rows: any[] }>> {
  try {
    if (!(await checkSuperAdmin())) {
      return { success: false, error: 'Доступ запрещен' };
    }

    const allowedTables = [
      'users',
      'companies',
      'documents',
      'files',
      'counterparties',
      'company_partnerships',
      'file_categories',
      'document_logs',
    ];

    if (!allowedTables.includes(tableName)) {
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
