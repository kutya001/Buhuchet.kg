'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { ActionResponse, Company, CompanyJoinRequest } from '@/types/database.types';
import { sendTelegramMessage } from '@/lib/telegram/notifier';
import { revalidatePath } from 'next/cache';

/**
 * 1. Безопасный поиск активных компаний в КР по ИНН или названию
 */
export async function searchCompanyAction(
  query: string
): Promise<ActionResponse<Array<Partial<Company>>>> {
  try {
    if (!query || query.trim().length < 2) {
      return { success: true, data: [] };
    }

    const adminSupabase = await createAdminClient();
    const cleanQuery = query.trim();

    const { data: companies, error } = await adminSupabase.rpc('search_companies_for_join', {
      search_query: cleanQuery,
    });

    if (error) {
      // Fallback на прямой запрос к таблице companies
      const { data: fallbackCompanies, error: fbErr } = await adminSupabase
        .from('companies')
        .select('id, name, inn, legal_address, director_name, status')
        .eq('status', 'active')
        .or(`name.ilike.%${cleanQuery}%,inn.ilike.%${cleanQuery}%`)
        .limit(20);

      if (fbErr) {
        return { success: false, error: fbErr.message };
      }

      return { success: true, data: fallbackCompanies || [] };
    }

    return { success: true, data: (companies || []) as Array<Partial<Company>> };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой поиска компаний';
    return { success: false, error: errorMsg };
  }
}

/**
 * 2. Подача заявки сотрудником на вступление в компанию (company_join_requests)
 */
export async function submitJoinRequestAction(params: {
  companyId: string;
  positionNote?: string;
}): Promise<ActionResponse<{ requestId: string }>> {
  try {
    const supabase = await createClient();
    const adminSupabase = await createAdminClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    if (!params.companyId) {
      return { success: false, error: 'Не выбрана компания для подачи заявки' };
    }

    // Проверяем, нет ли уже активной заявки со статусом pending в эту же компанию
    const { data: existing } = await adminSupabase
      .from('company_join_requests')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('company_id', params.companyId)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      return { success: false, error: 'Вы уже отправили заявку в эту компанию. Ожидайте рассмотрения.' };
    }

    // Гарантируем наличие записи в public.users перед созданием заявки (защита FK)
    let { data: userProfile } = await adminSupabase
      .from('users')
      .select('full_name, email, phone')
      .eq('id', user.id)
      .maybeSingle();

    if (!userProfile) {
      await adminSupabase.from('users').upsert({
        id: user.id,
        email: user.email!,
        full_name: user.user_metadata?.full_name || 'Сотрудник',
        role: 'manager',
        role_id: null,
        company_id: null,
        is_super_admin: false,
      });
      userProfile = {
        full_name: user.user_metadata?.full_name || 'Сотрудник',
        email: user.email!,
        phone: null,
      };
    }

    // Создаем запись в company_join_requests
    const { data: newRequest, error: reqError } = await adminSupabase
      .from('company_join_requests')
      .insert({
        company_id: params.companyId,
        user_id: user.id,
        position_note: params.positionNote ? params.positionNote.trim() : 'Сотрудник',
        status: 'pending',
      })
      .select('id')
      .single();

    if (reqError || !newRequest) {
      return { success: false, error: `Ошибка создания заявки: ${reqError?.message}` };
    }

    // Безопасная отправка Telegram-уведомления руководству компании
    try {
      const { data: targetCompany } = await adminSupabase
        .from('companies')
        .select('name')
        .eq('id', params.companyId)
        .single();

      const { data: companyConnections } = await adminSupabase
        .from('telegram_connections')
        .select('telegram_chat_id, user:users(role, is_super_admin)')
        .eq('company_id', params.companyId);

      if (companyConnections && companyConnections.length > 0) {
        const nowStr = new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
        const candidateName = userProfile?.full_name || user.email || 'Новый кандидат';
        const posStr = params.positionNote ? params.positionNote.trim() : 'Сотрудник';
        const phoneStr = userProfile?.phone ? `\n📞 **Телефон:** ${userProfile.phone}` : '';
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://buhuchet.kg';
        const manageLink = `${baseUrl}/dashboard/employees`;

        const text =
          `👥 **Новая входящая заявка на вступление в штат!**\n\n` +
          `🏢 **Организация:** ${targetCompany?.name || 'Ваша компания'}\n` +
          `👤 **Кандидат:** ${candidateName}\n` +
          `📧 **Email:** ${userProfile?.email || user.email}\n` +
          `💼 **Желаемая должность:** ${posStr}${phoneStr}\n` +
          `📅 **Дата заявки:** ${nowStr}\n\n` +
          `🔗 **Рассмотреть и принять кандидата:**\n${manageLink}`;

        for (const conn of companyConnections) {
          const u = Array.isArray(conn.user) ? conn.user[0] : conn.user;
          if (u?.role === 'owner' || u?.is_super_admin) {
            await sendTelegramMessage(conn.telegram_chat_id, text);
          }
        }
      }
    } catch (tgErr) {
      console.warn('[Telegram Notification] Не удалось отправить уведомление о заявке:', tgErr);
    }

    revalidatePath('/dashboard/pending');
    revalidatePath('/dashboard/employees');
    return { success: true, data: { requestId: newRequest.id } };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой отправки заявки';
    return { success: false, error: errorMsg };
  }
}

/**
 * 3. Отзыв (отмена) собственной заявки пользователем
 */
export async function cancelJoinRequestAction(
  requestId: string
): Promise<ActionResponse<{ message: string }>> {
  try {
    const supabase = await createClient();
    const adminSupabase = await createAdminClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const { error } = await adminSupabase
      .from('company_join_requests')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .eq('user_id', user.id)
      .eq('status', 'pending');

    if (error) {
      return { success: false, error: `Ошибка отзыва заявки: ${error.message}` };
    }

    revalidatePath('/dashboard/pending');
    revalidatePath('/dashboard/employees');
    return { success: true, data: { message: 'Заявка успешно отозвана' } };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой отзыва заявки';
    return { success: false, error: errorMsg };
  }
}

/**
 * 4. Получение списка заявок текущего пользователя
 */
export async function getMyJoinRequestsAction(): Promise<
  ActionResponse<Array<CompanyJoinRequest & { company_name?: string; company_inn?: string }>>
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

    const { data: requests, error } = await adminSupabase
      .from('company_join_requests')
      .select('*, companies:companies!company_id(name, inn)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return { success: false, error: `Ошибка получения заявок: ${error.message}` };
    }

    const enriched = (requests || []).map((r: any) => {
      const comp = Array.isArray(r.companies) ? r.companies[0] : r.companies;
      return {
        ...r,
        company_name: comp?.name || '—',
        company_inn: comp?.inn || '—',
      };
    });

    return { success: true, data: enriched };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой чтения заявок';
    return { success: false, error: errorMsg };
  }
}
