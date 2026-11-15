import {
  createFakeTelegram,
  fixedClock,
  type FakeTelegram,
  type FixedClock,
} from '@buhuchet/adapters';
import { hashSessionToken } from '@buhuchet/adapters/tokens';
import {
  connectLeadToOrganization,
  schema,
  setLeadStatus,
  submitLead,
  withUserContext,
  type LeadSubmission,
} from '@buhuchet/db';
import { createOrganization } from '@buhuchet/db/organizations';
import { databaseAvailable } from '@buhuchet/db/testing';
import {
  botPressData,
  fillTemplate,
  LEAD_BOT_ACTIONS,
  TELEGRAM_TEMPLATE_DEFAULTS,
} from '@buhuchet/domain';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { ApiDeps } from '../../deps';
import {
  apiRequest,
  createStaffFixture,
  createTestDeps,
  sendToBot,
  signIn,
  telegramPress,
  telegramUpdate,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../../testing';
import {
  issueLeadTgLink,
  linkLeadOwnerTelegram,
  sendLeadRefused,
  sendOwnerSetup,
} from './lead-link';
import { telegramSendJob } from './outbox';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type App = ReturnType<typeof createApp>;

const TPL = TELEGRAM_TEMPLATE_DEFAULTS;
const SITE = 'https://buhuchet.test';
const BOT = 'buhuchet_test_bot';
const FIRM = 'ОсОО «Учёт Плюс»';
const LINK_RE = new RegExp(`^https://t\\.me/${BOT}\\?start=l_([A-Za-z0-9_-]{43})$`);
const SETUP_RE = new RegExp(`^${SITE.replace(/\./g, '\\.')}/setpass/([A-Za-z0-9_-]{43})$`);
const noPause = async () => {};

// Telegram заявителя и пароль по ссылке (поток Т, доработки 14.11.2026, блок 1, пункты 2–3; прототип
// v113 modules/tg-lead.js): ссылка на бота после заявки, «Старт», причина отказа заявителю,
// «Организация создана» с «Задать пароль», страница «Задать пароль» и «Отправить новую ссылку».
describe.skipIf(!databaseAvailable())('Telegram заявителя и пароль по ссылке (блок 1)', () => {
  let f: Fixture;
  let tg: FakeTelegram;
  let clock: FixedClock;
  let deps: ApiDeps;
  let app: App;
  let adminId = '';
  let admin = '';
  let n = 0;
  let chat = 9300;

  const sent = (chatId: number) => tg.sent.filter((m) => m.chatId === chatId);
  const last = (chatId: number) => sent(chatId).at(-1);
  const start = (key: string, chatId: number, over: { username?: string } = {}) =>
    sendToBot(
      app,
      telegramUpdate(`/start l_${key}`, chatId, {
        username: over.username ?? 'aigul_s',
        firstName: 'Айгуль',
      }),
    );

  const lead = (over: Partial<LeadSubmission> = {}): LeadSubmission => {
    n += 1;
    return {
      ipSubject: `ltg-api-${n}`,
      name: 'Айгуль Садыкова',
      firm: FIRM,
      phone: `+996555${String(400000 + n)}`,
      size: '21–50',
      telegram: '',
      note: '',
      fromStand: false,
      trap: false,
      notify: null,
      now: clock.now(),
      ...over,
    };
  };

  /** Заявка и ссылка «Подключить Telegram» — как подача заявки потока И. */
  const submitted = async (over: Partial<LeadSubmission> = {}) => {
    const s = lead(over);
    const res = await submitLead(f.t.app.db, s);
    const link = await f.t.app.db.transaction((tx) =>
      issueLeadTgLink(tx, {
        leadId: res.leadId,
        repeat: res.outcome === 'repeat',
        prior: null,
        now: s.now,
        botUsername: BOT,
      }),
    );
    const url = link && 'url' in link ? link.url : '';
    return { id: res.leadId!, link, key: LINK_RE.exec(url)?.[1] ?? '', phone: s.phone };
  };

  /** Заявитель подключил Telegram, «Одобрить» создало организацию и владельца без пароля. */
  const approved = async (slug: string, inn: string, withTelegram = true) => {
    chat += 1;
    const l = await submitted();
    if (withTelegram) expect((await start(l.key, chat)).status).toBe(200);
    const org = await createOrganization(f.t.app.db, {
      name: `ОсОО «${slug}»`,
      inn,
      slug,
      owner: { fullName: 'Садыкова Айгуль', login: `${slug}-owner`, passwordHash: 'нет пароля' },
    });
    await f.t.admin.db
      .update(schema.users)
      .set({ mustChangePassword: false })
      .where(eq(schema.users.id, org.ownerUserId));
    const linked = await withUserContext(f.t.app.db, adminId, async (tx) => {
      await connectLeadToOrganization(tx, {
        id: l.id,
        orgId: org.orgId,
        orgName: `ОсОО «${slug}»`,
        now: clock.now(),
      });
      return linkLeadOwnerTelegram(tx, { leadId: l.id, userId: org.ownerUserId });
    });
    return { lead: l, org, chat, linked };
  };

  const setupKeyOf = (chatId: number) => {
    const url = (last(chatId)?.options.keyboard ?? []).flat()[0]?.url ?? '';
    return SETUP_RE.exec(url)?.[1] ?? '';
  };
  const peek = (key: string) => app.request(`/api/auth/setup/${key}`);
  const setPassword = (key: string, password: string, origin: string | null = TEST_ORIGIN) =>
    app.request(`/api/auth/setup/${key}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify({ password }),
    });

  beforeAll(async () => {
    f = await createStaffFixture();
    tg = createFakeTelegram();
    clock = fixedClock('2026-11-15T04:00:00Z');
    const base = createTestDeps().config;
    deps = createTestDeps({
      db: f.t.app.db,
      telegram: tg,
      clock,
      config: { ...base, APP_BASE_URL: SITE, TELEGRAM_BOT_USERNAME: BOT },
    });
    app = createApp(deps);
    const [row] = await f.t.admin.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.isPlatformAdmin, true));
    adminId = row!.id;
    admin = await signIn(app, 'platform-admin', TEST_PASSWORD);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('ссылка на бота: новой заявке — t.me/<бот>?start=l_<ключ> на 24 часа; ловушке — того же вида, без записи; без имени бота — нет', async () => {
    const l = await submitted();
    expect(l.link).toEqual({
      url: expect.stringMatching(LINK_RE),
      token: l.key,
      expiresAt: new Date(clock.now().getTime() + 24 * 3_600_000),
    });
    const [row] = await f.t.admin.db
      .select()
      .from(schema.platformLeadTgTokens)
      .where(eq(schema.platformLeadTgTokens.leadId, l.id));
    expect(row?.tokenHash).toBe(hashSessionToken(l.key));

    const before = await f.t.admin.db.$count(schema.platformLeadTgTokens);
    const trap = await f.t.app.db.transaction((tx) =>
      issueLeadTgLink(tx, {
        leadId: null,
        repeat: false,
        prior: null,
        now: clock.now(),
        botUsername: BOT,
      }),
    );
    expect(trap).toEqual({
      url: expect.stringMatching(LINK_RE),
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiresAt: new Date(clock.now().getTime() + 24 * 3_600_000),
    });
    expect(await f.t.admin.db.$count(schema.platformLeadTgTokens)).toBe(before);

    const res = await submitLead(f.t.app.db, lead());
    expect(
      await f.t.app.db.transaction((tx) =>
        issueLeadTgLink(tx, {
          leadId: res.leadId,
          repeat: false,
          prior: null,
          now: clock.now(),
          botUsername: '',
        }),
      ),
    ).toBeNull();
  });

  it('повтор заявки: без ключа браузера — ничего; с ключом — та же ссылка, после «Старта» — «подключён»', async () => {
    const l = await submitted();
    clock.advance(60_000);
    const repeat = async (prior: string | null) => {
      const s = lead({ phone: l.phone, now: clock.now() });
      const res = await submitLead(f.t.app.db, s);
      expect(res.outcome).toBe('repeat');
      return f.t.app.db.transaction((tx) =>
        issueLeadTgLink(tx, {
          leadId: res.leadId,
          repeat: true,
          prior,
          now: s.now,
          botUsername: BOT,
        }),
      );
    };
    expect(await repeat(null)).toBeNull();
    clock.advance(60_000);
    expect(await repeat('мусор')).toBeNull();
    clock.advance(60_000);
    expect(await repeat(l.key)).toMatchObject({
      url: l.link && 'url' in l.link ? l.link.url : '',
      token: l.key,
    });
    expect((await start(l.key, 9201)).status).toBe(200);
    clock.advance(60_000);
    expect(await repeat(l.key)).toEqual({ linked: true });
  });

  it('«Старт» по ссылке: «Заявка получена» с фирмой; повтор доставки — без ответа; другой чат и неизвестный ключ — «Ссылка устарела»', async () => {
    const l = await submitted();
    expect((await start(l.key, 9211)).status).toBe(200);
    expect(last(9211)?.text).toBe(fillTemplate(TPL.tgLeadGot, { фирма: FIRM }));
    const [saved] = await f.t.admin.db
      .select()
      .from(schema.platformLeads)
      .where(eq(schema.platformLeads.id, l.id));
    expect(saved).toMatchObject({ tgChatId: 9211, tgUsername: 'aigul_s', tgFirstName: 'Айгуль' });
    const [event] = await f.t.admin.db
      .select()
      .from(schema.platformLeadEvents)
      .where(
        and(eq(schema.platformLeadEvents.leadId, l.id), eq(schema.platformLeadEvents.kind, 'tg')),
      );
    expect(event).toMatchObject({ text: '@aigul_s', via: 'telegram', actorUserId: null });

    const count = sent(9211).length;
    await start(l.key, 9211);
    expect(sent(9211)).toHaveLength(count);
    await start(l.key, 9212);
    expect(last(9212)?.text).toBe(TPL.tgLeadLinkBad);
    await start('A'.repeat(43), 9213);
    expect(last(9213)?.text).toBe(TPL.tgLeadLinkBad);
    // Ключ привязки сотрудника, который сам начинается с «l_», — не ссылка заявителя.
    await sendToBot(app, telegramUpdate(`/start l_${'B'.repeat(41)}`, 9214));
    expect(last(9214)?.text).toBe(TPL.tgLinkInvalid);
  });

  it('отказ кнопкой «Отклонить» в чате бота: причина заявителю в Telegram один раз', async () => {
    const [platform] = await f.t.admin.db
      .insert(schema.telegramLinks)
      .values({ userId: adminId, orgId: null, chatId: 9220 })
      .returning();
    try {
      n += 1;
      const phone = `+9967002${String(10000 + n)}`;
      const res = await app.request('/api/leads', {
        method: 'POST',
        headers: {
          origin: TEST_ORIGIN,
          'content-type': 'application/json',
          'x-forwarded-for': `203.0.113.${n}, 10.0.0.1`,
        },
        body: JSON.stringify({
          name: 'Айгуль Садыкова',
          firm: FIRM,
          phone,
          size: '21–50',
          telegram: '',
          note: '',
          consent: true,
          website: '',
        }),
      });
      expect(res.status).toBe(200);
      await telegramSendJob(noPause).run(deps, clock.now());
      const [saved] = await f.t.admin.db
        .select()
        .from(schema.platformLeads)
        .where(eq(schema.platformLeads.phone, phone));
      const link = await f.t.app.db.transaction((tx) =>
        issueLeadTgLink(tx, {
          leadId: saved!.id,
          repeat: false,
          prior: null,
          now: clock.now(),
          botUsername: BOT,
        }),
      );
      const key = LINK_RE.exec(link && 'url' in link ? link.url : '')![1]!;
      await start(key, 9221);

      const notice = tg.sent
        .map((m, i) => ({ ...m, id: tg.messageIds[i]! }))
        .filter((m) => m.chatId === 9220)
        .at(-1)!;
      await sendToBot(
        app,
        telegramPress(botPressData(LEAD_BOT_ACTIONS.no, saved!.id), 9220, notice.id),
      );
      const ask = tg.sent
        .map((m, i) => ({ ...m, id: tg.messageIds[i]! }))
        .filter((m) => m.chatId === 9220)
        .at(-1)!;
      await sendToBot(app, telegramUpdate('Не наш регион', 9220, { replyTo: ask.id }));
      expect(last(9221)?.text).toBe(
        fillTemplate(TPL.tgLeadNo, { фирма: FIRM, причина: 'Не наш регион' }),
      );
      expect(await sendLeadRefused(deps, { leadId: saved!.id })).toBe('not_linked');
    } finally {
      await f.t.admin.db
        .delete(schema.telegramLinks)
        .where(eq(schema.telegramLinks.userId, platform!.userId));
    }
  });

  it('отказ на сайте до «Старта»: причина приходит в ответ на «Старт»; после — sendLeadRefused её не повторяет', async () => {
    const l = await submitted();
    await withUserContext(f.t.app.db, adminId, (tx) =>
      setLeadStatus(tx, {
        id: l.id,
        version: null,
        to: 'rejected',
        before: 'new',
        text: 'Дубль заявки',
        now: clock.now(),
      }),
    );
    expect(await sendLeadRefused(deps, { leadId: l.id })).toBe('not_linked');
    await start(l.key, 9231);
    expect(last(9231)?.text).toBe(
      fillTemplate(TPL.tgLeadNo, { фирма: FIRM, причина: 'Дубль заявки' }),
    );
    expect(await sendLeadRefused(deps, { leadId: l.id })).toBe('not_linked');
  });

  it('«Одобрить»: Telegram заявителя — владельцу; «Организация создана» и «Задать пароль»; в журнале — без текста и кнопки', async () => {
    const { org, chat: c, linked } = await approved('ltg-api-a', '03811201810458');
    expect(linked).toBe(true);
    expect(await sendOwnerSetup(deps, { userId: org.ownerUserId, adminId })).toBe('sent');
    const msg = last(c)!;
    expect(msg.text).toBe(
      fillTemplate(TPL.tgLeadDone, {
        организация: 'ОсОО «ltg-api-a»',
        логин: 'ltg-api-a-owner',
        дней: 7,
      }),
    );
    expect((msg.options.keyboard ?? []).flat()).toEqual([
      { text: TPL.tgBtnSetPass, url: expect.stringMatching(SETUP_RE) },
    ]);
    const [log] = await f.t.admin.db
      .select()
      .from(schema.telegramOutbox)
      .where(eq(schema.telegramOutbox.userId, org.ownerUserId))
      .orderBy(desc(schema.telegramOutbox.createdAt));
    expect(log).toMatchObject({ kind: 'setup_link', text: null, payload: null, status: 'sent' });

    // Карточка организации: «Пароль не задан», Telegram есть.
    const card = await apiRequest(app, 'GET', `/api/admin/organizations/${org.orgId}/card`, admin);
    expect(card.status).toBe(200);
    const body = (await card.json()) as {
      owner: { passwordUnset: boolean; telegram: boolean };
      staff: { rows: { userId: string; states: string[] }[] };
    };
    expect(body.owner).toMatchObject({ passwordUnset: true, telegram: true });
    expect(body.staff.rows.find((r) => r.userId === org.ownerUserId)?.states).toContain(
      'no_password',
    );
  });

  it('страница «Задать пароль»: открыть — не тратит; пароль — один раз, сеансы завершены, вход с новым паролем', async () => {
    const { org, chat: c } = await approved('ltg-api-b', '04811201810459');
    await sendOwnerSetup(deps, { userId: org.ownerUserId, adminId });
    const key = setupKeyOf(c);
    const view = await peek(key);
    expect(view.status).toBe(200);
    expect(view.headers.get('cache-control')).toBe('no-store');
    expect(view.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await view.json()).toEqual({
      login: 'ltg-api-b-owner',
      organization: 'ОсОО «ltg-api-b»',
    });
    expect((await peek(key)).status).toBe(200);

    expect((await setPassword(key, 'Корот7')).status).toBe(400);
    expect((await setPassword(key, 'Новый-пароль-1', null)).status).toBe(403);
    const done = await setPassword(key, 'Новый-пароль-1');
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ ok: true, login: 'ltg-api-b-owner' });
    expect(last(c)?.text).toContain('ltg-api-b-owner');

    expect((await setPassword(key, 'Другой-пароль-2')).status).toBe(404);
    expect(await (await peek(key)).json()).toMatchObject({ error: { code: 'setup_link_invalid' } });
    await signIn(app, 'ltg-api-b-owner', 'Новый-пароль-1');
    const [history] = await f.t.admin.db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.entityId, org.ownerUserId), eq(schema.auditLog.action, 'update')),
      )
      .orderBy(desc(schema.auditLog.at));
    expect(history?.reason).toBe('Пароль задан по ссылке из Telegram');
    // И в истории организации, которую видит Админка (прототип: log('porg', …)).
    const card = await apiRequest(
      app,
      'GET',
      `/api/admin/organizations/${org.orgId}/card?refresh=1`,
      admin,
    );
    const { history: orgHistory } = (await card.json()) as { history: { reason: string | null }[] };
    expect(orgHistory.map((h) => h.reason)).toContain(
      'Владелец ltg-api-b-owner задал пароль по ссылке из Telegram',
    );
    expect((await peek('C'.repeat(43))).status).toBe(404);
  });

  it('«Отправить новую ссылку для пароля»: только администратор платформы; прежняя не действует; после пароля и без Telegram — 409', async () => {
    const { org, chat: c } = await approved('ltg-api-c', '05811201810450');
    await sendOwnerSetup(deps, { userId: org.ownerUserId, adminId });
    const first = setupKeyOf(c);
    const owner = await signIn(app, 'owner-a', TEST_PASSWORD);
    const path = `/api/admin/organizations/${org.orgId}/owner-setup`;
    expect((await apiRequest(app, 'POST', path, owner)).status).toBe(403);
    const res = await apiRequest(app, 'POST', path, admin);
    expect(res.status).toBe(200);
    expect(last(c)?.text).toBe(
      fillTemplate(TPL.tgSetPassNew, { логин: 'ltg-api-c-owner', дней: 7 }),
    );
    const second = setupKeyOf(c);
    expect(second).not.toBe(first);
    expect((await peek(first)).status).toBe(404);
    expect((await peek(second)).status).toBe(200);
    // Отправка — в истории организации (вкладка «История» карточки в Админке).
    const card = await apiRequest(
      app,
      'GET',
      `/api/admin/organizations/${org.orgId}/card?refresh=1`,
      admin,
    );
    const { history } = (await card.json()) as { history: { reason: string | null }[] };
    expect(history.map((h) => h.reason)).toContain(
      'Владельцу ltg-api-c-owner отправлена новая ссылка, чтобы задать пароль; прежняя больше не действует',
    );

    expect((await setPassword(second, 'Новый-пароль-1')).status).toBe(200);
    const after = await apiRequest(app, 'POST', path, admin);
    expect(after.status).toBe(409);
    expect(await after.json()).toMatchObject({ error: { code: 'owner_setup_unavailable' } });

    const plain = await approved('ltg-api-d', '06811201810451', false);
    expect(plain.linked).toBe(false);
    expect(await sendOwnerSetup(deps, { userId: plain.org.ownerUserId, adminId })).toBe(
      'no_telegram',
    );
    const none = await apiRequest(
      app,
      'POST',
      `/api/admin/organizations/${plain.org.orgId}/owner-setup`,
      admin,
    );
    expect(none.status).toBe(409);
    expect(await none.json()).toMatchObject({ error: { code: 'owner_no_telegram' } });
    // Организация без заявки — ссылка не положена.
    const other = await apiRequest(
      app,
      'POST',
      `/api/admin/organizations/${f.a.orgId}/owner-setup`,
      admin,
    );
    expect(other.status).toBe(409);
  });
});
