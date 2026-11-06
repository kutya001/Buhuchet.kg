import { OUTBOX_UNDELIVERABLE, shortName, type ListQuery } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminTelegramBroadcast,
  adminTelegramOrgs,
  adminTelegramRetry,
  adminTelegramSummary,
  claimPlatformOutbox,
  exportAdminTelegramLog,
  finishPlatformOutbox,
  listAdminTelegramLogPage,
  listAdminTelegramLogValues,
} from './admin-telegram';
import { withUserContext } from './auth';
import { readPlatformHistory } from './platform-history';
import { withOrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import { employees, telegramLinks, telegramOutbox, users } from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const t = (key: string) => key;
const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  sort: undefined,
  page: 1,
  size: 25,
  filters: {},
  ...over,
});

// 01.11.2026, 10:00 по Бишкеку.
const NOW = new Date('2026-11-01T04:00:00Z');
const TODAY = '2026-11-01';
const KEYS = ['at', 'to', 'org', 'kind', 'st', 'tries', 'err'];

describe.skipIf(!databaseAvailable())('Админка → «Телеграм» (задача 2.41)', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let c: CreatedOrganization;
  let adminId: string;
  let blockedAdminId: string;
  let blockedUserId: string;
  let inactiveUserId: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    const [admin, blockedAdmin] = await db.admin.db
      .insert(users)
      .values([
        { login: 'platform', passwordHash: 'h', isPlatformAdmin: true },
        { login: 'platform-old', passwordHash: 'h', isPlatformAdmin: true, blocked: true },
      ])
      .returning({ id: users.id });
    adminId = admin!.id;
    blockedAdminId = blockedAdmin!.id;
    const org = (name: string, inn: string, slug: string, fullName: string, login: string) =>
      createOrganization(db.app.db, {
        name,
        inn,
        slug,
        owner: { fullName, login, passwordHash: 'h' },
      });
    a = await org('ОсОО «Альфа»', '01811201810456', 'alfa', 'Асанов Асан Асанович', 'asanov');
    b = await org('ОсОО «Бета»', '02811201810457', 'beta', 'Бекова Бермет', 'bekova');
    c = await org('ОсОО «Гамма»', '03811201810458', 'gamma', 'Гусев Глеб', 'gusev');
    await db.admin.db.execute(
      sql`update organizations set status = 'blocked' where id = ${c.orgId}`,
    );
    // В «Альфе» ещё двое с Telegram: заблокированная учётная запись и неактивный сотрудник.
    const extra = await db.admin.db
      .insert(users)
      .values([
        { login: 'alfa-blocked', passwordHash: 'h', orgId: a.orgId, blocked: true },
        { login: 'alfa-inactive', passwordHash: 'h', orgId: a.orgId },
      ])
      .returning({ id: users.id });
    blockedUserId = extra[0]!.id;
    inactiveUserId = extra[1]!.id;
    const roleId = a.roles[0]!.id;
    await db.admin.db.insert(employees).values([
      {
        orgId: a.orgId,
        userId: blockedUserId,
        fullName: 'Блоков Б',
        shortName: 'Блоков Б.',
        roleId,
      },
      {
        orgId: a.orgId,
        userId: inactiveUserId,
        fullName: 'Ушедший У',
        shortName: 'Ушедший У.',
        roleId,
        active: false,
      },
    ]);
    await db.admin.db.insert(telegramLinks).values([
      { userId: a.ownerUserId, orgId: a.orgId, chatId: 1001, username: 'asan' },
      { userId: b.ownerUserId, orgId: b.orgId, chatId: 1002, username: null },
      { userId: c.ownerUserId, orgId: c.orgId, chatId: 1003, username: 'gusev' },
      { userId: blockedUserId, orgId: a.orgId, chatId: 1004, username: 'blocked' },
      { userId: inactiveUserId, orgId: a.orgId, chatId: 1005, username: 'gone' },
      { userId: adminId, orgId: null, chatId: 1006, username: 'admin' },
    ]);
    const row = (
      key: string,
      v: Partial<typeof telegramOutbox.$inferInsert> & { userId: string; chatId: number },
    ) => ({ key, v });
    const rows = [
      row('sent', {
        orgId: a.orgId,
        userId: a.ownerUserId,
        chatId: 1001,
        kind: 'reminders',
        text: 'Напоминания',
        status: 'sent',
        tries: 1,
        sentAt: NOW,
        createdAt: NOW,
      }),
      row('sentOld', {
        orgId: a.orgId,
        userId: a.ownerUserId,
        chatId: 1001,
        kind: 'task_new',
        text: 'Задача',
        status: 'sent',
        tries: 1,
        sentAt: new Date('2026-10-31T10:00:00Z'),
        createdAt: new Date('2026-10-31T10:00:00Z'),
      }),
      row('error', {
        orgId: a.orgId,
        userId: a.ownerUserId,
        chatId: 1001,
        kind: 'task_new',
        text: 'Ошибка',
        status: 'error',
        tries: 5,
        lastError: '403: Forbidden: bot was blocked by the user',
        createdAt: new Date(NOW.getTime() - 60_000),
      }),
      row('unlinked', {
        orgId: a.orgId,
        userId: a.ownerUserId,
        chatId: 999,
        kind: 'broadcast',
        text: 'Объявление',
        status: 'error',
        tries: 0,
        lastError: OUTBOX_UNDELIVERABLE,
        createdAt: new Date(NOW.getTime() - 120_000),
      }),
      row('code', {
        orgId: b.orgId,
        userId: b.ownerUserId,
        chatId: 1002,
        kind: 'code',
        text: null,
        status: 'error',
        tries: 1,
        lastError: '400: chat not found',
        createdAt: new Date(NOW.getTime() - 180_000),
      }),
      row('pending', {
        orgId: b.orgId,
        userId: b.ownerUserId,
        chatId: 1002,
        kind: 'task_rework',
        text: 'Доработка',
        status: 'pending',
        tries: 1,
        createdAt: new Date(NOW.getTime() - 240_000),
      }),
      row('platform', {
        orgId: null,
        userId: adminId,
        chatId: 1006,
        kind: 'pass_changed',
        text: 'Пароль изменён',
        status: 'error',
        tries: 1,
        lastError: '502: Bad Gateway',
        createdAt: new Date(NOW.getTime() - 300_000),
      }),
    ];
    for (const r of rows) {
      const [x] = await db.admin.db
        .insert(telegramOutbox)
        .values({ kind: 'reminders', ...r.v })
        .returning({ id: telegramOutbox.id });
      ids[r.key] = x!.id;
    }
  });

  afterAll(async () => {
    await db?.drop();
  });

  const asAdmin = <T>(fn: Parameters<typeof withUserContext<T>>[2]) =>
    withUserContext(db.app.db, adminId, fn);

  it('администратор видит журнал всех организаций и платформы: получатель, организация, без текста', async () => {
    const page = await asAdmin((tx) => listAdminTelegramLogPage(tx, query(), t));
    expect(page.total).toBe(7);
    expect(page.rows.map((r) => r.id)).toEqual([
      ids.sent,
      ids.error,
      ids.unlinked,
      ids.code,
      ids.pending,
      ids.platform,
      ids.sentOld,
    ]);
    const first = page.rows[0]!;
    expect(first).toMatchObject({
      orgId: a.orgId,
      orgName: 'ОсОО «Альфа»',
      recipient: `${shortName('Асанов Асан Асанович')} @asan`,
      kind: 'reminders',
      status: 'sent',
      tries: 1,
      lastError: null,
    });
    expect(first).not.toHaveProperty('text');
    expect(first).not.toHaveProperty('chatId');
    // Без имени в Telegram — только краткое ФИО; у администратора платформы — логин, организации нет.
    expect(page.rows.find((r) => r.id === ids.code)!.recipient).toBe(shortName('Бекова Бермет'));
    expect(page.rows.find((r) => r.id === ids.platform)).toMatchObject({
      orgId: null,
      orgName: null,
      recipient: 'platform @admin',
    });
    // Строка, ушедшая в прежний чат, — без имени в Telegram: чат уже не тот.
    expect(page.rows.find((r) => r.id === ids.unlinked)!.recipient).toBe(
      shortName('Асанов Асан Асанович'),
    );

    const orgs = await asAdmin((tx) => listAdminTelegramLogValues(tx, 'org', t));
    expect(orgs.items).toHaveLength(3);
    expect(orgs.items).toEqual(
      expect.arrayContaining([
        { value: 'platform', label: 'tgadm.org.platform', count: 1 },
        { value: a.orgId, label: 'ОсОО «Альфа»', count: 4 },
        { value: b.orgId, label: 'ОсОО «Бета»', count: 2 },
      ]),
    );
    const statuses = await asAdmin((tx) => listAdminTelegramLogValues(tx, 'st', t));
    expect(statuses.items.map((x) => [x.value, x.label, x.count])).toEqual(
      expect.arrayContaining([
        ['error', 'tgadm.st.error', 4],
        ['pending', 'tgadm.st.pending', 1],
        ['sent', 'tgadm.st.sent', 2],
      ]),
    );
    const errors = await asAdmin((tx) =>
      listAdminTelegramLogPage(
        tx,
        query({ filters: { st: { type: 'enum', vals: ['error'] } } }),
        t,
      ),
    );
    expect(errors.total).toBe(4);
    // Поиск — по тому, что видно: подпись вида и подпись кода «recipient_unlinked».
    const found = await asAdmin((tx) =>
      listAdminTelegramLogPage(tx, query({ search: { q: 'tgadm.err.unlinked', keys: KEYS } }), t),
    );
    expect(found.rows.map((r) => r.id)).toEqual([ids.unlinked]);
    const kinds = await asAdmin((tx) =>
      listAdminTelegramLogPage(
        tx,
        query({ search: { q: 'telegram.kind.pass_changed', keys: KEYS } }),
        t,
      ),
    );
    expect(kinds.rows.map((r) => r.id)).toEqual([ids.platform]);

    const file = await asAdmin((tx) =>
      exportAdminTelegramLog(tx, query(), ['kind', 'st', 'err'], t),
    );
    expect(file.total).toBe(7);
    expect(file.rows[2]).toEqual([
      'telegram.kind.broadcast',
      'tgadm.st.error',
      'tgadm.err.unlinked',
    ]);

    expect(await asAdmin((tx) => adminTelegramSummary(tx, TODAY))).toEqual({
      pending: 1,
      errors: 4,
      sentToday: 1,
    });
  });

  it('на тестовом стенде у сообщения о заявке с сайта «Организация» — «Тестовый стенд», у остальных сообщений платформы — «Платформа» (прототип v74)', async () => {
    const [x] = await db.admin.db
      .insert(telegramOutbox)
      .values({
        orgId: null,
        userId: adminId,
        chatId: 1006,
        kind: 'lead',
        text: '🧪 Тестовый стенд 📩 Новая заявка с сайта',
        status: 'sent',
        tries: 1,
        dedupeKey: 'lead:stand-test',
        createdAt: new Date(NOW.getTime() - 360_000),
      })
      .returning({ id: telegramOutbox.id });
    const id = x!.id;
    try {
      // Рабочий сайт: «Платформа».
      const prod = await asAdmin((tx) => listAdminTelegramLogValues(tx, 'org', t));
      expect(prod.items).toEqual(
        expect.arrayContaining([{ value: 'platform', label: 'tgadm.org.platform', count: 2 }]),
      );
      const prodPage = await asAdmin((tx) => listAdminTelegramLogPage(tx, query(), t));
      expect(prodPage.rows.find((r) => r.id === id)).toMatchObject({ orgName: null });
      // Стенд: «Тестовый стенд» в строке, в фильтре, в поиске и в выгрузке.
      const values = await asAdmin((tx) =>
        listAdminTelegramLogValues(tx, 'org', t, undefined, true),
      );
      expect(values.items).toEqual(
        expect.arrayContaining([
          { value: 'platform', label: 'tgadm.org.platform', count: 1 },
          { value: 'stand', label: 'tgadm.org.stand', count: 1 },
        ]),
      );
      const page = await asAdmin((tx) => listAdminTelegramLogPage(tx, query(), t, true));
      expect(page.rows.find((r) => r.id === id)).toMatchObject({
        orgId: null,
        orgName: 'tgadm.org.stand',
        kind: 'lead',
      });
      expect(page.rows.find((r) => r.id === ids.platform)).toMatchObject({ orgName: null });
      const stand = await asAdmin((tx) =>
        listAdminTelegramLogPage(
          tx,
          query({ filters: { org: { type: 'enum', vals: ['stand'] } } }),
          t,
          true,
        ),
      );
      expect(stand.rows.map((r) => r.id)).toEqual([id]);
      const found = await asAdmin((tx) =>
        listAdminTelegramLogPage(
          tx,
          query({ search: { q: 'tgadm.org.stand', keys: KEYS } }),
          t,
          true,
        ),
      );
      expect(found.rows.map((r) => r.id)).toEqual([id]);
      const file = await asAdmin((tx) =>
        exportAdminTelegramLog(
          tx,
          query({ filters: { org: { type: 'enum', vals: ['stand'] } } }),
          ['org', 'kind'],
          t,
          true,
        ),
      );
      expect(file.rows).toEqual([['tgadm.org.stand', 'telegram.kind.lead']]);
    } finally {
      await db.admin.db.delete(telegramOutbox).where(eq(telegramOutbox.id, id));
    }
  });

  it('сотрудник организации, заблокированный администратор и запрос без контекста не видят журнал и ничего не меняют', async () => {
    const asOwner = await withOrgContext(
      db.app.db,
      { orgId: a.orgId, userId: a.ownerUserId },
      async (tx) => ({
        page: await listAdminTelegramLogPage(tx, query(), t),
        summary: await adminTelegramSummary(tx, TODAY),
        orgs: await adminTelegramOrgs(tx),
        retry: await adminTelegramRetry(tx, [ids.error!, ids.platform!], NOW),
        cast: await adminTelegramBroadcast(tx, { orgId: null, text: 'Чужое', now: NOW }),
      }),
    );
    expect(asOwner).toEqual({
      page: expect.objectContaining({ total: 0 }),
      summary: { pending: 0, errors: 0, sentToday: 0 },
      orgs: [],
      retry: { queued: 0, codes: 0 },
      cast: null,
    });
    const asBlocked = await withUserContext(db.app.db, blockedAdminId, async (tx) => ({
      page: await listAdminTelegramLogPage(tx, query(), t),
      retry: await adminTelegramRetry(tx, [ids.error!], NOW),
      cast: await adminTelegramBroadcast(tx, { orgId: a.orgId, text: 'x', now: NOW }),
    }));
    expect(asBlocked.page.total).toBe(0);
    expect(asBlocked.retry.queued).toBe(0);
    expect(asBlocked.cast).toBeNull();
    const [raw] = await db.app.db.execute<{ n: number }>(
      sql`select count(*)::integer as n from app.admin_telegram_log`,
    );
    expect(raw!.n).toBe(0);
    const [error] = await db.admin.db
      .select({ status: telegramOutbox.status })
      .from(telegramOutbox)
      .where(eq(telegramOutbox.id, ids.error!));
    expect(error!.status).toBe('error');
  });

  it('«Повторить ошибки»: ошибки снова в очереди с нуля попыток, коды восстановления и не ошибки — нет', async () => {
    const result = await asAdmin((tx) =>
      adminTelegramRetry(tx, [ids.error!, ids.code!, ids.pending!, ids.sent!, ids.platform!], NOW),
    );
    expect(result).toEqual({ queued: 2, codes: 1 });
    const rows = await db.admin.db.select().from(telegramOutbox);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(ids.error!)).toMatchObject({
      status: 'pending',
      tries: 0,
      lastError: null,
      sentAt: null,
      nextAt: NOW,
    });
    expect(byId.get(ids.platform!)).toMatchObject({ status: 'pending', tries: 0 });
    expect(byId.get(ids.code!)).toMatchObject({
      status: 'error',
      lastError: '400: chat not found',
    });
    expect(byId.get(ids.pending!)).toMatchObject({ status: 'pending', tries: 1 });
    expect(byId.get(ids.sent!)).toMatchObject({ status: 'sent' });
    // Повтор уже повторённой строки ничего не делает.
    expect(await asAdmin((tx) => adminTelegramRetry(tx, [ids.error!], NOW))).toEqual({
      queued: 0,
      codes: 0,
    });
  });

  it('строки без организации отправляет задача: берёт, засчитывает попытку, пишет итог; отвязанный — «recipient_unlinked»', async () => {
    const claimed = await claimPlatformOutbox(db.app.db, {
      now: NOW,
      limit: 25,
      leaseSeconds: 120,
    });
    expect(claimed).toEqual([
      { id: ids.platform, chatId: 1006, kind: 'pass_changed', text: 'Пароль изменён', tries: 1 },
    ]);
    // До конца аренды строку не берёт другой запуск; строки организаций сюда не попадают.
    expect(
      await claimPlatformOutbox(db.app.db, { now: NOW, limit: 25, leaseSeconds: 120 }),
    ).toEqual([]);
    await finishPlatformOutbox(db.app.db, [{ id: ids.platform!, result: 'sent', at: NOW }]);
    const [sent] = await db.admin.db
      .select()
      .from(telegramOutbox)
      .where(eq(telegramOutbox.id, ids.platform!));
    expect(sent).toMatchObject({ status: 'sent', sentAt: NOW, lastError: null, tries: 1 });
    // Итог уже отправленной строки не перезаписывается.
    await finishPlatformOutbox(db.app.db, [{ id: ids.platform!, result: 'error', error: 'x' }]);
    const [still] = await db.admin.db
      .select({ status: telegramOutbox.status })
      .from(telegramOutbox)
      .where(eq(telegramOutbox.id, ids.platform!));
    expect(still!.status).toBe('sent');

    // Повтор с временной ошибкой, затем администратор отвязал Telegram — строка не уходит в прежний чат.
    await db.admin.db
      .update(telegramOutbox)
      .set({ status: 'pending', nextAt: NOW, sentAt: null })
      .where(eq(telegramOutbox.id, ids.platform!));
    const [again] = await claimPlatformOutbox(db.app.db, {
      now: NOW,
      limit: 25,
      leaseSeconds: 120,
    });
    const later = new Date(NOW.getTime() + 60_000);
    await finishPlatformOutbox(db.app.db, [
      { id: again!.id, result: 'retry', at: later, error: '429: Too Many Requests' },
    ]);
    const [retry] = await db.admin.db
      .select()
      .from(telegramOutbox)
      .where(eq(telegramOutbox.id, ids.platform!));
    expect(retry).toMatchObject({ status: 'pending', nextAt: later, tries: 2 });
    expect(retry!.lastError).toBe('429: Too Many Requests');
    await db.admin.db.delete(telegramLinks).where(eq(telegramLinks.userId, adminId));
    expect(
      await claimPlatformOutbox(db.app.db, { now: later, limit: 25, leaseSeconds: 120 }),
    ).toEqual([]);
    const [gone] = await db.admin.db
      .select()
      .from(telegramOutbox)
      .where(eq(telegramOutbox.id, ids.platform!));
    expect(gone).toMatchObject({ status: 'error', lastError: OUTBOX_UNDELIVERABLE });
  });

  it('«Рассылка»: активным сотрудникам действующих организаций с Telegram; одной организации; заблокированной — нет', async () => {
    expect(await asAdmin((tx) => adminTelegramOrgs(tx))).toEqual([
      { id: a.orgId, name: 'ОсОО «Альфа»' },
      { id: b.orgId, name: 'ОсОО «Бета»' },
    ]);
    const before = new Set((await db.admin.db.select().from(telegramOutbox)).map((r) => r.id));
    const all = await asAdmin((tx) =>
      adminTelegramBroadcast(tx, { orgId: null, text: 'Плановые работы', now: NOW }),
    );
    // Владельцы «Альфы» и «Беты»; без заблокированных, неактивных, «Гаммы» и администратора платформы.
    expect(all).toBe(2);
    const added = (await db.admin.db.select().from(telegramOutbox)).filter(
      (r) => !before.has(r.id),
    );
    expect(
      added.map((r) => [r.orgId, r.userId, r.chatId, r.kind, r.text, r.status, r.tries]).sort(),
    ).toEqual(
      [
        [a.orgId, a.ownerUserId, 1001, 'broadcast', 'Плановые работы', 'pending', 0],
        [b.orgId, b.ownerUserId, 1002, 'broadcast', 'Плановые работы', 'pending', 0],
      ].sort(),
    );
    expect(added.every((r) => r.nextAt.getTime() === NOW.getTime())).toBe(true);
    const history = await asAdmin((tx) => readPlatformHistory(tx, 'telegram_broadcast', 'all'));
    expect(history.map((h) => [h.action, h.actorUserId, h.changes])).toEqual([
      [
        'create',
        adminId,
        [
          { field: 'text', to: 'Плановые работы' },
          { field: 'queued', to: 2 },
        ],
      ],
    ]);
    expect(
      await asAdmin((tx) => adminTelegramBroadcast(tx, { orgId: b.orgId, text: 'Бете', now: NOW })),
    ).toBe(1);
    expect(
      await asAdmin((tx) =>
        adminTelegramBroadcast(tx, { orgId: c.orgId, text: 'Гамме', now: NOW }),
      ),
    ).toBeNull();
    expect(
      await asAdmin((tx) =>
        adminTelegramBroadcast(tx, {
          orgId: '00000000-0000-4000-8000-000000000000',
          text: 'Никому',
          now: NOW,
        }),
      ),
    ).toBeNull();
    // Сообщения рассылки видит своя организация в своём журнале, чужая — нет.
    const own = await withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, (tx) =>
      tx
        .select({ text: telegramOutbox.text })
        .from(telegramOutbox)
        .where(eq(telegramOutbox.kind, 'broadcast')),
    );
    expect(own.map((r) => r.text).sort()).toEqual(['Бете', 'Плановые работы']);
  });
});
