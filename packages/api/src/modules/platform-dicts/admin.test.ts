import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { DICT_REQUEST_HOURLY_LIMIT } from '@buhuchet/domain';
import {
  AdminCalendarChanged,
  AdminCalendarCopied,
  AdminCalendarCopyPlan,
  AdminCalendarList,
  AdminDictGroups,
  AdminDictHistory,
  AdminDictList,
  AdminDictRequest,
  AdminDictRequestList,
  AdminDictValue,
  AdminReportTypeOptions,
  AdminTaxInfo,
  AdminTaxRowList,
  ApiError,
  DictRequest,
  DictRequests,
  ListValues,
  PdictsTabCounts,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
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
      `${P}/types`,
      `${P}/types/values?col=assigned`,
      `${P}/types/export?cols=assigned`,
      `${P}/groups`,
      `${P}/tab-counts`,
      `${P}/report-type-options`,
      `${P}/forms/history`,
      `${P}/forms/${encodeURIComponent('ФС-01')}`,
      `${P}/calendar`,
      `${P}/calendar/values?col=kind`,
      `${P}/calendar/export?cols=date`,
      `${P}/calendar/copy`,
      `${P}/calendar/history`,
      '/api/admin/tax-ref/info',
      '/api/admin/tax-ref/taxes',
      '/api/admin/tax-ref/en_rates/values?col=rate',
      '/api/admin/tax-ref/property_rates/export?cols=place',
      '/api/admin/dict-requests',
      '/api/admin/dict-requests/values?col=status',
      '/api/admin/dict-requests/export?cols=what',
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
      ['POST', `${P}/benefits`, { name: 'Взлом', gives: 'x', dueRules: [], types: [] }],
      [
        'PUT',
        `${P}/benefits/${encodeURIComponent('ЛЬГ-01')}`,
        { name: 'Взлом', gives: 'x', dueRules: [], version: 1 },
      ],
      ['POST', `${P}/types`, { name: 'Взлом', shortName: 'Взлом', act: 'sub' }],
      ['PUT', `${P}/types/nds`, { name: 'Взлом', shortName: 'Взлом', act: 'sub', version: 1 }],
      ['POST', `${P}/types/nds/active`, { active: false, version: 1 }],
      ['DELETE', `${P}/types/nds?version=1`, undefined],
      ['POST', `${P}/calendar`, { date: '2027-01-04', type: 'off', name: 'Взлом' }],
      ['DELETE', `${P}/calendar/2026-03-20?version=1`, undefined],
      ['POST', `${P}/calendar/copy`, undefined],
      [
        'POST',
        '/api/admin/dict-requests/00000000-0000-4000-8000-000000000000/answer',
        { status: 'added', answer: '', version: 1 },
      ],
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
      data: {
        contacts: [{ label: 'Приёмная', value: '+996 312 62 05 10' }],
        site: 'https://mineconom.gov.kg',
      },
    });
    expect(created.audit.createdAt).not.toBeNull();

    // Подпись без номера — ошибка под номером, ничего не записано.
    const noPhone = await send('POST', `${P}/organs`, {
      name: 'Минтруд',
      contacts: [{ label: 'Приёмная', value: ' ' }],
    });
    expect([noPhone.status, (await errorOf(noPhone)).code]).toEqual([400, 'validation_failed']);

    const taken = await send('POST', `${P}/organs`, { name: 'Минэкономики' });
    expect(taken.status).toBe(400);
    expect(await errorOf(taken)).toMatchObject({
      code: 'dict_value_taken',
      details: { field: 'name' },
    });
    const empty = await send('POST', `${P}/organs`, { name: '  ' });
    expect([empty.status, (await errorOf(empty)).code]).toEqual([400, 'validation_failed']);
  });

  it('банковский провайдер: «Тип» и «Переводы по номеру телефона», код по типу; неверный тип — 400', async () => {
    const res = await send('POST', `${P}/banks`, {
      name: 'Тест Кошелёк',
      kind: 'wallet',
      byPhone: true,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(AdminDictValue.parse(await res.json())).toMatchObject({
      code: 'КШЛ-06',
      data: { kind: 'wallet', byPhone: true, note: '' },
    });
    // Без типа — банк, без «Переводов по номеру» — нет.
    const bank = await send('POST', `${P}/banks`, { name: 'Тест Банк' });
    expect(AdminDictValue.parse(await bank.json())).toMatchObject({
      code: 'БНК-33',
      data: { kind: 'bank', byPhone: false },
    });
    const wrong = await send('POST', `${P}/banks`, { name: 'Третий', kind: 'card' });
    expect([wrong.status, (await errorOf(wrong)).code]).toEqual([400, 'validation_failed']);
    const list = AdminDictList.parse(
      await (await get(`${P}/banks?sort=code.desc&size=all`)).json(),
    );
    expect(list.items[0]).toMatchObject({ code: 'КШЛ-06' });
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

  it('режим: полное название обязательно, новый — специальный с кодом РЕЖ; тип не режима — 400', async () => {
    const base = { name: 'Новый режим', fullName: 'Налог на новое' };
    const noFull = await send('POST', `${P}/regimes`, { ...base, fullName: ' ' });
    expect([noFull.status, await errorOf(noFull)]).toMatchObject([
      400,
      { code: 'full_name_required', details: { field: 'fullName' } },
    ]);
    const bank = await send('POST', `${P}/regimes`, { ...base, kind: 'bank' });
    expect([bank.status, await errorOf(bank)]).toMatchObject([
      400,
      { code: 'invalid_kind', details: { field: 'kind' } },
    ]);
    const special = await send('POST', `${P}/banks`, { name: 'Четвёртый', kind: 'special' });
    expect([special.status, (await errorOf(special)).code]).toEqual([400, 'invalid_kind']);

    const res = await send('POST', `${P}/regimes`, {
      ...base,
      accountantNote: 'Для бухгалтера: один отчёт',
      article: 'гл. 66',
    });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(AdminDictValue.parse(await res.json())).toMatchObject({
      code: 'РЕЖ-13',
      n: 13,
      data: { kind: 'special', accountantNote: 'один отчёт', article: 'гл. 66', frees: '' },
    });
    const taken = await send('POST', `${P}/regimes`, { name: 'ОНР', fullName: 'Ещё один' });
    expect((await errorOf(taken)).code).toBe('dict_value_taken');
    const regimes = AdminDictList.parse(await (await get(`${P}/regimes?size=all`)).json());
    expect(regimes.items.find((x) => x.name === 'ОНР')).toMatchObject({
      data: { kind: 'general' },
      used: expect.any(Number),
    });
    expect(regimes.items.find((x) => x.name === 'ОНР')!.used).toBeGreaterThan(0);
  });

  it('основание: виды отчётов — только сквозные действующие; каталог видов кратко', async () => {
    const options = AdminReportTypeOptions.parse(
      await (await get(`${P}/report-type-options`)).json(),
    ).items;
    expect(options[0]).toMatchObject({
      code: 'nds',
      shortName: 'НДС',
      kind: 'regime',
      active: true,
      period: 'M',
      oneOff: false,
      periodPerAssignment: false,
    });
    const bad = await send('POST', `${P}/bases`, { name: 'Есть НДС', types: ['nds'] });
    expect([bad.status, await errorOf(bad)]).toMatchObject([
      400,
      { code: 'invalid_link', details: { field: 'types' } },
    ]);
    const res = await send('POST', `${P}/bases`, { name: 'Есть роялти', types: ['roy'] });
    expect(res.status, await res.clone().text()).toBe(201);
    const created = AdminDictValue.parse(await res.json());
    expect(created).toMatchObject({ n: null, used: 1, contractors: 0, data: { types: ['roy'] } });
    const taken = await send('POST', `${P}/bases`, { name: 'Есть роялти' });
    expect((await errorOf(taken)).code).toBe('dict_value_taken');
  });

  it('льгота или статус: «Что даёт» обязательно, связи и «Меняет сроки» проверяются; список по коду', async () => {
    const list = AdminDictList.parse(await (await get(`${P}/benefits`)).json());
    expect(list.items[0]).toMatchObject({ code: 'ЛЬГ-01', n: null, data: { kind: 'benefit' } });
    const rule = { reportType: 'nds', dueDay: 31, dueAfter: 1, dueMonth: null };
    const bad: [Record<string, unknown>, string, string][] = [
      [{ gives: ' ' }, 'gives_required', 'gives'],
      [{ removes: ['nope'] }, 'invalid_link', 'removes'],
      [{ removes: ['nds'], adds: ['nds'] }, 'benefit_types_both', 'adds'],
      [{ offices: ['nope'] }, 'invalid_link', 'offices'],
      [
        { dueRules: [{ ...rule, dueDay: null, dueAfter: null, payDay: null, payAfter: null }] },
        'due_rule_empty',
        'dueRules',
      ],
      [{ kind: 'bank' }, 'invalid_kind', 'kind'],
    ];
    for (const [patch, code, field] of bad) {
      const res = await send('POST', `${P}/benefits`, {
        name: 'Резидент СЭЗ',
        gives: 'Освобождение от НДС',
        ...patch,
      });
      expect([res.status, await errorOf(res)], code).toMatchObject([
        400,
        { code, details: { field } },
      ]);
    }
    // День срока вне 1–31 и неверная дата — схема.
    const day = await send('POST', `${P}/benefits`, {
      name: 'Резидент СЭЗ',
      gives: 'Освобождение от НДС',
      dueRules: [{ ...rule, dueDay: 32, payDay: null, payAfter: null }],
    });
    expect(day.status).toBe(400);
    const date = await send('POST', `${P}/benefits`, {
      name: 'Резидент СЭЗ',
      gives: 'Освобождение от НДС',
      validUntil: '31.12.2030',
    });
    expect(date.status).toBe(400);

    const res = await send('POST', `${P}/benefits`, {
      name: 'Резидент СЭЗ',
      gives: 'Освобождение от НДС',
      kind: 'status',
      validUntil: '2030-12-31',
      verify: true,
      adds: ['soc'],
      dueRules: [{ ...rule, payDay: 25, payAfter: 1 }],
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const created = AdminDictValue.parse(await res.json());
    expect(created).toMatchObject({
      code: 'ЛЬГ-32',
      n: null,
      data: {
        kind: 'status',
        payer: 'all',
        validUntil: '2030-12-31',
        verify: true,
        adds: ['soc'],
        dueRules: [{ ...rule, payDay: 25, payAfter: 1 }],
      },
    });
    const taken = await send('POST', `${P}/benefits`, { name: 'Резидент СЭЗ', gives: 'Другое' });
    expect((await errorOf(taken)).code).toBe('dict_value_taken');
  });

  it('вид отчёта: краткое название, орган и «Что нужно сделать» обязательны; режимы, платежи, ставки ЕН проверяются', async () => {
    const list = AdminDictList.parse(await (await get(`${P}/types`)).json());
    expect(list.items[0]).toMatchObject({
      code: 'nds',
      n: null,
      data: { act: 'both', kind: 'regime', regimes: ['РЕЖ-01'] },
      texts: { act: 'Сдача + уплата', authorityCode: 'ГНС' },
      // «Назначен» — по всем организациям; назначений в тесте нет.
      assigned: 0,
    });
    const assigned = ListValues.parse(await (await get(`${P}/types/values?col=assigned`)).json());
    expect(assigned.items.map((v) => v.value)).toEqual(['0']);
    const base = {
      name: 'Плата за загрязнение',
      shortName: 'Экология',
      authorityCode: 'ОРГ-01',
      act: 'sub',
    };
    const bad: [Record<string, unknown>, string, string][] = [
      [{ shortName: ' ' }, 'short_name_required', 'shortName'],
      [{ authorityCode: '' }, 'authority_required', 'authorityCode'],
      [{ act: undefined }, 'act_required', 'act'],
      [{ kind: 'regime' }, 'regimes_required', 'regimes'],
      [{ act: 'pay' }, 'payments_required', 'payments'],
      [{ kind: 'regime', regimes: ['РЕЖ-12'] }, 'invalid_link', 'regimes'],
      [
        { kind: 'regime', regimes: ['РЕЖ-01'], notForRegimes: ['РЕЖ-01'] },
        'regimes_both',
        'notForRegimes',
      ],
      [{ bases: ['transport'] }, 'invalid_link', 'bases'],
      [{ authorityCode: 'ОРГ-99' }, 'invalid_link', 'authorityCode'],
      [{ notForEnRates: ['ЕНС-99'] }, 'invalid_en_rates', 'notForEnRates'],
      [{ kind: 'special' }, 'invalid_kind', 'kind'],
    ];
    for (const [patch, code, field] of bad) {
      const res = await send('POST', `${P}/types`, { ...base, ...patch });
      expect([res.status, await errorOf(res)], code).toMatchObject([
        400,
        { code, details: { field } },
      ]);
    }
    // День срока вне 1–31, «M-го месяца» больше 6, график с днём 32 — схема.
    for (const patch of [{ dueDay: 32 }, { dueAfter: 7 }, { paySchedule: [[3, 32]] }]) {
      expect((await send('POST', `${P}/types`, { ...base, ...patch })).status).toBe(400);
    }

    const res = await send('POST', `${P}/types`, {
      ...base,
      act: 'both',
      payments: [{ name: 'Плата', authority: 'ОРГ-01', kbk: '' }],
      payDay: 25,
      payAfter: 1,
      bases: ['emissions'],
      source: 'stat.gov.kg/forms',
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const created = AdminDictValue.parse(await res.json());
    // Не переданные поля — как у нового вида; «Источник» — адрес с протоколом.
    expect(created).toMatchObject({
      code: expect.stringMatching(/^type-[0-9a-f]{8}$/),
      data: {
        period: 'M',
        dueDay: 20,
        dueAfter: 1,
        kind: 'cross',
        payer: 'all',
        pickGroup: 'optional',
        preselect: true,
        shiftToWorkday: true,
        payDay: 25,
        bases: ['emissions'],
        source: 'https://stat.gov.kg/forms',
      },
      reports: { total: 0, open: 0, orgs: 0 },
    });
    const history = AdminDictHistory.parse(await (await get(`${P}/types/history`)).json());
    expect(history.items[0]).toMatchObject({ action: 'create', label: 'Плата за загрязнение' });
    const taken = await send('POST', `${P}/types`, { ...base, shortName: 'Другое' });
    expect((await errorOf(taken)).code).toBe('dict_value_taken');
    // Вид, на который ссылается статус, удалить нельзя — только отключить.
    const nds = await value(`${P}/types/nds`);
    const del = await send('DELETE', `${P}/types/nds?version=${nds.version}`);
    expect([del.status, (await errorOf(del)).code]).toEqual([409, 'dict_value_used']);
  });

  it('код страны: код и маска обязательны; Кыргызстан не отключается, коды стран не удаляются', async () => {
    const base = { name: 'Монголия', flag: '🇲🇳' };
    const noCode = await send('POST', `${P}/phones`, { ...base, mask: 'XXXX XXXX' });
    expect([noCode.status, await errorOf(noCode)]).toMatchObject([
      400,
      { code: 'dial_code_required', details: { field: 'dialCode' } },
    ]);
    const badMask = await send('POST', `${P}/phones`, { ...base, dialCode: '976', mask: '99-99' });
    expect([badMask.status, (await errorOf(badMask)).code]).toEqual([400, 'validation_failed']);
    const res = await send('POST', `${P}/phones`, { ...base, dialCode: '976', mask: 'XXXX XXXX' });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(AdminDictValue.parse(await res.json())).toMatchObject({
      code: 'X-01',
      n: null,
      data: { dialCode: '976', mask: 'XXXX XXXX', flag: '🇲🇳' },
    });
    const taken = await send('POST', `${P}/phones`, { ...base, dialCode: '976', mask: 'XX' });
    expect((await errorOf(taken)).code).toBe('dict_value_taken');

    const kg = await value(`${P}/phones/KG`);
    const off = await send('POST', `${P}/phones/KG/active`, { active: false, version: kg.version });
    expect([off.status, (await errorOf(off)).code]).toEqual([409, 'dict_value_fixed']);
    const del = await send('DELETE', `${P}/phones/KG?version=${kg.version}`);
    expect([del.status, (await errorOf(del)).code]).toEqual([409, 'dict_value_undeletable']);
    // Порядка у кодов стран нет.
    const move = await send('POST', `${P}/phones/KG/move`, { step: 1, version: kg.version });
    expect(move.status).toBe(404);
  });

  it('календарь: дни текущего и следующего года, «Нерабочий день», «Удалить», копирование на следующий год', async () => {
    const list = AdminCalendarList.parse(await (await get(`${P}/calendar?size=all`)).json());
    expect([list.year, list.nextFilled]).toEqual([2026, true]);
    expect(list.items[0]).toMatchObject({ key: '01-01', date: '2026-01-01', everyYear: true });
    const file = await get(`${P}/calendar/export?cols=date,name`);
    expect(file.headers.get('content-type')).toContain('spreadsheetml');

    const add = (body: unknown) => send('POST', `${P}/calendar`, body);
    const saturday = await add({ date: '2027-03-15', type: 'workday', name: '' });
    expect([saturday.status, await errorOf(saturday)]).toMatchObject([
      400,
      { code: 'calendar_not_saturday', details: { field: 'date' } },
    ]);
    const year = await add({ date: '2030-01-04', type: 'off', name: 'Праздник' });
    expect(await errorOf(year)).toMatchObject({
      code: 'calendar_date_year',
      details: { field: 'date', y: 2026, next: 2027 },
    });
    const noName = await add({ date: '2027-01-04', type: 'off', name: ' ' });
    expect([noName.status, (await errorOf(noName)).code]).toEqual([400, 'validation_failed']);
    const res = await add({ date: '2027-01-04', type: 'off', name: 'Перенос: Новый год' });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(AdminCalendarChanged.parse(await res.json())).toEqual({
      recalculated: 0,
      pending: false,
    });
    const taken = await add({ date: '2027-01-04', type: 'off', name: 'Ещё раз' });
    expect((await errorOf(taken)).code).toBe('calendar_date_taken');

    const after = AdminCalendarList.parse(await (await get(`${P}/calendar?size=all`)).json());
    const day = after.items.find((x) => x.key === '2027-01-04')!;
    expect(day).toMatchObject({ kind: 'transfer', everyYear: false });
    const fixed = await send('DELETE', `${P}/calendar/01-01?version=1`);
    expect([fixed.status, (await errorOf(fixed)).code]).toEqual([409, 'calendar_day_fixed']);
    const stale = await send('DELETE', `${P}/calendar/2027-01-04?version=${day.version + 1}`);
    expect(stale.status).toBe(409);
    const del = await send('DELETE', `${P}/calendar/2027-01-04?version=${day.version}`);
    expect(del.status).toBe(204);
    expect((await send('DELETE', `${P}/calendar/2027-01-04?version=${day.version}`)).status).toBe(
      404,
    );
    expect((await send('DELETE', `${P}/calendar/not-a-day?version=1`)).status).toBe(400);

    const plan = AdminCalendarCopyPlan.parse(await (await get(`${P}/calendar/copy`)).json());
    // Перенос, Орозо айт и Курман айт; рабочая суббота 14.03 — нет: 14.03.2027 — воскресенье.
    expect([plan.year, plan.items.length]).toEqual([2027, 3]);
    const copy = await send('POST', `${P}/calendar/copy`);
    expect(AdminCalendarCopied.parse(await copy.json())).toEqual({
      year: 2027,
      copied: 3,
      recalculated: 0,
      pending: false,
    });
    // «История изменений» календаря: три скопированных дня, удалённый и добавленный перенос.
    const history = AdminDictHistory.parse(await (await get(`${P}/calendar/history`)).json());
    expect(history.total).toBe(5);
    expect(history.items.map((h) => h.action)).toEqual([
      'create',
      'create',
      'create',
      'delete',
      'create',
    ]);
    expect(history.items[3]).toMatchObject({ code: '2027-01-04', label: 'Перенос: Новый год' });
  });

  it('«Налоги и ставки»: три таблицы только для просмотра, значения фильтра, Excel и пояснения', async () => {
    const T = '/api/admin/tax-ref';
    const taxes = AdminTaxRowList.parse(await (await get(`${T}/taxes?size=all`)).json());
    expect(taxes.total).toBe(30);
    expect(taxes.items[0]).toMatchObject({
      id: 'НАЛ-01',
      values: { code: 'НАЛ-01', verify: 'yes', verify_text: 'Сверить' },
    });
    const rates = AdminTaxRowList.parse(await (await get(`${T}/en_rates`)).json());
    expect(rates.items[0]!.values.code).toBe('ЕНС-01');
    const property = AdminTaxRowList.parse(
      await (await get(`${T}/property_rates?size=all`)).json(),
    );
    expect(property.items.find((x) => x.id === 'ИМН-01')!.values.homeA).toBe(5050);

    const verify = ListValues.parse(await (await get(`${T}/taxes/values?col=verify`)).json());
    expect(verify.items.map((x) => x.label).sort()).toEqual(['Сверить', '—']);
    const file = await get(`${T}/en_rates/export?cols=code,rate`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toContain('spreadsheetml');

    const info = AdminTaxInfo.parse(await (await get(`${T}/info`)).json());
    expect(info.bizSize.map((x) => x.name)).toEqual(['Малый', 'Средний', 'Крупный']);
    expect(info.enRates).toHaveLength(2);

    // Нет такой таблицы или столбца — 400.
    expect((await get(`${T}/gked`)).status).toBe(400);
    expect((await get(`${T}/taxes/values?col=nope`)).status).toBe(400);
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

  it(`«Попросить добавить» — не больше ${DICT_REQUEST_HOURLY_LIMIT} запросов в час от организации`, async () => {
    const post = (what: string, cookie = acc) =>
      send('POST', '/api/dict-requests', { dict: 'types', what }, cookie);
    // Запросы организации из прошлых проверок — не в счёт этой.
    await f.t.admin.db
      .delete(schema.rateLimits)
      .where(
        and(
          eq(schema.rateLimits.kind, 'dict_request'),
          eq(schema.rateLimits.subject, f.a.orgId),
        ),
      );
    for (let i = 1; i <= DICT_REQUEST_HOURLY_LIMIT; i++) {
      expect((await post(`Вид ${i}`)).status).toBe(201);
    }
    // Неверные данные — 400 до счёта, а не 429.
    expect((await post(' ')).status).toBe(400);
    const limited = await post('Ещё вид');
    expect(limited.status).toBe(429);
    expect(await errorOf(limited)).toMatchObject({
      code: 'dict_request_rate',
      message: `Не больше ${DICT_REQUEST_HOURLY_LIMIT} запросов за час. Отправьте этот запрос позже`,
      details: { n: DICT_REQUEST_HOURLY_LIMIT, field: 'what' },
    });
    // Предел — у организации: другой её сотрудник тоже не отправит (ТЗ v63, docs/deviations.md п. Д-4).
    expect((await post('Вид владельца', owner)).status).toBe(429);
  });
});
