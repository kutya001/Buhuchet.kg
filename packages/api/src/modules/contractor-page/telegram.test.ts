import type { FakeTelegram } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { CP_TG_MAX, fillTemplate, TELEGRAM_TEMPLATE_DEFAULTS } from '@buhuchet/domain';
import {
  ApiError,
  Contractor,
  ContractorPage,
  ContractorTelegram,
  PublicPage,
  PublicPageTelegramLink,
} from '@buhuchet/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { clientChatHint } from '../telegram/client';
import {
  apiRequest,
  createStaffFixture,
  linkTelegram,
  sendToBot,
  signIn,
  telegramUpdate,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

/** Чаты сотрудников (привязаны к учётным записям) и чаты клиентов. */
const CHAT_ACC = 7001;
const CHAT_OWNER = 7002;
const CLIENT_1 = 9001;
const CLIENT_2 = 9002;
const CLIENT_3 = 9003;

describe.skipIf(!databaseAvailable())('Telegram контрагента: методы API и бот клиента', () => {
  let f: Fixture;
  let tg: FakeTelegram;
  let owner: string;
  let acc: string;
  let senior: string;
  let ownerB: string;
  /** Контрагент бухгалтера acc-a, контрагент главного бухгалтера и контрагент организации Б. */
  let cpAcc: Contractor;
  let cpOther: Contractor;
  let cpB: Contractor;
  /** Cookie страницы (браузер, где введён код) каждого контрагента. */
  let grantAcc: string;
  let grantOther: string;
  let grantB: string;

  const employee = (login: string) => f.people[login]!.employeeId;
  const call = (method: 'GET' | 'POST' | 'PUT', path: string, cookie?: string, body?: unknown) =>
    apiRequest(f.app, method, path, cookie, body);
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  const features = (orgId: string, value: Record<string, boolean>) =>
    f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: value })
      .where(eq(schema.orgSettings.orgId, orgId));
  const contractor = async (cookie: string, name: string, inn: string, responsible: string) => {
    const res = await call('POST', '/api/contractors', cookie, {
      name,
      inn,
      phone: '+996505890076',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      gked: '46.34.0',
      gkedExtra: [],
      bases: [],
      startDate: '2024-07-16',
      responsibleEmployeeId: responsible,
      tariff: { amount: 0, period: 'M' },
    });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    return Contractor.parse(await res.json());
  };
  /** Включить страницу и ввести код в «браузере»: cookie страницы. */
  const openPage = async (cookie: string, cp: Contractor, slug: string) => {
    const on = await call('POST', `/api/contractors/${cp.id}/page/enable`, cookie);
    expect(on.status, await on.clone().text()).toBe(200);
    const { code } = ContractorPage.parse(await on.json());
    const res = await f.app.request(`/api/page/${slug}/${cp.inn}/code`, {
      method: 'POST',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    return (res.headers.get('set-cookie') ?? '').split(';')[0]!;
  };
  const history = async (contractorId: string) =>
    (
      await f.t.admin.db
        .select({ action: schema.auditLog.action, userId: schema.auditLog.actorUserId })
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.contractorId, contractorId),
            eq(schema.auditLog.entity, 'contractor_page'),
          ),
        )
        .orderBy(asc(schema.auditLog.at), asc(schema.auditLog.id))
    ).filter((h) => h.action.startsWith('page_tg_'));
  /** Убрать все строки Telegram и ссылки контрагентов — следующий тест начинает с пустого списка. */
  const wipe = async () => {
    await f.t.admin.db.delete(schema.contractorTelegramLinks);
    await f.t.admin.db.delete(schema.contractorTelegramTokens);
    await f.t.admin.db.execute(sql`delete from rate_limits where kind like 'cp_tg_link%'`);
    tg.sent.length = 0;
  };

  /** Страница без входа: «Подключить Telegram» из браузера с cookie страницы. */
  const connect = (slug: string, inn: string, cookie?: string, app = f.app) =>
    app.request(`/api/page/${slug}/${inn}/telegram`, {
      method: 'POST',
      headers: { origin: TEST_ORIGIN, ...(cookie ? { cookie } : {}) },
    });
  /** Токен одноразовой ссылки («cp_…» из адреса бота). */
  const linkToken = async (slug: string, cp: Contractor, cookie: string) => {
    const res = await connect(slug, cp.inn, cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    const { url } = PublicPageTelegramLink.parse(await res.json());
    return new URL(url).searchParams.get('start')!;
  };
  const toBot = async (text: string, chatId: number, username?: string) => {
    const res = await sendToBot(f.app, telegramUpdate(text, chatId, { username }));
    expect(res.status).toBe(200);
  };
  /** Клиент открыл ссылку со страницы и нажал «Старт». */
  const start = async (
    slug: string,
    cp: Contractor,
    cookie: string,
    chatId: number,
    name: string,
  ) => toBot(`/start ${await linkToken(slug, cp, cookie)}`, chatId, name);
  const sentTo = (chatId: number) => tg.sent.filter((m) => m.chatId === chatId).map((m) => m.text);
  const text = (
    key: keyof typeof TELEGRAM_TEMPLATE_DEFAULTS,
    values: Record<string, string | number> = {},
  ) => fillTemplate(TELEGRAM_TEMPLATE_DEFAULTS[key], values);
  const pageBody = async (slug: string, inn: string, cookie: string, app = f.app) => {
    const res = await app.request(`/api/page/${slug}/${inn}`, { headers: { cookie } });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = PublicPage.parse(await res.json());
    if (body.state !== 'open') throw new Error(`страница: ${body.state}`);
    return body.page;
  };

  const list = (cookie: string | undefined, id: string) =>
    call('GET', `/api/contractors/${id}/page/telegram`, cookie);
  const listed = async (cookie: string, id: string) => {
    const res = await list(cookie, id);
    expect(res.status, await res.clone().text()).toBe(200);
    return ContractorTelegram.parse(await res.json());
  };
  const decide = (
    cookie: string | undefined,
    id: string,
    linkId: string,
    action: string,
    version: number,
  ) => call('POST', `/api/contractors/${id}/page/telegram/${linkId}`, cookie, { action, version });
  const decided = async (cookie: string, id: string, linkId: string, action: string, v: number) => {
    const res = await decide(cookie, id, linkId, action, v);
    expect(res.status, await res.clone().text()).toBe(200);
    return ContractorTelegram.parse(await res.json());
  };

  beforeAll(async () => {
    f = await createStaffFixture();
    tg = f.deps.telegram as FakeTelegram;
    await seedAllPlatformDictionaries(f.t.admin.db);
    await features(f.a.orgId, { cppage: true, telegram: true, fee: true });
    await features(f.b.orgId, { cppage: true, telegram: true, fee: true });
    // «Старший» видит всех контрагентов, но права «Управлять страницей» у него нет.
    await f.t.admin.db
      .update(schema.roleScopes)
      .set({ scope: 'all' })
      .where(eq(schema.roleScopes.roleId, f.roleIds.senior));
    [owner, acc, senior, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'senior-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
    ]);
    cpAcc = await contractor(owner, 'ОсОО «Ала-Тоо Трейд»', '03744097401851', employee('acc-a'));
    cpOther = await contractor(owner, 'ИП Садыков', '03744097401852', employee('chief-a'));
    cpB = await contractor(ownerB, 'ОсОО «Чужой»', '03744097401853', employee('acc-b'));
    grantAcc = await openPage(owner, cpAcc, 'org-a');
    grantOther = await openPage(owner, cpOther, 'org-a');
    grantB = await openPage(ownerB, cpB, 'org-b');
    await linkTelegram(f.app, acc, CHAT_ACC, 'acc_a');
    await linkTelegram(f.app, owner, CHAT_OWNER, 'owner_a');
    tg.sent.length = 0;
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('страница: раздел «Telegram» с числами, без имён; без функции или бота раздела нет', async () => {
    const page = await pageBody('org-a', cpAcc.inn, grantAcc);
    expect(page.sections).toContain('tg');
    expect(page.telegram).toEqual({ on: 0, wait: 0, full: false });

    // «Напоминания в Telegram» выключены — раздела нет и ссылку не получить.
    await features(f.a.orgId, { cppage: true, fee: true });
    const off = await pageBody('org-a', cpAcc.inn, grantAcc);
    expect(off.sections).not.toContain('tg');
    expect(off.telegram).toBeNull();
    expect((await connect('org-a', cpAcc.inn, grantAcc)).status).toBe(404);
    await features(f.a.orgId, { cppage: true, telegram: true, fee: true });

    // Бот не подключён: то же самое, в карточке — «раздел выключен».
    const noBot = createApp({ ...f.deps, telegram: null });
    const bare = await pageBody('org-a', cpAcc.inn, grantAcc, noBot);
    expect(bare.sections).not.toContain('tg');
    expect(bare.telegram).toBeNull();
    expect((await connect('org-a', cpAcc.inn, grantAcc, noBot)).status).toBe(404);
    const card = await apiRequest(
      noBot,
      'GET',
      `/api/contractors/${cpAcc.id}/page/telegram`,
      owner,
    );
    expect(ContractorTelegram.parse(await card.json()).sectionOn).toBe(false);
    expect((await listed(owner, cpAcc.id)).sectionOn).toBe(true);
  });

  it('«Подключить Telegram»: ссылку получает только браузер с кодом этой страницы', async () => {
    const refused = [
      await connect('org-a', cpAcc.inn),
      await connect('org-a', cpAcc.inn, 'bh_page=not-a-token'),
      await connect('org-a', cpAcc.inn, `bh_page=${'A'.repeat(43)}`),
      // Код введён на странице другого контрагента и другой организации.
      await connect('org-a', cpAcc.inn, grantOther),
      await connect('org-a', cpAcc.inn, grantB),
      await connect('org-b', cpB.inn, grantAcc),
      // Нет такой страницы — ответ тот же.
      await connect('org-a', '03744097409999', grantAcc),
      await connect('no-such-org', cpAcc.inn, grantAcc),
    ];
    for (const res of refused) {
      expect(res.status).toBe(404);
      expect(await failure(res)).toMatchObject({
        code: 'page_unavailable',
        message: 'Страница недоступна',
      });
    }
    // Без запомненного кода запрос ничего не пишет в базу.
    expect(await f.t.admin.db.select().from(schema.contractorTelegramTokens)).toEqual([]);

    const ok = await connect('org-a', cpAcc.inn, grantAcc);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    const { url } = PublicPageTelegramLink.parse(await ok.json());
    expect(url).toMatch(/^https:\/\/t\.me\/buhuchet_test_bot\?start=cp_[A-Za-z0-9_-]{43}$/);
    // В базе — только хеш токена.
    const token = new URL(url).searchParams.get('start')!.slice(3);
    const rows = await f.t.admin.db.select().from(schema.contractorTelegramTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toContain(token);
    expect(rows[0]!.contractorId).toBe(cpAcc.id);

    // Изменяющий запрос без Origin нашего сайта не проходит.
    const foreign = await f.app.request(`/api/page/org-a/${cpAcc.inn}/telegram`, {
      method: 'POST',
      headers: { cookie: grantAcc, origin: 'https://evil.example' },
    });
    expect(foreign.status).toBe(403);
    await wipe();
  });

  it('скрытый раздел, выключенная страница — ссылки нет; ссылок из одного браузера — не больше 20 за час', async () => {
    const before = ContractorPage.parse(
      await (await call('GET', `/api/contractors/${cpOther.id}/page`, owner)).json(),
    );
    const hidden = await call('PUT', `/api/contractors/${cpOther.id}/page/sections`, owner, {
      hiddenSections: ['tg'],
      version: before.version,
    });
    expect(hidden.status, await hidden.clone().text()).toBe(200);
    expect((await connect('org-a', cpOther.inn, grantOther)).status).toBe(404);
    expect((await pageBody('org-a', cpOther.inn, grantOther)).telegram).toBeNull();
    expect((await listed(owner, cpOther.id)).sectionOn).toBe(false);
    const shown = await call('PUT', `/api/contractors/${cpOther.id}/page/sections`, owner, {
      hiddenSections: [],
      version: ContractorPage.parse(await hidden.json()).version,
    });
    expect(shown.status).toBe(200);

    // Запрос при скрытом разделе тоже считался: счёт начинаем заново.
    await f.t.admin.db.execute(sql`delete from rate_limits where kind like 'cp_tg_link%'`);
    for (let i = 0; i < 20; i++) {
      expect((await connect('org-a', cpOther.inn, grantOther)).status).toBe(200);
    }
    const limited = await connect('org-a', cpOther.inn, grantOther);
    expect(limited.status).toBe(429);
    expect((await failure(limited)).code).toBe('cp_tg_link_limit');
    // Неиспользованных ссылок у контрагента остаётся не больше пяти.
    expect(await f.t.admin.db.select().from(schema.contractorTelegramTokens)).toHaveLength(5);
    // Предел — на браузер: страница другого контрагента ссылки получает.
    expect((await connect('org-a', cpAcc.inn, grantAcc)).status).toBe(200);
    await wipe();

    // И на контрагента из всех браузеров — не больше 30 за час: счёт браузера обнуляем, как у нового.
    for (let i = 0; i < 30; i++) {
      if (i % 10 === 0) {
        await f.t.admin.db.execute(sql`delete from rate_limits where kind = 'cp_tg_link'`);
      }
      expect((await connect('org-a', cpOther.inn, grantOther)).status).toBe(200);
    }
    await f.t.admin.db.execute(sql`delete from rate_limits where kind = 'cp_tg_link'`);
    const cpLimited = await connect('org-a', cpOther.inn, grantOther);
    expect(cpLimited.status).toBe(429);
    expect((await failure(cpLimited)).code).toBe('cp_tg_link_limit');
    expect((await connect('org-a', cpAcc.inn, grantAcc)).status).toBe(200);
    await wipe();
  });

  it('«Старт» по ссылке: запрос ждёт подтверждения, клиенту и ответственному — сообщения', async () => {
    const token = await linkToken('org-a', cpAcc, grantAcc);
    await toBot(`/start ${token}`, CLIENT_1, 'client_one');
    expect(sentTo(CLIENT_1)).toEqual([text('tgCpAsk', { контрагент: cpAcc.name })]);
    // Ответственному бухгалтеру — запрос со ссылкой на «Контрагентов»; владельцу — ничего.
    expect(tg.sent.filter((m) => m.chatId === CHAT_ACC)).toEqual([
      {
        chatId: CHAT_ACC,
        text: `${text('tgCpReq', {
          контрагент: cpAcc.name,
          телеграм: '@client_one',
        })}\n\nОткрыть в Buhuchet.kg: http://localhost:3000/app/cps/all`,
        options: { disableLinkPreview: true },
      },
    ]);
    expect(sentTo(CHAT_OWNER)).toEqual([]);
    expect(await history(cpAcc.id)).toEqual([{ action: 'page_tg_request', userId: null }]);
    expect(await pageBody('org-a', cpAcc.inn, grantAcc)).toMatchObject({
      telegram: { on: 0, wait: 1, full: false },
    });

    // Telegram повторил то же сообщение — второго ответа и второго запроса нет.
    await toBot(`/start ${token}`, CLIENT_1, 'client_one');
    expect(sentTo(CLIENT_1)).toHaveLength(1);
    // Та же ссылка из другого чата, неизвестная и испорченная ссылка — «ссылка не действует».
    await toBot(`/start ${token}`, CLIENT_2, 'client_two');
    await toBot(`/start cp_${'B'.repeat(43)}`, CLIENT_2, 'client_two');
    expect(sentTo(CLIENT_2)).toEqual([text('tgCpLinkBad'), text('tgCpLinkBad')]);
    // Ключ не той длины (ссылку обрезали) — тот же ответ клиенту, а не подсказка сотруднику.
    await toBot(`/start cp_${'B'.repeat(20)}`, CLIENT_2, 'client_two');
    expect(sentTo(CLIENT_2).slice(2)).toEqual([text('tgCpLinkBad')]);
    // Новая ссылка тому же чату — запрос уже ждёт: новой строки и сообщения сотруднику нет.
    await start('org-a', cpAcc, grantAcc, CLIENT_1, 'client_one');
    expect(sentTo(CLIENT_1)).toHaveLength(2);
    expect(sentTo(CHAT_ACC)).toHaveLength(1);
    const card = await listed(owner, cpAcc.id);
    expect(card).toMatchObject({ on: 0, wait: 1, max: CP_TG_MAX, manage: null, sectionOn: true });
    expect(card.items).toHaveLength(1);
    expect(card.items[0]).toMatchObject({
      name: '@client_one',
      status: 'wait',
      decidedAt: null,
      decidedBy: null,
      byClient: false,
    });
    // Номер чата клиента в ответе карточки не отдаётся.
    const raw = JSON.stringify(await (await list(owner, cpAcc.id)).json());
    expect(raw).not.toContain(String(CLIENT_1));
    expect(raw).not.toContain('chatId');
  });

  it('список в карточке: вход, область и чужая организация', async () => {
    expect((await list(undefined, cpAcc.id)).status).toBe(401);
    expect((await list(ownerB, cpAcc.id)).status).toBe(404);
    // Бухгалтер видит только своих контрагентов; без права «Управлять страницей» — только смотреть.
    expect((await list(acc, cpOther.id)).status).toBe(404);
    expect((await listed(acc, cpAcc.id)).manage).toBe('page_manage_right');
    expect((await listed(senior, cpAcc.id)).manage).toBe('page_manage_right');
    expect((await list(owner, 'не-номер')).status).toBe(400);
    // Функция «Страница контрагента по ссылке» выключена — 403.
    await features(f.a.orgId, { telegram: true, fee: true });
    const off = await list(owner, cpAcc.id);
    expect(off.status).toBe(403);
    expect((await failure(off)).code).toBe('cppage_off');
    await features(f.a.orgId, { cppage: true, telegram: true, fee: true });
  });

  it('решение: право «Управлять страницей», область, версия; клиенту — сообщение бота', async () => {
    const [row] = (await listed(owner, cpAcc.id)).items;
    const id = row!.id;
    expect((await decide(undefined, cpAcc.id, id, 'approve', row!.version)).status).toBe(401);
    for (const cookie of [acc, senior]) {
      const res = await decide(cookie, cpAcc.id, id, 'approve', row!.version);
      expect(res.status).toBe(403);
      expect((await failure(res)).code).toBe('page_manage_right');
    }
    // Чужая организация и строка другого контрагента — «не найдено».
    expect((await decide(ownerB, cpAcc.id, id, 'approve', row!.version)).status).toBe(404);
    expect((await decide(ownerB, cpB.id, id, 'approve', row!.version)).status).toBe(404);
    expect((await decide(owner, cpOther.id, id, 'approve', row!.version)).status).toBe(404);
    expect((await decide(owner, cpAcc.id, id, 'удалить', row!.version)).status).toBe(400);
    // Устаревшая версия — «запись изменена другим пользователем».
    const stale = await decide(owner, cpAcc.id, id, 'approve', row!.version + 5);
    expect(stale.status).toBe(409);
    expect((await failure(stale)).code).toBe('record_changed');
    // Отключить можно только подключённый.
    const early = await decide(owner, cpAcc.id, id, 'unlink', row!.version);
    expect(early.status).toBe(409);
    expect((await failure(early)).code).toBe('cp_tg_not_on');
    expect((await listed(owner, cpAcc.id)).items[0]!.status).toBe('wait');
    tg.sent.length = 0;

    const on = await decided(owner, cpAcc.id, id, 'approve', row!.version);
    expect(on).toMatchObject({ on: 1, wait: 0 });
    expect(on.items[0]).toMatchObject({
      status: 'on',
      decidedBy: 'owner-a В.',
      byClient: false,
      version: row!.version + 1,
    });
    expect(on.items[0]!.decidedAt).not.toBeNull();
    expect(sentTo(CLIENT_1)).toEqual([text('tgCpOn', { контрагент: cpAcc.name })]);
    expect(await pageBody('org-a', cpAcc.inn, grantAcc)).toMatchObject({
      telegram: { on: 1, wait: 0, full: false },
    });
    // Повторное решение — «запрос уже рассмотрен».
    for (const action of ['approve', 'reject']) {
      const again = await decide(owner, cpAcc.id, id, action, row!.version + 1);
      expect(again.status).toBe(409);
      expect((await failure(again)).code).toBe('cp_tg_done');
    }
    // Чат уже подключён — по новой ссылке бот отвечает «уже подключён».
    await start('org-a', cpAcc, grantAcc, CLIENT_1, 'client_one');
    expect(sentTo(CLIENT_1).at(-1)).toBe(text('tgCpAlready', { контрагент: cpAcc.name }));

    const off = await decided(owner, cpAcc.id, id, 'unlink', row!.version + 1);
    expect(off).toMatchObject({ on: 0, wait: 0 });
    expect(off.items[0]!.status).toBe('off');
    expect(sentTo(CLIENT_1).at(-1)).toBe(text('tgCpOff', { контрагент: cpAcc.name }));

    // «Отклонить»: запрос другого чата.
    await start('org-a', cpAcc, grantAcc, CLIENT_2, 'client_two');
    const wait = (await listed(owner, cpAcc.id)).items.find((i) => i.status === 'wait')!;
    expect(wait.name).toBe('@client_two');
    const no = await decided(owner, cpAcc.id, wait.id, 'reject', wait.version);
    expect(no.items.find((i) => i.id === wait.id)!.status).toBe('no');
    expect(sentTo(CLIENT_2).at(-1)).toBe(text('tgCpNo', { контрагент: cpAcc.name }));
    const ownerId = (
      await f.t.admin.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.login, 'owner-a'))
    )[0]!.id;
    expect(await history(cpAcc.id)).toEqual([
      { action: 'page_tg_request', userId: null },
      { action: 'page_tg_on', userId: ownerId },
      { action: 'page_tg_off', userId: ownerId },
      { action: 'page_tg_request', userId: null },
      { action: 'page_tg_no', userId: ownerId },
    ]);
    await wipe();
  });

  it('«Подтвердить» — только пока раздел «Telegram» действует; отклонить можно всегда', async () => {
    await start('org-a', cpOther, grantOther, CLIENT_1, 'client_one');
    await start('org-a', cpOther, grantOther, CLIENT_2, 'client_two');
    const [first, second] = (await listed(owner, cpOther.id)).items;
    const refused = async (linkId: string, version: number) => {
      const res = await decide(owner, cpOther.id, linkId, 'approve', version);
      expect(res.status).toBe(409);
      expect((await failure(res)).code).toBe('cp_tg_section_off');
    };
    const page = (set: Partial<typeof schema.contractorPages.$inferInsert>) =>
      f.t.admin.db
        .update(schema.contractorPages)
        .set(set)
        .where(eq(schema.contractorPages.contractorId, cpOther.id));
    const status = (serviceStatus: 'active' | 'archived') =>
      f.t.admin.db
        .update(schema.contractors)
        .set({ serviceStatus })
        .where(eq(schema.contractors.id, cpOther.id));
    try {
      // Раздел скрыт у контрагента.
      await page({ hiddenSections: ['tg'] });
      await refused(first!.id, first!.version);
      await page({ hiddenSections: [] });
      // Страница выключена.
      await page({ enabled: false });
      await refused(first!.id, first!.version);
      await page({ enabled: true });
      // Контрагент в архиве: подтвердить нельзя, отклонить можно.
      await status('archived');
      await refused(first!.id, first!.version);
      expect((await listed(owner, cpOther.id)).items.every((i) => i.status === 'wait')).toBe(true);
      const no = await decided(owner, cpOther.id, second!.id, 'reject', second!.version);
      expect(no.items.find((i) => i.id === second!.id)!.status).toBe('no');
    } finally {
      await page({ hiddenSections: [], enabled: true });
      await status('active');
    }
    const on = await decided(owner, cpOther.id, first!.id, 'approve', first!.version);
    expect(on.on).toBe(1);
    await wipe();
  });

  it('сообщение Telegram не дошло — решение остаётся', async () => {
    await start('org-a', cpAcc, grantAcc, CLIENT_1, 'client_one');
    const [row] = (await listed(owner, cpAcc.id)).items;
    tg.sent.length = 0;
    // Клиент заблокировал бота: сообщение не ушло.
    tg.failNext({ ok: false, errorCode: 403, description: 'blocked', permanent: true });
    const res = await decide(owner, cpAcc.id, row!.id, 'approve', row!.version);
    expect(res.status).toBe(200);
    expect(tg.sent).toEqual([]);
    expect((await listed(owner, cpAcc.id)).on).toBe(1);

    // Бот не настроен: подтвердить нельзя (раздела на странице нет), отключить можно — без сообщения.
    await start('org-a', cpAcc, grantAcc, CLIENT_2, 'client_two');
    const wait = (await listed(owner, cpAcc.id)).items.find((i) => i.status === 'wait')!;
    tg.sent.length = 0;
    const noBot = createApp({ ...f.deps, telegram: null });
    const post = (linkId: string, action: string, version: number) =>
      apiRequest(noBot, 'POST', `/api/contractors/${cpAcc.id}/page/telegram/${linkId}`, owner, {
        action,
        version,
      });
    const refused = await post(wait.id, 'approve', wait.version);
    expect(refused.status).toBe(409);
    expect((await failure(refused)).code).toBe('cp_tg_section_off');
    expect((await post(row!.id, 'unlink', row!.version + 1)).status).toBe(200);
    expect(tg.sent).toEqual([]);
    expect(await listed(owner, cpAcc.id)).toMatchObject({ on: 0, wait: 1 });
    await wipe();
  });

  it('мест нет: подключено и ждёт вместе 5 — ссылку не получить', async () => {
    for (let i = 0; i < CP_TG_MAX; i++) {
      await start('org-a', cpAcc, grantAcc, 9100 + i, `client_${i}`);
    }
    const card = await listed(owner, cpAcc.id);
    expect(card.wait).toBe(CP_TG_MAX);
    expect(await pageBody('org-a', cpAcc.inn, grantAcc)).toMatchObject({
      telegram: { on: 0, wait: CP_TG_MAX, full: true },
    });
    const full = await connect('org-a', cpAcc.inn, grantAcc);
    expect(full.status).toBe(409);
    expect((await failure(full)).code).toBe('cp_tg_full');
    // У другого контрагента той же организации места свои.
    expect((await connect('org-a', cpOther.inn, grantOther)).status).toBe(200);
    // Отклонили один запрос — место освободилось.
    const last = card.items.at(-1)!;
    await decided(owner, cpAcc.id, last.id, 'reject', last.version);
    expect((await connect('org-a', cpAcc.inn, grantAcc)).status).toBe(200);
    await wipe();
  });

  it('без ответственного с Telegram запрос уходит владельцу; чужой организации — никогда', async () => {
    // Ответственный за cpOther (главный бухгалтер) Telegram не привязал.
    await start('org-a', cpOther, grantOther, CLIENT_3, 'client_three');
    expect(sentTo(CHAT_OWNER)).toEqual([
      `${text('tgCpReq', {
        контрагент: cpOther.name,
        телеграм: '@client_three',
      })}\n\nОткрыть в Buhuchet.kg: http://localhost:3000/app/cps/all`,
    ]);
    expect(sentTo(CHAT_ACC)).toEqual([]);
    tg.sent.length = 0;
    // Запрос клиента организации Б сотрудникам организации А не приходит и в их списках не виден.
    await start('org-b', cpB, grantB, CLIENT_3, 'client_three');
    expect(sentTo(CLIENT_3)).toEqual([text('tgCpAsk', { контрагент: cpB.name })]);
    expect(sentTo(CHAT_OWNER)).toEqual([]);
    expect(sentTo(CHAT_ACC)).toEqual([]);
    expect((await listed(ownerB, cpB.id)).wait).toBe(1);
    expect((await listed(owner, cpAcc.id)).items).toEqual([]);
    await wipe();
  });

  it('«Отключить» в чате клиента: только свой чат; несколько контрагентов — по номеру', async () => {
    const approve = async (cookie: string, cp: Contractor) => {
      const wait = (await listed(cookie, cp.id)).items.find((i) => i.status === 'wait')!;
      await decided(cookie, cp.id, wait.id, 'approve', wait.version);
    };
    // Подсказка чата клиента (для меню команд бота сотрудников): только у подключённого чата.
    expect(await clientChatHint(f.deps, CLIENT_2)).toBeNull();
    // Чат без подключений: команда клиента не срабатывает, бот отвечает обычной подсказкой.
    await toBot('Отключить', CLIENT_2, 'client_two');
    expect(sentTo(CLIENT_2).some((t) => t.includes('отключён'))).toBe(false);
    tg.sent.length = 0;

    await start('org-a', cpAcc, grantAcc, CLIENT_1, 'client_one');
    await approve(owner, cpAcc);
    expect(await clientChatHint(f.deps, CLIENT_1)).toContain(cpAcc.name);
    tg.sent.length = 0;
    await toBot('отключить', CLIENT_1, 'client_one');
    expect(sentTo(CLIENT_1)).toEqual([text('tgCpOff', { контрагент: cpAcc.name })]);
    const left = (await listed(owner, cpAcc.id)).items[0]!;
    expect(left).toMatchObject({ status: 'off', byClient: true, decidedBy: null });
    expect((await history(cpAcc.id)).at(-1)).toEqual({ action: 'page_tg_leave', userId: null });

    // Один чат подключён к двум контрагентам организации А и к контрагенту организации Б.
    await start('org-a', cpAcc, grantAcc, CLIENT_1, 'client_one');
    await approve(owner, cpAcc);
    await start('org-a', cpOther, grantOther, CLIENT_1, 'client_one');
    await approve(owner, cpOther);
    await start('org-b', cpB, grantB, CLIENT_1, 'client_one');
    await approve(ownerB, cpB);
    tg.sent.length = 0;
    await toBot('Отключить', CLIENT_1, 'client_one');
    // По порядку названий: «ИП Садыков», «ОсОО «Ала-Тоо Трейд»», «ОсОО «Чужой»».
    expect(sentTo(CLIENT_1)).toEqual([
      text('tgCpOffWhich', {
        список: `1. ${cpOther.name}; 2. ${cpAcc.name}; 3. ${cpB.name}`,
      }),
    ]);
    await toBot('Отключить 9', CLIENT_1, 'client_one');
    expect(sentTo(CLIENT_1)).toHaveLength(2);
    expect((await listed(owner, cpOther.id)).on).toBe(1);
    await toBot('Отключить 3', CLIENT_1, 'client_one');
    expect(sentTo(CLIENT_1).at(-1)).toBe(text('tgCpOff', { контрагент: cpB.name }));
    expect((await listed(ownerB, cpB.id)).on).toBe(0);
    expect((await listed(owner, cpAcc.id)).on).toBe(1);
    expect((await listed(owner, cpOther.id)).on).toBe(1);
    await toBot('Отключить 1', CLIENT_1, 'client_one');
    expect(sentTo(CLIENT_1).at(-1)).toBe(text('tgCpOff', { контрагент: cpOther.name }));
    // Остался один контрагент — номер не нужен и не мешает.
    await toBot('Отключить 5', CLIENT_1, 'client_one');
    expect(sentTo(CLIENT_1).at(-1)).toBe(text('tgCpOff', { контрагент: cpAcc.name }));
    expect((await listed(owner, cpAcc.id)).on).toBe(0);
    expect(await clientChatHint(f.deps, CLIENT_1)).toBeNull();
    await wipe();
  });
});
