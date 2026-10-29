import { UI_TEXTS, type ListQuery } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getDictLoad,
  insertDictLoad,
  ioRecords,
  ioRefs,
  listDictLoadsPage,
  listDictLoadValues,
  rollbackDictLoad,
} from './admin-dict-io';
import { adminDictCreate, adminDictUpdate } from './admin-platform-dicts';
import { withUserContext } from './auth';
import type { Tx } from './client';
import { withOrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import { dictLoads, taskCategories, users } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const t = (key: string) => (UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key;
const query = (patch: Partial<ListQuery> = {}): ListQuery =>
  ({ sort: undefined, page: 1, size: 'all', filters: {}, ...patch }) as ListQuery;

const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});

describe.skipIf(!databaseAvailable())(
  'Админка → «Справочники платформы» → «Загрузки»: только администратор платформы',
  () => {
    let db: TestDatabase;
    let org: CreatedOrganization;
    let adminId: string;

    beforeAll(async () => {
      db = await createTestDatabase();
      await seedAccessReference(db.admin.db);
      await seedAllPlatformDictionaries(db.admin.db);
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

    it('подписи ссылок: повторяющееся краткое название вида отчёта — кодом', async () => {
      const refs = await asAdmin((tx) => ioRefs(tx));
      expect(refs.types.find((x) => x.code === 'nds')).toMatchObject({ label: 'НДС' });
      const labels = refs.types.map((x) => x.label.toLowerCase());
      expect(new Set(labels).size).toBe(labels.length);
      expect(refs.organs.find((x) => x.label === 'ГНС')).toBeTruthy();
      const nds = (await asAdmin((tx) => ioRecords(tx, 'types'))).find((x) => x.code === 'nds');
      expect(nds).toMatchObject({ name: expect.any(String), active: true, version: 1 });
    });

    it('загрузку пишет, видит и откатывает только администратор; удалить и поправить числа нельзя', async () => {
      const input = {
        dict: 'cats' as const,
        rows: 3,
        errors: 1,
        changed: 0,
        disabled: 0,
        before: [],
        added: [],
      };
      await expect(asOwner((tx) => insertDictLoad(tx, input))).rejects.toThrow();
      const id = await asAdmin((tx) => insertDictLoad(tx, input));
      expect(await asOwner((tx) => tx.select().from(dictLoads))).toEqual([]);
      expect(await asOwner((tx) => getDictLoad(tx, id))).toBeNull();
      await expect(
        asAdmin((tx) => tx.update(dictLoads).set({ rows: 99 }).where(eq(dictLoads.id, id))),
      ).rejects.toEqual(permissionDenied);
      await expect(
        asAdmin((tx) => tx.delete(dictLoads).where(eq(dictLoads.id, id))),
      ).rejects.toEqual(permissionDenied);
      // Подставить другого «кто откатил» политика не даёт.
      await expect(
        asAdmin((tx) =>
          tx
            .update(dictLoads)
            .set({ rolledBackAt: sql`now()`, rolledBackBy: org.ownerUserId })
            .where(eq(dictLoads.id, id)),
        ),
      ).rejects.toThrow();
      expect(await asOwner((tx) => rollbackDictLoad(tx, id))).toEqual({
        ok: false,
        reason: 'not_found',
      });
      const page = await asAdmin((tx) => listDictLoadsPage(tx, query(), t));
      expect(page.rows[0]).toMatchObject({ id, dict: 'cats', rows: 3, errors: 1, last: true });
      expect(page.rows[0]!.by).toBe('Администратор платформы');
      const values = await asAdmin((tx) => listDictLoadValues(tx, 'dict', t));
      expect(values.items.map((v) => v.label)).toEqual(['Категории задач']);
      const done = await asAdmin((tx) => rollbackDictLoad(tx, id));
      expect(done).toMatchObject({ ok: true, load: { last: false } });
      const rolled = await asAdmin((tx) => listDictLoadsPage(tx, query(), t));
      expect(rolled.rows[0]!.rolledBackAt).toBeInstanceOf(Date);
    });

    it('откат: изменённые — к виду до загрузки, добавленные — удаляются; только последнюю', async () => {
      const [cat] = await db.admin.db
        .select()
        .from(taskCategories)
        .where(eq(taskCategories.active, true))
        .limit(1);
      const load = await asAdmin(async (tx) => {
        const saved = await adminDictUpdate(
          tx,
          'cats',
          cat!.code,
          { name: cat!.name, data: { note: 'Из Excel' } },
          cat!.version,
        );
        const created = await adminDictCreate(
          tx,
          'cats',
          { name: 'Из файла', data: { note: '' } },
          () => 'x',
          'КАТ-777',
        );
        if (!saved.ok || !created.ok) throw new Error('не сохранено');
        return insertDictLoad(tx, {
          dict: 'cats',
          rows: 2,
          errors: 0,
          changed: 1,
          disabled: 0,
          before: [
            {
              code: cat!.code,
              name: cat!.name,
              active: true,
              data: { note: cat!.note },
              version: saved.record.version,
            },
          ],
          added: [{ code: 'КАТ-777', version: created.record.version }],
        });
      });
      const older = await asAdmin((tx) =>
        insertDictLoad(tx, {
          dict: 'cats',
          rows: 1,
          errors: 0,
          changed: 0,
          disabled: 0,
          before: [],
          added: [],
        }),
      );
      expect(await asAdmin((tx) => rollbackDictLoad(tx, load))).toEqual({
        ok: false,
        reason: 'not_last',
      });
      await asAdmin((tx) => rollbackDictLoad(tx, older));
      expect(await asAdmin((tx) => rollbackDictLoad(tx, load))).toMatchObject({ ok: true });
      const [after] = await db.admin.db
        .select()
        .from(taskCategories)
        .where(eq(taskCategories.code, cat!.code));
      expect(after!.note).toBe(cat!.note);
      expect(
        await db.admin.db.select().from(taskCategories).where(eq(taskCategories.code, 'КАТ-777')),
      ).toEqual([]);
    });
  },
);
