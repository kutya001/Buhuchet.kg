import { incomingEntry, shortName, type IncomingEntry, type ListQuery } from '@buhuchet/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminJobAlertMessage,
  adminTelegramMessage,
  adminTelegramRetry,
  adminTelegramSummary,
  listAdminTelegramLogPage,
  type JournalScope,
} from './admin-telegram';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import { createContractor, type ContractorFields } from './contractors';
import { createOrganization, type CreatedOrganization } from './organizations';
import { platformAlert } from './scheduler';
import {
  contractorTelegramLinks,
  contractorTelegramMessages,
  telegramGroups,
  telegramInbox,
  telegramLinks,
  telegramOutbox,
  users,
} from './schema';
import { beginTelegramInbox, cleanupTelegramInbox, finishTelegramInbox } from './telegram-inbox';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const t = (key: string) => key;
const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  sort: undefined,
  page: 1,
  size: 50,
  filters: {},
  ...over,
});
// 07.11.2026, 10:00 по Бишкеку.
const NOW = new Date('2026-11-07T04:00:00Z');
const TODAY = '2026-11-07';
const SINCE = new Date('2026-08-10T00:00:00Z');
const ALL: JournalScope = { dir: null, from: SINCE };
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});

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

const entry = (update: unknown): IncomingEntry => {
  const e = incomingEntry(update);
  if (!e) throw new Error('обновление не идёт в журнал');
  return e;
};
const from = { id: 5, first_name: 'Асан', username: 'asan' };
const privateChat = (id: number) => ({ id, type: 'private' });

describe.skipIf(!databaseAvailable())(
  'журнал переписки бота: полученное и общий журнал (прототип v132)',
  () => {
    let db: TestDatabase;
    let a: CreatedOrganization;
    let b: CreatedOrganization;
    let adminId: string;
    let cpId: string;
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      db = await createTestDatabase();
      await seedAccessReference(db.admin.db);
      await seedAllPlatformDictionaries(db.admin.db);
      const owner = (fullName: string, login: string) => ({ fullName, login, passwordHash: 'h' });
      a = await createOrganization(db.app.db, {
        name: 'ОсОО «Альфа»',
        inn: '01811201810456',
        slug: 'alfa',
        owner: owner('Асанов Асан Асанович', 'asanov'),
      });
      b = await createOrganization(db.app.db, {
        name: 'ОсОО «Бета»',
        inn: '02811201810457',
        slug: 'beta',
        owner: owner('Бекова Бермет', 'bekova'),
      });
      const [admin] = await db.admin.db
        .insert(users)
        .values({ login: 'platform', passwordHash: 'h', isPlatformAdmin: true })
        .returning({ id: users.id });
      adminId = admin!.id;
      await db.admin.db.insert(telegramLinks).values([
        { userId: a.ownerUserId, orgId: a.orgId, chatId: 1001, username: 'asan' },
        { userId: b.ownerUserId, orgId: b.orgId, chatId: 1002, username: 'bermet' },
        { userId: adminId, orgId: null, chatId: 1006, username: 'admin' },
      ]);
      await db.admin.db.insert(telegramGroups).values({
        orgId: a.orgId,
        chatId: -5001,
        title: 'Альфа: бухгалтерия',
        linkedBy: a.ownerUserId,
      });
      cpId = await withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, (tx) =>
        createContractor(tx, a.orgId, contractor('03807819461915', 'ОсОО «Клиент»'), null),
      );
      const [link] = await db.admin.db
        .insert(contractorTelegramLinks)
        .values({ orgId: a.orgId, contractorId: cpId, chatId: 2001, name: 'Нурлан', status: 'on' })
        .returning({ id: contractorTelegramLinks.id });
      // Сообщение сотруднику с кнопками (ушло в чат под номером 77) и сообщение клиенту «К оплате» (88).
      const [out] = await db.admin.db
        .insert(telegramOutbox)
        .values({
          orgId: a.orgId,
          userId: a.ownerUserId,
          chatId: 1001,
          kind: 'reminders',
          text: 'Сегодня последний день сдачи\nЕН за октябрь',
          status: 'sent',
          tries: 1,
          sentAt: at(-30),
          createdAt: at(-30),
          messageId: 77,
          payload: {
            heading: 'Сегодня последний день сдачи',
            buttons: [
              [{ text: 'Сдан: ЕН за октябрь', action: 'repDone', arg: 'r1' }],
              [{ text: 'Открыть «На неделе»', url: 'https://buhuchet.kg/app' }],
            ],
          },
        })
        .returning({ id: telegramOutbox.id });
      ids.out = out!.id;
      const [pay] = await db.admin.db
        .insert(contractorTelegramMessages)
        .values({
          orgId: a.orgId,
          contractorId: cpId,
          linkId: link!.id,
          chatId: 2001,
          messageId: 88,
          kind: 'pay',
          month: '2026-10',
          total: 125_000,
          payload: {
            heading: 'К оплате за октябрь',
            text: 'Итого 1 250 сом',
            buttons: [[{ text: 'Оплатил', action: 'cpPaid' }]],
          },
          createdAt: at(-20),
        })
        .returning({ id: contractorTelegramMessages.id });
      ids.pay = pay!.id;
    });

    afterAll(async () => {
      await db?.drop();
    });

    const asAdmin = <T>(fn: Parameters<typeof withUserContext<T>>[2]) =>
      withUserContext(db.app.db, adminId, fn);
    const begin = async (key: string, update: unknown, min: number) => {
      const id = await beginTelegramInbox(db.app.db, entry(update), at(min));
      if (id) ids[key] = id;
      return id;
    };
    const stored = async (id: string) =>
      (
        await db.admin.db
          .select()
          .from(telegramInbox)
          .where(sql`${telegramInbox.id} = ${id}`)
      )[0]!;

    it('нажатие кнопки: чей чат и подпись кнопки — из отправленного сообщения; повторная доставка — одна строка', async () => {
      const press = {
        update_id: 501,
        callback_query: {
          id: 'q1',
          from,
          data: 'repDone:r1',
          message: { message_id: 77, chat: privateChat(1001) },
        },
      };
      expect(await begin('press', press, -10)).toEqual(expect.any(String));
      expect(await beginTelegramInbox(db.app.db, entry(press), at(-9))).toBeNull();
      expect(await stored(ids.press!)).toMatchObject({
        chatKind: 'private',
        orgId: a.orgId,
        userId: a.ownerUserId,
        kind: 'press',
        button: 'Сдан: ЕН за октябрь',
        replyMessageId: 77,
        status: 'new',
        text: null,
        sender: 'Асан @asan',
      });
      await finishTelegramInbox(db.app.db, ids.press!, { status: 'done' });
      // Итог пишется один раз.
      await finishTelegramInbox(db.app.db, ids.press!, { status: 'error', error: 'поздно' });
      expect(await stored(ids.press!)).toMatchObject({ status: 'done', error: null });
    });

    it('код и ссылка привязки пишутся без текста; текст и файл — с текстом; чат клиента и общий чат узнаются', async () => {
      await begin(
        'link',
        {
          update_id: 502,
          message: {
            message_id: 1,
            text: '/start AbCdEf0123456789',
            chat: privateChat(3001),
            from,
          },
        },
        -8,
      );
      await begin(
        'code',
        {
          update_id: 503,
          message: { message_id: 2, text: '482 915', chat: privateChat(1001), from },
        },
        -7,
      );
      expect(await stored(ids.link!)).toMatchObject({
        kind: 'link',
        hide: 'link',
        text: null,
        orgId: null,
        userId: null,
        chatKind: 'private',
      });
      expect(await stored(ids.code!)).toMatchObject({
        kind: 'code',
        hide: 'code',
        text: null,
        userId: a.ownerUserId,
      });
      // Даже если вызвать функцию базы с текстом кода — он не запишется.
      const [raw] = await db.app.db.execute<{ id: string }>(
        sql`select app.telegram_inbox_begin(504, 1001, false, 'x', 'code', '482915', null, null, null, null, null, ${at(-7).toISOString()}::timestamptz) as id`,
      );
      expect(await stored(raw!.id)).toMatchObject({ kind: 'code', hide: 'code', text: null });
      await db.admin.db.delete(telegramInbox).where(sql`${telegramInbox.id} = ${raw!.id}`);

      await begin(
        'text',
        {
          update_id: 505,
          message: { message_id: 3, text: 'как дела?', chat: privateChat(1001), from },
        },
        -6,
      );
      await finishTelegramInbox(db.app.db, ids.text!, { status: 'unknown' });
      await begin(
        'cmd',
        {
          update_id: 506,
          message: { message_id: 4, text: 'Сегодня', chat: privateChat(1001), from },
        },
        -5,
      );
      await finishTelegramInbox(db.app.db, ids.cmd!, { status: 'done', command: true });
      expect(await stored(ids.cmd!)).toMatchObject({
        kind: 'command',
        status: 'done',
        text: 'Сегодня',
      });
      await begin(
        'file',
        {
          update_id: 507,
          message: {
            message_id: 5,
            caption: 'чек за октябрь',
            document: { file_id: 'f', file_name: 'чек.pdf', file_size: 2048 },
            chat: privateChat(2001),
            from: { id: 9, first_name: 'Нурлан' },
          },
        },
        -4,
      );
      await finishTelegramInbox(db.app.db, ids.file!, { status: 'error', error: 'S3: timeout' });
      expect(await stored(ids.file!)).toMatchObject({
        chatKind: 'client',
        orgId: a.orgId,
        contractorId: cpId,
        userId: null,
        kind: 'file',
        fileName: 'чек.pdf',
        fileSize: 2048,
        text: 'чек за октябрь',
        status: 'error',
        error: 'S3: timeout',
      });
      await begin(
        'paid',
        {
          update_id: 508,
          callback_query: {
            id: 'q2',
            from: { id: 9, first_name: 'Нурлан' },
            data: 'cpPaid',
            message: { message_id: 88, chat: privateChat(2001) },
          },
        },
        -3,
      );
      expect(await stored(ids.paid!)).toMatchObject({
        chatKind: 'client',
        contractorId: cpId,
        button: 'Оплатил',
      });
      await begin(
        'joined',
        {
          update_id: 509,
          my_chat_member: {
            chat: { id: -5001, type: 'supergroup' },
            from,
            new_chat_member: { status: 'member' },
          },
        },
        -2,
      );
      expect(await stored(ids.joined!)).toMatchObject({
        chatKind: 'group',
        orgId: a.orgId,
        userId: null,
        kind: 'joined',
      });
    });

    it('роль приложения полученное не читает и не меняет: только функции', async () => {
      await expect(db.app.db.select().from(telegramInbox)).rejects.toEqual(permissionDenied);
      await expect(db.app.db.delete(telegramInbox)).rejects.toEqual(permissionDenied);
      await expect(
        db.app.db.insert(telegramInbox).values({ chatId: 1, chatKind: 'private', kind: 'text' }),
      ).rejects.toEqual(permissionDenied);
      // И в контексте организации — тоже.
      await expect(
        withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, (tx) =>
          tx.select().from(telegramInbox),
        ),
      ).rejects.toEqual(permissionDenied);
    });

    it('чат без привязки: не больше 30 строк в час и 200 в сутки, все такие чаты — 2000 в час, текст до 500 знаков', async () => {
      const STRANGER = 900_001;
      let update = 900_000;
      const write = (chat: number, min: number, text = 'спам') =>
        beginTelegramInbox(
          db.app.db,
          entry({ update_id: ++update, message: { from, chat: privateChat(chat), text } }),
          at(min),
        );
      const first = await write(STRANGER, 0, 'я'.repeat(900));
      expect([...(await stored(first!)).text!]).toHaveLength(500);
      for (let i = 1; i < 30; i += 1) expect(await write(STRANGER, 0), String(i)).not.toBeNull();
      // Тридцать первая за час — мимо журнала; через час пишется снова.
      expect(await write(STRANGER, 30)).toBeNull();
      expect(await write(STRANGER, 61)).not.toBeNull();
      // Привязанный чат сотрудника предел не задевает, и текст у него — целиком.
      const own = await write(1001, 0, 'я'.repeat(900));
      expect([...(await stored(own!)).text!]).toHaveLength(900);
      const rows = (n: number, chat: (i: number) => number, min: number) =>
        Array.from({ length: n }, (_, i) => ({
          chatId: chat(i),
          chatKind: 'private' as const,
          kind: 'text' as const,
          text: 'спам',
          createdAt: at(min),
        }));
      // 31 строка уже есть; ещё 169 за те же сутки — и двухсот первая не пишется.
      await db.admin.db.insert(telegramInbox).values(rows(169, () => STRANGER, -600));
      expect(await write(STRANGER, 200)).toBeNull();
      // Много разных чужих чатов: общий предел за час.
      await db.admin.db.insert(telegramInbox).values(rows(2000, (i) => 910_000 + i, 300));
      expect(await write(900_002, 301)).toBeNull();
      expect(await write(1001, 301)).not.toBeNull();
      expect(await write(900_002, 400)).not.toBeNull();
      await db.admin.db
        .delete(telegramInbox)
        .where(
          sql`${telegramInbox.chatId} >= 900000 or ${telegramInbox.text} in ('спам', ${'я'.repeat(900)})`,
        );
    });

    it('администратор видит переписку в обе стороны с текстом; сотрудник и запрос без контекста — ничего', async () => {
      const page = await asAdmin((tx) => listAdminTelegramLogPage(tx, query(), t, ALL));
      expect(page.rows.map((r) => [r.dir, r.kind, r.status])).toEqual([
        ['in', 'in_joined', 'new'],
        ['in', 'in_press', 'new'],
        ['in', 'in_file', 'error'],
        ['in', 'in_command', 'done'],
        ['in', 'in_text', 'unknown'],
        ['in', 'in_code', 'new'],
        ['in', 'in_link', 'new'],
        ['in', 'in_press', 'done'],
        ['out', 'client_pay', 'sent'],
        ['out', 'reminders', 'sent'],
      ]);
      const by = (id: string) => page.rows.find((r) => r.id === id)!;
      expect(by(ids.press!)).toMatchObject({
        src: 'inbox',
        chatKind: 'private',
        orgName: 'ОсОО «Альфа»',
        recipient: `${shortName('Асанов Асан Асанович')} @asan`,
        button: 'Сдан: ЕН за октябрь',
      });
      expect(by(ids.code!)).toMatchObject({ text: null, hide: 'code' });
      expect(by(ids.link!)).toMatchObject({
        text: null,
        hide: 'link',
        orgId: null,
        recipient: 'Асан @asan',
      });
      expect(by(ids.file!)).toMatchObject({
        recipient: 'ОсОО «Клиент» · Нурлан',
        fileName: 'чек.pdf',
        chatKind: 'client',
      });
      expect(by(ids.joined!)).toMatchObject({ recipient: 'Альфа: бухгалтерия', chatKind: 'group' });
      expect(by(ids.pay!)).toMatchObject({
        src: 'client',
        recipient: 'ОсОО «Клиент» · Нурлан',
        text: null,
        message: expect.objectContaining({ heading: 'К оплате за октябрь' }),
      });
      expect(by(ids.out!).message).toMatchObject({ heading: 'Сегодня последний день сдачи' });
      for (const r of page.rows) expect(r).not.toHaveProperty('chatId');

      // Направление, период, поиск по тексту и «Текст скрыт».
      const incoming = await asAdmin((tx) =>
        listAdminTelegramLogPage(tx, query(), t, { dir: 'in', from: SINCE }),
      );
      expect(incoming.total).toBe(8);
      const fresh = await asAdmin((tx) =>
        listAdminTelegramLogPage(tx, query(), t, { dir: null, from: at(-5) }),
      );
      expect(fresh.rows.map((r) => r.kind)).toEqual([
        'in_joined',
        'in_press',
        'in_file',
        'in_command',
      ]);
      const found = await asAdmin((tx) =>
        listAdminTelegramLogPage(tx, query({ search: { q: 'как дела', keys: ['txt'] } }), t, ALL),
      );
      expect(found.rows.map((r) => r.id)).toEqual([ids.text]);
      const hidden = await asAdmin((tx) =>
        listAdminTelegramLogPage(
          tx,
          query({ search: { q: 'tgadm.hide.code', keys: ['txt'] } }),
          t,
          ALL,
        ),
      );
      expect(hidden.rows.map((r) => r.id)).toEqual([ids.code]);
      const clientText = await asAdmin((tx) =>
        listAdminTelegramLogPage(
          tx,
          query({ search: { q: 'к оплате за октябрь', keys: ['txt'] } }),
          t,
          ALL,
        ),
      );
      expect(clientText.rows.map((r) => r.id)).toEqual([ids.pay]);
      // «Вся переписка»: чат строки — без номера чата снаружи.
      const chat = await asAdmin((tx) =>
        listAdminTelegramLogPage(tx, query({ sort: { key: 'at', dir: 'asc' } }), t, {
          ...ALL,
          chatOf: ids.pay,
        }),
      );
      expect(chat.rows.map((r) => r.id)).toEqual([ids.pay, ids.file, ids.paid]);

      expect(await asAdmin((tx) => adminTelegramSummary(tx, TODAY, SINCE))).toEqual({
        pending: 0,
        errors: 0,
        sentToday: 2,
        receivedToday: 8,
      });

      const asOwner = await withOrgContext(
        db.app.db,
        { orgId: a.orgId, userId: a.ownerUserId },
        async (tx) => ({
          page: (await listAdminTelegramLogPage(tx, query(), t, ALL)).total,
          message: await adminTelegramMessage(tx, ids.press!, SINCE),
          alert: await adminJobAlertMessage(tx, 'telegram.send', NOW),
        }),
      );
      expect(asOwner).toEqual({ page: 0, message: null, alert: null });
      const [raw] = await db.app.db.execute<{ n: number }>(
        sql`select count(*)::integer as n from app.admin_telegram_journal`,
      );
      expect(raw!.n).toBe(0);
    });

    it('окно «Сообщение»: сообщение бота под нажатием, ответы под сообщением бота, «Раньше» и «Позже» в том же чате', async () => {
      const press = await asAdmin((tx) => adminTelegramMessage(tx, ids.press!, SINCE));
      expect(press!.message.id).toBe(ids.press);
      expect(press!.bot!.id).toBe(ids.out);
      expect(press!.prevId).toBe(ids.out);
      expect(press!.nextId).toBe(ids.code);
      const bot = await asAdmin((tx) => adminTelegramMessage(tx, ids.out!, SINCE));
      expect(bot!.bot).toBeNull();
      expect(bot!.replies.map((r) => r.id)).toEqual([ids.press]);
      expect(bot!.prevId).toBeNull();
      // Чужой чат в «Раньше · Позже» не попадает: у чата клиента — свои соседи.
      const pay = await asAdmin((tx) => adminTelegramMessage(tx, ids.pay!, SINCE));
      expect(pay!.replies.map((r) => r.id)).toEqual([ids.paid]);
      expect([pay!.prevId, pay!.nextId]).toEqual([null, ids.file]);
      // Старше срока хранения — как будто нет.
      expect(await asAdmin((tx) => adminTelegramMessage(tx, ids.out!, at(-1)))).toBeNull();
    });

    it('«Повторить отправку» — только отправленное сотрудникам: полученное и сообщение клиенту не трогает', async () => {
      const result = await asAdmin((tx) =>
        adminTelegramRetry(tx, [ids.file!, ids.pay!, ids.press!], NOW),
      );
      expect(result).toEqual({ queued: 0, codes: 0 });
      expect(await stored(ids.file!)).toMatchObject({ status: 'error' });
    });

    it('сообщение о сбое задачи находится по задаче и времени', async () => {
      expect(
        await platformAlert(db.app.db, {
          text: 'Задача не выполняется',
          key: 'job:files.storage-retry:failing:never',
          now: at(1),
        }),
      ).toBe(1);
      await db.admin.db
        .update(telegramOutbox)
        .set({ createdAt: at(1) })
        .where(sql`${telegramOutbox.kind} = 'alert'`);
      const alert = await asAdmin((tx) => adminJobAlertMessage(tx, 'files.storage-retry', at(1)));
      expect(alert).toEqual({ id: expect.any(String), at: at(1) });
      expect(await asAdmin((tx) => adminJobAlertMessage(tx, 'telegram.send', at(1)))).toBeNull();
      expect(
        await asAdmin((tx) => adminJobAlertMessage(tx, 'files.storage-retry', at(30))),
      ).toBeNull();
    });

    it('полученное старше 90 дней удаляет очистка; отправленное не трогает', async () => {
      expect(await cleanupTelegramInbox(db.app.db, at(-7))).toBe(2);
      const left = await db.admin.db.select({ id: telegramInbox.id }).from(telegramInbox);
      expect(left.map((r) => r.id)).not.toContain(ids.press);
      expect(left.map((r) => r.id)).not.toContain(ids.link);
      expect(left).toHaveLength(6);
      expect(await db.admin.db.select().from(telegramOutbox)).toHaveLength(2);
    });
  },
);
