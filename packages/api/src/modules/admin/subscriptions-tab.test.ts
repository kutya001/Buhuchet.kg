import { randomUUID } from 'node:crypto';
import type { FakeTelegram } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { createOrganization } from '@buhuchet/db/organizations';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  AdminSubscriptionCard,
  AdminSubscriptionList,
  AdminSubscriptionPlans,
  AdminSubscriptionSettings,
  AdminSubscriptionsSummary,
  ApiError,
  FileLink,
  ListValues,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, linkTelegram, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/*
 * Админка → «Организации» → «Подписки» (доработки 20.11.2026, блок 6, пункты 2–7; этап 1, П3):
 * только администратору платформы; чек — подтвердить или отклонить один раз и по версии; «Изменить
 * подписку» — с причиной, без изменений — «Изменений нет»; виды подписок и цены — с историей.
 * Часы тестов — 18.10.2026; у организаций фикстуры — «Месяц», 1 000 мест, оплачено до 31.12.2099.
 */
describe.skipIf(!databaseAvailable())('Админка: «Подписки»', () => {
  let f: Fixture;
  let admin = '';
  let owner = '';
  const OWNER_CHAT = 7_301;
  /** Сообщения бота в чат владельца Б. */
  const ownerChat = () =>
    (f.deps.telegram as FakeTelegram).sent.filter((m) => String(m.chatId) === String(OWNER_CHAT));
  const call = (method: Method, path: string, cookie: string, body?: unknown) =>
    apiRequest(f.app, method, path, cookie, body);
  const ok = async <T>(res: Response, parse: (x: unknown) => T): Promise<T> => {
    expect(res.status, await res.clone().text()).toBe(200);
    return parse(await res.json());
  };
  const fail = async (res: Response, status: number) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return ApiError.parse(await res.json()).error;
  };
  const cardOf = async (orgId: string) =>
    ok(await call('GET', `/api/admin/subscriptions/${orgId}`, admin), (x) =>
      AdminSubscriptionCard.parse(x),
    );
  /** Строки колокольчика владельца организации Б о подписке (вид события `sub`): ключ и текст. */
  const ownerBell = async () =>
    (
      await f.t.admin.db
        .select({
          key: schema.bellNotifications.eventKey,
          text: schema.bellNotifications.text,
          kind: schema.bellNotifications.kind,
          targetKind: schema.bellNotifications.targetKind,
        })
        .from(schema.bellNotifications)
        .where(
          and(
            eq(schema.bellNotifications.userId, f.b.ownerUserId),
            eq(schema.bellNotifications.event, 'sub'),
          ),
        )
    ).sort((x, y) => x.key.localeCompare(y.key));
  /**
   * Чек на проверке от владельца организации Б: продление на 3 месяца, 20 мест; прикреплён накануне
   * по часам теста (18.10.2026) — «Срок проверки» (3 дня) ещё не прошёл.
   */
  const pending = async (createdAt = new Date('2026-10-17T10:00:00+06:00')) => {
    const id = randomUUID();
    await f.t.admin.db.insert(schema.subscriptionPayments).values({
      id,
      orgId: f.b.orgId,
      kind: 'renew',
      planId: 'm3',
      months: 3,
      seats: 20,
      amount: 570_000,
      receiptKey: `org/${f.b.orgId}/subs/${id}`,
      receiptName: 'Чек_Optima.pdf',
      receiptType: 'application/pdf',
      receiptBytes: 184_320,
      createdBy: f.b.ownerUserId,
      createdAt,
    });
    return id;
  };

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    owner = await signIn(f.app, 'owner-b', TEST_PASSWORD);
    // Telegram владельца Б: сообщения о решении по чеку уходят сразу после транзакции решения.
    await linkTelegram(f.app, owner, OWNER_CHAT);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  // Чек, который тест не довёл до решения, следующему не мешает (у организации один чек на проверке).
  afterEach(async () => {
    await f.t.admin.db
      .delete(schema.subscriptionPayments)
      .where(
        and(
          eq(schema.subscriptionPayments.orgId, f.b.orgId),
          eq(schema.subscriptionPayments.status, 'pending'),
        ),
      );
  });

  it('только администратору платформы: сотруднику — 403, без входа — 401', async () => {
    const id = await pending();
    const settings = { version: 1 };
    const paths: [Method, string, unknown?][] = [
      ['GET', '/api/admin/subscriptions'],
      ['GET', '/api/admin/subscriptions/values?col=st'],
      ['GET', '/api/admin/subscriptions/export?cols=name'],
      ['GET', '/api/admin/subscriptions/summary'],
      ['GET', `/api/admin/subscriptions/${f.b.orgId}`],
      [
        'POST',
        `/api/admin/subscriptions/payments/${id}/confirm`,
        { months: 3, paidUntil: '2100-03-31', version: 1 },
      ],
      ['POST', `/api/admin/subscriptions/payments/${id}/reject`, { reason: 'Нет', version: 1 }],
      [
        'PUT',
        `/api/admin/subscriptions/${f.b.orgId}`,
        { planId: 'm1', seats: 2000, paidUntil: '2099-12-31', reason: 'Свой пакет', version: 1 },
      ],
      ['GET', '/api/admin/subscription-plans'],
      [
        'POST',
        '/api/admin/subscription-plans',
        { name: 'Свой', months: 2, discountPct: 0, perks: '', sortOrder: 9, active: true },
      ],
      ['DELETE', '/api/admin/subscription-plans/m1?version=1'],
      ['GET', '/api/admin/subscription-settings'],
      ['PUT', '/api/admin/subscription-settings', settings],
    ];
    for (const [method, path, body] of paths) {
      expect((await call(method, path, owner, body)).status, `${method} ${path}`).toBe(403);
      expect((await call(method, path, '', body)).status, `${method} ${path}`).toBe(401);
    }
    // Ничего не изменилось: чек ждёт, подписка организации Б — прежняя.
    const card = await cardOf(f.b.orgId);
    expect(card.payments.find((p) => p.id === id)?.status).toBe('pending');
    expect(card.sub).toMatchObject({ planId: 'm1', seats: 1000, paidUntil: '2099-12-31' });
  });

  it('список, значения, Excel и плашки: все организации, чек на проверке — число у вкладки', async () => {
    const id = await pending();
    const list = await ok(await call('GET', '/api/admin/subscriptions?size=all', admin), (x) =>
      AdminSubscriptionList.parse(x),
    );
    const byName = new Map(list.items.map((r) => [r.name, r]));
    expect(byName.get('Организация Б')).toMatchObject({
      status: 'pending',
      planId: 'm1',
      planName: 'Месяц',
      pack: 1000,
      paidUntil: '2099-12-31',
      pendingId: id,
      pendingAmount: 570_000,
      late: false,
    });
    expect(byName.get('Организация А')).toMatchObject({ status: 'active', pendingId: null });
    // По умолчанию — чек на проверке раньше действующих.
    expect(list.items[0]!.name).toBe('Организация Б');

    const values = await ok(
      await call('GET', '/api/admin/subscriptions/values?col=st', admin),
      (x) => ListValues.parse(x),
    );
    expect(values.items.map((v) => v.value).sort()).toEqual(['active', 'pending']);

    const xlsx = await call('GET', '/api/admin/subscriptions/export?cols=name,st,pack', admin);
    expect(xlsx.status, await xlsx.clone().text()).toBe(200);
    expect(xlsx.headers.get('content-type')).toContain('spreadsheetml');

    const summary = await ok(await call('GET', '/api/admin/subscriptions/summary', admin), (x) =>
      AdminSubscriptionsSummary.parse(x),
    );
    expect(summary).toMatchObject({ pending: 1, late: 0 });
    expect(summary.byStatus.pending).toBe(1);

    // Чек, прикреплённый 14.10, — больше 3 дней: «Ждёт проверки больше 3 дней» в строке и на плашке
    // (поля оплаты не меняются — прежний чек убираем, ставим другой).
    await f.t.admin.db
      .delete(schema.subscriptionPayments)
      .where(eq(schema.subscriptionPayments.id, id));
    await pending(new Date('2026-10-14T10:00:00+06:00'));
    const late = await ok(await call('GET', '/api/admin/subscriptions?size=all', admin), (x) =>
      AdminSubscriptionList.parse(x),
    );
    expect(late.items.find((r) => r.name === 'Организация Б')).toMatchObject({ late: true });
    expect(
      await ok(await call('GET', '/api/admin/subscriptions/summary', admin), (x) =>
        AdminSubscriptionsSummary.parse(x),
      ),
    ).toMatchObject({ pending: 1, late: 1 });
    expect((await cardOf(f.b.orgId)).late).toBe(true);
  });

  it('окно организации без подписки — «из 2 ГБ» (прототип `subMem`), демо — без предела', async () => {
    const org = await createOrganization(f.t.app.db, {
      name: 'ОсОО «Без подписки»',
      inn: '04811201810474',
      slug: 'subs-tab-none',
      owner: { fullName: 'Владелец', login: 'subs-tab-none-owner', passwordHash: 'нет пароля' },
      subscription: null,
    });
    const none = await cardOf(org.orgId);
    expect(none).toMatchObject({ status: 'none', sub: null, bytesLimit: 2_000 * 1024 * 1024 });
    await f.t.admin.db
      .update(schema.organizations)
      .set({ isDemo: true })
      .where(eq(schema.organizations.id, org.orgId));
    expect((await cardOf(org.orgId)).bytesLimit).toBeNull();
  });

  it('окно одной организации: в экране владельца нет чека и оплат другой', async () => {
    const id = await pending();
    const a = await cardOf(f.a.orgId);
    expect(a.org.id).toBe(f.a.orgId);
    expect(a.payments.map((p) => p.id)).not.toContain(id);
    expect(a.screen.payments.map((p) => p.id)).not.toContain(id);
    expect(JSON.stringify(a)).not.toContain(f.b.orgId);
    // У своей организации чек на проверке — и в окне, и в экране владельца.
    const b = await cardOf(f.b.orgId);
    expect(b.payments.map((p) => p.id)).toContain(id);
    expect(b.screen.payments.map((p) => p.id)).toContain(id);
  });

  it('«Подтвердить оплату»: по версии, продление 1–36 месяцев, второй раз — «уже проверили»', async () => {
    const id = await pending();
    const card = await cardOf(f.b.orgId);
    const pay = card.payments.find((p) => p.id === id)!;
    expect(pay).toMatchObject({
      status: 'pending',
      planName: '3 месяца',
      amount: 570_000,
      receipt: { name: 'Чек_Optima.pdf', type: 'application/pdf', bytes: 184_320 },
      version: 1,
    });
    // Ключа хранилища в окне нет: чек открывает окно «Файлы» Админки (`/api/admin/files/receipt/{id}/link`).
    expect(JSON.stringify(card)).not.toContain(`subs/${id}`);
    const link = await ok(await call('GET', `/api/admin/files/receipt/${id}/link`, admin), (x) =>
      FileLink.parse(x),
    );
    expect(link.url).toContain(`subs/${id}`);
    // Прежнего пути чека без предела открытий больше нет.
    expect(
      (await call('GET', `/api/admin/subscriptions/payments/${id}/receipt`, admin)).status,
    ).toBe(404);

    const confirm = (body: unknown) =>
      call('POST', `/api/admin/subscriptions/payments/${id}/confirm`, admin, body);
    expect(
      (await fail(await confirm({ months: 3, paidUntil: '2100-03-31', version: 2 }), 409)).code,
    ).toBe('record_changed');
    expect(
      (await fail(await confirm({ months: 0, paidUntil: '2100-03-31', version: 1 }), 400)).code,
    ).toBe('sub_confirm_months');
    expect((await confirm({ months: 37, paidUntil: '2100-03-31', version: 1 })).status).toBe(400);

    const done = await ok(await confirm({ months: 6, paidUntil: '2100-06-30', version: 1 }), (x) =>
      AdminSubscriptionCard.parse(x),
    );
    expect(done.sub).toMatchObject({
      planId: 'm3',
      planName: '3 месяца',
      seats: 20,
      paidUntil: '2100-06-30',
    });
    expect(done.payments.find((p) => p.id === id)).toMatchObject({
      status: 'confirmed',
      months: 6,
      paidUntil: '2100-06-30',
      decidedBy: { admin: true },
    });
    expect(done.history[0]).toMatchObject({
      action: 'sub_paid',
      actorAdmin: true,
      changes: expect.arrayContaining([
        { field: 'kind', to: 'renew' },
        { field: 'amount', to: 570_000 },
        { field: 'months', to: 6 },
        { field: 'paidUntil', from: '2099-12-31', to: '2100-06-30' },
        { field: 'status', from: 'pending' },
      ]),
    });
    // Экран «Подписка» владельца в том же ответе (прототип `subScreenHtml(orgId, {admin: true})`).
    expect(done.screen).toMatchObject({
      status: 'active',
      sub: { planId: 'm3', paidUntil: '2100-06-30' },
    });
    expect(done.screen.payments.find((p) => p.id === id)?.status).toBe('confirmed');
    // Владельцам — «Оплата подтверждена» (поток Т): строка колокольчика, открывает «Подписку».
    expect(await ownerBell()).toContainEqual({
      key: `sub_paid:${id}`,
      text: expect.stringContaining('30.06.2100'),
      kind: 'other',
      targetKind: 'sub',
    });
    // …и Telegram — уже к ответу «Подтвердить оплату», без задачи очереди.
    expect(ownerChat().filter((m) => m.text.includes('30.06.2100'))).toHaveLength(1);
    const again = await fail(
      await confirm({ months: 6, paidUntil: '2100-06-30', version: 2 }),
      409,
    );
    expect(again.code).toBe('sub_pay_decided');
    // Решённую второй раз не решить — и второго сообщения нет.
    expect((await ownerBell()).filter((r) => r.key === `sub_paid:${id}`)).toHaveLength(1);
    expect(
      (
        await fail(
          await call('POST', `/api/admin/subscriptions/payments/${id}/reject`, admin, {
            reason: 'Поздно',
            version: 2,
          }),
          409,
        )
      ).code,
    ).toBe('sub_pay_decided');
    // Чужая оплата или её нет — 404.
    expect(
      (
        await call('POST', `/api/admin/subscriptions/payments/${randomUUID()}/confirm`, admin, {
          months: 1,
          paidUntil: '2100-01-01',
          version: 1,
        })
      ).status,
    ).toBe(404);
  });

  it('«Отклонить»: причина обязательна, её видит организация', async () => {
    const id = await pending();
    const reject = (body: unknown) =>
      call('POST', `/api/admin/subscriptions/payments/${id}/reject`, admin, body);
    expect((await reject({ reason: '  ', version: 1 })).status).toBe(400);
    const done = await ok(await reject({ reason: 'Сумма не совпадает', version: 1 }), (x) =>
      AdminSubscriptionCard.parse(x),
    );
    expect(done.payments.find((p) => p.id === id)).toMatchObject({
      status: 'rejected',
      reason: 'Сумма не совпадает',
    });
    expect(done.history[0]).toMatchObject({
      action: 'sub_rejected',
      reason: 'Сумма не совпадает',
      changes: [
        { field: 'kind', to: 'renew' },
        { field: 'amount', to: 570_000 },
      ],
    });
    // Подписка не изменилась.
    expect(done.sub).toMatchObject({ planId: 'm3', seats: 20, paidUntil: '2100-06-30' });
    // Владельцам — «Чек отклонён» с причиной (поток Т).
    expect(await ownerBell()).toContainEqual({
      key: `sub_rejected:${id}`,
      text: expect.stringContaining('Сумма не совпадает'),
      kind: 'other',
      targetKind: 'sub',
    });
    expect(ownerChat().filter((m) => m.text.includes('Сумма не совпадает'))).toHaveLength(1);
    const [row] = await f.t.admin.db
      .select({ reason: schema.subscriptionPayments.reason })
      .from(schema.subscriptionPayments)
      .where(
        and(
          eq(schema.subscriptionPayments.id, id),
          eq(schema.subscriptionPayments.orgId, f.b.orgId),
        ),
      );
    expect(row?.reason).toBe('Сумма не совпадает');
  });

  it('«Изменить подписку»: по версии, проверки полей, «Изменений нет», бесплатный период', async () => {
    const card = await cardOf(f.a.orgId);
    const sub = card.sub!;
    const edit = (body: unknown) =>
      call('PUT', `/api/admin/subscriptions/${f.a.orgId}`, admin, body);
    const base = {
      planId: sub.planId,
      seats: sub.seats,
      extraGb: sub.extraGb,
      paidUntil: sub.paidUntil,
      extraDiscountPct: sub.extraDiscountPct,
      reason: 'Договорились',
    };
    expect((await fail(await edit({ ...base, version: sub.version + 1 }), 409)).code).toBe(
      'record_changed',
    );
    expect((await fail(await edit({ ...base, version: sub.version }), 409)).code).toBe(
      'sub_no_change',
    );
    const seats = await fail(await edit({ ...base, seats: 15, version: sub.version }), 400);
    expect(seats).toMatchObject({ code: 'sub_seats', details: { field: 'seats' } });
    const plan = await fail(await edit({ ...base, planId: 'нет', version: sub.version }), 400);
    expect(plan).toMatchObject({ code: 'sub_plan', details: { field: 'planId' } });
    expect((await edit({ ...base, reason: '', seats: 2000, version: sub.version })).status).toBe(
      400,
    );

    const done = await ok(
      await edit({ ...base, seats: 2000, free: true, reason: 'Пилот', version: sub.version }),
      (x) => AdminSubscriptionCard.parse(x),
    );
    expect(done.sub).toMatchObject({ seats: 2000, free: true, version: sub.version + 1 });
    expect(done.history[0]).toMatchObject({
      action: 'update',
      reason: 'Пилот',
      changes: expect.arrayContaining([{ field: 'seats', from: 1000, to: 2000 }]),
    });
    // Бесплатный период — ещё и строка «Истории оплат» без суммы.
    expect(done.payments[0]).toMatchObject({ kind: 'free', status: 'confirmed', amount: 0 });
    // Организации нет — 404, и подписка ей не заводится.
    expect(
      (await call('PUT', `/api/admin/subscriptions/${randomUUID()}`, admin, { ...base })).status,
    ).toBe(404);
  });

  it('«Виды подписок»: создать, изменить по версии, удалить только неиспользованный', async () => {
    const list = await ok(await call('GET', '/api/admin/subscription-plans', admin), (x) =>
      AdminSubscriptionPlans.parse(x),
    );
    expect(list.plans.map((k) => k.id)).toEqual(['m1', 'm3', 'm6', 'm9', 'm12']);
    expect(list.plans[0]).toMatchObject({ name: 'Месяц', subs: 1 });
    expect(list.plans[1]!.pays).toBeGreaterThan(0);

    const body = {
      name: 'Два месяца',
      months: 2,
      discountPct: 3,
      perks: ' Скидка 3 %\n\n Пакет можно менять ',
      sortOrder: 6,
      active: true,
    };
    const create = (x: unknown) => call('POST', '/api/admin/subscription-plans', admin, x);
    expect((await fail(await create({ ...body, months: 37 }), 400)).details).toEqual({
      field: 'months',
    });
    expect((await fail(await create({ ...body, name: 'месяц' }), 400)).code).toBe(
      'sub_kind_name_taken',
    );
    const created = await ok(await create(body), (x) => AdminSubscriptionPlans.parse(x));
    const k = created.plans.find((p) => p.name === 'Два месяца')!;
    expect(k).toMatchObject({
      months: 2,
      perks: ['Скидка 3 %', 'Пакет можно менять'],
      subs: 0,
      version: 1,
    });
    expect(created.history[0]).toMatchObject({
      entity: 'subscription_plan',
      entityId: k.id,
      action: 'create',
    });

    const update = (x: unknown) => call('PUT', `/api/admin/subscription-plans/${k.id}`, admin, x);
    expect((await fail(await update({ ...body, active: false, version: 2 }), 409)).code).toBe(
      'record_changed',
    );
    const off = await ok(await update({ ...body, active: false, version: 1 }), (x) =>
      AdminSubscriptionPlans.parse(x),
    );
    expect(off.plans.find((p) => p.id === k.id)).toMatchObject({ active: false, version: 2 });
    expect(off.history[0]).toMatchObject({
      action: 'update',
      changes: [{ field: 'active', from: true, to: false }],
    });
    // Без изменений — истории нет.
    const same = await ok(await update({ ...body, active: false, version: 2 }), (x) =>
      AdminSubscriptionPlans.parse(x),
    );
    expect(same.history.length).toBe(off.history.length);

    expect(
      (await fail(await call('DELETE', '/api/admin/subscription-plans/m1?version=1', admin), 409))
        .code,
    ).toBe('sub_kind_used');
    expect(
      (await call('DELETE', `/api/admin/subscription-plans/${k.id}?version=1`, admin)).status,
    ).toBe(409);
    const gone = await ok(
      await call('DELETE', `/api/admin/subscription-plans/${k.id}?version=2`, admin),
      (x) => AdminSubscriptionPlans.parse(x),
    );
    expect(gone.plans.some((p) => p.id === k.id)).toBe(false);
    expect(gone.history[0]).toMatchObject({ action: 'delete', entityId: k.id });
    expect(
      (await call('DELETE', '/api/admin/subscription-plans/net?version=1', admin)).status,
    ).toBe(404);
  });

  it('«Цены и реквизиты»: проверки полей, «Изменений нет», история «было → стало»', async () => {
    const s = await ok(await call('GET', '/api/admin/subscription-settings', admin), (x) =>
      AdminSubscriptionSettings.parse(x),
    );
    const { history: _history, ...fields } = s;
    const put = (x: unknown) => call('PUT', '/api/admin/subscription-settings', admin, x);
    // Реквизиты платформы сначала пусты: сохранить без них нельзя.
    expect((await fail(await put(fields), 400)).details).toEqual({ field: 'recipient' });
    const step = await fail(await put({ ...fields, seatStep: 0 }), 400);
    expect(step).toMatchObject({ code: 'sub_cfg_range_int', details: { field: 'seatStep' } });

    const next = {
      ...fields,
      seatPrice: fields.seatPrice + 1_000,
      baseGb: fields.baseGb + 1,
      recipient: 'ОсОО «Бухучет»',
      bank: 'Оптима Банк',
      bik: '109001',
      account: '1090000000000001',
    };
    const bik = await fail(await put({ ...next, bik: '12' }), 400);
    expect(bik).toMatchObject({ code: 'sub_cfg_bik', details: { field: 'bik' } });
    const saved = await ok(await put(next), (x) => AdminSubscriptionSettings.parse(x));
    expect(saved).toMatchObject({
      seatPrice: next.seatPrice,
      baseGb: next.baseGb,
      bik: '109001',
      version: s.version + 1,
    });
    expect(saved.history[0]).toMatchObject({
      entity: 'subscription_settings',
      action: 'update',
      changes: expect.arrayContaining([
        { field: 'seatPrice', from: fields.seatPrice, to: next.seatPrice },
        { field: 'baseGb', from: fields.baseGb, to: next.baseGb },
      ]),
    });
    const [row] = await f.t.admin.db.select().from(schema.subscriptionSettings);
    expect(row?.baseMb).toBe(next.baseGb * 1000);
    expect((await fail(await put({ ...next, version: saved.version }), 409)).code).toBe(
      'sub_no_change',
    );
    expect((await fail(await put({ ...next, bank: 'Другой', version: s.version }), 409)).code).toBe(
      'record_changed',
    );
  });
});
