'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { ActionResponse } from '@/types/database.types';
import { sendTelegramMessage } from '@/lib/telegram/notifier';
import { revalidatePath } from 'next/cache';

export interface TelegramAdminStatsData {
  connections: Array<{
    id: string;
    user_id: string;
    company_id: string;
    telegram_chat_id: number;
    telegram_username?: string | null;
    created_at: string;
    user_full_name?: string | null;
    user_email?: string | null;
    company_name?: string | null;
    company_inn?: string | null;
  }>;
  codes: Array<{
    id: string;
    user_id: string;
    company_id: string;
    code: string;
    expires_at: string;
    created_at: string;
    user_full_name?: string | null;
    company_name?: string | null;
    status_label: '🟢 Ожидает ввода' | '🔴 Истёк по времени' | '✅ Подключен';
  }>;
  logs: Array<{
    id: string;
    chat_id?: number | null;
    username?: string | null;
    message_text?: string | null;
    status?: string | null;
    error_message?: string | null;
    created_at: string;
  }>;
}

export interface TelegramBotHealthData {
  ok: boolean;
  botInfo?: {
    id: number;
    first_name: string;
    username: string;
    can_join_groups: boolean;
  } | null;
  webhookInfo?: {
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
    last_error_date?: number | null;
    last_error_message?: string | null;
    max_connections?: number;
  } | null;
  error?: string;
}

/**
 * Проверка Суперадмина
 */
async function checkSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Неавторизован');

  const { data: prof } = await supabase
    .from('users')
    .select('is_super_admin')
    .eq('id', user.id)
    .single();

  if (!prof?.is_super_admin) {
    throw new Error('Доступ разрешен только Суперадминистратору');
  }
}

/**
 * Загрузка полных данных реестра Telegram (Привязки, Коды, Логи)
 */
export async function getTelegramAdminStatsAction(): Promise<ActionResponse<TelegramAdminStatsData>> {
  try {
    await checkSuperAdmin();
    const adminSupabase = await createAdminClient();

    // 1. Привязанные аккаунты
    const { data: connRaw } = await adminSupabase
      .from('telegram_connections')
      .select('*, user:users(*), company:companies(*)')
      .order('created_at', { ascending: false });

    const connections = (connRaw || []).map((c: any) => {
      const u = Array.isArray(c.user) ? c.user[0] : c.user;
      const comp = Array.isArray(c.company) ? c.company[0] : c.company;
      return {
        id: c.id,
        user_id: c.user_id,
        company_id: c.company_id,
        telegram_chat_id: c.telegram_chat_id,
        telegram_username: c.telegram_username,
        created_at: c.created_at,
        user_full_name: u?.full_name || '—',
        user_email: u?.email || '—',
        company_name: comp?.name || '—',
        company_inn: comp?.inn || '—',
      };
    });

    // 2. Все кодовые сгенерированные записи
    const { data: codesRaw } = await adminSupabase
      .from('telegram_verification_codes')
      .select('*, user:users(*), company:companies(*)')
      .order('created_at', { ascending: false });

    const now = new Date();

    const codes = (codesRaw || []).map((cd: any) => {
      const u = Array.isArray(cd.user) ? cd.user[0] : cd.user;
      const comp = Array.isArray(cd.company) ? cd.company[0] : cd.company;
      const isExpired = new Date(cd.expires_at) < now;

      // Проверяем, есть ли уже привязка у этого юзера
      const isAlreadyConnected = connections.some((c) => c.user_id === cd.user_id && c.company_id === cd.company_id);

      let status_label: '🟢 Ожидает ввода' | '🔴 Истёк по времени' | '✅ Подключен' = '🟢 Ожидает ввода';
      if (isAlreadyConnected) {
        status_label = '✅ Подключен';
      } else if (isExpired) {
        status_label = '🔴 Истёк по времени';
      }

      return {
        id: cd.id,
        user_id: cd.user_id,
        company_id: cd.company_id,
        code: cd.code,
        expires_at: cd.expires_at,
        created_at: cd.created_at,
        user_full_name: u?.full_name || '—',
        company_name: comp?.name || '—',
        status_label,
      };
    });

    // 3. Последние 100 логов сообщений
    const { data: logsRaw } = await adminSupabase
      .from('telegram_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    return {
      success: true,
      data: {
        connections,
        codes,
        logs: logsRaw || [],
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой получения статистики';
    return { success: false, error: errorMsg };
  }
}

/**
 * Проверка здоровья Telegram-бота (getMe & getWebhookInfo)
 */
export async function testTelegramBotHealthAdminAction(): Promise<ActionResponse<TelegramBotHealthData>> {
  try {
    await checkSuperAdmin();
    const rawToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!rawToken) {
      return {
        success: false,
        error: 'TELEGRAM_BOT_TOKEN не задан в переменных окружения Vercel',
      };
    }
    const token = rawToken.trim();

    // 1. Проверка ботаgetMe
    const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const meData = await meRes.json();

    // 2. Проверка Webhook
    const hookRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const hookData = await hookRes.json();

    if (!meData.ok) {
      return {
        success: false,
        error: `Ошибка Telegram API getMe: ${meData.description || 'Невалидный токен'}`,
      };
    }

    return {
      success: true,
      data: {
        ok: meData.ok && hookData.ok,
        botInfo: meData.result,
        webhookInfo: hookData.result,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой проверки здоровья бота';
    return { success: false, error: errorMsg };
  }
}

/**
 * Принудительная установка Webhook URL в Telegram API
 */
export async function forceSetTelegramWebhookAdminAction(targetUrl?: string): Promise<ActionResponse<{ webhookUrl: string }>> {
  try {
    await checkSuperAdmin();
    const rawToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!rawToken) {
      return { success: false, error: 'TELEGRAM_BOT_TOKEN не задан в Vercel' };
    }
    const token = rawToken.trim();

    const siteUrl = targetUrl
      ? targetUrl
      : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://buhuchet.kg';

    const webhookUrl = `${siteUrl}/api/telegram/webhook`;

    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
    const data = await res.json();

    if (!data.ok) {
      return { success: false, error: `Telegram API Ошибка: ${data.description}` };
    }

    revalidatePath('/super-admin');
    return { success: true, data: { webhookUrl } };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой регистрации Webhook';
    return { success: false, error: errorMsg };
  }
}

/**
 * Ручная отправка тестового сообщения суперадмином
 */
export async function sendAdminTestTelegramMessageAction(chatId: number, text: string): Promise<ActionResponse> {
  try {
    await checkSuperAdmin();
    const ok = await sendTelegramMessage(chatId, `🧪 **ТЕСТОВОЕ СООБЩЕНИЕ АДМИНИСТРАТОРА**\n\n${text}`);
    if (!ok) {
      return { success: false, error: 'Не удалось отправить сообщение в Telegram Chat ID' };
    }
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой отправки теста';
    return { success: false, error: errorMsg };
  }
}

/**
 * Отвязка пользователя суперадминистратором
 */
export async function disconnectUserTelegramAdminAction(connectionId: string): Promise<ActionResponse> {
  try {
    await checkSuperAdmin();
    const adminSupabase = await createAdminClient();

    const { error } = await adminSupabase
      .from('telegram_connections')
      .delete()
      .eq('id', connectionId);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath('/super-admin');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой отвязки';
    return { success: false, error: errorMsg };
  }
}
