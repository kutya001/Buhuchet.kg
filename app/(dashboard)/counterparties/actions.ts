'use server';

import { createClient } from '@/lib/supabase/server';
import { counterpartySchema } from '@/types/counterparty.types';
import type { ActionResponse, Counterparty } from '@/types/database.types';
import { revalidatePath } from 'next/cache';

async function getUserCompanyId(): Promise<{ userId: string; companyId: string } | null> {
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

  if (!profile?.company_id) return null;
  return { userId: user.id, companyId: profile.company_id };
}

export async function createCounterpartyAction(
  formData: FormData
): Promise<ActionResponse<Counterparty>> {
  try {
    const session = await getUserCompanyId();
    if (!session) {
      return { success: false, error: 'Пользователь не авторизован или не привязан к компании' };
    }

    const rawName = formData.get('name')?.toString() || '';
    const rawInn = formData.get('inn')?.toString() || '';
    const rawIsVatPayer = formData.get('is_vat_payer') === 'on' || formData.get('is_vat_payer') === 'true';
    const rawPhone = formData.get('phone')?.toString() || '';
    const rawComment = formData.get('comment')?.toString() || '';

    const validation = counterpartySchema.safeParse({
      name: rawName,
      inn: rawInn,
      is_vat_payer: rawIsVatPayer,
      phone: rawPhone,
      comment: rawComment,
    });

    if (!validation.success) {
      const errStr = validation.error.issues.map((i) => i.message).join(', ');
      return { success: false, error: errStr };
    }

    const { name, inn, is_vat_payer, phone, comment } = validation.data;
    const supabase = await createClient();

    const { data: counterparty, error } = await supabase
      .from('counterparties')
      .insert({
        company_id: session.companyId,
        name,
        inn,
        is_vat_payer,
        phone: phone || null,
        comment: comment || null,
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: `Ошибка создания контрагента: ${error.message}` };
    }

    revalidatePath('/dashboard/counterparties');
    return { success: true, data: counterparty as Counterparty };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при создании контрагента';
    return { success: false, error: errorMsg };
  }
}

export async function updateCounterpartyAction(
  formData: FormData
): Promise<ActionResponse<Counterparty>> {
  try {
    const session = await getUserCompanyId();
    if (!session) {
      return { success: false, error: 'Пользователь не авторизован или не привязан к компании' };
    }

    const id = formData.get('id')?.toString() || '';
    const rawName = formData.get('name')?.toString() || '';
    const rawInn = formData.get('inn')?.toString() || '';
    const rawIsVatPayer = formData.get('is_vat_payer') === 'on' || formData.get('is_vat_payer') === 'true';
    const rawPhone = formData.get('phone')?.toString() || '';
    const rawComment = formData.get('comment')?.toString() || '';

    if (!id) {
      return { success: false, error: 'Не указан ID контрагента' };
    }

    const validation = counterpartySchema.safeParse({
      id,
      name: rawName,
      inn: rawInn,
      is_vat_payer: rawIsVatPayer,
      phone: rawPhone,
      comment: rawComment,
    });

    if (!validation.success) {
      const errStr = validation.error.issues.map((i) => i.message).join(', ');
      return { success: false, error: errStr };
    }

    const { name, inn, is_vat_payer, phone, comment } = validation.data;
    const supabase = await createClient();

    const { data: counterparty, error } = await supabase
      .from('counterparties')
      .update({
        name,
        inn,
        is_vat_payer,
        phone: phone || null,
        comment: comment || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('company_id', session.companyId)
      .select()
      .single();

    if (error) {
      return { success: false, error: `Ошибка обновления контрагента: ${error.message}` };
    }

    revalidatePath('/dashboard/counterparties');
    return { success: true, data: counterparty as Counterparty };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при обновлении контрагента';
    return { success: false, error: errorMsg };
  }
}

export async function deleteCounterpartyAction(id: string): Promise<ActionResponse> {
  try {
    const session = await getUserCompanyId();
    if (!session) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from('counterparties')
      .delete()
      .eq('id', id)
      .eq('company_id', session.companyId);

    if (error) {
      return { success: false, error: `Ошибка удаления: ${error.message}` };
    }

    revalidatePath('/dashboard/counterparties');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при удалении';
    return { success: false, error: errorMsg };
  }
}
