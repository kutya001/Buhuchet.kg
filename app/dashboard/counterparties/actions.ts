'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { ActionResponse, CompanyPartnership } from '@/types/database.types';
import { revalidatePath } from 'next/cache';

async function getUserContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('users')
    .select('company_id')
    .eq('id', user.id)
    .single();

  return {
    userId: user.id,
    companyId: profile?.company_id || null,
  };
}

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
 * Ответ на заявку (Принять / Отклонить)
 */
export async function respondToPartnershipRequestAction(
  partnershipId: string,
  newStatus: 'approved' | 'rejected'
): Promise<ActionResponse> {
  try {
    const ctx = await getUserContext();
    if (!ctx || !ctx.companyId) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const adminSupabase = await createAdminClient();

    const { data: partnership } = await adminSupabase
      .from('company_partnerships')
      .select('*, requester_company:companies!requester_company_id(*), target_company:companies!target_company_id(*)')
      .eq('id', partnershipId)
      .single();

    if (!partnership) {
      return { success: false, error: 'Заявка на партнерство не найдена' };
    }

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

    // Если заявка одобрена (approved) — автоматически добавляем компании в контрагенты друг друга через Admin Client
    if (newStatus === 'approved') {
      const reqCompany = partnership.requester_company;
      const targetCompany = partnership.target_company;

      if (reqCompany && targetCompany) {
        // 1. Добавляем Target в контрагенты Requester
        await adminSupabase.from('counterparties').upsert(
          {
            company_id: reqCompany.id,
            name: targetCompany.name,
            inn: targetCompany.inn,
            email: targetCompany.email || `contact@${targetCompany.inn}.kg`,
            is_vat_payer: true,
          },
          { onConflict: 'company_id,inn' }
        );

        // 2. Добавляем Requester в контрагенты Target
        await adminSupabase.from('counterparties').upsert(
          {
            company_id: targetCompany.id,
            name: reqCompany.name,
            inn: reqCompany.inn,
            email: reqCompany.email || `contact@${reqCompany.inn}.kg`,
            is_vat_payer: true,
          },
          { onConflict: 'company_id,inn' }
        );
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

    // 2. Удаляем или отключаем запись из таблицы counterparties для текущей компании
    await adminSupabase
      .from('counterparties')
      .delete()
      .eq('company_id', ctx.companyId)
      .eq('id', partnershipIdOrTargetCompanyId);

    revalidatePath('/dashboard/counterparties');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при прекращении сотрудничества';
    return { success: false, error: errorMsg };
  }
}

/**
 * Обновление внутреннего примечания контрагента (notes / comment)
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
