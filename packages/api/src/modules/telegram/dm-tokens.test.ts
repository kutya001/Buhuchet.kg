import { createHash, randomBytes } from 'node:crypto';
import { fixedClock } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import { bishkekDate, formatDateRu, TELEGRAM_TEMPLATE_DEFAULTS, UI_TEXTS } from '@buhuchet/domain';
import { BellPage, DmTokenIssued } from '@buhuchet/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import {
  apiRequest,
  createStaffFixture,
  createTestDeps,
  linkTelegram,
  signIn,
  TEST_PASSWORD,
} from '../../testing';
import { DM_TOKEN_NOTICE_KEYS, dmTokenExpiryJob, dmTokenSiteUrl } from './dm-tokens';

/*
 * Сообщения владельцам организации об API-токенах «Витрины данных» (доработки 20.11.2026: Витрина
 * данных, блок 5, пункт 10; поток Т, общий план 20.11, этап 3, П5; прототип v158 `dmTell`, `dmDaily`):
 * «создан» (выпуск и перевыпуск), «отозван» (сотрудником и администратором платформы), «до конца срока
 * 7 дней» — задача `dm.token-expiry`. Telegram с кнопкой «Открыть» и строка колокольчика — только
 * владельцам организации токена.
 */

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
const { bellNotifications, dmTemplates, dmTokens, orgSettings, telegramOutbox } = schema;

const BASE = 'https://test.buhuchet.kg';
const DAY_MS = 86_400_000;
const CHAT = { ownerA: 7201, seniorA: 7202, ownerB: 7203 } as const;
const fill = (key: keyof typeof TELEGRAM_TEMPLATE_DEFAULTS, values: Record<string, string>) =>
  Object.entries(values).reduce<string>(
    (s, [k, v]) => s.replaceAll(`{${k}}`, v),
    TELEGRAM_TEMPLATE_DEFAULTS[key],
  );

describe.skipIf(!databaseAvailable())('Витрина данных: сообщения владельцам о токенах', () => {
  let f: Fixture;
  let app: ReturnType<typeof createApp>;
  const cookies: Record<string, string> = {};
  let tplId = '';
  let admTplId = '';

  const call = (login: string, method: 'GET' | 'POST', path: string, body?: unknown) =>
    apiRequest(app, method, path, cookies[login], body);
  const issue = async (login: string, name: string, term = 30, base = '/api/dm') => {
    const res = await call(login, 'POST', `${base}/tokens`, {
      templateId: base === '/api/dm' ? tplId : admTplId,
      name,
      term,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return DmTokenIssued.parse(await res.json()).item;
  };
  const outbox = (tokenId: string) =>
    f.t.admin.db
      .select()
      .from(telegramOutbox)
      .where(
        and(
          eq(telegramOutbox.kind, 'dm_token'),
          sql`${telegramOutbox.dedupeKey} like ${`%${tokenId}%`}`,
        ),
      )
      .orderBy(telegramOutbox.createdAt, telegramOutbox.id);
  const bell = (tokenId: string) =>
    f.t.admin.db
      .select()
      .from(bellNotifications)
      .where(
        and(eq(bellNotifications.targetKind, 'dm_token'), eq(bellNotifications.targetId, tokenId)),
      )
      .orderBy(bellNotifications.createdAt, bellNotifications.id);
  const userOf = (login: string) =>
    login === 'owner-a'
      ? f.a.ownerUserId
      : login === 'owner-b'
        ? f.b.ownerUserId
        : f.people[login]!.userId;
  const shortOf = async (login: string) => {
    const [e] = await f.t.admin.db
      .select({ short: schema.employees.shortName })
      .from(schema.employees)
      .where(eq(schema.employees.userId, userOf(login)));
    return e!.short;
  };

  beforeAll(async () => {
    f = await createStaffFixture();
    // Ссылка «Открыть» — на сайт по https, как на стенде.
    app = createApp(
      createTestDeps({
        db: f.t.app.db,
        config: { ...createTestDeps().config, APP_BASE_URL: BASE },
      }),
    );
    for (const login of ['owner-a', 'senior-a', 'owner-b', 'platform-admin']) {
      cookies[login] = await signIn(app, login, TEST_PASSWORD);
    }
    await linkTelegram(app, cookies['owner-a']!, CHAT.ownerA, 'owner_a');
    await linkTelegram(app, cookies['senior-a']!, CHAT.seniorA, 'senior_a');
    await linkTelegram(app, cookies['owner-b']!, CHAT.ownerB, 'owner_b');
    const db = f.t.admin.db;
    await db
      .update(orgSettings)
      .set({ extApi: true })
      .where(inArray(orgSettings.orgId, [f.a.orgId, f.b.orgId]));
    // «Старший» в А выпускает и отзывает токены, но не владелец: ему сообщений нет.
    await db.insert(schema.rolePermissions).values(
      ['dmView', 'dmTokens'].map((permissionId) => ({
        orgId: f.a.orgId,
        roleId: f.roleIds.senior,
        permissionId,
      })),
    );
    await db
      .update(schema.roleScopes)
      .set({ scope: 'all' })
      .where(
        and(eq(schema.roleScopes.roleId, f.roleIds.senior), eq(schema.roleScopes.permGroup, 'cps')),
      );
    const [t] = await db
      .insert(dmTemplates)
      .values({
        code: 'msg-cps',
        name: 'Контрагенты для токена',
        module: 'cps',
        state: 'published',
        columns: [{ k: 'n', type: 'int' }],
      })
      .returning({ id: dmTemplates.id });
    tplId = t!.id;
    const [a] = await db
      .insert(dmTemplates)
      .values({ code: 'msg-adm', name: 'Шаблон Админки', state: 'published', audience: 'admin' })
      .returning({ id: dmTemplates.id });
    admTplId = a!.id;
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('«создан» — владельцам организации в Telegram с «Открыть» и в колокольчик; выпустившему не владельцу — нет', async () => {
    const k = await issue('senior-a', 'Power BI директора');
    const rows = await outbox(k.id);
    expect(rows.map((r) => r.userId)).toEqual([userOf('owner-a')]);
    const text = fill('tgDmTokNew', {
      организация: 'Организация А',
      название: 'Power BI директора',
      шаблон: 'Контрагенты для токена',
      // «Действует до» в сообщении — день по Бишкеку, а `till` ответа — момент в UTC.
      дата: formatDateRu(bishkekDate(new Date(k.till))),
      кто: await shortOf('senior-a'),
    });
    expect(rows[0]).toMatchObject({ chatId: CHAT.ownerA, text });
    const payload = rows[0]!.payload as { text: string; buttons?: { url?: string }[][] };
    expect(payload.text).toBe(text);
    expect(payload.buttons?.[0]?.[0]?.url).toBe(`${BASE}/app/dm/tok?tok=${k.id}`);
    expect(rows[0]!.dedupeKey).toBe(`${DM_TOKEN_NOTICE_KEYS.new(k.id)}:${userOf('owner-a')}`);
    const lines = await bell(k.id);
    expect(lines.map((b) => [b.userId, b.kind, b.event])).toEqual([
      [userOf('owner-a'), 'other', 'dm_token'],
    ]);
    expect(lines[0]!.text).toBe(payload.text);
    // Владелец видит строку в колокольчике, она открывает окно токена.
    const res = await call('owner-a', 'GET', '/api/bell?tab=all');
    expect(res.status).toBe(200);
    const item = BellPage.parse(await res.json()).items.find((x) => x.open?.id === k.id);
    expect(item?.open).toEqual({ kind: 'dm_token', id: k.id });
  });

  it('перевыпуск — новый токен: владельцам снова «создан», уже о новом', async () => {
    const k = await issue('owner-a', 'Excel бухгалтерии');
    const re = await call('owner-a', 'POST', `/api/dm/tokens/${k.id}/reissue`);
    expect(re.status, await re.clone().text()).toBe(201);
    const fresh = DmTokenIssued.parse(await re.json()).item;
    expect((await outbox(fresh.id)).map((r) => r.userId)).toEqual([userOf('owner-a')]);
    expect((await bell(fresh.id)).length).toBe(1);
    expect((await outbox(k.id)).length).toBe(1);
  });

  it('«отозван» — кто отозвал; администратор платформы — «Администратор платформы», владельцам этой организации', async () => {
    const k = await issue('owner-a', 'Скрипт Google Таблиц');
    const rv = await call('senior-a', 'POST', `/api/dm/tokens/${k.id}/revoke`);
    expect(rv.status, await rv.clone().text()).toBe(200);
    const rows = (await outbox(k.id)).filter((r) => r.dedupeKey?.startsWith('dm_tok_revoked:'));
    expect(rows.map((r) => r.userId)).toEqual([userOf('owner-a')]);
    expect(rows[0]!.text).toContain(`(отозвал: ${await shortOf('senior-a')})`);

    const kb = await issue('owner-b', 'Токен Б');
    const ka = await issue('owner-a', 'Утечка');
    const adm = await call('platform-admin', 'POST', `/api/admin/dm/tokens/${ka.id}/revoke`);
    expect(adm.status, await adm.clone().text()).toBe(200);
    const byAdmin = (await outbox(ka.id)).filter((r) => r.dedupeKey?.startsWith('dm_tok_revoked:'));
    expect(byAdmin.map((r) => r.userId)).toEqual([userOf('owner-a')]);
    expect(byAdmin[0]!.text).toContain(`(отозвал: ${UI_TEXTS['dm.tok.who_admin'].ru})`);
    expect((await bell(ka.id)).map((b) => b.userId)).toEqual([
      userOf('owner-a'),
      userOf('owner-a'),
    ]);
    // Чужая организация: о токенах А владельцу Б ничего, о токене Б — только владельцу Б.
    for (const id of [k.id, ka.id]) {
      expect((await outbox(id)).filter((r) => r.userId === userOf('owner-b')).length, id).toBe(0);
    }
    expect((await outbox(kb.id)).map((r) => [r.userId, r.dedupeKey])).toEqual([
      [userOf('owner-b'), `${DM_TOKEN_NOTICE_KEYS.new(kb.id)}:${userOf('owner-b')}`],
    ]);
  });

  it('сообщение об отзыве не записалось — токен всё равно отозван: у сотрудника и у Админки', async () => {
    const mine = await issue('owner-a', 'Отзыв без сообщения');
    const theirs = await issue('owner-a', 'Отзыв Админкой без сообщения');
    const db = f.t.admin.db;
    // Очередь не принимает вид `dm_token` — как если бы код опередил миграцию 0176.
    await db.execute(
      sql`alter table telegram_outbox add constraint test_no_dm_token check (kind <> 'dm_token') not valid`,
    );
    try {
      const rv = await call('senior-a', 'POST', `/api/dm/tokens/${mine.id}/revoke`);
      expect(rv.status, await rv.clone().text()).toBe(200);
      const adm = await call('platform-admin', 'POST', `/api/admin/dm/tokens/${theirs.id}/revoke`);
      expect(adm.status, await adm.clone().text()).toBe(200);
    } finally {
      await db.execute(sql`alter table telegram_outbox drop constraint test_no_dm_token`);
    }
    for (const id of [mine.id, theirs.id]) {
      const [t] = await db
        .select({ revokedAt: dmTokens.revokedAt })
        .from(dmTokens)
        .where(eq(dmTokens.id, id));
      expect(t!.revokedAt, id).not.toBeNull();
      const revokedRows = (await outbox(id)).filter((r) =>
        r.dedupeKey?.startsWith('dm_tok_revoked:'),
      );
      expect(revokedRows.length, id).toBe(0);
    }
    // Копия истории отзыва Админкой в организации — записана.
    const [h] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.orgId, f.a.orgId),
          eq(schema.auditLog.entityId, theirs.id),
          eq(schema.auditLog.action, 'dm_revoke'),
        ),
      );
    expect(h!.n).toBe(1);
  });

  it('токен Админки — без сообщений: владельцев у него нет', async () => {
    const before = await f.t.admin.db.$count(telegramOutbox, eq(telegramOutbox.kind, 'dm_token'));
    const k = await issue('platform-admin', 'Отчёт платформы', 30, '/api/admin/dm');
    expect(
      (await call('platform-admin', 'POST', `/api/admin/dm/tokens/${k.id}/revoke`)).status,
    ).toBe(200);
    expect(await f.t.admin.db.$count(telegramOutbox, eq(telegramOutbox.kind, 'dm_token'))).toBe(
      before,
    );
    expect((await bell(k.id)).length).toBe(0);
  });

  it('строка о токене видна только владельцу: у сотрудника её нет и в колокольчике', async () => {
    const k = await issue('owner-a', 'Для проверки строки');
    await f.t.admin.db.insert(bellNotifications).values({
      orgId: f.a.orgId,
      userId: userOf('senior-a'),
      kind: 'other',
      event: 'dm_token',
      targetKind: 'dm_token',
      targetId: k.id,
      text: 'Строка не владельцу',
      eventKey: `test:${k.id}`,
    });
    const res = await call('senior-a', 'GET', '/api/bell?tab=all');
    expect(res.status).toBe(200);
    expect(BellPage.parse(await res.json()).items.some((x) => x.open?.id === k.id)).toBe(false);
  });

  it('«до конца срока 7 дней» — один раз на токен; на 7 дней, перевыпущенный, отозванный и чужой организации — по своим правилам', async () => {
    const now = new Date();
    const slot = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const day = (n: number) => new Date(slot.getTime() + n * DAY_MS);
    const db = f.t.admin.db;
    const put = async (
      orgId: string,
      name: string,
      createdAt: Date,
      expiresAt: Date,
      more: Partial<typeof dmTokens.$inferInsert> = {},
    ) => {
      const token = `bk_${randomBytes(32).toString('base64url').replace(/[-_]/g, 'A').slice(0, 43)}`;
      const [row] = await db
        .insert(dmTokens)
        .values({
          orgId,
          templateId: tplId,
          name,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          prefix: token.slice(0, 9),
          createdAt,
          expiresAt,
          createdBy: orgId === f.a.orgId ? userOf('owner-a') : userOf('owner-b'),
          ...more,
        })
        .returning({ id: dmTokens.id });
      return row!.id;
    };
    const soon = await put(f.a.orgId, 'Истекает через 5 дней', day(-25), day(5));
    const short = await put(f.a.orgId, 'На 7 дней', day(-2), day(5));
    const later = await put(f.a.orgId, 'Ещё 10 дней', day(-20), day(10));
    const revoked = await put(f.a.orgId, 'Отозван', day(-25), day(5), {
      revokedAt: day(-1),
      revokedBy: userOf('owner-a'),
    });
    const replaced = await put(f.a.orgId, 'Перевыпущен', day(-25), day(5), {
      replacedBy: later,
      graceUntil: day(0.5),
    });
    const other = await put(f.b.orgId, 'Б истекает', day(-25), day(3));

    const deps = createTestDeps({ db: f.t.app.db, clock: fixedClock(slot.toISOString()) });
    const job = dmTokenExpiryJob(BASE);
    // У владельца Б на время запуска нет Telegram: ему — только строка колокольчика, и токен
    // всё равно считается.
    const { telegramLinks } = schema;
    const [linkB] = await db
      .delete(telegramLinks)
      .where(eq(telegramLinks.userId, userOf('owner-b')))
      .returning();
    try {
      expect(await job.run(deps, slot)).toBe(2);
      // Повтор того же запуска и следующий день ничего не добавляют.
      expect(await job.run(deps, slot)).toBe(0);
      expect(await job.run(deps, day(1))).toBe(0);
    } finally {
      if (linkB) await db.insert(telegramLinks).values(linkB);
    }

    const soonRows = await outbox(soon);
    expect(soonRows.map((r) => r.userId)).toEqual([userOf('owner-a')]);
    expect(soonRows[0]!.text).toContain('осталось дней: 5');
    expect(soonRows[0]!.dedupeKey).toBe(`${DM_TOKEN_NOTICE_KEYS.soon(soon)}:${userOf('owner-a')}`);
    expect((await bell(soon)).map((b) => b.userId)).toEqual([userOf('owner-a')]);
    expect((await outbox(other)).length).toBe(0);
    expect((await bell(other)).map((b) => b.userId)).toEqual([userOf('owner-b')]);
    for (const id of [short, later, revoked, replaced]) {
      expect((await outbox(id)).length, id).toBe(0);
      expect((await bell(id)).length, id).toBe(0);
    }
  });
});

describe('кнопка «Открыть» в сообщении о токене', () => {
  it('ссылка на окно токена — только у сайта по https: у другого кнопки нет', () => {
    expect(dmTokenSiteUrl(BASE, 'abc')).toBe(`${BASE}/app/dm/tok?tok=abc`);
    expect(dmTokenSiteUrl('http://localhost:3000', 'abc')).toBeNull();
  });
});
