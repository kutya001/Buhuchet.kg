import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  changeOwnPassword,
  currentOrganization,
  endSession,
  findLogin,
  loadEmployeeAccess,
  reserveLoginAttempt,
  sessionByToken,
  startSession,
  withUserContext,
} from './auth';
import { withOrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import { employees, organizations, sessions, users } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const newHash = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const checkViolation = expect.objectContaining({
  cause: expect.objectContaining({ code: '23514' }),
});

describe.skipIf(!databaseAvailable())('вход и сеансы в базе', () => {
  let t: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId: string;

  const user = async (id: string) =>
    (await t.admin.db.select().from(users).where(eq(users.id, id)))[0]!;

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedAccessReference(t.admin.db);
    const [admin] = await t.admin.db
      .insert(users)
      .values({ login: 'platform-admin', passwordHash: 'hash-admin', isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    a = await createOrganization(t.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'org-a',
      owner: { fullName: 'Токтомаматов Бекзат', login: 'Owner-A', passwordHash: 'hash-a' },
    });
    b = await createOrganization(t.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'org-b',
      owner: { fullName: 'Абдыкадырова Айгуль', login: 'owner-b', passwordHash: 'hash-b' },
    });
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('логин ищется без учёта регистра, вместе с состоянием организации и сотрудника', async () => {
    const found = await findLogin(t.app.db, 'OWNER-a');
    expect(found).toMatchObject({
      userId: a.ownerUserId,
      orgId: a.orgId,
      login: 'owner-a',
      passwordHash: 'hash-a',
      isPlatformAdmin: false,
      userBlocked: false,
      mustChangePassword: true,
      lockedUntil: null,
      locked: false,
      employeeId: a.ownerEmployeeId,
      employeeActive: true,
      orgStatus: 'active',
      orgName: 'Организация А',
    });
    expect(await findLogin(t.app.db, 'nobody')).toBeNull();
    expect(await findLogin(t.app.db, 'platform-admin')).toMatchObject({
      isPlatformAdmin: true,
      orgId: null,
      employeeActive: null,
      orgStatus: null,
    });
  });

  it('попытка входа занимается до проверки пароля; пятая подряд закрывает вход на 15 минут', async () => {
    for (let i = 1; i <= 4; i++) {
      expect(await reserveLoginAttempt(t.app.db, b.ownerUserId)).toEqual({
        allowed: true,
        locked: false,
        lockedUntil: null,
      });
    }
    const before = Date.now();
    const fifth = await reserveLoginAttempt(t.app.db, b.ownerUserId);
    expect(fifth).toMatchObject({ allowed: true, locked: true });
    const minutes = (fifth.lockedUntil!.getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(14.9);
    expect(minutes).toBeLessThan(15.1);
    expect(await findLogin(t.app.db, 'owner-b')).toMatchObject({ locked: true });
    // Пока вход закрыт, попытка не занимается и срок не продлевается.
    expect(await reserveLoginAttempt(t.app.db, b.ownerUserId)).toEqual({
      allowed: false,
      locked: true,
      lockedUntil: fifth.lockedUntil,
    });

    // Верный пароль после окончания блокировки: счётчик и блокировка сброшены, есть сеанс.
    await t.admin.db
      .update(users)
      .set({ lockedUntil: new Date(Date.now() - 1000), failedLogins: 3 })
      .where(eq(users.id, b.ownerUserId));
    expect(await findLogin(t.app.db, 'owner-b')).toMatchObject({ locked: false });
    await startSession(t.app.db, { userId: b.ownerUserId, tokenHash: newHash() });
    const after = await user(b.ownerUserId);
    expect(after.failedLogins).toBe(0);
    expect(after.lockedUntil).toBeNull();
    expect(after.lastLoginAt).not.toBeNull();
  });

  it('одновременные попытки: занять можно ровно пять, остальные отклоняются', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 20 }, () => reserveLoginAttempt(t.app.db, b.ownerUserId)),
    );
    expect(attempts.filter((x) => x.allowed)).toHaveLength(5);
    expect(attempts.filter((x) => x.allowed && !x.locked)).toHaveLength(4);
    await t.admin.db
      .update(users)
      .set({ lockedUntil: null, failedLogins: 0 })
      .where(eq(users.id, b.ownerUserId));
  });

  it('сеанс находится по хешу токена; продлевается не чаще раза в час', async () => {
    const tokenHash = newHash();
    const id = await startSession(t.app.db, { userId: a.ownerUserId, tokenHash });
    const s = await sessionByToken(t.app.db, tokenHash);
    expect(s).toEqual({
      sessionId: id,
      userId: a.ownerUserId,
      orgId: a.orgId,
      login: 'owner-a',
      isPlatformAdmin: false,
      mustChangePassword: true,
      userBlocked: false,
      employeeId: a.ownerEmployeeId,
      employeeActive: true,
      orgStatus: 'active',
      orgName: 'Организация А',
      touched: false,
    });
    expect(await sessionByToken(t.app.db, newHash())).toBeNull();

    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
    await t.admin.db
      .update(sessions)
      .set({ lastSeenAt: twoHoursAgo, expiresAt: new Date(Date.now() + 3600_000) })
      .where(eq(sessions.id, id));
    expect(await sessionByToken(t.app.db, tokenHash)).toMatchObject({ touched: true });
    const [row] = await t.admin.db.select().from(sessions).where(eq(sessions.id, id));
    expect(row!.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);
    expect(await sessionByToken(t.app.db, tokenHash)).toMatchObject({ touched: false });
  });

  it('истёкший сеанс не действует, выход удаляет сеанс', async () => {
    const expired = newHash();
    const id = await startSession(t.app.db, { userId: a.ownerUserId, tokenHash: expired });
    await t.admin.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, id));
    expect(await sessionByToken(t.app.db, expired)).toBeNull();

    const live = newHash();
    await startSession(t.app.db, { userId: a.ownerUserId, tokenHash: live });
    await endSession(t.app.db, live);
    expect(await sessionByToken(t.app.db, live)).toBeNull();
  });

  it('смена пароля: у текущего сеанса новый токен, остальные сеансы удалены', async () => {
    const current = newHash();
    const other = newHash();
    const sessionId = await startSession(t.app.db, { userId: a.ownerUserId, tokenHash: current });
    await startSession(t.app.db, { userId: a.ownerUserId, tokenHash: other });
    const bSession = newHash();
    await startSession(t.app.db, { userId: b.ownerUserId, tokenHash: bSession });
    await t.admin.db.update(users).set({ failedLogins: 2 }).where(eq(users.id, a.ownerUserId));
    const version = (await user(a.ownerUserId)).version;

    const rotated = newHash();
    await withOrgContext(t.app.db, { orgId: a.orgId, userId: a.ownerUserId }, (tx) =>
      changeOwnPassword(tx, { sessionId, passwordHash: 'hash-a2', newTokenHash: rotated }),
    );
    expect(await sessionByToken(t.app.db, current)).toBeNull();
    expect(await sessionByToken(t.app.db, other)).toBeNull();
    expect(await sessionByToken(t.app.db, rotated)).toMatchObject({
      sessionId,
      mustChangePassword: false,
    });
    const after = await user(a.ownerUserId);
    expect(after.passwordHash).toBe('hash-a2');
    expect(after.version).toBe(version + 1);
    expect(after.failedLogins).toBe(0);
    // Сеансы другого пользователя не тронуты.
    expect(await sessionByToken(t.app.db, bSession)).not.toBeNull();
  });

  it('сменить пароль можно только себе и только в своём сеансе', async () => {
    const bToken = newHash();
    const bSessionId = await startSession(t.app.db, { userId: b.ownerUserId, tokenHash: bToken });
    await expect(
      withOrgContext(t.app.db, { orgId: a.orgId, userId: a.ownerUserId }, (tx) =>
        changeOwnPassword(tx, {
          sessionId: bSessionId,
          passwordHash: 'stolen',
          newTokenHash: newHash(),
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withOrgContext(t.app.db, { orgId: b.orgId }, (tx) =>
        changeOwnPassword(tx, {
          sessionId: bSessionId,
          passwordHash: 'stolen',
          newTokenHash: newHash(),
        }),
      ),
    ).rejects.toThrow();
    expect((await user(b.ownerUserId)).passwordHash).toBe('hash-b');
    expect(await sessionByToken(t.app.db, bToken)).not.toBeNull();
  });

  it('администратор платформы: сеанс без организации, пароль меняет без неё', async () => {
    const token = newHash();
    const sessionId = await startSession(t.app.db, { userId: adminId, tokenHash: token });
    expect(await sessionByToken(t.app.db, token)).toMatchObject({
      orgId: null,
      isPlatformAdmin: true,
      employeeId: null,
      orgStatus: null,
    });
    const rotated = newHash();
    await withUserContext(t.app.db, adminId, (tx) =>
      changeOwnPassword(tx, { sessionId, passwordHash: 'hash-admin2', newTokenHash: rotated }),
    );
    expect(await sessionByToken(t.app.db, rotated)).toMatchObject({ userId: adminId });
    expect((await user(adminId)).passwordHash).toBe('hash-admin2');
  });

  it('чужая организация не видна: сеансы организации Б из контекста А не читаются', async () => {
    const seen = await withOrgContext(t.app.db, { orgId: a.orgId }, (tx) =>
      tx.select().from(sessions),
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.orgId === a.orgId)).toBe(true);
    // Сеансов без контекста роль приложения не видит вовсе.
    expect(await t.app.db.select().from(sessions)).toEqual([]);
  });

  it('чужая организация не меняется и не создаётся: сеансы Б из контекста А', async () => {
    const bToken = newHash();
    await startSession(t.app.db, { userId: b.ownerUserId, tokenHash: bToken });
    const ctxA = { orgId: a.orgId, userId: a.ownerUserId };
    const changed = await withOrgContext(t.app.db, ctxA, (tx) =>
      tx
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() + 365 * 86_400_000) })
        .where(eq(sessions.orgId, b.orgId))
        .returning({ id: sessions.id }),
    );
    expect(changed).toEqual([]);
    const deleted = await withOrgContext(t.app.db, ctxA, (tx) =>
      tx.delete(sessions).where(eq(sessions.orgId, b.orgId)).returning({ id: sessions.id }),
    );
    expect(deleted).toEqual([]);
    expect(await sessionByToken(t.app.db, bToken)).not.toBeNull();
    await expect(
      withOrgContext(t.app.db, ctxA, (tx) =>
        tx.insert(sessions).values({
          userId: b.ownerUserId,
          orgId: b.orgId,
          tokenHash: newHash(),
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }),
      }),
    );
  });

  it('права сотрудника: роль, права и области; сотрудник чужой организации не находится', async () => {
    const chiefRole = a.roles.find((r) => r.templateCode === 'chief')!;
    const [chiefUser] = await t.admin.db
      .insert(users)
      .values({ orgId: a.orgId, login: 'chief-a', passwordHash: 'hash' })
      .returning({ id: users.id });
    const [chief] = await t.admin.db
      .insert(employees)
      .values({
        orgId: a.orgId,
        userId: chiefUser!.id,
        fullName: 'Тилекова Алина',
        shortName: 'Тилекова А.',
        roleId: chiefRole.id,
      })
      .returning({ id: employees.id });

    const access = await withOrgContext(t.app.db, { orgId: a.orgId }, (tx) =>
      loadEmployeeAccess(tx, chief!.id),
    );
    expect(access).toMatchObject({
      fullName: 'Тилекова Алина',
      shortName: 'Тилекова А.',
      roleId: chiefRole.id,
      roleName: chiefRole.name,
      subject: { employeeId: chief!.id, isOwner: false },
    });
    expect(access!.subject.permissions.size).toBeGreaterThan(0);

    const owner = await withOrgContext(t.app.db, { orgId: a.orgId }, (tx) =>
      loadEmployeeAccess(tx, a.ownerEmployeeId),
    );
    expect(owner!.subject.isOwner).toBe(true);

    const foreign = await withOrgContext(t.app.db, { orgId: b.orgId }, (tx) =>
      loadEmployeeAccess(tx, chief!.id),
    );
    expect(foreign).toBeNull();
    expect(
      await withOrgContext(t.app.db, { orgId: b.orgId }, (tx) => currentOrganization(tx, a.orgId)),
    ).toBeNull();
    expect(
      await withOrgContext(t.app.db, { orgId: a.orgId }, (tx) => currentOrganization(tx, a.orgId)),
    ).toEqual({ id: a.orgId, name: 'Организация А', slug: 'org-a' });
  });

  it('состояние организации — только «активна» или «заблокирована»; причина необязательна', async () => {
    await expect(
      t.admin.db
        .update(organizations)
        .set({ status: 'paused' })
        .where(eq(organizations.id, b.orgId)),
    ).rejects.toThrow(checkViolation);
    await t.admin.db
      .update(organizations)
      .set({ status: 'blocked' })
      .where(eq(organizations.id, b.orgId));
    expect(await findLogin(t.app.db, 'owner-b')).toMatchObject({ orgStatus: 'blocked' });
  });
});
