import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import { ApiError, EmployeeList, listQueryParams, type ListQuery } from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

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

    it('другая организация в список не попадает', async () => {
      const acc = await signIn(f.app, 'acc-b', TEST_PASSWORD);
      expect((await apiRequest(f.app, 'GET', '/api/staff', acc)).status).toBe(403);
      const { items } = await list({ size: 'all' });
      expect(items.map((e) => e.login)).not.toContain('acc-b');
      // И со стороны Б: владелец Б видит только своих.
      const ownerB = await signIn(f.app, 'owner-b', TEST_PASSWORD);
      const b = await list({ size: 'all' }, ownerB);
      expect(b.items.map((e) => e.login).sort()).toEqual(['acc-b', 'owner-b']);
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
      ]) {
        const res = await raw(qs);
        expect(res.status, qs).toBe(400);
        expect(ApiError.parse(await res.json()).error.code).toBe('validation_failed');
      }
    });
  },
);
