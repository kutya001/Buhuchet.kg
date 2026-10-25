import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
  signedDownloadUrl(
    key: string,
    options: { expiresInSeconds: number; fileName?: string },
  ): Promise<string>;
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

/** Content-Disposition для скачивания с русским именем файла (RFC 6266 / RFC 5987). */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

const MAX_SIGNED_URL_SECONDS = 60 * 60;

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
      error.name === 'NotFound')
  );
}

export function createS3Storage(config: StorageConfig): Storage {
  const client = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
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
    async signedDownloadUrl(key, { expiresInSeconds, fileName }) {
      checkExpiry(expiresInSeconds);
      const command = new GetObjectCommand({
        Bucket,
        Key: key,
        ...(fileName ? { ResponseContentDisposition: attachmentDisposition(fileName) } : {}),
      });
      return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
    },
    async ping() {
      await client.send(new HeadBucketCommand({ Bucket }));
    },
    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket }));
      } catch (error) {
        if (!isNotFound(error)) throw error;
        await client.send(new CreateBucketCommand({ Bucket }));
      }
    },
  };
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
    async signedDownloadUrl(key, { expiresInSeconds, fileName }) {
      checkExpiry(expiresInSeconds);
      const params = new URLSearchParams({ expires: String(expiresInSeconds) });
      if (fileName) params.set('name', fileName);
      return `memory://${key}?${params.toString()}`;
    },
    async ping() {},
    async ensureBucket() {},
  };
}
