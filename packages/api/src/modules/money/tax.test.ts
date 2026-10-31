import type { MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  ApiError,
  ContractorHistory,
  ContractorMoney,
  FileManagerList,
  FileUploadTicket,
  PaymentSaved,
  ReceiptForm,
  ReceiptSaved,
  ReportCard,
  ReportList,
  ReportSubmitted,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

/** Сомы в тыйынах. */
const som = (n: number) => n * 100;

// Сегодня в тестах — 18.10.2026 (`createTestDeps`): сентябрьский НДС (срок оплаты 25.10) ждёт оплаты.
describe.skipIf(!databaseAvailable())('Деньги по отчётам — методы API (задача 2.19)', () => {
  let f: Fixture;
  let owner: string;
  let chief: string;
  let acc: string;
  let senior: string;
  let ownerB: string;
  let cpA = '';
  let cpChief = '';

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
  const card = async (cookie: string, id: string) =>
    ReportCard.parse(
      await (await expectStatus(await call('GET', `/api/reports/${id}`, cookie), 200)).json(),
    );
  const reportOf = async (cp: string, type: string, periodStart: string) => {
    const res = await expectStatus(await call('GET', '/api/reports?size=all&tab=all', owner), 200);
    return ReportList.parse(await res.json()).items.find(
      (r) => r.contractor.id === cp && r.type.code === type && r.periodStart === periodStart,
    )!;
  };
  const money = async (cookie: string, cp: string, query = '') =>
    ContractorMoney.parse(
      await (
        await expectStatus(await call('GET', `/api/contractors/${cp}/money${query}`, cookie), 200)
      ).json(),
    );
  const setAmount = async (id: string, amount: number) => {
    const r = await card(owner, id);
    await expectStatus(
      await call('POST', `/api/reports/${id}/amount`, owner, { version: r.version, amount }),
      200,
    );
  };
  const features = (on: Record<string, boolean>) =>
    f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: on })
      .where(eq(schema.orgSettings.orgId, f.a.orgId));
  /** Файл в источник: начать загрузку, положить содержимое, завершить. */
  const upload = async (cookie: string, source: { kind: string; id: string }, name: string) => {
    const started = await call('POST', '/api/files/uploads', cookie, { name, size: 5, source });
    if (started.status !== 201) return started;
    const ticket = FileUploadTicket.parse(await started.json());
    const [row] = await f.t.admin.db
      .select({ key: schema.files.storageKey, type: schema.files.contentType })
      .from(schema.files)
      .where(eq(schema.files.id, ticket.id));
    await (f.deps.storage as MemoryStorage).put(row!.key, new Uint8Array(5), {
      contentType: row!.type,
    });
    return call('POST', `/api/files/${ticket.id}/complete`, cookie);
  };

  async function contractor(orgId: string, name: string, inn: string, responsible: string) {
    const [row] = await f.t.admin.db
      .insert(schema.contractors)
      .values({
        orgId,
        name,
        inn,
        phone: '+996505890076',
        formCode: 'ФС-01',
        regimeCode: 'РЕЖ-01',
        startDate: '2026-01-15',
        responsibleEmployeeId: responsible,
      })
      .returning({ id: schema.contractors.id });
    return row!.id;
  }

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    await f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: { files: true, taxpay: true }, reportConfirm: false })
      .where(eq(schema.orgSettings.orgId, f.a.orgId));
    // У другой организации учёт тоже включён: чужие записи — 404, а не «выключено».
    await f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: { files: true, taxpay: true } })
      .where(eq(schema.orgSettings.orgId, f.b.orgId));
    [owner, chief, acc, senior, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'chief-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'senior-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
    ]);
    await expectStatus(
      await call('POST', '/api/org-report-types/connect', owner, {
        connect: ['nds', 't1m'],
        disconnect: [],
      }),
      200,
    );
    cpA = await contractor(f.a.orgId, 'ОсОО «Ала-Тоо Трейд»', '03744097401851', employee('acc-a'));
    cpChief = await contractor(f.a.orgId, 'ИП Садыков', '20101199000123', employee('chief-a'));
    for (const [cp, type, rate] of [
      [cpA, 'nds', '12 %'],
      [cpA, 't1m', null],
      [cpChief, 'nds', '12 %'],
    ] as const) {
      await expectStatus(
        await call('POST', '/api/assignments', owner, {
          contractorId: cp,
          reportTypeCode: type,
          rate,
          fromMonth: '2026-09-01',
          markPast: false,
        }),
        201,
      );
    }
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('вход, права, область, изоляция и «Учёт оплаты налогов»', async () => {
    const nds = await reportOf(cpA, 'nds', '2026-09-01');
    const pay = { version: nds.version, amount: som(10), date: '2026-10-18', self: true };
    expect((await apiRequest(f.app, 'GET', `/api/contractors/${cpA}/money`)).status).toBe(401);
    expect(
      (await apiRequest(f.app, 'POST', `/api/reports/${nds.id}/payments`, '', pay)).status,
    ).toBe(401);
    // «Старший»: нет «Видеть финансовые операции» и «Учёт денег».
    expect((await call('GET', `/api/contractors/${cpA}/money`, senior)).status).toBe(403);
    expect((await call('POST', `/api/reports/${nds.id}/payments`, senior, pay)).status).toBe(403);
    // «Бухгалтер» (область «Свои»): чужой контрагент — 404, другая организация — 404.
    expect((await call('GET', `/api/contractors/${cpChief}/money`, acc)).status).toBe(404);
    expect((await call('GET', `/api/contractors/${cpChief}/receipt-form`, acc)).status).toBe(404);
    expect((await call('GET', `/api/contractors/${cpA}/money`, ownerB)).status).toBe(404);
    expect((await call('POST', `/api/reports/${nds.id}/payments`, ownerB, pay)).status).toBe(404);
    expect(
      (
        await call('POST', `/api/contractors/${cpA}/receipts`, ownerB, {
          total: som(1),
          date: '2026-10-18',
        })
      ).status,
    ).toBe(404);
    expect((await money(acc, cpA)).contractor.id).toBe(cpA);
    // Отчёт чужого контрагента своей организации: оплата, её отмена и настройки денег — 404.
    const other = await reportOf(cpChief, 'nds', '2026-09-01');
    const otherPay = { ...pay, version: other.version };
    expect((await call('POST', `/api/reports/${other.id}/payments`, acc, otherPay)).status).toBe(
      404,
    );
    const cpVersion = (await money(owner, cpChief)).contractor.version;
    const settings = { version: cpVersion, needReceiptFile: true };
    expect(
      (await call('PATCH', `/api/contractors/${cpChief}/money-settings`, acc, settings)).status,
    ).toBe(404);
    // Область «Финансовые операции — Все» не открывает чужую карточку: настройки денег — по области
    // «Контрагенты», как «Изменить» (у «Кадров» — «Создавать и изменять контрагентов», «Свои»).
    await f.t.admin.db
      .update(schema.roleScopes)
      .set({ scope: 'all' })
      .where(
        and(eq(schema.roleScopes.roleId, f.roleIds.hr), eq(schema.roleScopes.permGroup, 'fin')),
      );
    await f.t.admin.db
      .insert(schema.rolePermissions)
      .values({ orgId: f.a.orgId, roleId: f.roleIds.hr, permissionId: 'rollback' });
    const hr = await signIn(f.app, 'hr-a', TEST_PASSWORD);
    expect(
      (await call('PATCH', `/api/contractors/${cpChief}/money-settings`, hr, settings)).status,
    ).toBe(404);
    // Отмена оплаты — ещё и по области «Отчёты» («Свои»): чужой отчёт — 404.
    expect(
      (
        await call('POST', `/api/reports/${other.id}/payments/rollback`, hr, {
          version: other.version,
          reason: 'Ошибка',
        })
      ).status,
    ).toBe(404);
    expect((await money(owner, cpChief)).contractor).toMatchObject({
      version: cpVersion,
      needReceiptFile: false,
    });
    // Неверное тело — 400.
    for (const body of [
      { total: 0, date: '2026-10-18' },
      { total: som(1), date: '18.10.2026' },
      { total: som(1), date: '2026-10-18', rows: [{ reportId: 'x', amount: 1 }] },
      { total: som(1), date: '2026-10-18', extra: 1 },
    ]) {
      expect((await call('POST', `/api/contractors/${cpA}/receipts`, acc, body)).status).toBe(400);
    }
    expect(
      (await call('POST', `/api/reports/${nds.id}/payments`, acc, { ...pay, amount: -1 })).status,
    ).toBe(400);
    expect((await call('GET', `/api/contractors/${cpA}/money?month=2026-01`, acc)).status).toBe(
      400,
    );
    // «Учёт оплаты налогов» выключен — 403 и в карточке денег нет.
    await features({ files: true });
    try {
      const off = await call('GET', `/api/contractors/${cpA}/money`, owner);
      expect(off.status).toBe(403);
      expect((await failure(off)).code).toBe('taxpay_off');
      expect((await call('POST', `/api/reports/${nds.id}/payments`, owner, pay)).status).toBe(403);
      // Без учёта — только график оплаты (прототип report-card.js), денег и действий нет.
      const c = await card(owner, nds.id);
      expect(c).toMatchObject({
        taxpay: false,
        payFirst: false,
        money: {
          available: null,
          payments: [],
          canPay: false,
          canReceive: false,
          canCancel: false,
        },
      });
      expect(c.money?.schedule).toHaveLength(1);
    } finally {
      await features({ files: true, taxpay: true });
    }
  });

  it('п. 69, 73: поступление, оплата деньгами контрагента, «Оплатил сам», «Сдан» после оплаты', async () => {
    const nds = await reportOf(cpA, 'nds', '2026-09-01');
    await setAmount(nds.id, som(5000));
    const row = await reportOf(cpA, 'nds', '2026-09-01');
    expect(row).toMatchObject({
      amount: som(5000),
      received: 0,
      paid: 0,
      paymentStatus: 'unpaid',
      funds: { state: 'short', need: som(5000), short: som(5000) },
    });
    let c = await card(acc, nds.id);
    expect(c).toMatchObject({ taxpay: true, payFirst: true });
    expect(c.money).toMatchObject({
      available: 0,
      canPay: true,
      canReceive: true,
      canCancel: false,
    });
    // «Сдан» без оплаты: сумма сохранена, статус прежний.
    const submitted = await expectStatus(
      await call('POST', `/api/reports/${nds.id}/submit`, acc, {
        version: c.version,
        date: '2026-10-18',
        amount: som(5000),
      }),
      200,
    );
    expect(ReportSubmitted.parse(await submitted.json()).waitsPayment).toEqual({
      amount: som(5000),
      paid: 0,
    });
    expect((await card(acc, nds.id)).status).toBe('todo');

    // п. 73: у контрагента 1 000 — денег не хватает, «Оплатил контрагент сам».
    const form = ReceiptForm.parse(
      await (
        await expectStatus(await call('GET', `/api/contractors/${cpA}/receipt-form`, acc), 200)
      ).json(),
    );
    expect(form.rows.map((r) => r.reportId)).toContain(nds.id);
    const receipt = await expectStatus(
      await call('POST', `/api/contractors/${cpA}/receipts`, acc, {
        total: som(1000),
        date: '2026-10-17',
        rows: [{ reportId: nds.id, amount: som(1000) }],
      }),
      201,
    );
    const receiptId = ReceiptSaved.parse(await receipt.json()).id;
    c = await card(acc, nds.id);
    expect(c.money!.available).toBe(som(1000));
    const short = await call('POST', `/api/reports/${nds.id}/payments`, acc, {
      version: c.version,
      amount: som(5000),
      date: '2026-10-18',
      self: false,
    });
    expect(short.status).toBe(409);
    expect(await failure(short)).toMatchObject({
      code: 'payment_not_enough',
      details: { field: 'amount', variant: 'short' },
    });
    // Дата позже сегодня — 400 с полем.
    const future = await call('POST', `/api/reports/${nds.id}/payments`, acc, {
      version: c.version,
      amount: som(5000),
      date: '2026-10-19',
      self: true,
    });
    expect(future.status).toBe(400);
    expect((await failure(future)).details).toMatchObject({ field: 'date' });
    const self = await expectStatus(
      await call('POST', `/api/reports/${nds.id}/payments`, acc, {
        version: c.version,
        amount: som(5000),
        date: '2026-10-18',
        self: true,
      }),
      200,
    );
    const paid = PaymentSaved.parse(await self.json());
    const after = await reportOf(cpA, 'nds', '2026-09-01');
    // «Получено» отчёта — его деньги, оплаченные и отложенные под него; «оплатил сам» сюда не входит, а
    // отложенная 1 000 освободилась: отчёт оплачен (прототип derive.js, r.got).
    expect(after).toMatchObject({
      paid: som(5000),
      selfPaid: som(5000),
      received: 0,
      paymentStatus: 'paid',
    });
    const m = await money(acc, cpA);
    // Получено и деньги контрагента не изменились: оплатил сам.
    expect(m.balance).toMatchObject({
      received: som(1000),
      selfPaid: som(5000),
      available: som(1000),
    });
    expect(m.operations.map((o) => o.kind)).toEqual(['pay', 'in']);
    // Устаревшая версия — 409 «запись изменена».
    const stale = await call('POST', `/api/reports/${nds.id}/payments`, acc, {
      version: c.version,
      amount: som(1),
      date: '2026-10-18',
      self: true,
    });
    expect(stale.status).toBe(409);

    // Файлы: скрин к поступлению и платёжка к оплате — в Файловом менеджере со своими источниками.
    await expectStatus(await upload(acc, { kind: 'receipt', id: receiptId }, 'скрин.png'), 200);
    await expectStatus(
      await upload(acc, { kind: 'tax_payment', id: paid.operationId }, 'пп.pdf'),
      200,
    );
    expect((await upload(ownerB, { kind: 'receipt', id: receiptId }, 'x.png')).status).toBe(404);
    // Без права «Загружать файлы» — 403.
    expect((await upload(senior, { kind: 'receipt', id: receiptId }, 'x.png')).status).toBe(403);
    const manager = FileManagerList.parse(
      await (await call('GET', '/api/files/manager?size=all', acc)).json(),
    ).items;
    expect(manager.find((x) => x.name === 'скрин.png')).toMatchObject({ kind: 'receipt' });
    expect(manager.find((x) => x.name === 'пп.pdf')).toMatchObject({ kind: 'tax_payment' });
    c = await card(acc, nds.id);
    expect(c.money!.payments).toEqual([
      expect.objectContaining({
        amount: som(5000),
        self: true,
        file: expect.objectContaining({ name: 'пп.pdf' }),
      }),
    ]);

    // Оплачено — «Сдан» ставится.
    await expectStatus(
      await call('POST', `/api/reports/${nds.id}/submit`, acc, {
        version: c.version,
        date: '2026-10-18',
      }),
      200,
    );
    expect((await card(acc, nds.id)).status).toBe('submitted');
  });

  it('откат оплаты: право «Откат статусов» и причина; деньги контрагента возвращаются', async () => {
    const nds = await reportOf(cpChief, 'nds', '2026-09-01');
    await setAmount(nds.id, som(3000));
    await expectStatus(
      await call('POST', `/api/contractors/${cpChief}/receipts`, chief, {
        total: som(3000),
        date: '2026-10-18',
        rows: [{ reportId: nds.id, amount: som(3000) }],
      }),
      201,
    );
    let c = await card(chief, nds.id);
    expect(c.money).toMatchObject({ available: som(3000), canPay: true, canCancel: false });
    await expectStatus(
      await call('POST', `/api/reports/${nds.id}/payments`, chief, {
        version: c.version,
        amount: som(3000),
        date: '2026-10-18',
        self: false,
      }),
      200,
    );
    expect((await money(chief, cpChief)).balance.available).toBe(0);
    c = await card(owner, nds.id);
    expect(c.money!.canCancel).toBe(true);
    // Главный бухгалтер без «Откат статусов» — 403; без причины — 400.
    expect(
      (
        await call('POST', `/api/reports/${nds.id}/payments/rollback`, chief, {
          version: c.version,
          reason: 'ошибка',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('POST', `/api/reports/${nds.id}/payments/rollback`, owner, {
          version: c.version,
          reason: ' ',
        })
      ).status,
    ).toBe(400);
    await expectStatus(
      await call('POST', `/api/reports/${nds.id}/payments/rollback`, owner, {
        version: c.version,
        reason: 'ошибка в сумме',
      }),
      200,
    );
    c = await card(owner, nds.id);
    expect(c).toMatchObject({ paid: 0, paymentStatus: 'unpaid' });
    expect(c.money!.payments[0]!.cancelled).toMatchObject({ reason: 'ошибка в сумме' });
    expect((await money(owner, cpChief)).balance.available).toBe(som(3000));
    const none = await call('POST', `/api/reports/${nds.id}/payments/rollback`, owner, {
      version: c.version,
      reason: 'ещё раз',
    });
    expect((await failure(none)).code).toBe('payment_none');
  });

  it('«Файл при поступлении» и «Деньги на налоги переводит»: право, версия, обязательный файл', async () => {
    let m = await money(owner, cpChief);
    const body = { version: m.contractor.version, needReceiptFile: true };
    expect(
      (await call('PATCH', `/api/contractors/${cpChief}/money-settings`, senior, body)).status,
    ).toBe(403);
    expect(
      (
        await call('PATCH', `/api/contractors/${cpChief}/money-settings`, owner, {
          version: m.contractor.version,
        })
      ).status,
    ).toBe(400);
    await expectStatus(
      await call('PATCH', `/api/contractors/${cpChief}/money-settings`, owner, body),
      200,
    );
    expect(
      (await call('PATCH', `/api/contractors/${cpChief}/money-settings`, owner, body)).status,
    ).toBe(409);
    const noFile = await call('POST', `/api/contractors/${cpChief}/receipts`, chief, {
      total: som(100),
      date: '2026-10-18',
    });
    expect(noFile.status).toBe(400);
    expect(await failure(noFile)).toMatchObject({
      code: 'receipt_file_required',
      details: { field: 'files' },
    });
    m = await money(owner, cpChief);
    expect(m.contractor).toMatchObject({ needReceiptFile: true, paysTo: 'emp' });
    await expectStatus(
      await call('PATCH', `/api/contractors/${cpChief}/money-settings`, owner, {
        version: m.contractor.version,
        paysTo: 'org',
      }),
      200,
    );
    expect((await money(owner, cpChief)).contractor.paysTo).toBe('org');
    // Карточка контрагента отдаёт отметку файла для «Основного».
    const cpCard = await expectStatus(await call('GET', `/api/contractors/${cpChief}`, owner), 200);
    expect(await cpCard.json()).toMatchObject({ needReceiptFile: true, paysTo: 'org' });
  });

  it('контрагента с деньгами нельзя удалить — только в архив (has_money); поступление — в истории', async () => {
    const cpNew = await contractor(
      f.a.orgId,
      'ОсОО «Аванс»',
      '01234567890123',
      employee('senior-a'),
    );
    await expectStatus(
      await call('POST', `/api/contractors/${cpNew}/receipts`, owner, {
        total: som(500),
        date: '2026-10-18',
      }),
      201,
    );
    const res = await call('DELETE', `/api/contractors/${cpNew}`, owner);
    expect(res.status).toBe(409);
    expect(await failure(res)).toMatchObject({
      code: 'contractor_in_use',
      details: { variant: 'has_money' },
    });
    // История контрагента: поступление видно с правом на деньги, без него — нет.
    const entities = async (cookie: string) =>
      ContractorHistory.parse(
        await (
          await expectStatus(await call('GET', `/api/contractors/${cpNew}/history`, cookie), 200)
        ).json(),
      ).items.map((h) => h.entity);
    expect(await entities(owner)).toContain('money_operation');
    expect(await entities(senior)).not.toContain('money_operation');
  });

  it('статистический отчёт отмечается «Сдан» сразу (п. 69)', async () => {
    const t1 = await reportOf(cpA, 't1m', '2026-09-01');
    const res = await expectStatus(
      await call('POST', `/api/reports/${t1.id}/submit`, acc, {
        version: t1.version,
        date: '2026-10-18',
      }),
      200,
    );
    expect(ReportSubmitted.parse(await res.json()).waitsPayment).toBeNull();
    expect((await card(acc, t1.id)).money).toBeNull();
  });
});
