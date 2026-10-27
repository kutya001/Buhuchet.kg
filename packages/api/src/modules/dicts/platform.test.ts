import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  DictRequest,
  DictRequests,
  PlatformDictGroups,
  PlatformDictList,
  PlatformValueList,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD, unzipTexts } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())('Справочники → «Справочники платформы» организации', () => {
  let f: Fixture;
  let acc: string;
  let owner: string;
  let ownerB: string;
  let senior: string;
  let admin: string;

  const get = (cookie: string, path: string) => apiRequest(f.app, 'GET', path, cookie);
  const errorCode = async (res: Response) =>
    ((await res.json()) as { error: { code: string } }).error.code;

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    [acc, owner, ownerB, senior, admin] = await Promise.all([
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
      signIn(f.app, 'senior-a', TEST_PASSWORD),
      signIn(f.app, 'platform-admin', TEST_PASSWORD),
    ]);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('плитки видит любой сотрудник: группы без служебных справочников, числа значений', async () => {
    const res = await get(acc, '/api/platform-dicts');
    expect(res.status).toBe(200);
    const { groups } = PlatformDictGroups.parse(await res.json());
    const tiles = groups.flatMap((g) => g.tabs);
    expect(tiles.map((x) => x.id)).not.toContain('permissions');
    expect(tiles.find((x) => x.id === 'types')!.count).toBeGreaterThan(100);
    expect(tiles.find((x) => x.id === 'en_rates')).toMatchObject({
      tab: 'Ставки единого налога',
      about: 'Ставки единого налога по видам деятельности (ст. 423): когда применяется каждая.',
    });
  });

  it('окно справочника: значения, поиск, фильтр, Excel по праву', async () => {
    const res = await get(acc, '/api/platform-dicts/organs?size=all');
    expect(res.status).toBe(200);
    const organs = PlatformDictList.parse(await res.json());
    expect(organs.items.find((r) => r.values.name === 'ГНС')!.values.note).toContain(
      'налоговая служба',
    );
    const found = PlatformDictList.parse(
      await (await get(acc, `/api/platform-dicts/forms?q=${encodeURIComponent('ОсОО')}`)).json(),
    );
    expect(found.items.map((r) => r.values.name)).toContain('ОсОО');
    const kinds = (await (
      await get(acc, '/api/platform-dicts/calendar/values?col=kind')
    ).json()) as { items: { label: string }[] };
    expect(kinds.items.map((x) => x.label)).toContain('Праздник');
    expect((await get(acc, '/api/platform-dicts/types')).status).toBe(400);
    expect((await get(acc, '/api/platform-dicts/organs?sort=nope')).status).toBe(400);

    const file = await get(acc, '/api/platform-dicts/organs/export?cols=name,note');
    expect(file.status).toBe(200);
    const sheet = unzipTexts(new Uint8Array(await file.arrayBuffer()))['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('Что это и что туда сдают');
    expect((await get(senior, '/api/platform-dicts/organs/export?cols=name')).status).toBe(403);
  });

  it('«Поиск по всем значениям»: справочник и значение, значения фильтра, Excel', async () => {
    const res = await get(acc, `/api/platform-values?q=${encodeURIComponent('Бакай')}`);
    expect(res.status).toBe(200);
    const page = PlatformValueList.parse(await res.json());
    expect(page.items).toContainEqual(
      expect.objectContaining({
        dict: 'banks',
        dictName: 'Банковские провайдеры',
        name: 'Бакай Банк',
      }),
    );
    expect(page.items.every((r) => r.name.includes('Бакай'))).toBe(true);
    const dicts = (await (await get(acc, '/api/platform-values/values?col=d')).json()) as {
      items: { value: string }[];
    };
    expect(dicts.items.map((x) => x.value)).toContain('calendar');
    const file = await get(acc, '/api/platform-values/export?cols=d,name');
    expect(file.status).toBe(200);
    expect((await get(senior, '/api/platform-values/export?cols=d,name')).status).toBe(403);
  });

  it('«Попросить добавить» — любой сотрудник; «Мои запросы» — только своей организации', async () => {
    const res = await apiRequest(f.app, 'POST', '/api/dict-requests', acc, {
      dict: 'types',
      what: ' Отчёт по НДС на импорт услуг ',
    });
    expect(res.status).toBe(201);
    const created = DictRequest.parse(await res.json());
    expect(created).toMatchObject({
      dict: 'types',
      what: 'Отчёт по НДС на импорт услуг',
      comment: '',
      status: 'new',
      createdBy: 'acc-a',
    });
    const [row] = await f.t.admin.db
      .select()
      .from(schema.dictChangeRequests)
      .where(eq(schema.dictChangeRequests.id, created.id));
    expect(row!.orgId).toBe(f.a.orgId);

    const mine = DictRequests.parse(await (await get(owner, '/api/dict-requests')).json());
    expect(mine.items.map((r) => r.id)).toEqual([created.id]);
    const other = DictRequests.parse(await (await get(ownerB, '/api/dict-requests')).json());
    expect(other.items).toEqual([]);
  });

  it('пустое «Что добавить» и чужой справочник — 400', async () => {
    for (const body of [
      { dict: 'types', what: '   ' },
      { dict: 'permissions', what: 'Право' },
      { dict: 'types', what: 'x'.repeat(301) },
    ]) {
      const res = await apiRequest(f.app, 'POST', '/api/dict-requests', acc, body);
      expect([res.status, await errorCode(res)]).toEqual([400, 'validation_failed']);
    }
  });

  it('администратор платформы — не сотрудник организации: экрана организации у него нет', async () => {
    for (const path of ['/api/platform-dicts', '/api/platform-values', '/api/dict-requests']) {
      expect((await get(admin, path)).status).toBe(403);
    }
    const post = await apiRequest(f.app, 'POST', '/api/dict-requests', admin, {
      dict: 'types',
      what: 'Вид',
    });
    expect(post.status).toBe(403);
    // Плашка «Запросы на добавление» в Админке считает запросы всех организаций.
    const summary = (await (await get(admin, '/api/admin/organizations/summary')).json()) as {
      requests: number;
    };
    expect(summary.requests).toBe(1);
  });
});
