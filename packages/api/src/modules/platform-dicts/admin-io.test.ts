import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { ioTsv } from '@buhuchet/domain';
import {
  AdminDictHistory,
  AdminDictImportApplied,
  AdminDictImportPreview,
  AdminDictIoFile,
  AdminDictLoad,
  AdminDictLoadList,
  AdminDictValue,
  ApiError,
  ListValues,
  PdictsTabCounts,
} from '@buhuchet/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildXlsx } from '../../lists/xlsx';
import { apiRequest, createStaffFixture, signIn, TEST_ORIGIN, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())(
  'Админка → «Справочники платформы»: «Выгрузить», «Загрузить» и «Загрузки»',
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

    const IO = '/api/admin/platform-dicts-io';
    const LOADS = '/api/admin/platform-dict-loads';
    const get = (path: string, cookie = admin) => apiRequest(f.app, 'GET', path, cookie);
    const upload = (path: string, text: string, cookie = admin) =>
      f.app.request(path, {
        method: 'POST',
        headers: { origin: TEST_ORIGIN, cookie, 'content-type': 'text/plain; charset=utf-8' },
        body: text,
      });
    /** Файл (.xlsx или CSV) — как его шлёт окно «Загрузка»: байтами. */
    const uploadFile = (path: string, body: Uint8Array) =>
      f.app.request(path, {
        method: 'POST',
        headers: { origin: TEST_ORIGIN, cookie: admin, 'content-type': 'application/octet-stream' },
        body,
      });
    const errorOf = async (res: Response) => ApiError.parse(await res.json()).error;
    const file = async (dict: string) =>
      AdminDictIoFile.parse(await (await get(`${IO}/${dict}`)).json());
    const preview = async (dict: string, text: string) => {
      const res = await upload(`${IO}/${dict}/preview`, text);
      expect(res.status).toBe(200);
      return AdminDictImportPreview.parse(await res.json());
    };
    const apply = async (dict: string, text: string) => {
      const p = await preview(dict, text);
      const res = await upload(`${IO}/${dict}/apply?stamp=${p.stamp}`, text);
      expect(res.status).toBe(200);
      return AdminDictImportApplied.parse(await res.json());
    };
    const history = async (dict: string) =>
      AdminDictHistory.parse(
        await (await get(`/api/admin/platform-dicts/${dict}/history?limit=50`)).json(),
      );
    /** Текст файла справочника: ячейку строки с кодом `code` в столбце `title` заменить на `value`. */
    const edited = (
      data: { header: string[]; rows: string[][] },
      edits: [code: string, title: string, value: string][],
      extra: string[][] = [],
    ) => {
      const rows = data.rows.map((r) => [...r]);
      for (const [code, title, value] of edits) {
        rows.find((r) => r[0] === code)![data.header.indexOf(title)] = value;
      }
      return ioTsv([data.header, ...rows, ...extra]);
    };

    it('только администратор платформы: сотруднику организации и без входа — отказ', async () => {
      const reads = [
        `${IO}/forms`,
        `${IO}/forms/xlsx`,
        LOADS,
        `${LOADS}/values?col=dict`,
        `${LOADS}/export?cols=at,dict`,
      ];
      for (const path of reads) {
        expect((await get(path, owner)).status, path).toBe(403);
        expect((await get(path, '')).status, path).toBe(401);
      }
      const text = ioTsv([
        ['Код', 'Название'],
        ['ФС-01', 'Взлом'],
      ]);
      for (const path of [`${IO}/forms/preview`, `${IO}/forms/apply?stamp=${'0'.repeat(64)}`]) {
        expect((await upload(path, text, owner)).status, path).toBe(403);
        expect((await upload(path, text, '')).status, path).toBe(401);
      }
      const rollback = `${LOADS}/00000000-0000-4000-8000-000000000000/rollback`;
      expect((await apiRequest(f.app, 'POST', rollback, owner)).status).toBe(403);
      expect((await apiRequest(f.app, 'POST', rollback, '')).status).toBe(401);
    });

    it('выгрузка — все значения и все поля; загрузка её без правок — без изменений', async () => {
      const types = await file('types');
      expect(types.header.slice(0, 4)).toEqual(['Код', 'Название', 'Кратко', 'Код формы']);
      const nds = types.rows.find((r) => r[0] === 'nds')!;
      expect(nds[types.header.indexOf('Орган')]).toBe('ГНС');
      expect(nds[types.header.indexOf('Активен')]).toBe('Да');
      for (const dict of ['types', 'benefits', 'regimes', 'bases', 'organs', 'ugns', 'phones']) {
        const data = await file(dict);
        const p = await preview(dict, ioTsv([data.header, ...data.rows]));
        expect(
          { rows: p.rows, same: p.same, errors: p.errors, change: p.change, add: p.add },
          dict,
        ).toEqual({
          rows: data.rows.length,
          same: data.rows.length,
          errors: [],
          change: [],
          add: [],
        });
      }
      const xlsx = await get(`${IO}/types/xlsx`);
      expect(xlsx.status).toBe(200);
      expect(xlsx.headers.get('content-type')).toContain('spreadsheetml');
    });

    it('файлом: «Скачать для Excel» без правок — без изменений, правка в Excel и CSV в Windows-1251 — одно изменение; длинный текст не обрезается молча', async () => {
      const previewFile = async (dict: string, body: Uint8Array) => {
        const res = await uploadFile(`${IO}/${dict}/preview`, body);
        expect(res.status).toBe(200);
        return AdminDictImportPreview.parse(await res.json());
      };
      // Выгрузка .xlsx (числа — числами) читается обратно без изменений.
      for (const dict of ['types', 'phones']) {
        const xlsx = new Uint8Array(await (await get(`${IO}/${dict}/xlsx`)).arrayBuffer());
        const p = await previewFile(dict, xlsx);
        expect({ errors: p.errors, change: p.change, add: p.add }, dict).toEqual({
          errors: [],
          change: [],
          add: [],
        });
        expect(p.same, dict).toBe((await file(dict)).rows.length);
      }

      const data = await file('reasons');
      const [code, name, note] = data.rows[0]!;
      const rows = data.rows.map((r) => (r[0] === code ? [code!, name!, 'Из Excel', r[3]!] : r));
      const xlsx = await buildXlsx(
        'Причины',
        data.header.map((title) => ({ title, kind: 'text' as const })),
        rows,
      );
      const fromXlsx = await previewFile('reasons', xlsx);
      expect(fromXlsx.change).toEqual([
        {
          line: 2,
          code,
          name,
          changes: [{ title: 'Пояснение', from: note ?? '', to: 'Из Excel' }],
        },
      ]);
      // CSV из Excel: «;» и Windows-1251.
      const csv = [data.header, ...rows].map((r) => r.join(';')).join('\r\n');
      const cp1251 = Buffer.from(
        Array.from(csv, (ch) => {
          const n = ch.charCodeAt(0);
          if (n < 0x80) return n;
          if (ch === 'ё') return 0xb8;
          if (ch === 'Ё') return 0xa8;
          if (ch === '«') return 0xab;
          if (ch === '»') return 0xbb;
          if (ch === '—') return 0x97;
          return n - 0x350;
        }),
      );
      expect((await previewFile('reasons', cp1251)).change).toEqual(fromXlsx.change);

      // Текст длиннее пояснения не сохраняется обрезанным: строка с ошибкой.
      const long = await buildXlsx(
        'Причины',
        data.header.map((title) => ({ title, kind: 'text' as const })),
        [[code!, name!, 'я'.repeat(2_500), 'Да']],
      );
      const tooLong = await previewFile('reasons', long);
      expect(tooLong.change).toEqual([]);
      expect(tooLong.errors).toEqual([
        { line: 2, code, errors: [expect.stringMatching(/^Пояснение: /)] },
      ]);

      const broken = await uploadFile(
        `${IO}/reasons/preview`,
        new Uint8Array([0x50, 0x4b, 3, 4, 1]),
      );
      expect(broken.status).toBe(400);
      expect((await errorOf(broken)).code).toBe('import_unreadable');
    });

    it('(проверка задачи #93) одна изменённая строка — одно изменение в предпросмотре, после «ОК, применить» — история', async () => {
      const data = await file('forms');
      const code = data.rows[0]![0]!;
      const name = data.rows[0]![1]!;
      const text = edited(data, [[code, 'Кратко', 'Новое краткое']]);
      const before = await history('forms');
      const p = await preview('forms', text);
      expect(p.change).toEqual([
        {
          line: 2,
          code,
          name,
          changes: [{ title: 'Кратко', from: data.rows[0]![3], to: 'Новое краткое' }],
        },
      ]);
      expect({ add: p.add, off: p.off, errors: p.errors, same: p.same }).toEqual({
        add: [],
        off: [],
        errors: [],
        same: data.rows.length - 1,
      });
      // Сравнение ничего не записывает.
      expect((await history('forms')).total).toBe(before.total);
      const res = await upload(`${IO}/forms/apply?stamp=${p.stamp}`, text);
      expect(res.status).toBe(200);
      const applied = AdminDictImportApplied.parse(await res.json());
      expect(applied.load).toMatchObject({
        dict: 'forms',
        rows: data.rows.length,
        added: 0,
        changed: 1,
        disabled: 0,
        errors: 0,
        last: true,
        rolledBackAt: null,
      });
      const after = await history('forms');
      expect(after.total).toBe(before.total + 2);
      expect(after.items.slice(0, 2).map((x) => [x.action, x.code])).toEqual([
        ['import', ''],
        ['update', code],
      ]);
      expect(after.items[1]!.changes).toEqual([
        { field: 'shortName', from: data.rows[0]![3], to: 'Новое краткое' },
      ]);
      const value = AdminDictValue.parse(
        await (await get(`/api/admin/platform-dicts/forms/${encodeURIComponent(code)}`)).json(),
      );
      expect(value.data.shortName).toBe('Новое краткое');
      // Повтор того же файла — уже без изменений, применять нечего.
      const again = await preview('forms', text);
      expect(again.change).toEqual([]);
      const nothing = await upload(`${IO}/forms/apply?stamp=${again.stamp}`, text);
      expect(nothing.status).toBe(409);
      expect((await errorOf(nothing)).code).toBe('import_nothing');
    });

    it('новые, отключённые и строки с ошибками; без кода и без строк — ошибка файла', async () => {
      const data = await file('organs');
      const [first, second] = data.rows;
      const blank = data.header.map(() => '');
      const row = (cells: Record<string, string>) =>
        data.header.map((h, i) => cells[h] ?? blank[i]!);
      const text = edited(
        data,
        [
          [first![0]!, 'Активно', 'Нет'],
          [second![0]!, 'Название', ''],
        ],
        [
          row({ Код: 'ОРГ-90', Название: 'Новый орган', Сайт: 'example.kg' }),
          row({ Код: 'ОРГ-91', Название: first![1]!, Активно: 'Да' }),
          row({ Код: 'ОРГ-92', Название: 'Ещё', Активно: 'может быть' }),
          row({ Код: 'Плохой код!', Название: 'Плохой' }),
          row({ Код: 'ОРГ-90', Название: 'Дубль' }),
        ],
      );
      const p = await preview('organs', text);
      expect(p.add).toEqual([{ line: data.rows.length + 2, code: 'ОРГ-90', name: 'Новый орган' }]);
      expect(p.off).toEqual([
        {
          line: 2,
          code: first![0],
          name: first![1],
          changes: [{ title: 'Активно', from: 'Да', to: 'Нет' }],
        },
      ]);
      const n = data.rows.length + 2;
      expect(p.errors).toEqual([
        { line: 3, code: second![0], errors: ['Название: не заполнено'] },
        { line: n + 1, code: 'ОРГ-91', errors: ['Название: Такое значение уже есть'] },
        { line: n + 2, code: 'ОРГ-92', errors: ['Активно: да или нет'] },
        {
          line: n + 3,
          code: 'Плохой код!',
          errors: ['код нового значения — буквы, цифры, «-» и «_», до 40 знаков'],
        },
        { line: n + 4, code: 'ОРГ-90', errors: ['код повторяется в файле'] },
      ]);
      const noCode = await upload(`${IO}/organs/preview`, ioTsv([['Название'], ['Орган']]));
      expect(noCode.status).toBe(400);
      expect((await errorOf(noCode)).code).toBe('import_no_code');
      const noRows = await upload(`${IO}/organs/preview`, ioTsv([['Код', 'Название']]));
      expect((await errorOf(noRows)).code).toBe('import_no_rows');
      const empty = await upload(`${IO}/organs/preview`, '');
      expect((await errorOf(empty)).code).toBe('import_empty');
    });

    it('справочник изменился после сравнения — «ОК, применить» отказывает, сравнить заново', async () => {
      const data = await file('reasons');
      const code = data.rows[0]![0]!;
      const text = edited(data, [[code, 'Пояснение', 'Из файла']]);
      const p = await preview('reasons', text);
      const other = edited(data, [[code, 'Пояснение', 'Другой файл']]);
      const res = await upload(`${IO}/reasons/apply?stamp=${p.stamp}`, other);
      expect(res.status).toBe(409);
      expect((await errorOf(res)).code).toBe('import_changed');
    });

    it('вид отчёта: режимный без режимов и неизвестный орган — ошибки строки; новый вид — с кодом из файла', async () => {
      const data = await file('types');
      const head = data.header;
      // Периодичность, «Тип» и «Что нужно сделать» обязательны (прототип DX.types).
      const base = { Периодичность: 'Месяц', Тип: 'Сквозной', 'Что нужно сделать': 'Сдача' };
      const row = (cells: Record<string, string>) =>
        head.map((h) => ({ ...base, ...cells })[h] ?? '');
      const text = edited(
        data,
        [['nds', 'Применимые режимы', '']],
        [
          row({ Код: 'eco-new', Название: 'Новый сбор', Кратко: 'Сбор', Орган: 'ГНС' }),
          row({ Код: 'bad-organ', Название: 'Без органа', Кратко: 'Б', Орган: 'Минфин' }),
          row({ Код: 'Вид-1', Название: 'Кириллица', Кратко: 'К', Орган: 'ГНС' }),
          row({ Код: 'no-period', Название: 'Без', Кратко: 'Н', Орган: 'ГНС', Периодичность: '' }),
        ],
      );
      const p = await preview('types', text);
      expect(p.add.map((x) => x.code)).toEqual(['eco-new']);
      expect(p.errors.map((x) => [x.code, x.errors])).toEqual([
        ['nds', ['Применимые режимы: Выберите хотя бы один режим']],
        ['bad-organ', ['Орган: органа «Минфин» нет в справочнике']],
        ['Вид-1', ['код нового значения — латиница, цифры, «-» и «_», до 40 знаков']],
        ['no-period', ['Периодичность: не заполнено']],
      ]);
    });

    it('«Загрузки»: последнюю загрузку можно откатить — изменённые возвращаются, добавленные удаляются', async () => {
      const data = await file('cats');
      const code = data.rows[0]![0]!;
      const head = data.header;
      const text = edited(
        data,
        [[code, 'Пояснение', 'Пояснение из Excel']],
        [head.map((h) => ({ Код: 'КАТ-900', Название: 'Новая категория' })[h] ?? '')],
      );
      const counts = async () =>
        PdictsTabCounts.parse(await (await get('/api/admin/platform-dicts/tab-counts')).json())
          .loads;
      const active = await counts();
      const { load } = await apply('cats', text);
      expect(load).toMatchObject({ added: 1, changed: 1, last: true });
      // Число на вкладке «Загрузки» — неоткаченные загрузки.
      expect(await counts()).toBe(active + 1);
      const listRes = await get(`${LOADS}?sort=at.desc`);
      const listBody: unknown = await listRes.json();
      expect(listRes.status, JSON.stringify(listBody)).toBe(200);
      const list = AdminDictLoadList.parse(listBody);
      expect(list.items[0]).toMatchObject({ id: load.id, dict: 'cats', last: true });
      expect(list.items.filter((x) => x.last)).toHaveLength(1);
      const values = ListValues.parse(await (await get(`${LOADS}/values?col=status`)).json());
      expect(values.items.map((v) => v.label)).toContain('Последняя');
      // Не последнюю откатить нельзя.
      const older = list.items.find((x) => x.id !== load.id)!;
      const notLast = await apiRequest(f.app, 'POST', `${LOADS}/${older.id}/rollback`, admin);
      expect(notLast.status).toBe(409);
      expect((await errorOf(notLast)).code).toBe('load_not_last');
      const res = await apiRequest(f.app, 'POST', `${LOADS}/${load.id}/rollback`, admin);
      expect(res.status).toBe(200);
      expect(AdminDictLoad.parse(await res.json())).toMatchObject({ last: false });
      expect(await counts()).toBe(active);
      const now = await file('cats');
      expect(now.rows).toEqual(data.rows);
      const h = await history('cats');
      expect(h.items[0]).toMatchObject({ action: 'rollback', code: '' });
      // Второй раз — уже откачена.
      const again = await apiRequest(f.app, 'POST', `${LOADS}/${load.id}/rollback`, admin);
      expect(again.status).toBe(404);
    });

    it('значение изменили после загрузки — откат отказывает и ничего не меняет', async () => {
      const data = await file('banks');
      const code = data.rows[0]![0]!;
      const { load } = await apply('banks', edited(data, [[code, 'Пояснение', 'Из файла']]));
      const value = AdminDictValue.parse(
        await (await get(`/api/admin/platform-dicts/banks/${encodeURIComponent(code)}`)).json(),
      );
      const saved = await apiRequest(
        f.app,
        'PUT',
        `/api/admin/platform-dicts/banks/${encodeURIComponent(code)}`,
        admin,
        { name: value.name, ...value.data, note: 'Правка руками', version: value.version },
      );
      expect(saved.status).toBe(200);
      const res = await apiRequest(f.app, 'POST', `${LOADS}/${load.id}/rollback`, admin);
      expect(res.status).toBe(409);
      expect(await errorOf(res)).toMatchObject({
        code: 'load_changed_after',
        details: { name: value.name },
      });
      const now = await file('banks');
      expect(now.rows[0]![now.header.indexOf('Пояснение')]).toBe('Правка руками');
    });

    const rollback = (id: string) => apiRequest(f.app, 'POST', `${LOADS}/${id}/rollback`, admin);
    const valuePath = (dict: string, code: string) =>
      `/api/admin/platform-dicts/${dict}/${encodeURIComponent(code)}`;
    const valueOf = async (dict: string, code: string) =>
      AdminDictValue.parse(await (await get(valuePath(dict, code))).json());

    it('переименование в файле меняет значение на месте; две загрузки подряд откатываются по очереди', async () => {
      const data = await file('reasons');
      const [code, name] = data.rows[0]!;
      const first = await apply('reasons', edited(data, [[code!, 'Название', `${name} (1)`]]));
      expect(first.preview).toMatchObject({ add: [], change: [{ code, name: `${name} (1)` }] });
      expect((await file('reasons')).rows).toHaveLength(data.rows.length);
      const mid = await file('reasons');
      const second = await apply('reasons', edited(mid, [[code!, 'Название', `${name} (2)`]]));
      expect((await rollback(second.load.id)).status).toBe(200);
      // Откат второй вернул значение к виду после первой — первую тоже можно откатить.
      expect((await rollback(first.load.id)).status).toBe(200);
      expect((await file('reasons')).rows).toEqual(data.rows);
    });

    it('откат: прежнее название, отданное новому значению, снова свободно; добавленный код страны отключается', async () => {
      const cats = await file('cats');
      const [code, name] = cats.rows[1]!;
      const row = (values: Record<string, string>) => cats.header.map((h) => values[h] ?? '');
      const { load } = await apply(
        'cats',
        edited(
          cats,
          [[code!, 'Название', `${name} (стар.)`]],
          [row({ Код: 'КАТ-901', Название: name! })],
        ),
      );
      expect(load).toMatchObject({ added: 1, changed: 1 });
      expect((await rollback(load.id)).status).toBe(200);
      expect((await file('cats')).rows).toEqual(cats.rows);

      // Код страны — заглавными, «+» в телефонном коде снимается: выгрузка с такими правками — без изменений.
      const phones = await file('phones');
      const kg = phones.rows.findIndex((r) => r[0] === 'KG');
      const rows = phones.rows.map((r, i) =>
        i === kg ? r.map((v, j) => (j === 0 ? 'kg' : j === 2 ? `+${v}` : v)) : r,
      );
      const add = phones.header.map(
        (h) =>
          ({
            'Код страны': 'zz',
            Страна: 'Зедландия',
            'Телефонный код': '+999',
            'Маска номера': 'XXX XXX',
            Активно: 'Да',
          })[h] ?? '',
      );
      const bad = phones.header.map(
        (h) =>
          ({
            'Код страны': 'ZZZ',
            Страна: 'Плохая',
            'Телефонный код': '998',
            'Маска номера': 'XX',
          })[h] ?? '',
      );
      const text = ioTsv([phones.header, ...rows, add, bad]);
      const p = await preview('phones', text);
      expect(p.change).toEqual([]);
      expect(p.add.map((x) => x.code)).toEqual(['ZZ']);
      expect(p.errors.map((x) => [x.code, x.errors])).toEqual([
        ['ZZZ', ['код страны — две латинские буквы (KG, KZ…)']],
      ]);
      const applied = await apply('phones', ioTsv([phones.header, ...rows, add]));
      expect((await valueOf('phones', 'ZZ')).data).toMatchObject({ dialCode: '999' });
      // Код страны не удаляется — откат его отключает.
      expect((await rollback(applied.load.id)).status).toBe(200);
      expect(await valueOf('phones', 'ZZ')).toMatchObject({ active: false });
    });

    it('откат, который не может вернуть значение, ничего не меняет; удалённое после загрузки значение — отказ', async () => {
      const data = await file('banks');
      const [a, , ...restA] = data.rows[1]!;
      const [b, nameB] = data.rows[2]!;
      void restA;
      const { load } = await apply(
        'banks',
        edited(data, [
          [a!, 'Пояснение', 'Из файла А'],
          [b!, 'Название', `${nameB} (стар.)`],
        ]),
      );
      // Прежнее название B заняли после загрузки — вернуть B нельзя, и А тоже остаётся как после загрузки.
      const created = await apiRequest(f.app, 'POST', '/api/admin/platform-dicts/banks', admin, {
        name: nameB,
        kind: 'bank',
        byPhone: false,
        note: '',
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const taken = AdminDictValue.parse(await created.json());
      const refused = await rollback(load.id);
      expect(refused.status).toBe(409);
      expect(await errorOf(refused)).toMatchObject({
        code: 'load_restore_failed',
        details: { name: nameB },
      });
      expect((await valueOf('banks', a!)).data).toMatchObject({ note: 'Из файла А' });
      const list = AdminDictLoadList.parse(await (await get(`${LOADS}?sort=at.desc`)).json());
      expect(list.items[0]).toMatchObject({ id: load.id, last: true, rolledBackAt: null });
      const removed = await apiRequest(
        f.app,
        'DELETE',
        `${valuePath('banks', taken.code)}?version=${taken.version}`,
        admin,
      );
      expect(removed.status).toBe(204);
      expect((await rollback(load.id)).status).toBe(200);
      expect((await file('banks')).rows).toEqual(data.rows);

      // Значение из загрузки удалили после неё — откат отказывает.
      const cat = await apiRequest(f.app, 'POST', '/api/admin/platform-dicts/cats', admin, {
        name: 'Временная категория',
        note: '',
      });
      expect(cat.status).toBe(201);
      const temp = AdminDictValue.parse(await cat.json());
      const cats = await file('cats');
      const loaded = await apply('cats', edited(cats, [[temp.code, 'Пояснение', 'Из файла']]));
      const now = await valueOf('cats', temp.code);
      expect(
        (
          await apiRequest(
            f.app,
            'DELETE',
            `${valuePath('cats', temp.code)}?version=${now.version}`,
            admin,
          )
        ).status,
      ).toBe(204);
      const gone = await rollback(loaded.load.id);
      expect(gone.status).toBe(409);
      expect(await errorOf(gone)).toMatchObject({
        code: 'load_changed_after',
        details: { name: 'Временная категория' },
      });
    });

    it('ошибки файла: нет столбца кода — с его названием, вставка больше 5 000 строк, ссылка на повторяющееся краткое название', async () => {
      const ugns = await upload(
        `${IO}/ugns/preview`,
        ioTsv([
          ['Код', 'Полное название'],
          ['001', 'УГНС'],
        ]),
      );
      expect(ugns.status).toBe(400);
      expect(await errorOf(ugns)).toMatchObject({
        code: 'import_no_code',
        message: 'Нет столбца «Ключ»: без кода строки не сопоставить',
        details: { col: 'Ключ' },
      });
      const many = ioTsv([
        ['Код', 'Название'],
        ...Array.from({ length: 5_001 }, (_, i) => [`К-${i}`, 'Х']),
      ]);
      const big = await upload(`${IO}/cats/preview`, many);
      expect(big.status).toBe(400);
      expect((await errorOf(big)).code).toBe('import_too_big');

      const types = await file('types');
      const shorts = types.rows.map((r) => r[types.header.indexOf('Кратко')]!);
      const twice = shorts.find((x, i) => shorts.indexOf(x) !== i)!;
      expect(twice).toBeTruthy();
      const benefits = await file('benefits');
      const p = await preview(
        'benefits',
        edited(benefits, [[benefits.rows[0]![0]!, 'Добавляет', twice]]),
      );
      expect(p.errors.map((x) => x.errors)).toEqual([
        [`Добавляет: «${twice}» — у нескольких значений: укажите код`],
      ]);
    });
  },
);
