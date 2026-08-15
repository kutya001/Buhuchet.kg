'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { ActionResponse, DocumentFile, FileCategory } from '@/types/database.types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSafeAction } from '@/lib/auth/safe-action';
import { getLookupCategories } from '@/lib/cache/lookups';
import { deleteR2Object, getPresignedDownloadUrl } from '@/lib/r2';
import { formatBytes } from '@/lib/utils';
import { verifyR2FileMagicBytes } from '@/lib/files/validation';

export async function getFileViewUrlAction(
  fileKey: string,
  fileName?: string
): Promise<ActionResponse<{ viewUrl: string }>> {
  try {
    if (!fileKey) return { success: false, error: 'Ключ файла не указан' };
    const viewUrl = await getPresignedDownloadUrl(fileKey, 3600, 'view', fileName);
    return { success: true, data: { viewUrl } };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой получения ссылки просмотра';
    return { success: false, error: errorMsg };
  }
}

export async function getFileDownloadUrlAction(
  fileKey: string,
  fileName?: string
): Promise<ActionResponse<{ downloadUrl: string }>> {
  try {
    if (!fileKey) return { success: false, error: 'Ключ файла не указан' };
    const downloadUrl = await getPresignedDownloadUrl(fileKey, 3600, 'download', fileName);
    return { success: true, data: { downloadUrl } };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой получения ссылки скачивания';
    return { success: false, error: errorMsg };
  }
}

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

export async function getFileCategoriesAction(): Promise<ActionResponse<FileCategory[]>> {
  try {
    const categories = await getLookupCategories();
    return { success: true, data: categories as FileCategory[] };
  } catch (err: unknown) {
    return { success: false, error: 'Сбой получения категорий' };
  }
}

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

    if (file_path_r2) {
      const magicCheck = await verifyR2FileMagicBytes(file_path_r2);
      if (!magicCheck.valid) {
        return { success: false, error: magicCheck.error || 'Недопустимый формат файла' };
      }
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

    // Фиксируем первого владельца в file_owners
    await adminSupabase.from('file_owners').upsert(
      {
        file_id: insertedFile.id,
        company_id: prof.company_id,
        is_original_creator: true,
      },
      { onConflict: 'file_id, company_id', ignoreDuplicates: true }
    );

    revalidatePath('/uchet/company');
    revalidatePath('/uchet/files');
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

    if (file_path_r2) {
      const magicCheck = await verifyR2FileMagicBytes(file_path_r2);
      if (!magicCheck.valid) {
        return { success: false, error: magicCheck.error || 'Недопустимый формат файла' };
      }
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

    // Фиксируем первого владельца в file_owners
    await adminSupabase.from('file_owners').upsert(
      {
        file_id: insertedFile.id,
        company_id: prof.company_id,
        is_original_creator: true,
      },
      { onConflict: 'file_id, company_id', ignoreDuplicates: true }
    );

    revalidatePath('/uchet/files');
    revalidatePath('/uchet/company');
    return { success: true, data: insertedFile as DocumentFile };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при загрузке файла в архив';
    return { success: false, error: errorMsg };
  }
}

// Редактирование и замена файла R2 с поддержкой Copy-on-Write (CoW)
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

    const { data: existingFile } = await adminSupabase.from('files').select('*').eq('id', fileId).single();
    if (!existingFile) {
      return { success: false, error: 'Файл не найден' };
    }

    const myCompanyId = prof?.company_id;
    if (!myCompanyId && !prof?.is_super_admin) {
      return { success: false, error: 'Доступ запрещен: пользователь не привязан к организации' };
    }

    // Проверяем совладельцев в file_owners
    const { data: owners } = await adminSupabase.from('file_owners').select('company_id').eq('file_id', fileId);
    const ownerCount = owners?.length || 1;

    // 🟢 COPY-ON-WRITE (CoW): Если владельцев > 1 и компания заменяет/редактирует документ
    if (ownerCount > 1 && myCompanyId) {
      const newFilePath = data.file_path_r2 || existingFile.file_path_r2;
      const { data: newFile, error: cowErr } = await adminSupabase
        .from('files')
        .insert({
          company_id: myCompanyId,
          document_id: existingFile.document_id,
          category_id: data.category_id || existingFile.category_id,
          file_name: data.file_name || existingFile.file_name,
          size_bytes: data.file_size !== undefined ? (typeof data.file_size === 'number' ? data.file_size : parseSizeToBytes(data.file_size)) : existingFile.size_bytes,
          file_type: existingFile.file_type,
          file_path_r2: newFilePath,
          description: data.description || existingFile.description,
          comment: data.comment !== undefined ? data.comment : existingFile.comment,
          is_internal: existingFile.is_internal,
          is_legal_doc: existingFile.is_legal_doc,
        })
        .select('*, file_categories(*)')
        .single();

      if (cowErr || !newFile) {
        return { success: false, error: `Ошибка создания CoW дубликата: ${cowErr?.message}` };
      }

      // Привязываем новую запись к file_owners
      await adminSupabase.from('file_owners').insert({
        file_id: newFile.id,
        company_id: myCompanyId,
        is_original_creator: true,
      });

      // Открепляем компанию от старого файла
      await adminSupabase.from('file_owners').delete().eq('file_id', fileId).eq('company_id', myCompanyId);

      revalidatePath('/uchet/files');
      revalidatePath('/uchet/company');
      revalidatePath('/admin');
      return { success: true, data: newFile as DocumentFile };
    }

    // Единоличное владение: обновляем файл напрямую
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

    revalidatePath('/uchet/files');
    revalidatePath('/uchet/company');
    revalidatePath('/admin');
    return { success: true, data: updated as DocumentFile };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой обновления файла';
    return { success: false, error: errorMsg };
  }
}

// Удаление скана из базы данных с каскадным контролем file_owners
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

    // 1. Открепляем компанию от file_owners
    if (prof?.company_id) {
      await adminSupabase.from('file_owners').delete().eq('file_id', fileId).eq('company_id', prof.company_id);
    }

    // 2. Проверяем оставшихся владельцев
    const { data: remainingOwners } = await adminSupabase.from('file_owners').select('id').eq('file_id', fileId);

    // Если владельцев не осталось или это суперадмин — физически стираем из R2 и files
    if ((!remainingOwners || remainingOwners.length === 0) || prof?.is_super_admin) {
      if (existingFile.file_path_r2) {
        await deleteR2Object(existingFile.file_path_r2);
      }
      await adminSupabase.from('files').delete().eq('id', fileId);
    }

    revalidatePath('/uchet/files', 'page');
    revalidatePath('/uchet/company');
    revalidatePath('/admin');
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
  ownersCount: number;
  isCoWShared: boolean;
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
 * ПОЛНЫЙ РЕЕСТР ФАЙЛОВ С КЛАССИФИКАЦИЕЙ ИСТОЧНИКОВ, ССЫЛКАМИ И СТАТИСТИКОЙ ОБЪЕМА (С СЕРВЕРНОЙ ОПТИМИЗАЦИЕЙ PERF-02)
 */
export async function getComprehensiveFileRegistryAction(params?: {
  page?: number;
  limit?: number;
  search?: string;
  sourceType?: string;
  fileFormat?: string;
}): Promise<
  ActionResponse<{
    files: EnrichedFileItem[];
    stats: FileRegistryStats;
    myCompanyId: string;
    totalCount?: number;
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

    // 3. Извлекаем файлы с поддержкой серверных фильтров и пагинации
    const docIds = Array.from(docMap.keys());
    
    let query = adminSupabase
      .from('files')
      .select('*, file_categories(*)', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (docIds.length > 0) {
      query = query.or(`company_id.eq.${myCompanyId},document_id.in.(${docIds.join(',')})`);
    } else {
      query = query.eq('company_id', myCompanyId);
    }

    if (params?.search && params.search.trim() !== '') {
      const s = params.search.trim();
      query = query.or(`file_name.ilike.%${s}%,description.ilike.%${s}%,comment.ilike.%${s}%`);
    }

    if (params?.page && params?.limit) {
      const page = Math.max(params.page, 1);
      const limit = Math.min(Math.max(params.limit, 1), 200);
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);
    }

    const { data: rawFiles, count, error } = await query;

    if (error) {
      return { success: false, error: `Ошибка выгрузки файла архива: ${error.message}` };
    }

    const fileIds = (rawFiles || []).map((f) => f.id);
    const ownerCountsMap = new Map<string, number>();
    if (fileIds.length > 0) {
      const { data: allOwners } = await adminSupabase.from('file_owners').select('file_id').in('file_id', fileIds);
      if (allOwners) {
        allOwners.forEach((o) => {
          ownerCountsMap.set(o.file_id, (ownerCountsMap.get(o.file_id) || 0) + 1);
        });
      }
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
        let sourceUrl = '/uchet/files';

        if (f.document_id && docMap.has(f.document_id)) {
          const d = docMap.get(f.document_id);
          sourceType = 'document';
          sourceTitle = `Документ №${d?.doc_number || f.document_id.slice(0, 8)}`;
          sourceUrl = `/uchet/documents/${f.document_id}`;
          bySource.document++;
        } else if (f.is_legal_doc && isMyCompanyFile) {
          sourceType = 'company';
          sourceTitle = 'Моя Организация (Уставной скан)';
          sourceUrl = '/uchet/company';
          bySource.company++;
        } else if (f.is_legal_doc || (f.description && f.description.toLowerCase().includes('контрагент'))) {
          sourceType = 'counterparty';
          sourceTitle = `Скан Контрагента`;
          const inn = cpMap.get(f.company_id || '');
          sourceUrl = inn ? `/uchet/counterparties?search=${inn}` : '/uchet/counterparties';
          bySource.counterparty++;
        } else {
          sourceType = 'manual';
          sourceTitle = 'Загружен вручную';
          sourceUrl = '/uchet/files';
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

        const countOwners = ownerCountsMap.get(f.id) || 1;

        files.push({
          ...(f as DocumentFile),
          sourceType,
          sourceTitle,
          sourceUrl,
          bytesSize: bytes,
          isMyCompanyFile,
          ownersCount: countOwners,
          isCoWShared: countOwners > 1,
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

/**
 * Получение подробной информации о файле для карточки просмотра
 */
export const getFileDetailsAction = createSafeAction(
  z.object({ fileId: z.string().uuid() }),
  async ({ fileId }, ctx) => {
    const adminSupabase = await createAdminClient();

    const { data: file, error } = await adminSupabase
      .from('files')
      .select('*, file_categories(*), documents(*), companies:companies!company_id(name, inn)')
      .eq('id', fileId)
      .single();

    if (error || !file) {
      return { success: false, error: 'Файл не найден в базе данных' };
    }

    const { count } = await adminSupabase
      .from('file_owners')
      .select('*', { count: 'exact', head: true })
      .eq('file_id', fileId);

    const ownersCount = count || 1;

    return {
      success: true,
      data: {
        ...file,
        ownersCount,
        isCoWShared: ownersCount > 1,
      },
    };
  }
);
