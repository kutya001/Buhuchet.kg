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
} from '@buhuchet/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
      const row = (cells: Record<string, string>) => head.map((h) => cells[h] ?? '');
      const text = edited(
        data,
        [['nds', 'Применимые режимы', '']],
        [
          row({
            Код: 'eco-new',
            Название: 'Новый сбор',
            Кратко: 'Сбор',
            Орган: 'ГНС',
            'Что нужно сделать': 'Сдача',
          }),
          row({ Код: 'bad-organ', Название: 'Без органа', Кратко: 'Б', Орган: 'Минфин' }),
          row({ Код: 'Вид-1', Название: 'Кириллица', Кратко: 'К', Орган: 'ГНС' }),
        ],
      );
      const p = await preview('types', text);
      expect(p.add.map((x) => x.code)).toEqual(['eco-new']);
      expect(p.errors.map((x) => [x.code, x.errors])).toEqual([
        ['nds', ['Применимые режимы: Выберите хотя бы один режим']],
        ['bad-organ', ['Орган: органа «Минфин» нет в справочнике']],
        ['Вид-1', ['код нового значения — латиница, цифры, «-» и «_», до 40 знаков']],
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
      const { load } = await apply('cats', text);
      expect(load).toMatchObject({ added: 1, changed: 1, last: true });
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
  },
);
