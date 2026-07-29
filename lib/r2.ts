import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const accountId = process.env.R2_ACCOUNT_ID || '';
const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
const customEndpoint = process.env.R2_ENDPOINT;

// Формируем эндпоинт Cloudflare R2
const endpoint = customEndpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');

export const r2BucketName = process.env.R2_BUCKET_NAME || 'buhuchet-scans';

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: endpoint || undefined,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

/**
 * Генерация пресайн URL для скачивания файла из Cloudflare R2 (срок 1 час)
 */
export async function getPresignedDownloadUrl(fileKey: string, expiresInSeconds = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: r2BucketName,
    Key: fileKey,
  });

  return getSignedUrl(r2Client, command, { expiresIn: expiresInSeconds });
}
