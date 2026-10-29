import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { filePreviewKind } from '@buhuchet/domain';
import type { StorageConfig } from './config';

/**
 * Хранилище файлов. Код работает с ним только через этот интерфейс, по протоколу S3:
 * Supabase Storage (S3-доступ) в первом выпуске, MinIO или Cloudflare R2 на VPS.
 * Браузер получает файл только по временной подписанной ссылке после проверки права.
 */
export interface Storage {
  put(key: string, body: Uint8Array | string, options: { contentType: string }): Promise<void>;
  /** Содержимое файла для обработки на сервере (разбор PDF и т. п.); нет файла — null. */
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /**
   * Временная ссылка на скачивание (только после проверки права). Файл отдаётся вложением, а не
   * открывается в браузере: загруженный HTML или SVG не выполнится на домене хранилища. `inline` —
   * просмотр в окне (Файловый менеджер): только картинки и PDF (`filePreviewKind`), и тип ответа
   * — этот, а не тот, что лежит у файла.
   */
  signedDownloadUrl(
    key: string,
    options: { expiresInSeconds: number; fileName?: string; inline?: { contentType: string } },
  ): Promise<string>;
  /**
   * Временная ссылка на загрузку одного файла запросом `PUT` из браузера, мимо API (тело запроса к API
   * ограничено). Размер и тип подписаны: файл другого размера или с другим типом хранилище не примет.
   * Заголовки ответа браузер передаёт вместе с файлом.
   */
  signedUploadUrl(
    key: string,
    options: { expiresInSeconds: number; contentType: string; size: number },
  ): Promise<{ url: string; headers: Record<string, string> }>;
  /** Размер и тип лежащего файла (проверка после загрузки браузером); нет файла — null. */
  stat(key: string): Promise<{ size: number; contentType: string | null } | null>;
  /** Проверка доступности корзины (страница «здоровья»). */
  ping(): Promise<void>;
  /** Создать корзину, если её нет (локально и в CI). */
  ensureBucket(): Promise<void>;
}

const SEGMENT = /^[A-Za-z0-9_-]+$/;

/** Ключ файла организации: `org/<org_id>/<раздел>/<id>`. */
export function orgFileKey(orgId: string, section: string, fileId: string): string {
  for (const [name, value] of [
    ['orgId', orgId],
    ['section', section],
    ['fileId', fileId],
  ] as const) {
    if (!SEGMENT.test(value))
      throw new RangeError(`Недопустимая часть пути файла ${name}: «${value}»`);
  }
  return `org/${orgId}/${section}/${fileId}`;
}

/** Ключ общего файла платформы (картинки новостей и т. п.): `platform/<раздел>/<id>`. */
export function platformFileKey(section: string, fileId: string): string {
  for (const [name, value] of [
    ['section', section],
    ['fileId', fileId],
  ] as const) {
    if (!SEGMENT.test(value))
      throw new RangeError(`Недопустимая часть пути файла ${name}: «${value}»`);
  }
  return `platform/${section}/${fileId}`;
}

/** Content-Disposition для скачивания с русским именем файла (RFC 6266 / RFC 5987). */
export function attachmentDisposition(
  fileName?: string,
  type: 'attachment' | 'inline' = 'attachment',
): string {
  if (!fileName) return type;
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  // encodeURIComponent не кодирует ' ( ) *, а в filename* RFC 5987 они недопустимы.
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Открыть в браузере можно только картинки без кода (не SVG) и PDF (`filePreviewKind`). */
function checkInline(inline: { contentType: string } | undefined): void {
  if (inline && !filePreviewKind(inline.contentType)) {
    throw new RangeError(`Тип ${inline.contentType} не открывается в браузере`);
  }
}

/** Ссылки короткие: 15 минут хватает, чтобы скачать файл. */
const MAX_SIGNED_URL_SECONDS = 15 * 60;

function checkExpiry(seconds: number): void {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SIGNED_URL_SECONDS) {
    throw new RangeError(`Срок ссылки — от 1 до ${MAX_SIGNED_URL_SECONDS} секунд`);
  }
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.$metadata.httpStatusCode === 404 ||
      error.name === 'NoSuchKey' ||
      error.name === 'NoSuchBucket' ||
      error.name === 'NotFound')
  );
}

/** Текст с сервера — одной строкой и не длиннее 300 знаков, без точки в конце. */
function oneLine(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .slice(0, 300)
    .replace(/[\s.]+$/, '')
    .trim();
}

/** Что проверить в настройках по коду ошибки S3. */
const STORAGE_ERROR_HINTS: Record<string, string> = {
  InvalidAccessKeyId:
    'такого ключа доступа нет — проверьте S3_ACCESS_KEY_ID (Supabase: Storage → S3 Configuration → Access keys)',
  SignatureDoesNotMatch:
    'подпись не сошлась — S3_SECRET_ACCESS_KEY не от этого ключа доступа или S3_REGION не совпадает с регионом проекта',
  InvalidSignature:
    'подпись не сошлась — S3_SECRET_ACCESS_KEY не от этого ключа доступа или S3_REGION не совпадает с регионом проекта',
  AuthorizationHeaderMalformed: 'S3_REGION не совпадает с регионом хранилища',
  AccessDenied:
    'доступ запрещён — это не ключи S3 хранилища (anon и service_role не подходят) или у ключа нет прав на корзину',
  NoSuchBucket: 'корзины нет — проверьте S3_BUCKET',
};

const STORAGE_SETTINGS = 'S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID и S3_SECRET_ACCESS_KEY';

/**
 * Понятное объяснение ошибки хранилища для журнала запуска (storage:init в CI).
 * Значения ключей не выводятся — только код ответа, код ошибки S3 и подсказка.
 */
export function explainStorageError(error: unknown, bucket: string): string {
  const head = `Корзина «${bucket}» не готова`;
  if (!(error instanceof S3ServiceException)) {
    const reason = oneLine(error instanceof Error ? error.message : String(error));
    return `${head}: хранилище недоступно (${reason}). Проверьте адрес S3_ENDPOINT.`;
  }
  const status = error.$metadata.httpStatusCode;
  const message = oneLine(error.message || '');
  const known = STORAGE_ERROR_HINTS[error.name];
  let hint = known ?? `проверьте ${STORAGE_SETTINGS}`;
  if (!known && status === 404) {
    hint = 'по адресу S3_ENDPOINT нет S3 — у Supabase адрес оканчивается на /storage/v1/s3';
  } else if (!known && status === 403) {
    hint = `доступ запрещён — проверьте ключи и регион: ${STORAGE_SETTINGS}`;
  }
  const name = oneLine(error.name);
  const code = message && message !== name ? `${name}: ${message}` : name;
  return `${head}: HTTP ${status ?? '—'}, ${code}.\nЧто проверить: ${hint}.`;
}

export function createS3Storage(config: StorageConfig): Storage {
  const options = {
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  };
  const client = new S3Client({ ...options, endpoint: config.S3_ENDPOINT });
  // Ссылки для браузера подписываются по его адресу хранилища (подпись S3 включает адрес). Контрольную
  // сумму в ссылку не добавлять: SDK посчитал бы её от пустого тела, и хранилище отвергло бы файл.
  const signer = new S3Client({
    ...options,
    endpoint: config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT,
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  const Bucket = config.S3_BUCKET;

  return {
    async put(key, body, { contentType }) {
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    async get(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        return out.Body ? await out.Body.transformToByteArray() : new Uint8Array();
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
    },
    async signedDownloadUrl(key, { expiresInSeconds, fileName, inline }) {
      checkExpiry(expiresInSeconds);
      checkInline(inline);
      const command = new GetObjectCommand({
        Bucket,
        Key: key,
        ResponseContentDisposition: attachmentDisposition(
          fileName,
          inline ? 'inline' : 'attachment',
        ),
        ...(inline ? { ResponseContentType: inline.contentType } : {}),
      });
      return getSignedUrl(signer, command, { expiresIn: expiresInSeconds });
    },
    async signedUploadUrl(key, { expiresInSeconds, contentType, size }) {
      checkExpiry(expiresInSeconds);
      const command = new PutObjectCommand({
        Bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
      });
      const url = await getSignedUrl(signer, command, {
        expiresIn: expiresInSeconds,
        signableHeaders: new Set(['content-type', 'content-length']),
      });
      // Content-Length браузер ставит сам по размеру файла; подписан и он.
      return { url, headers: { 'content-type': contentType } };
    },
    async stat(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: out.ContentLength ?? 0, contentType: out.ContentType ?? null };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async ping() {
      await client.send(new HeadBucketCommand({ Bucket }));
    },
    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
      } catch (error) {
        if (!isNotFound(error)) throw await withErrorCode(error);
        await client.send(new CreateBucketCommand({ Bucket }));
      }
    },
  };

  /**
   * Ответ на HEAD приходит без тела, и код ошибки теряется (UnknownError, только HTTP 403).
   * Тот же запрос через GET возвращает код S3 (InvalidAccessKeyId, SignatureDoesNotMatch…).
   */
  async function withErrorCode(error: unknown): Promise<unknown> {
    if (!(error instanceof S3ServiceException)) return error;
    try {
      await client.send(new ListObjectsV2Command({ Bucket, MaxKeys: 1 }));
      return error;
    } catch (detailed) {
      return detailed;
    }
  }
}

export interface MemoryStorage extends Storage {
  readonly files: ReadonlyMap<string, { body: Uint8Array; contentType: string }>;
}

/** Хранилище в памяти для тестов других пакетов. */
export function createMemoryStorage(): MemoryStorage {
  const files = new Map<string, { body: Uint8Array; contentType: string }>();
  const encoder = new TextEncoder();
  return {
    files,
    async put(key, body, { contentType }) {
      files.set(key, { body: typeof body === 'string' ? encoder.encode(body) : body, contentType });
    },
    async get(key) {
      return files.get(key)?.body ?? null;
    },
    async delete(key) {
      files.delete(key);
    },
    async exists(key) {
      return files.has(key);
    },
    async signedDownloadUrl(key, { expiresInSeconds, fileName, inline }) {
      checkExpiry(expiresInSeconds);
      checkInline(inline);
      const params = new URLSearchParams({ expires: String(expiresInSeconds) });
      if (fileName) params.set('name', fileName);
      if (inline) params.set('inline', inline.contentType);
      return `memory://${key}?${params.toString()}`;
    },
    async signedUploadUrl(key, { expiresInSeconds, contentType, size }) {
      checkExpiry(expiresInSeconds);
      const params = new URLSearchParams({ expires: String(expiresInSeconds), size: String(size) });
      return {
        url: `memory://${key}?${params.toString()}`,
        headers: { 'content-type': contentType },
      };
    },
    async stat(key) {
      const file = files.get(key);
      return file ? { size: file.body.length, contentType: file.contentType } : null;
    },
    async ping() {},
    async ensureBucket() {},
  };
}
