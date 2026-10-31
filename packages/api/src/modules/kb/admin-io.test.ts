import {
  databaseAvailable,
  seedAllPlatformDictionaries,
  seedKbReference,
} from '@buhuchet/db/testing';
import { ioTsv, KB_MODULE_TITLES, UI_TEXTS } from '@buhuchet/domain';
import {
  AdminDictImportApplied,
  AdminDictImportPreview,
  AdminDictIoFile,
  AdminKbHistory,
  AdminKbShow,
  NewsAdminHistory,
} from '@buhuchet/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildXlsx } from '../../lists/xlsx';
import { apiRequest, createStaffFixture, signIn, TEST_ORIGIN, TEST_PASSWORD } from '../../testing';

// Админка → «База знаний (содержимое)» → «Выгрузить» и «Загрузить» (задача 2.39, часть 2).

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())(
  'Админка → «База знаний (содержимое)»: выгрузка и загрузка Excel шагов, показов, статей и новостей',
  () => {
    let f: Fixture;
    let admin: string;
    let owner: string;

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      await seedKbReference(f.t.admin.db);
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
    const upload = (path: string, body: string | Uint8Array, cookie = admin) =>
      f.app.request(path, {
        method: 'POST',
        headers: {
          origin: TEST_ORIGIN,
          cookie,
          'content-type':
            typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/octet-stream',
        },
        body,
      });
    const file = async (dict: string) =>
      AdminDictIoFile.parse(await (await get(`${IO}/${dict}`)).json());
    const preview = async (dict: string, body: string | Uint8Array) => {
      const res = await upload(`${IO}/${dict}/preview`, body);
      expect(res.status, await res.clone().text()).toBe(200);
      return AdminDictImportPreview.parse(await res.json());
    };
    const apply = async (dict: string, text: string) => {
      const p = await preview(dict, text);
      const res = await upload(`${IO}/${dict}/apply?stamp=${p.stamp}`, text);
      expect(res.status, await res.clone().text()).toBe(200);
      return AdminDictImportApplied.parse(await res.json());
    };
    const rollback = (id: string) => apiRequest(f.app, 'POST', `${LOADS}/${id}/rollback`, admin);
    const kbHistory = async (section: string) =>
      AdminKbHistory.parse(await (await get(`/api/admin/kb/history/${section}`)).json());
    /** Таблица файла: ячейки строки с кодом `code` в столбцах `title` — `value`; `extra` — новые строки. */
    const edited = (
      data: { header: string[]; rows: string[][] },
      edits: [code: string, title: string, value: string][],
      extra: Record<string, string>[] = [],
    ) => {
      const rows = data.rows.map((r) => [...r]);
      for (const [code, title, value] of edits) {
        const at = data.header.indexOf(title);
        expect(at, title).toBeGreaterThanOrEqual(0);
        rows.find((r) => r[0] === code)![at] = value;
      }
      const added = extra.map((x) => data.header.map((h) => x[h] ?? ''));
      return ioTsv([data.header, ...rows, ...added]);
    };

    it('только администратор платформы; выгрузка без правок загружается без изменений', async () => {
      for (const dict of ['kbsteps', 'kbshows', 'kbarts', 'kbnews']) {
        expect((await get(`${IO}/${dict}`, owner)).status, dict).toBe(403);
        expect((await upload(`${IO}/${dict}/preview`, 'Код\nx', owner)).status, dict).toBe(403);
      }
      // Новостей в наполнении теста нет — их выгрузка проверяется после загрузки.
      for (const dict of ['kbsteps', 'kbshows', 'kbarts']) {
        const data = await file(dict);
        expect(data.rows.length, dict).toBeGreaterThan(0);
        const p = await preview(dict, ioTsv([data.header, ...data.rows]));
        expect({ errors: p.errors, add: p.add, change: p.change }, dict).toEqual({
          errors: [],
          add: [],
          change: [],
        });
        expect(p.same, dict).toBe(data.rows.length);
        // «Скачать для Excel» читается обратно так же.
        const xlsx = new Uint8Array(await (await get(`${IO}/${dict}/xlsx`)).arrayBuffer());
        expect((await preview(dict, xlsx)).same, dict).toBe(data.rows.length);
      }
      const steps = await file('kbsteps');
      expect(steps.header).toEqual([
        'Код',
        'Модуль программы',
        'Название',
        'Зачем это нужно',
        'Вид шага',
        'Основной',
        'Необходимое право',
        'Функция учётной политики',
        'Условие отметки',
        'Порядок',
        'Активен',
        'Место для «Перейти»',
      ]);
      const profile = steps.rows.find((r) => r[0] === 'profile')!;
      expect(profile.slice(1, 3)).toEqual(['Моя организация', 'Заполнить профиль организации']);
      expect(profile[4]).toBe('Сделать');
      const shows = await file('kbshows');
      expect(shows.rows.filter((r) => r[0]!.startsWith('sh-profile#')).map((r) => r[0])).toEqual([
        'sh-profile#1',
        'sh-profile#2',
        'sh-profile#3',
      ]);
      expect(shows.rows.find((r) => r[0] === 'sh-profile#2')![2]).toBe('Автоматически: Поля формы');
    });

    it('(проверка задачи #95) шаги: правка и новый шаг — в предпросмотре, после «ОК, применить» — история; откат возвращает как было', async () => {
      const data = await file('kbsteps');
      const cps = UI_TEXTS[KB_MODULE_TITLES.cps].ru;
      const text = edited(
        data,
        [['profile', 'Название', 'Профиль из Excel']],
        [
          {
            Код: 'u-excel',
            'Модуль программы': 'Контрагенты',
            Название: 'Шаг из Excel',
            'Вид шага': 'Посмотреть',
            'Условие отметки': UI_TEXTS['kbadm.ev.open'].ru,
            'Место для «Перейти»': cps,
          },
          {
            Код: 'Не код',
            'Модуль программы': 'Контрагенты',
            Название: 'x',
            'Вид шага': 'Сделать',
          },
        ],
      );
      const p = await preview('kbsteps', text);
      expect(p.change).toEqual([
        {
          line: expect.any(Number),
          code: 'profile',
          name: 'Профиль из Excel',
          changes: [
            { title: 'Название', from: 'Заполнить профиль организации', to: 'Профиль из Excel' },
          ],
        },
      ]);
      expect(p.add).toEqual([{ line: expect.any(Number), code: 'u-excel', name: 'Шаг из Excel' }]);
      expect(p.errors).toHaveLength(1);
      const { load } = await apply('kbsteps', text);
      expect(load).toMatchObject({ dict: 'kbsteps', added: 1, changed: 1, last: true });
      const step = (await file('kbsteps')).rows.find((r) => r[0] === 'u-excel')!;
      expect(step[2]).toBe('Шаг из Excel');
      expect(step[11]).toBe(cps);
      const history = await kbHistory('kbsteps');
      expect(history.items.map((h) => [h.action, h.code])).toEqual(
        expect.arrayContaining([
          ['import', ''],
          ['create', 'u-excel'],
          ['update', 'profile'],
        ]),
      );
      expect(history.items[0]).toMatchObject({ action: 'import', code: '' });
      const res = await rollback(load.id);
      expect(res.status, await res.clone().text()).toBe(200);
      expect((await file('kbsteps')).rows).toEqual(data.rows);
      expect((await kbHistory('kbsteps')).items[0]).toMatchObject({ action: 'rollback' });
    });

    it('показы: правка облачка и новые — в конец сценария; откат убирает новые и возвращает текст', async () => {
      const data = await file('kbshows');
      const text = edited(
        data,
        [['sh-profile#1', 'Заголовок облачка', 'Профиль']],
        [
          { Код: 'sh-profile#4', 'Заголовок облачка': 'Четвёртое', 'Сценарий активен': 'Да' },
          { Код: 'sh-profile#9', 'Заголовок облачка': 'Девятое', 'Сценарий активен': 'Да' },
          { Код: 'sh-profile', 'Заголовок облачка': 'Без номера' },
        ],
      );
      const p = await preview('kbshows', text);
      // Номер в файле не важен: девятое встаёт пятым (прототип DX.kbshows.add).
      expect(p.add.map((x) => [x.code, x.name])).toEqual([
        ['sh-profile#4', 'Заполнить профиль организации · облачко 4'],
        ['sh-profile#9', 'Заполнить профиль организации · облачко 5'],
      ]);
      expect(p.change.map((x) => [x.code, x.name])).toEqual([
        ['sh-profile#1', 'Заполнить профиль организации · облачко 1'],
      ]);
      expect(p.errors.map((e) => [e.code, e.errors])).toEqual([
        ['sh-profile', [expect.stringContaining('#')]],
      ]);
      const { load } = await apply('kbshows', text);
      const show = AdminKbShow.parse(await (await get('/api/admin/kb/shows/profile')).json());
      expect(show.items.map((x) => x.t)).toEqual([
        'Профиль',
        '',
        'Кнопка «Сохранить»',
        'Четвёртое',
        'Девятое',
      ]);
      expect((await rollback(load.id)).status).toBe(200);
      expect((await file('kbshows')).rows).toEqual(data.rows);
    });

    it('статьи: длинный текст из .xlsx не обрезается; новая статья с кодом из файла', async () => {
      const data = await file('kbarts');
      const [code] = data.rows[0]!;
      const html = `<p>${'я'.repeat(5_000)}</p>`;
      const rows = data.rows.map((r) =>
        r[0] === code ? r.map((v, i) => (data.header[i] === 'Текст' ? html : v)) : r,
      );
      const xlsx = await buildXlsx(
        'Статьи',
        data.header.map((title) => ({ title, kind: 'text' as const })),
        rows,
      );
      const p = await preview('kbarts', xlsx);
      expect(p.errors).toEqual([]);
      expect(p.change.map((x) => x.code)).toEqual([code]);
      expect(p.change[0]!.changes[0]!.to).toBe(html);
      const text = edited(
        data,
        [],
        [
          {
            Код: 'a-excel',
            Раздел: 'Модули',
            Название: 'Статья из Excel',
            Кому: 'Организациям',
            Текст: '<p>Текст</p>',
            Активна: 'Да',
          },
          { Код: 'a-empty', Раздел: '', Название: 'Без раздела', Кому: 'Всем', Текст: '<p>x</p>' },
        ],
      );
      const added = await preview('kbarts', text);
      expect(added.add.map((x) => x.code)).toEqual(['a-excel']);
      expect(added.errors.map((e) => e.code)).toEqual(['a-empty']);
    });

    it('новости: новая — черновиком; «История изменений» новостей — с загрузкой и откатом', async () => {
      const data = await file('kbnews');
      const text = edited(
        data,
        [],
        [
          {
            Код: 'n-excel',
            Заголовок: 'Новость из Excel',
            Тип: 'Объявление',
            'Дата публикации': '02.11.2026',
            'Для кого': 'Все пользователи',
            'Краткое описание': 'Кратко',
            'Подробное описание (markdown)': 'Подробно',
          },
        ],
      );
      const { load } = await apply('kbnews', text);
      expect(load).toMatchObject({ dict: 'kbnews', added: 1 });
      const news = await (await get('/api/admin/news/n-excel')).json();
      expect(news).toMatchObject({ id: 'n-excel', status: 'draft', title: 'Новость из Excel' });
      const after = await file('kbnews');
      expect(after.rows.find((r) => r[0] === 'n-excel')!.slice(1, 5)).toEqual([
        'Новость из Excel',
        'Объявление',
        '',
        '02.11.2026',
      ]);
      expect((await preview('kbnews', ioTsv([after.header, ...after.rows]))).same).toBe(
        after.rows.length,
      );
      const history = async () =>
        NewsAdminHistory.parse(await (await get('/api/admin/news/history')).json());
      expect((await history()).items[0]).toMatchObject({
        kind: 'import',
        counts: { added: 1, changed: 0, disabled: 0 },
      });
      expect((await rollback(load.id)).status).toBe(200);
      expect((await get('/api/admin/news/n-excel')).status).toBe(404);
      expect((await history()).items[0]).toMatchObject({
        kind: 'rollback',
        loadedAt: expect.any(String),
      });
    });
  },
);
