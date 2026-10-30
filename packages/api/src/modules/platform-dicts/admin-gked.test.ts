import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { bishkekDate, ioTsv, UI_TEXTS } from '@buhuchet/domain';
import {
  AdminBulkResult,
  AdminDictHistory,
  AdminDictImportApplied,
  AdminDictImportPreview,
  AdminDictIoFile,
  AdminDictValue,
  AdminDuesPreview,
  AdminEnRate,
  AdminGkedGroups,
  AdminGkedItems,
  ApiError,
} from '@buhuchet/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_ORIGIN, TEST_PASSWORD } from '../../testing';

// Админка → «Справочники платформы»: вкладка «ГКЭД» (задача 2.38), массовые действия, «Сверено с ГНС»,
// «Выгрузить» / «Загрузить» календаря и «Налогов и ставок» (задача 2.37, часть 3).

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const title = (key: keyof typeof UI_TEXTS) => UI_TEXTS[key].ru;

describe.skipIf(!databaseAvailable())(
  'Админка → «Справочники платформы»: ГКЭД, массовые действия и Excel разделов',
  () => {
    let f: Fixture;
    let admin: string;
    let owner: string;

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      [admin, owner] = await Promise.all([
        signIn(f.app, 'platform-admin', TEST_PASSWORD),
        signIn(f.app, 'owner-a', TEST_PASSWORD),
      ]);
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    const PD = '/api/admin/platform-dicts';
    const BULK = '/api/admin/platform-dicts-bulk';
    const IO = '/api/admin/platform-dicts-io';
    const get = (path: string, cookie = admin) => apiRequest(f.app, 'GET', path, cookie);
    const send = (method: 'POST' | 'PUT', path: string, body: unknown, cookie = admin) =>
      apiRequest(f.app, method, path, cookie, body);
    const errorOf = async (res: Response) => ApiError.parse(await res.json()).error;
    const value = async (dict: string, code: string) =>
      AdminDictValue.parse(await (await get(`${PD}/${dict}/${encodeURIComponent(code)}`)).json());
    const items = async () =>
      AdminGkedItems.parse(await (await get('/api/admin/platform-gked/items')).json()).items;
    const groups = async () =>
      AdminGkedGroups.parse(await (await get('/api/admin/platform-gked/groups')).json());
    const history = async (path: string) => AdminDictHistory.parse(await (await get(path)).json());
    const upload = (path: string, text: string) =>
      f.app.request(path, {
        method: 'POST',
        headers: {
          origin: TEST_ORIGIN,
          cookie: admin,
          'content-type': 'text/plain; charset=utf-8',
        },
        body: text,
      });
    const file = async (dict: string) =>
      AdminDictIoFile.parse(await (await get(`${IO}/${dict}`)).json());
    const preview = async (dict: string, text: string) => {
      const res = await upload(`${IO}/${dict}/preview`, text);
      expect(res.status, await res.clone().text()).toBe(200);
      return AdminDictImportPreview.parse(await res.json());
    };
    const apply = async (dict: string, text: string) => {
      const p = await preview(dict, text);
      const res = await upload(`${IO}/${dict}/apply?stamp=${p.stamp}`, text);
      expect(res.status, await res.clone().text()).toBe(200);
      return AdminDictImportApplied.parse(await res.json());
    };
    /** Строки файла: в строке `row` ячейку столбца `column` заменить на `text`. */
    const edited = (
      data: { header: string[]; rows: string[][] },
      row: number,
      column: string,
      text: string,
    ) => {
      const rows = data.rows.map((r) => [...r]);
      rows[row]![data.header.indexOf(column)] = text;
      return ioTsv([data.header, ...rows]);
    };

    it('только администратор платформы: сотруднику организации и без входа — отказ', async () => {
      const reads = [
        '/api/admin/platform-gked/items',
        '/api/admin/platform-gked/groups',
        '/api/admin/platform-enrates/ЕНС-01',
        '/api/admin/tax-ref/history',
        `${IO}/calendar`,
        `${IO}/taxes`,
        `${IO}/gkgroups`,
      ];
      for (const path of reads) {
        expect((await get(path, owner)).status, path).toBe(403);
        expect((await get(path, '')).status, path).toBe(401);
      }
      const writes: ['POST' | 'PUT', string, unknown][] = [
        [
          'PUT',
          '/api/admin/platform-gked/groups/banks',
          { name: 'x', codes: ['64'], en: null, spino: null, ask: '', why: '', version: 1 },
        ],
        [
          'PUT',
          '/api/admin/platform-enrates/ЕНС-01/gked',
          { gked: { in: [], ex: [] }, version: 1 },
        ],
        ['POST', `${BULK}/types/active`, { codes: ['nds'], active: false }],
        ['POST', `${BULK}/types/active/dues-preview`, { codes: ['nds'], active: false }],
        ['POST', `${BULK}/types/due`, { codes: ['nds'], day: 20 }],
        ['POST', `${BULK}/types/due/dues-preview`, { codes: ['nds'], day: 20 }],
        ['POST', `${BULK}/types/gns`, { codes: ['nds'] }],
      ];
      for (const [method, path, body] of writes) {
        expect((await send(method, path, body, owner)).status, path).toBe(403);
        expect((await send(method, path, body, '')).status, path).toBe(401);
      }
      // Сам вид не изменился.
      expect((await value('types', 'nds')).active).toBe(true);
    });

    it('код ГКЭД: новый — в формате классификатора и с «Входит в» уровнем выше; правка, «Действует», удаление только неиспользуемого без вложенных', async () => {
      const all = await items();
      expect(all.length).toBeGreaterThan(1800);
      const cls = all.find((x) => x.code === '69.20')!;
      expect(cls).toMatchObject({ level: 'class', parentCode: '69.2' });
      expect(cls.children).toBeGreaterThan(0);

      const add = (body: Record<string, unknown>) => send('POST', `${PD}/gked`, body);
      const base = {
        name: 'Проверка кода',
        level: 'subclass',
        parentCode: '69.20',
        note: '',
        active: true,
      };
      const fails: [Record<string, unknown>, string][] = [
        [{ ...base, code: '' }, 'gked_code_required'],
        [{ ...base, code: '69.2' }, 'gked_code_taken'],
        [{ ...base, code: '69.200' }, 'gked_code_format'],
        [{ ...base, code: '69.20.8', parentCode: null }, 'gked_parent_required'],
        [{ ...base, code: '69.20.8', parentCode: '99.99' }, 'gked_parent_unknown'],
        [{ ...base, code: '69.20.8', parentCode: '69.20.0' }, 'gked_parent_level'],
        [{ ...base, code: 'ZZ', level: 'section', parentCode: 'A' }, 'gked_parent_section'],
      ];
      for (const [body, code] of fails) {
        const res = await add(body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect((await errorOf(res)).code, JSON.stringify(body)).toBe(code);
      }

      const created = await add({ ...base, code: '69.20.8' });
      expect(created.status, await created.clone().text()).toBe(201);
      const fresh = (await items()).find((x) => x.code === '69.20.8')!;
      expect(fresh).toMatchObject({ level: 'subclass', parentCode: '69.20', used: 0, children: 0 });
      expect((await items()).find((x) => x.code === '69.20')!.children).toBe(cls.children + 1);

      // Правка: название — в истории вкладки (раздел «gked»), подпись — нынешнее название.
      const put = await send('PUT', `${PD}/gked/69.20.8`, {
        name: 'Проверка кода, правка',
        level: 'subclass',
        parentCode: '69.20',
        note: 'Пример',
        active: true,
        version: fresh.version,
      });
      expect(put.status, await put.clone().text()).toBe(200);
      const h = await history(`${PD}/gked/history`);
      expect(h.items[0]).toMatchObject({
        section: 'gked',
        code: '69.20.8',
        action: 'update',
        label: 'Проверка кода, правка',
      });
      expect(h.items[1]).toMatchObject({
        section: 'gked',
        action: 'create',
        label: 'Проверка кода',
      });

      // У кода с вложенными удаление — отказ; снять «Действует» можно.
      const parent = await value('gked', '69.20');
      const del = await apiRequest(
        f.app,
        'DELETE',
        `${PD}/gked/69.20?version=${parent.version}`,
        admin,
      );
      expect(del.status).toBe(409);
      expect((await errorOf(del)).code).toBe('dict_value_children');

      const now = await value('gked', '69.20.8');
      const off = await send('POST', `${PD}/gked/69.20.8/active`, {
        active: false,
        version: now.version,
      });
      expect(off.status, await off.clone().text()).toBe(200);
      expect((await value('gked', '69.20.8')).active).toBe(false);

      // Указанный в перечне код удалить нельзя — только снять «Действует».
      const used = (await items()).find((x) => x.used > 0 && x.children === 0)!;
      const usedDel = await apiRequest(
        f.app,
        'DELETE',
        `${PD}/gked/${encodeURIComponent(used.code)}?version=${used.version}`,
        admin,
      );
      expect(usedDel.status).toBe(409);
      expect((await errorOf(usedDel)).code).toBe('dict_value_used');

      const last = await value('gked', '69.20.8');
      const gone = await apiRequest(
        f.app,
        'DELETE',
        `${PD}/gked/69.20.8?version=${last.version}`,
        admin,
      );
      expect(gone.status).toBe(204);
      expect((await items()).some((x) => x.code === '69.20.8')).toBe(false);
    });

    it('группа кодов: правка меняет «Кроме» и «Предупреждать при ГКЭД» режима ЕН и статуса СПиНО; устаревшая версия — 409, неизвестный код — 400', async () => {
      const before = await groups();
      const banks = before.items.find((g) => g.codes.includes('64.11'))!;
      const regime = before.targets.en.find((x) => x.kind === 'regime')!;
      const status = before.targets.spino[0]!;
      expect(regime).toBeTruthy();
      expect(status).toBeTruthy();
      const rule = async (dict: string, code: string) =>
        (await value(dict, code)).data.gked as { ex: string[]; warn?: string[] };
      expect((await rule('regimes', regime.code)).ex).toContain('64.11');

      const body = (patch: Record<string, unknown>) => ({
        name: banks.name,
        codes: banks.codes,
        en: banks.en,
        spino: banks.spino,
        ask: banks.ask,
        why: banks.why,
        version: before.version,
        ...patch,
      });
      const path = `/api/admin/platform-gked/groups/${banks.id}`;

      // Служебные имена объектов ключом группы не бывают — 400, перечни не меняются.
      for (const id of ['__proto__', 'constructor', 'toString']) {
        const res = await send('PUT', `/api/admin/platform-gked/groups/${id}`, body({}));
        expect(res.status, id).toBe(id === 'toString' ? 404 : 400);
      }

      const unknown = await send('PUT', path, body({ codes: [...banks.codes, '99.99'] }));
      expect(unknown.status).toBe(400);
      expect(await errorOf(unknown)).toMatchObject({ code: 'gked_unknown' });

      // 64.11 — теперь предупреждение в едином налоге и запрет в СПиНО; 64.19.1 уходит из группы.
      const saved = await send('PUT', path, body({ codes: ['64.11'], en: 'warn', spino: 'ex' }));
      expect(saved.status, await saved.clone().text()).toBe(200);
      const after = AdminGkedGroups.parse(await saved.json());
      expect(after.version).toBe(before.version + 1);
      const en = await rule('regimes', regime.code);
      expect(en.ex).not.toContain('64.11');
      expect(en.ex).not.toContain('64.19.1');
      expect(en.warn).toContain('64.11');
      const spino = await rule('benefits', status.code);
      expect(spino.ex).toContain('64.11');
      expect(spino.ex).not.toContain('64.19.1');

      // История вкладки «ГКЭД»: группа и перечни.
      const h = await history(`${PD}/gked/history`);
      expect(h.items.some((x) => x.section === 'gkgroups' && x.code === banks.id)).toBe(true);
      const regimeHistory = await history(`${PD}/regimes/history`);
      expect(regimeHistory.items[0]).toMatchObject({ code: regime.code, action: 'update' });

      // Версия устарела — 409, ничего не меняется.
      const stale = await send('PUT', path, body({ codes: banks.codes }));
      expect(stale.status).toBe(409);
      expect((await errorOf(stale)).code).toBe('record_changed');

      // Вернуть как было.
      const back = await send('PUT', path, body({ version: after.version }));
      expect(back.status, await back.clone().text()).toBe(200);
      expect((await rule('regimes', regime.code)).ex).toEqual(
        expect.arrayContaining(['64.11', '64.19.1']),
      );
    });

    it('ставка единого налога: «Виды деятельности (ГКЭД)» — подбор по основному ГКЭД, история на вкладке «Налоги и ставки»', async () => {
      const rate = AdminEnRate.parse(
        await (await get('/api/admin/platform-enrates/ЕНС-01')).json(),
      );
      expect(rate.gked?.in.length).toBeGreaterThan(0);
      const path = '/api/admin/platform-enrates/ЕНС-01/gked';

      const unknown = await send('PUT', path, {
        gked: { in: [...rate.gked!.in, '99.99'], ex: rate.gked!.ex },
        version: rate.version,
      });
      expect(unknown.status).toBe(400);
      expect(await errorOf(unknown)).toMatchObject({
        code: 'gked_unknown',
        details: expect.objectContaining({ field: 'gked', codes: '99.99' }),
      });

      const saved = await send('PUT', path, {
        gked: { in: [...rate.gked!.in, '47.11'], ex: rate.gked!.ex },
        version: rate.version,
      });
      expect(saved.status, await saved.clone().text()).toBe(200);
      const after = AdminEnRate.parse(await saved.json());
      expect(after.version).toBe(rate.version + 1);
      expect(after.gked).toMatchObject({ main: true, in: expect.arrayContaining(['47.11']) });
      // Примечание и «Сверить» перечня окно не правит — они сохраняются.
      expect(after.gked?.note).toBe(rate.gked?.note);

      const h = await history('/api/admin/tax-ref/history');
      expect(h.items[0]).toMatchObject({ section: 'enrates', code: 'ЕНС-01', action: 'update' });

      const stale = await send('PUT', path, { gked: { in: [], ex: [] }, version: rate.version });
      expect(stale.status).toBe(409);
    });

    it('массовые: «Отключить» / «Включить» у отмеченных — у каждого строка истории; нет значения — 404 и ничего не меняется', async () => {
      const codes = ['nds', 'akc'];
      const off = await send('POST', `${BULK}/types/active`, { codes, active: false });
      expect(off.status, await off.clone().text()).toBe(200);
      expect(AdminBulkResult.parse(await off.json()).n).toBe(2);
      for (const c of codes) expect((await value('types', c)).active).toBe(false);
      const h = await history(`${PD}/types/history`);
      expect(new Set(h.items.slice(0, 2).map((x) => x.code))).toEqual(new Set(codes));

      const missing = await send('POST', `${BULK}/types/active`, {
        codes: [...codes, 'nope'],
        active: true,
      });
      expect(missing.status).toBe(404);
      for (const c of codes) expect((await value('types', c)).active).toBe(false);

      const on = await send('POST', `${BULK}/types/active`, { codes, active: true });
      expect(on.status).toBe(200);
      for (const c of codes) expect((await value('types', c)).active).toBe(true);

      // Справочник без «Включить» / «Отключить» и пустой список — 400.
      expect((await send('POST', `${BULK}/types/active`, { codes: [], active: true })).status).toBe(
        400,
      );
      expect((await send('POST', `${BULK}/nope/active`, { codes, active: true })).status).toBe(400);
    });

    it('статус с «Меняет сроки»: предпросмотр «Отключить» — число отчётов без записи; отключение и включение — со строкой истории', async () => {
      const big = await value('benefits', 'ЛЬГ-30');
      expect((big.data.dueRules as unknown[]).length).toBeGreaterThan(0);
      const body = { codes: ['ЛЬГ-30'], active: false };
      const preview = await send('POST', `${BULK}/benefits/active/dues-preview`, body);
      expect(preview.status, await preview.clone().text()).toBe(200);
      expect(AdminDuesPreview.parse(await preview.json())).toMatchObject({
        reports: expect.any(Number),
        orgs: expect.any(Number),
      });
      expect((await value('benefits', 'ЛЬГ-30')).version).toBe(big.version);

      const off = await send('POST', `${BULK}/benefits/active`, body);
      expect(off.status, await off.clone().text()).toBe(200);
      expect(AdminBulkResult.parse(await off.json())).toMatchObject({ n: 1 });
      expect((await value('benefits', 'ЛЬГ-30')).active).toBe(false);
      const h = await history(`${PD}/benefits/history`);
      expect(h.items[0]).toMatchObject({ code: 'ЛЬГ-30', action: 'update' });

      const on = await send('POST', `${BULK}/benefits/active`, { ...body, active: true });
      expect(on.status).toBe(200);
      expect((await value('benefits', 'ЛЬГ-30')).active).toBe(true);
    });

    it('«Изменить срок у N видов»: число — у всех, месяцев после периода — у не годовых, месяц — у годовых; пусто — 400; предпросмотр не сохраняет', async () => {
      const empty = await send('POST', `${BULK}/types/due`, { codes: ['nds'] });
      expect(empty.status).toBe(400);
      expect(await errorOf(empty)).toMatchObject({ code: 'validation_failed' });

      const nds = await value('types', 'nds');
      const yearly = (await (await get(`${PD}/types?size=all`)).json()) as {
        items: { code: string; active: boolean; data: { period?: string } }[];
      };
      const year = yearly.items.find((x) => x.data.period === 'Y' && x.active)!;
      const yearBefore = await value('types', year.code);

      const preview = await send('POST', `${BULK}/types/due/dues-preview`, {
        codes: ['nds', year.code],
        day: 21,
      });
      expect(preview.status, await preview.clone().text()).toBe(200);
      AdminDuesPreview.parse(await preview.json());
      expect((await value('types', 'nds')).version).toBe(nds.version);

      const res = await send('POST', `${BULK}/types/due`, {
        codes: ['nds', year.code],
        day: 21,
        after: 2,
        month: 4,
      });
      expect(res.status, await res.clone().text()).toBe(200);
      expect(AdminBulkResult.parse(await res.json()).n).toBe(2);
      const ndsAfter = await value('types', 'nds');
      expect(ndsAfter.data).toMatchObject({ dueDay: 21, dueAfter: 2 });
      expect(ndsAfter.data.dueMonth ?? null).toBe(nds.data.dueMonth ?? null);
      const yearAfter = await value('types', year.code);
      expect(yearAfter.data).toMatchObject({ dueDay: 21, dueMonth: 4 });
      expect(yearAfter.data.dueAfter ?? null).toBe(yearBefore.data.dueAfter ?? null);

      // Вернуть сроки НДС как были.
      const back = await send('POST', `${BULK}/types/due`, {
        codes: ['nds'],
        day: nds.data.dueDay as number,
        after: nds.data.dueAfter as number,
      });
      expect(back.status).toBe(200);
    });

    it('«Отметить сверку с ГНС»: сегодняшняя дата и кто сверял; в истории — одной строкой', async () => {
      const res = await send('POST', `${BULK}/types/gns`, { codes: ['nds', 'akc', 'nds'] });
      expect(res.status, await res.clone().text()).toBe(200);
      expect(AdminBulkResult.parse(await res.json()).n).toBe(2);
      const nds = await value('types', 'nds');
      expect(nds.gns).toEqual({ at: bishkekDate(new Date()), by: expect.any(String) });
      const h = await history(`${PD}/types/history`);
      expect(h.items[0]).toMatchObject({ code: '', action: 'update' });
      expect(h.items[0]!.changes[0]).toMatchObject({ field: 'gns' });
      expect((await send('POST', `${BULK}/types/gns`, { codes: [] })).status).toBe(400);
    });

    it('(проверка задачи #93) календарь: одна изменённая строка — одно изменение, после применения — история; загрузку можно откатить', async () => {
      const data = await file('calendar');
      expect(data.header.slice(0, 2)).toEqual([
        title('pdicts.io.col.date'),
        title('pdicts.io.col.name'),
      ]);
      const same = await preview('calendar', ioTsv([data.header, ...data.rows]));
      expect({ change: same.change, add: same.add, errors: same.errors }).toEqual({
        change: [],
        add: [],
        errors: [],
      });
      const text = edited(data, 0, title('pdicts.io.col.name'), 'Новый год (из Excel)');
      const applied = await apply('calendar', text);
      expect(applied.preview.change).toHaveLength(1);
      const days = (await (await get(`${PD}/calendar?size=all`)).json()) as {
        items: { name: string }[];
      };
      expect(days.items.some((x) => x.name === 'Новый год (из Excel)')).toBe(true);
      const h = await history(`${PD}/calendar/history`);
      expect(h.items.some((x) => x.action === 'import')).toBe(true);

      const rollback = await apiRequest(
        f.app,
        'POST',
        `/api/admin/platform-dict-loads/${applied.load.id}/rollback`,
        admin,
      );
      expect(rollback.status, await rollback.clone().text()).toBe(200);
      const back = (await (await get(`${PD}/calendar?size=all`)).json()) as {
        items: { name: string }[];
      };
      expect(back.items.some((x) => x.name === 'Новый год (из Excel)')).toBe(false);
    });

    it('календарь в Excel: «Каждый год» — только у государственных праздников, год — текущий или следующий, «Рабочая суббота» — только суббота', async () => {
      const data = await file('calendar');
      const col = (key: Parameters<typeof title>[0]) => data.header.indexOf(title(key));
      const kind = col('pdicts.io.col.kind');
      const rule = col('pdicts.io.col.cal_rule');
      const yearly = data.rows.findIndex((r) => r[rule] === title('pdicts.io.cal.rule.yearly'));
      expect(yearly).toBeGreaterThanOrEqual(0);
      const year = Number(/\d{4}/.exec(data.rows[0]![0]!)![0]);
      // Будний день текущего года: 5 января или следующий будний.
      const weekday = [5, 6, 7]
        .map((d) => `${year}-01-0${d}`)
        .find((d) => {
          const w = new Date(`${d}T00:00:00Z`).getUTCDay();
          return w !== 0 && w !== 6;
        })!;
      const row = (date: string, k: string, r: string) => [
        ...data.header.map((h) => {
          if (h === data.header[0]) return date;
          if (h === title('pdicts.io.col.name')) return 'Проверка';
          if (h === data.header[kind])
            return title(`pdicts.io.cal.kind.${k}` as 'pdicts.io.cal.kind.holiday');
          if (h === data.header[rule])
            return title(`pdicts.io.cal.rule.${r}` as 'pdicts.io.cal.rule.once');
          return '';
        }),
      ];
      const rows = data.rows.map((r) => [...r]);
      rows[yearly]![kind] = title('pdicts.io.cal.kind.transfer');
      const p = await preview(
        'calendar',
        ioTsv([
          data.header,
          ...rows,
          row(`${year + 5}-03-10`, 'holiday', 'once'),
          row(weekday, 'workday', 'once'),
          row(`${year}-12-30`, 'holiday', 'yearly'),
        ]),
      );
      expect(p.change).toEqual([]);
      expect(p.add).toEqual([]);
      const errors = p.errors.map((e) => e.errors.join('; '));
      expect(errors).toEqual([
        '«Каждый год» — только государственные праздники: у них меняется лишь название',
        `дата — только ${year} или ${year + 1} года`,
        '«Рабочая суббота» — только у субботы',
        '«Каждый год» — только государственные праздники: у них меняется лишь название',
      ]);
    });

    it('«Налоги и ставки»: выгрузка трёх таблиц без правок — без изменений; правка налога — в истории вкладки', async () => {
      for (const dict of ['taxes', 'enrates', 'proprates', 'gkgroups', 'gked']) {
        const data = await file(dict);
        const p = await preview(dict, ioTsv([data.header, ...data.rows]));
        expect({ change: p.change, add: p.add, errors: p.errors }, dict).toEqual({
          change: [],
          add: [],
          errors: [],
        });
        expect(p.same, dict).toBe(data.rows.length);
      }
      const data = await file('taxes');
      const name = title('pdicts.io.col.name');
      const code = data.rows[0]![0]!;
      // Текст длиннее, чем в окне, — ошибка строки, раздел не меняется.
      const long = await preview('taxes', edited(data, 0, name, 'Н'.repeat(201)));
      expect(long.change).toEqual([]);
      expect(long.errors[0]!.errors).toEqual([`«${name}» — не длиннее 200 знаков`]);
      const applied = await apply('taxes', edited(data, 0, name, 'Подоходный налог (из Excel)'));
      expect(applied.preview.change).toHaveLength(1);
      const h = await history('/api/admin/tax-ref/history');
      expect(h.items.find((x) => x.section === 'taxes' && x.code === code)).toMatchObject({
        label: 'Подоходный налог (из Excel)',
      });
      const rollback = await apiRequest(
        f.app,
        'POST',
        `/api/admin/platform-dict-loads/${applied.load.id}/rollback`,
        admin,
      );
      expect(rollback.status, await rollback.clone().text()).toBe(200);
    });
  },
);
