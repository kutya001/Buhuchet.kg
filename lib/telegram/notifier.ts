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
  eventType?: string;
  metadata?: Record<string, any>;
}

/**
 * Асинхронное логирование уведомления в telegram_notification_logs
 */
export async function logTelegramNotification(params: {
  recipientUserId?: string | null;
  recipientChatId: string | number;
  eventType: string;
  messageText: string;
  status: 'sent' | 'failed' | 'pending';
  errorMessage?: string | null;
  metadata?: Record<string, any>;
}): Promise<void> {
  try {
    const adminSupabase = await createAdminClient();
    await adminSupabase.from('telegram_notification_logs').insert({
      recipient_user_id: params.recipientUserId || null,
      recipient_chat_id: String(params.recipientChatId),
      event_type: params.eventType,
      message_text: params.messageText,
      status: params.status,
      error_message: params.errorMessage || null,
      metadata: params.metadata || {},
      sent_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Telegram Logger] Ошибка логирования оповещения:', err);
  }
}

/**
 * Отправка сообщения конкретному Telegram Chat ID с автоматическим логированием
 */
export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options?: {
    eventType?: string;
    recipientUserId?: string | null;
    metadata?: Record<string, any>;
  }
): Promise<boolean> {
  const eventType = options?.eventType || 'SYSTEM_BROADCAST';
  try {
    const rawToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!rawToken) {
      console.warn('[Telegram Notifier] TELEGRAM_BOT_TOKEN не задан в переменных окружения');
      await logTelegramNotification({
        recipientUserId: options?.recipientUserId,
        recipientChatId: chatId,
        eventType,
        messageText: text,
        status: 'failed',
        errorMessage: 'TELEGRAM_BOT_TOKEN не задан в окружении',
        metadata: options?.metadata,
      });
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

    const isOk = res.ok;
    let errorMsg: string | null = null;
    if (!isOk) {
      const errBody = await res.text();
      errorMsg = `HTTP ${res.status}: ${errBody}`;
    }

    await logTelegramNotification({
      recipientUserId: options?.recipientUserId,
      recipientChatId: chatId,
      eventType,
      messageText: text,
      status: isOk ? 'sent' : 'failed',
      errorMessage: errorMsg,
      metadata: options?.metadata,
    });

    return isOk;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сетевой сбой отправки в Telegram API';
    console.error('[Telegram Notifier] Ошибка запроса к Telegram API:', err);

    await logTelegramNotification({
      recipientUserId: options?.recipientUserId,
      recipientChatId: chatId,
      eventType,
      messageText: text,
      status: 'failed',
      errorMessage: errorMsg,
      metadata: options?.metadata,
    });

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
  eventType,
  metadata,
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

    const finalEventType = eventType || (type === 'documents' ? 'DOCUMENTS_NOTIFY' : 'COLLABORATION_NOTIFY');

    for (const conn of connections) {
      const userProfile = Array.isArray(conn.user) ? conn.user[0] : conn.user;
      if (!userProfile) continue;

      if (type !== 'system_block' && requiredAction) {
        const canReceive = hasPermission(userProfile, 'employees', requiredAction);
        if (!canReceive) continue;
      }

      await sendTelegramMessage(conn.telegram_chat_id, message, {
        eventType: finalEventType,
        recipientUserId: conn.user_id,
        metadata: {
          companyId,
          role: userProfile.role,
          ...metadata,
        },
      });
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
  const docLink = `${baseUrl}/uchet/documents/${documentId}`;
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
    eventType: 'DOC_CREATED',
    message,
    metadata: { documentId, docNumber, docType, senderCompanyName },
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
  const pendingLink = `${baseUrl}/uchet/pending`;
  const nowStr = new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

  const message =
    `🤝 **Новая заявка на сотрудничество!**\n\n` +
    `🏢 **От контрагента:** ${senderCompanyName}\n` +
    `📅 **Дата и время:** ${nowStr}\n\n` +
    `🔗 **Перейти к списку заявок:**\n${pendingLink}`;

  await sendTelegramNotification({
    companyId: targetCompanyId,
    type: 'collaboration',
    eventType: 'COLLABORATION_REQUEST',
    message,
    metadata: { senderCompanyName },
  });
}

/**
 * Уведомление об одобрении запроса на сотрудничество
 */
export async function sendCollaborationConfirmedTelegramNotification({
  requesterCompanyId,
  partnerCompanyName,
}: {
  requesterCompanyId: string;
  partnerCompanyName: string;
}): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://buhuchet.kg';
  const counterpartiesLink = `${baseUrl}/uchet/counterparties`;
  const nowStr = new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

  const message =
    `✅ **Партнерство успешно подтверждено!**\n\n` +
    `🏢 **Организация:** ${partnerCompanyName} приняла ваше предложение о сотрудничестве.\n` +
    `📅 **Дата и время:** ${nowStr}\n\n` +
    `💼 Запись автоматически добавлена в справочник контрагентов. Теперь доступен электронный документооборот!\n\n` +
    `🔗 **Перейти к контрагентам:**\n${counterpartiesLink}`;

  await sendTelegramNotification({
    companyId: requesterCompanyId,
    type: 'collaboration',
    eventType: 'COLLABORATION_CONFIRMED',
    message,
    metadata: { partnerCompanyName },
  });
}

/**
 * Уведомление об отклонении запроса на сотрудничество
 */
export async function sendCollaborationRejectedTelegramNotification({
  requesterCompanyId,
  partnerCompanyName,
}: {
  requesterCompanyId: string;
  partnerCompanyName: string;
}): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://buhuchet.kg';
  const counterpartiesLink = `${baseUrl}/uchet/counterparties`;
  const nowStr = new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

  const message =
    `❌ **Заявка на сотрудничество отклонена**\n\n` +
    `🏢 **Организация:** ${partnerCompanyName} отклонила предложение о сотрудничестве.\n` +
    `📅 **Дата и время:** ${nowStr}\n\n` +
    `🔗 **Просмотреть реестр:**\n${counterpartiesLink}`;

  await sendTelegramNotification({
    companyId: requesterCompanyId,
    type: 'collaboration',
    eventType: 'COLLABORATION_REJECTED',
    message,
    metadata: { partnerCompanyName },
  });
}

/**
 * Уведомление о прекращении партнерства
 */
export async function sendCollaborationTerminatedTelegramNotification({
  targetCompanyId,
  initiatorCompanyName,
}: {
  targetCompanyId: string;
  initiatorCompanyName: string;
}): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://buhuchet.kg';
  const counterpartiesLink = `${baseUrl}/uchet/counterparties`;
  const nowStr = new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

  const message =
    `🚫 **Сотрудничество прекращено**\n\n` +
    `🏢 **Инициатор:** ${initiatorCompanyName}\n` +
    `📅 **Дата и время:** ${nowStr}\n\n` +
    `Партнерская связь разорвана, запись переведена в архив.\n\n` +
    `🔗 **Перейти в модуль:**\n${counterpartiesLink}`;

  await sendTelegramNotification({
    companyId: targetCompanyId,
    type: 'collaboration',
    eventType: 'COLLABORATION_TERMINATED',
    message,
    metadata: { initiatorCompanyName },
  });
}

/**
 * Уведомление о статусе верификации организации суперадминистратором
 */
export async function sendCompanyVerificationTelegramNotification({
  companyId,
  companyName,
  status,
  comment,
}: {
  companyId: string;
  companyName: string;
  status: 'active' | 'requires_changes' | 'blocked';
  comment?: string;
}): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://buhuchet.kg';
  const profileLink = `${baseUrl}/uchet/profile`;

  let title = '';
  let statusText = '';

  if (status === 'active') {
    title = '🎉 **Поздравляем! Верификация пройдена!**';
    statusText = 'Ваша организация успешно одобрена суперадминистратором Buhuchet.kg и активирована для работы.';
  } else if (status === 'requires_changes') {
    title = '⚠️ **Требуется внести изменения в реквизиты**';
    statusText = `Модерация отклонена. Замечание суперадминистратора:\n_${comment || 'Уточните ИНН или уставные сканы'}_`;
  } else {
    title = '🚫 **Организация заблокирована**';
    statusText = `Доступ организации приостановлен. Причина:\n_${comment || 'Нарушение правил использования платформы'}_`;
  }

  const message =
    `${title}\n\n` +
    `🏢 **Организация:** ${companyName}\n` +
    `ℹ️ **Информация:** ${statusText}\n\n` +
    `🔗 **Перейти в профиль организации:**\n${profileLink}`;

  await sendTelegramNotification({
    companyId,
    type: 'system_block',
    eventType: 'COMPANY_VERIFICATION',
    message,
    metadata: { companyName, status, comment },
  });
}

/**
 * Уведомление об обработке / смене статуса документа
 */
export async function sendDocumentStatusTelegramNotification({
  targetCompanyId,
  actorCompanyName,
  docType,
  docNumber,
  newStatus,
  comment,
  documentId,
}: {
  targetCompanyId: string;
  actorCompanyName: string;
  docType: string;
  docNumber: string;
  newStatus: string;
  comment?: string;
  documentId: string;
}): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://buhuchet.kg';
  const docLink = `${baseUrl}/uchet/documents/${documentId}`;
  const nowStr = new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

  const statusMap: Record<string, string> = {
    accepted: '✅ Принят к учету',
    processed: '📂 Обработан бухгалтерской службой',
    recalled: '↩️ Отозван контрагентом',
    requires_changes: '⚠️ Направлен на исправление',
  };

  const statusLabel = statusMap[newStatus] || newStatus;

  const message =
    `🔄 **Изменение статуса первички!**\n\n` +
    `🏢 **От кого:** ${actorCompanyName}\n` +
    `📄 **Документ:** ${docType} № ${docNumber}\n` +
    `🚦 **Новый статус:** ${statusLabel}\n` +
    (comment ? `💬 **Примечание:** _${comment}_\n` : '') +
    `📅 **Дата:** ${nowStr}\n\n` +
    `🔗 **Просмотреть документ:**\n${docLink}`;

  await sendTelegramNotification({
    companyId: targetCompanyId,
    type: 'documents',
    eventType: 'STATUS_CHANGED',
    message,
    metadata: { documentId, docNumber, docType, newStatus, comment },
  });
}
