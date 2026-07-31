import { createAdminClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/auth/permissions';
import type { ActionName } from '@/lib/auth/permissions';
import { formatBytes } from '@/lib/utils';

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
    const rawToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!rawToken) {
      console.warn('[Telegram Notifier] TELEGRAM_BOT_TOKEN не задан в переменных окружения');
      return false;
    }
    const token = rawToken.trim();

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

/**
 * Форматированное уведомление о Новом Входящем Документе с информацией о контрагенте, файлах и ссылкой
 */
export async function sendDocumentTelegramNotification({
  receiverCompanyId,
  senderCompanyName,
  docType,
  docNumber,
  docDate,
  status,
  documentId,
  files = [],
}: {
  receiverCompanyId: string;
  senderCompanyName: string;
  docType: string;
  docNumber: string;
  docDate: string;
  status: string;
  documentId: string;
  files?: Array<{ file_name: string; size_bytes?: number; file_type?: string; description?: string }>;
}): Promise<void> {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'https://buhuchet.kg');
  const docLink = `${baseUrl}/dashboard/documents/${documentId}`;
  const nowStr = new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

  let filesText = '— Нет прикрепленных файлов';
  if (files && files.length > 0) {
    filesText = files
      .map((f, idx) => {
        const sizeFormatted = f.size_bytes ? formatBytes(f.size_bytes) : '0 Б';
        const typeStr = f.file_type ? f.file_type.toUpperCase() : 'FILE';
        const descStr = f.description ? ` - ${f.description}` : '';
        return `${idx + 1}) \`${f.file_name}\` (${sizeFormatted} | ${typeStr})${descStr}`;
      })
      .join('\n');
  }

  const message =
    `📩 **Поступил новый входящий документ!**\n\n` +
    `🏢 **От контрагента:** ${senderCompanyName}\n` +
    `📄 **Тип документа:** ${docType}\n` +
    `🔢 **Номер:** № ${docNumber}\n` +
    `📅 **Дата и время:** ${nowStr} (${docDate})\n` +
    `🚦 **Статус:** ${status}\n\n` +
    `📎 **Прикрепленные файлы:**\n${filesText}\n\n` +
    `🔗 **Просмотреть документ на платформе:**\n${docLink}`;

  await sendTelegramNotification({
    companyId: receiverCompanyId,
    type: 'documents',
    message,
  });
}

/**
 * Уведомление о новом запросе на сотрудничество
 */
export async function sendCollaborationTelegramNotification({
  targetCompanyId,
  senderCompanyName,
}: {
  targetCompanyId: string;
  senderCompanyName: string;
}): Promise<void> {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'https://buhuchet.kg');
  const pendingLink = `${baseUrl}/dashboard/pending`;
  const nowStr = new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

  const message =
    `🤝 **Новая заявка на сотрудничество!**\n\n` +
    `🏢 **От контрагента:** ${senderCompanyName}\n` +
    `📅 **Дата и время:** ${nowStr}\n\n` +
    `🔗 **Перейти к списку заявок:**\n${pendingLink}`;

  await sendTelegramNotification({
    companyId: targetCompanyId,
    type: 'collaboration',
    message,
  });
}
