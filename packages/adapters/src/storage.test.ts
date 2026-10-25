import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hasStorageEnv, integrationTestsRequired, loadStorageConfig } from './config';
import {
  attachmentDisposition,
  createMemoryStorage,
  createS3Storage,
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
      await expect(storage.signedDownloadUrl(key, { expiresInSeconds: 7200 })).rejects.toThrow(
        RangeError,
      );
      await storage.ping();
      await storage.delete(key);
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

  it('ensureBucket создаёт отсутствующую корзину', async () => {
    const config = loadStorageConfig();
    const storage = createS3Storage({ ...config, S3_BUCKET: `test-${randomUUID().slice(0, 8)}` });
    await expect(storage.ping()).rejects.toThrow();
    await storage.ensureBucket();
    await storage.ping();
    await storage.ensureBucket();
  });
});
