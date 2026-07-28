'use server';

import { createClient } from '@/lib/supabase/server';
import { b2bDocumentSchema } from '@/types/b2b.types';
import type { ActionResponse, Document, DocumentStatus, UserRole } from '@/types/database.types';
import { revalidatePath } from 'next/cache';

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

export async function createB2BDocumentAction(data: any): Promise<ActionResponse<Document>> {
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
      return { success: false, error: `Ошибка создания B2B документа: ${docError?.message}` };
    }

    // 2. Вставляем прикрепленные файлы (Мультизагрузка)
    const filesToInsert = files.map((f) => ({
      document_id: doc.id,
      category_id: f.category_id,
      file_name: f.file_name,
      file_size: f.file_size || '1.5 MB',
      file_type: f.file_type || 'pdf',
      description: f.description,
      comment: f.comment || null,
    }));

    const { error: filesError } = await supabase.from('document_files').insert(filesToInsert);

    if (filesError) {
      return { success: false, error: `Ошибка сохранения прикрепленных файлов: ${filesError.message}` };
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
    const errorMsg = err instanceof Error ? err.message : 'Сбой при создании B2B документа';
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

    const supabase = await createClient();

    const { data: doc } = await supabase
      .from('documents')
      .select('status, sender_company_id, receiver_company_id')
      .eq('id', documentId)
      .single();

    if (!doc) {
      return { success: false, error: 'Документ не найден' };
    }

    const oldStatus = doc.status;

    // Обновляем статус
    const { error: updateError } = await supabase
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
    await supabase.from('document_logs').insert({
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

    const supabase = await createClient();

    const { error } = await supabase
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
