import { eq, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { UI_TEXTS, type ListQuery } from '@buhuchet/domain';
import {
  adminLeadById,
  adminLeadEvents,
  adminLeadList,
  adminLeadRecipients,
  adminNewLeadCount,
  deleteLead,
  exportAdminLeads,
  LeadLinkError,
  listAdminLeadsPage,
  listAdminLeadValues,
  setLeadAdminNote,
  setLeadStatus,
  submitLead,
  type LeadNotice,
  type LeadSubmission,
  type SavedLead,
} from './leads';
import { createOrganization, type CreatedOrganization } from './organizations';
import { demoId } from './seed';
import { markViaTelegram } from './telegram-bot';
import { seedDemoLeads } from './seed/demo-leads';
import { readSpecJson } from './spec-data';
import {
  organizations,
  platformLeadEvents,
  platformLeads,
  telegramLinks,
  telegramOutbox,
  users,
} from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const NOW = new Date('2026-11-01T04:00:00Z');
const later = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

const t = (key: string) => (UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key;
const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  page: 1,
  size: 50,
  sort: { key: 'at', dir: 'desc' },
  filters: {},
  ...over,
});

const noRights = expect.objectContaining({
  cause: expect.objectContaining({ message: expect.stringMatching(/permission denied/) }),
});

describe.skipIf(!databaseAvailable())('заявки с лендинга', () => {
  let db: TestDatabase;
  let org: CreatedOrganization;
  let adminId: string;
  let blockedAdminId: string;
  let n = 0;

  /** Сообщение о заявке: простой текст и описание с кнопками заявки. */
  const notice =
    (text: string, repeatText = text) =>
    (saved: SavedLead): LeadNotice => {
      const plain = saved.repeat ? repeatText : text;
      return {
        text: plain,
        message: {
          heading: plain,
          plain,
          buttons: [[{ text: 'Взять в работу', action: 'leadWork', arg: saved.id }]],
        },
      };
    };

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
      notify: notice('📩 Новая заявка с сайта', '🔁 Повторная заявка с сайта'),
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

  it('заявка со стенда сохраняется с отметкой, сообщение о ней уходит администраторам стенда (прототип v74)', async () => {
    await db.admin.db.delete(telegramOutbox);
    const res = await submitLead(
      db.app.db,
      lead({
        fromStand: true,
        notify: notice('🧪 Тестовый стенд 📩 Новая заявка с сайта'),
        telegram: '  ',
        note: '',
      }),
    );
    expect(res.outcome).toBe('created');
    const [row] = await db.admin.db
      .select()
      .from(platformLeads)
      .where(eq(platformLeads.id, res.leadId!));
    expect(row).toMatchObject({ fromStand: true, telegram: null, note: null });
    expect(await db.admin.db.select().from(telegramOutbox)).toEqual([
      expect.objectContaining({
        userId: adminId,
        kind: 'lead',
        text: '🧪 Тестовый стенд 📩 Новая заявка с сайта',
        dedupeKey: `lead:${res.leadId}:${adminId}`,
      }),
    ]);
    // Без текста (бот не настроен) — заявка сохраняется, сообщения нет.
    await db.admin.db.delete(telegramOutbox);
    const quiet = await submitLead(db.app.db, lead({ notify: null }));
    expect(quiet.outcome).toBe('created');
    expect(await db.admin.db.$count(telegramOutbox)).toBe(0);
  });

  it('повторная заявка с того же телефона за сутки новой не создаётся: комментарий дописан, в истории — повтор, администраторам — «Повторная заявка с сайта»', async () => {
    await db.admin.db.delete(telegramOutbox);
    const first = await submitLead(db.app.db, lead({ phone: '+996700111222', note: 'Первый' }));
    const again = await submitLead(
      db.app.db,
      lead({ phone: '+996700111222', note: 'Второй', now: later(23) }),
    );
    expect(again).toEqual({ outcome: 'repeat', leadId: first.leadId, queued: 1 });
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
    // О каждом повторе — своё сообщение по шаблону «Telegram: повторная заявка с сайта» (прототип v74):
    // ключ начинается с заявки и администратора и кончается записью истории.
    const events = await db.admin.db
      .select({ id: platformLeadEvents.id })
      .from(platformLeadEvents)
      .where(eq(platformLeadEvents.leadId, first.leadId!))
      .orderBy(platformLeadEvents.id);
    const sent = await db.admin.db
      .select({ text: telegramOutbox.text, key: telegramOutbox.dedupeKey })
      .from(telegramOutbox);
    expect(sent).toHaveLength(3);
    expect(sent).toEqual(
      expect.arrayContaining([
        { text: '📩 Новая заявка с сайта', key: `lead:${first.leadId}:${adminId}` },
        ...events.slice(1).map((e) => ({
          text: '🔁 Повторная заявка с сайта',
          key: `lead:${first.leadId}:${adminId}:${e.id}`,
        })),
      ]),
    );
    // В сообщении о повторе — фирма, имя, «клиентов» и статус сохранённой заявки, а не второй формы.
    await db.admin.db.delete(telegramOutbox);
    const marked = await submitLead(
      db.app.db,
      lead({
        phone: '+996700111222',
        name: 'Другое Имя',
        firm: 'ОсОО «Другая»',
        size: '1–20',
        note: '',
        now: later(23.6),
        notify: (saved) => {
          const text = `🔁 ${saved.firm}, ${saved.name}, ${saved.size}, ${saved.status}`;
          return { text, message: { text } };
        },
      }),
    );
    expect(marked.outcome).toBe('repeat');
    expect(await db.admin.db.select({ text: telegramOutbox.text }).from(telegramOutbox)).toEqual([
      { text: '🔁 ОсОО «Учёт Плюс», Айгуль Садыкова, 21–50, new' },
    ]);
    // Без текста повтора — сообщения о повторе нет.
    const silent = await submitLead(
      db.app.db,
      lead({ phone: '+996700111222', note: '', now: later(23.7), notify: () => null }),
    );
    expect(silent.outcome).toBe('repeat');
    expect(await db.admin.db.$count(telegramOutbox)).toBe(1);
    // Через сутки с того же телефона — уже новая заявка.
    const next = await submitLead(db.app.db, lead({ phone: '+996700111222', now: later(25) }));
    expect(next.outcome).toBe('created');
  });

  it('четвёртая заявка за час с одного адреса не принимается и сообщения не даёт, в том числе повтор; с другого адреса — принимается', async () => {
    const ip = 'ip-limit';
    const phones: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const sent = lead({ ipSubject: ip });
      phones.push(sent.phone);
      expect((await submitLead(db.app.db, sent)).outcome).toBe('created');
    }
    const before = await db.admin.db.$count(platformLeads);
    const messages = await db.admin.db.$count(telegramOutbox);
    const repeats = () =>
      db.admin.db.$count(platformLeadEvents, eq(platformLeadEvents.kind, 'repeat'));
    const repeatsBefore = await repeats();
    expect(await submitLead(db.app.db, lead({ ipSubject: ip }))).toEqual({
      outcome: 'limited',
      leadId: null,
      queued: 0,
    });
    // Повтор с того же телефона сверх предела — тоже ни записи в истории, ни сообщения.
    expect(
      (await submitLead(db.app.db, lead({ ipSubject: ip, phone: phones[0]!, note: 'Ещё' })))
        .outcome,
    ).toBe('limited');
    expect(await db.admin.db.$count(platformLeads)).toBe(before);
    expect(await db.admin.db.$count(telegramOutbox)).toBe(messages);
    expect(await repeats()).toBe(repeatsBefore);
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
        queued: 0,
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

  it('«О новых заявках некому сообщить»: сколько незаблокированных администраторов платформы с Telegram получат сообщение; не администратору — 0', async () => {
    // Telegram — у администратора и у заблокированного администратора; у третьего его нет.
    expect(await asAdmin((tx) => adminLeadRecipients(tx))).toBe(1);
    expect(await withUserContext(db.app.db, org.ownerUserId, (tx) => adminLeadRecipients(tx))).toBe(
      0,
    );
    expect(await withUserContext(db.app.db, blockedAdminId, (tx) => adminLeadRecipients(tx))).toBe(
      0,
    );
    await db.admin.db.delete(telegramLinks).where(eq(telegramLinks.userId, adminId));
    try {
      expect(await asAdmin((tx) => adminLeadRecipients(tx))).toBe(0);
    } finally {
      await db.admin.db
        .insert(telegramLinks)
        .values({ userId: adminId, orgId: null, chatId: 9001, username: 'kutman' });
    }
  });

  it('сообщение о заявке — с описанием для кнопок; app.lead_notify ставит его только сразу после своей заявки (задача Т6)', async () => {
    await db.admin.db.delete(telegramOutbox);
    const res = await submitLead(db.app.db, lead());
    expect(res.queued).toBe(1);
    const [row] = await db.admin.db.select().from(telegramOutbox);
    expect(row).toMatchObject({
      orgId: null,
      userId: adminId,
      kind: 'lead',
      dedupeKey: `lead:${res.leadId}:${adminId}`,
      payload: {
        heading: '📩 Новая заявка с сайта',
        buttons: [[{ text: 'Взять в работу', action: 'leadWork', arg: res.leadId }]],
      },
      messageId: null,
    });
    const notify = async (lead: string | null, event: number | null, now: Date) => {
      const rows = await db.app.db.execute<{ n: number }>(
        sql`select app.lead_notify(${lead}::uuid, ${event}::bigint, 'текст', '{"text":"текст"}'::jsonb, ${now.toISOString()}::timestamptz) as n`,
      );
      return Number(rows[0]!.n);
    };
    // Повторный вызов по той же заявке второго сообщения не даёт (ключ), позже — и не пытается.
    expect(await notify(res.leadId, null, NOW)).toBe(0);
    expect(await notify(res.leadId, null, later(1))).toBe(0);
    // Нет такой заявки; запись истории — не повтор этой заявки.
    expect(await notify('00000000-0000-4000-8000-000000000000', null, NOW)).toBe(0);
    const [created] = await db.admin.db
      .select({ id: platformLeadEvents.id })
      .from(platformLeadEvents)
      .where(eq(platformLeadEvents.leadId, res.leadId!));
    expect(await notify(res.leadId, created!.id, NOW)).toBe(0);
    // Описание — только объект.
    const bad = await db.app.db.execute<{ n: number }>(
      sql`select app.lead_notify(${res.leadId}::uuid, null, 'текст', '[]'::jsonb, ${NOW.toISOString()}::timestamptz) as n`,
    );
    expect(Number(bad[0]!.n)).toBe(0);
    expect(await db.admin.db.$count(telegramOutbox)).toBe(1);
  });

  it('смена статуса из чата бота помечается в истории заявки «через Telegram», с сайта — без отметки (задача Т6)', async () => {
    const { leadId } = await submitLead(db.app.db, lead());
    const version = await asAdmin(async (tx) => {
      await markViaTelegram(tx);
      return setLeadStatus(tx, {
        id: leadId!,
        version: 1,
        to: 'in_progress',
        before: null,
        now: later(1),
      });
    });
    expect(version).toBe(2);
    await asAdmin((tx) =>
      setLeadStatus(tx, {
        id: leadId!,
        version: 2,
        to: 'rejected',
        before: 'in_progress',
        text: 'Дорого',
        now: later(2),
      }),
    );
    const events = await asAdmin((tx) => adminLeadEvents(tx, leadId!));
    expect(events.map((e) => [e.kind, e.toStatus, e.via])).toEqual([
      ['created', 'new', null],
      ['status', 'in_progress', 'telegram'],
      ['status', 'rejected', null],
    ]);
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
    expect(lead3).toMatchObject({
      status: 'rejected',
      statusBefore: 'in_progress',
      version: 3,
      updatedBy: adminId,
    });
    // «Снять «Отказ»» — откат с причиной: в истории — «Откат».
    const v4 = await asAdmin((tx) =>
      setLeadStatus(tx, {
        id,
        version: 3,
        to: 'in_progress',
        before: null,
        rollback: true,
        text: 'Перезвонили, передумали',
        now: later(3),
      }),
    );
    expect(v4).toBe(4);
    const events = await asAdmin((tx) => adminLeadEvents(tx, id));
    expect(events.map((e) => [e.kind, e.fromStatus, e.toStatus, e.text, e.actorLogin])).toEqual([
      ['created', null, 'new', null, null],
      ['status', 'new', 'in_progress', null, 'platform'],
      ['status', 'in_progress', 'rejected', 'Нужна программа с проводками', 'platform'],
      ['rollback', 'rejected', 'in_progress', 'Перезвонили, передумали', 'platform'],
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
    // Вторую организацию к той же заявке не привязать (две вкладки, два администратора).
    expect(
      await asAdmin((tx) =>
        setLeadStatus(tx, {
          id,
          version: null,
          to: 'connected',
          before: null,
          orgId: org.orgId,
          text: 'ОсОО «Альфа»',
          now: later(2),
        }),
      ),
    ).toBeNull();
    expect(await asAdmin((tx) => adminLeadEvents(tx, id))).toHaveLength(events.length);
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
    // Повторная заявка: её сообщение тоже связано с заявкой и стирается вместе с ней.
    await submitLead(db.app.db, lead({ phone: '+996700333555', note: '', now: later(3) }));
    expect(await leadMessages(id)).toHaveLength(2);
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

  it('вкладка «Заявки» на сервере: поиск по телефону без «+», сортировка по шкале, фильтр статуса, «Изменил», выгрузка', async () => {
    const { leadId } = await submitLead(
      db.app.db,
      lead({ phone: '+996777123987', firm: 'ОсОО «Поиск»', now: later(5) }),
    );
    const found = await asAdmin((tx) =>
      listAdminLeadsPage(tx, query({ search: { q: '777 123 987', keys: ['phone'] } }), t),
    );
    expect(found.rows.map((r) => r.id)).toEqual([leadId]);
    expect(found.rows[0]).toMatchObject({ status: 'new', updatedByGuest: true });
    await asAdmin((tx) =>
      setLeadStatus(tx, {
        id: leadId!,
        version: 1,
        to: 'in_progress',
        before: null,
        now: later(6),
      }),
    );
    const sorted = await asAdmin((tx) =>
      listAdminLeadsPage(tx, query({ sort: { key: 'status', dir: 'asc' }, size: 'all' }), t),
    );
    const order = ['new', 'in_progress', 'connected', 'rejected'];
    const ranks = sorted.rows.map((r) => order.indexOf(r.status));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    const values = await asAdmin((tx) => listAdminLeadValues(tx, 'status', t));
    expect(values.items.find((x) => x.value === 'in_progress')).toMatchObject({
      label: 'В работе',
    });
    const byAdmin = await asAdmin((tx) =>
      listAdminLeadsPage(
        tx,
        query({ filters: { updatedBy: { type: 'enum', vals: ['Администратор платформы'] } } }),
        t,
      ),
    );
    expect(byAdmin.rows.map((r) => r.id)).toContain(leadId);
    expect(byAdmin.rows.every((r) => !r.updatedByGuest)).toBe(true);
    const file = await asAdmin((tx) =>
      exportAdminLeads(
        tx,
        query({ search: { q: 'Поиск', keys: ['firm'] } }),
        ['firm', 'status'],
        t,
      ),
    );
    expect(file.rows).toEqual([['ОсОО «Поиск»', 'В работе']]);
    // Сотруднику организации — пусто.
    const none = await withUserContext(db.app.db, org.ownerUserId, (tx) =>
      listAdminLeadsPage(tx, query(), t),
    );
    expect(none).toMatchObject({ rows: [], total: 0 });
  });

  it('«Создать организацию» по заявке: в той же транзакции «Подключена» и ссылка; вторая — отказ, организация не создаётся', async () => {
    const { leadId } = await submitLead(db.app.db, lead({ firm: 'ОсОО «Бета»' }));
    const id = leadId!;
    await asAdmin((tx) =>
      setLeadStatus(tx, {
        id,
        version: 1,
        to: 'rejected',
        before: 'new',
        text: 'дорого',
        now: later(1),
      }),
    );
    const created = await createOrganization(db.app.db, {
      name: 'ОсОО «Бета»',
      inn: '01811201810457',
      slug: 'beta',
      owner: { fullName: 'Бекова Бермет', login: 'bekova', passwordHash: 'h' },
      createdBy: adminId,
      lead: { id, now: later(2) },
    });
    expect(await asAdmin((tx) => adminLeadById(tx, id))).toMatchObject({
      status: 'connected',
      statusBefore: null,
      createdOrgId: created.orgId,
      orgName: 'ОсОО «Бета»',
      updatedBy: adminId,
      updatedByGuest: false,
    });
    expect((await asAdmin((tx) => adminLeadEvents(tx, id))).at(-1)).toMatchObject({
      kind: 'org',
      fromStatus: 'rejected',
      toStatus: 'connected',
      text: 'ОсОО «Бета»',
      actorLogin: 'platform',
    });
    const again = createOrganization(db.app.db, {
      name: 'ОсОО «Бета-2»',
      inn: '01811201810458',
      slug: 'beta-2',
      owner: { fullName: 'Бекова Бермет', login: 'bekova2', passwordHash: 'h' },
      createdBy: adminId,
      lead: { id, now: later(3) },
    });
    await expect(again).rejects.toEqual(new LeadLinkError('org_exists'));
    expect(await db.admin.db.$count(organizations, eq(organizations.slug, 'beta-2'))).toBe(0);
    // Заявки нет (её удалили, пока открыта форма) — организация не создаётся.
    await expect(
      createOrganization(db.app.db, {
        name: 'ОсОО «Гамма»',
        inn: '01811201810459',
        slug: 'gamma',
        owner: { fullName: 'Гаврилов Глеб', login: 'gavrilov', passwordHash: 'h' },
        createdBy: adminId,
        lead: { id: '00000000-0000-4000-8000-000000000000', now: later(3) },
      }),
    ).rejects.toEqual(new LeadLinkError('not_found'));
    expect(await db.admin.db.$count(organizations, eq(organizations.slug, 'gamma'))).toBe(0);
  });

  it('демо-заявки из demoDB.json: статусы, «Отказ» со статусом до отказа, история; повтор не дублирует', async () => {
    const file = await readSpecJson('data/demoDB.json');
    await seedDemoLeads(db.admin.db, file, demoId);
    await seedDemoLeads(db.admin.db, file, demoId);
    const l2 = await asAdmin((tx) => adminLeadById(tx, demoId('lead', 'L2')));
    expect(l2).toMatchObject({
      name: 'Гульнара Асанова',
      phone: '+996555432198',
      status: 'in_progress',
      telegram: null,
      adminNote: 'Позвонили 31.10, показ программы в понедельник в 11:00',
      updatedByGuest: false,
    });
    const l3 = await asAdmin((tx) => adminLeadById(tx, demoId('lead', 'L3')));
    expect(l3).toMatchObject({ status: 'rejected', statusBefore: 'in_progress' });
    const events = await asAdmin((tx) => adminLeadEvents(tx, demoId('lead', 'L3')));
    expect(events.map((e) => [e.kind, e.fromStatus, e.toStatus, e.text])).toEqual([
      ['created', null, 'new', null],
      ['status', 'new', 'in_progress', null],
      [
        'status',
        'in_progress',
        'rejected',
        'нужна программа бухгалтерского учёта с проводками, а не учёт отчётов',
      ],
    ]);
    const l1 = await asAdmin((tx) => adminLeadById(tx, demoId('lead', 'L1')));
    expect(l1).toMatchObject({ status: 'new', updatedByGuest: true });
  });
});
