import { hashPassword } from '@buhuchet/adapters/password';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { createContractor, type ContractorFields } from './contractors';
import { createOrganization, type CreatedOrganization } from './organizations';
import { seedPermissions, seedRoleTemplates } from './seed';
import { readSpecJson } from './spec-data';
import {
  createTestDatabase,
  databaseAvailable,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(path.join(here, '../migrations/0108_socfund_pay.sql'), 'utf8');

const fields = (patch: Partial<ContractorFields>): ContractorFields => ({
  name: '',
  inn: '',
  phone: '+996505890076',
  kind: 'regular',
  formCode: 'ФС-01',
  regimeCode: 'РЕЖ-01',
  regime2Code: null,
  gked: '47.11.0',
  gkedExtra: [],
  taxOfficeCode: null,
  bizSize: 'small',
  benefits: [],
  bases: ['employees'],
  responsibleEmployeeId: null,
  head: '',
  contact: '',
  contractNo: '',
  contractDate: null,
  note: '',
  registration: {},
  startDate: '2026-01-15',
  firstMonthMode: 'prorate',
  feeDay: 15,
  paysTo: 'emp',
  gkedConfirmation: null,
  socfundFlags: {},
  socfundTariff: null,
  ...patch,
});

/**
 * Миграция 0108 (прототип v82, решение заказчика 09.11.2026): признак «Зарплата только безналично»
 * становится «Выплатой зарплаты» (meta.v82: да — «Только безналично», нет — «Безналично и наличными»,
 * не указан — не указана), у статусов — «Подсказка юрлицу при наличной зарплате», и её правит окно
 * статуса в Админке.
 */
describe.skipIf(!databaseAvailable())(
  'Соцфонд: «Выплата зарплаты» вместо безналичной зарплаты',
  () => {
    let db: TestDatabase;
    let org: CreatedOrganization;
    const ids: Record<string, string> = {};

    const flagsOf = async (id: string) => {
      const [row] = (await db.admin.db.execute(
        sql`select socfund_flags as flags from contractors where id = ${id}`,
      )) as unknown as { flags: Record<string, unknown> }[];
      return row?.flags;
    };

    beforeAll(async () => {
      db = await createTestDatabase();
      const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
      await seedPermissions(db.admin.db, refDB.permissions, { update: false });
      await seedRoleTemplates(db.admin.db, refDB.roleTemplates, { update: false });
      await seedAllPlatformDictionaries(db.admin.db);
      org = await createOrganization(db.app.db, {
        name: 'Организация',
        inn: '01811201810456',
        slug: 'sf-pay',
        owner: {
          fullName: 'Владелец Организации',
          login: 'sf-pay-owner',
          passwordHash: await hashPassword('Bh-4821-temp'),
        },
      });
      // Как до миграции: ограничение признаков без «Выплаты зарплаты», у статусов нет подсказки.
      await db.admin.sql.unsafe(`
      ALTER TABLE contractors DROP CONSTRAINT contractors_socfund_flags_check;
      ALTER TABLE contractors ADD CONSTRAINT contractors_socfund_flags_check CHECK (true);
      ALTER TABLE tax_benefits DROP COLUMN cash_hint;
      UPDATE app.platform_dict_specs SET columns = array_remove(columns, 'cash_hint') WHERE dict = 'benefits';
    `);
      const flags: Record<string, Record<string, boolean>> = {
        yes: { cashless: true, registry: true, confirmed: true, gov: false },
        no: { cashless: false, registry: true },
        none: { registry: false },
        empty: {},
      };
      let n = 0;
      for (const [key, f] of Object.entries(flags)) {
        ids[key] = await withOrgContext(
          db.app.db,
          { orgId: org.orgId, userId: org.ownerUserId },
          (tx) =>
            createContractor(
              tx,
              org.orgId,
              fields({
                name: `ОсОО «${key}»`,
                inn: `0374409740${String(n++).padStart(4, '0')}`,
                socfundFlags: f as never,
              }),
              null,
            ),
        );
      }
    });

    afterAll(async () => {
      await db?.drop();
    });

    it('да — «Только безналично», нет — «Безналично и наличными», без признака — не указано; другие признаки не трогает', async () => {
      await db.admin.sql.unsafe(MIGRATION);
      expect(await flagsOf(ids.yes!)).toEqual({
        pay: 'card',
        registry: true,
        confirmed: true,
        gov: false,
      });
      expect(await flagsOf(ids.no!)).toEqual({ pay: 'mixed', registry: true });
      expect(await flagsOf(ids.none!)).toEqual({ registry: false });
      expect(await flagsOf(ids.empty!)).toEqual({});
    });

    it('после миграции: прежнего признака нет, «Выплата зарплаты» — только card, mixed или cash', async () => {
      const set = (flags: unknown) =>
        db.admin.db.execute(
          sql`update contractors set socfund_flags = ${JSON.stringify(flags)}::jsonb where id = ${ids.empty!}`,
        );
      await expect(set({ pay: 'cash', registry: true })).resolves.toBeTruthy();
      for (const bad of [{ cashless: true }, { pay: 'card2' }, { pay: null }, { pay: 1 }]) {
        await expect(set(bad)).rejects.toEqual(
          expect.objectContaining({
            cause: expect.objectContaining({ constraint_name: 'contractors_socfund_flags_check' }),
          }),
        );
      }
    });

    it('у статусов — подсказка о наличной зарплате (пусто по умолчанию), её правит окно статуса', async () => {
      const [col] = (await db.admin.db.execute(
        sql`select column_default as def, is_nullable as nullable from information_schema.columns
        where table_name = 'tax_benefits' and column_name = 'cash_hint'`,
      )) as unknown as { def: string; nullable: string }[];
      expect(col).toEqual({ def: "''::text", nullable: 'NO' });
      const [spec] = (await db.admin.db.execute(
        sql`select columns from app.platform_dict_specs where dict = 'benefits'`,
      )) as unknown as { columns: string[] }[];
      expect(spec!.columns.filter((c) => c === 'cash_hint')).toEqual(['cash_hint']);
    });
  },
);
