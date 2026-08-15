'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { r2Client, r2BucketName, getPresignedDownloadUrl, deleteR2Object } from '@/lib/r2';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ActionResponse } from '@/types/database.types';
import { createSafeAction } from '@/lib/auth/safe-action';
import { z } from 'zod';

async function getUserContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('users')
    .select('company_id, is_super_admin')
    .eq('id', user.id)
    .single();

  return {
    userId: user.id,
    companyId: profile?.company_id || 'system',
    isSuperAdmin: !!profile?.is_super_admin,
  };
}

import { validateFileMetadata, MAX_FILE_SIZE_BYTES } from '@/lib/files/validation';

/**
 * Генерация Presigned PUT URL для прямой загрузки скана из браузера в Cloudflare R2
 */
export async function getPresignedUploadUrlAction(
  fileName: string,
  fileType: string
): Promise<ActionResponse<{ uploadUrl: string; fileKey: string; cleanContentType: string }>> {
  try {
    const ctx = await getUserContext();
    if (!ctx) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const validation = validateFileMetadata(fileName, fileType);
    if (!validation.valid) {
      return { success: false, error: validation.error || 'Недопустимый тип файла' };
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const uniqueId = Math.random().toString(36).substring(2, 10);

    // Безопасное имя файла
    const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileKey = `companies/${ctx.companyId}/${year}/${month}/${uniqueId}-${safeFileName}`;

    // Составляем команду PUT со строгим ContentType
    const command = new PutObjectCommand({
      Bucket: r2BucketName,
      Key: fileKey,
      ContentType: validation.cleanContentType,
    });

    // Ссылка действительна 15 минут с явным подписанием content-type
    const uploadUrl = await getSignedUrl(r2Client, command, {
      expiresIn: 900,
      unhoistableHeaders: new Set(['content-type']),
    });

    return {
      success: true,
      data: {
        uploadUrl,
        fileKey,
        cleanContentType: validation.cleanContentType,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой генерации ссылки загрузки R2';
    return { success: false, error: errorMsg };
  }
}

/**
 * СЕРВЕРНЫЙ ПРОКСИ-ЗАГРУЗЧИК ФАЙЛОВ В CLOUDFLARE R2 (ФОЛЛБЭК ДЛЯ МОБИЛЬНЫХ БРАУЗЕРОВ И CORS ОГРАНИЧЕНИЙ)
 */
export async function uploadFileDirectlyServerAction(
  formData: FormData
): Promise<ActionResponse<{ fileKey: string }>> {
  try {
    const ctx = await getUserContext();
    if (!ctx) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    const file = formData.get('file') as File;
    if (!file) {
      return { success: false, error: 'Файл не передан в форму' };
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return { success: false, error: 'Размер файла превышает лимит 25 МБ' };
    }

    const validation = validateFileMetadata(file.name || 'scan.jpg', file.type);
    if (!validation.valid) {
      return { success: false, error: validation.error || 'Недопустимый формат файла' };
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const uniqueId = Math.random().toString(36).substring(2, 10);
    const safeFileName = (file.name || 'scan.jpg').replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileKey = `companies/${ctx.companyId}/${year}/${month}/${uniqueId}-${safeFileName}`;

    await r2Client.send(
      new PutObjectCommand({
        Bucket: r2BucketName,
        Key: fileKey,
        Body: buffer,
        ContentType: validation.cleanContentType,
      })
    );

    return {
      success: true,
      data: {
        fileKey,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой серверной загрузки R2';
    return { success: false, error: errorMsg };
  }
}

/**
 * Генерация Presigned GET URL для просмотра / скачивания скана из Cloudflare R2
 */
export async function getPresignedDownloadUrlAction(
  fileKey: string
): Promise<ActionResponse<{ downloadUrl: string }>> {
  try {
    const ctx = await getUserContext();
    if (!ctx) {
      return { success: false, error: 'Пользователь не авторизован' };
    }

    if (!fileKey) {
      return { success: false, error: 'Ключ файла в R2 не указан' };
    }

    // Проверка прав изоляции доступа к файлу R2 по базе данных
    if (!ctx.isSuperAdmin && ctx.companyId) {
      const adminSupabase = await createAdminClient();
      const { data: fileDoc } = await adminSupabase
        .from('files')
        .select('company_id, document_id')
        .eq('file_path_r2', fileKey)
        .maybeSingle();

      if (fileDoc && fileDoc.company_id !== ctx.companyId) {
        // Проверяем, может компания является получателем/отправителем соответствующего документа
        if (fileDoc.document_id) {
          const { data: doc } = await adminSupabase
            .from('documents')
            .select('sender_company_id, receiver_company_id')
            .eq('id', fileDoc.document_id)
            .maybeSingle();

          if (doc && doc.sender_company_id !== ctx.companyId && doc.receiver_company_id !== ctx.companyId) {
            return { success: false, error: 'Доступ запрещен: файл принадлежит другой организации' };
          }
        } else {
          return { success: false, error: 'Доступ запрещен: файл принадлежит другой организации' };
        }
      }
    }

    const command = new GetObjectCommand({
      Bucket: r2BucketName,
      Key: fileKey,
    });

    // Ссылка просмотра действительна 60 минут
    const downloadUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });

    return {
      success: true,
      data: {
        downloadUrl,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой получения ссылки скачивания R2';
    return { success: false, error: errorMsg };
  }
}

/**
 * Получение ссылки онлайн-просмотра файла (inline + UTF-8 charset)
 */
export async function getFileViewUrlAction(
  fileKey: string,
  fileName?: string
): Promise<ActionResponse<{ viewUrl: string }>> {
  try {
    const ctx = await getUserContext();
    if (!ctx) return { success: false, error: 'Пользователь не авторизован' };
    if (!fileKey) return { success: false, error: 'Ключ файла не указан' };

    const viewUrl = await getPresignedDownloadUrl(fileKey, 3600, 'view', fileName);
    return { success: true, data: { viewUrl } };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой получения ссылки просмотра';
    return { success: false, error: errorMsg };
  }
}

/**
 * Получение ссылки прямого скачивания файла на ПК (attachment + UTF-8 filename)
 */
export async function getFileDownloadUrlAction(
  fileKey: string,
  fileName?: string
): Promise<ActionResponse<{ downloadUrl: string }>> {
  try {
    const ctx = await getUserContext();
    if (!ctx) return { success: false, error: 'Пользователь не авторизован' };
    if (!fileKey) return { success: false, error: 'Ключ файла не указан' };

    const downloadUrl = await getPresignedDownloadUrl(fileKey, 3600, 'download', fileName);
    return { success: true, data: { downloadUrl } };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Сбой получения ссылки скачивания';
    return { success: false, error: errorMsg };
  }
}

const processPendingDeletionsSchema = z.object({
  limit: z.number().optional().default(50),
});

/**
 * Обработка очереди физического удаления осиротевших объектов с облачного диска
 */
export const processPendingFileDeletionsAction = createSafeAction(
  processPendingDeletionsSchema,
  async (data) => {
    const adminSupabase = await createAdminClient();

    const { data: pendingItems, error } = await adminSupabase
      .from('pending_file_deletions')
      .select('id, storage_key')
      .order('created_at', { ascending: true })
      .limit(data.limit || 50);

    if (error) {
      return { success: false, error: `Ошибка чтения очереди очистки диска: ${error.message}` };
    }

    if (!pendingItems || pendingItems.length === 0) {
      return { success: true, data: { processedCount: 0 } };
    }

    let processedCount = 0;
    for (const item of pendingItems) {
      if (item.storage_key) {
        // Физическое удаление из хранилища (игнорирует ошибки если файла нет в R2)
        await deleteR2Object(item.storage_key);
      }

      // Всегда удаляем обработанную запись из очереди pending_file_deletions
      await adminSupabase.from('pending_file_deletions').delete().eq('id', item.id);
      processedCount++;
    }

    return {
      success: true,
      data: { processedCount },
    };
  }
);
