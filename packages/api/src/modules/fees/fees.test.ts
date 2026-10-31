import type { MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  ApiError,
  ContractorFees,
  ContractorHistory,
  ContractorList,
  ContractorSummary,
  ContractorTabCounts,
  FeePaymentForm,
  FeePaymentSaved,
  FeeReminder,
  FileUploadTicket,
  ReceiptForm,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

/** Сомы в тыйынах. */
const som = (n: number) => n * 100;

// Сегодня в тестах — 18.10.2026 (`createTestDeps`): начисления с июля по октябрь, срок — 15-е число.
describe.skipIf(!databaseAvailable())('Плата за обслуживание — методы API (задача 2.21)', () => {
  let f: Fixture;
  let owner: string;
  let chief: string;
  let acc: string;
  let ownerB: string;
  let cpPay = '';
  let cpDebt = '';
  let cpOne = '';

  const employee = (login: string) => f.people[login]!.employeeId;
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    cookie: string,
    body?: unknown,
  ) => apiRequest(f.app, method, path, cookie, body);
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  const expectStatus = async (res: Response, status: number) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return res;
  };
  const fees = async (cookie: string, cp: string) =>
    ContractorFees.parse(
      await (
        await expectStatus(await call('GET', `/api/contractors/${cp}/fees`, cookie), 200)
      ).json(),
    );
  const features = (on: Record<string, boolean>) =>
    f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: on })
      .where(eq(schema.orgSettings.orgId, f.a.orgId));
  const ALL_ON = { fee: true, files: true, taxpay: true };

  async function contractor(
    orgId: string,
    name: string,
    inn: string,
    patch: Partial<typeof schema.contractors.$inferInsert> = {},
  ) {
    const [row] = await f.t.admin.db
      .insert(schema.contractors)
      .values({
        orgId,
        name,
        inn,
        phone: '+996505890076',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        startDate: '2026-07-01',
        feeDay: 15,
        paysTo: 'org',
        createdAt: new Date('2026-06-20T10:00:00+06:00'),
        ...patch,
      })
      .returning({ id: schema.contractors.id });
    if (patch.kind !== 'oneoff') {
      await f.t.admin.db.insert(schema.contractorTariffs).values({
        orgId,
        contractorId: row!.id,
        amount: som(30_000),
        period: 'M',
        validFrom: '2026-07-01',
      });
    }
    return row!.id;
  }

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    await features(ALL_ON);
    await f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: ALL_ON })
      .where(eq(schema.orgSettings.orgId, f.b.orgId));
    [owner, chief, acc, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'chief-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
    ]);
    cpPay = await contractor(f.a.orgId, 'ОсОО «Ала-Тоо Трейд»', '03744097401851', {
      responsibleEmployeeId: employee('acc-a'),
    });
    cpDebt = await contractor(f.a.orgId, 'ИП Садыкова', '21503198700015', {
      responsibleEmployeeId: employee('acc-a'),
    });
    cpOne = await contractor(f.a.orgId, 'ИП Разовый', '21503198700023', { kind: 'oneoff' });
  }, 120_000);

  it('вкладка «Обслуживание»: начисления, долг, журнал и действия — владельцу и главному', async () => {
    const v = await fees(owner, cpPay);
    expect(v.months.map((m) => [m.month, m.charge, m.status, m.overdue])).toEqual([
      ['2026-07', som(30_000), 'unpaid', true],
      ['2026-08', som(30_000), 'unpaid', true],
      ['2026-09', som(30_000), 'unpaid', true],
      ['2026-10', som(30_000), 'unpaid', true],
    ]);
    expect(v.debt).toBe(som(120_000));
    expect(v.current).toEqual({ amount: som(30_000), period: 'M', from: '2026-07' });
    expect([v.canAccept, v.canTariff, v.canRemind]).toEqual([true, true, true]);
    expect(v.tariffForm).toMatchObject({ amount: som(30_000), from: '2026-11', hasTariff: true });
    expect((await fees(chief, cpPay)).debt).toBe(som(120_000));
    // У разового — без начислений и действий.
    const one = await fees(owner, cpOne);
    expect([one.months, one.canAccept, one.canTariff]).toEqual([[], false, false]);
  });

  it('обычный бухгалтер платы не видит; выключенная функция и чужая организация — отказ', async () => {
    await expectStatus(await call('GET', `/api/contractors/${cpPay}/fees`, acc), 403);
    await expectStatus(await call('GET', `/api/contractors/${cpPay}/fee-payment-form`, acc), 403);
    await expectStatus(
      await call('POST', `/api/contractors/${cpPay}/fee-payments`, acc, {
        amount: som(1_000),
        date: '2026-10-18',
        to: 'org',
      }),
      403,
    );
    await expectStatus(await call('GET', `/api/contractors/${cpPay}/fees`, ownerB), 404);
    await features({ ...ALL_ON, fee: false });
    try {
      const res = await expectStatus(
        await call('GET', `/api/contractors/${cpPay}/fees`, owner),
        403,
      );
      expect((await failure(res)).code).toBe('fee_off');
    } finally {
      await features(ALL_ON);
    }
  });

  it('п. 64: «Принять оплату» — подставлен долг, начисления «Оплачено», долг 0', async () => {
    const form = FeePaymentForm.parse(
      await (
        await expectStatus(
          await call('GET', `/api/contractors/${cpPay}/fee-payment-form`, chief),
          200,
        )
      ).json(),
    );
    expect(form.amount).toBe(som(120_000));
    expect(form.to.map((x) => x.key)).toEqual(['org', 'owner']);
    const saved = FeePaymentSaved.parse(
      await (
        await expectStatus(
          await call('POST', `/api/contractors/${cpPay}/fee-payments`, chief, {
            amount: form.amount,
            date: '2026-10-18',
            to: form.to[0]!.key,
            allocation: form.allocation,
          }),
          201,
        )
      ).json(),
    );
    const v = await fees(owner, cpPay);
    expect(v.debt).toBe(0);
    expect(v.months.every((m) => m.status === 'paid')).toBe(true);
    expect(v.payments[0]).toMatchObject({ id: saved.id, amount: som(120_000), fromReceipt: false });
    // Долга нет — принять ещё можно (аванс), напомнить — нет.
    expect([v.canAccept, v.canRemind]).toEqual([true, false]);
    const res = await expectStatus(
      await call('GET', `/api/contractors/${cpPay}/fee-reminder`, owner),
      409,
    );
    expect((await failure(res)).code).toBe('fee_no_debt');
  });

  it('оплата: неверная сумма, дата и строки — 400 с кодом', async () => {
    const post = (body: Record<string, unknown>) =>
      call('POST', `/api/contractors/${cpDebt}/fee-payments`, owner, {
        amount: som(1_000),
        date: '2026-10-18',
        to: 'org',
        ...body,
      });
    await expectStatus(await post({ amount: 0 }), 400);
    expect((await failure(await expectStatus(await post({ date: '2026-10-19' }), 400))).code).toBe(
      'fee_date_future',
    );
    expect(
      (
        await failure(
          await expectStatus(
            await post({ allocation: [{ month: '2026-07', amount: som(40_000) }] }),
            400,
          ),
        )
      ).code,
    ).toBe('fee_row_over_debt');
    expect((await failure(await expectStatus(await post({ to: 'acc:x' }), 400))).code).toBe(
      'fee_to_invalid',
    );
    const res = await expectStatus(
      await call('POST', `/api/contractors/${cpOne}/fee-payments`, owner, {
        amount: som(1_000),
        date: '2026-10-18',
        to: 'org',
      }),
      409,
    );
    expect((await failure(res)).code).toBe('fee_not_accepted');
  });

  it('новая ставка: со следующего месяца, право «Менять журнал тарифов»', async () => {
    const post = (cookie: string, from: string) =>
      call('POST', `/api/contractors/${cpDebt}/tariffs`, cookie, {
        amount: som(35_000),
        period: 'M',
        from,
        note: 'Повышение с ноября',
      });
    expect((await failure(await expectStatus(await post(owner, '2026-10'), 400))).code).toBe(
      'tariff_month_current',
    );
    await expectStatus(await post(acc, '2026-11'), 403);
    await expectStatus(await post(chief, '2026-11'), 201);
    expect((await failure(await expectStatus(await post(owner, '2026-11'), 400))).code).toBe(
      'tariff_month_taken',
    );
    const v = await fees(owner, cpDebt);
    expect(v.tariffs.map((x) => [x.from, x.amount, x.note])).toEqual([
      ['2026-11', som(35_000), 'Повышение с ноября'],
      ['2026-07', som(30_000), ''],
    ]);
    expect(v.debt).toBe(som(120_000));
  });

  it('напоминание в WhatsApp: текст по шаблону, нажатие — в историю', async () => {
    const r = FeeReminder.parse(
      await (
        await expectStatus(await call('GET', `/api/contractors/${cpDebt}/fee-reminder`, chief), 200)
      ).json(),
    );
    expect(r.phone).toBe('+996505890076');
    expect(r.text.replace(/\u00a0/g, ' ')).toBe(
      'Уважаемые ИП Садыкова! Напоминаем об оплате за обслуживание за июль 2026, август 2026, сентябрь 2026, октябрь 2026: 120 000 сом. Просим оплатить до 15.11.2026.',
    );
    await expectStatus(await call('POST', `/api/contractors/${cpDebt}/fee-reminder`, chief), 200);
    await expectStatus(await call('POST', `/api/contractors/${cpDebt}/fee-reminder`, acc), 403);
    const hist = ContractorHistory.parse(
      await (
        await expectStatus(await call('GET', `/api/contractors/${cpDebt}/history`, owner), 200)
      ).json(),
    );
    expect(hist.items.some((h) => h.changes.some((x) => x.field === 'feeReminder'))).toBe(true);
  });

  it('список: «Долг за обслуживание», «Должники», плашка — только тому, кто видит плату', async () => {
    const list = async (cookie: string, query = '') =>
      ContractorList.parse(
        await (
          await expectStatus(await call('GET', `/api/contractors?size=all${query}`, cookie), 200)
        ).json(),
      );
    const all = await list(owner);
    expect(all.items.find((r) => r.id === cpDebt)!.feeDebt).toBe(som(120_000));
    expect(all.items.find((r) => r.id === cpPay)!.feeDebt).toBe(0);
    expect((await list(owner, '&tab=debtors')).items.map((r) => r.id)).toEqual([cpDebt]);
    const s = ContractorSummary.parse(
      await (await expectStatus(await call('GET', '/api/contractors/summary', owner), 200)).json(),
    );
    expect(s.debtors).toEqual({ count: 1, sum: som(120_000) });
    const counts = ContractorTabCounts.parse(
      await (
        await expectStatus(await call('GET', '/api/contractors/tab-counts', owner), 200)
      ).json(),
    );
    expect(counts.debtors).toBe(1);
    // Бухгалтер: ни долга, ни «Должников».
    expect((await list(acc)).items.every((r) => r.feeDebt === null)).toBe(true);
    expect((await list(acc, '&tab=debtors')).items).toEqual([]);
    const sAcc = ContractorSummary.parse(
      await (await expectStatus(await call('GET', '/api/contractors/summary', acc), 200)).json(),
    );
    expect(sAcc.debtors).toBeNull();
    const cAcc = ContractorTabCounts.parse(
      await (await expectStatus(await call('GET', '/api/contractors/tab-counts', acc), 200)).json(),
    );
    expect(cAcc.debtors).toBeNull();
  });

  it('поступление: часть за обслуживание — только тому, кто видит плату', async () => {
    const form = async (cookie: string) =>
      ReceiptForm.parse(
        await (
          await expectStatus(
            await call('GET', `/api/contractors/${cpDebt}/receipt-form`, cookie),
            200,
          )
        ).json(),
      );
    const own = await form(owner);
    expect(own.fee!.months.map((m) => [m.month, m.left])).toEqual([
      ['2026-07', som(30_000)],
      ['2026-08', som(30_000)],
      ['2026-09', som(30_000)],
      ['2026-10', som(30_000)],
    ]);
    expect((await form(acc)).fee).toBeNull();
    const body = {
      total: som(30_000),
      date: '2026-10-18',
      fee: [{ month: '2026-07', amount: som(30_000) }],
    };
    const res = await expectStatus(
      await call('POST', `/api/contractors/${cpDebt}/receipts`, acc, body),
      400,
    );
    expect((await failure(res)).code).toBe('receipt_fee_invalid');
    await expectStatus(await call('POST', `/api/contractors/${cpDebt}/receipts`, owner, body), 201);
    expect((await fees(owner, cpDebt)).debt).toBe(som(90_000));
    // Бухгалтер не видит поступление только за обслуживание и часть за обслуживание в истории.
    const hist = ContractorHistory.parse(
      await (
        await expectStatus(await call('GET', `/api/contractors/${cpDebt}/history`, acc), 200)
      ).json(),
    );
    const fields = hist.items.flatMap((h) => h.changes.map((x) => x.field));
    expect(fields).not.toContain('feeTotal');
    expect(fields).not.toContain('feeReminder');
    expect(fields).not.toContain('tariffAdded');
    expect(hist.items.some((h) => h.entity === 'fee_payment')).toBe(false);
  });

  it('«Платит одной суммой»: меняет тот, кто видит плату', async () => {
    const version = async () =>
      (
        await f.t.admin.db
          .select({ v: schema.contractors.version })
          .from(schema.contractors)
          .where(eq(schema.contractors.id, cpDebt))
      )[0]!.v;
    await expectStatus(
      await call('PATCH', `/api/contractors/${cpDebt}/money-settings`, acc, {
        version: await version(),
        oneSum: true,
      }),
      403,
    );
    await expectStatus(
      await call('PATCH', `/api/contractors/${cpDebt}/money-settings`, owner, {
        version: await version(),
        oneSum: true,
      }),
      200,
    );
    const form = ReceiptForm.parse(
      await (
        await expectStatus(await call('GET', `/api/contractors/${cpDebt}/receipt-form`, owner), 200)
      ).json(),
    );
    expect(form.contractor.oneSum).toBe(true);
  });

  it('файлы оплаты: загружает тот, кто принимает оплату; бухгалтер их не видит', async () => {
    const [p] = await f.t.admin.db
      .select({ id: schema.feePayments.id })
      .from(schema.feePayments)
      .where(eq(schema.feePayments.contractorId, cpPay));
    const source = { kind: 'fee_payment', id: p!.id };
    const start = (cookie: string) =>
      call('POST', '/api/files/uploads', cookie, { name: 'скрин.png', size: 5, source });
    const started = await expectStatus(await start(chief), 201);
    const ticket = FileUploadTicket.parse(await started.json());
    const [row] = await f.t.admin.db
      .select({ key: schema.files.storageKey, type: schema.files.contentType })
      .from(schema.files)
      .where(eq(schema.files.id, ticket.id));
    await (f.deps.storage as MemoryStorage).put(row!.key, new Uint8Array(5), {
      contentType: row!.type,
    });
    await expectStatus(await call('POST', `/api/files/${ticket.id}/complete`, chief), 200);
    expect([403, 404]).toContain((await start(acc)).status);
    expect([403, 404]).toContain(
      (await call('GET', `/api/files?kind=fee_payment&id=${p!.id}`, acc)).status,
    );
  });
});
