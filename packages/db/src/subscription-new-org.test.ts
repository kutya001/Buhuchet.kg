import {
  addDays,
  SUBSCRIPTION_LAUNCH_REASON,
  SUBSCRIPTION_NEW_ORG_FREE_REASON,
  type IsoDate,
} from '@buhuchet/domain';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  auditLog,
  orgSubscriptions,
  subscriptionPayments,
  subscriptionPlans,
  users,
} from './schema';
import { orgSubscriptionClosed, orgUsage } from './subscriptions';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const pgError = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

// Подписка новой организации и закрытие доступа (доработки 20.11.2026, блок 4, пункты 4–7; блок 6,
// пункт 4; этап 1, П1; миграция 0167).
describe.skipIf(!databaseAvailable())('подписка новой организации и закрытие доступа', () => {
  let db: TestDatabase;
  let adminId = '';
  let n = 0;
  const today = '2026-11-20' as IsoDate;
  const make = (over: Partial<Parameters<typeof createOrganization>[1]> = {}) => {
    n += 1;
    return createOrganization(db.app.db, {
      name: `Подписка ${n}`,
      inn: `0381120${String(1810400 + n)}`,
      slug: `subs-new-${n}`,
      owner: { fullName: 'Владелец', login: `subs-new-owner-${n}`, passwordHash: 'x' },
      today,
      ...over,
    });
  };
  const subOf = async (orgId: string) =>
    (await db.admin.db.select().from(orgSubscriptions).where(eq(orgSubscriptions.orgId, orgId)))[0];
  const paysOf = (orgId: string) =>
    db.admin.db.select().from(subscriptionPayments).where(eq(subscriptionPayments.orgId, orgId));
  const usage = (org: CreatedOrganization, day: IsoDate) =>
    withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, (tx) =>
      orgUsage(tx, day, { bytes: false }),
    );
  const closed = (org: CreatedOrganization, day: IsoDate) =>
    withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, (tx) =>
      orgSubscriptionClosed(tx, day),
    );
  const newOrgCall = (until = '2027-01-01') =>
    sql`select * from app.subscription_new_org(null, null, 0, ${until}::date, 0, true, 'Причина')`;

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    await seedAllPlatformDictionaries(db.admin.db);
    const [admin] = await db.admin.db
      .insert(users)
      .values({ login: 'subs-new-platform', passwordHash: 'x', isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('по умолчанию — бесплатный период: «Месяц», пакет по шагу, 30 дней, строка «Истории оплат» от «Системы»', async () => {
    const org = await make();
    const sub = await subOf(org.orgId);
    expect(sub).toMatchObject({
      planId: 'm1',
      seats: 10,
      extraGb: 0,
      paidUntil: addDays(today, 30),
      extraDiscountPct: 0,
      free: true,
      firstPaid: false,
      updatedBy: null,
    });
    const pays = await paysOf(org.orgId);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({
      kind: 'free',
      planId: 'm1',
      months: 0,
      seats: 10,
      amount: 0,
      status: 'confirmed',
      opensAccess: true,
      reason: SUBSCRIPTION_NEW_ORG_FREE_REASON,
      paidUntil: addDays(today, 30),
      createdBy: null,
      decidedBy: null,
      receiptKey: null,
    });
    const history = await db.admin.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'subscription'), eq(auditLog.entityId, org.orgId)));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      orgId: org.orgId,
      action: 'create',
      reason: SUBSCRIPTION_NEW_ORG_FREE_REASON,
      actorUserId: null,
    });
    expect(history[0]!.changes).toEqual([
      { field: 'planId', to: 'm1' },
      { field: 'seats', to: 10 },
      { field: 'paidUntil', to: addDays(today, 30) },
      { field: 'free', to: true },
    ]);
    // Доступ открыт по «Оплачено до» включительно и закрыт со следующего дня (блок 4, пункт 4).
    expect(await usage(org, today)).toMatchObject({ status: 'active', closed: false });
    expect(await closed(org, addDays(today, 30))).toBe(false);
    expect(await closed(org, addDays(today, 31))).toBe(true);
    expect(await usage(org, addDays(today, 31))).toMatchObject({ status: 'overdue' });
  });

  it('null — «Нет подписки»: строк нет, доступ закрыт сразу; демо не закрывается никогда', async () => {
    const org = await make({ subscription: null });
    expect(await subOf(org.orgId)).toBeUndefined();
    expect(await paysOf(org.orgId)).toEqual([]);
    expect(await usage(org, today)).toMatchObject({
      status: 'none',
      closed: true,
      paidUntil: null,
      bytesLimit: null,
    });
    const demo = await make({ subscription: null });
    await db.admin.db.execute(sql`update organizations set is_demo = true where id = ${demo.orgId}`);
    expect(await usage(demo, today)).toMatchObject({ status: 'demo', closed: false });
    expect(await closed(demo, '2099-01-01' as IsoDate)).toBe(false);
  });

  it('из Админки: вид, пакет, память, скидка и срок — от администратора; бесплатный период — с его строкой, без него — без строки', async () => {
    const paid = await make({
      createdBy: adminId,
      subscription: {
        planId: 'm3',
        seats: 60,
        extraGb: 2,
        paidUntil: '2027-02-20',
        extraDiscountPct: 5,
        free: false,
        reason: 'Подписка при создании организации',
      },
    });
    expect(await subOf(paid.orgId)).toMatchObject({
      planId: 'm3',
      seats: 60,
      extraGb: 2,
      paidUntil: '2027-02-20',
      extraDiscountPct: 5,
      free: false,
      updatedBy: adminId,
    });
    expect(await paysOf(paid.orgId)).toEqual([]);
    const [entry] = await db.admin.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'subscription'), eq(auditLog.entityId, paid.orgId)));
    expect(entry).toMatchObject({ actorUserId: adminId, reason: 'Подписка при создании организации' });
    expect(entry!.changes).toEqual([
      { field: 'planId', to: 'm3' },
      { field: 'seats', to: 60 },
      { field: 'extraGb', to: 2 },
      { field: 'paidUntil', to: '2027-02-20' },
      { field: 'extraDiscountPct', to: 5 },
    ]);

    const free = await make({
      createdBy: adminId,
      subscription: { paidUntil: '2026-12-04', free: true, reason: 'Бесплатный период' },
    });
    expect(await paysOf(free.orgId)).toEqual([
      expect.objectContaining({
        kind: 'free',
        createdBy: adminId,
        decidedBy: adminId,
        reason: 'Бесплатный период',
        paidUntil: '2026-12-04',
      }),
    ]);
    // Повтор запуска тарификации продлевает только то, что дала «Система», а не администратор.
    const system = await make({ today: '2026-11-25' as IsoDate });
    const launched = await db.admin.db.execute<{ n: number }>(
      sql`select app.subscriptions_launch('2026-12-01'::date) as n`,
    );
    expect(Number(launched[0]!.n)).toBeGreaterThanOrEqual(1);
    expect((await subOf(free.orgId))!.paidUntil).toBe('2026-12-04');
    expect((await subOf(system.orgId))!.paidUntil).toBe('2026-12-31');
    expect((await paysOf(system.orgId)).map((p) => p.reason)).toEqual(
      expect.arrayContaining([SUBSCRIPTION_NEW_ORG_FREE_REASON, SUBSCRIPTION_LAUNCH_REASON]),
    );
  });

  it('выключенный или чужой вид подписки — отказ, организация не создаётся', async () => {
    await db.admin.db
      .update(subscriptionPlans)
      .set({ active: false })
      .where(eq(subscriptionPlans.id, 'm9'));
    const before = n;
    await expect(
      make({
        createdBy: adminId,
        subscription: { planId: 'm9', paidUntil: '2027-01-01', free: true, reason: 'Причина' },
      }),
    ).rejects.toEqual(pgError('23503'));
    await expect(
      make({
        createdBy: adminId,
        subscription: { planId: 'nope', paidUntil: '2027-01-01', free: true, reason: 'Причина' },
      }),
    ).rejects.toEqual(pgError('23503'));
    const left = await db.admin.db.execute<{ n: number }>(
      sql`select count(*)::int as n from organizations where slug in (${`subs-new-${before + 1}`}, ${`subs-new-${before + 2}`})`,
    );
    expect(Number(left[0]!.n)).toBe(0);
  });

  it('функция базы не ставит подписку существующей организации — ни с подпиской, ни без неё, ни без организации', async () => {
    const withSub = await make();
    const none = await make({ subscription: null });
    for (const org of [withSub, none]) {
      await expect(
        withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, (tx) =>
          tx.execute(newOrgCall()),
        ),
      ).rejects.toEqual(pgError('42501'));
      // И администратор платформы в контексте организации — тоже (подписку меняет «Изменить подписку»).
      await expect(
        withOrgContext(db.app.db, { orgId: org.orgId, userId: adminId }, (tx) =>
          tx.execute(newOrgCall()),
        ),
      ).rejects.toEqual(pgError('42501'));
    }
    await expect(db.app.db.execute(newOrgCall())).rejects.toEqual(pgError('42501'));
    expect(await subOf(none.orgId)).toBeUndefined();
    // Подписку меняют только функции администратора: прямой вставки у роли приложения нет.
    await expect(
      withOrgContext(db.app.db, { orgId: none.orgId, userId: none.ownerUserId }, (tx) =>
        tx.insert(orgSubscriptions).values({
          orgId: none.orgId,
          planId: 'm1',
          seats: 10,
          paidUntil: '2030-01-01',
        }),
      ),
    ).rejects.toEqual(pgError('42501'));
  });
});
