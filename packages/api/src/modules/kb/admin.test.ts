import { databaseAvailable, seedKbReference } from '@buhuchet/db/testing';
import {
  AdminKbArticle,
  AdminKbHistory,
  AdminKbLevels,
  AdminKbLevelsSaved,
  AdminKbMeta,
  AdminKbRowList,
  AdminKbStep,
  ApiError,
  KbArticle,
  KbState,
} from '@buhuchet/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

// Админка → «База знаний (содержимое)» (задача 2.39): «Шаги уроков», «Статьи», «Уровни».

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())(
  'Админка → «База знаний (содержимое)»: шаги, статьи и уровни',
  () => {
    let f: Fixture;
    let admin: string;
    let owner: string;

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedKbReference(f.t.admin.db);
      [admin, owner] = await Promise.all([
        signIn(f.app, 'platform-admin', TEST_PASSWORD),
        signIn(f.app, 'owner-a', TEST_PASSWORD),
      ]);
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    const P = '/api/admin/kb';
    const get = (path: string, cookie = admin) => apiRequest(f.app, 'GET', path, cookie);
    const send = (method: 'POST' | 'PUT', path: string, body: unknown, cookie = admin) =>
      apiRequest(f.app, method, path, cookie, body);
    const errorOf = async (res: Response) => ApiError.parse(await res.json()).error;
    const step = async (id: string) =>
      AdminKbStep.parse(await (await get(`${P}/steps/${id}`)).json());
    const fields = (s: AdminKbStep) => ({
      g: s.g,
      t: s.t,
      w: s.w,
      learn: s.learn,
      art: s.art,
      star: s.star,
      perm: s.perm,
      featk: s.featk,
      evk: s.evk,
      active: s.active,
    });
    const lessons = async () =>
      KbState.parse(await (await get('/api/kb/me', owner)).json()).lessons.flatMap((g) => g.steps);

    it('только администратор платформы: сотруднику организации и без входа — отказ', async () => {
      const reads = [
        `${P}/meta`,
        `${P}/history/kbsteps`,
        `${P}/levels`,
        `${P}/list/steps`,
        `${P}/list/arts/values?col=sec`,
        `${P}/steps/profile`,
        `${P}/arts/a1`,
      ];
      for (const path of reads) {
        expect((await get(path, owner)).status, path).toBe(403);
        expect((await get(path, '')).status, path).toBe(401);
      }
      const profile = await step('profile');
      const writes: ['POST' | 'PUT', string, unknown][] = [
        ['POST', `${P}/steps`, { ...fields(profile), mod: 'org' }],
        ['PUT', `${P}/steps/profile`, { ...fields(profile), version: profile.version }],
        ['POST', `${P}/steps/profile/move`, { dir: 'down', version: profile.version }],
        ['POST', `${P}/steps/profile/active`, { active: false, version: profile.version }],
        ['POST', `${P}/arts/preview`, { t: 'x', sec: 'x', mod: '', html: '' }],
        ['PUT', `${P}/levels/business`, { levels: [{ n: 'x', p: 0 }], version: 1 }],
      ];
      for (const [method, path, body] of writes) {
        expect((await send(method, path, body, owner)).status, path).toBe(403);
        expect((await send(method, path, body, '')).status, path).toBe(401);
      }
      expect((await step('profile')).version).toBe(profile.version);
    });

    it('шаг: неверные поля — 400 с полем, устаревшая версия — 409, правка видна в программе', async () => {
      const profile = await step('profile');
      const bad: [Record<string, unknown>, string, string][] = [
        [{ t: ' ' }, 't', 'kb_title_required'],
        [{ t: 'а'.repeat(201) }, 't', 'kb_title_too_long'],
        [{ g: 'nowhere' }, 'g', 'kb_unknown'],
        [{ perm: 'root' }, 'perm', 'kb_unknown'],
        [{ evk: 'x.y' }, 'evk', 'kb_unknown'],
        [{ art: 'zz' }, 'art', 'kb_unknown'],
      ];
      for (const [patch, field, code] of bad) {
        const res = await send('PUT', `${P}/steps/profile`, {
          ...fields(profile),
          ...patch,
          version: profile.version,
        });
        expect(res.status, JSON.stringify(patch)).toBe(400);
        const err = await errorOf(res);
        expect(err.code).toBe(code);
        expect(err.details).toEqual({ field });
      }
      // Неверный JSON — 400 общей проверкой.
      expect(
        (await send('PUT', `${P}/steps/profile`, { ...fields(profile), version: -1 })).status,
      ).toBe(400);

      const saved = await send('PUT', `${P}/steps/profile`, {
        ...fields(profile),
        t: 'Профиль организации',
        version: profile.version,
      });
      expect(saved.status, await saved.clone().text()).toBe(200);
      expect(AdminKbStep.parse(await saved.json()).version).toBe(profile.version + 1);
      const stale = await send('PUT', `${P}/steps/profile`, {
        ...fields(profile),
        version: profile.version,
      });
      expect(stale.status).toBe(409);
      expect((await errorOf(stale)).code).toBe('record_changed');
      expect((await lessons()).find((s) => s.id === 'profile')!.title).toBe('Профиль организации');
    });

    it('новый шаг появляется у всех с отметкой «Новое»; выключенный пропадает', async () => {
      const res = await send('POST', `${P}/steps`, {
        g: 'cps',
        t: 'Посмотреть список контрагентов',
        w: 'Все контрагенты организации',
        learn: true,
        art: '',
        star: false,
        perm: '',
        featk: '',
        evk: 'open',
        active: true,
        mod: 'cps',
      });
      expect(res.status, await res.clone().text()).toBe(200);
      const added = AdminKbStep.parse(await res.json());
      expect(added).toMatchObject({ isNew: true, mod: 'cps', version: 1 });
      const mine = (await lessons()).find((s) => s.id === added.id);
      expect(mine).toMatchObject({ isNew: true, learn: true, module: 'cps', screens: ['cps'] });
      // Место для «Перейти» обязательно у нового шага.
      const noPlace = await send('POST', `${P}/steps`, { ...fields(added), mod: 'nowhere' });
      expect(noPlace.status).toBe(400);
      expect((await errorOf(noPlace)).details).toEqual({ field: 'mod' });

      const off = await send('POST', `${P}/steps/${added.id}/active`, {
        active: false,
        version: added.version,
      });
      expect(off.status).toBe(200);
      expect((await lessons()).some((s) => s.id === added.id)).toBe(false);

      const rows = AdminKbRowList.parse(
        await (await get(`${P}/list/steps?size=all`)).json(),
      ).items;
      const row = rows.find((r) => r.id === added.id)!;
      expect(row).toMatchObject({ active: false, isNew: true, canUp: true, canDown: false });
      expect(row.values).toMatchObject({
        g: 'Контрагенты',
        type: 'Посмотреть',
        perm: 'Просмотр модуля «Контрагенты»',
        evk: '«Перейти» и 3 секунды на экране шага, показ «Показать как» до конца или статья шага (Посмотреть)',
        active: 'Нет',
      });
      const moved = await send('POST', `${P}/steps/${added.id}/move`, {
        dir: 'up',
        version: row.version,
      });
      expect(moved.status).toBe(200);
      const last = await send('POST', `${P}/steps/${added.id}/move`, {
        dir: 'down',
        version: row.version,
      });
      expect(last.status).toBe(409);
      const history = AdminKbHistory.parse(await (await get(`${P}/history/kbsteps`)).json());
      expect(history.items.slice(0, 3).map((h) => h.changes.map((c) => c.field))).toEqual([
        ['ord'],
        ['active'],
        expect.arrayContaining(['g', 't', 'mod']),
      ]);
    });

    it('статья: новая, правка, отключение; предпросмотр — блоками без разметки', async () => {
      const input = {
        sec: 'Модули',
        t: 'Контрагенты: как добавить',
        mod: 'cps',
        perm: '',
        aud: 'biz',
        active: true,
        html: '<h4>Шаг 1</h4><p>Нажмите <b>«+ Добавить»</b></p><script>alert(1)</script>',
      };
      const bad = await send('POST', `${P}/arts`, { ...input, sec: '' });
      expect(bad.status).toBe(400);
      expect((await errorOf(bad)).code).toBe('kb_section_required');
      const res = await send('POST', `${P}/arts`, input);
      expect(res.status, await res.clone().text()).toBe(200);
      const art = AdminKbArticle.parse(await res.json());
      expect((await get(`/api/kb/articles/${art.id}`, owner)).status).toBe(200);

      const off = await send('POST', `${P}/arts/${art.id}/active`, {
        active: false,
        version: art.version,
      });
      expect(off.status).toBe(200);
      expect((await get(`/api/kb/articles/${art.id}`, owner)).status).toBe(404);
      expect(
        (await send('PUT', `${P}/arts/${art.id}`, { ...input, version: art.version })).status,
      ).toBe(409);

      const preview = KbArticle.parse(
        await (
          await send('POST', `${P}/arts/preview`, { t: input.t, sec: input.sec, mod: 'cps', html: input.html })
        ).json(),
      );
      expect(preview.blocks).toEqual([
        { type: 'h4', inline: [{ text: 'Шаг 1' }] },
        { type: 'p', inline: [{ text: 'Нажмите ' }, { text: '«+ Добавить»', bold: true }] },
        { type: 'p', inline: [{ text: 'alert(1)' }] },
      ]);
      const meta = AdminKbMeta.parse(await (await get(`${P}/meta`)).json());
      expect(meta.articles.some((a) => a.id === art.id)).toBe(true);
      const history = AdminKbHistory.parse(await (await get(`${P}/history/kbarts`)).json());
      expect(history.items.map((h) => h.action)).toEqual(['update', 'create']);
    });

    it('уровни: проверка порогов, число уровней не меняется, полученные не отнимаются', async () => {
      const levels = AdminKbLevels.parse(await (await get(`${P}/levels`)).json());
      const put = (levelsBody: unknown, version = levels.version) =>
        send('PUT', `${P}/levels/business`, { levels: levelsBody, version });
      const order = await put(levels.business.map((l, j) => (j === 2 ? { ...l, p: 10 } : l)));
      expect(order.status).toBe(400);
      expect((await errorOf(order)).code).toBe('kb_level_order');
      const name = await put(levels.business.map((l, j) => (j === 1 ? { ...l, n: '' } : l)));
      expect((await errorOf(name)).code).toBe('kb_level_name');
      const count = await put(levels.business.slice(0, 3));
      expect((await errorOf(count)).code).toBe('kb_level_count');

      const same = await put(levels.business);
      expect(AdminKbLevelsSaved.parse(await same.json()).changed).toBe(false);
      const next = levels.business.map((l, j) => (j === 1 ? { n: 'Стажёр', p: 20 } : l));
      const saved = await put(next);
      expect(saved.status).toBe(200);
      expect(AdminKbLevelsSaved.parse(await saved.json())).toMatchObject({ changed: true });
      expect((await put(next)).status).toBe(409);
      const state = KbState.parse(await (await get('/api/kb/me', owner)).json());
      expect(state.progress.levels[1]).toMatchObject({ name: 'Стажёр', percent: 20 });
      const history = AdminKbHistory.parse(await (await get(`${P}/history/kblevels`)).json());
      expect(history.items[0]).toMatchObject({ code: 'business' });
    });
  },
);
