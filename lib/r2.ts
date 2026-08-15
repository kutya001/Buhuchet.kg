import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const accountId = process.env.R2_ACCOUNT_ID || '';
const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
const customEndpoint = process.env.R2_ENDPOINT;

const endpoint = customEndpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');

export const r2BucketName = process.env.R2_BUCKET_NAME || 'buhuchet-scans';

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: endpoint || undefined,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  // Отключаем принудительное добавление параметров контрольных сумм в Presigned URL для совместимости с браузерами
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

function getContentTypeAndDisposition(fileKey: string, fileName?: string, mode: 'view' | 'download' = 'view') {
  const name = fileName || fileKey.split('/').pop() || 'file';
  const ext = (name.split('.').pop() || '').toLowerCase();

  let contentType = 'application/octet-stream';
  if (ext === 'pdf') contentType = 'application/pdf';
  else if (ext === 'png') contentType = 'image/png';
  else if (['jpg', 'jpeg'].includes(ext)) contentType = 'image/jpeg';
  else if (ext === 'webp') contentType = 'image/webp';
  else if (ext === 'txt') contentType = 'text/plain; charset=utf-8';
  else if (ext === 'csv') contentType = 'text/csv; charset=utf-8';
  else if (ext === 'md') contentType = 'text/markdown; charset=utf-8';
  else if (ext === 'json') contentType = 'application/json; charset=utf-8';
  else if (ext === 'xml') contentType = 'text/xml; charset=utf-8';
  else if (ext === 'html') contentType = 'text/html; charset=utf-8';

  let contentDisposition = 'inline';
  if (mode === 'download') {
    const encodedName = encodeURIComponent(name);
    contentDisposition = `attachment; filename*=UTF-8''${encodedName}`;
  } else {
    contentDisposition = 'inline';
  }

  return { contentType, contentDisposition };
}

/**
 * Создание Presigned URL для прямой загрузки файла (PUT) в Cloudflare R2
 */
export async function createPresignedUploadUrl({
  key,
  contentType,
  expiresInSeconds = 900,
}: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<{ uploadUrl: string; key: string }> {
  const command = new PutObjectCommand({
    Bucket: r2BucketName,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(r2Client, command, {
    expiresIn: expiresInSeconds,
    unhoistableHeaders: new Set(['content-type']),
  });

  return { uploadUrl, key };
}

/**
 * Генерация пресайн URL для просмотра (inline UTF-8) или скачивания (attachment) файла из R2
 */
export async function getPresignedDownloadUrl(
  fileKey: string,
  expiresInSeconds = 3600,
  mode: 'view' | 'download' = 'view',
  fileName?: string
): Promise<string> {
  const { contentType, contentDisposition } = getContentTypeAndDisposition(fileKey, fileName, mode);

  const command = new GetObjectCommand({
    Bucket: r2BucketName,
    Key: fileKey,
    ResponseContentType: contentType,
    ResponseContentDisposition: contentDisposition,
  });

  return getSignedUrl(r2Client, command, { expiresIn: expiresInSeconds });
}

/**
 * Физическое удаление файла из Cloudflare R2
 */
export async function deleteR2Object(fileKey: string): Promise<boolean> {
  try {
    if (!fileKey) return false;
    const command = new DeleteObjectCommand({
      Bucket: r2BucketName,
      Key: fileKey,
    });
    await r2Client.send(command);
    return true;
  } catch (err) {
    console.error('Ошибка удаления объекта из R2:', err);
    return false;
  }
}

/**
 * Пакетное удаление до 1000 файлов из Cloudflare R2 за один запрос
 */
export async function deleteR2ObjectsBatch(fileKeys: string[]): Promise<{ deletedCount: number; errors: string[] }> {
  try {
    const validKeys = fileKeys.filter(Boolean);
    if (validKeys.length === 0) return { deletedCount: 0, errors: [] };

    // S3 DeleteObjectsCommand принимает до 1000 объектов за запрос
    const chunkSize = 1000;
    let totalDeleted = 0;
    const errors: string[] = [];

    for (let i = 0; i < validKeys.length; i += chunkSize) {
      const chunk = validKeys.slice(i, i + chunkSize);
      const command = new DeleteObjectsCommand({
        Bucket: r2BucketName,
        Delete: {
          Objects: chunk.map((k) => ({ Key: k })),
          Quiet: true,
        },
      });

      const res = await r2Client.send(command);
      if (res.Errors && res.Errors.length > 0) {
        res.Errors.forEach((e) => errors.push(`${e.Key}: ${e.Message}`));
        totalDeleted += chunk.length - res.Errors.length;
      } else {
        totalDeleted += chunk.length;
      }
    }

    return { deletedCount: totalDeleted, errors };
  } catch (err) {
    console.error('Ошибка пакетного удаления объектов из R2:', err);
    return { deletedCount: 0, errors: [err instanceof Error ? err.message : 'Сбой пакетного удаления'] };
  }
}

