'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { b2bDocumentSchema } from '@/types/b2b.types';
import type { ActionResponse, Document, DocumentStatus, DocumentType, UserRole } from '@/types/database.types';
import { revalidatePath } from 'next/cache';
import { deleteR2Object } from '@/lib/r2';
import { z } from 'zod';

import { cache } from 'react';
import { hasPermission, ModuleName, ActionName } from '@/lib/auth/permissions';

const getUserContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('users')
    .select('*, company_roles(*), companies(*)')
    .eq('id', user.id)
    .single();

  const company = Array.isArray(profile?.companies) ? profile?.companies[0] : profile?.companies;
  const isBlocked = company?.status === 'blocked' && !profile?.is_super_admin;

  return {
    userId: user.id,
    companyId: profile?.company_id || null,
    role: (profile?.role || 'manager') as UserRole,
    isSuperAdmin: !!profile?.is_super_admin,
    isCompanyBlocked: isBlocked,
    profile,
    checkPermission: (module: ModuleName, action: ActionName) => {
      if (isBlocked) return false;
      return hasPermission(profile, module, action);
    },
  };
});

// Получение списка документов организации с поддержкой серверной пагинации
export async function getB2BDocumentsAction(
  page: number = 1,
  limit: number = 50
): Promise<ActionResponse<{ docs: any[]; totalCount: number }>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    if (!ctx.checkPermission('documents', 'view')) {
      return { success: false, error: 'У вашей роли нет разрешения на просмотр документов' };
    }

    const adminSupabase = await createAdminClient();
    const from = (page - 1) * limit;
    const to = page * limit - 1;

    const { data: docs, count, error } = await adminSupabase
      .from('documents')
      .select('id, doc_number, doc_date, doc_type, status, total_amount, comment, mock_file_name, mock_file_size, created_at, sender_company_id, receiver_company_id, sender_user_id, receiver_user_id, sender_company:companies!sender_company_id(name, inn), receiver_company:companies!receiver_company_id(name, inn), files(id, file_name, size_bytes), sender_user:users!sender_user_id(full_name, position), receiver_user:users!receiver_user_id(full_name, position), users(full_name)', { count: 'exact' })
      .or(`sender_company_id.eq.${ctx.companyId},receiver_company_id.eq.${ctx.companyId}`)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      return { success: false, error: `Ошибка загрузки реестра документов: ${error.message}` };
    }

    // Правило: Черновик (draft) может видеть только Отправитель
    const filteredDocs = (docs || []).filter((doc: any) => {
      if (doc.status === 'draft' && doc.receiver_company_id === ctx.companyId && doc.sender_company_id !== ctx.companyId && !ctx.isSuperAdmin) {
        return false;
      }
      return true;
    });

    return { success: true, data: { docs: filteredDocs, totalCount: filteredDocs.length } };
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
      .select('*, sender_company:companies!sender_company_id(*), receiver_company:companies!receiver_company_id(*), sender_user:users!sender_user_id(full_name, position), receiver_user:users!receiver_user_id(full_name, position), files(*, file_categories(*)), document_logs(*, users(full_name)), users(full_name)')
      .eq('id', docId)
      .single();

    if (error || !doc) {
      return { success: false, error: 'Документ не найден или у вас нет прав на его просмотр' };
    }

    if (doc.sender_company_id !== ctx.companyId && doc.receiver_company_id !== ctx.companyId && !ctx.isSuperAdmin) {
      return { success: false, error: 'У вашей организации нет прав на доступ к данному документу' };
    }

    // Правило: Черновик (draft) не доступен Получателю
    if (doc.status === 'draft' && doc.sender_company_id !== ctx.companyId && !ctx.isSuperAdmin) {
      return { success: false, error: 'Документ в статусе "Черновик" доступен только организации-отправителю' };
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
      size_bytes: number;
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
      return { success: false, error: 'Редактировать документ может только организация-отправитель' };
    }

    if (doc.status !== 'draft' && doc.status !== 'recalled') {
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
        mock_file_size: typeof data.files[0]?.size_bytes === 'number' ? data.files[0].size_bytes : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    if (updateError) {
      return { success: false, error: `Ошибка обновления черновика: ${updateError.message}` };
    }

    // 2. Получаем текущие привязанные файлы для безопасного удаления из R2 при полной замене
    const { data: oldFiles } = await adminSupabase
      .from('files')
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
    await adminSupabase.from('files').delete().eq('document_id', documentId);

    if (data.files && data.files.length > 0) {
      const filesToInsert = data.files.map((f) => ({
        company_id: ctx.companyId,
        document_id: documentId,
        category_id: f.category_id,
        file_name: f.file_name,
        size_bytes: typeof f.size_bytes === 'number' ? f.size_bytes : 1572864,
        file_type: f.file_type || 'pdf',
        file_path_r2: f.file_path_r2 || null,
        description: f.description || `Прикрепленный скан ${f.file_name}`,
        comment: f.comment || null,
        is_internal: false,
        is_legal_doc: false,
      }));

      await adminSupabase.from('files').insert(filesToInsert);
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

// Отзыв отправленного документа отправителем (перевод в recalled)
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
      return { success: false, error: 'Отозвать можно только документы в статусе "Отправлен"' };
    }

    // Переводим в статус 'recalled'
    const { error: updateError } = await adminSupabase
      .from('documents')
      .update({
        status: 'recalled',
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
      new_status: 'recalled',
      comment: 'Документ отозван отправителем',
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

    if (ctx.isCompanyBlocked) {
      return { success: false, error: 'Организация заблокирована Администратором' };
    }

    if (!ctx.checkPermission('documents', 'create')) {
      return { success: false, error: 'У вашей роли нет разрешения на создание документов' };
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
        sender_user_id: ctx.userId,
        receiver_company_id,
        doc_number: doc_number || null,
        doc_date,
        doc_type,
        status: status || 'draft',
        comment: comment || null,
        mock_file_name: files[0]?.file_name || null,
        mock_file_size: typeof files[0]?.size_bytes === 'number' ? files[0].size_bytes : null,
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
        size_bytes: typeof f.size_bytes === 'number' ? f.size_bytes : 1572864,
        file_type: f.file_type || 'pdf',
        file_path_r2: f.file_path_r2 || null,
        description: f.description || `Прикрепленный скан ${f.file_name}`,
        comment: f.comment || null,
        is_internal: false,
        is_legal_doc: false,
      }));

      const { error: filesError } = await adminSupabase.from('files').insert(filesToInsert);

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
    if (!ctx || !ctx.companyId) {
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
    const isSender = doc.sender_company_id === ctx.companyId;
    const isReceiver = doc.receiver_company_id === ctx.companyId;

    if (!isSender && !isReceiver && !ctx.isSuperAdmin) {
      return { success: false, error: 'У вашей организации нет прав на смену статуса этого документа' };
    }

    // 🔍 ПРАВИЛА И РАЗГРАНИЧЕНИЯ ПРАВ ПО СТАТУСАМ

    // 1. Черновик (draft):
    if (oldStatus === 'draft') {
      if (!isSender && !ctx.isSuperAdmin) {
        return { success: false, error: 'Получатель не имеет доступа к черновикам' };
      }
      if (newStatus !== 'sent') {
        return { success: false, error: 'Из статуса Черновик документ можно только Отправить' };
      }
    }

    // 2. Отправлен (sent):
    else if (oldStatus === 'sent') {
      if (isSender && !isReceiver && !ctx.isSuperAdmin) {
        if (newStatus !== 'recalled') {
          return { success: false, error: 'Отправитель может только отозвать отправленный документ' };
        }
      } else if (isReceiver) {
        if (newStatus !== 'accepted' && newStatus !== 'recalled') {
          return { success: false, error: 'Получатель может принять документ или отправить обратно на статус Отозван' };
        }
      }
    }

    // 3. Отозван (recalled):
    else if (oldStatus === 'recalled') {
      if (isReceiver && !ctx.isSuperAdmin) {
        return { success: false, error: 'Получатель не может изменять статус отозванного документа' };
      }
      if (isSender) {
        if (newStatus !== 'draft') {
          return { success: false, error: 'Отозванный документ отправитель может только перевести в Черновик' };
        }
      }
    }

    // 4. Принят (accepted):
    else if (oldStatus === 'accepted') {
      if (isSender && !isReceiver && !ctx.isSuperAdmin) {
        return { success: false, error: 'Отправитель не может изменять статус принятого документа' };
      }
      if (isReceiver) {
        if (newStatus !== 'processed' && newStatus !== 'recalled') {
          return { success: false, error: 'Принятый документ получатель может перевести в "Обработан" или отправить обратно в "Отозван"' };
        }
      }
    }

    // 5. Обработан (processed):
    else if (oldStatus === 'processed') {
      if (!ctx.isSuperAdmin) {
        return { success: false, error: 'Обработанный документ нельзя изменять' };
      }
    }

    const updatePayload: Record<string, any> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };

    if (isReceiver && (newStatus === 'accepted' || newStatus === 'processed')) {
      updatePayload.receiver_user_id = ctx.userId;
    }

    // Обновляем статус через Admin Client
    const { error: updateError } = await adminSupabase
      .from('documents')
      .update(updatePayload)
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
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const adminSupabase = await createAdminClient();

    const { data: doc } = await adminSupabase
      .from('documents')
      .select('sender_company_id, receiver_company_id')
      .eq('id', documentId)
      .single();

    if (!doc) {
      return { success: false, error: 'Документ не найден' };
    }

    if (doc.sender_company_id !== ctx.companyId && doc.receiver_company_id !== ctx.companyId && !ctx.isSuperAdmin) {
      return { success: false, error: 'Доступ запрещен: у вашей организации нет прав на удаление этого документа' };
    }

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
