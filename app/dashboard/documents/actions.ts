'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { b2bDocumentSchema } from '@/types/b2b.types';
import type { ActionResponse, Document, DocumentStatus, DocumentType, UserRole } from '@/types/database.types';
import { revalidatePath } from 'next/cache';
import { deleteR2Object } from '@/lib/r2';
import { z } from 'zod';

async function getUserContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('users')
    .select('company_id, role, is_super_admin')
    .eq('id', user.id)
    .single();

  return {
    userId: user.id,
    companyId: profile?.company_id || null,
    role: (profile?.role || 'manager') as UserRole,
    isSuperAdmin: !!profile?.is_super_admin,
  };
}

// Получение списка документов организации
export async function getB2BDocumentsAction(): Promise<ActionResponse<any[]>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    const adminSupabase = await createAdminClient();

    const { data: docs, error } = await adminSupabase
      .from('documents')
      .select('*, sender_company:companies!sender_company_id(*), receiver_company:companies!receiver_company_id(*), document_files(*), users(full_name)')
      .or(`sender_company_id.eq.${ctx.companyId},receiver_company_id.eq.${ctx.companyId}`)
      .order('created_at', { ascending: false });

    if (error) {
      return { success: false, error: `Ошибка загрузки реестра документов: ${error.message}` };
    }

    return { success: true, data: docs || [] };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой чтения документов';
    return { success: false, error: errorMsg };
  }
}

// Получение детализации документа
export async function getB2BDocumentByIdAction(docId: string): Promise<ActionResponse<any>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    const adminSupabase = await createAdminClient();

    const { data: doc, error } = await adminSupabase
      .from('documents')
      .select('*, sender_company:companies!sender_company_id(*), receiver_company:companies!receiver_company_id(*), document_files(*, file_categories(*)), document_logs(*, users(full_name)), users(full_name)')
      .eq('id', docId)
      .single();

    if (error || !doc) {
      return { success: false, error: 'Документ не найден или у вас нет прав на его просмотр' };
    }

    if (doc.sender_company_id !== ctx.companyId && doc.receiver_company_id !== ctx.companyId && !ctx.isSuperAdmin) {
      return { success: false, error: 'У вашей организации нет прав на доступ к данному документу' };
    }

    return { success: true, data: doc };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой загрузки детализации документа';
    return { success: false, error: errorMsg };
  }
}

export type B2BDocumentInput = z.infer<typeof b2bDocumentSchema>;

// ПОЛНОЕ РЕДАКТИРОВАНИЕ ЧЕРНОВИКА (РЕКВИЗИТЫ + УПРАВЛЕНИЕ СКАНОМ R2)
export async function updateB2BDocumentFullAction(
  documentId: string,
  data: {
    receiver_company_id: string;
    doc_type: DocumentType;
    doc_number: string;
    doc_date: string;
    comment?: string;
    status?: DocumentStatus;
    files: Array<{
      category_id: string;
      file_name: string;
      file_size: string;
      file_type: string;
      file_path_r2: string;
      description: string;
      comment?: string;
    }>;
  }
): Promise<ActionResponse> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    const adminSupabase = await createAdminClient();

    const { data: doc } = await adminSupabase
      .from('documents')
      .select('sender_company_id, status')
      .eq('id', documentId)
      .single();

    if (!doc) {
      return { success: false, error: 'Документ не найден' };
    }

    if (doc.sender_company_id !== ctx.companyId && !ctx.isSuperAdmin) {
      return { success: false, error: 'Редактировать черновик может только организация-отправитель' };
    }

    if (doc.status !== 'draft' && doc.status !== 'sent') {
      return { success: false, error: 'Редактировать можно только черновик или отозванный документ' };
    }

    const targetStatus = data.status || 'draft';

    // 1. Обновляем основные реквизиты документа
    const { error: updateError } = await adminSupabase
      .from('documents')
      .update({
        receiver_company_id: data.receiver_company_id,
        doc_type: data.doc_type,
        doc_number: data.doc_number || null,
        doc_date: data.doc_date,
        comment: data.comment || null,
        status: targetStatus,
        mock_file_name: data.files[0]?.file_name || null,
        mock_file_size: data.files[0]?.file_size || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    if (updateError) {
      return { success: false, error: `Ошибка обновления черновика: ${updateError.message}` };
    }

    // 2. Получаем текущие привязанные файлы для безопасного удаления из R2 при полной замене
    const { data: oldFiles } = await adminSupabase
      .from('document_files')
      .select('file_path_r2')
      .eq('document_id', documentId);

    const newPaths = new Set(data.files.map((f) => f.file_path_r2));
    if (oldFiles && oldFiles.length > 0) {
      for (const oldFile of oldFiles) {
        if (oldFile.file_path_r2 && !newPaths.has(oldFile.file_path_r2)) {
          await deleteR2Object(oldFile.file_path_r2);
        }
      }
    }

    // Удаляем старые привязанные записи файлов
    await adminSupabase.from('document_files').delete().eq('document_id', documentId);

    if (data.files && data.files.length > 0) {
      const filesToInsert = data.files.map((f) => ({
        company_id: ctx.companyId,
        document_id: documentId,
        category_id: f.category_id,
        file_name: f.file_name,
        file_size: f.file_size || '1.5 MB',
        file_type: f.file_type || 'pdf',
        file_path_r2: f.file_path_r2 || null,
        description: f.description || `Прикрепленный скан ${f.file_name}`,
        comment: f.comment || null,
        is_internal: false,
        is_legal_doc: false,
      }));

      await adminSupabase.from('document_files').insert(filesToInsert);
    }

    // 3. Запись аудита
    await adminSupabase.from('document_logs').insert({
      document_id: documentId,
      user_id: ctx.userId,
      old_status: doc.status,
      new_status: targetStatus,
      comment: targetStatus === 'sent' ? 'Черновик отредактирован и отправлен получателю' : 'Черновик отредактирован',
    });

    revalidatePath(`/dashboard/documents/${documentId}`);
    revalidatePath('/dashboard/documents');
    revalidatePath('/dashboard/files');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой полного редактирования черновика';
    return { success: false, error: errorMsg };
  }
}

// Отзыв отправленного документа отправителем
export async function recallB2BDocumentAction(documentId: string): Promise<ActionResponse> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    const adminSupabase = await createAdminClient();

    const { data: doc } = await adminSupabase
      .from('documents')
      .select('sender_company_id, status')
      .eq('id', documentId)
      .single();

    if (!doc) {
      return { success: false, error: 'Документ не найден' };
    }

    if (doc.sender_company_id !== ctx.companyId) {
      return { success: false, error: 'Только компания-отправитель может отозвать документ' };
    }

    if (doc.status !== 'sent') {
      return { success: false, error: 'Отозвать можно только документы в статусе "Отправлено"' };
    }

    // Возвращаем в статус черновика
    const { error: updateError } = await adminSupabase
      .from('documents')
      .update({
        status: 'draft',
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    if (updateError) {
      return { success: false, error: `Ошибка отзыва документа: ${updateError.message}` };
    }

    // Запись аудита
    await adminSupabase.from('document_logs').insert({
      document_id: documentId,
      user_id: ctx.userId,
      old_status: 'sent',
      new_status: 'draft',
      comment: 'Документ отозван отправителем для исправления ошибок',
    });

    revalidatePath(`/dashboard/documents/${documentId}`);
    revalidatePath('/dashboard/documents');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при отзыве документа';
    return { success: false, error: errorMsg };
  }
}

export async function createB2BDocumentAction(data: B2BDocumentInput): Promise<ActionResponse<Document>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не привязан к организации-отправителю' };
    }

    const validation = b2bDocumentSchema.safeParse(data);
    if (!validation.success) {
      const errStr = validation.error.issues.map((i) => i.message).join(', ');
      return { success: false, error: errStr };
    }

    const { receiver_company_id, doc_number, doc_date, doc_type, status, comment, files } =
      validation.data;

    const supabase = await createClient();
    const adminSupabase = await createAdminClient();

    // 1. Создаем документ
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .insert({
        company_id: ctx.companyId,
        author_id: ctx.userId,
        sender_company_id: ctx.companyId,
        receiver_company_id,
        doc_number: doc_number || null,
        doc_date,
        doc_type,
        status: status || 'draft',
        comment: comment || null,
        mock_file_name: files[0]?.file_name || null,
        mock_file_size: files[0]?.file_size || null,
      })
      .select()
      .single();

    if (docError || !doc) {
      return { success: false, error: `Ошибка создания документа: ${docError?.message}` };
    }

    // 2. Вставляем прикрепленные файлы
    if (files && files.length > 0) {
      const filesToInsert = files.map((f) => ({
        company_id: ctx.companyId,
        document_id: doc.id,
        category_id: f.category_id,
        file_name: f.file_name,
        file_size: f.file_size || '1.5 MB',
        file_type: f.file_type || 'pdf',
        file_path_r2: f.file_path_r2 || null,
        description: f.description || `Прикрепленный скан ${f.file_name}`,
        comment: f.comment || null,
        is_internal: false,
        is_legal_doc: false,
      }));

      const { error: filesError } = await adminSupabase.from('document_files').insert(filesToInsert);

      if (filesError) {
        return { success: false, error: `Ошибка сохранения прикрепленных файлов: ${filesError.message}` };
      }
    }

    // 3. Запись в логах аудита
    await supabase.from('document_logs').insert({
      document_id: doc.id,
      user_id: ctx.userId,
      old_status: null,
      new_status: doc.status,
      comment: doc.status === 'sent' ? 'Документ отправлен адресату' : 'Документ сохранен как черновик',
    });

    revalidatePath('/dashboard/documents');
    revalidatePath('/dashboard/files');
    return { success: true, data: doc as Document };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при создании документа';
    return { success: false, error: errorMsg };
  }
}

export async function updateB2BDocumentStatusAction(
  documentId: string,
  newStatus: DocumentStatus,
  comment?: string
): Promise<ActionResponse> {
  try {
    const ctx = await getUserContext();
    if (!ctx) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const adminSupabase = await createAdminClient();

    const { data: doc } = await adminSupabase
      .from('documents')
      .select('status, sender_company_id, receiver_company_id')
      .eq('id', documentId)
      .single();

    if (!doc) {
      return { success: false, error: 'Документ не найден' };
    }

    const oldStatus = doc.status;

    // Обновляем статус через Admin Client
    const { error: updateError } = await adminSupabase
      .from('documents')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    if (updateError) {
      return { success: false, error: `Ошибка смены статуса: ${updateError.message}` };
    }

    // Запись аудита
    await adminSupabase.from('document_logs').insert({
      document_id: documentId,
      user_id: ctx.userId,
      old_status: oldStatus,
      new_status: newStatus,
      comment: comment || `Статус изменен на "${newStatus}"`,
    });

    revalidatePath(`/dashboard/documents/${documentId}`);
    revalidatePath('/dashboard/documents');
    revalidatePath('/dashboard/files');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при смене статуса документа';
    return { success: false, error: errorMsg };
  }
}

export async function deleteB2BDocumentAction(documentId: string): Promise<ActionResponse> {
  try {
    const ctx = await getUserContext();
    if (!ctx) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const adminSupabase = await createAdminClient();

    const { error } = await adminSupabase
      .from('documents')
      .delete()
      .eq('id', documentId);

    if (error) {
      return { success: false, error: `Ошибка удаления документа: ${error.message}` };
    }

    revalidatePath('/dashboard/documents');
    revalidatePath('/dashboard/files');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при удалении документа';
    return { success: false, error: errorMsg };
  }
}
