'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { ActionResponse, DocumentFile } from '@/types/database.types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getLookupCategories } from '@/lib/cache/lookups';
import { deleteR2Object } from '@/lib/r2';
import { formatBytes } from '@/lib/utils';

const archiveFileSchema = z.object({
  category_id: z.string().optional(),
  file_name: z.string().min(1, { message: 'Укажите имя файла' }),
  file_size: z.union([z.number(), z.string()]).optional(),
  file_type: z.string().optional(),
  file_path_r2: z.string().min(1, { message: 'Отсутствует ссылка на файл в хранилище' }),
  description: z.string().optional(),
  comment: z.string().optional(),
  is_legal_doc: z.boolean().optional(),
});

export type ArchiveFileInput = z.infer<typeof archiveFileSchema>;

// Загрузка уставного / учредительного документа компании
export async function uploadLegalDocumentAction(data: ArchiveFileInput): Promise<ActionResponse<DocumentFile>> {
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
    } = validation.data;

    let targetCatId = category_id;
    if (!targetCatId) {
      const cachedCategories = await getLookupCategories();
      const ustavCat = cachedCategories.find((c: any) => c.name === 'Устав компании');
      targetCatId = ustavCat?.id || '268dda23-d839-429d-bec2-aae391cffb00';
    }

    const adminSupabase = await createAdminClient();
    const { data: insertedFile, error } = await adminSupabase
      .from('files')
      .insert({
        company_id: prof.company_id,
        document_id: null,
        category_id: targetCatId,
        file_name,
        size_bytes: typeof file_size === 'number' ? file_size : (file_size ? parseSizeToBytes(file_size) : 1572864),
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
export async function uploadFileToArchiveAction(data: ArchiveFileInput): Promise<ActionResponse<DocumentFile>> {
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
      const cachedCategories = await getLookupCategories();
      targetCatId = cachedCategories[0]?.id || 'd9f0d6c6-2423-4b35-a72c-1bb380699a9c';
    }

    const { data: insertedFile, error } = await adminSupabase
      .from('files')
      .insert({
        company_id: prof.company_id,
        document_id: null,
        category_id: targetCatId,
        file_name,
        size_bytes: typeof file_size === 'number' ? file_size : (file_size ? parseSizeToBytes(file_size) : 1572864),
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
    file_size?: number | string;
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

    const { data: existingFile } = await adminSupabase.from('files').select('company_id, file_path_r2').eq('id', fileId).single();
    if (!existingFile) {
      return { success: false, error: 'Файл не найден' };
    }

    if (existingFile.company_id !== prof?.company_id && !prof?.is_super_admin) {
      return { success: false, error: 'Доступ запрещен: нельзя редактировать чужой файл' };
    }

    // Если меняется файл R2 — запрашиваем удаление старого объекта из R2
    if (data.file_path_r2 && existingFile.file_path_r2 && data.file_path_r2 !== existingFile.file_path_r2) {
      await deleteR2Object(existingFile.file_path_r2);
    }

    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (data.file_name) updatePayload.file_name = data.file_name;
    if (data.category_id) updatePayload.category_id = data.category_id;
    if (data.description) updatePayload.description = data.description;
    if (data.comment !== undefined) updatePayload.comment = data.comment;
    if (data.file_path_r2) updatePayload.file_path_r2 = data.file_path_r2;
    if (data.file_size !== undefined) updatePayload.size_bytes = typeof data.file_size === 'number' ? data.file_size : parseSizeToBytes(data.file_size);

    const { data: updated, error } = await adminSupabase
      .from('files')
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

// Удаление скана из базы данных и бакета Cloudflare R2
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

    const { data: existingFile } = await adminSupabase.from('files').select('company_id, file_path_r2').eq('id', fileId).single();
    if (!existingFile) {
      return { success: false, error: 'Файл не найден' };
    }

    if (existingFile.company_id !== prof?.company_id && !prof?.is_super_admin) {
      return { success: false, error: 'Доступ запрещен: нельзя удалять чужие файлы' };
    }

    // Физическое удаление объекта из Cloudflare R2
    if (existingFile.file_path_r2) {
      await deleteR2Object(existingFile.file_path_r2);
    }

    let deleteQuery = adminSupabase.from('files').delete().eq('id', fileId);
    if (!prof?.is_super_admin && prof?.company_id) {
      deleteQuery = deleteQuery.eq('company_id', prof.company_id);
    }
    const { error } = await deleteQuery;

    if (error) {
      return { success: false, error: `Ошибка удаления: ${error.message}` };
    }

    revalidatePath('/dashboard/files', 'page');
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
      .from('files')
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
      .from('files')
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
      .from('files')
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

export type EnrichedFileItem = DocumentFile & {
  sourceType: 'document' | 'company' | 'counterparty' | 'manual';
  sourceTitle: string;
  sourceUrl: string;
  bytesSize: number;
  isMyCompanyFile: boolean;
};

export type FileRegistryStats = {
  totalCount: number;
  totalSizeBytes: number;
  formattedTotalSize: string;
  myCompanyFilesCount: number;
  bySource: {
    document: number;
    company: number;
    counterparty: number;
    manual: number;
  };
  byType: {
    pdf: number;
    image: number;
    other: number;
  };
};

function parseSizeToBytes(sizeVal?: number | string | null): number {
  if (typeof sizeVal === 'number') return sizeVal;
  if (!sizeVal) return 1024 * 1024;
  const clean = String(sizeVal).toLowerCase().trim();
  const num = parseFloat(clean.replace(/[^0-9.]/g, '')) || 1;
  if (clean.includes('gb')) return Math.round(num * 1024 * 1024 * 1024);
  if (clean.includes('kb')) return Math.round(num * 1024);
  if (clean.includes('b') && !clean.includes('mb')) return Math.round(num);
  return Math.round(num * 1024 * 1024);
}

/**
 * ПОЛНЫЙ РЕЕСТР ФАЙЛОВ С КЛАССИФИКАЦИЕЙ ИСТОЧНИКОВ, ССЫЛКАМИ И СТАТИСТИКОЙ ОБЪЕМА
 */
export async function getComprehensiveFileRegistryAction(): Promise<
  ActionResponse<{
    files: EnrichedFileItem[];
    stats: FileRegistryStats;
    myCompanyId: string;
  }>
> {
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
      return { success: false, error: 'Организация пользователя не найдена' };
    }

    const myCompanyId = prof.company_id;

    // 1. Получаем все документы где компания участник (для ссылок)
    const { data: companyDocs } = await adminSupabase
      .from('documents')
      .select('id, doc_number, doc_type')
      .or(`sender_company_id.eq.${myCompanyId},receiver_company_id.eq.${myCompanyId}`);

    const docMap = new Map<string, { doc_number?: string | null; doc_type: string }>();
    if (companyDocs) {
      companyDocs.forEach((d) => docMap.set(d.id, d));
    }

    // 2. Получаем все контрагенты (для поиска по ИНН)
    const { data: counterparties } = await adminSupabase
      .from('counterparties')
      .select('id, name, inn, target_company_id')
      .eq('company_id', myCompanyId);

    const cpMap = new Map<string, string>();
    if (counterparties) {
      counterparties.forEach((c) => {
        if (c.target_company_id) cpMap.set(c.target_company_id, c.inn);
      });
    }

    // 3. Извлекаем ВСЕ привязанные к компании и ее документам файлы
    const docIds = Array.from(docMap.keys());
    
    let query = adminSupabase
      .from('files')
      .select('*, file_categories(*)')
      .order('created_at', { ascending: false });

    if (docIds.length > 0) {
      query = query.or(`company_id.eq.${myCompanyId},document_id.in.(${docIds.join(',')})`);
    } else {
      query = query.eq('company_id', myCompanyId);
    }

    const { data: rawFiles, error } = await query;

    if (error) {
      return { success: false, error: `Ошибка выгрузки файла архива: ${error.message}` };
    }

    const files: EnrichedFileItem[] = [];
    let totalSizeBytes = 0;
    let myCompanyFilesCount = 0;

    const bySource = { document: 0, company: 0, counterparty: 0, manual: 0 };
    const byType = { pdf: 0, image: 0, other: 0 };

    if (rawFiles && rawFiles.length > 0) {
      for (const f of rawFiles) {
        const isMyCompanyFile = f.company_id === myCompanyId;
        if (isMyCompanyFile) myCompanyFilesCount++;

        const bytes = parseSizeToBytes(f.size_bytes);
        totalSizeBytes += bytes;

        let sourceType: 'document' | 'company' | 'counterparty' | 'manual' = 'manual';
        let sourceTitle = 'Ручной архив';
        let sourceUrl = '/dashboard/files';

        if (f.document_id && docMap.has(f.document_id)) {
          const d = docMap.get(f.document_id);
          sourceType = 'document';
          sourceTitle = `B2B Документ №${d?.doc_number || f.document_id.slice(0, 8)}`;
          sourceUrl = `/dashboard/documents/${f.document_id}`;
          bySource.document++;
        } else if (f.is_legal_doc && isMyCompanyFile) {
          sourceType = 'company';
          sourceTitle = 'Моя Организация (Уставной скан)';
          sourceUrl = '/dashboard/company';
          bySource.company++;
        } else if (f.is_legal_doc || (f.description && f.description.toLowerCase().includes('контрагент'))) {
          sourceType = 'counterparty';
          sourceTitle = `Скан Контрагента`;
          const inn = cpMap.get(f.company_id || '');
          sourceUrl = inn ? `/dashboard/counterparties?search=${inn}` : '/dashboard/counterparties';
          bySource.counterparty++;
        } else {
          sourceType = 'manual';
          sourceTitle = 'Загружен вручную';
          sourceUrl = '/dashboard/files';
          bySource.manual++;
        }

        // Тип формата
        const ext = (f.file_name || '').toLowerCase();
        if (ext.endsWith('.pdf') || f.file_type === 'pdf') {
          byType.pdf++;
        } else if (ext.match(/\.(png|jpg|jpeg|webp|heic)$/) || f.file_type === 'image') {
          byType.image++;
        } else {
          byType.other++;
        }

        files.push({
          ...(f as DocumentFile),
          sourceType,
          sourceTitle,
          sourceUrl,
          bytesSize: bytes,
          isMyCompanyFile,
        });
      }
    }

    return {
      success: true,
      data: {
        files,
        stats: {
          totalCount: files.length,
          totalSizeBytes,
          formattedTotalSize: formatBytes(totalSizeBytes),
          myCompanyFilesCount,
          bySource,
          byType,
        },
        myCompanyId,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой комплексного реестра файлов';
    return { success: false, error: errorMsg };
  }
}
