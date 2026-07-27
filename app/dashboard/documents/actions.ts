'use server';

import { createClient } from '@/lib/supabase/server';
import { documentSchema, documentItemSchema } from '@/types/document.types';
import type { ActionResponse, Document, DocumentStatus, UserRole } from '@/types/database.types';
import { revalidatePath } from 'next/cache';

async function getUserContext(): Promise<{ userId: string; companyId: string; role: UserRole; isSuperAdmin: boolean } | null> {
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

  if (!profile?.company_id) return null;
  return {
    userId: user.id,
    companyId: profile.company_id,
    role: profile.role || 'manager',
    isSuperAdmin: !!profile.is_super_admin,
  };
}

export async function createDocumentAction(
  data: any
): Promise<ActionResponse<Document>> {
  try {
    const ctx = await getUserContext();
    if (!ctx) {
      return { success: false, error: 'Пользователь не авторизован или не привязан к компании' };
    }

    const validation = documentSchema.safeParse(data);
    if (!validation.success) {
      const errStr = validation.error.issues.map((i) => i.message).join(', ');
      return { success: false, error: errStr };
    }

    const {
      counterparty_id,
      doc_number,
      doc_date,
      doc_type,
      status,
      comment,
      mock_file_name,
      mock_file_size,
      mock_file_status,
      items,
    } = validation.data;

    // Рассчитываем итоговую сумму
    const total_amount = items.reduce((sum, item) => sum + item.quantity * item.price, 0);

    const supabase = await createClient();

    // 1. Создаем шапку документа
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .insert({
        company_id: ctx.companyId,
        author_id: ctx.userId,
        counterparty_id: counterparty_id || null,
        doc_number: doc_number || null,
        doc_date,
        doc_type,
        status: status || 'draft',
        total_amount,
        comment: comment || null,
        mock_file_name: mock_file_name || null,
        mock_file_size: mock_file_size || null,
        mock_file_status: mock_file_status || 'uploaded_mock',
      })
      .select()
      .single();

    if (docError || !doc) {
      return { success: false, error: `Ошибка создания документа: ${docError?.message}` };
    }

    // 2. Создаем позиции товаров (document_items)
    if (items.length > 0) {
      const itemsToInsert = items.map((item) => ({
        document_id: doc.id,
        nomenclature_id: item.nomenclature_id || null,
        title: item.title,
        quantity: item.quantity,
        price: item.price,
        total: item.quantity * item.price,
      }));

      const { error: itemsError } = await supabase.from('document_items').insert(itemsToInsert);

      if (itemsError) {
        return { success: false, error: `Ошибка сохранения позиций документа: ${itemsError.message}` };
      }
    }

    // 3. Создаем запись в логах аудита (document_logs)
    await supabase.from('document_logs').insert({
      document_id: doc.id,
      user_id: ctx.userId,
      old_status: null,
      new_status: doc.status,
      comment: 'Документ создан',
    });

    revalidatePath('/dashboard/documents');
    return { success: true, data: doc as Document };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при создании документа';
    return { success: false, error: errorMsg };
  }
}

export async function updateDocumentAction(
  data: any
): Promise<ActionResponse<Document>> {
  try {
    const ctx = await getUserContext();
    if (!ctx) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const { id, items, ...restData } = data;
    if (!id) {
      return { success: false, error: 'Не указан ID документа' };
    }

    const supabase = await createClient();

    // Проверяем текущий документ и его статус
    const { data: existingDoc } = await supabase
      .from('documents')
      .select('status')
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .single();

    if (!existingDoc) {
      return { success: false, error: 'Документ не найден' };
    }

    if (existingDoc.status === 'posted_1c') {
      return { success: false, error: 'Проведенный в 1С документ заблокирован для изменений' };
    }

    const validation = documentSchema.safeParse({ ...restData, items });
    if (!validation.success) {
      const errStr = validation.error.issues.map((i) => i.message).join(', ');
      return { success: false, error: errStr };
    }

    const {
      counterparty_id,
      doc_number,
      doc_date,
      doc_type,
      comment,
      mock_file_name,
      mock_file_size,
    } = validation.data;

    const total_amount = items.reduce((sum: number, item: any) => sum + item.quantity * item.price, 0);

    // 1. Обновляем шапку
    const { data: updatedDoc, error: updateError } = await supabase
      .from('documents')
      .update({
        counterparty_id: counterparty_id || null,
        doc_number: doc_number || null,
        doc_date,
        doc_type,
        total_amount,
        comment: comment || null,
        mock_file_name: mock_file_name || null,
        mock_file_size: mock_file_size || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .select()
      .single();

    if (updateError) {
      return { success: false, error: `Ошибка обновления документа: ${updateError.message}` };
    }

    // 2. Перезаписываем позиции товаров
    await supabase.from('document_items').delete().eq('document_id', id);

    if (items.length > 0) {
      const itemsToInsert = items.map((item: any) => ({
        document_id: id,
        nomenclature_id: item.nomenclature_id || null,
        title: item.title,
        quantity: item.quantity,
        price: item.price,
        total: item.quantity * item.price,
      }));
      await supabase.from('document_items').insert(itemsToInsert);
    }

    revalidatePath(`/dashboard/documents/${id}`);
    revalidatePath('/dashboard/documents');
    return { success: true, data: updatedDoc as Document };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при обновлении документа';
    return { success: false, error: errorMsg };
  }
}

export async function changeDocumentStatusAction(
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
      .select('status, company_id')
      .eq('id', documentId)
      .eq('company_id', ctx.companyId)
      .single();

    if (!doc) {
      return { success: false, error: 'Документ не найден' };
    }

    // Проверка ролевой модели
    if (ctx.role === 'manager' && (newStatus === 'approved' || newStatus === 'posted_1c')) {
      return { success: false, error: 'Менеджер не может утверждать или проводить документы в 1С' };
    }

    const oldStatus = doc.status;

    // Обновляем статус
    const { error: updateError } = await supabase
      .from('documents')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId)
      .eq('company_id', ctx.companyId);

    if (updateError) {
      return { success: false, error: `Ошибка смены статуса: ${updateError.message}` };
    }

    // Логируем изменение
    await supabase.from('document_logs').insert({
      document_id: documentId,
      user_id: ctx.userId,
      old_status: oldStatus,
      new_status: newStatus,
      comment: comment || `Статус изменен с ${oldStatus} на ${newStatus}`,
    });

    revalidatePath(`/dashboard/documents/${documentId}`);
    revalidatePath('/dashboard/documents');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при смене статуса';
    return { success: false, error: errorMsg };
  }
}

export async function deleteDocumentAction(documentId: string): Promise<ActionResponse> {
  try {
    const ctx = await getUserContext();
    if (!ctx) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const supabase = await createClient();

    const { data: doc } = await supabase
      .from('documents')
      .select('status')
      .eq('id', documentId)
      .eq('company_id', ctx.companyId)
      .single();

    if (!doc) {
      return { success: false, error: 'Документ не найден' };
    }

    if (doc.status === 'posted_1c') {
      return { success: false, error: 'Запрещено удалять проведенные в 1С документы' };
    }

    const { error } = await supabase
      .from('documents')
      .delete()
      .eq('id', documentId)
      .eq('company_id', ctx.companyId);

    if (error) {
      return { success: false, error: `Ошибка удаления документа: ${error.message}` };
    }

    revalidatePath('/dashboard/documents');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при удалении документа';
    return { success: false, error: errorMsg };
  }
}
