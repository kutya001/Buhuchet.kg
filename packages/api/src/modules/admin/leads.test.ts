import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import { ApiError, LeadSubmitted } from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { createStaffFixture, createTestDeps, TEST_ORIGIN } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const form = (over: Record<string, unknown> = {}) => ({
  name: 'Айгуль Садыкова',
  firm: 'ОсОО «Учёт Плюс»',
  phone: '+996555100200',
  size: '21–50',
  telegram: '@aigul',
  note: 'Перезвоните после обеда',
  consent: true,
  website: '',
  ...over,
});

describe.skipIf(!databaseAvailable())('«Оставить заявку» с лендинга (задача #165)', () => {
  let f: Fixture;
  let adminId: string;

  const send = (
    body: unknown,
    { ip = '203.0.113.7', app = f.app }: { ip?: string; app?: Fixture['app'] } = {},
  ) =>
    app.request('/api/leads', {
      method: 'POST',
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        'x-forwarded-for': `${ip}, 10.0.0.1`,
      },
      body: JSON.stringify(body),
    });
  const leads = () => f.t.admin.db.select().from(schema.platformLeads);
  const outbox = () =>
    f.t.admin.db.select().from(schema.telegramOutbox).where(eq(schema.telegramOutbox.kind, 'lead'));

  beforeAll(async () => {
    f = await createStaffFixture();
    const [a] = await f.t.admin.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.login, 'platform-admin'));
    adminId = a!.id;
    await f.t.admin.db
      .insert(schema.telegramLinks)
      .values([{ userId: adminId, orgId: null, chatId: 4001, username: 'platform' }]);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('без входа: «Спасибо!», строка «Новая», администратору — сообщение по шаблону с номером по маске', async () => {
    const res = await send(form());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(LeadSubmitted.parse(await res.json())).toEqual({ ok: true });
    expect(await leads()).toEqual([
      expect.objectContaining({
        name: 'Айгуль Садыкова',
        phone: '+996555100200',
        status: 'new',
        fromStand: false,
      }),
    ]);
    expect(await outbox()).toEqual([
      expect.objectContaining({
        orgId: null,
        userId: adminId,
        chatId: 4001,
        text: '📩 Новая заявка с сайта: ОсОО «Учёт Плюс», Айгуль Садыкова, +996 555 100 200, клиентов: 21–50.',
      }),
    ]);
  });

  it('неверные данные — 400 с ошибками полей; без галочки согласия заявка не принимается', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ consent: false }, 'consent'],
      [{ name: '  ' }, 'name'],
      [{ firm: '' }, 'firm'],
      [{ size: '' }, 'size'],
      [{ phone: '555100200' }, 'phone'],
      [{ note: 'x'.repeat(1001) }, 'note'],
    ];
    const before = (await leads()).length;
    for (const [over, field] of cases) {
      const res = await send(form({ ...over, phone: over.phone ?? '+996700000001' }));
      expect([field, res.status]).toEqual([field, 400]);
      const body = ApiError.parse(await res.json());
      expect(body.error.code).toBe('validation_failed');
      expect(JSON.stringify(body.error.details)).toContain(field);
    }
    // Номер не по маске страны (8 цифр вместо 9) — тоже 400 с ключом словаря.
    const short = await send(form({ phone: '+99655510020' }));
    expect(short.status).toBe(400);
    expect(JSON.stringify((await short.json()) as unknown)).toContain('land.e.phone');
    expect((await leads()).length).toBe(before);
  });

  it('поле-ловушка заполнено — «Спасибо!», но ничего не сохраняется', async () => {
    const before = (await leads()).length;
    const res = await send(form({ phone: '+996700000002', website: 'http://spam.example' }));
    expect(res.status).toBe(200);
    expect((await leads()).length).toBe(before);
  });

  it('повтор с того же телефона — «Спасибо!» без второй строки; четвёртая за час с адреса — 429', async () => {
    const ip = '198.51.100.9';
    expect((await send(form({ phone: '+996700000003' }), { ip })).status).toBe(200);
    expect((await send(form({ phone: '+996700000003', note: 'Ещё' }), { ip })).status).toBe(200);
    const same = (await leads()).filter((l) => l.phone === '+996700000003');
    expect(same).toHaveLength(1);
    expect(same[0]!.note).toBe('Перезвоните после обеда\nЕщё');
    expect((await send(form({ phone: '+996700000004' }), { ip })).status).toBe(200);
    const fourth = await send(form({ phone: '+996700000005' }), { ip });
    expect(fourth.status).toBe(429);
    expect(ApiError.parse(await fourth.json()).error.code).toBe('lead_limited');
    // С другого адреса — принимается.
    expect((await send(form({ phone: '+996700000005' }), { ip: '198.51.100.10' })).status).toBe(
      200,
    );
  });

  it('без Origin своего сайта заявка не принимается (защита от подделки запроса)', async () => {
    const res = await f.app.request('/api/leads', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify(form({ phone: '+996700000006' })),
    });
    expect(res.status).toBe(403);
  });

  it('тестовый стенд: заявка сохраняется с отметкой и в Telegram не уходит', async () => {
    const stand = createApp(
      createTestDeps({
        db: f.deps.db,
        config: { ...createTestDeps().config, APP_ENV: 'staging' },
      }),
    );
    const before = (await outbox()).length;
    const res = await send(form({ phone: '+996700000007' }), { app: stand, ip: '192.0.2.1' });
    expect(res.status).toBe(200);
    expect((await leads()).find((l) => l.phone === '+996700000007')).toMatchObject({
      fromStand: true,
    });
    expect((await outbox()).length).toBe(before);
  });
});
