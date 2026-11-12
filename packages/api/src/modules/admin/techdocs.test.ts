import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { databaseAvailable } from '@buhuchet/db/testing';
import {
  AdminApiMethodCard,
  AdminApiMethodList,
  AdminApiSchemaFields,
  AdminTechDocsMeta,
  ApiError,
  ListValues,
} from '@buhuchet/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD, unzipTexts } from '../../testing';
import { SCHEMA_PAGE_CSP } from './techdocs';
import { fileTechDocs, parseTechDocs, schemaPageIndex, type TechDocs } from './techdocs-source';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const field = (n: string, t: string, extra: object = {}) => ({ n, t, req: true, ...extra });
const code = (file: string, fn: string, what: string) => ({ file, fn, line: 10, what });

/** Небольшое описание API в том же виде, что собирает api_snapshot.py. */
const API = {
  meta: {
    file: 'apiDocs.json',
    repo: 'kutya001/Buhuchet.kg',
    branch: 'main',
    commit: 'abc1234',
    date: '2026-11-12',
    methods: 3,
    schemaVersion: 60,
    note: 'Снимок собран разбором исходников продукта.',
  },
  sections: { admin: 'Админка', auth: 'Вход' },
  views: { admin_users: { mig: '0033_admin_users', r: ['employees', 'users'] } },
  fns: { admin_set_user_blocked: { mig: '0033_admin_users', r: [], w: ['users'] } },
  schemas: {
    AdminUser: [field('id', 'Uuid'), field('org', 'AdminUserOrg', { null: true })],
    AdminUserOrg: [field('name', 'string', { d: 'Название организации' })],
    ApiError: [field('error', 'object')],
  },
  sql: [
    {
      k: 'view',
      t: 'CREATE VIEW app.admin_users AS SELECT 1 < 2;',
      f: 'packages/db/migrations/0033.sql',
      fn: 'app.admin_users',
      l: 0,
    },
    {
      k: 'sql',
      t: 'select app.admin_set_user_blocked($1, $2)',
      f: 'packages/db/src/admin-users.ts',
      fn: 'adminSetUserBlocked',
      l: 270,
    },
    {
      k: 'code',
      t: 'tx.select().from(users)',
      f: 'packages/db/src/admin-users.ts',
      fn: 'listUsers',
      l: 100,
    },
  ],
  methods: [
    {
      id: 'GET /admin/users',
      m: 'GET',
      p: '/admin/users',
      sec: 'admin',
      sum: 'Учётные записи: страница списка',
      desc: '',
      acc: 'admin',
      perm: [],
      rate: '',
      req: { query: { s: 'ListQueryParams', f: [field('page', 'number', { req: false })] } },
      res: [
        { code: '200', d: 'Страница списка', s: 'AdminUser' },
        { code: '401', d: 'Нет входа', s: 'ApiError' },
      ],
      r: ['employees', 'users'],
      w: [],
      v: ['admin_users'],
      fns: [],
      ctx: ['user'],
      q: [0, 2],
      code: [code('packages/api/src/modules/admin/users.ts', 'listUsersRoute', 'Маршрут')],
    },
    {
      id: 'POST /admin/users/{id}/block',
      m: 'POST',
      p: '/admin/users/{id}/block',
      sec: 'admin',
      sum: 'Заблокировать учётную запись',
      desc: 'Сеансы пользователя завершаются.',
      acc: 'admin',
      perm: [],
      rate: 'Не чаще 10 раз в час',
      req: {
        params: { s: '', f: [field('id', 'Uuid', { c: 'UUID' })] },
        body: {
          s: 'AdminUserVersionRequest',
          ct: 'application/json',
          f: [field('version', 'RecordVersion')],
          ex: { version: 0 },
        },
      },
      res: [{ code: '200', d: 'Заблокирована', s: 'AdminUser' }],
      r: ['employees'],
      w: ['users', 'sessions'],
      v: [],
      fns: ['admin_set_user_blocked'],
      ctx: ['org', 'user'],
      q: [1],
      code: [code('packages/db/src/admin-users.ts', 'adminSetUserBlocked', 'Запрос к базе')],
    },
    {
      id: 'POST /auth/login',
      m: 'POST',
      p: '/auth/login',
      sec: 'auth',
      sum: 'Вход по логину и паролю',
      desc: '',
      acc: 'public',
      perm: [],
      rate: '',
      req: {},
      res: [{ code: '200', d: 'Вошёл' }],
      r: [],
      w: [],
      v: [],
      fns: [],
      ctx: [],
      q: [],
      code: [],
    },
  ],
};

const SCHEMA = {
  meta: { title: 'База данных Buhuchet.kg', schemaVersion: 60, updated: '2026-11-12' },
  tables: [
    { name: 'users', ru: 'Пользователи', rls: 'Включена: своя организация' },
    { name: 'employees', ru: 'Сотрудники', rls: 'Включена' },
    { name: 'sessions', ru: 'Сеансы входа', rls: null },
  ],
};

const PAGE =
  "<!doctype html><title>База</title><script>\n'use strict';const X=window.TDX_IN;</script>";

const docs = (over: { api?: object; schema?: object; page?: string } = {}): TechDocs =>
  parseTechDocs({
    api: JSON.stringify(over.api ?? API),
    schema: JSON.stringify(over.schema ?? SCHEMA),
    page: over.page ?? PAGE,
  });

describe.skipIf(!databaseAvailable())('Админка → «Техническая документация» (прототип v83)', () => {
  let f: Fixture;
  let app: ReturnType<typeof createApp>;
  let admin: string;
  let owner: string;

  beforeAll(async () => {
    f = await createStaffFixture();
    app = createApp({ ...f.deps, techDocs: { load: async () => docs() } });
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  const get = (path: string, cookie = admin) => apiRequest(app, 'GET', path, cookie);
  const P = '/api/admin/tech-docs';
  const list = async (query = '') => {
    const res = await get(`${P}/methods${query}`);
    expect(res.status, await res.clone().text()).toBe(200);
    return AdminApiMethodList.parse(await res.json());
  };

  it('только администратор платформы: сотруднику — 403, без входа — 401', async () => {
    const paths = [
      P,
      `${P}/methods`,
      `${P}/methods/values?col=sec`,
      `${P}/methods/export?cols=m,p`,
      `${P}/method?id=${encodeURIComponent('GET /admin/users')}`,
      `${P}/zod?name=AdminUser`,
      `${P}/schema-page`,
      `${P}/openapi`,
    ];
    for (const path of paths) {
      expect((await get(path, owner)).status, path).toBe(403);
      expect((await app.request(path)).status, path).toBe(401);
      expect((await get(path)).status, path).toBe(200);
    }
  });

  it('строка версии: коммит и дата описания API, версия схемы, таблицы методов по-русски', async () => {
    const meta = AdminTechDocsMeta.parse(await (await get(P)).json());
    expect(meta.api).toEqual({
      repo: 'kutya001/Buhuchet.kg',
      branch: 'main',
      commit: 'abc1234',
      date: '2026-11-12',
      methods: 3,
    });
    expect(meta.schema).toEqual({ version: 60, updated: '2026-11-12', tables: 3 });
    expect(meta.stale).toBe(false);
    expect(meta.tables).toEqual([
      { name: 'users', ru: 'Пользователи' },
      { name: 'sessions', ru: 'Сеансы входа' },
      { name: 'employees', ru: 'Сотрудники' },
    ]);
    // Описание API старше схемы базы — предупреждение.
    const old = createApp({
      ...f.deps,
      techDocs: {
        load: async () =>
          docs({ schema: { ...SCHEMA, meta: { ...SCHEMA.meta, schemaVersion: 61 } } }),
      },
    });
    const stale = AdminTechDocsMeta.parse(await (await apiRequest(old, 'GET', P, admin)).json());
    expect(stale.stale).toBe(true);
  });

  it('список методов: по адресу, группы по разделу, поиск по таблице, фильтр «Таблица», значения, Excel', async () => {
    const all = await list();
    expect(all.total).toBe(3);
    expect(all.items.map((m) => m.id)).toEqual([
      'GET /admin/users',
      'POST /admin/users/{id}/block',
      'POST /auth/login',
    ]);
    expect(all.items[1]).toEqual({
      id: 'POST /admin/users/{id}/block',
      method: 'POST',
      path: '/admin/users/{id}/block',
      section: 'admin',
      summary: 'Заблокировать учётную запись',
      access: 'admin',
      permissions: '',
      tables: 3,
      writes: true,
      tableNames: 'employees, users, sessions',
      rate: 'Не чаще 10 раз в час',
      file: 'packages/db/src/admin-users.ts',
    });
    // Группировка по разделу — названиями разделов.
    const grouped = await list('?group=sec');
    expect(grouped.groups?.map((g) => [g.label, g.count])).toEqual([
      ['Админка', 2],
      ['Вход', 1],
    ]);
    // Поиск — по адресу, описанию, имени таблицы и её русскому названию.
    expect((await list(`?q=${encodeURIComponent('сеансы входа')}`)).items.map((m) => m.id)).toEqual(
      ['POST /admin/users/{id}/block'],
    );
    expect((await list('?q=login')).total).toBe(1);
    // Экран ищет только по видимым столбцам, «Таблицы» по умолчанию скрыты — таблица находится и так.
    const shown = 'qcols=m,p,sum,acc,n,w';
    expect(
      (await list(`?q=${encodeURIComponent('сеансы входа')}&${shown}`)).items.map((m) => m.id),
    ).toEqual(['POST /admin/users/{id}/block']);
    expect((await list(`?q=sessions&${shown}`)).total).toBe(1);
    // Фильтр «Таблица» — методы, которые читают или меняют таблицу.
    expect((await list('?table=users')).total).toBe(2);
    expect((await list('?table=sessions')).items.map((m) => m.id)).toEqual([
      'POST /admin/users/{id}/block',
    ]);
    expect((await list('?table=net_takoi')).total).toBe(0);
    expect((await get(`${P}/methods?sort=nope.asc`)).status).toBe(400);

    const values = ListValues.parse(await (await get(`${P}/methods/values?col=acc`)).json());
    expect(values.items.map((v) => [v.value, v.label, v.count])).toEqual(
      expect.arrayContaining([
        ['admin', 'Администратор платформы', 2],
        ['public', 'Без входа', 1],
      ]),
    );

    const file = await get(`${P}/methods/export?cols=m,p,sec,acc,w&table=users`);
    expect(file.status).toBe(200);
    const sheet = unzipTexts(new Uint8Array(await file.arrayBuffer()))['xl/worksheets/sheet1.xml']!;
    expect(sheet).toContain('/admin/users/{id}/block');
    expect(sheet).toContain('Админка');
    expect(sheet).toContain('Администратор платформы');
    expect(sheet).not.toContain('/auth/login');
  });

  it('карточка метода: запрос, ответы, таблицы чтения и записи, SQL с контекстом, код', async () => {
    const res = await get(`${P}/method?id=${encodeURIComponent('POST /admin/users/{id}/block')}`);
    expect(res.status).toBe(200);
    const c = AdminApiMethodCard.parse(await res.json());
    expect(c).toMatchObject({
      method: 'POST',
      path: '/admin/users/{id}/block',
      section: 'Админка',
      description: 'Сеансы пользователя завершаются.',
      access: 'admin',
      rate: 'Не чаще 10 раз в час',
      reads: [{ name: 'employees', ru: 'Сотрудники' }],
      writes: [
        { name: 'users', ru: 'Пользователи' },
        { name: 'sessions', ru: 'Сеансы входа' },
      ],
      functions: ['admin_set_user_blocked'],
      contexts: ['org', 'user'],
      filtered: false,
      repo: 'kutya001/Buhuchet.kg',
      commit: 'abc1234',
    });
    expect(c.request.params?.fields).toEqual([
      {
        name: 'id',
        type: 'Uuid',
        required: true,
        nullable: false,
        constraints: 'UUID',
        description: '',
      },
    ]);
    expect(c.request.body).toMatchObject({
      schema: 'AdminUserVersionRequest',
      contentType: 'application/json',
      example: '{\n  "version": 0\n}',
    });
    expect(c.responses[0]).toMatchObject({ code: '200', schema: 'AdminUser' });
    expect(c.responses[0]!.fields?.map((x) => x.name)).toEqual(['id', 'org']);
    expect(c.rls).toContainEqual({
      name: 'users',
      ru: 'Пользователи',
      rule: 'Включена: своя организация',
    });
    expect(c.queries).toEqual([
      {
        kind: 'sql',
        text: 'select app.admin_set_user_blocked($1, $2)',
        file: 'packages/db/src/admin-users.ts',
        fn: 'adminSetUserBlocked',
        line: 270,
      },
    ]);
    // Имена схем с разобранными полями — в типах они открываются по нажатию.
    expect(c.schemas).toEqual(['AdminUserOrg']);
    // Место с запросом к базе отмечено — у него значок базы.
    expect(c.code).toEqual([
      {
        file: 'packages/db/src/admin-users.ts',
        fn: 'adminSetUserBlocked',
        line: 10,
        what: 'Запрос к базе',
        db: true,
      },
    ]);

    // Список с параметрами строки запроса — «Меняется по фильтрам»; представление — с таблицами.
    const listed = AdminApiMethodCard.parse(
      await (await get(`${P}/method?id=${encodeURIComponent('GET /admin/users')}`)).json(),
    );
    expect(listed.filtered).toBe(true);
    expect(listed.views).toEqual([
      { name: 'admin_users', migration: '0033_admin_users', reads: ['Сотрудники', 'Пользователи'] },
    ]);
    expect(listed.queries.map((q) => q.kind)).toEqual(['view', 'code']);
    expect(listed.code.map((x) => x.db)).toEqual([false]);

    const none = await get(`${P}/method?id=${encodeURIComponent('GET /net/takogo')}`);
    expect(none.status).toBe(404);
    expect((await get(`${P}/method`)).status).toBe(400);

    const zod = AdminApiSchemaFields.parse(await (await get(`${P}/zod?name=AdminUser`)).json());
    expect(zod.fields.map((x) => [x.name, x.type, x.nullable])).toEqual([
      ['id', 'Uuid', false],
      ['org', 'AdminUserOrg', true],
    ]);
    expect(zod.schemas).toEqual(['AdminUserOrg']);
    expect((await get(`${P}/zod?name=NetTakoi`)).status).toBe(404);
    expect((await get(`${P}/zod?name=__proto__`)).status).toBe(400);
    expect((await get(`${P}/zod?name=constructor`)).status).toBe(404);
  });

  it('страница схемы: данные встроены перед её скриптом, рамка без прав сайта и без запросов', async () => {
    const res = await get(`${P}/schema-page?theme=dark`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('content-security-policy')).toBe(SCHEMA_PAGE_CSP);
    expect(SCHEMA_PAGE_CSP).toContain('sandbox allow-scripts');
    expect(SCHEMA_PAGE_CSP).not.toContain('allow-same-origin');
    expect(SCHEMA_PAGE_CSP).toContain("connect-src 'none'");
    expect(SCHEMA_PAGE_CSP).toContain("frame-ancestors 'self'");
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    const at = html.indexOf('<script>window.TDX_IN=');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(html.indexOf("<script>\n'use strict';"));
    const json = html.slice(at + '<script>window.TDX_IN='.length, html.indexOf(';</script>', at));
    // «<» в данных экранирован: текст SQL не закрывает скрипт страницы.
    expect(json).not.toContain('<');
    const data = JSON.parse(json) as { theme: string; schema: typeof SCHEMA; api: unknown };
    expect(data.theme).toBe('dark');
    expect(data.schema.tables.map((t) => t.name)).toEqual(['users', 'employees', 'sessions']);
    expect(data.api).toEqual(schemaPageIndex(docs().api));
    expect((await get(`${P}/schema-page?theme=pink`)).status).toBe(400);
    // Страница не та, что ждём (нет места для данных), — «не удалось прочитать».
    const other = createApp({
      ...f.deps,
      techDocs: { load: async () => docs({ page: '<html></html>' }) },
    });
    expect((await apiRequest(other, 'GET', `${P}/schema-page`, admin)).status).toBe(404);
  });

  it('карта «таблица → методы»: чтение и запись, методы по адресу', () => {
    const idx = schemaPageIndex(docs().api);
    expect(idx.t.users).toEqual([
      ['GET /admin/users', 'r'],
      ['POST /admin/users/{id}/block', 'w'],
    ]);
    expect(idx.t.employees).toEqual([
      ['GET /admin/users', 'r'],
      ['POST /admin/users/{id}/block', 'r'],
    ]);
    expect(idx.m['POST /auth/login']).toEqual({
      m: 'POST',
      p: '/auth/login',
      s: 'Вход по логину и паролю',
      g: 'Вход',
      r: [],
      w: [],
    });
  });

  it('имена из снимка — строгого вида: чужой метод, адрес и таблица не читаются, «__proto__» — обычный ключ', () => {
    const first = API.methods[0]!;
    const withMethod = (over: object) => ({ ...API, methods: [{ ...first, ...over }] });
    expect(() => docs({ api: withMethod({ m: 'TRACE' }) })).toThrow();
    expect(() => docs({ api: withMethod({ p: '__proto__' }) })).toThrow();
    expect(() => docs({ api: withMethod({ id: 'GET <script>' }) })).toThrow();
    expect(() => docs({ api: withMethod({ r: ['users; drop'] }) })).toThrow();
    const idx = schemaPageIndex(docs({ api: withMethod({ r: ['__proto__'], w: [] }) }).api);
    expect(Object.keys(idx.t)).toContain('__proto__');
    expect(idx.t['__proto__']).toEqual([[first.id, 'r']]);
    expect(({} as Record<string, unknown>)[first.id]).toBeUndefined();
  });

  it('«Скачать OpenAPI»: OpenAPI 3.1 с x-tables, x-access и схемами', async () => {
    const res = await get(`${P}/openapi`);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="openapi.json"');
    const doc = (await res.json()) as {
      openapi: string;
      info: { version: string };
      paths: Record<string, Record<string, Record<string, unknown>>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.version).toBe('abc1234');
    const block = doc.paths['/admin/users/{id}/block']!.post!;
    expect(block['x-tables']).toEqual({ read: ['employees'], write: ['users', 'sessions'] });
    expect(block['x-access']).toBe('Администратор платформы');
    expect(block.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    ]);
    expect(doc.paths['/auth/login']!.post!['x-access']).toBe('Без входа');
    expect(doc.components.schemas.AdminUser).toMatchObject({
      type: 'object',
      required: ['id', 'org'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        org: { $ref: '#/components/schemas/AdminUserOrg', nullable: true },
      },
    });
  });

  it('карточка метода с правом: права — названиями из каталога, неизвестное — кодом', async () => {
    const api = {
      ...API,
      methods: [
        { ...API.methods[0]!, id: 'GET /contractors', acc: 'perm', perm: ['cpView', 'netTakogo'] },
      ],
    };
    const withPerm = createApp({ ...f.deps, techDocs: { load: async () => docs({ api }) } });
    const res = await apiRequest(
      withPerm,
      'GET',
      `${P}/method?id=${encodeURIComponent('GET /contractors')}`,
      admin,
    );
    expect(res.status).toBe(200);
    const c = AdminApiMethodCard.parse(await res.json());
    expect(c.access).toBe('perm');
    expect(c.permissions).toHaveLength(2);
    expect(c.permissions[0]).toMatch(/[А-Яа-я]/);
    expect(c.permissions[0]).not.toBe('cpView');
    expect(c.permissions[1]).toBe('netTakogo');
  });

  it('данные с диска: первая папка, где они читаются; нет нигде — null и сообщение об ошибке', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'techdocs-'));
    try {
      await writeFile(path.join(dir, 'api.json'), JSON.stringify(API));
      await writeFile(path.join(dir, 'schema.json'), JSON.stringify(SCHEMA));
      await writeFile(path.join(dir, 'page.html'), PAGE);
      const errors: unknown[] = [];
      const found = await fileTechDocs([path.join(dir, 'net'), dir], (e) => errors.push(e)).load();
      expect(found?.api.methods).toHaveLength(3);
      expect(found?.page).toBe(PAGE);
      expect(errors).toEqual([]);

      const source = fileTechDocs([path.join(dir, 'net')], (e) => errors.push(e));
      expect(await source.load()).toBeNull();
      expect(errors).toHaveLength(1);
      // Следующее обращение пробует снова.
      expect(await source.load()).toBeNull();
      expect(errors).toHaveLength(2);

      // Неверный состав файла — тоже «не прочитано», а не падение.
      await writeFile(path.join(dir, 'api.json'), '{"meta":{}}');
      expect(await fileTechDocs([dir], (e) => errors.push(e)).load()).toBeNull();
      expect(errors).toHaveLength(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('описание не собрано — 404 «не удалось прочитать», а не ошибка сервера', async () => {
    for (const source of [undefined, { load: async () => null }]) {
      const bare = createApp({ ...f.deps, techDocs: source });
      for (const path of [P, `${P}/methods`, `${P}/schema-page`, `${P}/openapi`]) {
        const res = await apiRequest(bare, 'GET', path, admin);
        expect(res.status, path).toBe(404);
        expect(ApiError.parse(await res.json()).error.code).toBe('techdocs_missing');
      }
    }
  });
});
