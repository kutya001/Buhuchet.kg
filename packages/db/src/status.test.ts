import { randomUUID } from 'node:crypto';
import { hashPassword } from '@buhuchet/adapters/password';
import {
  scaleStatuses,
  STATUS_SCALES,
  statusLook,
  statusTextKey,
  UI_TEXTS,
  type StatusScaleKey,
} from '@buhuchet/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import { employees, statusHistory, users } from './schema';
import { seedPermissions, seedRoleTemplates } from './seed';
import { readSpecJson } from './spec-data';
import { readStatusHistory, writeStatusChange } from './status';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

const rlsViolation = expect.objectContaining({
  cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }),
});
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ message: expect.stringMatching(/permission denied/) }),
});
const checkViolation = (name: string) =>
  expect.objectContaining({
    cause: expect.objectContaining({ message: expect.stringContaining(name) }),
  });

/** Раздел справочника «Статусы» refDB.json: название → [цвет, значок]. */
type StatusesRef = Record<StatusScaleKey, Record<string, [string, string]>>;

describe('справочник «Статусы»', () => {
  it('коды шкал продукта — те же статусы, названия, цвета и значки, что в refDB.json', async () => {
    const ref = (await readSpecJson<{ statuses: StatusesRef }>('data/refDB.json')).statuses;
    expect(Object.keys(ref).sort()).toEqual([...STATUS_SCALES].sort());
    for (const scale of STATUS_SCALES) {
      const ours = Object.fromEntries(
        scaleStatuses(scale).map((s) => {
          const look = statusLook(scale, s);
          return [UI_TEXTS[statusTextKey(scale, s)].ru, [look.tone, look.icon]];
        }),
      );
      expect([scale, ours]).toEqual([scale, ref[scale]]);
    }
  });
});

describe.skipIf(!databaseAvailable())('история статусов', () => {
  let t: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let platformAdminId: string;
  let chiefUserId: string;
  const ctxA = (): OrgContext => ({ orgId: a.orgId, userId: a.ownerUserId });
  const ctxChief = (): OrgContext => ({ orgId: a.orgId, userId: chiefUserId });

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

  it('смены статуса и откат по порядку: кто, когда, было → стало, причина и пометка «Откат»', async () => {
    const report = randomUUID();
    await withOrgContext(t.app.db, { orgId: a.orgId }, (tx) =>
      writeStatusChange(tx, { scale: 'report', entityId: report, from: null, to: 'todo' }),
    );
    await withOrgContext(t.app.db, ctxChief(), (tx) =>
      writeStatusChange(tx, {
        scale: 'report',
        entityId: report,
        from: 'todo',
        to: 'in_progress',
        reason: '  ',
      }),
    );
    await withOrgContext(t.app.db, ctxA(), (tx) =>
      writeStatusChange(tx, {
        scale: 'report',
        entityId: report,
        from: 'in_progress',
        to: 'todo',
        rollback: true,
        reason: ' поставили по ошибке ',
      }),
    );
    // Оплата того же отчёта — своя шкала, в историю сдачи не попадает.
    await withOrgContext(t.app.db, ctxA(), (tx) =>
      writeStatusChange(tx, { scale: 'payment', entityId: report, from: null, to: 'unpaid' }),
    );

    const history = await withOrgContext(t.app.db, ctxA(), (tx) =>
      readStatusHistory(tx, 'report', report),
    );
    const [owner] = await t.admin.db
      .select({ shortName: employees.shortName })
      .from(employees)
      .where(eq(employees.id, a.ownerEmployeeId));
    expect(history.map(({ at: _at, ...e }) => e)).toEqual([
      { from: null, to: 'todo', rollback: false, reason: null, actor: null },
      { from: 'todo', to: 'in_progress', rollback: false, reason: null, actor: 'Тилекова А.' },
      {
        from: 'in_progress',
        to: 'todo',
        rollback: true,
        reason: 'поставили по ошибке',
        actor: owner!.shortName,
      },
    ]);
    expect(history.every((e) => e.at instanceof Date)).toBe(true);
    expect(history[0]!.at.getTime()).toBeLessThanOrEqual(history[2]!.at.getTime());
  });

  it('несколько смен в одной транзакции — по порядку записи; если смена не сохранилась, записи нет', async () => {
    const task = randomUUID();
    await withOrgContext(t.app.db, ctxA(), (tx) =>
      writeStatusChange(
        tx,
        { scale: 'task', entityId: task, from: null, to: 'todo' },
        { scale: 'task', entityId: task, from: 'todo', to: 'in_progress' },
      ),
    );
    await expect(
      withOrgContext(t.app.db, ctxA(), async (tx) => {
        await writeStatusChange(tx, {
          scale: 'task',
          entityId: task,
          from: 'in_progress',
          to: 'done',
        });
        throw new Error('сохранение задачи не удалось');
      }),
    ).rejects.toThrow('сохранение задачи не удалось');
    await withOrgContext(t.app.db, ctxA(), (tx) => writeStatusChange(tx));
    const history = await withOrgContext(t.app.db, ctxA(), (tx) =>
      readStatusHistory(tx, 'task', task),
    );
    expect(history.map((e) => e.to)).toEqual(['todo', 'in_progress']);
  });

  it('статус не со своей шкалы, смена «в тот же статус» и откат без причины не записываются', async () => {
    const id = randomUUID();
    const write = (change: Parameters<typeof writeStatusChange>[1]) =>
      withOrgContext(t.app.db, ctxA(), (tx) => writeStatusChange(tx, change));
    await expect(write({ scale: 'report', entityId: id, from: null, to: 'paid' })).rejects.toThrow(
      'status_history',
    );
    await expect(
      write({ scale: 'report', entityId: id, from: 'todo', to: 'todo' }),
    ).rejects.toThrow('status_history');
    await expect(
      write({ scale: 'report', entityId: id, from: 'in_progress', to: 'todo', rollback: true }),
    ).rejects.toThrow('откат без причины');
    await expect(
      write({ scale: 'report', entityId: id, from: null, to: 'todo', rollback: true, reason: 'x' }),
    ).rejects.toThrow('откат без причины');

    // То же не пропускает и сама таблица.
    const insert = (values: Partial<typeof statusHistory.$inferInsert>) =>
      withOrgContext(t.app.db, ctxA(), (tx) =>
        tx.insert(statusHistory).values({
          scale: 'report',
          entityId: id,
          fromStatus: 'in_progress',
          toStatus: 'todo',
          ...values,
        }),
      );
    await expect(insert({ toStatus: 'paid' })).rejects.toThrow(
      checkViolation('status_history_status_check'),
    );
    await expect(
      insert({ scale: 'payment', toStatus: 'paid', fromStatus: 'todo' }),
    ).rejects.toThrow(checkViolation('status_history_status_check'));
    await expect(insert({ scale: 'other' as never })).rejects.toThrow(
      checkViolation('status_history_status_check'),
    );
    await expect(insert({ fromStatus: 'todo' })).rejects.toThrow(
      checkViolation('status_history_change_check'),
    );
    for (const reason of [null, ' ']) {
      await expect(insert({ isRollback: true, reason })).rejects.toThrow(
        checkViolation('status_history_rollback_reason_check'),
      );
    }
    await expect(insert({ reason: 'я'.repeat(501) })).rejects.toThrow(
      checkViolation('status_history_reason_check'),
    );
    await insert({ reason: 'я'.repeat(500) });
  });

  it('все статусы каждой шкалы записываются', async () => {
    await withOrgContext(t.app.db, ctxA(), async (tx) => {
      for (const scale of STATUS_SCALES) {
        const id = randomUUID();
        let from: string | null = null;
        for (const to of scaleStatuses(scale)) {
          await writeStatusChange(tx, { scale, entityId: id, from, to });
          from = to;
        }
        expect((await readStatusHistory(tx, scale, id)).length).toBe(scaleStatuses(scale).length);
      }
    });
  });

  it('история организации Б не видна в организации А, чужую запись не создать', async () => {
    const id = randomUUID();
    await withOrgContext(t.app.db, { orgId: b.orgId, userId: b.ownerUserId }, (tx) =>
      writeStatusChange(tx, { scale: 'project', entityId: id, from: null, to: 'planned' }),
    );
    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) => readStatusHistory(tx, 'project', id)),
    ).toEqual([]);
    const rows = await withOrgContext(t.app.db, ctxA(), (tx) => tx.select().from(statusHistory));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.orgId === a.orgId)).toBe(true);
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) =>
        tx
          .insert(statusHistory)
          .values({ orgId: b.orgId, scale: 'project', entityId: id, toStatus: 'planned' }),
      ),
    ).rejects.toThrow(rlsViolation);
  });

  it('без контекста организации истории не видно и записать её нельзя', async () => {
    expect(await t.app.db.select().from(statusHistory)).toEqual([]);
    await expect(
      t.app.db.transaction((tx) =>
        writeStatusChange(tx, { scale: 'task', entityId: randomUUID(), from: null, to: 'todo' }),
      ),
    ).rejects.toThrow();
  });

  it('автора, время и организацию записи подменить нельзя', async () => {
    const entry = {
      scale: 'service',
      entityId: randomUUID(),
      fromStatus: 'active',
      toStatus: 'paused',
    } as const;
    for (const forged of [
      { actorUserId: chiefUserId },
      { actorUserId: null },
      { at: new Date('2020-01-01T00:00:00Z') },
    ]) {
      await expect(
        withOrgContext(t.app.db, ctxA(), (tx) =>
          tx.insert(statusHistory).values({ ...entry, ...forged }),
        ),
      ).rejects.toThrow(rlsViolation);
    }
    // Пользователь другой организации — тоже нет; администратор платформы — может.
    const change = {
      scale: 'service',
      entityId: entry.entityId,
      from: 'active',
      to: 'paused',
    } as const;
    await expect(
      withOrgContext(t.app.db, { orgId: a.orgId, userId: b.ownerUserId }, (tx) =>
        writeStatusChange(tx, change),
      ),
    ).rejects.toThrow(rlsViolation);
    await withOrgContext(t.app.db, { orgId: a.orgId, userId: platformAdminId }, (tx) =>
      writeStatusChange(tx, change),
    );
    const [last] = await withOrgContext(t.app.db, ctxA(), (tx) =>
      readStatusHistory(tx, 'service', entry.entityId),
    );
    expect(last!.actor).toBe('Администратор платформы');
  });

  it('записи истории статусов не меняются и не удаляются', async () => {
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) =>
        tx.update(statusHistory).set({ reason: 'подчистить' }),
      ),
    ).rejects.toThrow(permissionDenied);
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) => tx.delete(statusHistory)),
    ).rejects.toThrow(permissionDenied);
  });
});
