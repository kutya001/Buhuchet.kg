'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { ActionResponse, DocumentFile } from '@/types/database.types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCachedFileCategories } from '@/lib/cache/lookups';

const archiveFileSchema = z.object({
  category_id: z.string().optional(),
  file_name: z.string().min(1, { message: 'Укажите имя файла' }),
  file_size: z.string().optional(),
  file_type: z.string().optional(),
  file_path_r2: z.string().min(1, { message: 'Отсутствует ссылка Cloudflare R2' }),
  description: z.string().optional(),
  comment: z.string().optional(),
  is_legal_doc: z.boolean().optional(),
});

// Загрузка уставного / учредительного документа компании
export async function uploadLegalDocumentAction(data: any): Promise<ActionResponse<DocumentFile>> {
  try {
    const supabase = await createClient();
    const adminSupabase = await createAdminClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const { data: prof } = await supabase.from('users').select('company_id').eq('id', user.id).single();
    if (!prof?.company_id) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    const validation = archiveFileSchema.safeParse(data);
    if (!validation.success) {
      const errStr = validation.error.issues.map((i) => i.message).join(', ');
      return { success: false, error: errStr };
    }

    const {
      category_id,
      file_name,
      file_size,
      file_type,
      file_path_r2,
      description,
      comment,
    } = validation.data;

    let targetCatId = category_id;
    if (!targetCatId) {
      const cachedCategories = await getCachedFileCategories();
      const ustavCat = cachedCategories.find((c) => c.name === 'Устав компании');
      targetCatId = ustavCat?.id || '268dda23-d839-429d-bec2-aae391cffb00';
    }

    const { data: insertedFile, error } = await adminSupabase
      .from('document_files')
      .insert({
        company_id: prof.company_id,
        document_id: null,
        category_id: targetCatId,
        file_name,
        file_size: file_size || '1.5 MB',
        file_type: file_type || 'image',
        file_path_r2,
        description: description || `Учредительный документ ${file_name}`,
        comment: comment || null,
        is_internal: true,
        is_legal_doc: true,
      })
      .select('*, file_categories(*)')
      .single();

    if (error || !insertedFile) {
      return { success: false, error: `Ошибка сохранения учредительного документа: ${error?.message}` };
    }

    revalidatePath('/dashboard/company');
    revalidatePath('/dashboard/files');
    return { success: true, data: insertedFile as DocumentFile };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при сохранении уставного документа';
    return { success: false, error: errorMsg };
  }
}

// Загрузка файла в личный архив компании
export async function uploadFileToArchiveAction(data: any): Promise<ActionResponse<DocumentFile>> {
  try {
    const supabase = await createClient();
    const adminSupabase = await createAdminClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const { data: prof } = await supabase.from('users').select('company_id').eq('id', user.id).single();
    if (!prof?.company_id) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    const validation = archiveFileSchema.safeParse(data);
    if (!validation.success) {
      const errStr = validation.error.issues.map((i) => i.message).join(', ');
      return { success: false, error: errStr };
    }

    const {
      category_id,
      file_name,
      file_size,
      file_type,
      file_path_r2,
      description,
      comment,
      is_legal_doc,
    } = validation.data;

    let targetCatId = category_id;
    if (!targetCatId) {
      const cachedCategories = await getCachedFileCategories();
      targetCatId = cachedCategories[0]?.id || 'd9f0d6c6-2423-4b35-a72c-1bb380699a9c';
    }

    const { data: insertedFile, error } = await adminSupabase
      .from('document_files')
      .insert({
        company_id: prof.company_id,
        document_id: null,
        category_id: targetCatId,
        file_name,
        file_size: file_size || '1.5 MB',
        file_type: file_type || 'image',
        file_path_r2,
        description: description || `Скан файла ${file_name}`,
        comment: comment || null,
        is_internal: true,
        is_legal_doc: !!is_legal_doc,
      })
      .select('*, file_categories(*)')
      .single();

    if (error || !insertedFile) {
      return { success: false, error: `Ошибка сохранения файла: ${error?.message}` };
    }

    revalidatePath('/dashboard/files');
    revalidatePath('/dashboard/company');
    return { success: true, data: insertedFile as DocumentFile };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при загрузке файла в архив';
    return { success: false, error: errorMsg };
  }
}

// Редактирование и замена файла R2
export async function updateDocumentFileAction(
  fileId: string,
  data: {
    file_name?: string;
    category_id?: string;
    description?: string;
    comment?: string;
    file_path_r2?: string;
    file_size?: string;
  }
): Promise<ActionResponse<DocumentFile>> {
  try {
    const supabase = await createClient();
    const adminSupabase = await createAdminClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const { data: prof } = await supabase.from('users').select('company_id, is_super_admin').eq('id', user.id).single();

    const { data: existingFile } = await adminSupabase.from('document_files').select('company_id').eq('id', fileId).single();
    if (!existingFile) {
      return { success: false, error: 'Файл не найден' };
    }

    if (existingFile.company_id !== prof?.company_id && !prof?.is_super_admin) {
      return { success: false, error: 'Доступ запрещен: нельзя редактировать чужой файл' };
    }

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (data.file_name) updatePayload.file_name = data.file_name;
    if (data.category_id) updatePayload.category_id = data.category_id;
    if (data.description) updatePayload.description = data.description;
    if (data.comment !== undefined) updatePayload.comment = data.comment;
    if (data.file_path_r2) updatePayload.file_path_r2 = data.file_path_r2;
    if (data.file_size) updatePayload.file_size = data.file_size;

    const { data: updated, error } = await adminSupabase
      .from('document_files')
      .update(updatePayload)
      .eq('id', fileId)
      .select('*, file_categories(*)')
      .single();

    if (error || !updated) {
      return { success: false, error: `Ошибка обновления файла: ${error?.message}` };
    }

    revalidatePath('/dashboard/files');
    revalidatePath('/dashboard/company');
    revalidatePath('/super-admin');
    return { success: true, data: updated as DocumentFile };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой обновления файла';
    return { success: false, error: errorMsg };
  }
}

// Удаление скана из базы данных
export async function deleteDocumentFileAction(fileId: string): Promise<ActionResponse<boolean>> {
  try {
    const supabase = await createClient();
    const adminSupabase = await createAdminClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const { data: prof } = await supabase.from('users').select('company_id, is_super_admin').eq('id', user.id).single();

    const { data: existingFile } = await adminSupabase.from('document_files').select('company_id').eq('id', fileId).single();
    if (!existingFile) {
      return { success: false, error: 'Файл не найден' };
    }

    if (existingFile.company_id !== prof?.company_id && !prof?.is_super_admin) {
      return { success: false, error: 'Доступ запрещен: нельзя удалять чужие файлы' };
    }

    const { error } = await adminSupabase.from('document_files').delete().eq('id', fileId);

    if (error) {
      return { success: false, error: `Ошибка удаления: ${error.message}` };
    }

    revalidatePath('/dashboard/files');
    revalidatePath('/dashboard/company');
    revalidatePath('/super-admin');
    return { success: true, data: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при удалении файла';
    return { success: false, error: errorMsg };
  }
}

// Получение учредительных документов компании
export async function getCompanyLegalDocsAction(): Promise<ActionResponse<DocumentFile[]>> {
  try {
    const supabase = await createClient();
    const adminSupabase = await createAdminClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const { data: prof } = await supabase.from('users').select('company_id').eq('id', user.id).single();
    if (!prof?.company_id) {
      return { success: false, error: 'Организация не найдена' };
    }

    const { data: files, error } = await adminSupabase
      .from('document_files')
      .select('*, file_categories(*)')
      .eq('company_id', prof.company_id)
      .eq('is_legal_doc', true)
      .order('created_at', { ascending: false });

    if (error) {
      return { success: false, error: `Ошибка чтения уставных документов: ${error.message}` };
    }

    return { success: true, data: (files as DocumentFile[]) || [] };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при получении уставных сканов';
    return { success: false, error: errorMsg };
  }
}

// Получение всех доступных сканов компании
export async function getCompanyFilesArchiveAction(): Promise<ActionResponse<DocumentFile[]>> {
  try {
    const supabase = await createClient();
    const adminSupabase = await createAdminClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const { data: prof } = await supabase.from('users').select('company_id').eq('id', user.id).single();
    if (!prof?.company_id) {
      return { success: false, error: 'Организация не найдена' };
    }

    const { data: files, error } = await adminSupabase
      .from('document_files')
      .select('*, file_categories(*)')
      .eq('company_id', prof.company_id)
      .order('created_at', { ascending: false });

    if (error) {
      return { success: false, error: `Ошибка получения архива: ${error.message}` };
    }

    return { success: true, data: (files as DocumentFile[]) || [] };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при чтении файлов архива';
    return { success: false, error: errorMsg };
  }
}

// РЕЕСТР ВСЕХ ФАЙЛОВ СИСТЕМЫ (Для Панели Суперадмина)
export async function getAllSystemFilesAction(): Promise<ActionResponse<any[]>> {
  try {
    const supabase = await createClient();
    const adminSupabase = await createAdminClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const { data: prof } = await supabase.from('users').select('is_super_admin').eq('id', user.id).single();
    if (!prof?.is_super_admin) {
      return { success: false, error: 'Доступ ограничен: только для Суперадмина' };
    }

    const { data: files, error } = await adminSupabase
      .from('document_files')
      .select('*, file_categories(*), companies(name, inn)')
      .order('created_at', { ascending: false });

    if (error) {
      return { success: false, error: `Ошибка загрузки системных файлов: ${error.message}` };
    }

    return { success: true, data: files || [] };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при вызове реестра файлов суперадмина';
    return { success: false, error: errorMsg };
  }
}
