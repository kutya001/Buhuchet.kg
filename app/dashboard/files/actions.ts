'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { r2Client, r2BucketName } from '@/lib/r2';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ActionResponse } from '@/types/database.types';

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

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const uniqueId = Math.random().toString(36).substring(2, 10);

    // Нормализация MIME-типа для мобильных устройств (iOS / Android)
    let cleanContentType = (fileType || '').split(';')[0].trim().toLowerCase();
    if (!cleanContentType || cleanContentType === 'application/octet-stream') {
      if (fileName.endsWith('.pdf')) {
        cleanContentType = 'application/pdf';
      } else if (fileName.match(/\.(png|jpg|jpeg|webp|heic|heif)$/i)) {
        cleanContentType = 'image/jpeg';
      } else {
        cleanContentType = 'image/jpeg';
      }
    }

    // Безопасное имя файла
    const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileKey = `companies/${ctx.companyId}/${year}/${month}/${uniqueId}-${safeFileName}`;

    // Составляем команду PUT со строгим ContentType
    const command = new PutObjectCommand({
      Bucket: r2BucketName,
      Key: fileKey,
      ContentType: cleanContentType,
    });

    // Ссылка действительна 15 минут
    const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 900 });

    return {
      success: true,
      data: {
        uploadUrl,
        fileKey,
        cleanContentType,
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

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const uniqueId = Math.random().toString(36).substring(2, 10);
    const safeFileName = (file.name || 'scan.jpg').replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileKey = `companies/${ctx.companyId}/${year}/${month}/${uniqueId}-${safeFileName}`;

    let cleanContentType = (file.type || '').split(';')[0].trim().toLowerCase();
    if (!cleanContentType || cleanContentType === 'application/octet-stream') {
      cleanContentType = safeFileName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
    }

    await r2Client.send(
      new PutObjectCommand({
        Bucket: r2BucketName,
        Key: fileKey,
        Body: buffer,
        ContentType: cleanContentType,
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
        .from('document_files')
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
