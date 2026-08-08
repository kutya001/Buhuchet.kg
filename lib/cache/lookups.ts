import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import type { FileCategory, CompanyRole, Company } from '@/types/database.types';

/**
 * Кэшированное получение глобального справочника категорий сканов первички (R2).
 * Срок действия кэша: 1 час (3600 сек). Тег инвалидации: 'file-categories'.
 */
export const getLookupCategories = unstable_cache(
  async (): Promise<FileCategory[]> => {
    const adminSupabase = await createAdminClient();
    const { data } = await adminSupabase
      .from('file_categories')
      .select('*')
      .order('name', { ascending: true });

    return (data || []) as FileCategory[];
  },
  ['lookup-file-categories'],
  { revalidate: 3600, tags: ['file-categories'] }
);

/**
 * Кэшированное получение кастомных ролей компании RBAC.
 * Срок действия кэша: 5 минут (300 сек). Тег инвалидации: 'company-roles'.
 */
export const getLookupCompanyRoles = unstable_cache(
  async (companyId: string): Promise<CompanyRole[]> => {
    if (!companyId) return [];
    const adminSupabase = await createAdminClient();
    const { data } = await adminSupabase
      .from('company_roles')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true });

    return (data || []) as CompanyRole[];
  },
  ['lookup-company-roles'],
  { revalidate: 300, tags: ['company-roles'] }
);

/**
 * Кэшированное получение публичного каталога верифицированных организаций КР.
 * Срок действия кэша: 10 минут (600 сек). Тег инвалидации: 'companies-catalog'.
 */
export const getLookupCompaniesCatalog = unstable_cache(
  async (): Promise<Company[]> => {
    const adminSupabase = await createAdminClient();
    const { data } = await adminSupabase
      .from('companies')
      .select('id, name, inn, legal_form, industry, director_name, email, phone, is_active, status')
      .eq('status', 'active')
      .order('name', { ascending: true });

    return (data || []) as Company[];
  },
  ['lookup-companies-catalog'],
  { revalidate: 600, tags: ['companies-catalog'] }
);
