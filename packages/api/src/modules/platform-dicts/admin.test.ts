import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { DICT_REQUEST_HOURLY_LIMIT } from '@buhuchet/domain';
import {
  AdminDictGroups,
  AdminDictHistory,
  AdminDictList,
  AdminDictRequest,
  AdminDictRequestList,
  AdminDictValue,
  ApiError,
  DictRequest,
  DictRequests,
  ListValues,
  PdictsTabCounts,
} from '@buhuchet/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())('Админка → «Справочники платформы»: правка значений', () => {
  let f: Fixture;
  let admin: string;
  let owner: string;
  let acc: string;

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    [admin, owner, acc] = await Promise.all([
      signIn(f.app, 'platform-admin', TEST_PASSWORD),
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
    ]);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  const P = '/api/admin/platform-dicts';
  const get = (path: string, cookie = admin) => apiRequest(f.app, 'GET', path, cookie);
  type Method = Parameters<typeof apiRequest>[1];
  const send = (method: Method, path: string, body?: unknown, cookie = admin) =>
    apiRequest(f.app, method, path, cookie, body);
  const errorOf = async (res: Response) => ApiError.parse(await res.json()).error;
  const value = async (path: string) => AdminDictValue.parse(await (await get(path)).json());
  const at = (code: string) => `${P}/organs/${encodeURIComponent(code)}`;

  it('только администратор платформы: сотруднику организации и без входа — отказ', async () => {
    const reads = [
      `${P}/forms`,
      `${P}/forms/values?col=active`,
      `${P}/forms/export?cols=name`,
      `${P}/groups`,
      `${P}/tab-counts`,
      `${P}/forms/history`,
      `${P}/forms/${encodeURIComponent('ФС-01')}`,
      '/api/admin/dict-requests',
      '/api/admin/dict-requests/values?col=status',
    ];
    for (const path of reads) {
      expect((await get(path, owner)).status, path).toBe(403);
      expect((await get(path, '')).status, path).toBe(401);
    }
    const form = `${P}/forms/${encodeURIComponent('ФС-01')}`;
    const writes: [Method, string, unknown][] = [
      ['POST', `${P}/forms`, { name: 'Взлом' }],
      ['PUT', form, { name: 'Взлом', version: 1 }],
      ['POST', `${form}/move`, { step: 1, version: 1 }],
      ['POST', `${form}/active`, { active: false, version: 1 }],
      ['DELETE', `${form}?version=1`, undefined],
    ];
    for (const [method, path, body] of writes) {
      expect((await send(method, path, body, owner)).status, path).toBe(403);
      expect((await send(method, path, body, '')).status, path).toBe(401);
    }
    expect((await value(form)).name).toBe('ОсОО');
  });

  it('список: «№» по порядку, «Используется», «Статус»; значения фильтра; Excel; группы вкладок', async () => {
    const forms = AdminDictList.parse(await (await get(`${P}/forms`)).json());
    expect(forms.items.slice(0, 2).map((x) => [x.n, x.code, x.name, x.active])).toEqual([
      [1, 'ФС-01', 'ОсОО', true],
      [2, 'ФС-02', 'ИП', true],
    ]);
    const ugns = AdminDictList.parse(await (await get(`${P}/ugns?size=all`)).json());
    expect(ugns.items.every((x) => x.n === null)).toBe(true);
    expect(ugns.total).toBe(65);
    const status = ListValues.parse(await (await get(`${P}/ugns/values?col=active`)).json());
    expect(status.items.map((v) => v.count).reduce((a, b) => a + b, 0)).toBe(65);
    const xlsx = await get(`${P}/reasons/export?cols=n,name,active`);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get('content-type')).toContain('spreadsheetml');
    const groups = AdminDictGroups.parse(await (await get(`${P}/groups`)).json());
    expect(groups.items.flatMap((g) => g.tabs.map((x) => x.key))).toContain('forms');
    expect((await get(`${P}/users`)).status).toBe(400);
  });

  it('добавить орган с телефонами: код — следующий номер, повтор названия — под полем', async () => {
    const res = await send('POST', `${P}/organs`, {
      name: ' Минэкономики ',
      description: 'Лицензии',
      contacts: [
        { label: 'Приёмная', value: '+996 312 62 05 10' },
        { label: '', value: ' ' },
      ],
      site: 'mineconom.gov.kg',
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const created = AdminDictValue.parse(await res.json());
    expect(created).toMatchObject({
      code: 'ОРГ-16',
      n: 16,
      name: 'Минэкономики',
      active: true,
      used: 0,
      version: 1,
      data: { contacts: [{ label: 'Приёмная', value: '+996 312 62 05 10' }] },
    });
    expect(created.audit.createdAt).not.toBeNull();

    const taken = await send('POST', `${P}/organs`, { name: 'Минэкономики' });
    expect(taken.status).toBe(400);
    expect(await errorOf(taken)).toMatchObject({
      code: 'dict_value_taken',
      details: { field: 'name' },
    });
    const empty = await send('POST', `${P}/organs`, { name: '  ' });
    expect([empty.status, (await errorOf(empty)).code]).toEqual([400, 'validation_failed']);
  });

  it('изменить: новое название — в истории «было → стало»; устаревшая версия — 409, нет значения — 404', async () => {
    const before = await value(at('ОРГ-16'));
    const res = await send('PUT', at('ОРГ-16'), {
      name: 'Министерство экономики',
      description: 'Лицензии',
      version: before.version,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(AdminDictValue.parse(await res.json())).toMatchObject({
      name: 'Министерство экономики',
      version: before.version + 1,
      audit: { updatedBy: 'Администратор платформы' },
    });
    const history = AdminDictHistory.parse(await (await get(`${P}/organs/history`)).json());
    expect(history.items[0]).toMatchObject({ action: 'update', code: 'ОРГ-16' });
    expect(history.items[0]!.changes).toContainEqual({
      field: 'name',
      from: 'Минэкономики',
      to: 'Министерство экономики',
    });

    const stale = await send('PUT', at('ОРГ-16'), { name: 'Минэк', version: before.version });
    expect(stale.status).toBe(409);
    expect((await errorOf(stale)).code).toBe('record_changed');
    expect((await send('PUT', at('ОРГ-99'), { name: 'Нет', version: 1 })).status).toBe(404);
    expect((await get(at('ОРГ-99'))).status).toBe(404);
  });

  it('«Выше» / «Ниже» меняют местами с соседним; у УГНС порядка нет — 404', async () => {
    const organs = AdminDictList.parse(await (await get(`${P}/organs?size=all`)).json()).items;
    const above = organs.find((x) => x.n === 15)!;
    const last = await value(at('ОРГ-16'));
    const up = await send('POST', `${at('ОРГ-16')}/move`, { step: -1, version: last.version });
    expect(up.status, await up.clone().text()).toBe(200);
    expect(AdminDictValue.parse(await up.json()).n).toBe(15);
    expect((await value(at(above.code))).n).toBe(16);
    const stale = await send('POST', `${at('ОРГ-16')}/move`, { step: 1, version: last.version });
    expect(stale.status).toBe(409);
    const ugns = `${P}/ugns/ugns-bishkek-lenin`;
    const office = await value(ugns);
    expect((await send('POST', `${ugns}/move`, { step: 1, version: office.version })).status).toBe(
      404,
    );
    expect((await send('POST', `${ugns}/move`, { step: 2, version: 1 })).status).toBe(400);
  });

  it('отключить и включить; удалить можно только неиспользуемое', async () => {
    const created = await value(at('ОРГ-16'));
    const off = await send('POST', `${at('ОРГ-16')}/active`, {
      active: false,
      version: created.version,
    });
    expect(off.status).toBe(200);
    const offValue = AdminDictValue.parse(await off.json());
    expect(offValue.active).toBe(false);
    const on = await send('POST', `${at('ОРГ-16')}/active`, {
      active: true,
      version: offValue.version,
    });
    expect(AdminDictValue.parse(await on.json()).active).toBe(true);

    const gns = await value(at('ОРГ-01'));
    expect(gns.used).toBeGreaterThan(0);
    const used = await send('DELETE', `${at('ОРГ-01')}?version=${gns.version}`);
    expect(used.status).toBe(409);
    expect(await errorOf(used)).toMatchObject({
      code: 'dict_value_used',
      details: { n: gns.used, contractors: 0 },
    });

    const now = await value(at('ОРГ-16'));
    expect((await send('DELETE', `${at('ОРГ-16')}?version=${now.version - 1}`)).status).toBe(409);
    expect((await send('DELETE', `${at('ОРГ-16')}?version=${now.version}`)).status).toBe(204);
    expect((await get(at('ОРГ-16'))).status).toBe(404);
    const history = AdminDictHistory.parse(await (await get(`${P}/organs/history`)).json());
    expect(history.items[0]).toMatchObject({ action: 'delete', label: 'Министерство экономики' });
  });

  it('УГНС: краткое название обязательно, код ГНС — три цифры или пусто, повтор кода — под полем', async () => {
    const base = { name: 'УГНС по новому району', region: 'г. Бишкек' };
    const short = await send('POST', `${P}/ugns`, { ...base, shortName: ' ' });
    expect(await errorOf(short)).toMatchObject({
      code: 'short_name_required',
      details: { field: 'shortName' },
    });
    const bad = await send('POST', `${P}/ugns`, { ...base, shortName: 'Новый', gnsCode: '12' });
    expect([bad.status, (await errorOf(bad)).code]).toEqual([400, 'validation_failed']);
    const res = await send('POST', `${P}/ugns`, { ...base, shortName: 'Новый', gnsCode: '' });
    expect(res.status, await res.clone().text()).toBe(201);
    const created = AdminDictValue.parse(await res.json());
    expect(created.code).toMatch(/^ugns-[0-9a-f]{8}$/);
    expect(created).toMatchObject({ n: null, data: { gnsCode: null, shortName: 'Новый' } });
    const taken = await send('PUT', `${P}/ugns/${created.code}`, {
      ...base,
      shortName: 'Новый',
      gnsCode: '002',
      version: created.version,
    });
    expect(taken.status).toBe(400);
    expect(await errorOf(taken)).toMatchObject({
      code: 'ugns_code_taken',
      details: { field: 'gnsCode' },
    });
  });

  it('«Запросы»: администратор видит запросы всех организаций и отвечает; организация видит ответ', async () => {
    const sent = DictRequest.parse(
      await (
        await send('POST', '/api/dict-requests', { dict: 'forms', what: 'Фонд' }, owner)
      ).json(),
    );
    const counts = PdictsTabCounts.parse(await (await get(`${P}/tab-counts`)).json());
    expect(counts.requests).toBe(1);
    const list = AdminDictRequestList.parse(await (await get('/api/admin/dict-requests')).json());
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: sent.id,
      orgName: 'Организация А',
      dict: 'forms',
      what: 'Фонд',
      status: 'new',
    });
    const version = list.items[0]!.version;
    const answer = (body: unknown) =>
      send('POST', `/api/admin/dict-requests/${sent.id}/answer`, body);

    const noReason = await answer({ status: 'rejected', answer: ' ', version });
    expect([noReason.status, (await errorOf(noReason)).code]).toEqual([400, 'validation_failed']);
    const rejected = await answer({
      status: 'rejected',
      answer: 'Это не форма собственности',
      version,
    });
    expect(rejected.status, await rejected.clone().text()).toBe(200);
    expect(AdminDictRequest.parse(await rejected.json())).toMatchObject({
      status: 'rejected',
      answer: 'Это не форма собственности',
      version: version + 1,
    });
    expect((await answer({ status: 'added', answer: '', version })).status).toBe(409);
    expect(
      (
        await send('POST', `/api/admin/dict-requests/${f.a.orgId}/answer`, {
          status: 'added',
          answer: '',
          version: 1,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send(
          'POST',
          `/api/admin/dict-requests/${sent.id}/answer`,
          { status: 'added', answer: '', version: 2 },
          owner,
        )
      ).status,
    ).toBe(403);

    const mine = DictRequests.parse(await (await get('/api/dict-requests', owner)).json());
    expect(mine.items[0]).toMatchObject({
      status: 'rejected',
      answer: 'Это не форма собственности',
    });
    expect(PdictsTabCounts.parse(await (await get(`${P}/tab-counts`)).json()).requests).toBe(0);
  });

  it(`«Попросить добавить» — не больше ${DICT_REQUEST_HOURLY_LIMIT} запросов в час от сотрудника`, async () => {
    const post = (what: string, cookie = acc) =>
      send('POST', '/api/dict-requests', { dict: 'types', what }, cookie);
    for (let i = 1; i <= DICT_REQUEST_HOURLY_LIMIT; i++) {
      expect((await post(`Вид ${i}`)).status).toBe(201);
    }
    // Неверные данные — 400 до счёта, а не 429.
    expect((await post(' ')).status).toBe(400);
    const limited = await post('Ещё вид');
    expect(limited.status).toBe(429);
    expect(await errorOf(limited)).toMatchObject({
      code: 'dict_request_rate',
      details: { n: DICT_REQUEST_HOURLY_LIMIT },
    });
    // Предел — у каждого сотрудника свой.
    expect((await post('Вид владельца', owner)).status).toBe(201);
  });
});
