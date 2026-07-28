'use server';

import { createClient } from '@/lib/supabase/server';
import type { ActionResponse, DocumentFile } from '@/types/database.types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const archiveFileSchema = z.object({
  category_id: z.string().min(1, { message: 'Выберите категорию файла' }),
  file_name: z.string().min(1, { message: 'Укажите имя файла' }),
  file_size: z.string().optional(),
  file_type: z.string().optional(),
  file_path_r2: z.string().min(1, { message: 'Отсутствует ссылка Cloudflare R2' }),
  description: z.string().min(2, { message: 'Укажите обязательное описание скана' }),
  comment: z.string().optional(),
  is_legal_doc: z.boolean().optional(),
});

// Загрузка файла в личный архив или учредительные документы компании
export async function uploadFileToArchiveAction(data: any): Promise<ActionResponse<DocumentFile>> {
  try {
    const supabase = await createClient();

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

    const { data: insertedFile, error } = await supabase
      .from('document_files')
      .insert({
        company_id: prof.company_id,
        document_id: null,
        category_id,
        file_name,
        file_size: file_size || '1.5 MB',
        file_type: file_type || 'image',
        file_path_r2,
        description,
        comment: comment || null,
        is_internal: !is_legal_doc,
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

// Получение всех доступных сканов компании (из архива и уставных документов)
export async function getCompanyFilesArchiveAction(): Promise<ActionResponse<DocumentFile[]>> {
  try {
    const supabase = await createClient();

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

    const { data: files, error } = await supabase
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
