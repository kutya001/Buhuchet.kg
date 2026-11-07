import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, users } from './schema';
import { DEMO_ORG_ID, demoId, seedAll } from './seed';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

// Прототип v76: у демо-сотрудника Жылдыз (e6) вход закрыт после 10 неверных паролей подряд.
describe.skipIf(!databaseAvailable())('Блокировка входа в демо-организации из demoDB.json', () => {
  let db: TestDatabase;
  const jyldyz = demoId('user', 'e6');
  const lockEntries = () =>
    db.admin.db
      .select({ actor: auditLog.actorUserId, at: auditLog.at, changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'user'), eq(auditLog.action, 'login_lock')));
  const account = async (userId: string) =>
    (
      await db.admin.db
        .select({ failures: users.loginFailures, lockedAt: users.loginLockedAt })
        .from(users)
        .where(eq(users.id, userId))
    )[0]!;

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAll(db.admin.db, { update: false, demo: true });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('у jyldyz 10 неверных паролей и блокировка 06.11.2026 22:41; в истории — запись от имени системы', async () => {
    expect(await account(jyldyz)).toEqual({
      failures: 10,
      lockedAt: new Date('2026-11-06T22:41:00+06:00'),
    });
    expect(await lockEntries()).toEqual([
      { actor: null, at: new Date('2026-11-06T22:41:00+06:00'), changes: [] },
    ]);
    // Остальные демо-сотрудники входят как раньше.
    expect(await account(demoId('user', 'e1'))).toEqual({ failures: 0, lockedAt: null });
    const rows = await db.admin.db
      .select({ lockedAt: users.loginLockedAt })
      .from(users)
      .where(eq(users.orgId, DEMO_ORG_ID));
    expect(rows.filter((r) => r.lockedAt !== null)).toHaveLength(1);
  });

  it('повторное наполнение не задваивает запись и не возвращает снятую блокировку', async () => {
    await seedAll(db.admin.db, { update: true, demo: true });
    expect(await lockEntries()).toHaveLength(1);
    // Владелец выдал новый пароль — блокировка снята.
    await db.admin.db
      .update(users)
      .set({ loginFailures: 0, loginLockedAt: null })
      .where(eq(users.id, jyldyz));
    await seedAll(db.admin.db, { update: true, demo: true });
    expect(await account(jyldyz)).toEqual({ failures: 0, lockedAt: null });
    expect(await lockEntries()).toHaveLength(1);
  });
});
