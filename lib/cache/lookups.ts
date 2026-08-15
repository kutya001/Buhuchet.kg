import { unstable_cache } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import type { FileCategory, CompanyRole, Company } from '@/types/database.types';

/**
 * 1. Глобальный справочник категорий сканов (R2).
 * Срок: 1 час (3600 сек). Тег: 'global:file-categories'.
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
  { revalidate: 3600, tags: ['global:file-categories'] }
);

/**
 * 2. Роли компании RBAC с изоляцией кэша по тегу `company:${companyId}:roles`.
 * Срок: 10 минут (600 сек).
 */
export const getLookupCompanyRoles = (companyId: string) =>
  unstable_cache(
    async (): Promise<CompanyRole[]> => {
      if (!companyId) return [];
      const adminSupabase = await createAdminClient();
      const { data } = await adminSupabase
        .from('company_roles')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: true });

      return (data || []) as CompanyRole[];
    },
    [`lookup-company-roles-${companyId}`],
    { revalidate: 600, tags: [`company:${companyId}:roles`, 'company-roles'] }
  )();

/**
 * 3. Публичный каталог верифицированных компаний.
 * Срок: 10 минут (600 сек). Тег: 'global:companies-catalog'.
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
  { revalidate: 600, tags: ['global:companies-catalog', 'companies-catalog'] }
);
