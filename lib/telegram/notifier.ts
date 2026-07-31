import { createAdminClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/auth/permissions';
import type { ActionName } from '@/lib/auth/permissions';

export type TelegramNotificationType = 'documents' | 'collaboration' | 'system_block';

export interface NotifyTelegramParams {
  companyId: string;
  type: TelegramNotificationType;
  message: string;
  targetUserId?: string;
}

/**
 * Отправка сообщения конкретному Telegram Chat ID
 */
export async function sendTelegramMessage(chatId: number | string, text: string): Promise<boolean> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.warn('[Telegram Notifier] TELEGRAM_BOT_TOKEN не задан в переменных окружения');
      return false;
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      }),
    });

    return res.ok;
  } catch (err) {
    console.error('[Telegram Notifier] Ошибка запроса к Telegram API:', err);
    return false;
  }
}

/**
 * Диспетчер рассылки уведомлений с учетом матрицы прав (RBAC) пользователей компании
 */
export async function sendTelegramNotification({
  companyId,
  type,
  message,
  targetUserId,
}: NotifyTelegramParams): Promise<void> {
  try {
    const supabase = await createAdminClient();

    let query = supabase
      .from('telegram_connections')
      .select('*, user:users(*, company_roles(*))')
      .eq('company_id', companyId);

    if (targetUserId) {
      query = query.eq('user_id', targetUserId);
    }

    const { data: connections, error } = await query;
    if (error || !connections || connections.length === 0) {
      return;
    }

    let requiredAction: ActionName | null = null;
    if (type === 'documents') requiredAction = 'notify_documents';
    if (type === 'collaboration') requiredAction = 'notify_collaboration';

    for (const conn of connections) {
      const userProfile = Array.isArray(conn.user) ? conn.user[0] : conn.user;
      if (!userProfile) continue;

      // Если событие системное (блокировка), отправляем всем без исключения.
      // Иначе проверяем наличие соответствующего права у сотрудника.
      if (type !== 'system_block' && requiredAction) {
        const canReceive = hasPermission(userProfile, 'employees', requiredAction);
        if (!canReceive) continue;
      }

      await sendTelegramMessage(conn.telegram_chat_id, message);
    }
  } catch (err) {
    console.error('[Telegram Notifier] Ошибка рассылки уведомления:', err);
  }
}
