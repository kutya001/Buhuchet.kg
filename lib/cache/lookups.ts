import { cache } from 'react';
import { createAdminClient } from '@/lib/supabase/server';
import type { FileCategory } from '@/types/database.types';

/**
 * Кешированное получение списка категорий файлов (повторное использование без сетевых сбоев)
 */
export const getCachedFileCategories = cache(async (): Promise<FileCategory[]> => {
  try {
    const supabaseAdmin = await createAdminClient();
    const { data, error } = await supabaseAdmin
      .from('file_categories')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error || !data) {
      return [];
    }

    return data as FileCategory[];
  } catch (err) {
    console.error('Сбой загрузки категорий:', err);
    return [];
  }
});
