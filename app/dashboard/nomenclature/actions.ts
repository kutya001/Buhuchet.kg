'use server';

import { createClient } from '@/lib/supabase/server';
import { nomenclatureSchema } from '@/types/nomenclature.types';
import type { ActionResponse, Nomenclature } from '@/types/database.types';
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

export async function createNomenclatureAction(
  formData: FormData
): Promise<ActionResponse<Nomenclature>> {
  try {
    const session = await getUserCompanyId();
    if (!session) {
      return { success: false, error: 'Пользователь не авторизован или не привязан к компании' };
    }

    const rawTitle = formData.get('title')?.toString() || '';
    const rawCode = formData.get('code')?.toString() || '';
    const rawUnit = formData.get('unit')?.toString() || 'шт';
    const rawPrice = formData.get('price')?.toString() || '0';

    const validation = nomenclatureSchema.safeParse({
      title: rawTitle,
      code: rawCode,
      unit: rawUnit,
      price: rawPrice,
    });

    if (!validation.success) {
      const errStr = validation.error.issues.map((i) => i.message).join(', ');
      return { success: false, error: errStr };
    }

    const { title, code, unit, price } = validation.data;
    const supabase = await createClient();

    const { data: item, error } = await supabase
      .from('nomenclature')
      .insert({
        company_id: session.companyId,
        title,
        code: code || null,
        unit,
        price,
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: `Ошибка создания товара: ${error.message}` };
    }

    revalidatePath('/dashboard/nomenclature');
    return { success: true, data: item as Nomenclature };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при создании товара';
    return { success: false, error: errorMsg };
  }
}

export async function updateNomenclatureAction(
  formData: FormData
): Promise<ActionResponse<Nomenclature>> {
  try {
    const session = await getUserCompanyId();
    if (!session) {
      return { success: false, error: 'Пользователь не авторизован или не привязан к компании' };
    }

    const id = formData.get('id')?.toString() || '';
    const rawTitle = formData.get('title')?.toString() || '';
    const rawCode = formData.get('code')?.toString() || '';
    const rawUnit = formData.get('unit')?.toString() || 'шт';
    const rawPrice = formData.get('price')?.toString() || '0';

    if (!id) {
      return { success: false, error: 'Не указан ID товара' };
    }

    const validation = nomenclatureSchema.safeParse({
      id,
      title: rawTitle,
      code: rawCode,
      unit: rawUnit,
      price: rawPrice,
    });

    if (!validation.success) {
      const errStr = validation.error.issues.map((i) => i.message).join(', ');
      return { success: false, error: errStr };
    }

    const { title, code, unit, price } = validation.data;
    const supabase = await createClient();

    const { data: item, error } = await supabase
      .from('nomenclature')
      .update({
        title,
        code: code || null,
        unit,
        price,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('company_id', session.companyId)
      .select()
      .single();

    if (error) {
      return { success: false, error: `Ошибка обновления товара: ${error.message}` };
    }

    revalidatePath('/dashboard/nomenclature');
    return { success: true, data: item as Nomenclature };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при обновлении товара';
    return { success: false, error: errorMsg };
  }
}

export async function deleteNomenclatureAction(id: string): Promise<ActionResponse> {
  try {
    const session = await getUserCompanyId();
    if (!session) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from('nomenclature')
      .delete()
      .eq('id', id)
      .eq('company_id', session.companyId);

    if (error) {
      return { success: false, error: `Ошибка удаления товара: ${error.message}` };
    }

    revalidatePath('/dashboard/nomenclature');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой при удалении товара';
    return { success: false, error: errorMsg };
  }
}
