import {
  createFakeTelegram,
  fixedClock,
  type FakeTelegram,
  type FixedClock,
} from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import {
  botPressData,
  fillTemplate,
  LEAD_BOT_ACTIONS,
  TELEGRAM_TEMPLATE_DEFAULTS,
  type BotMessage,
} from '@buhuchet/domain';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import {
  apiRequest,
  createStaffFixture,
  createTestDeps,
  linkTelegram,
  sendToBot,
  signIn,
  telegramPress,
  telegramUpdate,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../../testing';
import { telegramSendJob } from './outbox';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type App = ReturnType<typeof createApp>;

const TPL = TELEGRAM_TEMPLATE_DEFAULTS;
const SITE = 'https://buhuchet.test';
const CHAT = { admin: 8100, second: 8101, blocked: 8102, owner: 8200 };
const noPause = async () => {};

// Заявка с сайта в Telegram — с кнопками (поток Т, задача Т6; пакет заказчика 13.11.2026, идея 14;
// прототип v103 admin/tg-leads.js).
describe.skipIf(!databaseAvailable())(
  'заявка с сайта: сообщение администраторам платформы с кнопками «Взять в работу» и «Отклонить» (Т6)',
  () => {
    let f: Fixture;
    let tg: FakeTelegram;
    let clock: FixedClock;
    let deps: ApiDeps;
    let app: App;
    let adminId = '';
    let secondId = '';
    let blockedId = '';
    let n = 0;

    const sent = (chatId: number) =>
      tg.sent.map((m, i) => ({ ...m, id: tg.messageIds[i]! })).filter((m) => m.chatId === chatId);
    const last = (chatId: number) => sent(chatId).at(-1)!;
    const keys = (m: { options: FakeTelegram['sent'][number]['options'] }) =>
      (m.options.keyboard ?? []).flat();
    const press = async (chatId: number, messageId: number, data: string) => {
      const res = await sendToBot(app, telegramPress(data, chatId, messageId));
      expect(res.status).toBe(200);
      return tg.answers.at(-1)!;
    };
    const say = async (chatId: number, text: string, replyTo?: number) => {
      const res = await sendToBot(
        app,
        telegramUpdate(text, chatId, replyTo === undefined ? {} : { replyTo }),
      );
      expect(res.status).toBe(200);
      return last(chatId);
    };
    const leadOf = async (id: string) =>
      (
        await f.t.admin.db
          .select()
          .from(schema.platformLeads)
          .where(eq(schema.platformLeads.id, id))
      )[0];
    const events = (id: string) =>
      f.t.admin.db
        .select({
          kind: schema.platformLeadEvents.kind,
          to: schema.platformLeadEvents.toStatus,
          text: schema.platformLeadEvents.text,
          via: schema.platformLeadEvents.via,
          actor: schema.platformLeadEvents.actorUserId,
        })
        .from(schema.platformLeadEvents)
        .where(eq(schema.platformLeadEvents.leadId, id))
        .orderBy(asc(schema.platformLeadEvents.id));
    const outbox = (userId: string, leadId: string) =>
      f.t.admin.db
        .select()
        .from(schema.telegramOutbox)
        .where(
          and(eq(schema.telegramOutbox.userId, userId), eq(schema.telegramOutbox.kind, 'lead')),
        )
        .then((rows) => rows.filter((r) => r.dedupeKey?.startsWith(`lead:${leadId}:`)));

    /** Заявка с сайта и отправка очереди: что пришло каждому администратору. */
    const submit = async (over: Record<string, unknown> = {}) => {
      n += 1;
      const phone = `+9967001${String(10000 + n)}`;
      const res = await app.request('/api/leads', {
        method: 'POST',
        headers: {
          origin: TEST_ORIGIN,
          'content-type': 'application/json',
          'x-forwarded-for': `203.0.113.${n}, 10.0.0.1`,
        },
        body: JSON.stringify({
          name: 'Айгуль Садыкова',
          firm: 'ОсОО «Учёт Плюс»',
          phone,
          size: '21–50',
          telegram: '@aigul',
          note: 'Перезвоните после обеда',
          consent: true,
          website: '',
          ...over,
        }),
      });
      expect(res.status).toBe(200);
      await telegramSendJob(noPause).run(deps, clock.now());
      const [lead] = await f.t.admin.db
        .select()
        .from(schema.platformLeads)
        .where(eq(schema.platformLeads.phone, (over.phone as string | undefined) ?? phone));
      return { lead: lead!, admin: last(CHAT.admin), second: last(CHAT.second) };
    };
    const work = (id: string) => botPressData(LEAD_BOT_ACTIONS.work, id);
    const no = (id: string) => botPressData(LEAD_BOT_ACTIONS.no, id);

    beforeAll(async () => {
      f = await createStaffFixture();
      tg = createFakeTelegram();
      clock = fixedClock('2026-11-14T04:00:00Z');
      const base = createTestDeps().config;
      deps = createTestDeps({
        db: f.t.app.db,
        telegram: tg,
        clock,
        config: { ...base, APP_BASE_URL: SITE },
      });
      app = createApp(deps);
      const [admin] = await f.t.admin.db
        .select({ id: schema.users.id, hash: schema.users.passwordHash })
        .from(schema.users)
        .where(eq(schema.users.isPlatformAdmin, true));
      adminId = admin!.id;
      const more = await f.t.admin.db
        .insert(schema.users)
        .values([
          { login: 'platform-second', passwordHash: admin!.hash, isPlatformAdmin: true },
          { login: 'platform-blocked', passwordHash: admin!.hash, isPlatformAdmin: true },
        ])
        .returning({ id: schema.users.id });
      secondId = more[0]!.id;
      blockedId = more[1]!.id;
      await f.t.admin.db.insert(schema.telegramLinks).values([
        { userId: adminId, orgId: null, chatId: CHAT.admin },
        { userId: secondId, orgId: null, chatId: CHAT.second },
        { userId: blockedId, orgId: null, chatId: CHAT.blocked },
      ]);
      await linkTelegram(app, await signIn(app, 'owner-a', TEST_PASSWORD), CHAT.owner);
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    beforeEach(async () => {
      await f.t.admin.db
        .update(schema.users)
        .set({ blocked: false, telegramPlain: false })
        .where(eq(schema.users.isPlatformAdmin, true));
    });

    it('новая заявка: заголовок, таблица и кнопки каждому администратору; простой вид — прежний текст с теми же кнопками', async () => {
      await f.t.admin.db
        .update(schema.users)
        .set({ telegramPlain: true })
        .where(eq(schema.users.id, secondId));
      const { lead, admin, second } = await submit();
      const plain = `📩 Новая заявка с сайта: ОсОО «Учёт Плюс», Айгуль Садыкова, ${admin.text.match(/\+996[\d ]+/)![0]}, клиентов: 21–50. Открыть: ${SITE}/app/orgs/leads`;
      expect(admin.text).toBe(plain);
      expect(admin.options.rich).toContain(TPL.tgLeadHead);
      expect(admin.options.rich).toContain('ОсОО «Учёт Плюс»');
      expect(admin.options.rich).toContain('Контрагентов');
      // Комментарий гостя и его Telegram — только в Админке.
      expect(admin.options.rich).not.toContain('Перезвоните');
      expect(admin.options.rich).not.toContain('@aigul');
      expect(keys(admin)).toEqual([
        { text: TPL.tgBtnLeadWork, data: work(lead.id) },
        { text: TPL.tgBtnLeadNo, data: no(lead.id) },
        { text: TPL.tgBtnLeadOpen, url: `${SITE}/app/orgs/leads` },
      ]);
      // «Сообщения простым текстом» второго администратора: тот же текст без таблицы, кнопки те же.
      expect(second.text).toBe(plain);
      expect(second.options.rich).toBeUndefined();
      expect(keys(second)).toEqual(keys(admin));
      // Номер сообщения в чате записан: по нему бот найдёт сообщение при нажатии.
      const [row] = await outbox(adminId, lead.id);
      expect(row).toMatchObject({ status: 'sent', messageId: admin.id, orgId: null });
    });

    it('«Взять в работу»: заявка «В работе», в истории — администратор и «через Telegram»; второй администратор получает «Кнопка устарела»', async () => {
      const { lead, admin, second } = await submit();
      const answer = await press(CHAT.admin, admin.id, work(lead.id));
      expect(answer).toMatchObject({
        text: fillTemplate(TPL.tgActLeadWork, { фирма: 'ОсОО «Учёт Плюс»' }),
        alert: false,
      });
      expect(await leadOf(lead.id)).toMatchObject({ status: 'in_progress', version: 2 });
      expect(await events(lead.id)).toEqual([
        { kind: 'created', to: 'new', text: null, via: null, actor: null },
        { kind: 'status', to: 'in_progress', text: null, via: 'telegram', actor: adminId },
      ]);
      // Кнопка погасла с новой подписью, «Отклонить» осталась.
      const [row] = await outbox(adminId, lead.id);
      const buttons = (row!.payload as BotMessage).buttons!;
      expect(buttons[0]).toEqual([
        { text: '✓ В работе', action: 'leadWork', arg: lead.id, off: true },
        { text: TPL.tgBtnLeadNo, action: 'leadNo', arg: lead.id },
      ]);
      expect(tg.edits.at(-1)).toMatchObject({ chatId: CHAT.admin, messageId: admin.id });
      // Повторное нажатие и нажатие второго администратора — «Кнопка устарела», заявка не меняется.
      expect(await press(CHAT.admin, admin.id, work(lead.id))).toMatchObject({
        text: TPL.tgActStale,
        alert: true,
      });
      expect(await press(CHAT.second, second.id, work(lead.id))).toMatchObject({
        text: TPL.tgActStale,
        alert: true,
      });
      expect(await leadOf(lead.id)).toMatchObject({ status: 'in_progress', version: 2 });
      // В окне заявки Админки запись — с отметкой «через Telegram».
      const cookie = await signIn(app, 'platform-admin', TEST_PASSWORD);
      const card = await apiRequest(app, 'GET', `/api/admin/leads/${lead.id}`, cookie);
      expect(card.status).toBe(200);
      const body = (await card.json()) as {
        history: { kind: string; via: string | null }[];
        statusHistory: { to: string; via?: string | null }[];
      };
      expect(body.history.map((e) => [e.kind, e.via])).toEqual([
        ['created', null],
        ['status', 'telegram'],
      ]);
      expect(body.statusHistory.map((e) => [e.to, e.via ?? null])).toEqual([
        ['new', null],
        ['in_progress', 'telegram'],
      ]);
    });

    it('«Отклонить»: бот просит причину; без причины заявка не меняется; с причиной — «Отказ», кнопки гаснут', async () => {
      const { lead, second } = await submit();
      const answer = await press(CHAT.second, second.id, no(lead.id));
      expect(answer.alert).toBe(false);
      const ask = last(CHAT.second);
      expect(ask.text).toBe(fillTemplate(TPL.tgLeadAskWhy, { фирма: 'ОсОО «Учёт Плюс»' }));
      expect(await leadOf(lead.id)).toMatchObject({ status: 'new', version: 1 });
      // Второе нажатие вторую просьбу не шлёт.
      const before = sent(CHAT.second).length;
      expect((await press(CHAT.second, second.id, no(lead.id))).text).toBe(TPL.tgActAskWait);
      expect(sent(CHAT.second).length).toBe(before);
      // Причина из одних скобок — не причина: бот ждёт дальше.
      expect((await say(CHAT.second, ' ( ) ', ask.id)).text).toBe(TPL.tgAskNeedText);
      expect(await leadOf(lead.id)).toMatchObject({ status: 'new' });
      const done = await say(CHAT.second, 'Нужна программа\n(с проводками)', ask.id);
      expect(done.text).toBe(
        fillTemplate(TPL.tgLeadRefused, {
          фирма: 'ОсОО «Учёт Плюс»',
          причина: 'Нужна программа с проводками',
        }),
      );
      expect(await leadOf(lead.id)).toMatchObject({
        status: 'rejected',
        statusBefore: 'new',
        version: 2,
      });
      expect((await events(lead.id)).at(-1)).toEqual({
        kind: 'status',
        to: 'rejected',
        text: 'Нужна программа с проводками',
        via: 'telegram',
        actor: secondId,
      });
      const [row] = await outbox(secondId, lead.id);
      expect((row!.payload as BotMessage).buttons![0]).toEqual([
        { text: TPL.tgBtnLeadWork, action: 'leadWork', arg: lead.id, off: true },
        { text: '✓ Отказ', action: 'leadNo', arg: lead.id, off: true },
      ]);
      // У первого администратора кнопки остались, но обе устарели.
      const first = last(CHAT.admin);
      expect((await press(CHAT.admin, first.id, work(lead.id))).text).toBe(TPL.tgActStale);
      expect((await press(CHAT.admin, first.id, no(lead.id))).text).toBe(TPL.tgActStale);
    });

    it('пока бот ждал причину, заявку взяли в работу на сайте и подключили: ответ — «Кнопка устарела»', async () => {
      const { lead, admin } = await submit();
      await press(CHAT.admin, admin.id, no(lead.id));
      const ask = last(CHAT.admin);
      const cookie = await signIn(app, 'platform-admin', TEST_PASSWORD);
      for (const [to, version] of [
        ['in_progress', 1],
        ['connected', 2],
      ] as const) {
        const res = await apiRequest(app, 'POST', `/api/admin/leads/${lead.id}/status`, cookie, {
          to,
          version,
        });
        expect(res.status).toBe(200);
      }
      expect((await say(CHAT.admin, 'Дорого', ask.id)).text).toBe(TPL.tgActStale);
      expect(await leadOf(lead.id)).toMatchObject({ status: 'connected', version: 3 });
      // Запись сайта — без отметки «через Telegram».
      expect((await events(lead.id)).map((e) => e.via)).toEqual([null, null, null]);
    });

    it('удалённая заявка: сообщение стёрто из журнала, нажатие — «Кнопка устарела»', async () => {
      const { lead, admin } = await submit();
      const cookie = await signIn(app, 'platform-admin', TEST_PASSWORD);
      const res = await apiRequest(app, 'DELETE', `/api/admin/leads/${lead.id}`, cookie);
      expect(res.status).toBeLessThan(300);
      expect(await outbox(adminId, lead.id)).toEqual([]);
      expect(await press(CHAT.admin, admin.id, work(lead.id))).toMatchObject({
        text: TPL.tgActStale,
        alert: true,
      });
    });

    it('повторная заявка: строка «Статус» и кнопки по статусу сохранённой заявки', async () => {
      const first = await submit({ phone: '+996700555001' });
      await press(CHAT.admin, first.admin.id, work(first.lead.id));
      const again = await submit({
        phone: '+996700555001',
        firm: 'ОсОО «Другая»',
        name: 'Чужое Имя',
      });
      expect(again.lead.id).toBe(first.lead.id);
      expect(again.admin.id).not.toBe(first.admin.id);
      expect(again.admin.text).toBe(
        `🔁 Повторная заявка с сайта: ОсОО «Учёт Плюс», Айгуль Садыкова, +996 700 555 001. Открыть: ${SITE}/app/orgs/leads`,
      );
      expect(again.admin.options.rich).toContain(TPL.tgLeadRepHead);
      expect(again.admin.options.rich).toContain('В работе');
      expect(again.admin.options.rich).not.toContain('Другая');
      expect(keys(again.admin)).toEqual([
        { text: TPL.tgBtnLeadNo, data: no(first.lead.id) },
        { text: TPL.tgBtnLeadOpen, url: `${SITE}/app/orgs/leads` },
      ]);
    });

    it('кнопки заявки действуют только у администратора платформы: сотруднику и заблокированному администратору — «Нет права»', async () => {
      const { lead, admin } = await submit();
      // Такое сообщение в чате владельца организации (его туда никто не шлёт): действие всё равно
      // проверяет, кто нажал.
      const [copy] = await outbox(adminId, lead.id);
      await f.t.admin.db.insert(schema.telegramOutbox).values({
        orgId: f.a.orgId,
        userId: f.a.ownerUserId,
        chatId: CHAT.owner,
        kind: 'broadcast',
        text: 'x',
        status: 'sent',
        payload: copy!.payload,
        messageId: 990_001,
      });
      expect(await press(CHAT.owner, 990_001, work(lead.id))).toMatchObject({
        text: TPL.tgActNoRight,
        alert: true,
      });
      expect(await press(CHAT.owner, 990_001, no(lead.id))).toMatchObject({
        text: TPL.tgActNoRight,
        alert: true,
      });
      // Чужой чат: нажатие из чата второго администратора по сообщению первого — сообщения там нет.
      expect((await press(CHAT.second, admin.id, work(lead.id))).text).toBe(TPL.tgActStale);
      // Администратора заблокировали после отправки.
      await f.t.admin.db
        .update(schema.users)
        .set({ blocked: true })
        .where(eq(schema.users.id, adminId));
      expect(await press(CHAT.admin, admin.id, work(lead.id))).toMatchObject({
        text: TPL.tgActNoRight,
        alert: true,
      });
      expect(await leadOf(lead.id)).toMatchObject({ status: 'new', version: 1 });
      expect(await events(lead.id)).toHaveLength(1);
    });

    it('заблокированному администратору сообщение о заявке не ставится; ловушка сообщений не даёт', async () => {
      await f.t.admin.db
        .update(schema.users)
        .set({ blocked: true })
        .where(eq(schema.users.id, blockedId));
      const before = tg.sent.length;
      const toBlocked = sent(CHAT.blocked).length;
      const { lead } = await submit();
      expect(await outbox(blockedId, lead.id)).toEqual([]);
      expect(sent(CHAT.blocked).length).toBe(toBlocked);
      expect(tg.sent.length).toBe(before + 2);
      n += 1;
      const trap = await app.request('/api/leads', {
        method: 'POST',
        headers: {
          origin: TEST_ORIGIN,
          'content-type': 'application/json',
          'x-forwarded-for': `203.0.113.${n}`,
        },
        body: JSON.stringify({
          name: 'Бот',
          firm: 'Спам',
          phone: '+996700999001',
          size: '21–50',
          telegram: '',
          note: '',
          consent: true,
          website: 'http://spam.example',
        }),
      });
      expect(trap.status).toBe(200);
      await telegramSendJob(noPause).run(deps, clock.now());
      expect(tg.sent.length).toBe(before + 2);
    });
  },
);
