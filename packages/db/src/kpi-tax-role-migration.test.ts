import { hashPassword } from '@buhuchet/adapters/password';
import { asc, eq } from 'drizzle-orm';
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
  path.join(here, '../migrations/0110_indicator_tax_role_init.sql'),
  'utf8',
);

/**
 * Миграция 0110 (прототип v80, миграция v80 в core/data.js): отметки «Для расчёта налогов» показателям
 * организаций, созданных раньше, — по названию и типу значения; организацию, у которой отметка уже есть,
 * миграция не трогает; повтор ничего не меняет.
 */
describe.skipIf(!databaseAvailable())(
  'Показатели: отметки «Для расчёта налогов» прежним организациям',
  () => {
    let db: TestDatabase;
    let a: CreatedOrganization;
    let b: CreatedOrganization;
    let c: CreatedOrganization;

    const roles = async (orgId: string) =>
      (
        await db.admin.db
          .select({ name: indicators.name, role: indicators.taxRole, version: indicators.version })
          .from(indicators)
          .where(eq(indicators.orgId, orgId))
          .orderBy(asc(indicators.sortOrder))
      ).map((i) => `${i.name}: ${i.role ?? '—'} v${i.version}`);

    const insert = (orgId: string, name: string, type: 'som' | 'int' | 'pct', order: number) =>
      db.admin.db.insert(indicators).values({
        orgId,
        name,
        unit: type === 'int' ? 'чел.' : type === 'pct' ? '%' : 'сом',
        type,
        startMonth: '2026-01',
        sortOrder: order,
      });

    beforeAll(async () => {
      db = await createTestDatabase();
      const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
      await seedPermissions(db.admin.db, refDB.permissions, { update: false });
      await seedRoleTemplates(db.admin.db, refDB.roleTemplates, { update: false });
      const org = async (n: number) =>
        createOrganization(db.app.db, {
          name: `Организация ${n}`,
          inn: `0${n}811201810456`,
          slug: `tax-role-${n}`,
          owner: {
            fullName: 'Владелец Организации',
            login: `tax-role-owner-${n}`,
            passwordHash: await hashPassword('Bh-4821-temp'),
          },
          today: '2026-01-15',
        });
      [a, b, c] = [await org(1), await org(2), await org(3)];
      // Как до v80: отметок нет. У А — показатели по умолчанию и ещё одна «Выручка от экспорта» (вторая по
      // порядку — отметку получает первая); у Б — свои названия, архивная «Выручка», «Численность» процентом
      // и подходящая «Численность штата»; у В одна отметка уже стоит — миграция организацию не трогает.
      await db.admin.db.update(indicators).set({ taxRole: null });
      await insert(a.orgId, 'Выручка от экспорта', 'som', 4);
      await db.admin.db.delete(indicators).where(eq(indicators.orgId, b.orgId));
      await insert(b.orgId, 'Выручка', 'som', 1).then(() =>
        db.admin.db.update(indicators).set({ archived: true }).where(eq(indicators.orgId, b.orgId)),
      );
      await insert(b.orgId, ' ВЫРУЧКА без НДС', 'som', 2);
      await insert(b.orgId, 'Фонд оплаты труда', 'som', 3);
      await insert(b.orgId, 'ФОТ руководства', 'som', 4);
      await insert(b.orgId, 'Численность', 'pct', 5);
      await insert(b.orgId, 'Численность штата', 'int', 6);
      await db.admin.db
        .update(indicators)
        .set({ taxRole: 'fot' })
        .where(eq(indicators.id, (await idOf(c.orgId, 'ФОТ'))!));
    });

    const idOf = async (orgId: string, name: string) =>
      (
        await db.admin.db
          .select({ id: indicators.id, name: indicators.name })
          .from(indicators)
          .where(eq(indicators.orgId, orgId))
      ).find((i) => i.name === name)?.id;

    afterAll(async () => {
      await db?.drop();
    });

    it('первый действующий показатель с подходящим названием и типом получает роль; где отметка уже есть — без изменений; повтор ничего не меняет', async () => {
      await db.admin.sql.unsafe(MIGRATION);
      await db.admin.sql.unsafe(MIGRATION);
      expect(await roles(a.orgId)).toEqual([
        'Выручка: rev v2',
        'Количество сотрудников: emp v2',
        'ФОТ: fot v2',
        'Выручка от экспорта: — v1',
      ]);
      expect(await roles(b.orgId)).toEqual([
        'Выручка: — v1',
        ' ВЫРУЧКА без НДС: rev v2',
        'Фонд оплаты труда: fot v2',
        'ФОТ руководства: — v1',
        'Численность: — v1',
        'Численность штата: emp v2',
      ]);
      expect(await roles(c.orgId)).toEqual([
        'Выручка: — v1',
        'Количество сотрудников: — v1',
        'ФОТ: fot v1',
      ]);
    });
  },
);
