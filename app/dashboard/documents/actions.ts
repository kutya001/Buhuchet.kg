'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { b2bDocumentSchema } from '@/types/b2b.types';
import type { ActionResponse, Document, DocumentStatus, DocumentType, UserRole } from '@/types/database.types';
import { revalidatePath } from 'next/cache';
import { deleteR2Object } from '@/lib/r2';
import { z } from 'zod';
import { createSafeAction } from '@/lib/auth/safe-action';

import { cache } from 'react';
import { hasPermission, ModuleName, ActionName } from '@/lib/auth/permissions';
import { sendTelegramNotification, sendDocumentTelegramNotification, sendDocumentStatusTelegramNotification } from '@/lib/telegram/notifier';
import { isPeriodClosed } from '@/lib/auth/period-lock';
import { verifyR2FileMagicBytes } from '@/lib/files/validation';

const getUserContext = cache(async () => {
  const supabase = await createClient();
  const adminSupabase = await createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await adminSupabase
    .from('users')
    .select('*, company_roles(*), companies:companies!company_id(*)')
    .eq('id', user.id)
    .single();

  const company = (profile as any)?.companies || null;

  const isBlocked = company?.status === 'blocked' && !profile?.is_super_admin;
  const closedPeriodUntil = company?.closed_period_until || null;

  return {
    userId: user.id,
    companyId: profile?.company_id || null,
    role: (profile?.role || 'manager') as UserRole,
    isSuperAdmin: !!profile?.is_super_admin,
    isCompanyBlocked: isBlocked,
    closedPeriodUntil,
    profile: {
      ...profile,
      companies: company,
    },
    checkPermission: (module: ModuleName, action: ActionName) => {
      if (isBlocked) return false;
      return hasPermission(profile, module, action);
    },
  };
});

// Получение списка документов организации с поддержкой серверной пагинации и фильтрации (PERF-02)
export async function getB2BDocumentsAction(
  page: number = 1,
  limit: number = 50,
  filters?: {
    search?: string;
    tab?: 'all' | 'inbox' | 'outbox' | 'drafts';
    status?: string;
    docType?: string;
  }
): Promise<ActionResponse<{ docs: any[]; totalCount: number; currentCompanyId?: string }>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    if (!ctx.checkPermission('documents', 'view')) {
      return { success: false, error: 'У вашей роли нет разрешения на просмотр документов' };
    }

    const adminSupabase = await createAdminClient();
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const from = (Math.max(page, 1) - 1) * safeLimit;
    const to = from + safeLimit - 1;

    let query = adminSupabase
      .from('documents')
      .select('id, doc_number, doc_date, doc_type, status, total_amount, comment, mock_file_name, mock_file_size, created_at, sender_company_id, receiver_company_id, sender_company:companies!sender_company_id(name, inn), receiver_company:companies!receiver_company_id(name, inn), files(id, file_name, size_bytes), author:users!author_id(full_name)', { count: 'exact' });

    // Фильтрация по направлению (вкладкам)
    if (filters?.tab === 'inbox') {
      query = query.eq('receiver_company_id', ctx.companyId).neq('status', 'draft');
    } else if (filters?.tab === 'outbox') {
      query = query.eq('sender_company_id', ctx.companyId);
    } else if (filters?.tab === 'drafts') {
      query = query.eq('sender_company_id', ctx.companyId).eq('status', 'draft');
    } else {
      query = query.or(`sender_company_id.eq.${ctx.companyId},receiver_company_id.eq.${ctx.companyId}`);
    }

    if (filters?.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }

    if (filters?.docType && filters.docType !== 'all') {
      query = query.eq('doc_type', filters.docType);
    }

    if (filters?.search && filters.search.trim() !== '') {
      const s = filters.search.trim();
      query = query.or(`doc_number.ilike.%${s}%,comment.ilike.%${s}%,mock_file_name.ilike.%${s}%`);
    }

    const { data: docs, count, error } = await query
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

    return {
      success: true,
      data: {
        docs: filteredDocs,
        totalCount: count ?? filteredDocs.length,
        currentCompanyId: ctx.companyId,
      },
    };
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
      .select('*, sender_company:companies!sender_company_id(id, name, inn), receiver_company:companies!receiver_company_id(id, name, inn), counterparties:counterparties!counterparty_id(id, name, inn), author:users!author_id(id, full_name, email, position)')
      .eq('id', docId)
      .maybeSingle();

    if (error || !doc) {
      return { success: false, error: 'Запрошенный документ не найден в системе' };
    }

    if (
      doc.sender_company_id !== ctx.companyId &&
      doc.receiver_company_id !== ctx.companyId &&
      doc.counterparty_id !== ctx.companyId &&
      doc.company_id !== ctx.companyId &&
      !ctx.isSuperAdmin
    ) {
      return { success: false, error: 'У вашей организации нет прав на доступ к данному документу' };
    }

    // Правило: Черновик (draft) не доступен Получателю
    if (doc.status === 'draft' && doc.sender_company_id !== ctx.companyId && !ctx.isSuperAdmin) {
      return { success: false, error: 'Документ в статусе "Черновик" доступен только организации-отправителю' };
    }

    // Параллельная загрузка связанных сканов и истории изменений
    const [{ data: attachedFiles }, { data: logs }] = await Promise.all([
      adminSupabase.from('files').select('*, file_categories(*)').eq('document_id', docId),
      adminSupabase.from('document_logs').select('*, user:users!user_id(full_name)').eq('document_id', docId),
    ]);

    return {
      success: true,
      data: {
        ...doc,
        files: attachedFiles || [],
        document_logs: logs || [],
      },
    };
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

    if (ctx.role !== 'owner' && !ctx.isSuperAdmin && data.doc_date && (await isPeriodClosed(ctx.companyId, data.doc_date))) {
      return {
        success: false,
        error: `Отчетный период за ${new Date(data.doc_date).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })} закрыт. Изменение первички заблокировано (доступ разблокировки есть у Владельца).`,
      };
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
      .select('sender_company_id, status, doc_date')
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

    if (ctx.role !== 'owner' && !ctx.isSuperAdmin && doc.doc_date && (await isPeriodClosed(ctx.companyId, doc.doc_date))) {
      return {
        success: false,
        error: 'Отчетный период за эту дату закрыт. Отзыв документа заблокирован (доступ разблокировки есть у Владельца).',
      };
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

    if (ctx.role !== 'owner' && !ctx.isSuperAdmin && doc_date && (await isPeriodClosed(ctx.companyId, doc_date))) {
      return {
        success: false,
        error: `Отчетный период за ${new Date(doc_date).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })} закрыт. Создание и проведение первички заблокировано (полный доступ разблокировки есть у Владельца).`,
      };
    }

    const supabase = await createClient();
    const adminSupabase = await createAdminClient();

    // 1. Проверяем целостность и сигнатуры всех прикрепляемых файлов R2
    if (files && files.length > 0) {
      for (const f of files) {
        if (f.file_path_r2) {
          const magicCheck = await verifyR2FileMagicBytes(f.file_path_r2);
          if (!magicCheck.valid) {
            return { success: false, error: `Файл ${f.file_name}: ${magicCheck.error || 'недопустимый формат'}` };
          }
        }
      }
    }

    // 2. Атомарное создание документа, файлов и логов в единой транзакции базы данных (ARCH-01)
    const { data: docRaw, error: rpcError } = await adminSupabase.rpc('create_document_atomic', {
      p_company_id: ctx.companyId,
      p_author_id: ctx.userId,
      p_sender_company_id: ctx.companyId,
      p_receiver_company_id: receiver_company_id,
      p_doc_number: doc_number || null,
      p_doc_date: doc_date,
      p_doc_type: doc_type,
      p_status: status || 'draft',
      p_comment: comment || null,
      p_mock_file_name: files[0]?.file_name || null,
      p_mock_file_size: typeof files[0]?.size_bytes === 'number' ? files[0].size_bytes : null,
      p_files: files || [],
    });

    if (rpcError || !docRaw) {
      return { success: false, error: `Ошибка создания документа: ${rpcError?.message || 'Сбой транзакции'}` };
    }

    const doc = docRaw as Document;

    // 4. Отправка подробного Telegram-уведомления организации-получателю
    if (doc.status === 'sent' && data.receiver_company_id) {
      const { data: senderComp } = await adminSupabase
        .from('companies')
        .select('name')
        .eq('id', ctx.companyId)
        .single();

      sendDocumentTelegramNotification({
        receiverCompanyId: data.receiver_company_id,
        senderCompanyName: senderComp?.name || 'Контрагент',
        docType: doc.doc_type,
        docNumber: doc.doc_number || doc.id.slice(0, 8),
        docDate: doc.doc_date,
        status: 'Отправлен',
        documentId: doc.id,
        files: data.files || [],
      }).catch((err) => console.error('[Telegram Notification Error]:', err));
    }

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
      .select('status, doc_date, sender_company_id, receiver_company_id')
      .eq('id', documentId)
      .single();

    if (!doc) {
      return { success: false, error: 'Документ не найден' };
    }

    if (ctx.role !== 'owner' && !ctx.isSuperAdmin && doc.doc_date && (await isPeriodClosed(ctx.companyId, doc.doc_date))) {
      return {
        success: false,
        error: 'Отчетный период закрыт для редактирования. Изменение статуса первички заблокировано (доступ разблокировки есть у Владельца).',
      };
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

    // Telegram-уведомление противоположной стороне
    const targetCompanyId = isSender ? doc.receiver_company_id : doc.sender_company_id;
    if (targetCompanyId) {
      const { data: actorComp } = await adminSupabase
        .from('companies')
        .select('name')
        .eq('id', ctx.companyId)
        .single();

      const { data: fullDoc } = await adminSupabase
        .from('documents')
        .select('doc_type, doc_number')
        .eq('id', documentId)
        .single();

      sendDocumentStatusTelegramNotification({
        targetCompanyId,
        actorCompanyName: actorComp?.name || 'Контрагент',
        docType: fullDoc?.doc_type || 'Первичный документ',
        docNumber: fullDoc?.doc_number || documentId.slice(0, 8),
        newStatus,
        comment,
        documentId,
      }).catch((err) => console.error('[Telegram Notification Error]:', err));
    }

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
      .select('sender_company_id, receiver_company_id, doc_date')
      .eq('id', documentId)
      .single();

    if (!doc) {
      return { success: false, error: 'Документ не найден' };
    }

    if (ctx.role !== 'owner' && !ctx.isSuperAdmin && doc.doc_date && (await isPeriodClosed(ctx.companyId, doc.doc_date))) {
      return {
        success: false,
        error: 'Отчетный период за эту дату закрыт для изменений. Удаление документа заблокировано (доступ разблокировки есть у Владельца).',
      };
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

/**
 * Получение подробной информации о документе ЭДО для формы просмотра
 */
export const getB2BDocumentDetailsAction = createSafeAction(
  z.object({
    id: z.string().uuid().optional(),
    docId: z.string().uuid().optional(),
  }),
  async ({ id, docId }, ctx) => {
    const targetId = docId || id;
    if (!targetId) {
      return { success: false, error: 'Идентификатор документа не указан' };
    }

    const adminSupabase = await createAdminClient();

    const { data: doc, error } = await adminSupabase
      .from('documents')
      .select('*, sender_company:companies!sender_company_id(id, name, inn), receiver_company:companies!receiver_company_id(id, name, inn), counterparties:counterparties!counterparty_id(id, name, inn), author:users!author_id(id, full_name, email, position)')
      .eq('id', targetId)
      .maybeSingle();

    if (error || !doc) {
      return { success: false, error: 'Запрошенный документ не найден в системе' };
    }

    if (
      doc.sender_company_id !== ctx.companyId &&
      doc.receiver_company_id !== ctx.companyId &&
      doc.counterparty_id !== ctx.companyId &&
      doc.company_id !== ctx.companyId &&
      !ctx.isSuperAdmin
    ) {
      return { success: false, error: 'У вас нет прав для просмотра данного документа' };
    }

    // Параллельная загрузка связанных сканов и истории изменений
    const [{ data: attachedFiles }, { data: logs }] = await Promise.all([
      adminSupabase.from('files').select('*, file_categories(*)').eq('document_id', targetId),
      adminSupabase.from('document_logs').select('*, user:users!user_id(full_name)').eq('document_id', targetId),
    ]);

    return {
      success: true,
      data: {
        ...doc,
        files: attachedFiles || [],
        document_logs: logs || [],
      },
    };
  }
);

export const getDocumentDetailsAction = getB2BDocumentDetailsAction;

