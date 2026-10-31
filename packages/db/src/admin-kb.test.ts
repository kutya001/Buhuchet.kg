import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { KbArticleInput, KbStepInput } from '@buhuchet/domain';
import { readReference, saveReference } from './admin-gked';
import {
  adminKbArticleSave,
  adminKbArticles,
  adminKbHistory,
  adminKbLevels,
  adminKbLevelsSave,
  adminKbMeta,
  adminKbStepActive,
  adminKbStepMove,
  adminKbStepSave,
  adminKbSteps,
  listAdminKbPage,
} from './admin-kb';
import { withUserContext } from './auth';
import type { Tx } from './client';
import { withOrgContext } from './context';
import { kbCatalog } from './kb';
import { createOrganization, type CreatedOrganization } from './organizations';
import { users } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedKbReference,
  type TestDatabase,
} from './testing';

const t = (key: string) => key;

describe.skipIf(!databaseAvailable())(
  'Админка → «База знаний (содержимое)»: шаги, статьи и уровни пишет только администратор платформы',
  () => {
    let db: TestDatabase;
    let org: CreatedOrganization;
    let adminId: string;

    beforeAll(async () => {
      db = await createTestDatabase();
      await seedAccessReference(db.admin.db);
      await seedKbReference(db.admin.db);
      const [admin] = await db.admin.db
        .insert(users)
        .values({ login: 'platform', passwordHash: '!', isPlatformAdmin: true })
        .returning({ id: users.id });
      adminId = admin!.id;
      org = await createOrganization(db.app.db, {
        name: 'ОсОО «Альфа»',
        inn: '01811201810456',
        slug: 'alfa',
        owner: { fullName: 'Асанов Асан', login: 'asanov', passwordHash: '!' },
      });
    });

    afterAll(async () => {
      await db?.drop();
    });

    const asAdmin = <T>(fn: (tx: Tx) => Promise<T>) => withUserContext(db.app.db, adminId, fn);
    const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
      withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, fn);

    const inputOf = (s: Awaited<ReturnType<typeof adminKbSteps>>[number]): KbStepInput => ({
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

    it('сотрудник организации не пишет разделы Базы знаний — функция базы отвечает пусто', async () => {
      for (const key of ['kbSteps', 'kbArticles', 'kbLevels', 'kbShows'] as const) {
        const ref = await asAdmin((tx) => readReference(tx, key));
        expect(await asOwner((tx) => saveReference(tx, key, [], ref!.version)), key).toBeNull();
      }
      const steps = await asAdmin((tx) => adminKbSteps(tx));
      const profile = steps.find((s) => s.id === 'profile')!;
      const saved = await asOwner((tx) =>
        adminKbStepSave(tx, 'profile', { ...inputOf(profile), t: 'Взлом' }, profile.version),
      );
      expect(saved).toEqual({ ok: false, reason: 'changed' });
      expect((await asAdmin((tx) => adminKbSteps(tx))).find((s) => s.id === 'profile')!.t).toBe(
        profile.t,
      );
    });

    it('правка шага: версия записи, поля вне окна остаются, история; устаревшая версия — changed', async () => {
      const steps = await asAdmin((tx) => adminKbSteps(tx));
      const look = steps.find((s) => s.id === 'daymonth')!;
      const saved = await asAdmin((tx) =>
        adminKbStepSave(
          tx,
          'daymonth',
          { ...inputOf(look), t: 'Дни и месяцы', perm: 'createCp', evk: 'hand' },
          look.version,
        ),
      );
      expect(saved).toMatchObject({ ok: true, value: { t: 'Дни и месяцы', version: 2 } });
      const raw = ((await asAdmin((tx) => readReference(tx, 'kbSteps')))!.payload as {
        id: string;
        at?: string[];
      }[]).find((s) => s.id === 'daymonth')!;
      expect(raw.at).toEqual(['tasks.mine', 'tasks.overdue', 'tasks.all']);
      // Шаг программы организации — тот же, с новым названием.
      const catalog = await asOwner((tx) => kbCatalog(tx));
      expect(catalog.steps.find((s) => s.id === 'daymonth')!.t).toBe('Дни и месяцы');
      expect(
        await asAdmin((tx) => adminKbStepSave(tx, 'daymonth', inputOf(look), look.version)),
      ).toEqual({ ok: false, reason: 'changed' });
      // Правка соседнего шага той версии, что видел администратор, не мешает.
      const tdone = steps.find((s) => s.id === 'tdone')!;
      expect(
        await asAdmin((tx) => adminKbStepSave(tx, 'tdone', inputOf(tdone), tdone.version)),
      ).toMatchObject({ ok: true });
      const history = await asAdmin((tx) => adminKbHistory(tx, 'kbsteps', 12));
      expect(history.items[0]).toMatchObject({
        code: 'daymonth',
        action: 'update',
        label: 'Дни и месяцы',
      });
      expect(history.items[0]!.changes.map((c) => c.field).sort()).toEqual(['evk', 'perm', 't']);
    });

    it('новый шаг: «Новое», последним по порядку, место для «Перейти»; «Выше», «Выключить»', async () => {
      const added = await asAdmin((tx) =>
        adminKbStepSave(
          tx,
          null,
          {
            g: 'cps',
            t: 'Посмотреть список',
            w: '',
            learn: true,
            art: '',
            star: false,
            perm: '',
            featk: '',
            evk: 'open',
            active: true,
            mod: 'cps',
          },
          0,
        ),
      );
      expect(added.ok).toBe(true);
      const step = added.ok ? added.value : null;
      expect(step).toMatchObject({ isNew: true, mod: 'cps', module: 'cps', version: 1 });
      expect(step!.id).toMatch(/^u[0-9a-f]{12}$/);
      const raw = ((await asAdmin((tx) => readReference(tx, 'kbSteps')))!.payload as {
        id: string;
        at?: string[];
      }[]).find((s) => s.id === step!.id)!;
      expect(raw.at).toEqual(['cps']);
      const steps = await asAdmin((tx) => adminKbSteps(tx));
      const cps = steps.filter((s) => s.g === 'cps');
      expect(cps[cps.length - 1]!.id).toBe(step!.id);

      const up = await asAdmin((tx) => adminKbStepMove(tx, step!.id, 'up', 1));
      expect(up).toMatchObject({ ok: true, value: { version: 2 } });
      const after = (await asAdmin((tx) => adminKbSteps(tx))).filter((s) => s.g === 'cps');
      expect(after[after.length - 2]!.id).toBe(step!.id);
      // Первый шаг модуля выше не двигается.
      expect(await asAdmin((tx) => adminKbStepMove(tx, after[0]!.id, 'up', after[0]!.version))).toEqual({
        ok: false,
        reason: 'not_found',
      });

      const off = await asAdmin((tx) => adminKbStepActive(tx, step!.id, false, 2));
      expect(off).toMatchObject({ ok: true, value: { active: false, version: 3 } });
      const lines = (await asAdmin((tx) => adminKbHistory(tx, 'kbsteps', 3))).items;
      expect(lines.map((h) => [h.action, h.changes.map((c) => c.field)])).toEqual([
        ['update', ['active']],
        ['update', ['ord']],
        ['create', expect.arrayContaining(['g', 't', 'learn', 'evk', 'active', 'mod'])],
      ]);
    });

    it('статьи: новая и правка той версии, что видел администратор; история', async () => {
      const input: KbArticleInput = {
        sec: 'Модули',
        t: 'Новая статья',
        mod: 'cps',
        perm: '',
        aud: 'biz',
        active: true,
        html: '<p>Текст</p>',
      };
      const added = await asAdmin((tx) => adminKbArticleSave(tx, null, input, 0));
      expect(added).toMatchObject({ ok: true, value: { t: 'Новая статья', version: 1 } });
      const id = added.ok ? added.value.id : '';
      const off = await asAdmin((tx) =>
        adminKbArticleSave(tx, id, { ...input, active: false }, 1),
      );
      expect(off).toMatchObject({ ok: true, value: { active: false, version: 2 } });
      expect(await asAdmin((tx) => adminKbArticleSave(tx, id, input, 1))).toEqual({
        ok: false,
        reason: 'changed',
      });
      expect((await asAdmin((tx) => adminKbArticles(tx))).at(-1)).toMatchObject({
        id,
        active: false,
      });
      const history = await asAdmin((tx) => adminKbHistory(tx, 'kbarts', 12));
      expect(history.items.map((h) => [h.action, h.label])).toEqual([
        ['update', 'Новая статья'],
        ['create', 'Новая статья'],
      ]);
      const meta = await asAdmin((tx) => adminKbMeta(tx));
      expect(meta.articles.some((a) => a.id === id)).toBe(true);
      expect(meta.groups.find((g) => g.id === 'adm')).toMatchObject({ adm: true });
      expect(meta.shows.profile).toBeGreaterThan(0);
    });

    it('уровни: меняется один набор, без изменений — ничего не пишется', async () => {
      const levels = (await asAdmin((tx) => adminKbLevels(tx)))!;
      const same = await asAdmin((tx) =>
        adminKbLevelsSave(tx, 'business', levels.business, levels.version),
      );
      expect(same).toMatchObject({ ok: true, value: { changed: false, version: levels.version } });
      const next = levels.business.map((l, j) => (j === 1 ? { n: 'Ученик', p: 30 } : l));
      const saved = await asAdmin((tx) => adminKbLevelsSave(tx, 'business', next, levels.version));
      expect(saved).toMatchObject({ ok: true, value: { changed: true } });
      const now = (await asAdmin((tx) => adminKbLevels(tx)))!;
      expect(now.business[1]).toEqual({ n: 'Ученик', p: 30 });
      expect(now.admin).toEqual(levels.admin);
      expect(await asAdmin((tx) => adminKbLevelsSave(tx, 'admin', levels.admin, levels.version))).toEqual({
        ok: false,
        reason: 'changed',
      });
      const history = await asAdmin((tx) => adminKbHistory(tx, 'kblevels', 12));
      expect(history.items[0]).toMatchObject({
        code: 'business',
        changes: [{ field: '2', from: { n: 'Ученик', p: 25 }, to: { n: 'Ученик', p: 30 } }],
      });
      // Программа организации — с новыми порогами.
      expect((await asOwner((tx) => kbCatalog(tx))).levels.business[1]).toEqual({
        n: 'Ученик',
        p: 30,
      });
    });

    it('список шагов: по порядку программ, поиск и подписи значений', async () => {
      const page = await asAdmin((tx) =>
        listAdminKbPage(tx, 'steps', { sort: undefined, page: 1, size: 'all', filters: {} }, t),
      );
      expect(page.rows[0]!.values).toMatchObject({ n: 1, g: 'Моя организация' });
      const profile = page.rows.find((r) => r.id === 'profile')!;
      expect(profile.values).toMatchObject({
        type: 'kbadm.step.type.do',
        evk: 'kbadm.ev.org.main',
        active: 'kbadm.v.yes',
      });
      const arts = await asAdmin((tx) =>
        listAdminKbPage(
          tx,
          'arts',
          {
            sort: undefined,
            page: 1,
            size: 'all',
            filters: {},
            search: { q: 'Новая статья', keys: ['t'] },
          },
          t,
        ),
      );
      expect(arts.rows.map((r) => r.values.t)).toEqual(['Новая статья']);
    });
  },
);
