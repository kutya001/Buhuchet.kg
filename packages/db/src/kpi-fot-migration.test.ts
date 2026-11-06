import { hashPassword } from '@buhuchet/adapters/password';
import { and, asc, eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrganization, type CreatedOrganization } from './organizations';
import { indicators } from './schema';
import { seedPermissions, seedRoleTemplates } from './seed';
import { readSpecJson } from './spec-data';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(
  path.join(here, '../migrations/0090_indicator_fot_default.sql'),
  'utf8',
);

/**
 * Миграция 0090 (решение заказчика 06.11.2026, прототип v74): организациям, созданным раньше, — «ФОТ»,
 * если нет показателя «ФОТ» или «Фонд оплаты труда»; повтор ничего не добавляет.
 */
describe.skipIf(!databaseAvailable())('Показатели: «ФОТ» организациям, созданным раньше', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let c: CreatedOrganization;

  const names = async (orgId: string) =>
    (
      await db.admin.db
        .select({ name: indicators.name, order: indicators.sortOrder })
        .from(indicators)
        .where(eq(indicators.orgId, orgId))
        .orderBy(asc(indicators.sortOrder))
    ).map((i) => `${i.order}. ${i.name}`);

  beforeAll(async () => {
    db = await createTestDatabase();
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    await seedPermissions(db.admin.db, refDB.permissions, { update: false });
    await seedRoleTemplates(db.admin.db, refDB.roleTemplates, { update: false });
    const org = async (n: number) =>
      createOrganization(db.app.db, {
        name: `Организация ${n}`,
        inn: `0${n}811201810456`,
        slug: `fot-${n}`,
        owner: {
          fullName: 'Владелец Организации',
          login: `fot-owner-${n}`,
          passwordHash: await hashPassword('Bh-4821-temp'),
        },
        today: '2026-01-15',
      });
    [a, b, c] = [await org(1), await org(2), await org(3)];
    // Как до 06.11.2026: у А — только «Выручка» и «Количество сотрудников»; у Б свой «Фонд оплаты труда»
    // в архиве, у В — «фот» строчными.
    await db.admin.db
      .delete(indicators)
      .where(and(eq(indicators.name, 'ФОТ'), eq(indicators.orgId, a.orgId)));
    await db.admin.db
      .update(indicators)
      .set({ name: 'Фонд оплаты труда', archived: true })
      .where(and(eq(indicators.name, 'ФОТ'), eq(indicators.orgId, b.orgId)));
    await db.admin.db
      .update(indicators)
      .set({ name: ' фот ' })
      .where(and(eq(indicators.name, 'ФОТ'), eq(indicators.orgId, c.orgId)));
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('у кого нет «ФОТ» или «Фонда оплаты труда» — добавляется последним, «Вести с» — текущий месяц; повтор ничего не меняет', async () => {
    await db.admin.sql.unsafe(MIGRATION);
    await db.admin.sql.unsafe(MIGRATION);
    expect(await names(a.orgId)).toEqual(['1. Выручка', '2. Количество сотрудников', '3. ФОТ']);
    expect(await names(b.orgId)).toEqual([
      '1. Выручка',
      '2. Количество сотрудников',
      '3. Фонд оплаты труда',
    ]);
    expect(await names(c.orgId)).toEqual(['1. Выручка', '2. Количество сотрудников', '3.  фот ']);
    const [fot] = await db.admin.db
      .select()
      .from(indicators)
      .where(and(eq(indicators.name, 'ФОТ'), eq(indicators.orgId, a.orgId)));
    const now = new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 7);
    expect(fot).toMatchObject({
      unit: 'сом',
      type: 'som',
      total: 'sum',
      required: true,
      dueDay: 10,
      scope: 'all',
      autoNew: true,
      archived: false,
      startMonth: now,
      description:
        'Фонд оплаты труда: начисленная зарплата всех сотрудников за месяц до удержаний.',
    });
  });
});
