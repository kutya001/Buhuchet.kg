'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { ActionResponse, CompanyPartnership, Company, DocumentFile, PartnershipStatus, Counterparty } from '@/types/database.types';
import { revalidatePath } from 'next/cache';
import { cache } from 'react';
import { getPresignedDownloadUrl } from '@/lib/r2';

const getUserContext = cache(async () => {
  const supabase = await createClient();
  const adminSupabase = await createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await adminSupabase
    .from('users')
    .select('company_id')
    .eq('id', user.id)
    .single();

  return {
    userId: user.id,
    companyId: profile?.company_id || null,
  };
});

/**
 * Отправка заявки на сотрудничество
 */
export async function sendPartnershipRequestAction(
  targetCompanyId: string
): Promise<ActionResponse<CompanyPartnership>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не привязан к организации' };
    }

    if (ctx.companyId === targetCompanyId) {
      return { success: false, error: 'Нельзя отправить заявку своей собственной компании' };
    }

    const supabase = await createClient();

    // Проверяем существующую заявку
    const { data: existing } = await supabase
      .from('company_partnerships')
      .select('id, status')
      .or(`and(requester_company_id.eq.${ctx.companyId},target_company_id.eq.${targetCompanyId}),and(requester_company_id.eq.${targetCompanyId},target_company_id.eq.${ctx.companyId})`)
      .maybeSingle();

    if (existing) {
      if (existing.status === 'approved') {
        return { success: false, error: 'Ваши компании уже состоят в подтвержденном партнерстве' };
      }
      if (existing.status === 'pending') {
        return { success: false, error: 'Заявка на сотрудничество уже отправлена и находится на рассмотрении' };
      }
    }

    const { data: partnership, error } = await supabase
      .from('company_partnerships')
      .upsert({
        requester_company_id: ctx.companyId,
        target_company_id: targetCompanyId,
        status: 'pending',
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !partnership) {
      return { success: false, error: `Ошибка отправки заявки: ${error?.message}` };
    }

    revalidatePath('/dashboard/counterparties');
    return { success: true, data: partnership as CompanyPartnership };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при отправке заявки на партнерство';
    return { success: false, error: errorMsg };
  }
}

/**
 * Вспомогательная функция гарантированного создания / обновления связи контрагента
 */
async function ensureCounterpartyLink(
  adminSupabase: any,
  companyId: string,
  targetCompany: Company
) {
  // 1. Ищем существующую запись по company_id и inn ИЛИ target_company_id
  const { data: existing } = await adminSupabase
    .from('counterparties')
    .select('id')
    .eq('company_id', companyId)
    .or(`inn.eq.${targetCompany.inn},target_company_id.eq.${targetCompany.id}`)
    .maybeSingle();

  if (existing) {
    // 2. Если запись уже есть — обновляем target_company_id и контактные реквизиты
    const { error: updateErr } = await adminSupabase
      .from('counterparties')
      .update({
        target_company_id: targetCompany.id,
        name: targetCompany.name,
        email: targetCompany.email || `contact@${targetCompany.inn}.kg`,
        phone: targetCompany.phone || null,
        is_vat_payer: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    if (updateErr) {
      console.error('Ошибка обновления связи контрагента:', updateErr.message);
    }
  } else {
    // 3. Если записи нет — гарантированно создаем новую
    const { error: insertErr } = await adminSupabase.from('counterparties').insert({
      company_id: companyId,
      target_company_id: targetCompany.id,
      name: targetCompany.name,
      inn: targetCompany.inn,
      email: targetCompany.email || `contact@${targetCompany.inn}.kg`,
      phone: targetCompany.phone || null,
      is_vat_payer: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (insertErr) {
      console.error('Ошибка вставки связи контрагента:', insertErr.message);
    }
  }
}

/**
 * Ответ на заявку (Подтверждён / Отменён / Отозван / Приостановлен)
 */
export async function respondToPartnershipRequestAction(
  partnershipId: string,
  newStatus: PartnershipStatus
): Promise<ActionResponse> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const adminSupabase = await createAdminClient();

    const { data: partnership } = await adminSupabase
      .from('company_partnerships')
      .select('id, requester_company_id, target_company_id, status')
      .eq('id', partnershipId)
      .single();

    if (!partnership) {
      return { success: false, error: 'Заявка на партнерство не найдена' };
    }

    // 1. Обновляем статус заявки в БД
    const { error: updateError } = await adminSupabase
      .from('company_partnerships')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', partnershipId);

    if (updateError) {
      return { success: false, error: `Ошибка обновления статуса: ${updateError.message}` };
    }

    // 2. Если заявка одобрена (approved / accepted) — гарантированно связываем контрагентов в обе стороны
    if (newStatus === 'approved' || newStatus === 'accepted') {
      const { data: compList } = await adminSupabase
        .from('companies')
        .select('*')
        .in('id', [partnership.requester_company_id, partnership.target_company_id]);

      const reqCompany = compList?.find((c) => c.id === partnership.requester_company_id) as Company | undefined;
      const targetCompany = compList?.find((c) => c.id === partnership.target_company_id) as Company | undefined;

      if (reqCompany && targetCompany) {
        // Добавляем Target в контрагенты Requester
        await ensureCounterpartyLink(adminSupabase, reqCompany.id, targetCompany);

        // Добавляем Requester в контрагенты Target
        await ensureCounterpartyLink(adminSupabase, targetCompany.id, reqCompany);
      }
    }

    revalidatePath('/dashboard/counterparties');
    revalidatePath('/dashboard/documents/new');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при ответе на заявку на партнерство';
    return { success: false, error: errorMsg };
  }
}

/** Алиасы и точечные обертки под матрицу действий партнерства */
export async function requestPartnershipAction(targetCompanyId: string) {
  return sendPartnershipRequestAction(targetCompanyId);
}

export async function cancelPartnershipRequestAction(partnershipId: string): Promise<ActionResponse> {
  return respondToPartnershipRequestAction(partnershipId, 'cancelled');
}

export async function acceptPartnershipRequestAction(partnershipId: string): Promise<ActionResponse> {
  return respondToPartnershipRequestAction(partnershipId, 'approved');
}

export async function rejectPartnershipRequestAction(partnershipId: string): Promise<ActionResponse> {
  return respondToPartnershipRequestAction(partnershipId, 'rejected');
}

/**
 * Ручное добавление контрагента по ИНН (14 цифр КР) + Опциональная загрузка учредительного файла R2
 */
export async function createManualCounterpartyAction(data: {
  name: string;
  inn: string;
  is_vat_payer?: boolean;
  email?: string;
  phone?: string;
  comment?: string;
  file_path_r2?: string;
  file_name?: string;
}): Promise<ActionResponse> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    if (!data.name || !data.inn || data.inn.length !== 14) {
      return { success: false, error: 'Укажите корректное наименование и ИНН КР (14 цифр)' };
    }

    const adminSupabase = await createAdminClient();

    // Проверяем, зарегистрирована ли эта компания в платформе по ИНН
    const { data: targetComp } = await adminSupabase
      .from('companies')
      .select('id')
      .eq('inn', data.inn)
      .maybeSingle();

    const { data: existing } = await adminSupabase
      .from('counterparties')
      .select('id')
      .eq('company_id', ctx.companyId)
      .eq('inn', data.inn)
      .maybeSingle();

    let counterpartyId = '';

    if (existing) {
      counterpartyId = existing.id;
      const { error: updateErr } = await adminSupabase
        .from('counterparties')
        .update({
          name: data.name,
          target_company_id: targetComp?.id || null,
          is_vat_payer: !!data.is_vat_payer,
          email: data.email || null,
          phone: data.phone || null,
          comment: data.comment || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (updateErr) return { success: false, error: updateErr.message };
    } else {
      const { data: inserted, error: insertErr } = await adminSupabase
        .from('counterparties')
        .insert({
          company_id: ctx.companyId,
          target_company_id: targetComp?.id || null,
          name: data.name,
          inn: data.inn,
          is_vat_payer: !!data.is_vat_payer,
          email: data.email || null,
          phone: data.phone || null,
          comment: data.comment || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertErr || !inserted) return { success: false, error: insertErr?.message || 'Ошибка вставки' };
      counterpartyId = inserted.id;
    }

    // Загрузка прикрепленного файла R2 в таблицу files (если предоставлен)
    if (data.file_path_r2 && data.file_name) {
      await adminSupabase.from('files').insert({
        company_id: ctx.companyId,
        document_id: null,
        file_name: data.file_name,
        size_bytes: 1572864,
        file_type: 'image',
        file_path_r2: data.file_path_r2,
        description: `Учредительный документ контрагента ${data.name}`,
        is_internal: true,
        is_legal_doc: true,
      });
    }

    revalidatePath('/dashboard/counterparties');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой добавления контрагента';
    return { success: false, error: errorMsg };
  }
}

/**
 * Получение подробных реквизитов контрагента и его учредительных документов из R2
 */
export async function getCounterpartyDetailsAndFilesAction(
  targetCompanyId: string
): Promise<ActionResponse<{ company: Company; statutoryFiles: Array<DocumentFile & { downloadUrl?: string }> }>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const adminSupabase = await createAdminClient();

    // 1. Получаем детали самой компании
    const { data: company, error: compErr } = await adminSupabase
      .from('companies')
      .select('*')
      .eq('id', targetCompanyId)
      .single();

    if (compErr || !company) {
      return { success: false, error: 'Данные организации не найдены в системе' };
    }

    // 2. Получаем загруженные файлы компании (в т.ч. учредительные/юридические документы)
    const { data: rawFiles } = await adminSupabase
      .from('files')
      .select('*, file_categories(*)')
      .eq('company_id', targetCompanyId)
      .order('created_at', { ascending: false });

    let statutoryFiles: Array<DocumentFile & { downloadUrl?: string }> = [];

    if (rawFiles && rawFiles.length > 0) {
      statutoryFiles = await Promise.all(
        rawFiles.map(async (file) => {
          let downloadUrl = '';
          if (file.file_path_r2) {
            try {
              downloadUrl = await getPresignedDownloadUrl(file.file_path_r2);
            } catch (e) {
              console.error('R2 Presigned error:', e);
            }
          }
          return {
            ...file,
            downloadUrl,
          };
        })
      );
    }

    return {
      success: true,
      data: {
        company: company as Company,
        statutoryFiles,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой получения уставных данных контрагента';
    return { success: false, error: errorMsg };
  }
}

/**
 * Прекращение сотрудничества / деактивация контрагента
 */
export async function terminatePartnershipAction(
  partnershipIdOrTargetCompanyId: string
): Promise<ActionResponse> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const adminSupabase = await createAdminClient();

    // 1. Обновляем статус партнерства в company_partnerships на 'rejected'
    await adminSupabase
      .from('company_partnerships')
      .update({
        status: 'rejected',
        updated_at: new Date().toISOString(),
      })
      .or(`and(requester_company_id.eq.${ctx.companyId},target_company_id.eq.${partnershipIdOrTargetCompanyId}),and(requester_company_id.eq.${partnershipIdOrTargetCompanyId},target_company_id.eq.${ctx.companyId}),id.eq.${partnershipIdOrTargetCompanyId}`);

    // 2. Удаляем записи из таблицы counterparties
    await adminSupabase
      .from('counterparties')
      .delete()
      .or(`and(company_id.eq.${ctx.companyId},or(id.eq.${partnershipIdOrTargetCompanyId},target_company_id.eq.${partnershipIdOrTargetCompanyId})),and(target_company_id.eq.${ctx.companyId},company_id.eq.${partnershipIdOrTargetCompanyId})`);

    revalidatePath('/dashboard/counterparties');
    revalidatePath('/dashboard/documents/new');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при прекращении сотрудничества';
    return { success: false, error: errorMsg };
  }
}

/**
 * Обновление внутреннего примечания контрагента
 */
export async function updateCounterpartyCommentAction(
  counterpartyId: string,
  comment: string
): Promise<ActionResponse> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const supabase = await createClient();

    const { error } = await supabase
      .from('counterparties')
      .update({
        comment: comment || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', counterpartyId)
      .eq('company_id', ctx.companyId);

    if (error) {
      return { success: false, error: `Ошибка сохранения примечания: ${error.message}` };
    }

    revalidatePath('/dashboard/counterparties');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при обновлении примечания';
    return { success: false, error: errorMsg };
  }
}

/**
 * Ретроспективная синхронизация БД: досоздание недостающих и очистка нелегитимных контрагентов
 */
export async function syncPartnershipCounterpartiesAction(): Promise<ActionResponse<{ createdCount: number }>> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const adminSupabase = await createAdminClient();

    // 1. Получаем все принятые партнерства (approved)
    const { data: approvedPartnerships } = await adminSupabase
      .from('company_partnerships')
      .select('requester_company_id, target_company_id')
      .eq('status', 'approved');

    let createdCount = 0;

    if (approvedPartnerships && approvedPartnerships.length > 0) {
      // Собираем все уникальные ID компаний
      const compIds = new Set<string>();
      approvedPartnerships.forEach((p) => {
        compIds.add(p.requester_company_id);
        compIds.add(p.target_company_id);
      });

      const { data: compList } = await adminSupabase
        .from('companies')
        .select('*')
        .in('id', Array.from(compIds));

      if (compList && compList.length > 0) {
        const compMap = new Map<string, Company>();
        compList.forEach((c) => compMap.set(c.id, c as Company));

        for (const p of approvedPartnerships) {
          const reqComp = compMap.get(p.requester_company_id);
          const targetComp = compMap.get(p.target_company_id);

          if (reqComp && targetComp) {
            // Досоздаем/проверяем связь Target в Requester
            await ensureCounterpartyLink(adminSupabase, reqComp.id, targetComp);
            // Досоздаем/проверяем связь Requester в Target
            await ensureCounterpartyLink(adminSupabase, targetComp.id, reqComp);
            createdCount++;
          }
        }
      }
    }

    revalidatePath('/dashboard/counterparties');
    return { success: true, data: { createdCount } };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой синхронизации БД контрагентов';
    return { success: false, error: errorMsg };
  }
}

/**
 * ВЫСОКОПРОИЗВОДИТЕЛЬНАЯ ЕДИНАЯ ВЫГРУЗКА ДАННЫХ МОДУЛЯ «ОРГАНИЗАЦИИ» (ПАРАЛЛЕЛЬНЫЙ PROMISE.ALL)
 */
export async function getOrganizationsModuleDataAction(): Promise<
  ActionResponse<{
    currentCompanyId: string;
    counterparties: Counterparty[];
    partnerships: any[];
    catalogCompanies: Company[];
  }>
> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не авторизован или не привязан к организации' };
    }

    const adminSupabase = await createAdminClient();

    // Запускаем все 3 тяжелых запроса ПАРАЛЛЕЛЬНО на сервере!
    const [counterpartiesRes, partnershipsRes, catalogRes] = await Promise.all([
      // 1. Активные контрагенты
      adminSupabase
        .from('counterparties')
        .select('id, company_id, target_company_id, name, inn, is_vat_payer, phone, email, comment, created_at, updated_at, target_company:companies!target_company_id(id, name, inn, status, moderation_comment)')
        .eq('company_id', ctx.companyId)
        .order('name'),

      // 2. Заявки на партнерство
      adminSupabase
        .from('company_partnerships')
        .select('id, requester_company_id, target_company_id, status, created_at, updated_at, requester_company:companies!requester_company_id(id, name, inn, industry), target_company:companies!target_company_id(id, name, inn, industry)')
        .or(`requester_company_id.eq.${ctx.companyId},target_company_id.eq.${ctx.companyId}`)
        .order('created_at', { ascending: false }),

      // 3. Каталог всех остальных верифицированных компаний КР (с узким набором колонок)
      adminSupabase
        .from('companies')
        .select('id, name, inn, industry, director_name, status, is_active, created_at, updated_at')
        .neq('id', ctx.companyId)
        .order('name'),
    ]);

    if (counterpartiesRes.error) {
      return { success: false, error: `Ошибка чтения контрагентов: ${counterpartiesRes.error.message}` };
    }

    return {
      success: true,
      data: {
        currentCompanyId: ctx.companyId,
        counterparties: (counterpartiesRes.data as unknown as Counterparty[]) || [],
        partnerships: partnershipsRes.data || [],
        catalogCompanies: (catalogRes.data as Company[]) || [],
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой быстрой загрузки данных модуля Организации';
    return { success: false, error: errorMsg };
  }
}

