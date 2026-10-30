import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminEnRateGked,
  adminEnRates,
  adminGkedGroups,
  adminGkedGroupSave,
  adminMarkGns,
  readReference,
  saveReference,
} from './admin-gked';
import { adminSectionHistory } from './admin-io-sections';
import { withUserContext } from './auth';
import type { Tx } from './client';
import { withOrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import { platformReference, users } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

describe.skipIf(!databaseAvailable())(
  'Админка → «ГКЭД» и разделы справочника: пишет только администратор платформы',
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

    it('сотрудник организации не меняет разделы, календарь и сверку с ГНС — функции базы отвечают пусто', async () => {
      const ref = await asAdmin((tx) => readReference(tx, 'gkedGroups'));
      expect(ref).toBeTruthy();
      expect(await asOwner((tx) => saveReference(tx, 'gkedGroups', {}, ref!.version))).toBeNull();
      expect(await asOwner((tx) => adminMarkGns(tx, ['nds']))).toBe(0);
      const [day] = await asOwner((tx) =>
        tx.execute<{ v: number | null }>(
          sql`select app.admin_calendar_update('2026-01-01', 'holiday', 'Взлом', 1) as v`,
        ),
      );
      expect(day?.v ?? null).toBeNull();
      // Прямо в таблицу: разделы только для чтения (RLS), строки не меняются.
      expect(
        await asOwner((tx) =>
          tx
            .update(platformReference)
            .set({ payload: {} })
            .returning({ key: platformReference.key }),
        ),
      ).toEqual([]);
      expect(
        await asOwner((tx) =>
          tx.execute(sql`update gked_items set name = 'Взлом' where code = 'A' returning code`),
        ),
      ).toHaveLength(0);
      // Раздел, которого нет в перечне, не пишет и администратор.
      const [other] = await asAdmin((tx) =>
        tx.execute<{ v: number | null }>(
          sql`select app.admin_set_reference('gked', '{}'::jsonb, 'x', 1) as v`,
        ),
      );
      expect(other?.v ?? null).toBeNull();
      expect((await asAdmin((tx) => readReference(tx, 'gkedGroups')))!.version).toBe(ref!.version);
    });

    it('группа без изменений не пишет историю; удаление группы убирает её коды из перечней', async () => {
      const before = await asAdmin((tx) => adminGkedGroups(tx));
      const cell = before.items.find((g) => g.codes.includes('61.20'))!;
      const same = await asAdmin((tx) =>
        adminGkedGroupSave(tx, cell.id, { ...cell }, before.version),
      );
      expect(same.ok).toBe(true);
      const h1 = await asAdmin((tx) => adminSectionHistory(tx, ['gkgroups'], 10, '2026-10-30'));
      expect(h1.total).toBe(0);

      const after = await asAdmin((tx) => adminGkedGroups(tx));
      const removed = await asAdmin((tx) => adminGkedGroupSave(tx, cell.id, null, after.version));
      expect(removed.ok).toBe(true);
      const regime = before.targets.en.find((x) => x.kind === 'regime')!;
      const [rule] = await asAdmin((tx) =>
        tx.execute<{ gked: { ex: string[] } }>(
          sql`select gked from tax_regimes where code = ${regime.code}`,
        ),
      );
      expect(rule!.gked.ex).not.toContain('61.20');
      const h2 = await asAdmin((tx) => adminSectionHistory(tx, ['gkgroups'], 10, '2026-10-30'));
      expect(h2.items[0]).toMatchObject({
        section: 'gkgroups',
        code: cell.id,
        action: 'delete',
        label: cell.name,
      });
    });

    it('ставка ЕН: пустой перечень — без правила; повтор той же правки — без записи в историю', async () => {
      const [rate] = await asAdmin((tx) => adminEnRates(tx, 'ЕНС-02'));
      const cleared = await asAdmin((tx) =>
        adminEnRateGked(tx, 'ЕНС-02', { in: [], ex: [] }, rate!.version),
      );
      expect(cleared).toMatchObject({ ok: true, record: { gked: null } });
      const again = await asAdmin((tx) =>
        adminEnRateGked(
          tx,
          'ЕНС-02',
          { in: [], ex: [] },
          (cleared as { record: { version: number } }).record.version,
        ),
      );
      expect(again.ok).toBe(true);
      const h = await asAdmin((tx) => adminSectionHistory(tx, ['enrates'], 10, '2026-10-30'));
      expect(h.total).toBe(1);
      expect(h.items[0]).toMatchObject({ code: 'ЕНС-02', label: rate!.activity });
    });
  },
);
