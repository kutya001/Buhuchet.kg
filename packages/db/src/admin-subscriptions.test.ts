import { randomUUID } from 'node:crypto';
import {
  RecordChangedError,
  RecordNotFoundError,
  subscriptionConfirm,
  subscriptionEdit,
  type ListQuery,
} from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSubscriptionCard,
  createSubscriptionPlan,
  decidePayment,
  deleteSubscriptionPlan,
  exportSubscriptions,
  insertFreePayment,
  listSubscriptionValues,
  listSubscriptionsPage,
  lockPendingPayment,
  lockSubscription,
  lockSubscriptionPlan,
  pendingPaymentOf,
  pendingSubscriptionPayments,
  saveSubscription,
  subscriptionConfigHistory,
  subscriptionPaymentOrg,
  subscriptionPlanUsage,
  subscriptionsSummary,
  SubscriptionPaymentDecidedError,
  updateSubscriptionPlan,
  updateSubscriptionSettings,
  writeSubscriptionHistory,
} from './admin-subscriptions';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  orgSubscriptions,
  organizations,
  subscriptionPayments,
  subscriptionPlans,
  users,
} from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const t = (key: string) => key;
const query = (patch: Partial<ListQuery> = {}): ListQuery =>
  ({ sort: undefined, page: 1, size: 'all', filters: {}, ...patch }) as ListQuery;
const TODAY = '2026-11-20';
const pgError = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });
/** Отказ политики RLS или проверки строки. */
const denied = expect.objectContaining({
  cause: expect.objectContaining({ code: expect.stringMatching(/^(42501|23514)$/) }),
});

// Админка → «Организации» → «Подписки» (доработки 20.11.2026, блок 6; этап 1, П3).
describe.skipIf(!databaseAvailable())('Админка: подписки организаций', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let c: CreatedOrganization;
  let demo: CreatedOrganization;
  let adminId = '';
  let latePay = '';
  type Fn<T> = Parameters<typeof withOrgContext<T>>[2];
  const adminIn = <T>(orgId: string, fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId, userId: adminId }, fn);
  const ownerOf = <T>(org: CreatedOrganization, fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, fn);
  const asAdmin = <T>(fn: Parameters<typeof withUserContext<T>>[2]) =>
    withUserContext(db.app.db, adminId, fn);
  const sub = (paidUntil: string) => ({
    planId: 'm1',
    seats: 10,
    paidUntil: paidUntil as `${number}-${number}-${number}`,
    free: false,
    reason: 'Тест',
  });

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    await seedAllPlatformDictionaries(db.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец', login, passwordHash: 'x' });
    a = await createOrganization(db.app.db, {
      name: 'ОсОО «Альфа»',
      inn: '01811201810470',
      slug: 'asub-a',
      owner: owner('asub-owner-a'),
      subscription: sub('2027-03-01'),
    });
    b = await createOrganization(db.app.db, {
      name: 'ОсОО «Бета»',
      inn: '02811201810471',
      slug: 'asub-b',
      owner: owner('asub-owner-b'),
      subscription: null,
    });
    c = await createOrganization(db.app.db, {
      name: 'ОсОО «Гамма»',
      inn: '02811201810472',
      slug: 'asub-c',
      owner: owner('asub-owner-c'),
      subscription: sub('2026-11-25'),
    });
    demo = await createOrganization(db.app.db, {
      name: 'Демо',
      inn: '02811201810473',
      slug: 'asub-demo',
      owner: owner('asub-owner-demo'),
      subscription: null,
    });
    await db.admin.db
      .update(organizations)
      .set({ isDemo: true })
      .where(eq(organizations.id, demo.orgId));
    const [admin] = await db.admin.db
      .insert(users)
      .values({ login: 'asub-platform', passwordHash: 'x', isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    // У «Гаммы» — продление на 3 месяца с чеком, прикреплённым 10.11 (дольше «Срока проверки» 3 дня).
    latePay = randomUUID();
    await db.admin.db.insert(subscriptionPayments).values({
      id: latePay,
      orgId: c.orgId,
      kind: 'renew',
      planId: 'm3',
      months: 3,
      seats: 20,
      amount: 570_000,
      receiptKey: `org/${c.orgId}/subs/${latePay}`,
      receiptName: 'Чек_Optima.pdf',
      receiptType: 'application/pdf',
      receiptBytes: 184_320,
      createdBy: c.ownerUserId,
      createdAt: new Date('2026-11-10T10:00:00+06:00'),
    });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('список: все организации, статусы, чек дольше срока первым; не администратору — пусто', async () => {
    const page = await asAdmin((tx) => listSubscriptionsPage(tx, query(), TODAY, t));
    expect(page.rows.map((r) => [r.name, r.status, r.late])).toEqual([
      ['ОсОО «Гамма»', 'pending', true],
      ['ОсОО «Бета»', 'none', false],
      ['ОсОО «Альфа»', 'active', false],
      ['Демо', 'demo', false],
    ]);
    const gamma = page.rows[0]!;
    expect(gamma).toMatchObject({
      planId: 'm1',
      pack: 20,
      seatsUsed: 0,
      paidUntil: '2026-11-25',
      pendingId: latePay,
      pendingAmount: 570_000,
    });
    // Без подписки — «из 2 ГБ» (прототип `subMem`: пакет 0), у демо — без предела; итог по «Пакету».
    const limitOf = (name: string) => page.rows.find((r) => r.name === name)!.bytesLimit;
    expect(limitOf('ОсОО «Бета»')).toBe(2_000 * 1024 * 1024);
    expect(limitOf('Демо')).toBeNull();
    expect(page.totals).toMatchObject({ pack: 30 });
    const kinds = await asAdmin((tx) => listSubscriptionValues(tx, 'kind', TODAY, t));
    expect(kinds.items.map((v) => v.value).sort()).toEqual(['', 'm1']);
    const file = await asAdmin((tx) =>
      exportSubscriptions(tx, query(), ['name', 'kind', 'pack', 'st'], TODAY, t),
    );
    expect(file.rows[0]).toEqual(['ОсОО «Гамма»', 'Месяц', 20, 'subs.st.pending']);
    expect(await asAdmin((tx) => subscriptionsSummary(tx, TODAY))).toEqual({
      byStatus: { pending: 1, none: 1, active: 1, demo: 1 },
      late: 1,
    });
    expect(await asAdmin((tx) => pendingSubscriptionPayments(tx))).toBe(1);
    // Через два дня после чека он ещё в сроке.
    const fresh = await asAdmin((tx) => listSubscriptionsPage(tx, query(), '2026-11-12', t));
    expect(fresh.rows.find((r) => r.id === c.orgId)!.late).toBe(false);
    // Владелец организации не видит ни списка, ни плашек.
    const foreign = await withUserContext(db.app.db, a.ownerUserId, (tx) =>
      listSubscriptionsPage(tx, query(), TODAY, t),
    );
    expect(foreign.total).toBe(0);
    expect(
      await withUserContext(db.app.db, a.ownerUserId, (tx) => subscriptionsSummary(tx, TODAY)),
    ).toEqual({ byStatus: {}, late: 0 });
  });

  it('окно «Подписка организации»: только организация контекста; организация оплаты — только администратору', async () => {
    const card = await adminIn(c.orgId, (tx) => adminSubscriptionCard(tx, c.orgId));
    expect(card.org).toMatchObject({ id: c.orgId, name: 'ОсОО «Гамма»', demo: false });
    expect(card.sub).toMatchObject({ planId: 'm1', seats: 10, paidUntil: '2026-11-25' });
    expect(card.payments).toEqual([
      expect.objectContaining({
        id: latePay,
        kind: 'renew',
        status: 'pending',
        createdBy: { name: expect.any(String), admin: false, system: false },
      }),
    ]);
    expect(card.history.map((h) => h.action)).toEqual(['create']);
    // Чужая организация из контекста другой не видна даже администратору.
    await expect(adminIn(a.orgId, (tx) => adminSubscriptionCard(tx, c.orgId))).rejects.toThrow(
      RecordNotFoundError,
    );
    expect(await asAdmin((tx) => subscriptionPaymentOrg(tx, latePay))).toBe(c.orgId);
    expect(
      await withUserContext(db.app.db, c.ownerUserId, (tx) => subscriptionPaymentOrg(tx, latePay)),
    ).toBeNull();
  });

  it('«Подтвердить оплату»: подписка из заявки, решение один раз, устаревшая версия — отказ', async () => {
    // Владелец решения не принимает: поле решения ему менять нельзя.
    await expect(
      ownerOf(c, (tx) =>
        decidePayment(tx, { id: latePay, version: 1 }, { status: 'rejected', reason: 'Сам' }),
      ),
    ).rejects.toEqual(pgError('23514'));
    await expect(adminIn(c.orgId, (tx) => lockPendingPayment(tx, latePay, 7))).rejects.toThrow(
      RecordChangedError,
    );
    await adminIn(c.orgId, async (tx) => {
      const p = await lockPendingPayment(tx, latePay, 1);
      const cur = await lockSubscription(tx, c.orgId);
      const r = subscriptionConfirm(
        cur,
        pendingPaymentOf(p),
        { months: 3, paidUntil: '2027-02-25' },
        TODAY,
      );
      await saveSubscription(tx, c.orgId, cur, r.sub);
      await decidePayment(
        tx,
        { id: latePay, version: p.version },
        {
          status: 'confirmed',
          months: r.months,
          paidUntil: r.paidUntil,
        },
      );
      await writeSubscriptionHistory(tx, c.orgId, 'sub_paid', [
        { field: 'paidUntil', from: '2026-11-25', to: '2027-02-25' },
      ]);
    });
    const card = await adminIn(c.orgId, (tx) => adminSubscriptionCard(tx, c.orgId));
    expect(card.sub).toMatchObject({
      planId: 'm3',
      seats: 20,
      paidUntil: '2027-02-25',
      firstPaid: true,
      free: false,
      version: 2,
    });
    expect(card.payments[0]).toMatchObject({
      status: 'confirmed',
      months: 3,
      paidUntil: '2027-02-25',
      decidedBy: { name: null, admin: true },
      version: 2,
    });
    expect(card.history.map((h) => [h.action, h.actorAdmin])).toEqual([
      ['sub_paid', true],
      ['create', false],
    ]);
    await expect(adminIn(c.orgId, (tx) => lockPendingPayment(tx, latePay, 2))).rejects.toThrow(
      SubscriptionPaymentDecidedError,
    );
    expect(await asAdmin((tx) => pendingSubscriptionPayments(tx))).toBe(0);
  });

  it('«Изменить подписку»: бесплатный период — строка «Истории оплат»; владелец подписку не меняет', async () => {
    await adminIn(b.orgId, async (tx) => {
      const cur = await lockSubscription(tx, b.orgId);
      expect(cur).toBeNull();
      const r = subscriptionEdit(
        cur,
        {
          planId: 'm1',
          seats: 10,
          extraGb: 0,
          paidUntil: '2026-12-20',
          extraDiscountPct: 0,
          free: true,
        },
        150,
      )!;
      await saveSubscription(tx, b.orgId, cur, r.sub);
      await insertFreePayment(tx, b.orgId, r.sub, 'Пилот');
      await writeSubscriptionHistory(tx, b.orgId, 'create', r.changes, 'Пилот');
    });
    const card = await adminIn(b.orgId, (tx) => adminSubscriptionCard(tx, b.orgId));
    expect(card.sub).toMatchObject({ paidUntil: '2026-12-20', free: true, version: 1 });
    expect(card.payments).toEqual([
      expect.objectContaining({ kind: 'free', status: 'confirmed', amount: 0, reason: 'Пилот' }),
    ]);
    expect(card.history[0]).toMatchObject({ action: 'create', reason: 'Пилот' });
    // Владелец свою подписку не продлит: строка ему только для чтения.
    expect(
      await ownerOf(b, (tx) =>
        tx
          .update(orgSubscriptions)
          .set({ paidUntil: '2030-01-01' })
          .returning({ id: orgSubscriptions.orgId }),
      ),
    ).toEqual([]);
    await expect(
      ownerOf(b, async (tx) => {
        const cur = await lockSubscription(tx, b.orgId);
        expect(cur).toBeNull();
        await saveSubscription(tx, b.orgId, null, { ...card.sub!, paidUntil: '2030-01-01' });
      }),
    ).rejects.toEqual(denied);
    await expect(
      ownerOf(b, (tx) =>
        insertFreePayment(tx, b.orgId, { ...card.sub!, paidUntil: '2030-01-01' }, 'Сам себе'),
      ),
    ).rejects.toEqual(denied);
    // Два первых сохранения разом (второй администратор или «Подтвердить оплату»): подписку уже
    // поставили — второе отвечает «запись изменена», а не ошибкой первичного ключа.
    await expect(
      adminIn(b.orgId, (tx) =>
        saveSubscription(tx, b.orgId, null, { ...card.sub!, paidUntil: '2030-01-01' }),
      ),
    ).rejects.toThrow(RecordChangedError);
    expect((await adminIn(b.orgId, (tx) => adminSubscriptionCard(tx, b.orgId))).sub).toMatchObject({
      paidUntil: '2026-12-20',
      version: 1,
    });
  });

  it('«Виды подписок» и «Цены и реквизиты»: правит только администратор, с версией и историей', async () => {
    const plan = {
      name: '2 месяца',
      months: 2,
      discountPct: 3,
      perks: ['Скидка 3 %'],
      sortOrder: 15,
      active: true,
    };
    await asAdmin((tx) => createSubscriptionPlan(tx, plan, 'k2m'));
    await expect(
      withUserContext(db.app.db, a.ownerUserId, (tx) => createSubscriptionPlan(tx, plan, 'k2x')),
    ).rejects.toEqual(denied);
    const usage = await asAdmin((tx) => subscriptionPlanUsage(tx));
    expect(usage.get('m1')).toEqual({ subs: 2, pays: 1 });
    expect(usage.get('m3')).toEqual({ subs: 1, pays: 1 });
    expect(usage.get('k2m')).toEqual({ subs: 0, pays: 0 });
    await asAdmin(async (tx) => {
      const k = await lockSubscriptionPlan(tx, 'k2m', 1);
      await updateSubscriptionPlan(tx, k, { ...plan, months: 36 }, [
        { field: 'months', from: 2, to: 36 },
      ]);
    });
    await expect(asAdmin((tx) => lockSubscriptionPlan(tx, 'k2m', 1))).rejects.toThrow(
      RecordChangedError,
    );
    // Срок вида — не больше 36 месяцев (миграция 0167).
    await expect(
      asAdmin((tx) =>
        tx.update(subscriptionPlans).set({ months: 37 }).where(eq(subscriptionPlans.id, 'k2m')),
      ),
    ).rejects.toEqual(pgError('23514'));
    await asAdmin(async (tx) => {
      const k = await lockSubscriptionPlan(tx, 'k2m', 2);
      await deleteSubscriptionPlan(tx, k);
    });
    await expect(
      asAdmin(async (tx) => {
        const k = await lockSubscriptionPlan(tx, 'm1', 1);
        await deleteSubscriptionPlan(tx, k);
      }),
    ).rejects.toEqual(pgError('23503'));

    await asAdmin((tx) =>
      updateSubscriptionSettings(tx, 1, { seatPrice: 12_000, recipient: 'ОсОО «Бухучёт»' }, [
        { field: 'seatPrice', from: 10_000, to: 12_000 },
      ]),
    );
    await expect(
      asAdmin((tx) => updateSubscriptionSettings(tx, 1, { seatPrice: 1 }, [])),
    ).rejects.toThrow(RecordChangedError);
    // Владелец организации цены не меняет: строка ему только для чтения.
    await expect(
      withUserContext(db.app.db, a.ownerUserId, (tx) =>
        updateSubscriptionSettings(tx, 2, { seatPrice: 1 }, []),
      ),
    ).rejects.toThrow(RecordNotFoundError);
    const hist = await asAdmin((tx) => subscriptionConfigHistory(tx));
    expect(hist.map((h) => [h.entity, h.entityId, h.action, h.plan])).toEqual([
      ['subscription_settings', '1', 'update', null],
      ['subscription_plan', 'k2m', 'delete', null],
      ['subscription_plan', 'k2m', 'update', null],
      ['subscription_plan', 'k2m', 'create', null],
    ]);
    expect(
      await withUserContext(db.app.db, a.ownerUserId, (tx) => subscriptionConfigHistory(tx)),
    ).toEqual([]);
    const [m1] = await db.admin.db
      .select({ n: sql<number>`count(*)::integer` })
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, 'k2m'));
    expect(Number(m1!.n)).toBe(0);
  });
});
