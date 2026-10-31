import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { formatSomWithUnit } from '@buhuchet/domain';
import {
  ApiError,
  ArchiveContractorsResult,
  ContractorMoney,
  EmployeeAccount,
  OperationSaved,
  OperationWindow,
  ReceiptSaved,
  ReportCard,
  ReportList,
  TaxReminder,
  TransferForm,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

/** Сомы в тыйынах. */
const som = (n: number) => n * 100;

/** M-Bank — код refDB.json. */
const MBANK = 'БНК-13';

// Сегодня в тестах — 18.10.2026 (`createTestDeps`).
describe.skipIf(!databaseAvailable())(
  'Остаток контрагента и окно операции — методы API (задача 2.20)',
  () => {
    let f: Fixture;
    let owner: string;
    let chief: string;
    let acc: string;
    let hr: string;
    let senior: string;
    let ownerB: string;
    let cpA = '';
    let cpOrg = '';
    let cpChief = '';
    let receiptA = '';

    const employee = (login: string) => f.people[login]!.employeeId;
    const call = (method: 'GET' | 'POST' | 'PATCH', path: string, cookie: string, body?: unknown) =>
      apiRequest(f.app, method, path, cookie, body);
    const failure = async (res: Response) => ApiError.parse(await res.json()).error;
    const expectStatus = async (res: Response, status: number) => {
      expect(res.status, await res.clone().text()).toBe(status);
      return res;
    };
    const money = async (cookie: string, cp: string) =>
      ContractorMoney.parse(
        await (
          await expectStatus(await call('GET', `/api/contractors/${cp}/money`, cookie), 200)
        ).json(),
      );
    const opWindow = async (cookie: string, id: string) =>
      OperationWindow.parse(
        await (
          await expectStatus(await call('GET', `/api/money-operations/${id}`, cookie), 200)
        ).json(),
      );
    const account = async (cookie: string, login: string) =>
      EmployeeAccount.parse(
        await (
          await expectStatus(
            await call('GET', `/api/staff/${employee(login)}/account`, cookie),
            200,
          )
        ).json(),
      );
    const receive = async (cookie: string, cp: string, total: number) =>
      ReceiptSaved.parse(
        await (
          await expectStatus(
            await call('POST', `/api/contractors/${cp}/receipts`, cookie, {
              total,
              date: '2026-10-17',
            }),
            201,
          )
        ).json(),
      ).id;
    const writeOff = (cookie: string, cp: string, body: Record<string, unknown>) =>
      call('POST', `/api/contractors/${cp}/write-offs`, cookie, {
        date: '2026-10-18',
        ...body,
      });
    const reportOf = async (cp: string, type: string, periodStart: string) => {
      const res = await expectStatus(
        await call('GET', '/api/reports?size=all&tab=all', owner),
        200,
      );
      return ReportList.parse(await res.json()).items.find(
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
          startDate: '2026-01-15',
          responsibleEmployeeId: responsible,
          paysTo: paysTo as 'emp' | 'org',
        })
        .returning({ id: schema.contractors.id });
      return row!.id;
    }

    beforeAll(async () => {
      f = await createStaffFixture();
      await seedAllPlatformDictionaries(f.t.admin.db);
      const on = { files: true, taxpay: true, accounts: true };
      for (const orgId of [f.a.orgId, f.b.orgId]) {
        await f.t.admin.db
          .update(schema.orgSettings)
          .set({ features: on, reportConfirm: false })
          .where(eq(schema.orgSettings.orgId, orgId));
      }
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
      cpOrg = await contractor('ОсОО «Орг»', '03744097401852', employee('acc-a'), 'org');
      cpChief = await contractor('ИП Садыков', '20101199000123', employee('chief-a'));
      await expectStatus(
        await call('POST', '/api/assignments', owner, {
          contractorId: cpA,
          reportTypeCode: 'nds',
          rate: '12 %',
          fromMonth: '2026-09-01',
          markPast: false,
        }),
        201,
      );
      receiptA = await receive(owner, cpA, som(1000));
    });

    afterAll(async () => {
      await f?.t.drop();
    });

    it('вход, права, область, изоляция и учётная политика', async () => {
      const bonus = { kind: 'bonus', amount: som(1) };
      expect(
        (await apiRequest(f.app, 'POST', `/api/contractors/${cpA}/write-offs`, '', bonus)).status,
      ).toBe(401);
      expect((await apiRequest(f.app, 'GET', `/api/money-operations/${receiptA}`)).status).toBe(
        401,
      );
      // «Старший»: нет прав на деньги, сотрудников и отчёты.
      expect((await writeOff(senior, cpA, bonus)).status).toBe(403);
      expect((await call('GET', `/api/money-operations/${receiptA}`, senior)).status).toBe(403);
      expect((await call('GET', `/api/staff/${employee('acc-a')}/account`, senior)).status).toBe(
        403,
      );
      // «Главный бухгалтер» без права «Управлять сотрудниками» — вкладки «Счёт» нет.
      expect((await call('GET', `/api/staff/${employee('acc-a')}/account`, chief)).status).toBe(
        403,
      );
      // «Бухгалтер»: нет права «Списывать остаток в бонус»; чужой контрагент — 404.
      expect((await writeOff(acc, cpA, bonus)).status).toBe(403);
      expect((await writeOff(acc, cpChief, { kind: 'refund', amount: som(1) })).status).toBe(404);
      // Перевод — только с областью «Все» финансовых операций.
      expect((await call('GET', `/api/contractors/${cpOrg}/transfer-form`, acc)).status).toBe(403);
      // Другая организация — 404.
      expect((await writeOff(ownerB, cpA, bonus)).status).toBe(404);
      expect((await call('GET', `/api/money-operations/${receiptA}`, ownerB)).status).toBe(404);
      expect((await call('GET', `/api/contractors/${cpOrg}/transfer-form`, ownerB)).status).toBe(
        404,
      );
      expect(
        (await call('POST', `/api/money-operations/${receiptA}/delete`, ownerB, { reason: 'x' }))
          .status,
      ).toBe(404);
      expect((await call('GET', `/api/staff/${employee('acc-a')}/account`, ownerB)).status).toBe(
        404,
      );
      expect((await call('GET', '/api/money-operations/nope', owner)).status).toBe(400);
      // «Виртуальные счета» выключены: «Списать в бонус» и вкладки «Счёт» нет.
      await f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: { files: true, taxpay: true, accounts: false } })
        .where(eq(schema.orgSettings.orgId, f.a.orgId));
      expect((await money(owner, cpA)).actions.bonus).toBe(false);
      expect((await writeOff(owner, cpA, bonus)).status).toBe(403);
      const off = await call('GET', `/api/staff/${employee('acc-a')}/account`, owner);
      expect(off.status).toBe(403);
      expect((await failure(off)).code).toBe('accounts_off');
      // «Учёт оплаты налогов» выключен — всё 403.
      await f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: { files: true } })
        .where(eq(schema.orgSettings.orgId, f.a.orgId));
      const taxpayOff = await call('GET', `/api/money-operations/${receiptA}`, owner);
      expect(taxpayOff.status).toBe(403);
      expect((await failure(taxpayOff)).code).toBe('taxpay_off');
      await f.t.admin.db
        .update(schema.orgSettings)
        .set({ features: { files: true, taxpay: true, accounts: true } })
        .where(eq(schema.orgSettings.orgId, f.a.orgId));
    });

    it('(приёмка) списанный в бонус остаток уменьшает остаток контрагента и виден на счёте сотрудника; «Отменить списание» возвращает остаток', async () => {
      let m = await money(owner, cpA);
      expect(m.free).toBe(som(1000));
      expect(m.actions).toEqual({ bonus: true, refund: true, xfer: false });
      expect((await money(acc, cpA)).actions).toEqual({ bonus: false, refund: true, xfer: false });

      const over = await writeOff(chief, cpA, { kind: 'bonus', amount: som(1500) });
      expect(over.status).toBe(400);
      expect(await failure(over)).toMatchObject({
        code: 'writeoff_free_over',
        details: { field: 'amount', amount: formatSomWithUnit(som(1000)) },
      });
      const future = await writeOff(chief, cpA, {
        kind: 'bonus',
        amount: som(1),
        date: '2026-10-19',
      });
      expect(future.status).toBe(400);
      expect((await failure(future)).code).toBe('money_date_future');

      const saved = await expectStatus(
        await writeOff(chief, cpA, {
          kind: 'bonus',
          amount: som(300),
          note: 'Остаток после оплаты налогов',
        }),
        201,
      );
      const bonusId = OperationSaved.parse(await saved.json()).id;
      m = await money(owner, cpA);
      expect(m.free).toBe(som(700));
      expect(m.balance).toMatchObject({ bonus: som(300), available: som(700) });
      expect(m.operations[0]).toMatchObject({
        id: bonusId,
        kind: 'bonus',
        amount: som(300),
        note: 'Остаток после оплаты налогов',
      });
      // Счёт ответственного: поступление 1 000, бонус 300, остаток 700.
      expect(await account(owner, 'acc-a')).toEqual({
        balance: som(700),
        received: som(1000),
        paid: 0,
        bonus: som(300),
        rows: [
          {
            contractorId: cpA,
            name: 'ОсОО «Ала-Тоо Трейд»',
            received: som(1000),
            paid: 0,
            bonus: som(300),
            rest: som(700),
          },
        ],
      });
      // «Кадры» (область «Свои»): суммы только по своим контрагентам (docs/deviations.md п. В-22).
      expect((await account(hr, 'acc-a')).rows).toEqual([]);

      // Окно списания: у «Бухгалтера» — только просмотр; владелец может отменить.
      const viewOnly = await opWindow(acc, bonusId);
      expect(viewOnly).toMatchObject({
        kind: 'bonus',
        amount: som(300),
        holder: { kind: 'employee', name: 'acc-a' },
        locks: { del: { code: 'op_view_only' } },
      });
      const accDelete = await call('POST', `/api/money-operations/${bonusId}/delete`, acc, {
        reason: 'Ошибка',
      });
      expect(accDelete.status).toBe(403);
      expect((await opWindow(owner, bonusId)).locks.del).toBeNull();

      expect(
        (await call('POST', `/api/money-operations/${bonusId}/delete`, chief, { reason: ' ' }))
          .status,
      ).toBe(400);
      await expectStatus(
        await call('POST', `/api/money-operations/${bonusId}/delete`, chief, {
          reason: 'Списали по ошибке',
        }),
        200,
      );
      expect((await money(owner, cpA)).free).toBe(som(1000));
      expect((await account(owner, 'acc-a')).bonus).toBe(0);
      const deleted = await opWindow(owner, bonusId);
      expect(deleted.deleted).toMatchObject({ name: 'chief-a', reason: 'Списали по ошибке' });
      expect(deleted.history.map((h) => h.action)).toEqual(['delete']);
      const twice = await call('POST', `/api/money-operations/${bonusId}/delete`, owner, {
        reason: 'Ещё раз',
      });
      expect(twice.status).toBe(409);
      expect((await failure(twice)).code).toBe('op_deleted');
    });

    it('перевод со счёта организации на счёт ответственного и возврат остатка', async () => {
      await receive(owner, cpOrg, som(2000));
      expect((await money(owner, cpOrg)).actions).toEqual({
        bonus: false,
        refund: true,
        xfer: true,
      });
      // Остаток на счёте организации в бонус не списывается.
      expect((await writeOff(owner, cpOrg, { kind: 'bonus', amount: som(1) })).status).toBe(403);
      const form = TransferForm.parse(
        await (
          await expectStatus(
            await call('GET', `/api/contractors/${cpOrg}/transfer-form`, chief),
            200,
          )
        ).json(),
      );
      expect(form.max).toBe(som(2000));
      expect(form.targets.find((x) => x.id === employee('acc-a'))?.responsible).toBe(true);
      expect(form.targets.map((x) => x.id)).not.toContain(f.a.ownerEmployeeId);
      const transfer = (body: Record<string, unknown>) =>
        call('POST', `/api/contractors/${cpOrg}/transfers`, chief, {
          to: employee('acc-a'),
          date: '2026-10-18',
          ...body,
        });
      const over = await transfer({ amount: som(2500) });
      expect(over.status).toBe(400);
      expect((await failure(over)).code).toBe('xfer_over');
      const toOwner = await transfer({ amount: som(1), to: f.a.ownerEmployeeId });
      expect(toOwner.status).toBe(400);
      expect((await failure(toOwner)).code).toBe('xfer_to_invalid');
      const xferId = OperationSaved.parse(
        await (await expectStatus(await transfer({ amount: som(500) }), 201)).json(),
      ).id;
      const m = await money(owner, cpOrg);
      // Остаток контрагента не меняется: деньги только поменяли счёт.
      expect(m.balance.available).toBe(som(2000));
      expect(m.operations[0]).toMatchObject({ id: xferId, kind: 'xfer', holder: 'acc-a' });
      expect((await account(owner, 'acc-a')).rows.find((r) => r.contractorId === cpOrg)).toEqual({
        contractorId: cpOrg,
        name: 'ОсОО «Орг»',
        received: som(500),
        paid: 0,
        bonus: 0,
        rest: som(500),
      });
      // «Вернуть остаток» — с правом «Учёт денег», в своей области.
      await expectStatus(
        await writeOff(acc, cpOrg, { kind: 'refund', amount: som(200), note: 'Вернули' }),
        201,
      );
      expect((await money(owner, cpOrg)).balance.available).toBe(som(1800));
    });

    it('обратная запись к поступлению: предел «Уменьшить», причина, в окне поступления', async () => {
      const body = { sign: '-', amount: som(2000), date: '2026-10-18', reason: 'Банк вернул' };
      const over = await call('POST', `/api/money-operations/${receiptA}/corrections`, acc, body);
      expect(over.status).toBe(400);
      expect((await failure(over)).code).toBe('correction_minus_over');
      expect(
        (
          await call('POST', `/api/money-operations/${receiptA}/corrections`, acc, {
            ...body,
            reason: '',
          })
        ).status,
      ).toBe(400);
      await expectStatus(
        await call('POST', `/api/money-operations/${receiptA}/corrections`, acc, {
          ...body,
          sign: '+',
          amount: som(100),
        }),
        201,
      );
      const w = await opWindow(owner, receiptA);
      expect(w.kind).toBe('in');
      expect(w.corrections).toMatchObject([
        { amount: som(100), note: 'Банк вернул', deleted: false },
      ]);
      expect((await money(owner, cpA)).balance.available).toBe(som(1100));
      // Обратная запись — только к поступлению.
      const corr = w.corrections[0]!.id;
      expect(
        (await call('POST', `/api/money-operations/${corr}/corrections`, acc, body)).status,
      ).toBe(404);
    });

    it('«Напомнить в WhatsApp» о налоге: текст по шаблону, реквизиты ответственного, запись в историю', async () => {
      const nds = await reportOf(cpA, 'nds', '2026-09-01');
      const card = ReportCard.parse(
        await (await expectStatus(await call('GET', `/api/reports/${nds.id}`, owner), 200)).json(),
      );
      await expectStatus(
        await call('POST', `/api/reports/${nds.id}/amount`, owner, {
          version: card.version,
          amount: som(5000),
        }),
        200,
      );
      const reminder = async (cookie: string) =>
        TaxReminder.parse(
          await (
            await expectStatus(
              await call('GET', `/api/reports/${nds.id}/tax-reminder`, cookie),
              200,
            )
          ).json(),
        );
      let r = await reminder(acc);
      expect(r).toMatchObject({
        contractor: { id: cpA },
        phone: '+996505890076',
        to: 'employee',
        holder: { id: employee('acc-a'), self: true },
        requisites: [],
      });
      expect(r.base).toContain('ОсОО «Ала-Тоо Трейд»');
      // Месяц внутри фразы — строчными, как в прототипе (`phuman`).
      expect(r.base).toContain(' за сентябрь 2026, срок');
      expect(r.base).toContain('{реквизиты}');
      const noReq = await call('POST', `/api/reports/${nds.id}/tax-reminder`, acc);
      expect(noReq.status).toBe(409);
      expect((await failure(noReq)).code).toBe('remind_no_requisites');

      await expectStatus(
        await call('POST', '/api/profile/wallets', acc, {
          kind: 'phone',
          bankCode: null,
          accountNo: null,
          phone: '+996555123456',
          phoneBanks: [MBANK],
          holderName: 'Бухгалтер А.',
          isMain: false,
        }),
        200,
      );
      r = await reminder(owner);
      expect(r.holder?.self).toBe(false);
      expect(r.hidden).toBe(false);
      expect(r.requisites).toMatchObject([{ phone: true, main: true }]);
      // Чужие реквизиты — только владельцу и роли с «Учётом денег» и «Видеть все…» (п. В-1, В-25):
      // «Кадры» с областью «Все» в отчётах видят отчёт, но не реквизиты ответственного.
      const hrReports = and(
        eq(schema.roleScopes.roleId, f.roleIds.hr),
        eq(schema.roleScopes.permGroup, 'reports'),
      );
      await f.t.admin.db.update(schema.roleScopes).set({ scope: 'all' }).where(hrReports);
      r = await reminder(hr);
      expect(r).toMatchObject({ hidden: true, requisites: [], holder: { self: false } });
      const hiddenPost = await call('POST', `/api/reports/${nds.id}/tax-reminder`, hr);
      expect(hiddenPost.status).toBe(409);
      expect((await failure(hiddenPost)).code).toBe('remind_no_requisites');
      await f.t.admin.db.update(schema.roleScopes).set({ scope: 'own' }).where(hrReports);
      // Без телефона контрагента сообщение не отправляется.
      await f.t.admin.db
        .update(schema.contractors)
        .set({ phone: '' })
        .where(eq(schema.contractors.id, cpA));
      expect((await reminder(owner)).phone).toBeNull();
      const noPhone = await call('POST', `/api/reports/${nds.id}/tax-reminder`, owner);
      expect(noPhone.status).toBe(409);
      expect((await failure(noPhone)).code).toBe('remind_no_phone');
      await f.t.admin.db
        .update(schema.contractors)
        .set({ phone: '+996505890076' })
        .where(eq(schema.contractors.id, cpA));
      await expectStatus(await call('POST', `/api/reports/${nds.id}/tax-reminder`, acc), 200);
      const logged = await f.t.admin.db
        .select({ action: schema.auditLog.action })
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.entityId, nds.id), eq(schema.auditLog.action, 'remind')));
      expect(logged).toHaveLength(1);

      // Отчёт без суммы не ждёт оплаты; «Старший» без права на отчёты; другая организация.
      const oct = await reportOf(cpA, 'nds', '2026-10-01');
      const idle = await call('GET', `/api/reports/${oct.id}/tax-reminder`, acc);
      expect(idle.status).toBe(409);
      expect((await failure(idle)).code).toBe('remind_not_waiting');
      expect((await call('GET', `/api/reports/${nds.id}/tax-reminder`, senior)).status).toBe(403);
      expect((await call('GET', `/api/reports/${nds.id}/tax-reminder`, ownerB)).status).toBe(404);
      expect((await call('POST', `/api/reports/${nds.id}/tax-reminder`, ownerB)).status).toBe(404);
    });

    it('остаток при архивировании: сумма и строки окна «Остаток денег у архивных контрагентов»', async () => {
      const cpRest = await contractor('ИП Остаток', '21503198700015', employee('acc-a'));
      await receive(owner, cpRest, som(400));
      const res = await expectStatus(
        await call('POST', '/api/contractors/archive', owner, { ids: [cpRest] }),
        200,
      );
      expect(ArchiveContractorsResult.parse(await res.json()).rest).toEqual({
        total: som(400),
        items: [{ id: cpRest, name: 'ИП Остаток', paysTo: 'emp', holder: 'acc-a', free: som(400) }],
      });
      // У архивного «Списать в бонус» и «Вернуть остаток» — с правом «Распоряжаться остатком».
      expect((await money(owner, cpRest)).actions).toEqual({
        bonus: true,
        refund: true,
        xfer: false,
      });
      expect((await money(chief, cpRest)).actions).toEqual({
        bonus: false,
        refund: false,
        xfer: false,
      });
      expect((await writeOff(chief, cpRest, { kind: 'refund', amount: som(1) })).status).toBe(403);
      await expectStatus(await writeOff(owner, cpRest, { kind: 'bonus', amount: som(400) }), 201);
      expect((await money(owner, cpRest)).free).toBe(0);
    });

    it('остаток при архиве и вкладка «Счёт» — тому, кто видит деньги (docs/deviations.md п. В-22, В-23)', async () => {
      await f.t.admin.db.insert(schema.rolePermissions).values([
        { orgId: f.a.orgId, roleId: f.roleIds.hr, permissionId: 'cpArchive' },
        { orgId: f.a.orgId, roleId: f.roleIds.senior, permissionId: 'cpArchive' },
        { orgId: f.a.orgId, roleId: f.roleIds.senior, permissionId: 'staffView' },
        { orgId: f.a.orgId, roleId: f.roleIds.senior, permissionId: 'staff' },
      ]);
      const archive = async (cookie: string, id: string) =>
        ArchiveContractorsResult.parse(
          await (
            await expectStatus(
              await call('POST', '/api/contractors/archive', cookie, { ids: [id] }),
              200,
            )
          ).json(),
        ).rest;
      const cpHr = await contractor('ИП Кадры', '21503198700023', employee('hr-a'));
      const cpSenior = await contractor('ИП Старший', '21503198700031', employee('senior-a'));
      await receive(owner, cpHr, som(100));
      await receive(owner, cpSenior, som(100));
      // «Кадры»: деньги видят, «Распоряжаться остатком» нет — только сумма, без кнопок.
      expect(await archive(hr, cpHr)).toEqual({ total: som(100), items: null });
      expect((await money(hr, cpHr)).actions).toEqual({ bonus: false, refund: false, xfer: false });
      expect((await writeOff(hr, cpHr, { kind: 'refund', amount: som(1) })).status).toBe(403);
      // «Старший»: прав на деньги нет — остатка в ответе нет, вкладки «Счёт» тоже.
      expect(await archive(senior, cpSenior)).toBeNull();
      expect((await call('GET', `/api/staff/${employee('senior-a')}/account`, senior)).status).toBe(
        403,
      );
    });

    it('область «Свои»: окно, удаление и обратная запись чужого поступления — 404', async () => {
      const chiefReceipt = await receive(owner, cpChief, som(100));
      expect((await call('GET', `/api/money-operations/${chiefReceipt}`, acc)).status).toBe(404);
      expect(
        (await call('POST', `/api/money-operations/${chiefReceipt}/delete`, acc, { reason: 'x' }))
          .status,
      ).toBe(404);
      expect(
        (
          await call('POST', `/api/money-operations/${chiefReceipt}/corrections`, acc, {
            sign: '-',
            amount: som(1),
            date: '2026-10-18',
            reason: 'x',
          })
        ).status,
      ).toBe(404);
      expect((await opWindow(chief, chiefReceipt)).kind).toBe('in');
    });
  },
);
