import { describe, expect, it } from 'vitest';
import { createDb } from './client';

describe('createDb: проверка сертификата сервера', () => {
  const url = 'postgres://u:p@db.example.org:6543/postgres?sslmode=require';
  const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

  it('без сертификата — как в адресе (require: шифрование без проверки)', async () => {
    const handle = createDb(url);
    expect(handle.sql.options.ssl).toBe('require');
    await handle.close();
  });

  it('с сертификатом — проверка сертификата и имени сервера главнее sslmode в адресе', async () => {
    const handle = createDb(url, { caCert: pem });
    expect(handle.sql.options.ssl).toEqual({ ca: pem, rejectUnauthorized: true });
    await handle.close();
  });
});
