import { randomUUID } from 'node:crypto';
import { SUBSCRIPTION_LAUNCH_REASON } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import { createContractor, type ContractorFields } from './contractors';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  contractorSentFiles,
  contractors,
  files,
  organizations,
  orgSubscriptions,
  subscriptionPayments,
  subscriptionPlans,
  subscriptionSettings,
  users,
} from './schema';
import { adminOrgUsage, orgUsage } from './subscriptions';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const MB = 1024 * 1024;
const denied = expect.objectContaining({
  cause: expect.objectContaining({ code: expect.stringMatching(/^(42501|23514)$/) }),
});
const pgError = (code: string, constraint?: string) =>
  expect.objectContaining({
    cause: expect.objectContaining({
      code,
      ...(constraint ? { constraint_name: constraint } : {}),
    }),
  });
/** Отказ политики RLS (не проверки и не триггера). */
const rls = pgError('42501');
/** Отказ триггера `app.subscription_payments_guard`: это поле после отправки не меняется. */
const guard = pgError('23514', 'subscription_payments_guard');

const contractor = (inn: string, name: string): ContractorFields => ({
  name,
  inn,
  phone: '+996505890076',
  kind: 'regular',
  formCode: 'ФС-01',
  regimeCode: 'РЕЖ-01',
  regime2Code: null,
  gked: '46.34.0',
  gkedExtra: [],
  taxOfficeCode: null,
  bizSize: 'small',
  benefits: [],
  bases: [],
  responsibleEmployeeId: null,
  head: '',
  contact: '',
  contractNo: '',
  contractDate: null,
  note: '',
  registration: {},
  startDate: '2024-07-16',
  firstMonthMode: 'full',
  feeDay: 10,
  paysTo: 'emp',
  gkedConfirmation: null,
});

// Подписки организаций (доработки 20.11.2026, блоки 1–6; миграция 0165, этап 0, пункты П1, П4, П5).
describe.skipIf(!databaseAvailable())(
  'подписки: таблицы, запуск тарификации, занято мест и памяти',
  () => {
    let db: TestDatabase;
    let a: CreatedOrganization;
    let b: CreatedOrganization;
    let demo: CreatedOrganization;
    let adminId = '';
    type Fn<T> = Parameters<typeof withOrgContext<T>>[2];
    const inA = <T>(fn: Fn<T>) =>
      withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
    const inB = <T>(fn: Fn<T>) =>
      withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);
    const adminIn = <T>(orgId: string, fn: Fn<T>) =>
      withOrgContext(db.app.db, { orgId, userId: adminId }, fn);
    const asAdmin = <T>(fn: Parameters<typeof withUserContext<T>>[2]) =>
      withUserContext(db.app.db, adminId, fn);
    const receipt = (orgId: string, id: string) => ({
      receiptKey: `org/${orgId}/subs/${id}`,
      receiptName: 'Чек_Optima.pdf',
      receiptType: 'application/pdf',
      receiptBytes: 184_320,
    });
    const launch = async (on: string) => {
      const rows = await db.admin.db.execute<{ n: number }>(
        sql`select app.subscriptions_launch(${on}::date) as n`,
      );
      return Number(rows[0]!.n);
    };
    const addFile = async (
      orgId: string,
      userId: string,
      sizeBytes: number,
      state = 'ready',
      over: Partial<typeof files.$inferInsert> = {},
    ) => {
      const id = randomUUID();
      await db.admin.db.insert(files).values({
        id,
        orgId,
        sourceKind: 'manual',
        name: `Файл ${id.slice(0, 4)}.pdf`,
        contentType: 'application/pdf',
        sizeBytes,
        storageKey: `org/${orgId}/files/${id}`,
        state: state as 'ready',
        createdBy: userId,
        ...(state === 'deleted' ? { deletedAt: new Date(), deletedBy: userId } : {}),
        ...over,
      });
      return id;
    };
    const addContractors = async (
      org: CreatedOrganization,
      from: number,
      n: number,
      prefix: string,
    ) => {
      const ids: string[] = [];
      for (let i = from; i < from + n; i++)
        ids.push(
          await withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, (tx) =>
            createContractor(
              tx,
              org.orgId,
              contractor(`0380781946${String(1900 + i)}`, `ОсОО «${prefix}${i}»`),
              null,
            ),
          ),
        );
      return ids;
    };
    const archive = (ids: string[]) =>
      db.admin.db
        .update(contractors)
        .set({ serviceStatus: 'archived' })
        .where(sql`${contractors.id} in ${ids}`);

    beforeAll(async () => {
      db = await createTestDatabase();
      await seedAccessReference(db.admin.db);
      await seedAllPlatformDictionaries(db.admin.db);
      const owner = (login: string) => ({ fullName: 'Владелец', login, passwordHash: 'x' });
      a = await createOrganization(db.app.db, {
        name: 'Организация А',
        inn: '01811201810460',
        slug: 'subs-a',
        owner: owner('subs-owner-a'),
      });
      b = await createOrganization(db.app.db, {
        name: 'Организация Б',
        inn: '02811201810461',
        slug: 'subs-b',
        owner: owner('subs-owner-b'),
      });
      demo = await createOrganization(db.app.db, {
        name: 'Демо',
        inn: '02811201810462',
        slug: 'subs-demo',
        owner: owner('subs-owner-demo'),
      });
      await db.admin.db
        .update(organizations)
        .set({ isDemo: true })
        .where(eq(organizations.id, demo.orgId));
      // У А — 12 активных и один архивный контрагент: пакет при запуске — 20 (округление вверх).
      const ofA = await addContractors(a, 0, 13, 'А');
      await archive(ofA.slice(12));
      // У Б — ровно 10 активных и один архивный: пакет — 10 (архивный не считается, кратное шагу — как есть).
      const ofB = await addContractors(b, 0, 11, 'Б');
      await archive(ofB.slice(10));
      const [admin] = await db.admin.db
        .insert(users)
        .values({ login: 'subs-platform', passwordHash: 'x', isPlatformAdmin: true })
        .returning({ id: users.id });
      adminId = admin!.id;
    });

    afterAll(async () => {
      await db?.drop();
    });

    it('начальные виды подписок и «Цены и реквизиты» — как в прототипе; читают все, меняет только администратор', async () => {
      const plans = await inA((tx) =>
        tx.select().from(subscriptionPlans).orderBy(subscriptionPlans.sortOrder),
      );
      expect(plans.map((p) => [p.id, p.months, p.discountPct])).toEqual([
        ['m1', 1, 0],
        ['m3', 3, 5],
        ['m6', 6, 10],
        ['m9', 9, 15],
        ['m12', 12, 20],
      ]);
      const [st] = await inA((tx) => tx.select().from(subscriptionSettings));
      expect(st).toMatchObject({
        seatPrice: 10_000,
        seatStep: 10,
        gbPrice: 10_000,
        baseMb: 2000,
        seatMb: 200,
        firstMonthPct: 50,
        extraDiscountOver: 150,
        remindDays: 7,
        checkDays: 3,
        recipient: null,
      });
      // Организация не меняет ни видов, ни цен: строки просто не находятся.
      const changed = await inA((tx) =>
        tx
          .update(subscriptionSettings)
          .set({ seatPrice: 1 })
          .returning({ id: subscriptionSettings.id }),
      );
      expect(changed).toEqual([]);
      await expect(
        inA((tx) =>
          tx
            .insert(subscriptionPlans)
            .values({ id: 'free', name: 'Даром', months: 1, sortOrder: 9 }),
        ),
      ).rejects.toEqual(denied);
      const byAdmin = await asAdmin((tx) =>
        tx
          .update(subscriptionPlans)
          .set({ perks: ['Скидка 5 %'] })
          .where(eq(subscriptionPlans.id, 'm3'))
          .returning({ id: subscriptionPlans.id }),
      );
      expect(byAdmin).toEqual([{ id: 'm3' }]);
      // Вид с подписками удалить нельзя — только выключить; без них — можно.
      await asAdmin((tx) =>
        tx
          .insert(subscriptionPlans)
          .values({ id: 'm2', name: '2 месяца', months: 2, sortOrder: 6 }),
      );
      expect(
        await asAdmin((tx) =>
          tx
            .delete(subscriptionPlans)
            .where(eq(subscriptionPlans.id, 'm2'))
            .returning({ id: subscriptionPlans.id }),
        ),
      ).toEqual([{ id: 'm2' }]);
    });

    it('запуск: пакет по активным с округлением до 10, «Оплачено до» через 30 дней, демо — без подписки; повтор ничего не меняет', async () => {
      await db.admin.db.delete(subscriptionPayments);
      await db.admin.db.delete(orgSubscriptions);
      expect(await launch('2026-11-20')).toBe(2);
      expect(await launch('2026-11-20')).toBe(0);
      const subs = await db.admin.db.select().from(orgSubscriptions);
      const subA = subs.find((s) => s.orgId === a.orgId)!;
      expect(subA).toMatchObject({
        planId: 'm1',
        seats: 20,
        paidUntil: '2026-12-20',
        free: true,
        firstPaid: false,
      });
      expect(subs.find((s) => s.orgId === b.orgId)).toMatchObject({
        seats: 10,
        paidUntil: '2026-12-20',
      });
      expect(subs.find((s) => s.orgId === demo.orgId)).toBeUndefined();
      const pays = await db.admin.db
        .select()
        .from(subscriptionPayments)
        .where(eq(subscriptionPayments.orgId, a.orgId));
      expect(pays).toEqual([
        expect.objectContaining({
          kind: 'free',
          status: 'confirmed',
          amount: 0,
          months: 0,
          seats: 20,
          createdBy: null,
          paidUntil: '2026-12-20',
          reason: SUBSCRIPTION_LAUNCH_REASON,
        }),
      ]);
      // Вид, у которого есть подписки, удалить нельзя (внешний ключ) — только выключить.
      await expect(
        asAdmin((tx) => tx.delete(subscriptionPlans).where(eq(subscriptionPlans.id, 'm1'))),
      ).rejects.toEqual(pgError('23503'));
      // Роль приложения запуск не вызывает.
      await expect(
        inA((tx) => tx.execute(sql`select app.subscriptions_launch('2026-11-20'::date)`)),
      ).rejects.toEqual(
        expect.objectContaining({ cause: expect.objectContaining({ code: '42501' }) }),
      );
    });

    it('повтор запуска в день включения закрытия продлевает только тех, кто ничего не платил', async () => {
      // Б прислал чек — у него уже не «только запуск».
      const pay = randomUUID();
      await inB((tx) =>
        tx.insert(subscriptionPayments).values({
          id: pay,
          kind: 'renew',
          planId: 'm1',
          months: 1,
          seats: 10,
          amount: 50_000,
          ...receipt(b.orgId, pay),
        }),
      );
      // У А контрагентов стало больше (21 активный): повтор поднимает пакет до 30 и пишет вторую запись.
      const more = await addContractors(a, 13, 9, 'А');
      expect(await launch('2026-12-15')).toBe(1);
      const subs = await db.admin.db.select().from(orgSubscriptions);
      expect(subs.find((s) => s.orgId === a.orgId)).toMatchObject({
        paidUntil: '2027-01-14',
        seats: 30,
      });
      expect(subs.find((s) => s.orgId === b.orgId)!.paidUntil).toBe('2026-12-20');
      const pays = await db.admin.db
        .select({ seats: subscriptionPayments.seats, paidUntil: subscriptionPayments.paidUntil })
        .from(subscriptionPayments)
        .where(eq(subscriptionPayments.orgId, a.orgId))
        .orderBy(subscriptionPayments.paidUntil);
      expect(pays).toEqual([
        { seats: 20, paidUntil: '2026-12-20' },
        { seats: 30, paidUntil: '2027-01-14' },
      ]);
      await archive(more);
      await db.admin.db.delete(subscriptionPayments).where(eq(subscriptionPayments.id, pay));
    });

    it('чужая подписка и оплаты не видны; Админка вне организации видит все, сотрудник вне организации — ничего', async () => {
      expect((await inA((tx) => tx.select().from(orgSubscriptions))).map((s) => s.orgId)).toEqual([
        a.orgId,
      ]);
      const ofB = await db.admin.db
        .select({ id: subscriptionPayments.id })
        .from(subscriptionPayments)
        .where(eq(subscriptionPayments.orgId, b.orgId));
      expect(ofB.length).toBeGreaterThan(0);
      expect(
        (await inB((tx) => tx.select({ id: subscriptionPayments.id }).from(subscriptionPayments)))
          .map((p) => p.id)
          .sort(),
      ).toEqual(ofB.map((p) => p.id).sort());
      // Вставить строку с чужой организацией нельзя — ни подписку, ни оплату.
      const foreign = randomUUID();
      await expect(
        inA((tx) =>
          tx.insert(subscriptionPayments).values({
            id: foreign,
            orgId: b.orgId,
            kind: 'renew',
            planId: 'm1',
            months: 1,
            seats: 10,
            ...receipt(b.orgId, foreign),
          }),
        ),
      ).rejects.toEqual(rls);
      await expect(
        inA((tx) =>
          tx.insert(orgSubscriptions).values({
            orgId: a.orgId,
            planId: 'm1',
            seats: 10,
            paidUntil: '2027-01-01',
          }),
        ),
      ).rejects.toEqual(rls);
      const all = await asAdmin((tx) =>
        tx.select({ id: orgSubscriptions.orgId }).from(orgSubscriptions),
      );
      expect(all.map((r) => r.id).sort()).toEqual([a.orgId, b.orgId].sort());
      const outside = await withUserContext(db.app.db, a.ownerUserId, (tx) =>
        tx.select().from(orgSubscriptions),
      );
      expect(outside).toEqual([]);
      // Организация свою подписку не меняет.
      expect(
        await inA((tx) =>
          tx.update(orgSubscriptions).set({ seats: 500 }).returning({ id: orgSubscriptions.orgId }),
        ),
      ).toEqual([]);
      await expect(inA((tx) => tx.delete(orgSubscriptions))).rejects.toEqual(rls);
      // «Со следующего месяца» — с днём и хотя бы одним значением, либо ничего.
      for (const next of [
        { nextFrom: '2027-01-01' },
        { nextSeats: 30 },
        { nextFrom: '2027-01-01', nextSeats: -1 },
      ]) {
        await expect(
          adminIn(a.orgId, (tx) =>
            tx.update(orgSubscriptions).set(next).where(eq(orgSubscriptions.orgId, a.orgId)),
          ),
        ).rejects.toEqual(pgError('23514', 'org_subscriptions_next_check'));
      }
    });

    it('оплаты: заявка с чеком — от себя, одна за раз; запись без чека — только администратор; меняются только разрешённые поля', async () => {
      const id = randomUUID();
      const base = { kind: 'grow' as const, planId: 'm1', months: 1, seats: 30, amount: 100_000 };
      // Без чека, сразу подтверждённая, бесплатная или от чужого имени — нельзя.
      await expect(
        inA((tx) => tx.insert(subscriptionPayments).values({ id, ...base })),
      ).rejects.toEqual(denied);
      await expect(
        inA((tx) =>
          tx.insert(subscriptionPayments).values({
            id,
            ...base,
            kind: 'free',
            status: 'confirmed',
            decidedAt: new Date(),
            paidUntil: '2027-01-01',
            reason: 'Сам себе',
          }),
        ),
      ).rejects.toEqual(denied);
      await expect(
        inA((tx) =>
          tx
            .insert(subscriptionPayments)
            .values({ id, ...base, ...receipt(a.orgId, id), createdBy: b.ownerUserId }),
        ),
      ).rejects.toEqual(denied);
      // Ключ чека — только в папке оплат своей организации и с номером оплаты; тип и размер — обязательно.
      await expect(
        inA((tx) =>
          tx.insert(subscriptionPayments).values({ id, ...base, ...receipt(b.orgId, id) }),
        ),
      ).rejects.toEqual(denied);
      for (const bad of [
        { receiptType: null },
        { receiptBytes: null },
        { receiptType: null, receiptBytes: null },
        { receiptType: 'text/html' },
        { receiptBytes: 21 * MB },
      ]) {
        await expect(
          inA((tx) =>
            tx
              .insert(subscriptionPayments)
              .values({ id, ...base, ...receipt(a.orgId, id), ...bad }),
          ),
        ).rejects.toEqual(pgError('23514', 'subscription_payments_receipt_check'));
      }
      // Заявка — без полей решения: «решил» и «Оплачено до» ставит только администратор.
      for (const bad of [
        { decidedBy: adminId },
        { paidUntil: '2027-01-01' },
        { reason: 'Подтверждено' },
      ]) {
        await expect(
          inA((tx) =>
            tx
              .insert(subscriptionPayments)
              .values({ id, ...base, ...receipt(a.orgId, id), ...bad }),
          ),
        ).rejects.toEqual(rls);
      }
      await inA((tx) =>
        tx.insert(subscriptionPayments).values({ id, ...base, ...receipt(a.orgId, id) }),
      );
      const second = randomUUID();
      await expect(
        inA((tx) =>
          tx
            .insert(subscriptionPayments)
            .values({ id: second, ...base, ...receipt(a.orgId, second) }),
        ),
      ).rejects.toEqual(
        expect.objectContaining({ cause: expect.objectContaining({ code: '23505' }) }),
      );
      // Владелец меняет только файл чека; сумму, пакет и статус — нет.
      await inA((tx) =>
        tx
          .update(subscriptionPayments)
          .set({ receiptName: 'Чек_новый.pdf' })
          .where(eq(subscriptionPayments.id, id)),
      );
      for (const set of [
        { amount: 1 },
        { seats: 500 },
        { kind: 'renew' as const },
        { startMode: 'next' as const },
        { planId: 'm3' },
        { extraGb: 5 },
        { lines: [{ label: 'Скидка', sum: -1 }] },
        { months: 3 },
        { paidUntil: '2027-01-01' },
        { reason: 'Сам' },
        { createdBy: b.ownerUserId },
        { opensAccess: false },
      ]) {
        await expect(
          inA((tx) =>
            tx.update(subscriptionPayments).set(set).where(eq(subscriptionPayments.id, id)),
          ),
        ).rejects.toEqual(guard);
      }
      // Тип и размер чека владелец меняет вместе с файлом, но пустыми не оставляет.
      for (const set of [{ receiptType: null }, { receiptBytes: null }]) {
        await expect(
          inA((tx) =>
            tx.update(subscriptionPayments).set(set).where(eq(subscriptionPayments.id, id)),
          ),
        ).rejects.toEqual(pgError('23514', 'subscription_payments_receipt_check'));
      }
      await expect(
        inA((tx) =>
          tx
            .update(subscriptionPayments)
            .set({
              status: 'confirmed',
              decidedAt: new Date(),
              decidedBy: a.ownerUserId,
              paidUntil: '2027-01-01',
            })
            .where(eq(subscriptionPayments.id, id)),
        ),
      ).rejects.toEqual(denied);
      // Администратор подтверждает от своего имени, сумму, пакет, чек и расчёт не меняет; подтверждённая
      // больше не меняется.
      for (const set of [
        { receiptName: 'Другой.pdf' },
        { receiptType: 'image/png' },
        { receiptBytes: 1 },
        { seats: 500 },
        { extraGb: 5 },
        { kind: 'renew' as const },
        { startMode: 'next' as const },
        { opensAccess: false },
        { lines: [{ label: 'Скидка', sum: -1 }] },
      ]) {
        await expect(
          adminIn(a.orgId, (tx) =>
            tx.update(subscriptionPayments).set(set).where(eq(subscriptionPayments.id, id)),
          ),
        ).rejects.toEqual(guard);
      }
      await expect(
        adminIn(a.orgId, (tx) =>
          tx
            .update(subscriptionPayments)
            .set({
              status: 'confirmed',
              decidedAt: new Date(),
              decidedBy: a.ownerUserId,
              paidUntil: '2026-12-20',
            })
            .where(eq(subscriptionPayments.id, id)),
        ),
      ).rejects.toEqual(rls);
      await expect(
        adminIn(a.orgId, (tx) =>
          tx
            .update(subscriptionPayments)
            .set({
              status: 'confirmed',
              decidedAt: new Date(),
              decidedBy: adminId,
              paidUntil: '2026-12-20',
              amount: 1,
            })
            .where(eq(subscriptionPayments.id, id)),
        ),
      ).rejects.toEqual(denied);
      await adminIn(a.orgId, (tx) =>
        tx
          .update(subscriptionPayments)
          .set({
            status: 'confirmed',
            decidedAt: new Date(),
            decidedBy: adminId,
            paidUntil: '2026-12-20',
          })
          .where(eq(subscriptionPayments.id, id)),
      );
      expect(
        await adminIn(a.orgId, (tx) =>
          tx
            .update(subscriptionPayments)
            .set({ reason: 'Передумал' })
            .where(eq(subscriptionPayments.id, id))
            .returning({ id: subscriptionPayments.id }),
        ),
      ).toEqual([]);
      // Запись администратора без чека — от его имени и сразу подтверждённая; удалить оплату нельзя никому.
      const free = randomUUID();
      await adminIn(a.orgId, (tx) =>
        tx.insert(subscriptionPayments).values({
          id: free,
          kind: 'free',
          planId: 'm1',
          months: 0,
          seats: 30,
          status: 'confirmed',
          decidedBy: adminId,
          decidedAt: new Date(),
          paidUntil: '2026-12-31',
          reason: 'Бесплатный период',
        }),
      );
      await expect(
        adminIn(a.orgId, (tx) =>
          tx.delete(subscriptionPayments).where(eq(subscriptionPayments.id, free)),
        ),
      ).rejects.toEqual(denied);
      await db.admin.db
        .delete(subscriptionPayments)
        .where(sql`${subscriptionPayments.id} in ${[id, free]}`);
    });

    it('занято мест и памяти, статус и закрытие — одной функцией; своя организация, Админка — все', async () => {
      await db.admin.db.delete(subscriptionPayments);
      await db.admin.db.delete(orgSubscriptions);
      await launch('2026-11-20');
      await addFile(a.orgId, a.ownerUserId, 3 * MB);
      await addFile(a.orgId, a.ownerUserId, 2 * MB);
      await addFile(a.orgId, a.ownerUserId, 7 * MB, 'deleted');
      const cp = (
        await db.admin.db
          .select({ id: contractors.id })
          .from(contractors)
          .where(eq(contractors.orgId, a.orgId))
          .limit(1)
      )[0]!.id;
      const sent = (status: 'new' | 'accepted' | 'rejected', fileId?: string) => {
        const id = randomUUID();
        return db.admin.db.insert(contractorSentFiles).values({
          id,
          orgId: a.orgId,
          contractorId: cp,
          source: 'page',
          name: 'Чек.pdf',
          contentType: 'application/pdf',
          sizeBytes: MB,
          storageKey: `org/${a.orgId}/sent/${id}`,
          state: 'ready',
          status,
          ...(status === 'rejected'
            ? { rejectReason: 'Не тот', decidedAt: new Date(), decidedBy: a.ownerUserId }
            : {}),
          ...(status === 'accepted'
            ? { fileId, decidedAt: new Date(), decidedBy: a.ownerUserId }
            : {}),
        });
      };
      await sent('new');
      await sent('rejected');
      // Принятый файл контрагента считается один раз — своей строкой файла (4 МБ), а не присланным.
      const kept = await addFile(a.orgId, a.ownerUserId, 4 * MB, 'ready', {
        sourceKind: 'contractor',
        contractorId: cp,
      });
      await sent('accepted', kept);
      // Документы заявки и загрузка в процессе — не память организации.
      await addFile(a.orgId, a.ownerUserId, 9 * MB, 'ready', { sourceKind: 'lead' });
      await addFile(a.orgId, a.ownerUserId, 8 * MB, 'pending');

      const u = await inA((tx) => orgUsage(tx, '2026-11-25'));
      expect(u).toEqual({
        orgId: a.orgId,
        demo: false,
        seatsUsed: 12,
        seatsLimit: 20,
        extraGb: 0,
        // Загруженные 3 + 2 + 4 МБ и присланные, ещё не принятые 1 + 1 МБ; удалённый, ещё не
        // загруженный, принятый (уже посчитан файлом) и документы заявки — не считаются.
        bytesUsed: 11 * MB,
        // 2 ГБ + 200 МБ × 20 мест = 6 000 МБ.
        bytesLimit: 6000 * MB,
        paidUntil: '2026-12-20',
        status: 'active',
        closed: false,
      });
      expect(
        (await inA((tx) => orgUsage(tx, '2026-11-25', { bytes: false })))!.bytesUsed,
      ).toBeNull();
      // «Скоро истекает» — за 7 дней; в последний оплаченный день доступ открыт, на следующий — закрыт.
      expect((await inA((tx) => orgUsage(tx, '2026-12-12')))!.status).toBe('active');
      expect((await inA((tx) => orgUsage(tx, '2026-12-13')))!.status).toBe('expiring');
      expect(await inA((tx) => orgUsage(tx, '2026-12-20'))).toMatchObject({
        status: 'expiring',
        closed: false,
      });
      expect(await inA((tx) => orgUsage(tx, '2026-12-21'))).toMatchObject({
        status: 'overdue',
        closed: true,
      });

      // Чек на проверке открывает доступ и сразу даёт места и память «Сейчас».
      const pay = randomUUID();
      await inA((tx) =>
        tx.insert(subscriptionPayments).values({
          id: pay,
          kind: 'renew',
          planId: 'm1',
          months: 1,
          seats: 40,
          extraGb: 3,
          amount: 400_000,
          ...receipt(a.orgId, pay),
        }),
      );
      expect(await inA((tx) => orgUsage(tx, '2026-12-21'))).toMatchObject({
        status: 'pending',
        closed: false,
        seatsLimit: 40,
        extraGb: 3,
        bytesLimit: (2000 + 200 * 40 + 3000) * MB,
      });
      // Чек после отклонения доступ заранее не открывает и мест не даёт — это решает база, а не запрос.
      await adminIn(a.orgId, (tx) =>
        tx
          .update(subscriptionPayments)
          .set({
            status: 'rejected',
            decidedAt: new Date(),
            decidedBy: adminId,
            reason: 'Сумма не та',
          })
          .where(eq(subscriptionPayments.id, pay)),
      );
      const again = randomUUID();
      await inA((tx) =>
        tx.insert(subscriptionPayments).values({
          id: again,
          kind: 'renew',
          planId: 'm1',
          months: 1,
          seats: 40,
          amount: 400_000,
          opensAccess: true,
          ...receipt(a.orgId, again),
        }),
      );
      const [row] = await db.admin.db
        .select({ open: subscriptionPayments.opensAccess })
        .from(subscriptionPayments)
        .where(eq(subscriptionPayments.id, again));
      expect(row!.open).toBe(false);
      // Открыть доступ самому владелец не может.
      await expect(
        inA((tx) =>
          tx
            .update(subscriptionPayments)
            .set({ opensAccess: true })
            .where(eq(subscriptionPayments.id, again)),
        ),
      ).rejects.toEqual(guard);
      expect(await inA((tx) => orgUsage(tx, '2026-12-21'))).toMatchObject({
        status: 'pending',
        closed: true,
        seatsLimit: 20,
      });
      await db.admin.db
        .delete(subscriptionPayments)
        .where(sql`${subscriptionPayments.id} in ${[pay, again]}`);
      // «Со следующего месяца» — с того дня.
      await db.admin.db
        .update(orgSubscriptions)
        .set({ nextSeats: 30, nextExtraGb: 1, nextFrom: '2026-12-01' })
        .where(eq(orgSubscriptions.orgId, a.orgId));
      expect((await inA((tx) => orgUsage(tx, '2026-11-30')))!.seatsLimit).toBe(20);
      expect(await inA((tx) => orgUsage(tx, '2026-12-01'))).toMatchObject({
        seatsLimit: 30,
        extraGb: 1,
      });

      // Админка вне организации — все; демо — без пределов и не закрывается; сотрудник вне организации — ничего.
      const all = await asAdmin((tx) => adminOrgUsage(tx, '2026-12-25', { bytes: false }));
      const byOrg = new Map(all.map((r) => [r.orgId, r]));
      expect(byOrg.get(b.orgId)).toMatchObject({
        seatsUsed: 10,
        seatsLimit: 10,
        status: 'overdue',
        closed: true,
      });
      expect(byOrg.get(demo.orgId)).toMatchObject({
        demo: true,
        status: 'demo',
        closed: false,
        seatsLimit: null,
        bytesLimit: null,
      });
      expect(
        await withUserContext(db.app.db, a.ownerUserId, (tx) => adminOrgUsage(tx, '2026-12-25')),
      ).toEqual([]);
      expect(await inB((tx) => adminOrgUsage(tx, '2026-12-25'))).toEqual([
        expect.objectContaining({ orgId: b.orgId }),
      ]);
      // Организация без подписки — «Нет подписки», доступ закрыт, предела памяти нет (прототип afMem).
      await db.admin.db.delete(subscriptionPayments).where(eq(subscriptionPayments.orgId, b.orgId));
      await db.admin.db.delete(orgSubscriptions).where(eq(orgSubscriptions.orgId, b.orgId));
      expect(await inB((tx) => orgUsage(tx, '2026-11-25'))).toMatchObject({
        status: 'none',
        closed: true,
        seatsLimit: 0,
        bytesLimit: null,
        paidUntil: null,
      });
    });
  },
);
