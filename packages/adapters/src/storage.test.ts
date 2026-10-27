import { randomUUID } from 'node:crypto';
import { S3ServiceException } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { hasStorageEnv, integrationTestsRequired, loadStorageConfig } from './config';
import {
  attachmentDisposition,
  createMemoryStorage,
  createS3Storage,
  explainStorageError,
  orgFileKey,
  type Storage,
} from './storage';

describe('orgFileKey', () => {
  it('собирает путь org/<org_id>/<раздел>/<id>', () => {
    expect(orgFileKey('6f1c', 'receipts', 'f-1')).toBe('org/6f1c/receipts/f-1');
  });

  it.each([['..'], ['a/b'], [''], ['файл']])('отказывает части пути «%s»', (bad) => {
    expect(() => orgFileKey('org', bad, 'id')).toThrow(RangeError);
  });
});

describe('attachmentDisposition', () => {
  it('кодирует русское имя по RFC 5987 и оставляет ASCII-запасное', () => {
    const value = attachmentDisposition('Свидетельство "2026".pdf');
    expect(value).toContain(`filename*=UTF-8''${encodeURIComponent('Свидетельство "2026".pdf')}`);
    expect(value).toMatch(/^attachment; filename="[\x20-\x7e]+"/);
    expect(value).not.toContain('"2026"');
  });

  it('кодирует апостроф и скобки, без имени — просто вложение', () => {
    expect(attachmentDisposition("Акт (O'Neil).pdf")).toContain(
      "filename*=UTF-8''%D0%90%D0%BA%D1%82%20%28O%27Neil%29.pdf",
    );
    expect(attachmentDisposition()).toBe('attachment');
  });
});

function s3Error(name: string, httpStatusCode: number, message = ''): S3ServiceException {
  return new S3ServiceException({ name, $fault: 'client', $metadata: { httpStatusCode }, message });
}

describe('explainStorageError', () => {
  it('по коду S3 подсказывает, какую настройку проверить', () => {
    const text = explainStorageError(
      s3Error('SignatureDoesNotMatch', 403, 'The request signature\n does not match'),
      'buhuchet',
    );
    expect(text).toContain('Корзина «buhuchet» не готова: HTTP 403');
    expect(text).toContain('SignatureDoesNotMatch: The request signature does not match');
    expect(text).toContain('S3_SECRET_ACCESS_KEY');
    expect(text).toContain('S3_REGION');
    expect(explainStorageError(s3Error('InvalidAccessKeyId', 403), 'b')).toContain(
      'S3_ACCESS_KEY_ID',
    );
    expect(explainStorageError(s3Error('AccessDenied', 403), 'b')).toContain('service_role');
  });

  it('без кода (ответ на HEAD) — по коду ответа', () => {
    expect(explainStorageError(s3Error('Unknown', 403, 'UnknownError'), 'b')).toMatch(
      /HTTP 403, Unknown: UnknownError\.\nЧто проверить: доступ запрещён — проверьте ключи и регион/,
    );
    expect(explainStorageError(s3Error('UnknownError', 404), 'b')).toContain('/storage/v1/s3');
    expect(explainStorageError(s3Error('InternalError', 500), 'b')).toContain(
      'проверьте S3_ENDPOINT, S3_REGION',
    );
  });

  it('сеть недоступна — проверить адрес', () => {
    const text = explainStorageError(new Error('getaddrinfo ENOTFOUND s3.example'), 'b');
    expect(text).toContain('хранилище недоступно (getaddrinfo ENOTFOUND s3.example)');
    expect(text).toContain('S3_ENDPOINT');
  });
});

function contract(name: string, make: () => Promise<Storage>, opts: { skip?: boolean } = {}) {
  describe.skipIf(opts.skip)(`контракт Storage: ${name}`, () => {
    it('кладёт, читает, проверяет и удаляет файл', async () => {
      const storage = await make();
      const key = orgFileKey('test', 'contract', randomUUID());
      expect(await storage.exists(key)).toBe(false);
      expect(await storage.get(key)).toBeNull();
      await storage.put(key, 'привет', { contentType: 'text/plain; charset=utf-8' });
      expect(await storage.exists(key)).toBe(true);
      expect(new TextDecoder().decode((await storage.get(key)) ?? new Uint8Array())).toBe('привет');
      await storage.delete(key);
      expect(await storage.exists(key)).toBe(false);
    });

    it('выдаёт подписанную ссылку с ограниченным сроком', async () => {
      const storage = await make();
      const key = orgFileKey('test', 'contract', randomUUID());
      await storage.put(key, 'pdf', { contentType: 'application/pdf' });
      const url = await storage.signedDownloadUrl(key, {
        expiresInSeconds: 60,
        fileName: 'Выписка.pdf',
      });
      expect(url).toContain(key);
      await expect(storage.signedDownloadUrl(key, { expiresInSeconds: 0 })).rejects.toThrow(
        RangeError,
      );
      await expect(storage.signedDownloadUrl(key, { expiresInSeconds: 901 })).rejects.toThrow(
        RangeError,
      );
      await storage.ping();
      await storage.delete(key);
    });

    it('сообщает размер и тип лежащего файла; нет файла — null', async () => {
      const storage = await make();
      const key = orgFileKey('test', 'contract', randomUUID());
      expect(await storage.stat(key)).toBeNull();
      await storage.put(key, new Uint8Array(12), { contentType: 'application/pdf' });
      expect(await storage.stat(key)).toEqual({ size: 12, contentType: 'application/pdf' });
      await storage.delete(key);
    });

    it('выдаёт ссылку на загрузку с подписанным типом и сроком не больше 15 минут', async () => {
      const storage = await make();
      const key = orgFileKey('test', 'contract', randomUUID());
      const upload = await storage.signedUploadUrl(key, {
        expiresInSeconds: 60,
        contentType: 'application/pdf',
        size: 3,
      });
      expect(upload.url).toContain(key);
      expect(upload.headers).toEqual({ 'content-type': 'application/pdf' });
      await expect(
        storage.signedUploadUrl(key, { expiresInSeconds: 901, contentType: 'x/y', size: 1 }),
      ).rejects.toThrow(RangeError);
    });
  });
}

contract('память', async () => createMemoryStorage());

const s3Available = hasStorageEnv();
if (!s3Available && integrationTestsRequired()) {
  throw new Error('REQUIRE_INTEGRATION_TESTS=1, но переменные S3_* не заданы');
}

contract(
  'S3 (MinIO)',
  async () => {
    const storage = createS3Storage(loadStorageConfig());
    await storage.ensureBucket();
    return storage;
  },
  { skip: !s3Available },
);

describe.skipIf(!s3Available)('S3: подписанная ссылка реально скачивает файл', () => {
  it('скачивание по ссылке отдаёт содержимое и имя файла', async () => {
    const storage = createS3Storage(loadStorageConfig());
    await storage.ensureBucket();
    const key = orgFileKey('test', 'signed', randomUUID());
    await storage.put(key, 'содержимое', { contentType: 'text/plain; charset=utf-8' });
    const url = await storage.signedDownloadUrl(key, {
      expiresInSeconds: 60,
      fileName: 'Квитанция.txt',
    });
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('содержимое');
    expect(res.headers.get('content-disposition')).toContain(encodeURIComponent('Квитанция.txt'));
    await storage.delete(key);
  });

  it('без имени файл всё равно скачивается вложением, а не открывается', async () => {
    const storage = createS3Storage(loadStorageConfig());
    const key = orgFileKey('test', 'signed', randomUUID());
    await storage.put(key, '<script>alert(1)</script>', { contentType: 'text/html' });
    const res = await fetch(await storage.signedDownloadUrl(key, { expiresInSeconds: 60 }));
    expect(res.headers.get('content-disposition')).toBe('attachment');
    await storage.delete(key);
  });

  it('загрузка по ссылке принимает только подписанные размер и тип', async () => {
    const storage = createS3Storage(loadStorageConfig());
    const key = orgFileKey('test', 'upload', randomUUID());
    const upload = await storage.signedUploadUrl(key, {
      expiresInSeconds: 60,
      contentType: 'application/pdf',
      size: 10,
    });
    const put = (size: number, headers = upload.headers) =>
      fetch(upload.url, { method: 'PUT', body: new Uint8Array(size), headers });
    expect((await put(11)).status).toBe(403);
    expect((await put(10, { 'content-type': 'text/html' })).status).toBe(403);
    expect(await storage.exists(key)).toBe(false);
    expect((await put(10)).status).toBe(200);
    expect(await storage.stat(key)).toEqual({ size: 10, contentType: 'application/pdf' });
    await storage.delete(key);
  });

  it('ссылки для браузера подписаны по S3_PUBLIC_ENDPOINT, файлы сервер берёт по S3_ENDPOINT', async () => {
    const config = loadStorageConfig();
    const storage = createS3Storage({ ...config, S3_PUBLIC_ENDPOINT: 'https://files.example.kg' });
    const key = orgFileKey('test', 'public', randomUUID());
    await storage.put(key, 'x', { contentType: 'text/plain' });
    expect(await storage.signedDownloadUrl(key, { expiresInSeconds: 60 })).toMatch(
      /^https:\/\/files\.example\.kg\//,
    );
    const upload = await storage.signedUploadUrl(key, {
      expiresInSeconds: 60,
      contentType: 'text/plain',
      size: 1,
    });
    expect(upload.url).toMatch(/^https:\/\/files\.example\.kg\//);
    expect(await storage.stat(key)).toEqual({ size: 1, contentType: 'text/plain' });
    await storage.delete(key);
  });

  it('ensureBucket создаёт отсутствующую корзину', async () => {
    const config = loadStorageConfig();
    const storage = createS3Storage({ ...config, S3_BUCKET: `test-${randomUUID().slice(0, 8)}` });
    await expect(storage.ping()).rejects.toThrow();
    await storage.ensureBucket();
    await storage.ping();
    await storage.ensureBucket();
  });

  it('ensureBucket с чужим секретом сообщает код ошибки S3, а не UnknownError', async () => {
    const config = loadStorageConfig();
    const storage = createS3Storage({ ...config, S3_SECRET_ACCESS_KEY: 'wrong-secret-000000' });
    const error = await storage.ensureBucket().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(S3ServiceException);
    expect((error as S3ServiceException).name).toBe('SignatureDoesNotMatch');
    expect(explainStorageError(error, config.S3_BUCKET)).toContain('S3_SECRET_ACCESS_KEY');
  });
});
