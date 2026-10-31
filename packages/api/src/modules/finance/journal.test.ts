import type { MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  ApiError,
  ClosedMonths,
  ContractorFees,
  FeePaymentEditForm,
  FeePaymentForm,
  FeePaymentSaved,
  FeePaymentWindow,
  FileUploadTicket,
  FinSummary,
  listPageSchema,
  BonusRow,
  FinJournalRow,
  OperationEditForm,
  OperationEdited,
  OperationSaved,
  OperationWindow,
  ReceiptEditForm,
  ReceiptJournalRow,
  ReceiptSaved,
  ReportCard,
  ReportList,
} from '@buhuchet/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

/** Сомы в тыйынах. */
const som = (n: number) => n * 100;

const ALL_ON = { files: true, taxpay: true, accounts: true, finops: true, fee: true };

const Journal = listPageSchema(FinJournalRow);
const Receipts = listPageSchema(ReceiptJournalRow);
const Bonuses = listPageSchema(BonusRow);

// Сегодня в тестах — 18.10.2026 (`createTestDeps`).
describe.skipIf(!databaseAvailable())(
  'Журнал операций, «Изменить», окно оплаты за обслуживание и закрытие месяца — методы API (задача 2.22)',
  () => {
    let f: Fixture;
    let owner: string;
    let chief: string;
    let acc: string;
    let hr: string;
    let senior: string;
    let ownerB: string;
    let cpA = '';
    let cpB = '';
    let cpChief = '';

    const employee = (login: string) => f.people[login]!.employeeId;
    const call = (method: 'GET' | 'POST' | 'PUT', path: string, cookie: string, body?: unknown) =>
      apiRequest(f.app, method, path, cookie, body);
    const failure = async (res: Response) => ApiError.parse(await res.json()).error;
    const expectStatus = async (res: Response, status: number) => {
      expect(res.status, await res.clone().text()).toBe(status);
      return res;
    };
    const get = async <T>(cookie: string, path: string, parse: (x: unknown) => T) =>
      parse(await (await expectStatus(await call('GET', path, cookie), 200)).json());
    /** Загрузка файла к записи, как окно: билет, файл в хранилище, «готово». */
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
    const journal = (cookie: string, query = '') =>
      get(cookie, `/api/fin/journal?size=all${query}`, (x) => Journal.parse(x));
    const receipts = (cookie: string, query = '') =>
      get(cookie, `/api/fin/receipts?size=all${query}`, (x) => Receipts.parse(x));
    const summary = (cookie: string) => get(cookie, '/api/fin/summary', (x) => FinSummary.parse(x));
    const feeWindow = (cookie: string, id: string) =>
      get(cookie, `/api/fee-payments/${id}`, (x) => FeePaymentWindow.parse(x));
    const fees = (cookie: string, cp: string) =>
      get(cookie, `/api/contractors/${cp}/fees`, (x) => ContractorFees.parse(x));
    const opWindow = (cookie: string, id: string) =>
      get(cookie, `/api/money-operations/${id}`, (x) => OperationWindow.parse(x));
    const receive = async (cookie: string, cp: string, body: Record<string, unknown>) =>
      ReceiptSaved.parse(
        await (
          await expectStatus(
            await call('POST', `/api/contractors/${cp}/receipts`, cookie, {
              date: '2026-10-17',
              ...body,
            }),
            201,
          )
        ).json(),
      ).id;
    const reportOf = async (cp: string, type: string, periodStart: string) => {
      const list = await get(owner, '/api/reports?size=all&tab=all', (x) => ReportList.parse(x));
      return list.items.find(
        (r) => r.contractor.id === cp && r.type.code === type && r.periodStart === periodStart,
      )!;
    };

    async function contractor(name: string, inn: string, responsible: string, paysTo = 'emp') {
      const [row] = await f.t.admin.db
        .insert(schema.contractors)
        .values({
          orgId: f.a.orgId,
          name,
          inn,
          phone: '+996505890076',
          formCode: 'ФС-01',
          regimeCode: 'РЕЖ-01',
          startDate: '2026-07-01',
          feeDay: 15,
          responsibleEmployeeId: responsible,
          paysTo: paysTo as 'emp' | 'org',
          createdAt: new Date('2026-06-20T10:00:00+06:00'),
        })
        .returning({ id: schema.contractors.id });
      await f.t.admin.db.insert(schema.contractorTariffs).values({
        orgId: f.a.orgId,
        contractorId: row!.id,
        amount: som(30_000),
        period: 'M',
        validFrom: '2026-07-01',
      });
      return row!.id;
    }

    const features = (orgId: string, on: Record<string, boolean>) =>
      f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: on, reportConfirm: false })
        .where(eq(schema.orgSettings.orgId, orgId));

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      await features(f.a.orgId, ALL_ON);
      await features(f.b.orgId, ALL_ON);
      [owner, chief, acc, hr, senior, ownerB] = await Promise.all([
        signIn(f.app, 'owner-a', TEST_PASSWORD),
        signIn(f.app, 'chief-a', TEST_PASSWORD),
        signIn(f.app, 'acc-a', TEST_PASSWORD),
        signIn(f.app, 'hr-a', TEST_PASSWORD),
        signIn(f.app, 'senior-a', TEST_PASSWORD),
        signIn(f.app, 'owner-b', TEST_PASSWORD),
      ]);
      await expectStatus(
        await call('POST', '/api/org-report-types/connect', owner, {
          connect: ['nds'],
          disconnect: [],
        }),
        200,
      );
      cpA = await contractor('ОсОО «Ала-Тоо Трейд»', '03744097401851', employee('acc-a'));
      cpB = await contractor('ОсОО «Бишкек Строй»', '03744097401852', employee('acc-a'));
      cpChief = await contractor('ИП Садыков', '20101199000123', employee('chief-a'), 'org');
      await expectStatus(
        await call('POST', '/api/assignments', owner, {
          contractorId: cpB,
          reportTypeCode: 'nds',
          rate: '12 %',
          fromMonth: '2026-09-01',
          markPast: false,
        }),
        201,
      );
      await receive(owner, cpA, { total: som(1000) });
      await receive(owner, cpChief, { total: som(2000) });
    }, 120_000);

    afterAll(async () => {
      await f?.t.drop();
    });

    it('вход, права, функции и изоляция организаций', async () => {
      expect((await apiRequest(f.app, 'GET', '/api/fin/journal')).status).toBe(401);
      expect((await apiRequest(f.app, 'GET', '/api/fin/bonuses')).status).toBe(401);
      // «Старший»: нет права «Просматривать финансовые операции».
      expect((await call('GET', '/api/fin/journal', senior)).status).toBe(403);
      expect((await call('GET', '/api/fin/summary', senior)).status).toBe(403);
      expect((await call('GET', '/api/fin/receipts', senior)).status).toBe(403);
      // «Главный бухгалтер» без права «Сотрудники и роли» — вкладки «Списания в бонус» нет.
      expect((await call('GET', '/api/fin/bonuses', chief)).status).toBe(403);
      expect((await call('GET', '/api/fin/months', chief)).status).toBe(403);
      // «Бухгалтер» плату не видит: окна оплаты за обслуживание нет.
      expect((await call('GET', `/api/fee-payments/${cpA}`, acc)).status).toBe(403);
      // Другая организация: пусто и 404.
      expect((await journal(ownerB)).total).toBe(0);
      expect((await receipts(ownerB)).total).toBe(0);
      const [opA] = (await journal(owner)).items;
      expect((await call('GET', `/api/money-operations/${opA!.id}/edit-form`, ownerB)).status).toBe(
        404,
      );
      // Модуль выключен в учётной политике — 403 `finops_off`.
      await features(f.a.orgId, { ...ALL_ON, finops: false });
      try {
        const off = await expectStatus(await call('GET', '/api/fin/journal', owner), 403);
        expect((await failure(off)).code).toBe('finops_off');
      } finally {
        await features(f.a.orgId, ALL_ON);
      }
      // Неверная вкладка — 400.
      expect((await call('GET', '/api/fin/journal?tab=x', owner)).status).toBe(400);
    });

    it('(приёмка п. 46) роль с областью «Свои» видит в журнале операции только своих контрагентов', async () => {
      const all = await journal(owner);
      expect(new Set(all.items.map((r) => r.contractor.id))).toEqual(new Set([cpA, cpChief]));
      const own = await journal(acc);
      expect(own.items.map((r) => r.contractor.id)).toEqual([cpA]);
      expect(own.totals).toMatchObject({ amount: som(1000) });
      expect((await receipts(acc)).items.map((r) => r.contractor.id)).toEqual([cpA]);
      // Плашки — по своей области; платы бухгалтер не видит.
      expect(await summary(acc)).toEqual({
        month: '2026-10',
        tax: { received: som(1000), paid: 0 },
        fee: null,
        wo: 0,
      });
      expect((await journal(acc, '&tab=fee')).total).toBe(0);
    });

    it('(приёмка п. 65) оплата за обслуживание: окно, «Изменить» с причиной, было → стало, «Удалить» и «Показать удалённые»', async () => {
      const form = await get(chief, `/api/contractors/${cpChief}/fee-payment-form`, (x) =>
        FeePaymentForm.parse(x),
      );
      const saved = FeePaymentSaved.parse(
        await (
          await expectStatus(
            await call('POST', `/api/contractors/${cpChief}/fee-payments`, chief, {
              amount: som(30_000),
              date: '2026-10-18',
              to: 'org',
              allocation: [{ month: form.months[0]!.month, amount: som(30_000) }],
            }),
            201,
          )
        ).json(),
      );
      const debt = (await fees(chief, cpChief)).debt;
      // Строка журнала «Обслуживание» открывает окно оплаты.
      const row = (await journal(chief, '&tab=fee')).items.find((r) => r.id === saved.id)!;
      expect(row).toMatchObject({
        src: 'fee',
        kind: 'fee',
        amount: som(30_000),
        deleted: false,
        receipt: null,
        locks: { edit: null, del: null },
      });
      expect((await summary(chief)).fee).toBe(som(30_000));
      let w = await feeWindow(chief, saved.id);
      expect(w).toMatchObject({
        amount: som(30_000),
        toOwner: false,
        locks: { edit: null, del: null },
        editReceipt: false,
        deleted: null,
      });

      const edit = await get(chief, `/api/fee-payments/${saved.id}/edit-form`, (x) =>
        FeePaymentEditForm.parse(x),
      );
      expect(edit.edit).toMatchObject({ id: saved.id, version: w.version, to: 'org' });
      const body = {
        version: w.version,
        amount: som(20_000),
        date: '2026-10-18',
        to: 'org',
        allocation: [{ month: form.months[0]!.month, amount: som(20_000) }],
      };
      // Сумма изменилась без причины — не сохраняется.
      const noReason = await expectStatus(
        await call('PUT', `/api/fee-payments/${saved.id}`, chief, body),
        400,
      );
      expect((await failure(noReason)).code).toBe('fee_reason_required');
      expect((await feeWindow(chief, saved.id)).amount).toBe(som(30_000));
      // С причиной — долг пересчитан, в истории было → стало.
      const ok = OperationEdited.parse(
        await (
          await expectStatus(
            await call('PUT', `/api/fee-payments/${saved.id}`, chief, {
              ...body,
              reason: 'Ошибка в сумме',
            }),
            200,
          )
        ).json(),
      );
      expect(ok.changed).toBe(true);
      const after = await fees(chief, cpChief);
      expect(after.debt).toBe(debt + som(10_000));
      // Вкладка «Обслуживание»: у изменённой оплаты — «изменена» (прототип `f.edited`).
      expect(after.payments.find((p) => p.id === saved.id)).toMatchObject({ edited: true });
      w = await feeWindow(chief, saved.id);
      expect(w.edited).toBe(true);
      expect(w.history[0]).toMatchObject({
        action: 'update',
        reason: 'Ошибка в сумме',
        actor: expect.any(String),
      });
      expect(w.history[0]!.changes).toContainEqual({
        field: 'amount',
        from: som(30_000),
        to: som(20_000),
      });
      // Устаревшая версия — «запись изменена другим пользователем».
      const stale = await expectStatus(
        await call('PUT', `/api/fee-payments/${saved.id}`, chief, {
          ...body,
          amount: som(10_000),
          reason: 'ещё',
        }),
        409,
      );
      expect((await failure(stale)).code).toBe('record_changed');

      // «Удалить» с причиной: из итогов уходит, видна с «Показать удалённые».
      expect(
        (await call('POST', `/api/fee-payments/${saved.id}/delete`, chief, { reason: '' })).status,
      ).toBe(400);
      await expectStatus(
        await call('POST', `/api/fee-payments/${saved.id}/delete`, chief, {
          reason: 'Дубль',
        }),
        200,
      );
      expect((await journal(chief, '&tab=fee')).items.map((r) => r.id)).not.toContain(saved.id);
      const withDeleted = await journal(chief, '&tab=fee&deleted=1');
      // Меню удалённой строки — без «Изменить» и «Удалить»: замок «Операция удалена».
      expect(withDeleted.items.find((r) => r.id === saved.id)).toMatchObject({
        deleted: true,
        locks: { edit: { code: 'op_deleted' }, del: { code: 'op_deleted' } },
      });
      expect(withDeleted.totals).toMatchObject({ amount: 0 });
      expect((await summary(chief)).fee).toBe(0);
      expect((await fees(chief, cpChief)).debt).toBe(debt + som(30_000));
      w = await feeWindow(chief, saved.id);
      expect(w.deleted).toMatchObject({ reason: 'Дубль' });
      expect(w.locks.edit).toMatchObject({ code: 'op_deleted' });
      // Удалённую не изменить.
      expect(
        (
          await call('PUT', `/api/fee-payments/${saved.id}`, chief, {
            ...body,
            version: w.version,
            reason: 'x',
          })
        ).status,
      ).toBe(409);
    });

    it('(приёмка п. 66) поступление 15 000, на налоги потрачено 10 000: меньше 10 000 не уменьшить, окно называет оплаты', async () => {
      const nds = await reportOf(cpB, 'nds', '2026-09-01');
      await expectStatus(
        await call('POST', `/api/reports/${nds.id}/amount`, owner, {
          version: nds.version,
          amount: som(10_000),
        }),
        200,
      );
      const id = await receive(acc, cpB, {
        total: som(15_000),
        rows: [{ reportId: nds.id, amount: som(10_000) }],
      });
      const r = await reportOf(cpB, 'nds', '2026-09-01');
      await expectStatus(
        await call('POST', `/api/reports/${nds.id}/payments`, acc, {
          version: r.version,
          amount: som(10_000),
          date: '2026-10-18',
          self: false,
        }),
        200,
      );
      const form = await get(acc, `/api/money-operations/${id}/receipt-form`, (x) =>
        ReceiptEditForm.parse(x),
      );
      expect(form.edit.spent).toMatchObject({ min: som(10_000) });
      expect(form.edit.spent!.payments).toEqual([
        expect.objectContaining({ amount: som(10_000), date: '2026-10-18' }),
      ]);
      expect(form.edit.rows).toEqual([{ reportId: nds.id, amount: som(10_000) }]);
      const put = (total: number, reason?: string, rows = form.edit.rows) =>
        call('PUT', `/api/money-operations/${id}/receipt`, acc, {
          version: form.edit.version,
          total,
          date: '2026-10-17',
          rows,
          holder: form.edit.holder,
          ...(reason ? { reason } : {}),
        });
      const below = await expectStatus(await put(som(9_000), 'Ошибка', []), 400);
      expect((await failure(below)).code).toBe('receipt_min');
      const noReason = await expectStatus(await put(som(12_000)), 400);
      expect((await failure(noReason)).code).toBe('op_reason_required');
      await expectStatus(await put(som(12_000), 'Ошибка в платёжке'), 200);
      const w = await opWindow(acc, id);
      expect(w).toMatchObject({ amount: som(12_000), edited: true });
      const row = (await receipts(acc)).items.find((x) => x.id === id)!;
      expect(row).toMatchObject({ total: som(12_000), spent: som(10_000), edited: true });
      // Меню строки «Журнала поступлений» — с замками, как в журнале (прототип opActs).
      expect(row.locks.edit).toBeNull();
    });

    it('«Изменить» списания в бонус: предел, причина, было → стало; бухгалтеру — только просмотр', async () => {
      const saved = OperationSaved.parse(
        await (
          await expectStatus(
            await call('POST', `/api/contractors/${cpA}/write-offs`, chief, {
              kind: 'bonus',
              amount: som(300),
              date: '2026-10-18',
            }),
            201,
          )
        ).json(),
      );
      const form = await get(chief, `/api/money-operations/${saved.id}/edit-form`, (x) =>
        OperationEditForm.parse(x),
      );
      expect(form).toMatchObject({ kind: 'bonus', amount: som(300), max: som(1000), files: 0 });
      const put = (body: Record<string, unknown>) =>
        call('PUT', `/api/money-operations/${saved.id}`, chief, {
          version: form.version,
          amount: som(400),
          date: '2026-10-18',
          holder: form.holder,
          ...body,
        });
      expect((await failure(await expectStatus(await put({ amount: som(1001) }), 400))).code).toBe(
        'op_free_over',
      );
      expect((await failure(await expectStatus(await put({}), 400))).code).toBe(
        'op_reason_required',
      );
      await expectStatus(await put({ reason: 'Ошибка' }), 200);
      const w = await opWindow(chief, saved.id);
      expect(w).toMatchObject({ amount: som(400), edited: true });
      expect((await failure(await expectStatus(await put({ reason: 'x' }), 409))).code).toBe(
        'record_changed',
      );
      // «Бухгалтер» без права «Списывать остаток в бонус» — только просмотр.
      const view = await expectStatus(
        await call('GET', `/api/money-operations/${saved.id}/edit-form`, acc),
        403,
      );
      expect((await failure(view)).code).toBe('op_view_only');

      // Файлы списания (прототип opWin, opEditDlg «Добавить файлы»): у окна — блок «Файлы», в журнале —
      // число, в окне «Изменить» — «Уже приложено».
      const source = { kind: 'money_operation', id: saved.id };
      await expectStatus(await upload(chief, source, 'приказ.pdf'), 200);
      expect((await opWindow(chief, saved.id)).files).toEqual({ kind: 'money_operation' });
      const row = (await journal(chief, '&tab=wo')).items.find((x) => x.id === saved.id)!;
      expect(row.files).toBe(1);
      const again = await get(chief, `/api/money-operations/${saved.id}/edit-form`, (x) =>
        OperationEditForm.parse(x),
      );
      expect(again.files).toBe(1);
      const history = (await opWindow(chief, saved.id)).history.map((h) => h.action);
      expect(history).toContain('file_attach');
      // Бухгалтер видит окно, но «Изменить» у него заперт — прикрепить нельзя; чужая организация — 404.
      expect((await upload(acc, source, 'x.pdf')).status).toBe(403);
      expect((await upload(ownerB, source, 'x.pdf')).status).toBe(404);
      // В «Файловом менеджере» файлов операций нет — как в прототипе (allFiles).
      const manager = (await (await call('GET', '/api/files/manager?size=all', owner)).json()) as {
        items: { name: string }[];
      };
      expect(manager.items.map((x) => x.name)).not.toContain('приказ.pdf');
    });

    it('«Списания в бонус» и «Закрыть <месяц>»: только прошлый, один раз; в закрытом месяце операции не изменить, не удалить, не перенести в него и оплату не отменить', async () => {
      const list = await get(owner, '/api/fin/bonuses?size=all', (x) => Bonuses.parse(x));
      expect(list.items.map((r) => r.contractor.id)).toEqual([cpA]);
      // «Кадры» с областью «Свои»: своих контрагентов нет — пусто (docs/deviations.md п. В-29).
      expect((await get(hr, '/api/fin/bonuses?size=all', (x) => Bonuses.parse(x))).total).toBe(0);
      let months = await get(owner, '/api/fin/months', (x) => ClosedMonths.parse(x));
      expect(months).toEqual({
        closed: [],
        toClose: '2026-09',
        canClose: true,
        bonuses: { count: 0, amount: 0 },
      });
      // «Кадры» — без права «Списывать остаток в бонус»: закрыть нельзя.
      expect((await get(hr, '/api/fin/months', (x) => ClosedMonths.parse(x))).canClose).toBe(false);
      expect((await call('POST', '/api/fin/months/close', hr, { month: '2026-09' })).status).toBe(
        403,
      );
      expect(
        (await call('POST', '/api/fin/months/close', owner, { month: '2026-08' })).status,
      ).toBe(400);
      await expectStatus(
        await call('POST', '/api/fin/months/close', owner, { month: '2026-09' }),
        200,
      );
      const again = await expectStatus(
        await call('POST', '/api/fin/months/close', owner, { month: '2026-09' }),
        409,
      );
      expect((await failure(again)).code).toBe('month_close_taken');
      months = await get(owner, '/api/fin/months', (x) => ClosedMonths.parse(x));
      expect(months).toMatchObject({ closed: ['2026-09'], canClose: false });
      // Перенести списание в закрытый месяц нельзя.
      const [bonus] = list.items;
      const form = await get(owner, `/api/money-operations/${bonus!.id}/edit-form`, (x) =>
        OperationEditForm.parse(x),
      );
      const moved = await expectStatus(
        await call('PUT', `/api/money-operations/${bonus!.id}`, owner, {
          version: form.version,
          amount: form.amount,
          date: '2026-09-30',
          holder: form.holder,
          reason: 'Перенос',
        }),
        400,
      );
      expect((await failure(moved)).code).toBe('op_date_closed');
      // Меню строки списания закрытого месяца: «Изменить» и «Отменить списание» — с замком.
      await expectStatus(
        await call('POST', `/api/contractors/${cpA}/write-offs`, owner, {
          kind: 'bonus',
          amount: som(1),
          date: '2026-09-30',
        }),
        201,
      );
      const rows = (await get(owner, '/api/fin/bonuses?size=all', (x) => Bonuses.parse(x))).items;
      expect(rows.find((r) => r.date === '2026-09-30')?.locks).toMatchObject({
        edit: { code: 'month_closed' },
        del: { code: 'month_closed' },
      });
      expect(rows.find((r) => r.date === '2026-10-18')?.locks).toEqual({ edit: null, del: null });
      // Оплата налога закрытого месяца: отката нет, под шкалой — почему; сервер тоже не отменяет
      // (прототип scBack('pay') с `no`). Дата оплаты — сентябрьская (поставлена в базе: оплату вносят
      // по сегодняшний день).
      const nds = await reportOf(cpB, 'nds', '2026-09-01');
      await f.t.admin.db
        .update(schema.moneyOperations)
        .set({ opDate: '2026-09-30' })
        .where(
          and(eq(schema.moneyOperations.reportId, nds.id), eq(schema.moneyOperations.kind, 'pay')),
        );
      const card = await get(owner, `/api/reports/${nds.id}`, (x) => ReportCard.parse(x));
      expect(card.money).toMatchObject({ canCancel: false, cancelClosed: '2026-09' });
      const cancel = await expectStatus(
        await call('POST', `/api/reports/${nds.id}/payments/rollback`, owner, {
          version: card.version,
          reason: 'Ошибка',
        }),
        409,
      );
      expect((await failure(cancel)).code).toBe('payment_month_closed');
      // Другая организация своих месяцев не видит.
      expect((await get(ownerB, '/api/fin/months', (x) => ClosedMonths.parse(x))).closed).toEqual(
        [],
      );
    });

    it('«Изменить» и «Удалить»: другая организация и чужой контрагент при области «Свои» — 404', async () => {
      const [bonus] = (await get(owner, '/api/fin/bonuses?size=all', (x) => Bonuses.parse(x)))
        .items;
      const receiptChief = (await receipts(owner)).items.find(
        (r) => r.contractor.id === cpChief && !r.deleted,
      )!;
      const fee = (await journal(owner, '&tab=fee&deleted=1')).items[0]!;
      const reason = { reason: 'x' };
      const op = await get(owner, `/api/money-operations/${bonus!.id}/edit-form`, (x) =>
        OperationEditForm.parse(x),
      );
      const opBody = {
        version: op.version,
        amount: op.amount,
        date: op.date,
        holder: op.holder,
        ...reason,
      };
      for (const [method, path, body] of [
        ['GET', `/api/money-operations/${bonus!.id}/edit-form`, undefined],
        ['PUT', `/api/money-operations/${bonus!.id}`, opBody],
        ['GET', `/api/money-operations/${receiptChief.id}/receipt-form`, undefined],
        [
          'PUT',
          `/api/money-operations/${receiptChief.id}/receipt`,
          { version: 1, total: som(1), date: '2026-10-17', rows: [], holder: 'org', ...reason },
        ],
        ['GET', `/api/fee-payments/${fee.id}`, undefined],
        ['GET', `/api/fee-payments/${fee.id}/edit-form`, undefined],
        [
          'PUT',
          `/api/fee-payments/${fee.id}`,
          { version: 1, amount: som(1), date: '2026-10-18', to: 'org', allocation: [], ...reason },
        ],
        ['POST', `/api/fee-payments/${fee.id}/delete`, reason],
      ] as const) {
        expect((await call(method, path, ownerB, body)).status, `${method} ${path}`).toBe(404);
      }
      // «Бухгалтер» с областью «Свои»: поступление контрагента главного бухгалтера — не найдено.
      expect(
        (await call('GET', `/api/money-operations/${receiptChief.id}/receipt-form`, acc)).status,
      ).toBe(404);
      expect(
        (
          await call('PUT', `/api/money-operations/${receiptChief.id}/receipt`, acc, {
            version: 1,
            total: som(1),
            date: '2026-10-17',
            rows: [],
            holder: 'org',
            reason: 'x',
          })
        ).status,
      ).toBe(404);
    });

    it('оплата за обслуживание при разных областях: окно — по «Финансовым операциям», изменить и удалить — только в области «Контрагенты»', async () => {
      const form = await get(chief, `/api/contractors/${cpChief}/fee-payment-form`, (x) =>
        FeePaymentForm.parse(x),
      );
      const saved = FeePaymentSaved.parse(
        await (
          await expectStatus(
            await call('POST', `/api/contractors/${cpChief}/fee-payments`, chief, {
              amount: som(1_000),
              date: '2026-10-18',
              to: 'org',
              allocation: [{ month: form.months[0]!.month, amount: som(1_000) }],
            }),
            201,
          )
        ).json(),
      );
      // «Кадры»: «Видеть плату» и «Менять журнал тарифов», «Финансовые операции» — «Все»,
      // «Контрагенты» — «Свои» (контрагент главного бухгалтера — не свой).
      const hrRole = f.roleIds.hr;
      const hrFin = and(
        eq(schema.roleScopes.roleId, hrRole),
        eq(schema.roleScopes.permGroup, 'fin'),
      );
      await f.t.admin.db.insert(schema.rolePermissions).values(
        (['fee', 'tariff'] as const).map((permissionId) => ({
          orgId: f.a.orgId,
          roleId: hrRole,
          permissionId,
        })),
      );
      await f.t.admin.db.update(schema.roleScopes).set({ scope: 'all' }).where(hrFin);
      try {
        // Окно открывается из журнала, но изменить и удалить нельзя: замок «только просмотр».
        const w = await feeWindow(hr, saved.id);
        expect(w.locks.edit).toMatchObject({ code: 'op_view_only' });
        expect(w.locks.del).toMatchObject({ code: 'op_view_only' });
        expect((await call('GET', `/api/fee-payments/${saved.id}/edit-form`, hr)).status).toBe(404);
        const put = await call('PUT', `/api/fee-payments/${saved.id}`, hr, {
          version: w.version,
          amount: som(500),
          date: '2026-10-18',
          to: 'org',
          allocation: [{ month: form.months[0]!.month, amount: som(500) }],
          reason: 'Ошибка',
        });
        expect(put.status).toBe(404);
        const del = await call('POST', `/api/fee-payments/${saved.id}/delete`, hr, {
          reason: 'Дубль',
        });
        expect(del.status).toBe(404);
        expect((await feeWindow(chief, saved.id)).amount).toBe(som(1_000));
        // Без права «Просматривать финансовые операции» область «Все» этой группы ничего не открывает.
        await f.t.admin.db
          .delete(schema.rolePermissions)
          .where(
            and(
              eq(schema.rolePermissions.roleId, hrRole),
              eq(schema.rolePermissions.permissionId, 'finView'),
            ),
          );
        expect((await call('GET', `/api/fee-payments/${saved.id}`, hr)).status).toBe(404);
      } finally {
        await f.t.admin.db.update(schema.roleScopes).set({ scope: 'own' }).where(hrFin);
        await f.t.admin.db
          .delete(schema.rolePermissions)
          .where(
            and(
              eq(schema.rolePermissions.roleId, hrRole),
              inArray(schema.rolePermissions.permissionId, ['fee', 'tariff', 'finView']),
            ),
          );
        await f.t.admin.db
          .insert(schema.rolePermissions)
          .values({ orgId: f.a.orgId, roleId: hrRole, permissionId: 'finView' });
      }
    });
  },
);
