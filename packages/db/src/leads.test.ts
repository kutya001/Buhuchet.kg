import { eq, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import {
  adminLeadById,
  adminLeadEvents,
  adminLeadList,
  adminNewLeadCount,
  deleteLead,
  setLeadAdminNote,
  setLeadStatus,
  submitLead,
  type LeadSubmission,
} from './leads';
import { createOrganization, type CreatedOrganization } from './organizations';
import { platformLeadEvents, platformLeads, telegramLinks, telegramOutbox, users } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const NOW = new Date('2026-11-01T04:00:00Z');
const later = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

const noRights = expect.objectContaining({
  cause: expect.objectContaining({ message: expect.stringMatching(/permission denied/) }),
});

describe.skipIf(!databaseAvailable())('заявки с лендинга', () => {
  let db: TestDatabase;
  let org: CreatedOrganization;
  let adminId: string;
  let blockedAdminId: string;
  let n = 0;

  /** Заявка с уникальным телефоном и адресом, если не указаны свои. */
  const lead = (over: Partial<LeadSubmission> = {}): LeadSubmission => {
    n += 1;
    return {
      ipSubject: `ip-${n}`,
      name: 'Айгуль Садыкова',
      firm: 'ОсОО «Учёт Плюс»',
      phone: `+996555${String(100000 + n)}`,
      size: '21–50',
      telegram: '@aigul',
      note: 'Перезвоните после обеда',
      fromStand: false,
      trap: false,
      telegramText: '📩 Новая заявка с сайта',
      now: NOW,
      ...over,
    };
  };
  const asAdmin = <T>(run: Parameters<typeof withUserContext<T>>[2]) =>
    withUserContext(db.app.db, adminId, run);

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    const [admin, blocked, quiet] = await db.admin.db
      .insert(users)
      .values([
        { login: 'platform', passwordHash: 'h', isPlatformAdmin: true },
        { login: 'platform-old', passwordHash: 'h', isPlatformAdmin: true, blocked: true },
        { login: 'platform-quiet', passwordHash: 'h', isPlatformAdmin: true },
      ])
      .returning({ id: users.id });
    adminId = admin!.id;
    blockedAdminId = blocked!.id;
    org = await createOrganization(db.app.db, {
      name: 'ОсОО «Альфа»',
      inn: '01811201810456',
      slug: 'alfa',
      owner: { fullName: 'Асанов Асан Асанович', login: 'asanov', passwordHash: 'h' },
    });
    // Telegram привязан у двух администраторов платформы (один заблокирован) и у владельца организации;
    // у третьего администратора Telegram нет.
    await db.admin.db.insert(telegramLinks).values([
      { userId: adminId, orgId: null, chatId: 9001, username: 'kutman' },
      { userId: blockedAdminId, orgId: null, chatId: 9002, username: 'old' },
      { userId: org.ownerUserId, orgId: org.orgId, chatId: 9003, username: 'asan' },
    ]);
    expect(quiet).toBeDefined();
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('новая заявка — строка «Новая», в истории «Заявка с сайта», сообщение всем незаблокированным администраторам платформы с Telegram', async () => {
    const res = await submitLead(db.app.db, lead({ phone: '+996555100200' }));
    expect(res.outcome).toBe('created');
    const [row] = await db.admin.db
      .select()
      .from(platformLeads)
      .where(eq(platformLeads.id, res.leadId!));
    expect(row).toMatchObject({
      name: 'Айгуль Садыкова',
      firm: 'ОсОО «Учёт Плюс»',
      phone: '+996555100200',
      size: '21–50',
      telegram: '@aigul',
      note: 'Перезвоните после обеда',
      status: 'new',
      statusBefore: null,
      createdOrgId: null,
      fromStand: false,
      version: 1,
    });
    const events = await db.admin.db
      .select()
      .from(platformLeadEvents)
      .where(eq(platformLeadEvents.leadId, res.leadId!));
    expect(events).toEqual([
      expect.objectContaining({ kind: 'created', toStatus: 'new', actorUserId: null }),
    ]);
    const sent = await db.admin.db
      .select()
      .from(telegramOutbox)
      .where(eq(telegramOutbox.kind, 'lead'));
    expect(sent).toEqual([
      expect.objectContaining({
        orgId: null,
        userId: adminId,
        chatId: 9001,
        text: '📩 Новая заявка с сайта',
        status: 'pending',
      }),
    ]);
  });

  it('заявка со стенда сохраняется с отметкой и в Telegram не уходит', async () => {
    await db.admin.db.delete(telegramOutbox);
    const res = await submitLead(
      db.app.db,
      lead({ fromStand: true, telegramText: null, telegram: '  ', note: '' }),
    );
    expect(res.outcome).toBe('created');
    const [row] = await db.admin.db
      .select()
      .from(platformLeads)
      .where(eq(platformLeads.id, res.leadId!));
    expect(row).toMatchObject({ fromStand: true, telegram: null, note: null });
    expect(await db.admin.db.select().from(telegramOutbox)).toEqual([]);
  });

  it('повторная заявка с того же телефона за сутки новой не создаётся: комментарий дописан, в истории — повтор', async () => {
    await db.admin.db.delete(telegramOutbox);
    const first = await submitLead(db.app.db, lead({ phone: '+996700111222', note: 'Первый' }));
    const again = await submitLead(
      db.app.db,
      lead({ phone: '+996700111222', note: 'Второй', now: later(23) }),
    );
    expect(again).toEqual({ outcome: 'repeat', leadId: first.leadId });
    const empty = await submitLead(
      db.app.db,
      lead({ phone: '+996700111222', note: '', now: later(23.5) }),
    );
    expect(empty.outcome).toBe('repeat');
    const rows = await db.admin.db
      .select()
      .from(platformLeads)
      .where(eq(platformLeads.phone, '+996700111222'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ note: 'Первый\nВторой', version: 3 });
    const kinds = await db.admin.db
      .select({ kind: platformLeadEvents.kind, text: platformLeadEvents.text })
      .from(platformLeadEvents)
      .where(eq(platformLeadEvents.leadId, first.leadId!))
      .orderBy(platformLeadEvents.id);
    expect(kinds).toEqual([
      { kind: 'created', text: null },
      { kind: 'repeat', text: 'Второй' },
      { kind: 'repeat', text: null },
    ]);
    // Повтор не пишет администраторам второй раз: сообщение — только о первой заявке.
    expect(await db.admin.db.$count(telegramOutbox)).toBe(1);
    // Через сутки с того же телефона — уже новая заявка.
    const next = await submitLead(db.app.db, lead({ phone: '+996700111222', now: later(25) }));
    expect(next.outcome).toBe('created');
  });

  it('четвёртая заявка за час с одного адреса не принимается, с другого адреса — принимается', async () => {
    const ip = 'ip-limit';
    for (let i = 0; i < 3; i += 1) {
      expect((await submitLead(db.app.db, lead({ ipSubject: ip }))).outcome).toBe('created');
    }
    const before = await db.admin.db.$count(platformLeads);
    expect(await submitLead(db.app.db, lead({ ipSubject: ip }))).toEqual({
      outcome: 'limited',
      leadId: null,
    });
    expect(await db.admin.db.$count(platformLeads)).toBe(before);
    expect((await submitLead(db.app.db, lead({ ipSubject: 'ip-other' }))).outcome).toBe('created');
  });

  it('заявка с полем-ловушкой не сохраняется, но засчитывается в предел по адресу', async () => {
    const ip = 'ip-trap';
    const before = await db.admin.db.$count(platformLeads);
    const outbox = await db.admin.db.$count(telegramOutbox);
    for (let i = 0; i < 3; i += 1) {
      expect(await submitLead(db.app.db, lead({ ipSubject: ip, trap: true }))).toEqual({
        outcome: 'trap',
        leadId: null,
      });
    }
    expect(await db.admin.db.$count(platformLeads)).toBe(before);
    expect(await db.admin.db.$count(telegramOutbox)).toBe(outbox);
    expect((await submitLead(db.app.db, lead({ ipSubject: ip }))).outcome).toBe('limited');
  });

  it('у роли приложения нет прав на таблицы заявок: ни прочитать, ни записать напрямую', async () => {
    await expect(db.app.db.select().from(platformLeads)).rejects.toEqual(noRights);
    await expect(db.app.db.select().from(platformLeadEvents)).rejects.toEqual(noRights);
    await expect(
      db.app.db
        .insert(platformLeads)
        .values({ name: 'x', firm: 'x', phone: '+996555000000', size: 'x' }),
    ).rejects.toEqual(noRights);
    await expect(db.app.db.delete(platformLeads)).rejects.toEqual(noRights);
    // И в контексте администратора платформы тоже — только представления и функции.
    await expect(asAdmin((tx) => tx.select().from(platformLeads))).rejects.toEqual(noRights);
    await expect(
      asAdmin((tx) => tx.update(platformLeads).set({ status: 'connected' })),
    ).rejects.toEqual(noRights);
  });

  it('список и окно заявки видит только незаблокированный администратор платформы', async () => {
    const list = await asAdmin((tx) => adminLeadList(tx));
    expect(list.length).toBeGreaterThan(5);
    // От новых к старым.
    const times = list.map((r) => r.createdAt.getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    expect(await withUserContext(db.app.db, org.ownerUserId, (tx) => adminLeadList(tx))).toEqual(
      [],
    );
    expect(await withUserContext(db.app.db, blockedAdminId, (tx) => adminLeadList(tx))).toEqual([]);
    expect(await db.app.db.execute(sql`select * from app.admin_leads`)).toEqual([]);
    expect(await asAdmin((tx) => adminNewLeadCount(tx))).toBe(list.length);
  });

  it('статус: шаг, отказ с причиной, откат; версия сверяется; история — кто, с какого на какой, причина', async () => {
    const { leadId } = await submitLead(db.app.db, lead());
    const id = leadId!;
    const v2 = await asAdmin((tx) =>
      setLeadStatus(tx, { id, version: 1, to: 'in_progress', before: null, now: later(1) }),
    );
    expect(v2).toBe(2);
    // Устаревшая версия — ничего не меняется.
    expect(
      await asAdmin((tx) =>
        setLeadStatus(tx, { id, version: 1, to: 'connected', before: null, now: later(1) }),
      ),
    ).toBeNull();
    // Сотрудник организации статус не меняет.
    expect(
      await withUserContext(db.app.db, org.ownerUserId, (tx) =>
        setLeadStatus(tx, { id, version: 2, to: 'rejected', before: 'in_progress', now: NOW }),
      ),
    ).toBeNull();
    const v3 = await asAdmin((tx) =>
      setLeadStatus(tx, {
        id,
        version: 2,
        to: 'rejected',
        before: 'in_progress',
        text: 'Нужна программа с проводками',
        now: later(2),
      }),
    );
    expect(v3).toBe(3);
    const lead3 = await asAdmin((tx) => adminLeadById(tx, id));
    expect(lead3).toMatchObject({ status: 'rejected', statusBefore: 'in_progress', version: 3 });
    const events = await asAdmin((tx) => adminLeadEvents(tx, id));
    expect(events.map((e) => [e.kind, e.fromStatus, e.toStatus, e.text, e.actorLogin])).toEqual([
      ['created', null, 'new', null, null],
      ['status', 'new', 'in_progress', null, 'platform'],
      ['status', 'in_progress', 'rejected', 'Нужна программа с проводками', 'platform'],
    ]);
  });

  it('«Подключена» после создания организации: ссылка на организацию и «Создана организация» в истории', async () => {
    const { leadId } = await submitLead(db.app.db, lead());
    const id = leadId!;
    const v = await asAdmin((tx) =>
      setLeadStatus(tx, {
        id,
        version: null,
        to: 'connected',
        before: null,
        orgId: org.orgId,
        text: 'ОсОО «Альфа»',
        now: later(1),
      }),
    );
    expect(v).toBe(2);
    expect(await asAdmin((tx) => adminLeadById(tx, id))).toMatchObject({
      status: 'connected',
      createdOrgId: org.orgId,
      orgName: 'ОсОО «Альфа»',
    });
    const events = await asAdmin((tx) => adminLeadEvents(tx, id));
    expect(events.at(-1)).toMatchObject({
      kind: 'org',
      fromStatus: 'new',
      toStatus: 'connected',
      text: 'ОсОО «Альфа»',
    });
  });

  it('заметка администратора пишется в историю; «Удалить» стирает заявку с историей и сообщением в журнале Telegram', async () => {
    const other = await submitLead(db.app.db, lead({ phone: '+996700333444' }));
    const { leadId } = await submitLead(db.app.db, lead({ phone: '+996700333555' }));
    const id = leadId!;
    const leadMessages = (lead: string) =>
      db.admin.db
        .select()
        .from(telegramOutbox)
        .where(like(telegramOutbox.dedupeKey, `lead:${lead}:%`));
    expect(await leadMessages(id)).toHaveLength(1);
    expect(
      await asAdmin((tx) =>
        setLeadAdminNote(tx, { id, version: 1, note: ' Показ в понедельник ', now: later(1) }),
      ),
    ).toBe(2);
    expect(await asAdmin((tx) => adminLeadById(tx, id))).toMatchObject({
      adminNote: 'Показ в понедельник',
    });
    expect((await asAdmin((tx) => adminLeadEvents(tx, id))).map((e) => e.kind)).toEqual([
      'created',
      'note',
    ]);
    // Не администратору и заблокированному администратору — ни заметки, ни истории.
    for (const userId of [org.ownerUserId, blockedAdminId]) {
      expect(
        await withUserContext(db.app.db, userId, (tx) =>
          setLeadAdminNote(tx, { id, version: 2, note: 'чужая', now: later(2) }),
        ),
      ).toBeNull();
      expect(await withUserContext(db.app.db, userId, (tx) => adminLeadEvents(tx, id))).toEqual([]);
    }
    expect(await db.app.db.execute(sql`select * from app.admin_lead_events`)).toEqual([]);
    expect(await asAdmin((tx) => adminLeadById(tx, id))).toMatchObject({
      adminNote: 'Показ в понедельник',
      version: 2,
    });
    expect(await withUserContext(db.app.db, org.ownerUserId, (tx) => deleteLead(tx, id))).toBe(
      false,
    );
    expect(await asAdmin((tx) => deleteLead(tx, id))).toBe(true);
    expect(await asAdmin((tx) => deleteLead(tx, id))).toBe(false);
    expect(
      await db.admin.db.select().from(platformLeadEvents).where(eq(platformLeadEvents.leadId, id)),
    ).toEqual([]);
    // Имя и телефон не остаются в журнале Telegram; сообщение о другой заявке — на месте.
    expect(await leadMessages(id)).toEqual([]);
    expect(await leadMessages(other.leadId!)).toHaveLength(1);
  });
});
