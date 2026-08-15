import { r2Client, r2BucketName, deleteR2Object } from '@/lib/r2';
import { GetObjectCommand } from '@aws-sdk/client-s3';

/**
 * Белый список допустимых MIME-типов для бухгалтерских документов и сканов Buhuchet.kg
 */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
] as const;

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MIN_FILE_SIZE_BYTES = 1; // 1 byte

/**
 * Проверка расширения и MIME-типа по белому списку
 */
export function validateFileMetadata(fileName: string, mimeType: string): { valid: boolean; error?: string; cleanContentType: string } {
  const cleanType = (mimeType || '').split(';')[0].trim().toLowerCase();
  const ext = (fileName.split('.').pop() || '').toLowerCase();

  const allowedExtensions = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'xlsx', 'xls'];
  if (!allowedExtensions.includes(ext)) {
    return {
      valid: false,
      error: `Недопустимый формат файла (.${ext}). Разрешены только PDF, PNG, JPG, WEBP, XLSX.`,
      cleanContentType: cleanType,
    };
  }

  let finalContentType = cleanType;
  if (!finalContentType || finalContentType === 'application/octet-stream') {
    if (ext === 'pdf') finalContentType = 'application/pdf';
    else if (['jpg', 'jpeg'].includes(ext)) finalContentType = 'image/jpeg';
    else if (ext === 'png') finalContentType = 'image/png';
    else if (ext === 'webp') finalContentType = 'image/webp';
    else if (ext === 'xlsx') finalContentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    else if (ext === 'xls') finalContentType = 'application/vnd.ms-excel';
  }

  const isAllowed = ALLOWED_MIME_TYPES.some((allowed) => allowed === finalContentType);
  if (!isAllowed) {
    return {
      valid: false,
      error: `Недопустимый MIME-тип контента (${finalContentType}).`,
      cleanContentType: finalContentType,
    };
  }

  return {
    valid: true,
    cleanContentType: finalContentType,
  };
}

/**
 * Верификация сигнатуры (Magic Bytes) загруженного в Cloudflare R2 файла.
 * Читает первые 16 байт напрямую из R2 по диапазону Range: bytes=0-15.
 */
export async function verifyR2FileMagicBytes(fileKey: string, expectedMimeType?: string): Promise<{ valid: boolean; detectedMime?: string; error?: string }> {
  try {
    const command = new GetObjectCommand({
      Bucket: r2BucketName,
      Key: fileKey,
      Range: 'bytes=0-15',
    });

    const response = await r2Client.send(command);
    if (!response.Body) {
      return { valid: false, error: 'Не удалось прочитать заголовок файла из хранилища' };
    }

    const byteArray = await response.Body.transformToByteArray();
    const buffer = Buffer.from(byteArray);

    if (buffer.length < 4) {
      // Файл пустой или поврежден
      await deleteR2Object(fileKey);
      return { valid: false, error: 'Файл поврежден или имеет нулевой размер' };
    }

    // Определение сигнатур (Magic Bytes)
    // 1. PDF: %PDF- (0x25 0x50 0x44 0x46)
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return { valid: true, detectedMime: 'application/pdf' };
    }

    // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return { valid: true, detectedMime: 'image/png' };
    }

    // 3. JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { valid: true, detectedMime: 'image/jpeg' };
    }

    // 4. WebP: RIFF .... WEBP
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer.length >= 12 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return { valid: true, detectedMime: 'image/webp' };
    }

    // 5. ZIP/XLSX: PK.. (0x50 0x4B 0x03 0x04)
    if (buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)) {
      return { valid: true, detectedMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }

    // 6. Старый формат MS Excel (BIFF8/OLE Compound File): D0 CF 11 E0 A1 B1 1A E1
    if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) {
      return { valid: true, detectedMime: 'application/vnd.ms-excel' };
    }

    // Если сигнатура не совпала ни с одним разрешенным форматом — удаляем файл немедленно
    await deleteR2Object(fileKey);
    return {
      valid: false,
      error: 'Фактическая сигнатура файла (Magic Bytes) не соответствует разрешенным типам документов (PDF, PNG, JPG, WEBP, XLSX). Объект удален.',
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Ошибка верификации сигнатуры файла';
    return { valid: false, error: errorMsg };
  }
}
