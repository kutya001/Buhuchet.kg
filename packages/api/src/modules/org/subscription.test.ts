import type { MemoryStorage } from '@buhuchet/adapters';
import { schema, withOrgContext } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import { subscriptionCalc, SUBSCRIPTION_MESSAGES } from '@buhuchet/domain';
import {
  ApiError,
  FileLink,
  MeResponse,
  OrgSubscriptionView,
  SubscriptionPayDone,
  SubscriptionUploadTicket,
} from '@buhuchet/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';
import { SUB_RECEIPT_RATE_LIMIT } from './subscription';

/*
 * Экран «Подписка» владельца и заявка с чеком (доработки 20.11.2026, блок 5; блок 4, пункты 3–6;
 * пакет 2, блок 6 — защита загрузки; прототип v154 `modules/org-sub.js`; этап 1, П7, поток И).
 */

const { auditLog, organizations, orgSubscriptions, subscriptionPayments, users } = schema;

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
/** Страница с расширением .pdf: браузер положит её как PDF, проверка содержимого — нет. */
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>');

async function apiErr(res: Response) {
  return ApiError.parse(await res.json()).error;
}

describe.skipIf(!databaseAvailable())('«Подписка» владельца: API', () => {
  let f: Fixture;
  let owner: string;
  let chief: string;
  let ownerB: string;
  let admin: string;
  let adminId = '';
  let storage: MemoryStorage;
  let paid = '';

  const call = (method: 'GET' | 'POST', path: string, cookie?: string, body?: unknown) =>
    apiRequest(f.app, method, path, cookie, body);
  /** Браузер кладёт файл по ссылке «начать» — в памяти, под тем же ключом и типом. */
  const upload = async (ticket: SubscriptionUploadTicket, body: Uint8Array, type?: string) => {
    const url = new URL(ticket.upload.url);
    const key = `${url.host}${url.pathname}`;
    await storage.put(key, body, { contentType: type ?? ticket.upload.headers['content-type']! });
    return key;
  };
  const keysOf = (orgId: string) =>
    [...storage.files.keys()].filter((k) => k.startsWith(`org/${orgId}/subs/`));
  const view = async (cookie = owner) => {
    const res = await call('GET', '/api/org/subscription', cookie);
    expect(res.status).toBe(200);
    return OrgSubscriptionView.parse(await res.json());
  };
  const renew = (planId: string, seats: number, extraGb = 0) => ({
    kind: 'renew' as const,
    planId,
    seats,
    extraGb,
    startMode: 'now' as const,
  });
  const start = (cookie: string, pay: unknown, file = { name: 'Чек.pdf', size: PDF.length }) =>
    call('POST', '/api/org/subscription/payments/start', cookie, { pay, file });
  const historyOf = (orgId: string, action: string) =>
    f.t.admin.db
      .select({ changes: auditLog.changes, userId: auditLog.actorUserId })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.orgId, orgId),
          eq(auditLog.entity, 'subscription'),
          eq(auditLog.action, action),
        ),
      );

  beforeAll(async () => {
    f = await createStaffFixture();
    storage = f.deps.storage as MemoryStorage;
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
    chief = await signIn(f.app, 'chief-a', TEST_PASSWORD);
    ownerB = await signIn(f.app, 'owner-b', TEST_PASSWORD);
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    const [row] = await f.t.admin.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.login, 'platform-admin'));
    adminId = row!.id;
    // У А — месячная подписка на 10 мест до конца года, первый месяц уже оплачен; у Б подписки нет
    // (подписку тестовых организаций из `createStaffFixture` убираем: тесту нужны свои условия).
    const both = [f.a.orgId, f.b.orgId];
    await f.t.admin.db.delete(subscriptionPayments).where(inArray(subscriptionPayments.orgId, both));
    await f.t.admin.db.delete(orgSubscriptions).where(inArray(orgSubscriptions.orgId, both));
    await f.t.admin.db.insert(orgSubscriptions).values({
      orgId: f.a.orgId,
      planId: 'm1',
      seats: 10,
      paidUntil: '2026-12-31',
      firstPaid: true,
    });
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('видит и платит только владелец: сотрудник и администратор платформы — 403', async () => {
    for (const cookie of [chief, admin]) {
      const res = await call('GET', '/api/org/subscription', cookie);
      expect(res.status).toBe(403);
      expect((await apiErr(res)).code).toBe('sub_owner_only');
    }
    const res = await start(chief, renew('m3', 10));
    expect(res.status).toBe(403);
    expect(await call('GET', '/api/org/subscription')).toHaveProperty('status', 401);
  });

  it('экран: подписка, пакет, цены, реквизиты с названием и ИНН организации, своя история', async () => {
    const v = await view();
    expect(v.today).toBe('2026-10-18');
    expect(v.status).not.toBe('demo');
    expect(v.closed).toBe(false);
    expect(v.sub).toMatchObject({ planId: 'm1', seats: 10, extraGb: 0, paidUntil: '2026-12-31' });
    expect(v.usage).toMatchObject({ seatsUsed: 0, seats: 10, extraGb: 0 });
    expect(v.plans.map((p) => p.id)).toEqual(['m1', 'm3', 'm6', 'm9', 'm12']);
    expect(v.monthsLeft).toBe(3);
    expect(v.renewTotal).toBeGreaterThan(0);
    expect(v.requisites.purpose ?? '').not.toMatch(/\{организация\}|\{ИНН\}/);
    expect(v.payments).toEqual([]);
    // Без подписки — экран тот же, подписки нет.
    const b = await view(ownerB);
    expect(b.sub).toBeNull();
    expect(b.renewTotal).toBeNull();
  });

  it('«кто я»: статус подписки и «Оплачено до» у сотрудника, у администратора платформы — null', async () => {
    const meOf = async (cookie: string) =>
      MeResponse.parse(await (await call('GET', '/api/auth/me', cookie)).json());
    expect((await meOf(chief)).subscription).toEqual({
      status: (await view()).status,
      paidUntil: '2026-12-31',
      closed: false,
    });
    expect((await meOf(ownerB)).subscription).toMatchObject({ paidUntil: null });
    expect((await meOf(admin)).subscription).toBeNull();
  });

  it('выбор проверяется до загрузки: шаг пакета, вид, расширение без подписки, сумма из окна не принимается', async () => {
    let res = await start(owner, renew('m3', 15));
    expect(res.status).toBe(400);
    const step = await apiErr(res);
    expect(step).toMatchObject({ code: 'sub_seats_step', message: 'Пакет — по 10 контрагентов' });
    res = await start(owner, renew('нет', 10));
    expect((await apiErr(res)).code).toBe('sub_plan_required');
    res = await start(ownerB, { ...renew('m1', 10), kind: 'grow', planId: null, seats: 20 });
    expect(res.status).toBe(409);
    expect((await apiErr(res)).code).toBe('sub_renew_first');
    res = await start(owner, { ...renew('m1', 10), kind: 'mem', planId: null, extraGb: 0 });
    expect((await apiErr(res)).code).toBe('sub_gb_not_more');
    // Сумму считает сервер: поле суммы — неверный запрос.
    res = await call('POST', '/api/org/subscription/payments/start', owner, {
      pay: { ...renew('m3', 10), amount: 1 },
      file: { name: 'Чек.pdf', size: PDF.length },
    });
    expect(res.status).toBe(400);
    // Пустой файл и больше 20 МБ — до загрузки.
    res = await start(owner, renew('m3', 10), { name: 'Чек.pdf', size: 21 * 1024 * 1024 });
    expect(res.status).toBe(400);
    expect(keysOf(f.a.orgId)).toEqual([]);
  });

  it('чек — по содержимому: страница с расширением .pdf, не тот размер и недошедший файл — отказ, заявки нет', async () => {
    const begin = async (size: number) => {
      const res = await start(ownerB, renew('m1', 10), { name: 'Чек.pdf', size });
      expect(res.status).toBe(201);
      return SubscriptionUploadTicket.parse(await res.json());
    };
    const finish = (id: string, size: number) =>
      call('POST', '/api/org/subscription/payments/complete', ownerB, {
        id,
        pay: renew('m1', 10),
        file: { name: 'Чек.pdf', size },
      });
    let t = await begin(HTML.length);
    expect(t.upload.url).toContain(`org/${f.b.orgId}/subs/${t.id}.up`);
    await upload(t, HTML);
    let res = await finish(t.id, HTML.length);
    expect(res.status).toBe(400);
    expect(await apiErr(res)).toMatchObject({
      code: 'sub_receipt_type',
      message: SUBSCRIPTION_MESSAGES.sub_receipt_type,
    });
    t = await begin(PDF.length);
    await upload(t, PDF.slice(0, 10));
    res = await finish(t.id, PDF.length);
    expect(res.status).toBe(409);
    expect((await apiErr(res)).code).toBe('sub_receipt_missing');
    t = await begin(PDF.length);
    res = await finish(t.id, PDF.length);
    expect((await apiErr(res)).code).toBe('sub_receipt_missing');
    // Ни заявки, ни файла: загрузка и проверочная копия удалены.
    expect(keysOf(f.b.orgId)).toEqual([]);
    const pays = await withOrgContext(f.t.app.db, { orgId: f.b.orgId }, (tx) =>
      tx.select({ id: subscriptionPayments.id }).from(subscriptionPayments),
    );
    expect(pays).toEqual([]);
  });

  it('«Отправить на проверку»: сумма — расчётом сервера, заявка ждёт проверки, второй чек — после проверки', async () => {
    const before = await view();
    let res = await start(owner, renew('m3', 20, 1));
    expect(res.status).toBe(201);
    const t = SubscriptionUploadTicket.parse(await res.json());
    expect(t.upload.headers['content-type']).toBe('application/pdf');
    await upload(t, PDF);
    res = await call('POST', '/api/org/subscription/payments/complete', owner, {
      id: t.id,
      pay: renew('m3', 20, 1),
      file: { name: 'C:\\чеки\\Чек   октябрь.pdf', size: PDF.length },
    });
    expect(res.status).toBe(201);
    const done = SubscriptionPayDone.parse(await res.json());
    paid = done.id;
    const plan = before.plans.find((p) => p.id === 'm3')!;
    const calc = subscriptionCalc({
      kind: 'renew',
      prices: before.prices,
      plan,
      sub: { ...before.sub!, seats: 10, extraGb: 0 },
      seats: 20,
      extraGb: 1,
      startMode: 'now',
      today: '2026-10-18',
    });
    expect(done.amount).toBe(calc.total);
    expect(done.opensAccess).toBe(true);
    // Под ключом чека — проверенный файл; загрузки и проверочной копии нет.
    expect(keysOf(f.a.orgId)).toEqual([`org/${f.a.orgId}/subs/${paid}`]);
    const v = await view();
    expect(v.payments).toEqual([
      expect.objectContaining({
        id: paid,
        kind: 'renew',
        planId: 'm3',
        months: 3,
        seats: 20,
        extraGb: 1,
        amount: calc.total,
        status: 'pending',
        receipt: { name: 'Чек октябрь.pdf', type: 'application/pdf', bytes: PDF.length },
        by: 'owner-a В.',
        again: false,
      }),
    ]);
    expect(v.payments[0]!.lines).toEqual(calc.lines);
    const history = await historyOf(f.a.orgId, 'sub_pay_send');
    expect(history).toHaveLength(1);
    expect(history[0]!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'payment', to: paid }),
        expect.objectContaining({ field: 'amount', to: calc.total }),
      ]),
    );
    // Одна непроверенная заявка за раз: новая оплата — после проверки.
    res = await start(owner, renew('m1', 20));
    expect(res.status).toBe(409);
    expect((await apiErr(res)).code).toBe('sub_pending');
    // Повтор «закончить» тем же номером не кладёт вторую заявку.
    res = await call('POST', '/api/org/subscription/payments/complete', owner, {
      id: paid,
      pay: renew('m3', 20, 1),
      file: { name: 'Чек.pdf', size: PDF.length },
    });
    expect(res.status).toBe(409);
    expect(keysOf(f.a.orgId)).toEqual([`org/${f.a.orgId}/subs/${paid}`]);
  });

  it('чек открывается своей ссылкой: только своей организации, просмотр — с типом из проверки', async () => {
    let res = await call('GET', `/api/org/subscription/payments/${paid}/receipt/link`, owner);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const link = FileLink.parse(await res.json());
    expect(link.url).toContain(`org/${f.a.orgId}/subs/${paid}?`);
    expect(new URL(link.url).searchParams.get('inline')).toBe('application/pdf');
    res = await call(
      'GET',
      `/api/org/subscription/payments/${paid}/receipt/link?download=1`,
      owner,
    );
    expect(new URL(FileLink.parse(await res.json()).url).searchParams.get('inline')).toBeNull();
    res = await call('GET', `/api/org/subscription/payments/${paid}/receipt/download`, owner);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain(`subs/${paid}?`);
    // Чужая организация и сотрудник своей — не видят.
    res = await call('GET', `/api/org/subscription/payments/${paid}/receipt/link`, ownerB);
    expect(res.status).toBe(404);
    res = await call('GET', `/api/org/subscription/payments/${paid}/receipt/link`, chief);
    expect(res.status).toBe(403);
    const other = await view(ownerB);
    expect(other.payments).toEqual([]);
  });

  it('«Заменить файл чека» до проверки: по версии, файл проверяется так же, после проверки — нельзя', async () => {
    const [pay] = (await view()).payments;
    const begin = (version: number) =>
      call('POST', `/api/org/subscription/payments/${paid}/receipt`, owner, {
        file: { name: 'Фото чека.png', size: PNG.length },
        version,
      });
    let res = await begin(pay!.version + 5);
    expect(res.status).toBe(409);
    expect((await apiErr(res)).code).toBe('record_changed');
    // Чужая организация оплату не находит.
    res = await call('POST', `/api/org/subscription/payments/${paid}/receipt`, ownerB, {
      file: { name: 'Фото чека.png', size: PNG.length },
      version: pay!.version,
    });
    expect(res.status).toBe(404);
    res = await begin(pay!.version);
    expect(res.status).toBe(201);
    const t = SubscriptionUploadTicket.parse(await res.json());
    expect(t.upload.url).toContain(`subs/${paid}.rep-${t.id}`);
    await upload(t, PNG);
    res = await call('POST', `/api/org/subscription/payments/${paid}/receipt/complete`, owner, {
      uploadId: t.id,
      file: { name: 'Фото чека.png', size: PNG.length },
      version: pay!.version,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: pay!.version + 1 });
    expect(keysOf(f.a.orgId)).toEqual([`org/${f.a.orgId}/subs/${paid}`]);
    expect([...storage.files.get(`org/${f.a.orgId}/subs/${paid}`)!.body]).toEqual([...PNG]);
    const [after] = (await view()).payments;
    expect(after).toMatchObject({
      receipt: { name: 'Фото чека.png', type: 'image/png', bytes: PNG.length },
      version: pay!.version + 1,
    });
    const history = await historyOf(f.a.orgId, 'sub_receipt_replace');
    expect(history[0]!.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'receipt', from: 'Чек октябрь.pdf', to: 'Фото чека.png' }),
      ]),
    );
    // Подменённая загрузка (не картинка) прежний файл не трогает.
    res = await begin(after!.version);
    const bad = SubscriptionUploadTicket.parse(await res.json());
    await upload(bad, HTML, 'image/png');
    res = await call('POST', `/api/org/subscription/payments/${paid}/receipt/complete`, owner, {
      uploadId: bad.id,
      file: { name: 'Фото чека.png', size: HTML.length },
      version: after!.version,
    });
    expect(res.status).toBe(400);
    expect([...storage.files.get(`org/${f.a.orgId}/subs/${paid}`)!.body]).toEqual([...PNG]);
    // Администратор подтвердил — заменить нельзя.
    await withOrgContext(f.t.app.db, { orgId: f.a.orgId, userId: adminId }, (tx) =>
      tx
        .update(subscriptionPayments)
        .set({
          status: 'confirmed',
          decidedAt: new Date(),
          decidedBy: adminId,
          paidUntil: '2027-01-18',
        })
        .where(eq(subscriptionPayments.id, paid)),
    );
    res = await begin(after!.version);
    expect(res.status).toBe(409);
    expect((await apiErr(res)).code).toBe('sub_pay_decided');
  });

  it('не больше 10 попыток отправить чек в час на организацию', async () => {
    await f.t.admin.db.execute(
      sql`delete from rate_limits where kind = ${SUB_RECEIPT_RATE_LIMIT.kind}`,
    );
    for (let i = 0; i < SUB_RECEIPT_RATE_LIMIT.max; i++) {
      expect((await start(ownerB, renew('m1', 10))).status).toBe(201);
    }
    const res = await start(ownerB, renew('m1', 10));
    expect(res.status).toBe(429);
    expect((await apiErr(res)).code).toBe('sub_receipt_limit');
  });

  it('у демо-организации подписки нет: оплата — 409', async () => {
    await f.t.admin.db
      .update(organizations)
      .set({ isDemo: true })
      .where(eq(organizations.id, f.b.orgId));
    const res = await start(ownerB, renew('m1', 10));
    expect(res.status).toBe(409);
    expect((await apiErr(res)).code).toBe('sub_demo');
  });
});
