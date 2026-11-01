import type { FakeTelegram } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import {
  AdminTelegramBot,
  AdminTelegramBroadcastResult,
  AdminTelegramLogList,
  AdminTelegramOrgs,
  AdminTelegramRetryResult,
  AdminTelegramSummary,
  ApiError,
  ListValues,
} from '@buhuchet/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import {
  apiRequest,
  createStaffFixture,
  createTestDeps,
  signIn,
  TEST_PASSWORD,
  unzipTexts,
} from '../../testing';
import { telegramSendJob } from '../telegram/outbox';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const WEBHOOK = 'http://localhost:3000/api/telegram/webhook';
const noPause = async () => {};

describe.skipIf(!databaseAvailable())('Админка → «Телеграм» (задача 2.41)', () => {
  let f: Fixture;
  let admin: string;
  let owner: string;
  let adminId: string;
  const ids: Record<string, string> = {};
  const tg = () => f.deps.telegram as FakeTelegram;

  beforeAll(async () => {
    f = await createStaffFixture();
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
    const [a] = await f.t.admin.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.login, 'platform-admin'));
    adminId = a!.id;
    const now = f.deps.clock.now();
    await f.t.admin.db.insert(schema.telegramLinks).values([
      { userId: f.a.ownerUserId, orgId: f.a.orgId, chatId: 2001, username: 'owner_a' },
      { userId: f.people['acc-b']!.userId, orgId: f.b.orgId, chatId: 2002, username: 'acc_b' },
      { userId: adminId, orgId: null, chatId: 2003, username: 'platform' },
    ]);
    const rows: [string, Partial<typeof schema.telegramOutbox.$inferInsert>][] = [
      [
        'sent',
        {
          orgId: f.a.orgId,
          userId: f.a.ownerUserId,
          chatId: 2001,
          kind: 'reminders',
          text: 'Секретный текст напоминания',
          status: 'sent',
          tries: 1,
          sentAt: now,
        },
      ],
      [
        'error',
        {
          orgId: f.b.orgId,
          userId: f.people['acc-b']!.userId,
          chatId: 2002,
          kind: 'task_new',
          text: 'Новая задача',
          status: 'error',
          tries: 5,
          lastError: '502: Bad Gateway',
        },
      ],
      [
        'code',
        {
          orgId: f.b.orgId,
          userId: f.people['acc-b']!.userId,
          chatId: 2002,
          kind: 'code',
          text: null,
          status: 'error',
          tries: 1,
          lastError: '400: chat not found',
        },
      ],
      [
        'platform',
        {
          orgId: null,
          userId: adminId,
          chatId: 2003,
          kind: 'pass_changed',
          text: 'Пароль изменён',
          status: 'error',
          tries: 1,
          lastError: '502: Bad Gateway',
        },
      ],
    ];
    for (const [key, v] of rows) {
      const [x] = await f.t.admin.db
        .insert(schema.telegramOutbox)
        .values({ userId: f.a.ownerUserId, chatId: 2001, kind: 'reminders', ...v })
        .returning({ id: schema.telegramOutbox.id });
      ids[key] = x!.id;
    }
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  const get = (path: string, cookie = admin) => apiRequest(f.app, 'GET', path, cookie);
  const post = (path: string, body: unknown, cookie = admin) =>
    apiRequest(f.app, 'POST', path, cookie, body);

  it('только администратор платформы: сотруднику организации и без входа — отказ', async () => {
    for (const path of [
      '/api/admin/telegram/log',
      '/api/admin/telegram/log/values?col=st',
      '/api/admin/telegram/log/export?cols=at',
      '/api/admin/telegram/log/summary',
      '/api/admin/telegram/bot',
      '/api/admin/telegram/orgs',
    ]) {
      expect((await get(path, owner)).status, path).toBe(403);
      expect((await get(path, '')).status, path).toBe(401);
    }
    for (const [path, body] of [
      ['/api/admin/telegram/log/retry', { ids: [ids.error] }],
      ['/api/admin/telegram/broadcast', { org: null, text: 'Чужое объявление' }],
    ] as const) {
      expect((await post(path, body, owner)).status, path).toBe(403);
      expect((await post(path, body, '')).status, path).toBe(401);
    }
    const [row] = await f.t.admin.db
      .select({ status: schema.telegramOutbox.status })
      .from(schema.telegramOutbox)
      .where(eq(schema.telegramOutbox.id, ids.error!));
    expect(row!.status).toBe('error');
  });

  it('журнал всех организаций и платформы: без текста сообщения и номера чата; плашки, фильтр, Excel', async () => {
    const res = await get('/api/admin/telegram/log');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain('Секретный текст');
    expect(body).not.toContain('2001');
    const list = AdminTelegramLogList.parse(JSON.parse(body));
    expect(list.total).toBe(4);
    expect(list.items.find((r) => r.id === ids.sent)).toMatchObject({
      recipient: expect.stringContaining('@owner_a'),
      orgName: 'Организация А',
      kind: 'reminders',
      status: 'sent',
    });
    expect(list.items.find((r) => r.id === ids.platform)).toMatchObject({
      recipient: 'platform-admin @platform',
      orgId: null,
      orgName: null,
    });
    expect(
      AdminTelegramSummary.parse(await (await get('/api/admin/telegram/log/summary')).json()),
    ).toEqual({ pending: 0, errors: 3, sentToday: 1 });
    const values = ListValues.parse(
      await (await get('/api/admin/telegram/log/values?col=org')).json(),
    );
    expect(values.items.map((v) => [v.label, v.count])).toEqual(
      expect.arrayContaining([
        ['Платформа', 1],
        ['Организация А', 1],
        ['Организация Б', 2],
      ]),
    );
    const errors = AdminTelegramLogList.parse(
      await (
        await get(
          `/api/admin/telegram/log?filters=${encodeURIComponent(JSON.stringify({ st: { type: 'enum', vals: ['error'] } }))}`,
        )
      ).json(),
    );
    expect(errors.total).toBe(3);
    const file = await get('/api/admin/telegram/log/export?cols=at,to,org,kind,st,tries,err');
    expect(file.status).toBe(200);
    const sheet = unzipTexts(new Uint8Array(await file.arrayBuffer()))['xl/worksheets/sheet1.xml']!;
    expect(sheet).toContain('Тип сообщения');
    expect(sheet).toContain('Пароль изменён');
    expect(sheet).toContain('Платформа');
    expect(sheet).not.toContain('Секретный текст');
  });

  it('«Повторить ошибки»: ошибки снова в очереди, коды восстановления — нет; строки без организации отправляет задача', async () => {
    expect((await post('/api/admin/telegram/log/retry', { ids: [] })).status).toBe(400);
    expect((await post('/api/admin/telegram/log/retry', { ids: ['x'] })).status).toBe(400);
    expect(
      (await post('/api/admin/telegram/log/retry', { ids: [ids.error], extra: 1 })).status,
    ).toBe(400);
    const res = await post('/api/admin/telegram/log/retry', {
      ids: [ids.error, ids.code, ids.sent, ids.platform, ids.error],
    });
    expect(res.status).toBe(200);
    expect(AdminTelegramRetryResult.parse(await res.json())).toEqual({ queued: 2, codes: 1 });
    const again = await post('/api/admin/telegram/log/retry', { ids: [ids.error] });
    expect(AdminTelegramRetryResult.parse(await again.json())).toEqual({ queued: 0, codes: 0 });

    tg().sent.length = 0;
    await telegramSendJob(noPause).run(f.deps, f.deps.clock.now());
    expect(tg().sent.map((m) => [m.chatId, m.text]).sort()).toEqual(
      [
        [2002, 'Новая задача'],
        [2003, 'Пароль изменён'],
      ].sort(),
    );
    const rows = await f.t.admin.db.select().from(schema.telegramOutbox);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(ids.platform!)).toMatchObject({ status: 'sent', tries: 1, lastError: null });
    expect(byId.get(ids.error!)).toMatchObject({ status: 'sent', tries: 1 });
    expect(byId.get(ids.code!)).toMatchObject({ status: 'error' });
  });

  it('«Бот платформы»: адрес вебхука, «Работает», свежая ошибка Telegram, другой адрес, Telegram не ответил', async () => {
    const check = async () => {
      const res = await get('/api/admin/telegram/bot');
      expect(res.status).toBe(200);
      return AdminTelegramBot.parse(await res.json());
    };
    tg().webhook = { url: WEBHOOK, secretToken: 'x' };
    tg().webhookInfo = undefined;
    expect(await check()).toEqual({
      url: WEBHOOK,
      ok: true,
      problem: null,
      lastError: null,
      actualUrl: null,
      checkedAt: f.deps.clock.now().toISOString(),
    });
    tg().webhookInfo = {
      lastErrorAt: new Date(f.deps.clock.now().getTime() - 5 * 60_000),
      lastError: 'Wrong response from the webhook: 502 Bad Gateway',
    };
    expect(await check()).toMatchObject({
      ok: false,
      problem: 'delivery',
      lastError: 'Wrong response from the webhook: 502 Bad Gateway',
    });
    tg().webhookInfo = { url: 'https://other.example/api/telegram/webhook' };
    expect(await check()).toMatchObject({
      ok: false,
      problem: 'other_url',
      actualUrl: 'https://other.example/api/telegram/webhook',
    });
    tg().webhookInfo = { url: '' };
    expect(await check()).toMatchObject({ ok: false, problem: 'not_set' });
    tg().webhookInfo = new Error('fetch failed: https://api.telegram.org/bot123:SECRET/getWebhookInfo');
    const unreachable = await get('/api/admin/telegram/bot');
    const text = await unreachable.text();
    expect(text).not.toContain('SECRET');
    expect(AdminTelegramBot.parse(JSON.parse(text))).toMatchObject({
      ok: false,
      problem: 'unreachable',
      lastError: null,
    });
    tg().webhookInfo = undefined;

    // Бот не подключён (нет переменных бота в окружении).
    const app = createApp(createTestDeps({ db: f.t.app.db, telegram: null }));
    const cookie = await signIn(app, 'platform-admin', TEST_PASSWORD);
    const res = await apiRequest(app, 'GET', '/api/admin/telegram/bot', cookie);
    expect(AdminTelegramBot.parse(await res.json())).toMatchObject({
      url: WEBHOOK,
      ok: false,
      problem: 'no_bot',
    });
  });

  it('«Рассылка»: всем, одной организации; пустой и длинный текст — 400, заблокированная организация — 409', async () => {
    const orgs = AdminTelegramOrgs.parse(await (await get('/api/admin/telegram/orgs')).json());
    expect(orgs.items.map((o) => o.name)).toEqual(['Организация А', 'Организация Б']);
    expect((await post('/api/admin/telegram/broadcast', { org: null, text: '   ' })).status).toBe(
      400,
    );
    expect(
      (await post('/api/admin/telegram/broadcast', { org: null, text: 'я'.repeat(4097) })).status,
    ).toBe(400);
    expect((await post('/api/admin/telegram/broadcast', { org: 'x', text: 'Текст' })).status).toBe(
      400,
    );
    expect((await post('/api/admin/telegram/broadcast', { text: 'Без «Кому»' })).status).toBe(400);

    const all = await post('/api/admin/telegram/broadcast', {
      org: null,
      text: '  15 ноября с 22:00 до 23:00 плановые работы  ',
    });
    expect(all.status).toBe(200);
    // Привязан Telegram у владельца А и бухгалтера Б; администратор платформы — не получатель.
    expect(AdminTelegramBroadcastResult.parse(await all.json())).toEqual({ queued: 2 });
    const one = await post('/api/admin/telegram/broadcast', { org: f.b.orgId, text: 'Только Б' });
    expect(AdminTelegramBroadcastResult.parse(await one.json())).toEqual({ queued: 1 });

    await f.t.admin.db.execute(sql`update organizations set status = 'blocked' where id = ${f.b.orgId}`);
    const blocked = await post('/api/admin/telegram/broadcast', { org: f.b.orgId, text: 'Б' });
    expect(blocked.status).toBe(409);
    expect(ApiError.parse(await blocked.json()).error.code).toBe('broadcast_org');
    await f.t.admin.db.execute(sql`update organizations set status = 'active' where id = ${f.b.orgId}`);

    tg().sent.length = 0;
    await telegramSendJob(noPause).run(f.deps, f.deps.clock.now());
    expect(tg().sent.map((m) => [m.chatId, m.text]).sort()).toEqual(
      [
        [2001, '15 ноября с 22:00 до 23:00 плановые работы'],
        [2002, '15 ноября с 22:00 до 23:00 плановые работы'],
        [2002, 'Только Б'],
      ].sort(),
    );
    const history = await f.t.admin.db
      .select()
      .from(schema.platformAuditLog)
      .where(eq(schema.platformAuditLog.entity, 'telegram_broadcast'));
    expect(history.map((h) => [h.entityId, h.actorUserId])).toEqual([
      ['all', adminId],
      [f.b.orgId, adminId],
    ]);
  });
});
