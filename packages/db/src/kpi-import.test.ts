import { hashPassword } from '@buhuchet/adapters/password';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from './context';
import { importFileName, insertIndicatorImport, listIndicatorImports } from './kpi-import';
import { createOrganization, type CreatedOrganization } from './organizations';
import { indicatorImports } from './schema';
import { seedPermissions, seedRoleTemplates } from './seed';
import { readSpecJson } from './spec-data';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

const rlsViolation = expect.objectContaining({
  cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }),
});
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ message: expect.stringMatching(/permission denied/) }),
});

const counts = { added: 0, changed: 0, errors: 0, skippedChecked: 0 };

const record = {
  fileName: 'Показатели сентябрь 2026.xlsx',
  from: '2026-09',
  to: '2026-09',
  added: 3,
  changed: 1,
  errors: 2,
  skippedChecked: 0,
} as const;

describe.skipIf(!databaseAvailable())('«История загрузок» ввода показателей из Excel', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  const ctxA = (): OrgContext => ({ orgId: a.orgId, userId: a.ownerUserId });
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, ctxA(), fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);

  beforeAll(async () => {
    db = await createTestDatabase();
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    await seedPermissions(db.admin.db, refDB.permissions, { update: false });
    await seedRoleTemplates(db.admin.db, refDB.roleTemplates, { update: false });
    const owner = async (login: string) => ({
      fullName: 'Асанова Айгуль Бекболотовна',
      login,
      passwordHash: await hashPassword('Bh-4821-temp'),
    });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'kimp-a',
      owner: await owner('kimp-owner-a'),
      today: '2026-01-15',
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'kimp-b',
      owner: await owner('kimp-owner-b'),
      today: '2026-01-15',
    });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('имя файла — без пути и управляющих символов, не длиннее 255', () => {
    expect(importFileName('C:\\Users\\aigul\\Показатели.xlsx')).toBe('Показатели.xlsx');
    expect(importFileName('/tmp/a\u0000b\nc.csv')).toBe('abc.csv');
    expect(importFileName('   ')).toBe('-');
    expect([...importFileName('я'.repeat(300))]).toHaveLength(255);
  });

  it('загрузка записывается от имени пользователя; список — сначала новые, с кратким ФИО', async () => {
    const first = await inA((tx) => insertIndicatorImport(tx, record));
    const second = await inA((tx) =>
      insertIndicatorImport(tx, {
        ...record,
        fileName: 'D:/данные/второй.csv',
        from: null,
        to: null,
      }),
    );
    const list = await inA((tx) => listIndicatorImports(tx));
    expect(list.map((r) => r.id)).toEqual([second.id, first.id]);
    expect(list[0]).toMatchObject({ fileName: 'второй.csv', from: null, to: null });
    expect(list[1]).toMatchObject({ ...record, actor: 'Айгуль А.' });
    const [row] = await inA((tx) =>
      tx.select().from(indicatorImports).where(eq(indicatorImports.id, first.id)),
    );
    expect(row).toMatchObject({ orgId: a.orgId, createdBy: a.ownerUserId });
  });

  it('историю нельзя изменить или удалить, а запись — сделать от чужого имени', async () => {
    await expect(inA((tx) => tx.update(indicatorImports).set({ added: 0 }))).rejects.toThrow(
      permissionDenied,
    );
    await expect(inA((tx) => tx.delete(indicatorImports))).rejects.toThrow(permissionDenied);
    await expect(
      inA((tx) =>
        tx.insert(indicatorImports).values({
          orgId: a.orgId,
          fileName: 'чужое.xlsx',
          ...counts,
          createdBy: b.ownerUserId,
        }),
      ),
    ).rejects.toThrow(rlsViolation);
    await expect(
      inA((tx) =>
        tx.insert(indicatorImports).values({
          orgId: a.orgId,
          fileName: 'неверный период.xlsx',
          ...counts,
          fromMonth: '2026-13',
          createdBy: sql`app.current_user_id()`,
        }),
      ),
    ).rejects.toThrow();
  });

  it('чужая организация не видна, а строку с чужой организацией не вставить', async () => {
    expect(await inB((tx) => listIndicatorImports(tx))).toEqual([]);
    expect((await inA((tx) => listIndicatorImports(tx))).length).toBe(2);
    await expect(
      inB((tx) =>
        tx.insert(indicatorImports).values({
          orgId: a.orgId,
          fileName: 'чужая.xlsx',
          ...counts,
          createdBy: sql`app.current_user_id()`,
        }),
      ),
    ).rejects.toThrow(rlsViolation);
  });
});
