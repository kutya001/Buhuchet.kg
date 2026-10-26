import { databaseAvailable } from '@buhuchet/db/testing';
import { PhoneCodes } from '@buhuchet/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())('Справочники платформы: коды телефонов', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await createStaffFixture();
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('любой вошедший получает коды по порядку справочника: Кыргызстан первым, маска номера', async () => {
    for (const login of ['acc-a', 'platform-admin']) {
      const cookie = await signIn(f.app, login, TEST_PASSWORD);
      const res = await apiRequest(f.app, 'GET', '/api/phone-codes', cookie);
      expect(res.status).toBe(200);
      const { items } = PhoneCodes.parse(await res.json());
      expect(items[0]).toMatchObject({ cc: 'KG', code: '996', mask: 'XXX XXX XXX', active: true });
      expect(items.map((c) => c.cc)).toEqual(expect.arrayContaining(['KZ', 'RU', 'UZ']));
      expect(items.every((c) => /^\d+$/.test(c.code) && c.mask.includes('X'))).toBe(true);
    }
  });

  it('без входа — 401', async () => {
    expect((await apiRequest(f.app, 'GET', '/api/phone-codes')).status).toBe(401);
  });
});
