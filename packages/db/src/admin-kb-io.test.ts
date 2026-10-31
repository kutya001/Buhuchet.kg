import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ioNewValue, type IoValue, type IsoDate, type KbIoDict } from '@buhuchet/domain';
import type { IoRecord } from './admin-dict-io';
import { readReference } from './admin-gked';
import { SECTION_WRITERS } from './admin-io-sections';
import {
  adminKbArticles,
  adminKbHistory,
  adminKbShow,
  adminKbShowAuto,
  adminKbShowSave,
  adminKbSteps,
  listAdminKbPage,
} from './admin-kb';
import { withUserContext } from './auth';
import type { Tx } from './client';
import { withOrgContext } from './context';
import { kbCatalog } from './kb';
import { newsAdminHistory } from './news';
import { createOrganization, type CreatedOrganization } from './organizations';
import { writePlatformHistory } from './platform-history';
import { users } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedKbReference,
  type TestDatabase,
} from './testing';

const TODAY = '2026-10-31' as IsoDate;

describe.skipIf(!databaseAvailable())(
  'Админка → «База знаний (содержимое)»: «Показы» и строки файлов Excel (задача 2.39, часть 2)',
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
    const records = (dict: KbIoDict) => asAdmin((tx) => SECTION_WRITERS[dict].records(tx, TODAY));
    const record = async (dict: KbIoDict, code: string) =>
      (await records(dict)).find((r) => r.code === code);
    /** Строка файла поверх значения: как `ioMerge` — поля из файла поверх прежних. */
    const row = (base: IoRecord | IoValue, patch: Partial<IoValue> & { data?: object }) => ({
      code: base.code,
      name: patch.name ?? base.name,
      active: patch.active ?? base.active,
      data: { ...base.data, ...patch.data },
    });
    const save = (dict: KbIoDict, value: IoValue, base?: IoRecord) =>
      asAdmin((tx) => SECTION_WRITERS[dict].save(tx, value, base, TODAY));
    const rawShow = async (id: string) =>
      (
        (await asAdmin((tx) => readReference(tx, 'kbShows')))!.payload as {
          id: string;
          active?: boolean;
          items: Record<string, unknown>[];
        }[]
      ).find((h) => h.id === id);

    it('свой сценарий: новый, правка текстов с порядком, «Вернуть автоматический»; история', async () => {
      const none = await asAdmin((tx) => adminKbShow(tx, 'remind'));
      expect(none).toMatchObject({
        own: false,
        active: true,
        version: 0,
        items: [{ auto: 'screen', t: '', x: '' }],
      });
      expect(none!.fin.t).not.toBe('');
      const created = await asAdmin((tx) =>
        adminKbShowSave(
          tx,
          'remind',
          { active: true, items: [{ auto: 'screen' }, { t: ' Напоминания ', x: 'Текст' }] },
          0,
        ),
      );
      expect(created).toMatchObject({
        ok: true,
        value: { own: true, version: 1, items: [{ auto: 'screen' }, { t: 'Напоминания' }] },
      });
      expect((await rawShow('sh-remind'))!.items).toEqual([
        { auto: 'screen' },
        { t: 'Напоминания', x: 'Текст' },
      ]);
      // Чужая версия — changed; облачко без заголовка — отказ с номером облачка.
      expect(
        await asAdmin((tx) => adminKbShowSave(tx, 'remind', { active: true, items: [] }, 0)),
      ).toEqual({ ok: false, reason: 'changed' });
      expect(
        await asAdmin((tx) =>
          adminKbShowSave(tx, 'remind', { active: true, items: [{ from: 0 }, { t: ' ' }] }, 1),
        ),
      ).toEqual({ ok: false, reason: 'invalid', problem: 'kb_show_title', index: 1 });
      // Порядок по прежним номерам; что подсвечивает облачко, сохраняется.
      const profile = (await asAdmin((tx) => adminKbShow(tx, 'profile')))!;
      const moved = await asAdmin((tx) =>
        adminKbShowSave(
          tx,
          'profile',
          {
            active: false,
            items: [
              { from: 2, t: 'Сохранить', x: profile.items[2]!.x, common: true },
              { from: 1 },
              { from: 0, t: profile.items[0]!.t, x: 'Новый текст' },
            ],
          },
          profile.version,
        ),
      );
      expect(moved).toMatchObject({ ok: true, value: { active: false } });
      const raw = (await rawShow('sh-profile'))!;
      expect(raw.active).toBe(false);
      expect(raw.items[0]).toMatchObject({ s: '#og-save', t: 'Сохранить', common: true });
      expect(raw.items[1]).toEqual({ auto: 'fields', in: '#mbody' });
      expect(raw.items[2]).toMatchObject({ s: '#mbody .box', x: 'Новый текст' });
      // Без изменений — без записи.
      const same = await asAdmin((tx) =>
        adminKbShowSave(
          tx,
          'profile',
          {
            active: false,
            items: [
              { from: 0, t: 'Сохранить', x: profile.items[2]!.x, common: true },
              { from: 1 },
              { from: 2, t: profile.items[0]!.t, x: 'Новый текст' },
            ],
          },
          profile.version + 1,
        ),
      );
      expect(same).toMatchObject({ ok: true, value: { version: profile.version + 1 } });
      // Сотрудник организации сценарий не пишет: функция базы отвечает пусто.
      expect(
        await asOwner((tx) =>
          adminKbShowSave(tx, 'remind', { active: false, items: [{ auto: 'screen' }] }, 1),
        ),
      ).toEqual({ ok: false, reason: 'changed' });
      expect((await rawShow('sh-remind'))!.active).toBe(true);
      expect(await asAdmin((tx) => adminKbShowAuto(tx, 'remind', 2))).toEqual({
        ok: false,
        reason: 'changed',
      });
      expect(await asAdmin((tx) => adminKbShowAuto(tx, 'remind', 1))).toMatchObject({
        ok: true,
        value: { own: false, version: 0 },
      });
      expect(await rawShow('sh-remind')).toBeUndefined();
      const history = await asAdmin((tx) => adminKbHistory(tx, 'kbshows', 12));
      expect(history.items.map((h) => [h.code, h.action, h.label])).toEqual([
        ['remind', 'delete', expect.any(String)],
        ['profile', 'update', expect.any(String)],
        ['remind', 'create', expect.any(String)],
      ]);
      expect(history.items[1]!.changes.map((c) => c.field)).toEqual(['n', 'active', 'items']);
      // Сценарий шага администратора платформы не заводится.
      expect(
        await asAdmin((tx) =>
          adminKbShowSave(tx, 'a-dicts', { active: true, items: [{ auto: 'screen' }] }, 0),
        ),
      ).toEqual({ ok: false, reason: 'not_found' });
    });

    it('список «Показы»: шаги программы организаций, свой сценарий — с числом облачков', async () => {
      const page = await asAdmin((tx) =>
        listAdminKbPage(
          tx,
          'shows',
          { sort: undefined, page: 1, size: 'all', filters: {} },
          (k) => k,
        ),
      );
      const profile = page.rows.find((r) => r.id === 'profile')!;
      expect(profile).toMatchObject({ own: true, values: { n: 3, sc: 'kbadm.v.sc.own' } });
      const remind = page.rows.find((r) => r.id === 'remind')!;
      expect(remind).toMatchObject({ own: false, version: 0, values: { sc: 'kbadm.v.sc.auto' } });
      expect(page.rows.some((r) => r.id === 'a-dicts')).toBe(false);
    });

    it('шаги в файле: новый с кодом и порядком, правка порядка; проверки окна; откат убирает шаг', async () => {
      const profile = (await record('kbsteps', 'profile'))!;
      expect(profile.data).toMatchObject({ g: 'org', learn: 'do', mod: '' });
      const fresh = ioNewValue('kbsteps', 'my-step');
      const value = row(fresh, {
        name: 'Мой шаг',
        data: { g: 'cps', learn: 'look', evk: 'open', ord: 500, mod: 'cps' },
      });
      const noMod = await save('kbsteps', row(value, { data: { mod: '' } }));
      expect(noMod).toEqual({
        ok: false,
        fail: { key: 'kbadm.io.err.step_mod', col: 'kbadm.io.col.go' },
      });
      const noTitle = await save('kbsteps', row(value, { name: ' ' }));
      expect(noTitle).toEqual({
        ok: false,
        fail: { key: 'kbadm.err.kb_title_required', col: 'kbadm.col.title' },
      });
      // ОТКЛОНЕНИЕ: docs/deviations.md#Д-25 — у нового шага событие, которое ещё не отмечает шаги.
      const notWorking = await save('kbsteps', row(value, { data: { evk: 'p.new' } }));
      expect(notWorking).toEqual({
        ok: false,
        fail: { key: 'kbadm.io.err.step_event', col: 'kbadm.col.evk' },
      });
      const added = await save('kbsteps', value);
      expect(added).toMatchObject({
        ok: true,
        record: { code: 'my-step', name: 'Мой шаг', data: { ord: 500, mod: 'cps' } },
      });
      expect(
        (await asAdmin((tx) => adminKbSteps(tx))).find((s) => s.id === 'my-step'),
      ).toMatchObject({ isNew: true, mod: 'cps', learn: true });
      expect(await save('kbsteps', value)).toEqual({ ok: false, fail: 'changed' });
      const base = (await record('kbsteps', 'profile'))!;
      const moved = await save('kbsteps', row(base, { data: { ord: 77, w: 'Зачем' } }), base);
      expect(moved).toMatchObject({ ok: true, record: { data: { ord: 77, w: 'Зачем' } } });
      const line = (await asAdmin((tx) => adminKbHistory(tx, 'kbsteps', 1))).items[0]!;
      expect(line.changes.map((c) => c.field).sort()).toEqual(['ord', 'w']);
      // Шаг программы организаций виден с новым порядком.
      expect((await asOwner((tx) => kbCatalog(tx))).steps.some((s) => s.id === 'my-step')).toBe(
        true,
      );
      const now = (await record('kbsteps', 'my-step'))!;
      expect(await asAdmin((tx) => SECTION_WRITERS.kbsteps.remove(tx, now, TODAY))).toEqual({
        ok: true,
      });
      expect(await record('kbsteps', 'my-step')).toBeUndefined();
      const removed = (await asAdmin((tx) => adminKbHistory(tx, 'kbsteps', 1))).items[0]!;
      expect(removed).toMatchObject({ code: 'my-step', action: 'delete', label: 'Мой шаг' });
    });

    it('статьи в файле: новая с кодом; откат удаляет её, а статью шага — отключает', async () => {
      const value = row(ioNewValue('kbarts', 'my-art'), {
        name: 'Моя статья',
        data: { sec: 'Модули', mod: 'cps', aud: 'biz', html: '<p>Текст</p>' },
      });
      expect(await save('kbarts', row(value, { data: { sec: '' } }))).toEqual({
        ok: false,
        fail: { key: 'kbadm.err.kb_section_required', col: 'kbadm.col.sec' },
      });
      expect(await save('kbarts', value)).toMatchObject({
        ok: true,
        record: { code: 'my-art', name: 'Моя статья', active: true },
      });
      expect(await save('kbarts', { ...value, code: 'my-art2' })).toMatchObject({ ok: true });
      // Статья шага: шаг ссылается на неё.
      const step = (await record('kbsteps', 'profile'))!;
      expect(await save('kbsteps', row(step, { data: { art: 'my-art2' } }), step)).toMatchObject({
        ok: true,
      });
      const remove = async (code: string) =>
        asAdmin(async (tx) =>
          SECTION_WRITERS.kbarts.remove(
            tx,
            (await SECTION_WRITERS.kbarts.records(tx, TODAY)).find((r) => r.code === code)!,
            TODAY,
          ),
        );
      expect(await remove('my-art')).toEqual({ ok: true });
      expect(await remove('my-art2')).toEqual({ ok: true });
      const arts = await asAdmin((tx) => adminKbArticles(tx));
      expect(arts.some((a) => a.id === 'my-art')).toBe(false);
      expect(arts.find((a) => a.id === 'my-art2')).toMatchObject({ active: false });
    });

    it('показы в файле: облачко — строка; новое — только следующим номером своего сценария', async () => {
      const clouds = (await records('kbshows')).filter((r) => r.code.startsWith('sh-policy#'));
      expect(clouds.map((r) => r.code)).toEqual([
        'sh-policy#1',
        'sh-policy#2',
        'sh-policy#3',
        'sh-policy#4',
      ]);
      expect(clouds[3]).toMatchObject({ data: { auto: 'boxes', t: '', x: '' } });
      expect(clouds[0]!.data).toMatchObject({ what: { s: 'el', auto: null } });
      // Правка текста облачка — что подсвечивает, сохраняется.
      const edited = await save(
        'kbshows',
        row(clouds[1]!, { data: { t: 'Строка функции', common: true } }),
        clouds[1],
      );
      expect(edited).toMatchObject({
        ok: true,
        record: { code: 'sh-policy#2', data: { t: 'Строка функции', common: true } },
      });
      expect((await rawShow('sh-policy'))!.items[1]).toMatchObject({
        s: '#mbody [data-feat-row]',
        t: 'Строка функции',
        common: true,
      });
      // У «Автоматически» текстов нет — меняется только «Сценарий активен».
      const auto = (await record('kbshows', 'sh-policy#4'))!;
      expect(
        await save('kbshows', row(auto, { active: false, data: { t: 'Лишнее' } }), auto),
      ).toMatchObject({ ok: true, record: { active: false, data: { t: '' } } });
      expect((await rawShow('sh-policy'))!.items[3]).toEqual({ auto: 'boxes' });
      const later = row(ioNewValue('kbshows', 'sh-policy#9'), { data: { t: '', x: '' } });
      expect(await save('kbshows', { ...later, code: 'sh-nope#1' })).toEqual({
        ok: false,
        fail: { key: 'kbadm.io.err.show_none', params: { id: 'sh-nope' } },
      });
      expect(await save('kbshows', later)).toEqual({
        ok: false,
        fail: { key: 'kbadm.err.kb_show_title' },
      });
      // Новое облачко — в конец сценария, какой бы номер ни стоял в файле (прототип DX.kbshows.add).
      const added = await save('kbshows', { ...later, data: { ...later.data, t: 'Пятое' } });
      expect(added).toMatchObject({
        ok: true,
        record: { code: 'sh-policy#5', data: { t: 'Пятое' } },
      });
      const now = (await record('kbshows', 'sh-policy#5'))!;
      expect(await asAdmin((tx) => SECTION_WRITERS.kbshows.remove(tx, now, TODAY))).toEqual({
        ok: true,
      });
      expect((await rawShow('sh-policy'))!.items).toHaveLength(4);
    });

    it('новости в файле: новая — черновик с кодом; проверка окна; история — со строкой загрузки', async () => {
      const value = row(ioNewValue('kbnews', 'n-excel'), {
        name: 'Из Excel',
        data: {
          type: 'announce',
          date: '2026-11-02',
          aud: 'all',
          short: 'Кратко',
          md: '## Что нового\nТекст',
          showOnLogin: true,
        },
      });
      expect(await save('kbnews', row(value, { data: { short: '' } }))).toEqual({
        ok: false,
        fail: { key: 'err.news_short_required', col: 'kbadm.io.col.short' },
      });
      expect(await save('kbnews', value)).toMatchObject({
        ok: true,
        record: { code: 'n-excel', data: { status: 'draft', release: '' } },
      });
      const base = (await record('kbnews', 'n-excel'))!;
      expect(
        await save('kbnews', row(base, { data: { release: '2.0', pinned: true } }), base),
      ).toMatchObject({ ok: true, record: { data: { release: '2.0', pinned: true } } });
      await asAdmin((tx) =>
        writePlatformHistory(tx, {
          entity: 'platform_dict',
          entityId: 'kbnews:',
          action: 'import',
          changes: [
            { field: 'added', to: 1 },
            { field: 'changed', to: 1 },
            { field: 'disabled', to: 0 },
          ],
        }),
      );
      const history = await asAdmin((tx) => newsAdminHistory(tx));
      expect(history.items[0]).toMatchObject({
        kind: 'import',
        counts: { added: 1, changed: 1, disabled: 0 },
      });
      expect(history.items[1]).toMatchObject({ kind: 'draft_saved', title: 'Из Excel' });
      const now = (await record('kbnews', 'n-excel'))!;
      expect(await asAdmin((tx) => SECTION_WRITERS.kbnews.remove(tx, now, TODAY))).toEqual({
        ok: true,
      });
      expect(await record('kbnews', 'n-excel')).toBeUndefined();
    });
  },
);
