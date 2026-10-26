import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import {
  ApiError,
  EmployeeList,
  listQueryParams,
  ListValues,
  StaffTabCounts,
  type ListQuery,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD, unzipTexts } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

/** Сотрудников в организации А после наполнения: 5 из фикстуры и 30 добавленных здесь. */
const EXTRA = 30;
const TOTAL_A = 5 + EXTRA;

describe.skipIf(!databaseAvailable())(
  'Сотрудники: список на сервере (страницы, сортировка, фильтры)',
  () => {
    let f: Fixture;
    let owner: string;

    const list = async (query: Partial<ListQuery>, cookie = owner) => {
      const params = new URLSearchParams(
        listQueryParams({ sort: undefined, page: 1, size: 25, filters: {}, ...query }),
      );
      const res = await apiRequest(f.app, 'GET', `/api/staff?${params}`, cookie);
      expect(res.status, await res.clone().text()).toBe(200);
      return EmployeeList.parse(await res.json());
    };
    const raw = (qs: string) => apiRequest(f.app, 'GET', `/api/staff?${qs}`, owner);

    beforeAll(async () => {
      f = await createStaffFixture();
      owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
      // Сотрудники «Номер 1» … «Номер 30»: созданы по порядку, у чётных — телефон, каждый третий
      // заблокирован. Хеш пароля не важен: они не входят.
      const users = await f.t.admin.db
        .insert(schema.users)
        .values(
          Array.from({ length: EXTRA }, (_, i) => ({
            orgId: f.a.orgId,
            login: `list-${i + 1}`,
            passwordHash: 'x',
          })),
        )
        .returning({ id: schema.users.id, login: schema.users.login });
      await f.t.admin.db.insert(schema.employees).values(
        users.map((u, i) => ({
          orgId: f.a.orgId,
          userId: u.id,
          fullName: `Номер ${i + 1}`,
          shortName: `Номер ${i + 1}`,
          phone: i % 2 ? `+99655510${String(i + 1).padStart(4, '0')}` : null,
          roleId: f.templateRole(f.a, 'acc'),
          active: i % 3 !== 2,
          createdAt: new Date(Date.UTC(2030, 0, 1, 0, i)),
        })),
      );
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('счётчики вкладок: активных сотрудников и ролей своей организации; без права «Сотрудники и роли» — без ролей', async () => {
      const counts = async (cookie: string) => {
        const res = await apiRequest(f.app, 'GET', '/api/staff/tab-counts', cookie);
        expect(res.status, await res.clone().text()).toBe(200);
        return StaffTabCounts.parse(await res.json());
      };
      // Организация А: 5 сотрудников фикстуры и 20 из 30 добавленных (каждый третий заблокирован), 5 ролей.
      expect(await counts(owner)).toEqual({ list: 25, roles: 5 });
      // Организация Б: владелец и бухгалтер, 3 роли — чужие не считаются.
      expect(await counts(await signIn(f.app, 'owner-b', TEST_PASSWORD))).toEqual({
        list: 2,
        roles: 3,
      });
      // Главный бухгалтер видит сотрудников, но вкладки «Роли» у него нет.
      expect(await counts(await signIn(f.app, 'chief-a', TEST_PASSWORD))).toEqual({
        list: 25,
        roles: null,
      });
      // Без «Просматривать сотрудников» — 403, без входа — 401.
      const acc = await signIn(f.app, 'acc-a', TEST_PASSWORD);
      expect((await apiRequest(f.app, 'GET', '/api/staff/tab-counts', acc)).status).toBe(403);
      expect((await apiRequest(f.app, 'GET', '/api/staff/tab-counts')).status).toBe(401);
    });

    it('в ответе только текущая страница; всего записей и номер страницы', async () => {
      const first = await list({});
      expect(first.items).toHaveLength(25);
      expect(first).toMatchObject({ total: TOTAL_A, page: 1, size: 25, totals: {} });
      const second = await list({ page: 2 });
      expect(second.items).toHaveLength(TOTAL_A - 25);
      expect(second.page).toBe(2);
      const ids = new Set([...first.items, ...second.items].map((e) => e.id));
      expect(ids.size).toBe(TOTAL_A);
      expect((await list({ size: 'all' })).items).toHaveLength(TOTAL_A);
      expect((await list({ size: 50 })).items).toHaveLength(TOTAL_A);
    });

    it('страницы за концом списка нет — последняя', async () => {
      const page = await list({ page: 7 });
      expect(page.page).toBe(2);
      expect(page.items).toHaveLength(TOTAL_A - 25);
    });

    it('по умолчанию — от новых к старым по «Создано»', async () => {
      const { items } = await list({});
      expect(items.slice(0, 3).map((e) => e.fullName)).toEqual([
        'Номер 30',
        'Номер 29',
        'Номер 28',
      ]);
    });

    it('сортировка по ФИО: «Номер 2» перед «Номер 10»; без сортировки — по порядку создания', async () => {
      const asc = await list({
        sort: { key: 'fullName', dir: 'asc' },
        filters: { fullName: { type: 'text', q: 'номер' } },
      });
      expect(asc.items.slice(0, 3).map((e) => e.fullName)).toEqual([
        'Номер 1',
        'Номер 2',
        'Номер 3',
      ]);
      expect(asc.items[9]!.fullName).toBe('Номер 10');
      const none = await list({ sort: null, size: 'all' });
      expect(none.items.at(-1)!.fullName).toBe('Номер 30');
    });

    it('роль — по названию, статус — сначала активные', async () => {
      const byRole = await list({ sort: { key: 'role', dir: 'asc' }, size: 'all' });
      const roles = byRole.items.map((e) => e.role.name);
      expect(roles).toEqual([...roles].sort((x, y) => x.localeCompare(y, 'ru')));
      const byStatus = await list({ sort: { key: 'active', dir: 'asc' }, size: 'all' });
      const firstBlocked = byStatus.items.findIndex((e) => !e.active);
      expect(byStatus.items.slice(firstBlocked).every((e) => !e.active)).toBe(true);
    });

    it('Telegram и «Создал» / «Изменил» сортируются и фильтруются как на экране', async () => {
      const [admin] = await f.t.admin.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.login, 'platform-admin'));
      const [first] = await f.t.admin.db
        .select({ id: schema.employees.id, userId: schema.employees.userId })
        .from(schema.employees)
        .where(eq(schema.employees.fullName, 'Номер 1'));
      // «Номер 1» создал администратор платформы (записи сотрудника у него нет), правок не было.
      await f.t.admin.db
        .update(schema.employees)
        .set({ createdBy: admin!.id, updatedBy: null })
        .where(eq(schema.employees.id, first!.id));
      await f.t.admin.db
        .insert(schema.telegramLinks)
        .values({ userId: first!.userId, orgId: f.a.orgId, chatId: 777001 });

      const byTelegram = await list({ sort: { key: 'telegram', dir: 'asc' }, size: 'all' });
      expect(byTelegram.items.at(-1)!.fullName).toBe('Номер 1');
      const linked = byTelegram.items.filter((e) => e.telegram).map((e) => e.fullName);
      expect(byTelegram.items.slice(-linked.length).every((e) => e.telegram)).toBe(true);

      const byCreator = await list({ sort: { key: 'createdBy', dir: 'asc' } });
      expect(byCreator.items[0]).toMatchObject({
        fullName: 'Номер 1',
        audit: { createdBy: 'Администратор платформы', updatedBy: null },
      });
      for (const key of ['createdBy', 'updatedBy']) {
        const found = await list({
          filters: { [key]: { type: 'enum', vals: ['Администратор платформы'] } },
        });
        expect(
          found.items.map((e) => e.fullName),
          key,
        ).toEqual(['Номер 1']);
        // Группы и значения фильтра — по тому же тексту, что на экране.
        const grouped = await list({ group: [key] });
        expect(grouped.groups?.find((g) => g.label === 'Администратор платформы')?.count, key).toBe(
          1,
        );
        const res = await apiRequest(f.app, 'GET', `/api/staff/values?col=${key}`, owner);
        expect(res.status, key).toBe(200);
        expect(ListValues.parse(await res.json()).items, key).toContainEqual({
          value: 'Администратор платформы',
          label: 'Администратор платформы',
          count: 1,
        });
      }
    });

    it('фильтры: роль по номеру, статус, телефон без пробелов, дата создания', async () => {
      const chief = await list({
        filters: { role: { type: 'enum', vals: [f.templateRole(f.a, 'chief')] } },
      });
      expect(chief.items.map((e) => e.login)).toEqual(['chief-a']);
      const blocked = await list({ filters: { active: { type: 'enum', vals: ['blocked'] } } });
      expect(blocked.total).toBe(EXTRA / 3);
      expect(blocked.items.every((e) => !e.active)).toBe(true);
      // «Выбрать все», затем снять всё, что находит «Найти значение» по «заблок», — подпись из словаря.
      const steps = [
        { on: true, match: '' },
        { on: false, match: 'заблок' },
      ];
      const active = await list({ filters: { active: { type: 'enum', vals: [], steps } } });
      expect(active.total).toBe(TOTAL_A - EXTRA / 3);
      expect(active.items.every((e) => e.active)).toBe(true);
      const phone = await list({ filters: { phone: { type: 'text', q: '555 10 0004' } } });
      expect(phone.items.map((e) => e.fullName)).toEqual(['Номер 4']);
      // Для показа — по маске справочника «Коды телефонов».
      expect(phone.items[0]).toMatchObject({
        phone: '+996555100004',
        phoneText: '+996 555 100 004',
      });
      const created = await list({
        filters: { createdAt: { type: 'date', from: '2030-01-01', to: '2030-01-01' } },
      });
      expect(created.total).toBe(EXTRA);
    });

    it('поиск — по тексту видимых столбцов: подписи статуса и роли, телефон без пробелов', async () => {
      const blocked = await list({ search: { q: 'заблок', keys: ['fullName', 'active'] } });
      expect(blocked.total).toBe(EXTRA / 3);
      expect(blocked.items.every((e) => !e.active)).toBe(true);
      // Только по видимым столбцам: без «Статуса» подпись «Заблокирован» не ищется.
      expect((await list({ search: { q: 'заблок', keys: ['fullName'] } })).total).toBe(0);
      const chief = await list({ search: { q: 'главный', keys: ['role'] } });
      expect(chief.items.map((e) => e.login)).toEqual(['chief-a']);
      const phone = await list({ search: { q: '555 100 004', keys: ['phone'] } });
      expect(phone.items.map((e) => e.fullName)).toEqual(['Номер 4']);
    });

    it('фильтр и поиск сочетаются; группы двух уровней с числом записей', async () => {
      const both = await list({
        filters: { active: { type: 'enum', vals: ['active'] } },
        search: { q: 'номер 1', keys: ['fullName'] },
      });
      // Под «номер 1» — «Номер 1» и «Номер 10» … «Номер 19»; из них заблокированы 12, 15 и 18.
      expect(both.items.map((e) => e.fullName).sort()).toEqual(
        [
          'Номер 1',
          'Номер 10',
          'Номер 11',
          'Номер 13',
          'Номер 14',
          'Номер 16',
          'Номер 17',
          'Номер 19',
        ].sort(),
      );
      const grouped = await list({ group: ['role', 'active'] });
      expect(grouped.size).toBe('all');
      expect(grouped.items).toHaveLength(TOTAL_A);
      const groups = grouped.groups ?? [];
      expect(groups.reduce((n, g) => n + g.count, 0)).toBe(TOTAL_A);
      const acc = groups.find((g) => g.label === 'Бухгалтер')!;
      expect(acc.sub?.map((g) => [g.label, g.count])).toEqual([
        ['Активен', 21],
        ['Заблокирован', 10],
      ]);
      expect(grouped.rowGroups).toHaveLength(TOTAL_A);
      const firstAcc = grouped.items.findIndex((e) => e.role.name === 'Бухгалтер');
      expect(grouped.rowGroups?.[firstAcc]).toEqual([acc.key, 'active']);
    });

    it('значения для фильтра-галочек: подписи из словаря и названия ролей; чужих ролей нет', async () => {
      const values = async (col: string, cookie = owner, q?: string) => {
        const query = new URLSearchParams({ col, ...(q ? { q } : {}) });
        const res = await apiRequest(f.app, 'GET', `/api/staff/values?${query}`, cookie);
        expect(res.status).toBe(200);
        return ListValues.parse(await res.json());
      };
      expect(await values('active')).toEqual({
        items: [
          { value: 'active', label: 'Активен', count: TOTAL_A - EXTRA / 3 },
          { value: 'blocked', label: 'Заблокирован', count: EXTRA / 3 },
        ],
        total: 2,
        more: false,
      });
      // «Найти значение» — по подписи из словаря, без учёта регистра.
      expect((await values('active', owner, 'ЗАБЛОК')).items).toEqual([
        { value: 'blocked', label: 'Заблокирован', count: EXTRA / 3 },
      ]);
      expect((await values('role', owner, 'главный')).items.map((v) => v.label)).toEqual([
        'Главный бухгалтер',
      ]);
      const roles = (await values('role')).items.map((v) => v.label);
      expect(roles).toContain('Главный бухгалтер');
      const ownerB = await signIn(f.app, 'owner-b', TEST_PASSWORD);
      const rolesB = (await values('role', ownerB)).items;
      expect(rolesB.reduce((n, v) => n + v.count, 0)).toBe(2);
      expect(rolesB.map((v) => v.value)).not.toContain(f.templateRole(f.a, 'acc'));
      // Поиск значений и «всего» — тоже только по своей организации.
      const foundB = await values('role', ownerB, 'бух');
      expect(foundB.items.map((v) => v.value)).not.toContain(f.templateRole(f.a, 'acc'));
      expect(foundB.items.length).toBeGreaterThan(0);
      expect(foundB.total).toBe(foundB.items.length);
      expect(foundB.items.reduce((n, v) => n + v.count, 0)).toBeLessThanOrEqual(2);
      const bad = await apiRequest(f.app, 'GET', '/api/staff/values?col=passwordHash', owner);
      expect(bad.status).toBe(400);
    });

    it('«В Excel»: файл со всеми записями под фильтром, видимые столбцы по порядку экрана', async () => {
      const params = new URLSearchParams({
        cols: 'fullName,phone,active',
        sort: 'fullName.asc',
        filters: JSON.stringify({ active: { type: 'enum', vals: ['blocked'] } }),
      });
      const res = await apiRequest(f.app, 'GET', `/api/staff/export?${params}`, owner);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('spreadsheetml.sheet');
      expect(res.headers.get('content-disposition')).toContain(
        `filename*=UTF-8''${encodeURIComponent('Сотрудники')}`,
      );
      expect(res.headers.get('x-export-rows')).toBe(String(EXTRA / 3));
      expect(res.headers.get('x-export-more')).toBe('0');
      const files = unzipTexts(new Uint8Array(await res.arrayBuffer()));
      const sheet = files['xl/worksheets/sheet1.xml']!;
      const texts = [...sheet.matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map((m) => m[1]);
      expect(texts.slice(0, 3)).toEqual(['ФИО', 'Телефон', 'Статус']);
      // Первая строка — «Номер 3» без телефона: пустая ячейка в файл не пишется.
      expect(texts.slice(3, 5)).toEqual(['Номер 3', 'Заблокирован']);
      expect(texts).toContain('+996 555 100 006');
      expect(texts.filter((x) => x === 'Заблокирован')).toHaveLength(EXTRA / 3);
    });

    it('«В Excel» — только с правом «Выгружать в Excel»; неизвестный столбец — 400', async () => {
      const [ownerUser] = await f.t.admin.db
        .select({ hash: schema.users.passwordHash })
        .from(schema.users)
        .where(eq(schema.users.login, 'owner-a'));
      const [role] = await f.t.admin.db
        .insert(schema.roles)
        .values({ orgId: f.a.orgId, name: 'Только просмотр' })
        .returning({ id: schema.roles.id });
      await f.t.admin.db
        .insert(schema.rolePermissions)
        .values({ orgId: f.a.orgId, roleId: role!.id, permissionId: 'staffView' });
      const [user] = await f.t.admin.db
        .insert(schema.users)
        .values({ orgId: f.a.orgId, login: 'viewer-a', passwordHash: ownerUser!.hash })
        .returning({ id: schema.users.id });
      await f.t.admin.db.insert(schema.employees).values({
        orgId: f.a.orgId,
        userId: user!.id,
        fullName: 'Только просмотр',
        shortName: 'viewer',
        roleId: role!.id,
      });
      const viewer = await signIn(f.app, 'viewer-a', TEST_PASSWORD);
      expect((await apiRequest(f.app, 'GET', '/api/staff?size=25', viewer)).status).toBe(200);
      const denied = await apiRequest(f.app, 'GET', '/api/staff/export?cols=fullName', viewer);
      expect(denied.status).toBe(403);
      const bad = await apiRequest(f.app, 'GET', '/api/staff/export?cols=passwordHash', owner);
      expect(bad.status).toBe(400);
      await f.t.admin.db.delete(schema.employees).where(eq(schema.employees.userId, user!.id));
      await f.t.admin.db.delete(schema.users).where(eq(schema.users.id, user!.id));
    });

    it('другая организация в список не попадает', async () => {
      const acc = await signIn(f.app, 'acc-b', TEST_PASSWORD);
      expect((await apiRequest(f.app, 'GET', '/api/staff', acc)).status).toBe(403);
      const { items } = await list({ size: 'all' });
      expect(items.map((e) => e.login)).not.toContain('acc-b');
      // И со стороны Б: владелец Б видит только своих.
      const ownerB = await signIn(f.app, 'owner-b', TEST_PASSWORD);
      const b = await list({ size: 'all' }, ownerB);
      expect(b.items.map((e) => e.login).sort()).toEqual(['acc-b', 'owner-b']);
      // И в файле «В Excel» у Б — только свои.
      const file = await apiRequest(f.app, 'GET', '/api/staff/export?cols=login', ownerB);
      expect(file.status).toBe(200);
      expect(file.headers.get('x-export-rows')).toBe('2');
      const sheet = unzipTexts(new Uint8Array(await file.arrayBuffer()))[
        'xl/worksheets/sheet1.xml'
      ]!;
      const logins = [...sheet.matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)].map((m) => m[1]);
      expect(logins.slice(1).sort()).toEqual(['acc-b', 'owner-b']);
    });

    it('неверные сортировка, страница и фильтры — 400', async () => {
      for (const qs of [
        'sort=password.asc',
        'sort=fullName',
        'page=0',
        'size=10',
        'filters=%7B',
        `filters=${encodeURIComponent('{"fullName":{"type":"num","from":1}}')}`,
        `filters=${encodeURIComponent('{"passwordHash":{"type":"text","q":"a"}}')}`,
        // Года 0000 в базе нет: это неверный фильтр, а не ошибка сервера.
        `filters=${encodeURIComponent('{"createdAt":{"type":"date","from":"0000-01-01"}}')}`,
        `filters=${encodeURIComponent('{"lastLoginAt":{"type":"date","to":"0000-12-31"}}')}`,
        'q=a&qcols=passwordHash',
        'group=passwordHash',
        `group=role&agg=${encodeURIComponent('{"fullName":"sum"}')}`,
        'group=a,b,c',
      ]) {
        const res = await raw(qs);
        expect(res.status, qs).toBe(400);
        expect(ApiError.parse(await res.json()).error.code).toBe('validation_failed');
      }
    });
  },
);
