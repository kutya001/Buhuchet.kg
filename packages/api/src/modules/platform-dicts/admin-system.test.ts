import {
  databaseAvailable,
  seedAllPlatformDictionaries,
  seedUiTextsReference,
} from '@buhuchet/db/testing';
import {
  AdminDictHistory,
  AdminMessageTemplates,
  AdminPermissionList,
  AdminRoleTemplates,
  AdminStatuses,
  ApiError,
  ListValues,
  UiDictionary,
} from '@buhuchet/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())(
  'Админка → «Справочники платформы», часть 3: статусы, права ролей, шаблоны ролей и сообщений',
  () => {
    let f: Fixture;
    let admin: string;
    let owner: string;

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      await seedUiTextsReference(f.t.admin.db);
      [admin, owner] = await Promise.all([
        signIn(f.app, 'platform-admin', TEST_PASSWORD),
        signIn(f.app, 'owner-a', TEST_PASSWORD),
      ]);
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    const P = '/api/admin/platform-dicts';
    const get = (path: string, cookie = admin) => apiRequest(f.app, 'GET', path, cookie);
    const put = (path: string, body: unknown, cookie = admin) =>
      apiRequest(f.app, 'PUT', path, cookie, body);
    const errorOf = async (res: Response) => ApiError.parse(await res.json()).error;
    const statuses = async () => AdminStatuses.parse(await (await get(`${P}/statuses`)).json());
    const history = async (tab: string) =>
      AdminDictHistory.parse(await (await get(`${P}/${tab}/history`)).json());

    it('только администратор платформы: сотруднику организации и без входа — отказ', async () => {
      const reads = [
        `${P}/statuses`,
        `${P}/statuses/history`,
        `${P}/perms`,
        `${P}/perms/values?col=group`,
        `${P}/perms/export?cols=name`,
        `${P}/perms/history`,
        `${P}/roletpl`,
        `${P}/roletpl/history`,
        `${P}/templates`,
        `${P}/templates/history`,
      ];
      for (const path of reads) {
        expect((await get(path, owner)).status, path).toBe(403);
        expect((await get(path, '')).status, path).toBe(401);
      }
      const writes: [string, unknown][] = [
        [`${P}/statuses/report/todo/name`, { name: 'Взлом', version: 1 }],
        [`${P}/statuses/report/todo/tone`, { tone: 'red', version: 1 }],
        [`${P}/statuses/periods/m`, { name: 'Взлом', version: 1 }],
        [`${P}/perms/cpView`, { name: 'Взлом', description: 'x', version: 1 }],
        [`${P}/roletpl/chief`, { name: 'Взлом', permissions: [], scopes: {}, version: 1 }],
        [`${P}/templates`, { items: [{ key: 'tgCode', text: 'Взлом {код}', version: 1 }] }],
      ];
      for (const [path, body] of writes) {
        expect((await put(path, body, owner)).status, path).toBe(403);
        expect((await put(path, body, '')).status, path).toBe(401);
      }
    });

    it('«Статусы»: цвет и название сразу в словаре экранов; периодичность без повторов; история', async () => {
      const before = await statuses();
      const done = before.statuses.find((x) => x.scale === 'task' && x.code === 'done')!;
      expect(done).toMatchObject({
        name: 'Выполнена',
        tone: 'green',
        place: { kind: 'step', n: 3 },
      });

      const tone = await put(`${P}/statuses/task/done/tone`, {
        tone: 'purple',
        version: done.toneVersion,
      });
      expect(tone.status).toBe(200);
      const renamed = await put(`${P}/statuses/task/done/name`, {
        name: 'Сделана',
        version: done.nameVersion,
      });
      expect(renamed.status).toBe(200);
      const dict = UiDictionary.parse(await (await get('/api/l10n', owner)).json());
      expect(dict.texts['tone.task.done']).toBe('purple');
      expect(dict.texts['status.task.done']).toBe('Сделана');

      // Повторная правка по старой версии — «запись изменена другим пользователем».
      const stale = await put(`${P}/statuses/task/done/tone`, {
        tone: 'red',
        version: done.toneVersion,
      });
      expect(stale.status).toBe(409);
      expect((await put(`${P}/statuses/task/nope/tone`, { tone: 'red', version: 1 })).status).toBe(
        404,
      );
      expect((await put(`${P}/statuses/task/done/tone`, { tone: 'pink', version: 2 })).status).toBe(
        400,
      );
      expect((await put(`${P}/statuses/task/done/name`, { name: ' ', version: 2 })).status).toBe(
        400,
      );

      const quarter = before.periods.find((p) => p.code === 'q')!;
      const taken = await put(`${P}/statuses/periods/q`, {
        name: 'месяц',
        version: quarter.nameVersion,
      });
      expect(taken.status).toBe(400);
      expect((await errorOf(taken)).code).toBe('period_taken');

      const h = await history('statuses');
      expect(h.items.map((x) => [x.code, x.label, x.changes[0]!.field])).toEqual([
        ['task.done', 'Сделана', 'name'],
        ['task.done', 'Сделана', 'tone'],
      ]);
    });

    it('«Права ролей»: список по группам, фильтр и Excel; повтор названия — отказ', async () => {
      const list = AdminPermissionList.parse(await (await get(`${P}/perms?size=all`)).json());
      expect(list.total).toBe(39);
      expect(list.items[0]).toMatchObject({ group: 'cps', groupText: 'Контрагенты' });
      const groups = ListValues.parse(await (await get(`${P}/perms/values?col=group`)).json());
      expect(groups.items.reduce((n, v) => n + v.count, 0)).toBe(39);
      const xlsx = await get(`${P}/perms/export?cols=group,name,description`);
      expect(xlsx.status).toBe(200);

      const [a, b] = list.items;
      const taken = await put(`${P}/perms/${a!.id}`, {
        name: b!.name.toUpperCase(),
        description: a!.description,
        version: a!.version,
      });
      expect(taken.status).toBe(400);
      expect((await errorOf(taken)).code).toBe('perm_taken');
      const saved = await put(`${P}/perms/${a!.id}`, {
        name: `${a!.name} (все)`,
        description: 'Видит карточки контрагентов.',
        version: a!.version,
      });
      expect(saved.status).toBe(200);
      const h = await history('perms');
      expect(h.items[0]).toMatchObject({ code: a!.id, label: `${a!.name} (все)` });
      expect(h.items[0]!.changes.map((c) => c.field)).toEqual(['name', 'description']);
      // Форма роли у организации видит новое название.
      const catalog = (await (await get('/api/permissions', owner)).json()) as {
        items: { id: string; name: string }[];
      };
      expect(catalog.items.find((p) => p.id === a!.id)?.name).toBe(`${a!.name} (все)`);
    });

    it('«Шаблоны ролей»: право только владельца, без просмотра и повтор названия — отказ', async () => {
      const { items } = AdminRoleTemplates.parse(await (await get(`${P}/roletpl`)).json());
      const [tpl, other] = items;
      const at = `${P}/roletpl/${tpl!.code}`;
      const form = {
        name: tpl!.name,
        permissions: tpl!.permissions,
        scopes: tpl!.scopes,
        version: tpl!.version,
      };
      const ownerOnly = await put(at, { ...form, permissions: [...form.permissions, 'org'] });
      expect((await errorOf(ownerOnly)).code).toBe('roletpl_owner_only');
      const noView = await put(at, { ...form, permissions: ['createCp'] });
      expect((await errorOf(noView)).code).toBe('roletpl_view_required');
      const taken = await put(at, { ...form, name: other!.name });
      expect((await errorOf(taken)).code).toBe('roletpl_taken');
      const saved = await put(at, { ...form, permissions: ['cpView'], scopes: { cps: 'all' } });
      expect(saved.status).toBe(200);
      const after = AdminRoleTemplates.parse(await (await get(`${P}/roletpl`)).json()).items[0]!;
      expect(after.permissions).toEqual(['cpView']);
      expect(after.scopes.cps).toBe('all');
      expect((await history('roletpl')).items[0]!.changes.map((c) => c.field)).toContain(
        'permissions',
      );
    });

    it('«Шаблоны»: подстановки шаблона; чужая подстановка и пустой текст — отказ; Telegram видит новый текст', async () => {
      const { items } = AdminMessageTemplates.parse(await (await get(`${P}/templates`)).json());
      expect(items.map((x) => x.key).slice(0, 3)).toEqual(['waTax', 'waFee', 'waPage']);
      const code = items.find((x) => x.key === 'tgCode')!;
      expect(code.variables).toEqual(['код']);
      const all = items.map((x) => ({ key: x.key, text: x.text, version: x.version }));
      const wrong = await put(`${P}/templates`, {
        items: all.map((x) => (x.key === 'tgCode' ? { ...x, text: 'Код {кот}' } : x)),
      });
      expect(wrong.status).toBe(400);
      expect(await errorOf(wrong)).toMatchObject({
        code: 'unknown_vars',
        details: { field: 'tgCode', list: '{кот}', known: '{код}' },
      });
      const empty = await put(`${P}/templates`, {
        items: all.map((x) => (x.key === 'tgCode' ? { ...x, text: '  ' } : x)),
      });
      expect(empty.status).toBe(400);
      const saved = await put(`${P}/templates`, {
        items: all.map((x) => (x.key === 'tgCode' ? { ...x, text: 'Ваш код: {код}' } : x)),
      });
      expect(await saved.json()).toEqual({ changed: 1 });
      const h = await history('templates');
      expect(h.items[0]).toMatchObject({
        code: 'tgCode',
        label: 'Telegram: код восстановления пароля',
      });
    });
  },
);
