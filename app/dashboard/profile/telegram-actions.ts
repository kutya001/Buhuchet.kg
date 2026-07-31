'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { ActionResponse } from '@/types/database.types';
import { hasPermission } from '@/lib/auth/permissions';
import { revalidatePath } from 'next/cache';

export interface TelegramOtpData {
  code: string;
  deepLink: string;
  expiresAt: string;
}

/**
 * Генерация одноразового 4-значного OTP-кода для связывания Telegram аккаунта
 */
export async function generateTelegramOtpAction(): Promise<ActionResponse<TelegramOtpData>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const { data: profile } = await supabase
      .from('users')
      .select('*, company_roles(*)')
      .eq('id', user.id)
      .single();

    if (!profile || !profile.company_id) {
      return { success: false, error: 'Пользователь не привязан к компании' };
    }

    // Проверка права на привязку Telegram
    const canBind = hasPermission(profile, 'employees', 'telegram_bind');
    if (!canBind) {
      return { success: false, error: 'У вас нет разрешения на привязку Telegram-бота' };
    }

    // 4-значный код (от 1000 до 9999)
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 минут

    const adminSupabase = await createAdminClient();
    const { error: dbError } = await adminSupabase
      .from('telegram_verification_codes')
      .upsert(
        {
          user_id: user.id,
          company_id: profile.company_id,
          code,
          expires_at: expiresAt,
        },
        { onConflict: 'user_id,company_id' }
      );

    if (dbError) {
      return { success: false, error: `Ошибка базы данных: ${dbError.message}` };
    }

    // Автоматическая гарантированная регистрация Webhook в Telegram API
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const siteUrl = process.env.NEXT_PUBLIC_APP_URL
      ? process.env.NEXT_PUBLIC_APP_URL
      : process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://buhuchet.kg';
    if (token) {
      fetch(`https://api.telegram.org/bot${token.trim()}/setWebhook?url=${encodeURIComponent(`${siteUrl}/api/telegram/webhook`)}`).catch(() => {});
    }

    const botName = process.env.NEXT_PUBLIC_TELEGRAM_BOT_NAME || 'BuhuchetKgBot';
    const deepLink = `https://t.me/${botName}`;

    return {
      success: true,
      data: {
        code,
        deepLink,
        expiresAt,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой генерации кода';
    return { success: false, error: errorMsg };
  }
}

/**
 * Получение статуса привязки Telegram аккаунта текущего пользователя
 */
export async function getTelegramConnectionStatusAction(): Promise<ActionResponse<{ isConnected: boolean; username?: string | null }>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const { data: profile } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single();

    if (!profile?.company_id) {
      return { success: true, data: { isConnected: false } };
    }

    const adminSupabase = await createAdminClient();
    const { data: conn } = await adminSupabase
      .from('telegram_connections')
      .select('telegram_username')
      .eq('user_id', user.id)
      .eq('company_id', profile.company_id)
      .maybeSingle();

    return {
      success: true,
      data: {
        isConnected: !!conn,
        username: conn?.telegram_username || null,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой проверки статуса Telegram';
    return { success: false, error: errorMsg };
  }
}

/**
 * Отвязка Telegram аккаунта
 */
export async function disconnectTelegramAction(): Promise<ActionResponse> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const { data: profile } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .single();

    if (!profile?.company_id) {
      return { success: false, error: 'Пользователь не привязан к компании' };
    }

    const adminSupabase = await createAdminClient();
    await adminSupabase
      .from('telegram_connections')
      .delete()
      .eq('user_id', user.id)
      .eq('company_id', profile.company_id);

    revalidatePath('/dashboard/profile');
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой отвязки Telegram';
    return { success: false, error: errorMsg };
  }
}
