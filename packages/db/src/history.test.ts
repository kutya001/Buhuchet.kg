import { randomUUID } from 'node:crypto';
import { hashPassword } from '@buhuchet/adapters/password';
import { RecordChangedError, RecordNotFoundError } from '@buhuchet/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from './context';
import { readHistory, updateWithHistory, writeHistory } from './history';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  auditLog,
  contractors,
  employees,
  orgSettings,
  ownershipForms,
  roles,
  users,
} from './schema';
import { seedPermissions, seedRoleTemplates } from './seed';
import { readSpecJson } from './spec-data';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

const rlsViolation = expect.objectContaining({
  cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }),
});
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ message: expect.stringMatching(/permission denied/) }),
});

describe.skipIf(!databaseAvailable())('история изменений и версия записи', () => {
  let t: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let platformAdminId: string;
  /** Второй сотрудник организации А — главный бухгалтер. */
  let chiefUserId: string;
  /** Владелец организации А правит от своего имени. */
  const ctxA = (): OrgContext => ({ orgId: a.orgId, userId: a.ownerUserId });
  const ctxChief = (): OrgContext => ({ orgId: a.orgId, userId: chiefUserId });

  const employee = async (id: string) =>
    (await t.admin.db.select().from(employees).where(eq(employees.id, id)))[0]!;
  const historyOf = (id: string) =>
    withOrgContext(t.app.db, ctxA(), (tx) => readHistory(tx, 'employee', id));

  beforeAll(async () => {
    t = await createTestDatabase();
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    await seedPermissions(t.admin.db, refDB.permissions, { update: false });
    await seedRoleTemplates(t.admin.db, refDB.roleTemplates, { update: false });
    const passwordHash = await hashPassword('Bh-4821-temp');
    const [admin] = await t.admin.db
      .insert(users)
      .values({ login: 'platform-admin', passwordHash, isPlatformAdmin: true })
      .returning({ id: users.id });
    platformAdminId = admin!.id;
    a = await createOrganization(t.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'org-a',
      owner: { fullName: 'Токтомаматов Бекзат', login: 'owner-a', passwordHash },
      createdBy: platformAdminId,
    });
    const [chief] = await t.admin.db
      .insert(users)
      .values({ orgId: a.orgId, login: 'chief-a', passwordHash })
      .returning({ id: users.id });
    chiefUserId = chief!.id;
    await t.admin.db.insert(employees).values({
      orgId: a.orgId,
      userId: chiefUserId,
      fullName: 'Тилекова Алина',
      shortName: 'Тилекова А.',
      roleId: a.roles.find((r) => r.templateCode === 'chief')!.id,
    });
    b = await createOrganization(t.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'org-b',
      owner: { fullName: 'Абдыкадырова Айгуль', login: 'owner-b', passwordHash },
    });
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('новая организация: всё созданное уже в истории, автор — администратор платформы', async () => {
    const rows = await withOrgContext(t.app.db, ctxA(), (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.action, 'create')),
    );
    expect(rows.map((r) => r.entity)).toEqual([
      'organization',
      'role',
      'role',
      'role',
      'user',
      'employee',
      'org_settings',
    ]);
    expect(rows.every((r) => r.actorUserId === platformAdminId && r.orgId === a.orgId)).toBe(true);
    // Без администратора (служебная команда без автора) — «Система».
    const [ownB] = await withOrgContext(t.app.db, { orgId: b.orgId }, (tx) =>
      readHistory(tx, 'employee', b.ownerEmployeeId),
    );
    expect(ownB).toMatchObject({ action: 'create', actorUserId: null });
  });

  it('правка сотрудника пишет в историю: кто, когда, что было и что стало', async () => {
    const before = await employee(a.ownerEmployeeId);
    const updated = await withOrgContext(t.app.db, ctxA(), (tx) =>
      updateWithHistory(tx, {
        table: employees,
        entity: 'employee',
        id: a.ownerEmployeeId,
        version: before.version,
        patch: { phone: '+996 555 123 456' },
      }),
    );
    expect(updated.version).toBe(before.version + 1);
    expect(updated.phone).toBe('+996 555 123 456');
    expect(updated.updatedBy).toBe(a.ownerUserId);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());

    const last = (await historyOf(a.ownerEmployeeId)).at(-1)!;
    expect(last).toMatchObject({
      orgId: a.orgId,
      entity: 'employee',
      entityId: a.ownerEmployeeId,
      action: 'update',
      actorUserId: a.ownerUserId,
      changes: [{ field: 'phone', from: null, to: '+996 555 123 456' }],
      reason: null,
    });
    expect(last.at).toBeInstanceOf(Date);
  });

  it('двое правят одного сотрудника: второй получает предупреждение «запись изменена другим пользователем», его правка не затирает первую', async () => {
    // Оба открыли карточку сотрудника с одной и той же версией.
    const opened = await employee(a.ownerEmployeeId);
    const historyBefore = (await historyOf(a.ownerEmployeeId)).length;

    await withOrgContext(t.app.db, ctxA(), (tx) =>
      updateWithHistory(tx, {
        table: employees,
        entity: 'employee',
        id: a.ownerEmployeeId,
        version: opened.version,
        patch: { fullName: 'Токтомаматов Бекзат Айбекович' },
      }),
    );
    const second = withOrgContext(t.app.db, ctxChief(), (tx) =>
      updateWithHistory(tx, {
        table: employees,
        entity: 'employee',
        id: a.ownerEmployeeId,
        version: opened.version,
        patch: { fullName: 'Токтомаматов Б.', phone: null },
      }),
    );
    await expect(second).rejects.toBeInstanceOf(RecordChangedError);
    await expect(second).rejects.toMatchObject({
      code: 'record_changed',
      currentVersion: opened.version + 1,
    });

    const after = await employee(a.ownerEmployeeId);
    expect(after.fullName).toBe('Токтомаматов Бекзат Айбекович');
    expect(after.phone).toBe(opened.phone);
    expect(after.version).toBe(opened.version + 1);
    expect(after.updatedBy).toBe(a.ownerUserId);
    const history = await historyOf(a.ownerEmployeeId);
    expect(history).toHaveLength(historyBefore + 1);
    expect(history.at(-1)).toMatchObject({
      actorUserId: a.ownerUserId,
      changes: [
        { field: 'fullName', from: 'Токтомаматов Бекзат', to: 'Токтомаматов Бекзат Айбекович' },
      ],
    });
  });

  it('одновременная правка: вторая ждёт, пока первая сохранится, и получает предупреждение', async () => {
    const opened = await employee(a.ownerEmployeeId);
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const first = withOrgContext(t.app.db, ctxA(), async (tx) => {
      const row = await updateWithHistory(tx, {
        table: employees,
        entity: 'employee',
        id: a.ownerEmployeeId,
        version: opened.version,
        patch: { phone: '+996 700 000 001' },
      });
      locked();
      await gate;
      return row;
    });
    await isLocked;
    const second = withOrgContext(t.app.db, ctxChief(), (tx) =>
      updateWithHistory(tx, {
        table: employees,
        entity: 'employee',
        id: a.ownerEmployeeId,
        version: opened.version,
        patch: { phone: '+996 700 000 002' },
      }),
    );
    second.catch(() => {});
    await waitForLockWaiter(t);
    release();

    await expect(first).resolves.toMatchObject({ version: opened.version + 1 });
    await expect(second).rejects.toBeInstanceOf(RecordChangedError);
    expect((await employee(a.ownerEmployeeId)).phone).toBe('+996 700 000 001');
  });

  it('правка без изменений не пишет историю и не меняет версию', async () => {
    const opened = await employee(a.ownerEmployeeId);
    const historyBefore = (await historyOf(a.ownerEmployeeId)).length;
    const same = await withOrgContext(t.app.db, ctxA(), (tx) =>
      updateWithHistory(tx, {
        table: employees,
        entity: 'employee',
        id: a.ownerEmployeeId,
        version: opened.version,
        patch: { fullName: opened.fullName, phone: undefined },
      }),
    );
    expect(same.version).toBe(opened.version);
    expect(await historyOf(a.ownerEmployeeId)).toHaveLength(historyBefore);
  });

  it('если правка не сохранилась, записи в истории тоже нет', async () => {
    const opened = await employee(a.ownerEmployeeId);
    const historyBefore = (await historyOf(a.ownerEmployeeId)).length;
    await expect(
      withOrgContext(t.app.db, ctxA(), async (tx) => {
        await updateWithHistory(tx, {
          table: employees,
          entity: 'employee',
          id: a.ownerEmployeeId,
          version: opened.version,
          patch: { active: false },
        });
        throw new Error('сбой после правки');
      }),
    ).rejects.toThrow('сбой после правки');
    expect(await employee(a.ownerEmployeeId)).toMatchObject({
      active: true,
      version: opened.version,
    });
    expect(await historyOf(a.ownerEmployeeId)).toHaveLength(historyBefore);
  });

  it('нет записи или она другой организации — «не найдена», чужая запись не меняется', async () => {
    const foreign = await employee(b.ownerEmployeeId);
    for (const id of [randomUUID(), b.ownerEmployeeId]) {
      await expect(
        withOrgContext(t.app.db, ctxA(), (tx) =>
          updateWithHistory(tx, {
            table: employees,
            entity: 'employee',
            id,
            version: foreign.version,
            patch: { fullName: 'Взлом' },
          }),
        ),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
    }
    expect((await employee(b.ownerEmployeeId)).fullName).toBe('Абдыкадырова Айгуль');
  });

  it('смена пароля: в истории только факт, без хеша', async () => {
    const [user] = await t.admin.db.select().from(users).where(eq(users.id, a.ownerUserId));
    await withOrgContext(t.app.db, ctxA(), (tx) =>
      updateWithHistory(tx, {
        table: users,
        entity: 'user',
        id: a.ownerUserId,
        version: user!.version,
        patch: { passwordHash: '$argon2id$new-hash', mustChangePassword: false },
      }),
    );
    const [last] = (
      await withOrgContext(t.app.db, ctxA(), (tx) => readHistory(tx, 'user', a.ownerUserId))
    ).slice(-1);
    expect(last?.changes).toEqual([
      { field: 'passwordHash' },
      { field: 'mustChangePassword', from: true, to: false },
    ]);
  });

  it('причина и контрагент сохраняются, пустая причина — не причина; без пользователя — система', async () => {
    // Контрагент истории — запись своей организации (внешний ключ, миграция 0034).
    const contractorId = randomUUID();
    await t.admin.db
      .insert(ownershipForms)
      .values({ code: 'ФС-01', name: 'ОсОО', sortOrder: 1 })
      .onConflictDoNothing();
    await t.admin.db.insert(contractors).values({
      id: contractorId,
      orgId: a.orgId,
      name: 'ОсОО «История»',
      inn: '01234567890123',
      phone: '+996555100200',
      kind: 'regular',
      formCode: 'ФС-01',
      startDate: '2026-10-01',
    });
    await withOrgContext(t.app.db, { orgId: a.orgId }, (tx) =>
      writeHistory(
        tx,
        {
          entity: 'role',
          entityId: 'r-1',
          action: 'delete',
          reason: ' Роль больше не нужна ',
          contractorId,
        },
        { entity: 'role', entityId: 'r-2', action: 'delete', reason: '   ' },
      ),
    );
    const rows = await withOrgContext(t.app.db, ctxA(), (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.action, 'delete')),
    );
    expect(rows.map((r) => [r.entityId, r.reason, r.contractorId, r.actorUserId])).toEqual([
      ['r-1', 'Роль больше не нужна', contractorId, null],
      ['r-2', null, null, null],
    ]);
    await withOrgContext(t.app.db, ctxA(), (tx) => writeHistory(tx));
  });

  it('история организации Б не видна в организации А, чужую запись истории не создать', async () => {
    const rows = await withOrgContext(t.app.db, ctxA(), (tx) => tx.select().from(auditLog));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.orgId === a.orgId)).toBe(true);
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) =>
        tx
          .insert(auditLog)
          .values({ orgId: b.orgId, entity: 'employee', entityId: 'x', action: 'update' }),
      ),
    ).rejects.toThrow(rlsViolation);
  });

  it('без контекста организации истории не видно и записать её нельзя', async () => {
    expect(await t.app.db.select().from(auditLog)).toEqual([]);
    await expect(
      t.app.db.transaction((tx) =>
        writeHistory(tx, { entity: 'employee', entityId: 'x', action: 'update' }),
      ),
    ).rejects.toThrow();
  });

  it('автора, время и организацию записи истории подменить нельзя', async () => {
    const entry = { entity: 'employee', entityId: 'x', action: 'update' } as const;
    for (const forged of [
      { actorUserId: chiefUserId },
      { actorUserId: null },
      { at: new Date('2020-01-01T00:00:00Z') },
    ]) {
      await expect(
        withOrgContext(t.app.db, ctxA(), (tx) =>
          tx.insert(auditLog).values({ ...entry, ...forged }),
        ),
      ).rejects.toThrow(rlsViolation);
    }
    // Пользователь другой организации в контексте — тоже нет: автор только из своей организации.
    await expect(
      withOrgContext(t.app.db, { orgId: a.orgId, userId: b.ownerUserId }, (tx) =>
        writeHistory(tx, entry),
      ),
    ).rejects.toThrow(rlsViolation);
    // Администратор платформы может быть автором в любой организации.
    await withOrgContext(t.app.db, { orgId: b.orgId, userId: platformAdminId }, (tx) =>
      writeHistory(tx, entry),
    );
  });

  it('правка только из полей таблицы: служебные и лишние поля — ошибка, ничего не меняется', async () => {
    const opened = await employee(a.ownerEmployeeId);
    for (const extra of [
      { createdBy: chiefUserId },
      { id: randomUUID() },
      { version: 999 },
      { notAColumn: 1 },
      { constructor: 1 },
      { toString: 1 },
    ]) {
      const body: Record<string, unknown> = { fullName: 'Взлом', ...extra };
      await expect(
        withOrgContext(t.app.db, ctxA(), (tx) =>
          updateWithHistory(tx, {
            table: employees,
            entity: 'employee',
            id: a.ownerEmployeeId,
            version: opened.version,
            patch: body,
          }),
        ),
      ).rejects.toThrow(/нельзя менять правкой/);
    }
    expect(await employee(a.ownerEmployeeId)).toEqual(opened);
  });

  it('неверный номер записи и запись вне области доступа — «не найдена»', async () => {
    const opened = await employee(a.ownerEmployeeId);
    const attempt = (id: string, where?: ReturnType<typeof eq>) =>
      withOrgContext(t.app.db, ctxA(), (tx) =>
        updateWithHistory(tx, {
          table: employees,
          entity: 'employee',
          id,
          version: opened.version,
          patch: { phone: null },
          where,
        }),
      );
    await expect(attempt('не-номер')).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(attempt(a.ownerEmployeeId, eq(employees.active, false))).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    expect((await employee(a.ownerEmployeeId)).version).toBe(opened.version);
  });

  it('учётная политика: запись с ключом org_id', async () => {
    const [before] = await t.admin.db
      .select()
      .from(orgSettings)
      .where(eq(orgSettings.orgId, a.orgId));
    const updated = await withOrgContext(t.app.db, ctxA(), (tx) =>
      updateWithHistory(tx, {
        table: orgSettings,
        entity: 'org_settings',
        id: a.orgId,
        key: orgSettings.orgId,
        version: before!.version,
        patch: { remindDays: [7, 3, 1] },
      }),
    );
    expect(updated).toMatchObject({ version: before!.version + 1, updatedBy: a.ownerUserId });
    const [last] = (
      await withOrgContext(t.app.db, ctxA(), (tx) => readHistory(tx, 'org_settings', a.orgId))
    ).slice(-1);
    expect(last?.changes).toEqual([{ field: 'remindDays', from: [7, 3], to: [7, 3, 1] }]);
  });

  it('изменения дочерних записей (права роли) поднимают версию и попадают в историю', async () => {
    const chiefRole = a.roles.find((r) => r.templateCode === 'chief')!;
    const [before] = await t.admin.db.select().from(roles).where(eq(roles.id, chiefRole.id));
    const updated = await withOrgContext(t.app.db, ctxA(), (tx) =>
      updateWithHistory(tx, {
        table: roles,
        entity: 'role',
        id: chiefRole.id,
        version: before!.version,
        patch: {},
        changes: [{ field: 'permissions', from: ['cpView'], to: ['cpView', 'assign'] }],
      }),
    );
    expect(updated.version).toBe(before!.version + 1);
    const [last] = (
      await withOrgContext(t.app.db, ctxA(), (tx) => readHistory(tx, 'role', chiefRole.id))
    ).slice(-1);
    expect(last).toMatchObject({
      action: 'update',
      changes: [{ field: 'permissions', from: ['cpView'], to: ['cpView', 'assign'] }],
    });
  });

  it('секретные значения не попадают в историю, даже в готовом списке изменений', async () => {
    await withOrgContext(t.app.db, ctxA(), (tx) =>
      writeHistory(tx, {
        entity: 'user',
        entityId: a.ownerUserId,
        action: 'update',
        changes: [
          { field: 'telegramLinkToken', from: null, to: 'abc123' },
          { field: 'pin', from: '1111', to: '2222' },
        ],
        secretFields: ['pin'],
      }),
    );
    const [last] = (
      await withOrgContext(t.app.db, ctxA(), (tx) => readHistory(tx, 'user', a.ownerUserId))
    ).slice(-1);
    expect(last?.changes).toEqual([{ field: 'telegramLinkToken' }, { field: 'pin' }]);
  });

  it('записи истории не меняются и не удаляются', async () => {
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) => tx.update(auditLog).set({ reason: 'подчистить' })),
    ).rejects.toThrow(permissionDenied);
    await expect(withOrgContext(t.app.db, ctxA(), (tx) => tx.delete(auditLog))).rejects.toThrow(
      permissionDenied,
    );
  });
});

/** Ждёт, пока в тестовой базе какой-то запрос встанет в очередь за блокировкой записи. */
async function waitForLockWaiter(t: TestDatabase): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const [row] = await t.admin.sql<{ n: number }[]>`
      select count(*)::int as n from pg_locks
      where not granted
        and pid in (select pid from pg_stat_activity where datname = current_database())`;
    if (row && row.n > 0) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('вторая правка не ждёт блокировку записи');
}
