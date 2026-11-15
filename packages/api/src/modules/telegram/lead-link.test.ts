import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import {
  createFakeTelegram,
  createLogger,
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
  leadDocDraft,
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

  it('повтор заявки: пока ссылка действует — только браузеру с её ключом; истекла без «Старта» — новая; после «Старта» — «подключён» только с ключом', async () => {
    const l = await submitted();
    const repeat = async (prior: string | null) => {
      clock.advance(60_000);
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
    expect(await repeat('мусор')).toBeNull();
    expect(await repeat(l.key)).toMatchObject({
      url: l.link && 'url' in l.link ? l.link.url : '',
      token: l.key,
    });

    // Ссылка истекла без «Старта» (срок ссылки и окно повтора сейчас — по 24 часа, позже повтор — уже
    // новая заявка): повтор получает новую ссылку и без ключа прежней (как в прототипе: «Отправьте
    // заявку ещё раз — придёт новая ссылка»).
    await f.t.admin.db
      .update(schema.platformLeadTgTokens)
      .set({ expiresAt: clock.now() })
      .where(eq(schema.platformLeadTgTokens.leadId, l.id));
    const fresh = await repeat(null);
    expect(fresh).toEqual({
      url: expect.stringMatching(LINK_RE),
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiresAt: new Date(clock.now().getTime() + 24 * 3_600_000),
    });
    const freshKey = fresh && 'token' in fresh ? fresh.token : '';
    expect(freshKey).not.toBe(l.key);
    // Новая действует — снова только её браузеру; прежний ключ её не получает.
    expect(await repeat(null)).toBeNull();
    expect(await repeat(l.key)).toBeNull();
    expect(await repeat(freshKey)).toMatchObject({ token: freshKey });
    await start(l.key, 9202);
    expect(last(9202)?.text).toBe(TPL.tgLeadLinkBad);

    expect((await start(freshKey, 9201)).status).toBe(200);
    expect(await repeat(freshKey)).toEqual({ linked: true });
    expect(await repeat(l.key)).toEqual({ linked: true });
    expect(await repeat(null)).toBeNull();
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
    // Окно заявки Админки, «Данные из документов»: «подключён · @aigul_s» (прототип v114 `ldTgPill`).
    const card = await apiRequest(app, 'GET', `/api/admin/leads/${l.id}`, admin);
    expect(card.status).toBe(200);
    expect(await card.json()).toMatchObject({ tgLinked: true, tgName: '@aigul_s' });

    const count = sent(9211).length;
    await start(l.key, 9211);
    expect(sent(9211)).toHaveLength(count);
    await start(l.key, 9212);
    expect(last(9212)?.text).toBe(TPL.tgLeadLinkBad);
    await start('A'.repeat(43), 9213);
    expect(last(9213)?.text).toBe(TPL.tgLeadLinkBad);
    // Испорченная ссылка заявителя (ключ не той длины) — ответ заявителю, а не про «Мой профиль».
    await sendToBot(app, telegramUpdate(`/start l_${'A'.repeat(20)}`, 9215));
    expect(last(9215)?.text).toBe(TPL.tgLeadLinkBad);
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
          // Форма с документами (поток И): ИП, ИНН и черновик со свидетельством ГНС — документ «не
          // прочитался», поля заполнены вручную.
          form: 'ip',
          inn: '21811201810002',
          okpo: '',
          address: '',
          head: '',
          draft: (
            await leadDocDraft(app, deps.storage, [{ kind: 'gns_cert', content: '%PDF-scan' }])
          ).draft,
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
      // Ссылку «Подключить Telegram» выдаёт сама подача заявки (стык с потоком И) — в ответе формы.
      const { tg: link } = (await res.json()) as { tg: { url: string } | null };
      expect(link?.url).toMatch(LINK_RE);
      await telegramSendJob(noPause).run(deps, clock.now());
      const [saved] = await f.t.admin.db
        .select()
        .from(schema.platformLeads)
        .where(eq(schema.platformLeads.phone, phone));
      const key = LINK_RE.exec(link?.url ?? '')![1]!;
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
      expect(await sendLeadRefused(deps, { leadId: saved!.id, adminId })).toBe('not_linked');
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
    expect(await sendLeadRefused(deps, { leadId: l.id, adminId })).toBe('not_linked');
    await start(l.key, 9231);
    expect(last(9231)?.text).toBe(
      fillTemplate(TPL.tgLeadNo, { фирма: FIRM, причина: 'Дубль заявки' }),
    );
    expect(await sendLeadRefused(deps, { leadId: l.id, adminId })).toBe('not_linked');
  });

  it('отказ на сайте после «Старта»: причина — заявителю один раз и только от имени администратора платформы', async () => {
    const l = await submitted();
    await start(l.key, 9232);
    await withUserContext(f.t.app.db, adminId, (tx) =>
      setLeadStatus(tx, {
        id: l.id,
        version: null,
        to: 'rejected',
        before: 'new',
        text: 'Не наш регион',
        now: clock.now(),
      }),
    );
    const count = sent(9232).length;
    // Не администратор платформы причину не берёт: она остаётся для настоящего вызова.
    expect(await sendLeadRefused(deps, { leadId: l.id, adminId: f.a.ownerUserId })).toBe(
      'not_linked',
    );
    expect(sent(9232)).toHaveLength(count);
    expect(await sendLeadRefused(deps, { leadId: l.id, adminId })).toBe('sent');
    expect(last(9232)?.text).toBe(
      fillTemplate(TPL.tgLeadNo, { фирма: FIRM, причина: 'Не наш регион' }),
    );
    expect(await sendLeadRefused(deps, { leadId: l.id, adminId })).toBe('not_linked');
    expect(sent(9232)).toHaveLength(count + 1);
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

  it('повтор заявки через форму: ту же ссылку получает только браузер с cookie; без cookie — без кнопки; после «Старта» — «подключён»', async () => {
    n += 1;
    const phone = `+9967004${String(10000 + n)}`;
    let ip = 0;
    const post = async (cookie?: string) => {
      ip += 1;
      const res = await app.request('/api/leads', {
        method: 'POST',
        headers: {
          origin: TEST_ORIGIN,
          'content-type': 'application/json',
          'x-forwarded-for': `198.51.${100 + (n % 100)}.${ip}, 10.0.0.1`,
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify({
          form: 'ip',
          inn: '21811201810002',
          okpo: '',
          address: '',
          head: '',
          draft: (
            await leadDocDraft(app, deps.storage, [{ kind: 'gns_cert', content: '%PDF-scan' }])
          ).draft,
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
      expect(res.status, await res.clone().text()).toBe(200);
      const { tg: link } = (await res.json()) as {
        tg: { url: string } | { linked: true } | null;
      };
      return { link, setCookie: res.headers.get('set-cookie') };
    };

    const first = await post();
    expect(first.link).toMatchObject({ url: expect.stringMatching(LINK_RE) });
    // Ключ ссылки — только в cookie этого браузера: HttpOnly, SameSite=Strict, путь формы, Secure (https).
    const raw = first.setCookie ?? '';
    expect(raw).toMatch(/^bu_lead_tg=[A-Za-z0-9_-]{43};/);
    expect(raw).toMatch(/; HttpOnly/i);
    expect(raw).toMatch(/; SameSite=Strict/i);
    expect(raw).toMatch(/; Path=\/api\/leads/i);
    expect(raw).toMatch(/; Secure/i);
    const cookie = raw.split(';')[0]!;
    const url = (first.link as { url: string }).url;

    expect((await post(cookie)).link).toMatchObject({ url });
    expect((await post()).link).toBeNull();

    const key = LINK_RE.exec(url)![1]!;
    expect((await start(key, 9241)).status).toBe(200);
    expect((await post(cookie)).link).toEqual({ linked: true });
  });

  it('стык с потоком И: заявка с документами → «Старт» → «Одобрить» методом Админки — Telegram заявителя у владельца, «Организация создана» с «Задать пароль»', async () => {
    n += 1;
    const phone = `+9967003${String(10000 + n)}`;
    const firm = `ИП «Стык ${n}»`;
    const res = await app.request('/api/leads', {
      method: 'POST',
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        'x-forwarded-for': `203.0.113.${n}, 10.0.0.1`,
      },
      body: JSON.stringify({
        form: 'ip',
        inn: `2181120181${String(1000 + n).slice(-4)}`,
        okpo: '',
        address: '',
        head: '',
        draft: (await leadDocDraft(app, deps.storage, [{ kind: 'gns_cert', content: '%PDF-scan' }]))
          .draft,
        name: 'Айгуль Садыкова',
        firm,
        phone,
        size: '21–50',
        telegram: '',
        note: '',
        consent: true,
        website: '',
      }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const { tg: link } = (await res.json()) as { tg: { url: string } | null };
    expect(link?.url).toMatch(LINK_RE);
    const key = LINK_RE.exec(link?.url ?? '')![1]!;
    chat += 1;
    const applicant = chat;
    expect((await start(key, applicant)).status).toBe(200);
    const [saved] = await f.t.admin.db
      .select()
      .from(schema.platformLeads)
      .where(eq(schema.platformLeads.phone, phone));

    const cardRes = await apiRequest(app, 'GET', `/api/admin/leads/${saved!.id}`, admin);
    expect(cardRes.status).toBe(200);
    const card = (await cardRes.json()) as {
      version: number;
      tgLinked: boolean;
      approve: { refusal: string | null } | null;
    };
    expect(card).toMatchObject({ tgLinked: true, approve: { refusal: null } });
    const login = `ltg-joint-${n}`;
    const approved = await apiRequest(app, 'POST', `/api/admin/leads/${saved!.id}/approve`, admin, {
      login,
      version: card.version,
    });
    expect(approved.status, await approved.clone().text()).toBe(201);
    const done = (await approved.json()) as { orgId: string; ownerUserId: string; setup: string };
    expect(done.setup).toBe('sent');

    // Telegram заявителя — Telegram владельца; ему «Организация создана» с кнопкой «Задать пароль».
    const [ownerLink] = await f.t.admin.db
      .select()
      .from(schema.telegramLinks)
      .where(eq(schema.telegramLinks.userId, done.ownerUserId));
    expect(ownerLink).toMatchObject({ chatId: applicant, orgId: done.orgId });
    const msg = last(applicant)!;
    expect(msg.text).toBe(
      fillTemplate(TPL.tgLeadDone, { организация: firm, логин: login, дней: 7 }),
    );
    expect((msg.options.keyboard ?? []).flat()).toEqual([
      { text: TPL.tgBtnSetPass, url: expect.stringMatching(SETUP_RE) },
    ]);
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
    const count = sent(c).length;
    const done = await setPassword(key, 'Новый-пароль-1');
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ ok: true, login: 'ltg-api-b-owner' });
    // «Пароль изменён» с «Это не я» — как после любой смены пароля самим пользователем.
    expect(sent(c)).toHaveLength(count + 1);
    expect(last(c)?.text).toMatch(/^🔑 Пароль учётной записи ltg-api-b-owner изменён сегодня в /);
    expect((last(c)?.options.keyboard ?? []).flat().map((b) => b.text)).toEqual([TPL.tgBtnNotMe]);

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

  it('«Отправить новую ссылку для пароля»: нет организации — 404; Telegram не принял — 503 и без записи в истории; организация без заявки — 409 и у свежего владельца', async () => {
    const unknown = `/api/admin/organizations/${randomUUID()}/owner-setup`;
    expect((await apiRequest(app, 'POST', unknown, admin)).status).toBe(404);

    const { org, chat: c } = await approved('ltg-api-e', '07811201810452');
    await sendOwnerSetup(deps, { userId: org.ownerUserId, adminId });
    const first = setupKeyOf(c);
    const path = `/api/admin/organizations/${org.orgId}/owner-setup`;
    const reason =
      'Владельцу ltg-api-e-owner отправлена новая ссылка, чтобы задать пароль; прежняя больше не действует';
    const reasons = async () => {
      const card = await apiRequest(
        app,
        'GET',
        `/api/admin/organizations/${org.orgId}/card?refresh=1`,
        admin,
      );
      const { history } = (await card.json()) as { history: { reason: string | null }[] };
      return history.map((h) => h.reason).filter((r) => r === reason);
    };
    tg.failNext({ ok: false, errorCode: 502, description: 'Bad Gateway', permanent: false });
    const failed = await apiRequest(app, 'POST', path, admin);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({
      error: {
        code: 'owner_setup_send_failed',
        message: 'Telegram не принял сообщение. Попробуйте ещё раз через минуту.',
      },
    });
    expect(await reasons()).toEqual([]);
    // Прежняя ссылка уже не действует (docs/deviations.md п. Т-18); повтор присылает новую.
    expect((await peek(first)).status).toBe(404);
    expect((await apiRequest(app, 'POST', path, admin)).status).toBe(200);
    expect((await peek(setupKeyOf(c))).status).toBe(200);
    expect(await reasons()).toEqual([reason]);

    // Свежий владелец (не входил, временного пароля нет) организации, созданной не по заявке.
    const plain = await createOrganization(f.t.app.db, {
      name: 'ОсОО «ltg-api-nolead»',
      inn: '08811201810453',
      slug: 'ltg-api-nolead',
      owner: { fullName: 'Иванов Иван', login: 'ltg-api-nolead-owner', passwordHash: 'нет пароля' },
    });
    await f.t.admin.db
      .update(schema.users)
      .set({ mustChangePassword: false })
      .where(eq(schema.users.id, plain.ownerUserId));
    const nolead = await apiRequest(
      app,
      'POST',
      `/api/admin/organizations/${plain.orgId}/owner-setup`,
      admin,
    );
    expect(nolead.status).toBe(409);
    expect(await nolead.json()).toMatchObject({ error: { code: 'owner_setup_unavailable' } });
  });

  it('ключ ссылки «Задать пароль» не попадает в журнал сервера — только шаблон пути', async () => {
    const { org, chat: c } = await approved('ltg-api-f', '09811201810454');
    await sendOwnerSetup(deps, { userId: org.ownerUserId, adminId });
    const key = setupKeyOf(c);
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const logged = createApp({
      ...deps,
      logger: createLogger({
        level: 'info',
        environment: 'test',
        version: 'test',
        service: 'web',
        destination,
      }),
    });
    expect((await logged.request(`/api/auth/setup/${key}`)).status).toBe(200);
    const bad = await logged.request(`/api/auth/setup/${key}`, {
      method: 'POST',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'x' }),
    });
    expect(bad.status).toBe(400);
    const out = lines.join('');
    expect(out).toContain('/api/auth/setup/:token');
    expect(out).not.toContain(key);
  });

  it('«Задать пароль» — в общем пределе попыток с одного адреса вместе со входом', async () => {
    const limited = createApp({
      ...deps,
      authIpLimit: { kind: 'auth_ip', max: 2, windowSeconds: 600 },
    });
    const from = (path: string, body?: unknown) =>
      limited.request(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          origin: TEST_ORIGIN,
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.91, 10.0.0.1',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const key = 'D'.repeat(43);
    expect(
      (await from('/api/auth/login', { login: 'нет-такого', password: 'x'.repeat(8) })).status,
    ).toBe(401);
    expect((await from(`/api/auth/setup/${key}`)).status).toBe(404);
    const res = await from(`/api/auth/setup/${key}`);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: { code: 'auth_ip_limited' } });
    expect((await from(`/api/auth/setup/${key}`, { password: 'Новый-пароль-1' })).status).toBe(429);
    expect(
      (await from('/api/auth/login', { login: 'owner-a', password: TEST_PASSWORD })).status,
    ).toBe(429);
  });
});
