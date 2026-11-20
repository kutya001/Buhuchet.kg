import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import { createContractor } from './contractors';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  contractorSentFiles,
  files,
  fileTrash,
  organizations,
  orgMemoryNotices,
  orgSubscriptions,
  storageCheckItems,
  storageCheckRuns,
  subscriptionPayments,
  telegramLinks,
  telegramOutbox,
  users,
} from './schema';
import {
  adminPendingSubscriptionPayments,
  memoryNoticeLevel,
  orgSubscriptionTerms,
  pendingSubscriptionPayment,
  platformNotice,
  saveStorageCheck,
  setMemoryNoticeLevel,
  storageCheckRunsWithNews,
  subscriptionNoticeSettings,
  type StorageCheckObject,
} from './subscription-notices';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const HOUR = 3_600_000;
const NOW = new Date('2026-11-21T03:30:00Z');
const ago = (h: number) => new Date(NOW.getTime() - h * HOUR);

// Сообщения о подписке, памяти и сверке хранилища (доработки 20.11.2026; поток Т, этап 1, П12–П13;
// миграции 0169–0170).
describe.skipIf(!databaseAvailable())('подписки и хранилище: сообщения и сверка', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId = '';
  let cpA = '';
  /** Ключи из прежних тестов, объекты которых лежат в хранилище (иначе сверка сочтёт их пропавшими). */
  const present: string[] = [];
  type Fn<T> = Parameters<typeof withOrgContext<T>>[2];
  const inA = <T>(fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
  const inB = <T>(fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);
  const jobIn = <T>(orgId: string, fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId, kind: 'job' }, fn);
  const asAdmin = <T>(fn: Parameters<typeof withUserContext<T>>[2]) =>
    withUserContext(db.app.db, adminId, fn);

  const addFile = async (
    orgId: string,
    state: 'ready' | 'pending' | 'deleted',
    createdAt: Date,
    id = randomUUID(),
  ) => {
    const key = `org/${orgId}/files/${id}`;
    const by = orgId === a.orgId ? a.ownerUserId : b.ownerUserId;
    await db.admin.db.insert(files).values({
      id,
      orgId,
      sourceKind: 'manual',
      name: `Файл ${id.slice(0, 4)}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 1000,
      storageKey: key,
      state,
      createdBy: by,
      createdAt,
      ...(state === 'deleted' ? { deletedAt: createdAt, deletedBy: by } : {}),
    });
    return key;
  };
  const obj = (key: string, hoursAgo: number, size = 1000): StorageCheckObject => ({
    key,
    size,
    modifiedAt: ago(hoursAgo),
  });

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    await seedAllPlatformDictionaries(db.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец', login, passwordHash: 'x' });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810470',
      slug: 'notice-a',
      owner: owner('notice-owner-a'),
      // «Нет подписки»: подписки тест ставит сам (иначе `createOrganization` даёт бесплатный период).
      subscription: null,
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810471',
      slug: 'notice-b',
      owner: owner('notice-owner-b'),
      subscription: null,
    });
    const [admin] = await db.admin.db
      .insert(users)
      .values({ login: 'notice-platform', passwordHash: 'x', isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    cpA = await inA((tx) =>
      createContractor(
        tx,
        a.orgId,
        {
          name: 'ОсОО «Файлы»',
          inn: '03807819461900',
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
        },
        null,
      ),
    );
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('порог памяти: своя строка, чужая организация не видит и не меняет, повтор обновляет', async () => {
    expect(await inA((tx) => memoryNoticeLevel(tx))).toBe(0);
    await jobIn(a.orgId, (tx) => setMemoryNoticeLevel(tx, 80, NOW));
    await jobIn(a.orgId, (tx) => setMemoryNoticeLevel(tx, 100, NOW));
    expect(await jobIn(a.orgId, (tx) => memoryNoticeLevel(tx))).toBe(100);
    // Б не видит порог А и не может его записать за А.
    expect(await inB((tx) => memoryNoticeLevel(tx))).toBe(0);
    expect(await inB((tx) => tx.select().from(orgMemoryNotices))).toEqual([]);
    await expect(
      inB((tx) => tx.insert(orgMemoryNotices).values({ orgId: a.orgId, level: 80 })),
    ).rejects.toThrow();
    // Б не меняет и не удаляет строку А; без контекста организации не видно ничего.
    const changed = await inB((tx) =>
      tx
        .update(orgMemoryNotices)
        .set({ level: 0 })
        .where(eq(orgMemoryNotices.orgId, a.orgId))
        .returning({ orgId: orgMemoryNotices.orgId }),
    );
    expect(changed).toEqual([]);
    const removed = await inB((tx) =>
      tx
        .delete(orgMemoryNotices)
        .where(eq(orgMemoryNotices.orgId, a.orgId))
        .returning({ orgId: orgMemoryNotices.orgId }),
    );
    expect(removed).toEqual([]);
    expect(await db.app.db.select().from(orgMemoryNotices)).toEqual([]);
    expect(await jobIn(a.orgId, (tx) => memoryNoticeLevel(tx))).toBe(100);
    await expect(jobIn(a.orgId, (tx) => setMemoryNoticeLevel(tx, 50 as 80, NOW))).rejects.toThrow();
  });

  it('подписка и чек на проверке — только своей организации; все чеки — администратору платформы', async () => {
    const settings = await inA((tx) => subscriptionNoticeSettings(tx));
    expect(settings).toMatchObject({ remindDays: 7, checkDays: 3 });
    expect(settings.prices).toMatchObject({ seatPrice: 10_000, seatStep: 10, baseMb: 2_000 });
    expect(await inA((tx) => orgSubscriptionTerms(tx))).toBeNull();
    await db.admin.db.insert(orgSubscriptions).values({
      orgId: a.orgId,
      planId: 'm3',
      seats: 20,
      extraGb: 1,
      paidUntil: '2026-11-25',
    });
    expect(await inA((tx) => orgSubscriptionTerms(tx))).toMatchObject({
      sub: { planId: 'm3', seats: 20, extraGb: 1, paidUntil: '2026-11-25', firstPaid: false },
      plan: { id: 'm3', months: 3 },
    });
    expect(await inB((tx) => orgSubscriptionTerms(tx))).toBeNull();

    const pay = randomUUID();
    await inA((tx) =>
      tx.insert(subscriptionPayments).values({
        id: pay,
        kind: 'renew',
        planId: 'm3',
        months: 3,
        seats: 20,
        amount: 570_000,
        receiptKey: `org/${a.orgId}/subs/${pay}`,
        receiptName: 'Чек.pdf',
        receiptType: 'application/pdf',
        receiptBytes: 1000,
      }),
    );
    present.push(`org/${a.orgId}/subs/${pay}`);
    expect(await inA((tx) => pendingSubscriptionPayment(tx))).toMatchObject({
      id: pay,
      orgId: a.orgId,
      kind: 'renew',
      amount: 570_000,
    });
    expect(await inB((tx) => pendingSubscriptionPayment(tx))).toBeNull();
    // Сотруднику вне контекста своей организации чужие чеки не видны; администратору — все с названием.
    expect(
      await withUserContext(db.app.db, b.ownerUserId, (tx) => adminPendingSubscriptionPayments(tx)),
    ).toEqual([]);
    expect(await asAdmin((tx) => adminPendingSubscriptionPayments(tx))).toEqual([
      expect.objectContaining({
        id: pay,
        orgId: a.orgId,
        orgName: 'Организация А',
        amount: 570_000,
      }),
    ]);
  });

  it('сообщение администраторам: только им, один раз на ключ, только свои виды', async () => {
    await db.admin.db.insert(telegramLinks).values([
      { userId: adminId, orgId: null, chatId: 7001 },
      { userId: a.ownerUserId, orgId: a.orgId, chatId: 7002 },
    ]);
    const send = () =>
      inA((tx) =>
        platformNotice(tx, { kind: 'sub_check', text: 'Новый чек', key: 'new:1', now: NOW }),
      );
    expect(await send()).toBe(1);
    expect(await send()).toBe(0);
    expect(
      await platformNotice(db.app.db, {
        kind: 'storage_check',
        text: 'Сверка',
        key: 'run:1',
        now: NOW,
      }),
    ).toBe(1);
    const rows = await db.admin.db
      .select({
        userId: telegramOutbox.userId,
        orgId: telegramOutbox.orgId,
        kind: telegramOutbox.kind,
        key: telegramOutbox.dedupeKey,
      })
      .from(telegramOutbox)
      .where(sql`${telegramOutbox.kind} in ('sub_check', 'storage_check')`);
    expect(rows).toEqual(
      expect.arrayContaining([
        { userId: adminId, orgId: null, kind: 'sub_check', key: `sub_check:new:1:${adminId}` },
        {
          userId: adminId,
          orgId: null,
          kind: 'storage_check',
          key: `storage_check:run:1:${adminId}`,
        },
      ]),
    );
    expect(rows).toHaveLength(2);
    await expect(
      platformNotice(db.app.db, { kind: 'alert' as 'sub_check', text: 'x', key: 'k', now: NOW }),
    ).rejects.toThrow();
    await expect(
      platformNotice(db.app.db, { kind: 'sub_check', text: ' ', key: 'k', now: NOW }),
    ).rejects.toThrow();
    // Заблокированный администратор не получает.
    await db.admin.db.update(users).set({ blocked: true }).where(eq(users.id, adminId));
    expect(
      await platformNotice(db.app.db, { kind: 'sub_check', text: 'x', key: 'k2', now: NOW }),
    ).toBe(0);
    await db.admin.db.update(users).set({ blocked: false }).where(eq(users.id, adminId));
  });

  it('сверка хранилища: четыре списка, повтор продлевает, пропавшее закрывается', async () => {
    const readyOld = await addFile(a.orgId, 'ready', ago(48));
    const missing = await addFile(a.orgId, 'ready', ago(48));
    const missingYoung = await addFile(a.orgId, 'ready', ago(0.5));
    const stuck = await addFile(b.orgId, 'pending', ago(30));
    const pendingYoung = await addFile(b.orgId, 'pending', ago(2));
    const deletedKey = await addFile(a.orgId, 'deleted', ago(72));
    const extraOld = `org/${b.orgId}/files/${randomUUID()}`;
    const extraYoung = `org/${b.orgId}/files/${randomUUID()}`;
    // Отправленный контрагентом файл загружается: его `.up` — не лишний.
    const sentId = randomUUID();
    const sentKey = `org/${a.orgId}/sent/${sentId}`;
    await db.admin.db.insert(contractorSentFiles).values({
      id: sentId,
      orgId: a.orgId,
      contractorId: cpA,
      source: 'page',
      name: 'Акт.pdf',
      contentType: 'application/pdf',
      sizeBytes: 500,
      storageKey: sentKey,
      createdAt: ago(3),
    });
    // Принятые отправленные файлы: после «Принять» их объект удаляется (файл — уже в «Файлах» контрагента),
    // поэтому без объекта — не «Нет в хранилище», а оставшийся объект — лишний.
    const accepted = async () => {
      const id = randomUUID();
      const fileId = randomUUID();
      await db.admin.db.insert(files).values({
        id: fileId,
        orgId: a.orgId,
        contractorId: cpA,
        sourceKind: 'manual',
        name: 'Принятый.pdf',
        contentType: 'application/pdf',
        sizeBytes: 700,
        storageKey: `org/${a.orgId}/files/${fileId}`,
        state: 'ready',
        createdBy: a.ownerUserId,
        createdAt: ago(48),
      });
      present.push(`org/${a.orgId}/files/${fileId}`);
      const key = `org/${a.orgId}/sent/${id}`;
      await db.admin.db.insert(contractorSentFiles).values({
        id,
        orgId: a.orgId,
        contractorId: cpA,
        source: 'page',
        name: 'Принятый.pdf',
        contentType: 'application/pdf',
        sizeBytes: 700,
        storageKey: key,
        state: 'ready',
        status: 'accepted',
        decidedAt: ago(40),
        decidedBy: a.ownerUserId,
        fileId,
        createdAt: ago(48),
      });
      return key;
    };
    const acceptedGone = await accepted();
    const acceptedLeft = await accepted();
    // Логотип без объекта: у организации, изменённой давно, — «Нет в хранилище»; изменённой меньше часа
    // назад — ещё не проверяется (логотип мог лечь после чтения списка). Время — от NOW теста; «молодые» —
    // через полчаса после NOW, чтобы и второй запуск (NOW + 1 час) видел их младше часа.
    const logoOld = `org/${b.orgId}/logo/${randomUUID()}`;
    const logoYoung = `org/${a.orgId}/logo/${randomUUID()}`;
    await db.admin.db
      .update(organizations)
      .set({ logoKey: logoOld, updatedAt: ago(48) })
      .where(eq(organizations.id, b.orgId));
    await db.admin.db
      .update(organizations)
      .set({ logoKey: logoYoung, updatedAt: ago(-0.5) })
      .where(eq(organizations.id, a.orgId));
    // Файл заменили меньше часа назад («Изменить файл»): новый ключ, а создан давно — ещё не проверяется.
    const replaced = await addFile(a.orgId, 'ready', ago(48));
    await db.admin.db
      .update(files)
      .set({ replacedAt: ago(-0.5), replacedBy: a.ownerUserId })
      .where(eq(files.storageKey, replaced));
    // Ждёт стирания: не лишний; срок прошёл и стереть не удалось — «Не стёрт».
    const trashKey = `org/${a.orgId}/files/${randomUUID()}`;
    await db.admin.db.insert(fileTrash).values({
      orgId: a.orgId,
      why: 'rep',
      storageKey: trashKey,
      name: 'Старый.pdf',
      sizeBytes: 900,
      deletedAt: ago(72),
      eraseAt: ago(48),
      attempts: 2,
      lastError: 'AccessDenied',
    });
    const objects = [
      obj(readyOld, 47),
      obj(missingYoung, 0.4),
      obj(pendingYoung, 1),
      obj(deletedKey, 70),
      obj(extraOld, 30, 4321),
      obj(extraYoung, 2),
      obj(`${sentKey}.up`, 30),
      obj(trashKey, 72),
      obj(acceptedLeft, 40),
      ...present.map((k) => obj(k, 40)),
      // Не под `org/` — сверка их не трогает (видео и документы заявок).
      obj(`leads/upload/${randomUUID()}`, 100),
    ];
    // Только задаче: в контексте организации или пользователя — отказ.
    await expect(
      inA((tx) => tx.execute(sql`select app.storage_check_save('[]'::jsonb, now())`)),
    ).rejects.toThrow();
    await expect(
      asAdmin((tx) => tx.execute(sql`select app.storage_check_save('[]'::jsonb, now())`)),
    ).rejects.toThrow();

    const first = await saveStorageCheck(db.app.db, objects, NOW);
    expect(first).toMatchObject({
      state: 'done',
      objects: objects.length,
      missing: 2,
      extra: 3,
      stuck: 1,
      failed: 1,
      fresh: { missing: 2, extra: 3, stuck: 1, failed: 1 },
    });
    const items = await db.admin.db
      .select()
      .from(storageCheckItems)
      .where(sql`${storageCheckItems.resolvedAt} is null`);
    const byKind = (k: string) =>
      items
        .filter((i) => i.kind === k)
        .map((i) => i.key)
        .sort();
    expect(byKind('missing')).toEqual([missing, logoOld].sort());
    expect(items.map((i) => i.key)).not.toContain(logoYoung);
    expect(items.map((i) => i.key)).not.toContain(replaced);
    expect(byKind('extra')).toEqual([deletedKey, extraOld, acceptedLeft].sort());
    expect(items.map((i) => i.key)).not.toContain(acceptedGone);
    expect(byKind('stuck')).toEqual([stuck]);
    expect(byKind('failed')).toEqual([trashKey]);
    expect(items.find((i) => i.key === extraOld)).toMatchObject({
      keyOrgId: b.orgId,
      sizeBytes: 4321,
      firstRunId: first.run,
    });
    // Сотрудник итог сверки не видит и не пишет; администратор — видит.
    expect(await inA((tx) => tx.select().from(storageCheckItems))).toEqual([]);
    await expect(
      inA((tx) => tx.update(storageCheckRuns).set({ state: 'failed' })),
    ).rejects.toThrow();
    expect(await asAdmin((tx) => storageCheckRunsWithNews(tx, ago(24)))).toEqual([
      { run: first.run, at: NOW, fresh: 7 },
    ]);

    // Второй запуск: лишний старый удалили, остальное на месте — новых нет, лишний закрыт.
    const second = await saveStorageCheck(
      db.app.db,
      objects.filter((o) => o.key !== extraOld),
      new Date(NOW.getTime() + HOUR),
    );
    expect(second).toMatchObject({
      missing: 2,
      extra: 2,
      stuck: 1,
      failed: 1,
      fresh: { missing: 0, extra: 0, stuck: 0, failed: 0 },
    });
    const [closed] = await db.admin.db
      .select()
      .from(storageCheckItems)
      .where(eq(storageCheckItems.key, extraOld));
    expect(closed!.resolvedAt).not.toBeNull();
    const [kept] = await db.admin.db
      .select()
      .from(storageCheckItems)
      .where(eq(storageCheckItems.key, missing));
    expect(kept).toMatchObject({ firstRunId: first.run, lastRunId: second.run, resolvedAt: null });
    expect(await asAdmin((tx) => storageCheckRunsWithNews(tx, ago(24)))).toEqual([
      { run: first.run, at: NOW, fresh: 7 },
    ]);

    // Список не прочитался: запуск с ошибкой, открытые строки — как были.
    const failed = await saveStorageCheck(db.app.db, [], NOW, 'хранилище не отвечает');
    expect(failed.state).toBe('failed');
    const [run] = await db.admin.db
      .select()
      .from(storageCheckRuns)
      .where(eq(storageCheckRuns.id, failed.run));
    expect(run).toMatchObject({ state: 'failed', error: 'хранилище не отвечает' });
    const open = await db.admin.db
      .select({ n: sql<number>`count(*)::integer` })
      .from(storageCheckItems)
      .where(sql`${storageCheckItems.resolvedAt} is null`);
    expect(open[0]!.n).toBe(6);
  });
});
