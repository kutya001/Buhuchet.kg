import { formatText, UI_TEXTS, type Translate } from '@buhuchet/domain';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from './context';
import { contractorScope, createContractor, type ContractorFields } from './contractors';
import { insertReceiptFeePayments } from './fees';
import {
  contractorFunds,
  correctReceipt,
  deleteOperation,
  employeeAccountOf,
  lockOperation,
  operationCard,
  orgHeldOf,
  transferTargets,
  transferToEmployee,
  writeOff,
} from './finance';
import { readHistory } from './history';
import {
  contractorBalance,
  createReceipt,
  lockMoneyContractor,
  payReport,
  syncMoneyHolders,
  type ReceiptInput,
} from './money-tax';
import { createOrganization, type CreatedOrganization } from './organizations';
import { submitReport } from './report-submit';
import {
  createAssignment,
  createRevision,
  type AssignmentInput,
  type AssignmentTexts,
} from './reports';
import { feePayments, moneyOperations, reports } from './schema';
import { readSpecJson } from './spec-data';
import { seedPermissions, seedRoleTemplates } from './seed';
import { createEmployee } from './staff';
import {
  createTestDatabase,
  databaseAvailable,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

/*
 * Остаток контрагента и окно операции (задача 2.20): списание в бонус и его отмена, возврат, перевод на
 * счёт сотрудника, обратная запись, удаление операций, возврат по уточнённому расчёту, счёт сотрудника;
 * изоляция организаций.
 */

const TODAY = '2026-10-28';
const t: Translate = (key, params) => formatText(UI_TEXTS[key].ru, params);
const som = (v: number) => v * 100;
const refused = (code: string, status = 409) =>
  expect.objectContaining({ name: 'MoneyRefusedError', code, status });
const notFound = expect.objectContaining({ name: 'RecordNotFoundError' });
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});

const TEXTS: AssignmentTexts = {
  ended: 'Назначение снято',
  restored: 'Назначено снова',
  until: 'Позже «до какого периода»',
  past: 'Создан за прошлый период при назначении',
  pastMarked: 'Создан за прошлый период и отмечен сданным при назначении',
  pastConfirmed: 'Создан за прошлый период и отмечен сданным и подтверждённым при назначении',
  pastConfirmNote: 'Прошлый период отмечен при назначении',
  ownRuleChanged: 'В назначении изменены периодичность или срок — отчёт создан заново',
};

const assignment = (patch: Partial<AssignmentInput> = {}): AssignmentInput => ({
  fromMonth: '2026-08-01',
  untilMonth: null,
  responsibleEmployeeId: null,
  rate: '12 %',
  enRates: [],
  rateAdditions: [],
  dueDay: null,
  ownPeriod: null,
  ownDay: null,
  ownMonth: null,
  fixedAmount: null,
  note: '',
  ...patch,
});

const fields = (patch: Partial<ContractorFields> = {}): ContractorFields => ({
  name: 'ОсОО «Ала-Тоо Трейд»',
  inn: '03744097401851',
  phone: '+996505890076',
  kind: 'regular',
  formCode: 'ФС-01',
  regimeCode: 'РЕЖ-01',
  regime2Code: null,
  gked: '46.34.0',
  gkedExtra: [],
  taxOfficeCode: null,
  bizSize: 'small',
  benefits: [],
  bases: [],
  responsibleEmployeeId: null,
  head: '',
  contact: '',
  contractNo: '',
  contractDate: null,
  note: '',
  registration: {},
  startDate: '2024-07-16',
  firstMonthMode: 'full',
  feeDay: 15,
  paysTo: 'emp',
  gkedConfirmation: null,
  socfundFlags: {},
  socfundTariff: null,
  ...patch,
});

describe.skipIf(!databaseAvailable())(
  'Остаток контрагента, счёт сотрудника и окно операции',
  () => {
    let db: TestDatabase;
    let a: CreatedOrganization;
    let b: CreatedOrganization;
    let accA = '';
    let ownerEmp = '';
    let accUser = '';
    /** Переводит деньги ответственному (Алишер Т.). */
    let cpEmp = '';
    /** Переводит деньги на счёт организации, ответственный — Алишер Т. */
    let cpOrg = '';
    /** Переводит деньги ответственному, но ответственного нет. */
    let cpNone = '';
    /** Для уточнённого отчёта. */
    let cpRev = '';
    /** Для удаления поступления и оплаты. */
    let cpPay = '';
    const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
      withOrgContext(db.app.db, { orgId: a.orgId, userId: accUser }, fn);
    const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
      withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId } as OrgContext, fn);
    const reportOf = async (contractorId: string, periodStart: string) => {
      const [r] = await inA((tx) =>
        tx
          .select()
          .from(reports)
          .where(
            and(
              eq(reports.contractorId, contractorId),
              eq(reports.reportTypeCode, 'nds'),
              eq(reports.periodStart, periodStart),
              eq(reports.superseded, false),
            ),
          ),
      );
      return r!;
    };
    const setAmount = (id: string, amount: number | null) =>
      inA((tx) => tx.update(reports).set({ amount }).where(eq(reports.id, id)));
    const receipt = (contractorId: string, patch: Partial<ReceiptInput>) =>
      inA((tx) =>
        createReceipt(
          tx,
          contractorId,
          { total: 0, date: TODAY, rows: [], files: 0, ...patch },
          { today: TODAY, scope: undefined, filesOn: false, t },
        ),
      );
    const pay = async (id: string, amount: number) => {
      const [r] = await inA((tx) => tx.select().from(reports).where(eq(reports.id, id)));
      return inA((tx) =>
        payReport(
          tx,
          id,
          { version: r!.version, amount, date: TODAY, self: false },
          { today: TODAY, scope: undefined, finScope: undefined },
        ),
      );
    };
    const writeOffIn = (
      contractorId: string,
      kind: 'bonus' | 'refund',
      amount: number,
      date = TODAY,
    ) =>
      inA(async (tx) =>
        writeOff(
          tx,
          await lockMoneyContractor(tx, contractorId, undefined),
          { kind, amount, date, note: kind === 'bonus' ? 'Остаток после оплаты налогов' : '' },
          { today: TODAY },
        ),
      );
    const remove = (id: string, reason = 'Внесли по ошибке') =>
      inA(async (tx) =>
        deleteOperation(tx, await lockOperation(tx, id, undefined), reason, {
          scope: undefined,
          t,
        }),
      );
    const funds = (contractorId: string) => inA((tx) => contractorFunds(tx, contractorId));

    beforeAll(async () => {
      db = await createTestDatabase();
      const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
      await seedPermissions(db.admin.db, refDB.permissions, { update: false });
      await seedRoleTemplates(db.admin.db, refDB.roleTemplates, { update: false });
      await seedAllPlatformDictionaries(db.admin.db);
      const owner = (login: string) => ({ fullName: 'Владелец', login, passwordHash: 'x' });
      a = await createOrganization(db.app.db, {
        name: 'Организация А',
        inn: '01811201810466',
        slug: 'fin-a',
        owner: owner('fin-owner-a'),
      });
      b = await createOrganization(db.app.db, {
        name: 'Организация Б',
        inn: '02811201810467',
        slug: 'fin-b',
        owner: owner('fin-owner-b'),
      });
      const role = a.roles.find((r) => r.templateCode === 'acc')!;
      const asOwner = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
        withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
      accA = await asOwner((tx) =>
        createEmployee(tx, {
          fullName: 'Токтогулов Алишер Бакытович',
          shortName: 'Алишер Т.',
          login: 'fin-acc-a',
          passwordHash: 'x',
          phone: null,
          role,
        }),
      );
      const ids = await asOwner((tx) =>
        tx.execute<{ id: string; user_id: string }>(sql`select id, user_id from employees`),
      );
      accUser = ids.find((e) => e.id === accA)!.user_id;
      ownerEmp = ids.find((e) => e.user_id === a.ownerUserId)!.id;
      cpEmp = await inA((tx) =>
        createContractor(tx, a.orgId, fields({ responsibleEmployeeId: accA }), null),
      );
      cpOrg = await inA((tx) =>
        createContractor(
          tx,
          a.orgId,
          fields({
            name: 'ИП Садыкова',
            inn: '21503198700015',
            paysTo: 'org',
            responsibleEmployeeId: accA,
          }),
          null,
        ),
      );
      cpNone = await inA((tx) =>
        createContractor(
          tx,
          a.orgId,
          fields({ name: 'ОсОО «Без ответственного»', inn: '01503198700016' }),
          null,
        ),
      );
      cpRev = await inA((tx) =>
        createContractor(
          tx,
          a.orgId,
          fields({ name: 'ОсОО «Уточнение»', inn: '01503198700017', responsibleEmployeeId: accA }),
          null,
        ),
      );
      cpPay = await inA((tx) =>
        createContractor(
          tx,
          a.orgId,
          fields({ name: 'ОсОО «Оплата»', inn: '01503198700018', responsibleEmployeeId: accA }),
          null,
        ),
      );
      for (const contractorId of [cpEmp, cpOrg, cpRev, cpPay]) {
        await inA((tx) =>
          createAssignment(
            tx,
            { ...assignment(), contractorId, reportTypeCode: 'nds' },
            { today: TODAY, scope: undefined, markPast: false, confirm: false, texts: TEXTS },
          ),
        );
      }
    });

    afterAll(async () => {
      await db?.drop();
    });

    it('проверка задачи: списанный в бонус остаток уменьшает остаток контрагента и виден на счёте сотрудника; «Отменить списание» его возвращает', async () => {
      const sep = await reportOf(cpEmp, '2026-09-01');
      await setAmount(sep.id, som(1_000));
      await receipt(cpEmp, { total: som(1_500), rows: [{ reportId: sep.id, amount: som(1_000) }] });
      expect(await funds(cpEmp)).toMatchObject({ available: som(1_500), free: som(500) });
      // Больше свободного остатка — нельзя: 1 000 нужны на неоплаченный НДС.
      await expect(writeOffIn(cpEmp, 'bonus', som(600))).rejects.toEqual(
        refused('writeoff_free_over', 400),
      );
      await expect(writeOffIn(cpEmp, 'bonus', som(100), '2026-10-29')).rejects.toEqual(
        refused('money_date_future', 400),
      );
      const { id } = await writeOffIn(cpEmp, 'bonus', som(200));
      expect(await funds(cpEmp)).toMatchObject({ available: som(1_300), free: som(300) });
      expect((await inA((tx) => contractorBalance(tx, cpEmp))).bonus).toBe(som(200));
      const acc = await inA((tx) => employeeAccountOf(tx, accA, undefined));
      expect(acc.account).toMatchObject({
        received: som(1_500),
        bonus: som(200),
        balance: som(1_300),
      });
      expect(acc.contractors).toEqual([{ id: cpEmp, name: 'ОсОО «Ала-Тоо Трейд»' }]);
      expect(await inA((tx) => readHistory(tx, 'money_operation', id))).toMatchObject([
        {
          action: 'create',
          contractorId: cpEmp,
          changes: [
            { field: 'kind', to: 'bonus' },
            { field: 'amount', to: som(200) },
            { field: 'opDate', to: TODAY },
            { field: 'note', to: 'Остаток после оплаты налогов' },
          ],
        },
      ]);
      // «Отменить списание»: сумма снова свободна, бонус сотрудника уменьшился, запись осталась с причиной.
      await remove(id, 'Списали не тому контрагенту');
      expect(await funds(cpEmp)).toMatchObject({ available: som(1_500), free: som(500) });
      expect((await inA((tx) => employeeAccountOf(tx, accA, undefined))).account.bonus).toBe(0);
      const card = await inA((tx) => operationCard(tx, id, undefined, t));
      expect(card?.op).toMatchObject({
        kind: 'bonus',
        cancelReason: 'Списали не тому контрагенту',
      });
      expect(card?.cancelledName).toBe('Алишер Т.');
      expect(card?.history[0]).toMatchObject({
        action: 'delete',
        reason: 'Списали не тому контрагенту',
      });
      await expect(remove(id)).rejects.toEqual(refused('op_deleted'));
    });

    it('остаток на счёте организации в бонус не списывается; возврат контрагенту — с любого счёта', async () => {
      await receipt(cpOrg, { total: som(800) });
      await expect(writeOffIn(cpOrg, 'bonus', som(100))).rejects.toEqual(refused('writeoff_org'));
      // Без ответственного деньги на счёте организации (п. В-15) — бонуса тоже нет.
      await receipt(cpNone, { total: som(100) });
      await expect(writeOffIn(cpNone, 'bonus', som(50))).rejects.toEqual(refused('writeoff_org'));
      const { id } = await writeOffIn(cpOrg, 'refund', som(300));
      expect(await funds(cpOrg)).toMatchObject({ available: som(500), orgHeld: som(500) });
      await remove(id);
      expect(await funds(cpOrg)).toMatchObject({ available: som(800), orgHeld: som(800) });
    });

    it('перевод со счёта организации на счёт сотрудника: остаток не меняется, удаление возвращает деньги', async () => {
      const before = await funds(cpOrg);
      const lock = (contractorId: string) => (tx: Parameters<typeof lockMoneyContractor>[0]) =>
        lockMoneyContractor(tx, contractorId, undefined);
      const xfer = (contractorId: string, to: string, amount: number) =>
        inA(async (tx) =>
          transferToEmployee(
            tx,
            await lock(contractorId)(tx),
            { to, amount, date: TODAY, note: 'Для оплаты Соцфонда' },
            { today: TODAY, t },
          ),
        );
      // «Кому» — активные сотрудники, кроме владельца.
      expect((await inA((tx) => transferTargets(tx))).map((e) => e.id)).toEqual([accA]);
      await expect(xfer(cpOrg, accA, before.orgHeld + 1)).rejects.toEqual(
        refused('xfer_over', 400),
      );
      await expect(xfer(cpOrg, ownerEmp, som(100))).rejects.toEqual(
        refused('xfer_to_invalid', 400),
      );
      await expect(xfer(cpNone, accA, som(10))).rejects.toEqual(refused('xfer_not_allowed'));
      const { id } = await xfer(cpOrg, accA, som(300));
      expect(await funds(cpOrg)).toMatchObject({
        available: before.available,
        orgHeld: before.orgHeld - som(300),
      });
      const acc = await inA((tx) => employeeAccountOf(tx, accA, undefined));
      expect(acc.account.rows.find((r) => r.contractorId === cpOrg)).toMatchObject({
        received: som(300),
        rest: som(300),
      });
      const card = await inA((tx) => operationCard(tx, id, undefined, t));
      expect(card).toMatchObject({ holderName: 'Алишер Т.', op: { note: 'Для оплаты Соцфонда' } });
      // Сменился только ответственный: перевод остаётся у того, кому перевели (прототип transferCp
      // меняет счёт операций только у контрагента, который переводит деньги ответственному).
      await inA((tx) => syncMoneyHolders(tx, [cpOrg], 'responsible'));
      const still = await inA((tx) => employeeAccountOf(tx, accA, undefined));
      expect(still.account.rows.find((r) => r.contractorId === cpOrg)).toMatchObject({
        received: som(300),
      });
      await remove(id);
      expect(await funds(cpOrg)).toMatchObject(before);
    });

    it('обратная запись к поступлению: «Уменьшить» — не больше остатка и поступления; в окне поступления — список', async () => {
      const { id: rec } = await receipt(cpOrg, { total: som(400) });
      const corr = (sign: '-' | '+', amount: number) =>
        inA(async (tx) =>
          correctReceipt(
            tx,
            await lockOperation(tx, rec, undefined),
            { sign, amount, date: TODAY, reason: 'Ошибка в сумме платёжки' },
            { today: TODAY },
          ),
        );
      await expect(corr('-', som(500))).rejects.toEqual(refused('correction_minus_over', 400));
      const { id: minus } = await corr('-', som(150));
      await corr('+', som(50));
      const card = await inA((tx) => operationCard(tx, rec, undefined, t));
      expect(card?.corrections.map((c) => c.amount)).toEqual([-som(150), som(50)]);
      expect(card?.history.slice(0, 2).map((h) => h.changes)).toEqual([
        [{ field: 'correction', to: som(50) }],
        [{ field: 'correction', to: -som(150) }],
      ]);
      const minusCard = await inA((tx) => operationCard(tx, minus, undefined, t));
      expect(minusCard?.receipt).toMatchObject({ id: rec, total: som(400) });
      expect(minusCard?.op).toMatchObject({ kind: 'corr', amount: -som(150) });
      // Обратная запись — только к поступлению.
      await expect(
        inA(async (tx) =>
          correctReceipt(
            tx,
            await lockOperation(tx, minus, undefined),
            { sign: '+', amount: 1, date: TODAY, reason: 'x' },
            { today: TODAY },
          ),
        ),
      ).rejects.toEqual(notFound);
    });

    it('удалить нельзя потраченное поступление; удаление оплаты возвращает деньги, поступления — и оплаты за обслуживание из него', async () => {
      const aug = await reportOf(cpPay, '2026-08-01');
      await setAmount(aug.id, som(700));
      const { id: rec } = await receipt(cpPay, {
        total: som(700),
        rows: [{ reportId: aug.id, amount: som(700) }],
      });
      const { operationId } = await pay(aug.id, som(700));
      const card = await inA((tx) => operationCard(tx, rec, undefined, t));
      expect(card?.deleteBlock).toMatchObject({
        code: 'receipt_spent',
        payments: [{ id: operationId, reportId: aug.id, amount: som(700) }],
      });
      await expect(remove(rec)).rejects.toEqual(refused('receipt_spent'));
      // Удаление оплаты: «Оплачено в бюджет» уменьшается, в истории отчёта — отмена оплаты с причиной.
      await remove(operationId, 'Платёж вернулся');
      expect(Number((await reportOf(cpPay, '2026-08-01')).paid)).toBe(0);
      expect((await inA((tx) => readHistory(tx, 'report', aug.id))).at(-1)).toMatchObject({
        reason: 'Платёж вернулся',
        changes: [
          { field: 'paymentCancel', from: { amount: som(700), date: TODAY } },
          { field: 'paid', from: som(700), to: 0 },
        ],
      });
      // Поступление с частью за обслуживание: удаляются обе части.
      const { id: both } = await receipt(cpOrg, { total: som(250) });
      await inA((tx) =>
        insertReceiptFeePayments(
          tx,
          cpOrg,
          { operationId: both, date: TODAY, rows: [{ month: '2026-10', amount: som(50) }] },
          t,
        ),
      );
      await remove(both, 'Перевод не дошёл');
      const fee = await inA((tx) =>
        tx.select().from(feePayments).where(eq(feePayments.operationId, both)),
      );
      expect(fee).toMatchObject([{ deleteReason: 'Перевод не дошёл' }]);
      expect(fee[0]?.deletedAt).toBeInstanceOf(Date);
    });

    it('возврат по уточнённому расчёту: уточнённая версия уменьшила оплаченный налог — разница в остаток', async () => {
      const jul = await reportOf(cpRev, '2026-08-01');
      await setAmount(jul.id, som(900));
      await receipt(cpRev, { total: som(900), rows: [{ reportId: jul.id, amount: som(900) }] });
      await pay(jul.id, som(900));
      const submit = async (id: string) => {
        const r = await inA((tx) => tx.select().from(reports).where(eq(reports.id, id)));
        return inA((tx) =>
          submitReport(
            tx,
            id,
            { date: TODAY, amount: null, lines: null, repeat: false, fileIds: [] },
            {
              today: TODAY,
              scope: undefined,
              contractorScope: undefined,
              confirmOn: false,
              filesOn: false,
              payFirst: false,
              t,
              version: r[0]!.version,
              texts: { repeat: '', afterPayment: '' },
            },
          ),
        );
      };
      const done = await submit(jul.id);
      const rev = await inA((tx) =>
        createRevision(tx, jul.id, {
          version: done.report.version,
          today: TODAY,
          scope: undefined,
        }),
      );
      expect(Number(rev.paid)).toBe(som(900));
      // Оплату прежней версии не удалить: сначала откатывают уточнённую (docs/deviations.md п. В-20).
      const [oldPay] = await inA((tx) =>
        tx
          .select()
          .from(moneyOperations)
          .where(and(eq(moneyOperations.reportId, jul.id), eq(moneyOperations.kind, 'pay'))),
      );
      await expect(remove(oldPay!.id)).rejects.toEqual(refused('payment_superseded'));
      const freeBefore = (await funds(cpRev)).free;
      await setAmount(rev.id, som(600));
      const after = await submit(rev.id);
      expect(after.report).toMatchObject({ status: 'submitted' });
      expect(Number(after.report.paid)).toBe(som(600));
      const [back] = await inA((tx) =>
        tx
          .select()
          .from(moneyOperations)
          .where(and(eq(moneyOperations.reportId, rev.id), eq(moneyOperations.kind, 'back'))),
      );
      expect(back).toMatchObject({
        amount: som(300),
        holderKind: 'employee',
        holderEmployeeId: accA,
      });
      expect((await funds(cpRev)).free).toBe(freeBefore + som(300));
      expect((await inA((tx) => readHistory(tx, 'report', rev.id))).at(-1)).toMatchObject({
        changes: [
          { field: 'revisionRefund', to: { amount: som(300), revision: 1 } },
          { field: 'paid', from: som(900), to: som(600) },
        ],
      });
      // Возврат создала система: вручную он не удаляется.
      await expect(remove(back!.id)).rejects.toEqual(refused('op_system'));
    });

    it('область «Свои»: чужой контрагент не найден, на счёте сотрудника — только свои контрагенты', async () => {
      const [op] = await inA((tx) =>
        tx.select().from(moneyOperations).where(eq(moneyOperations.contractorId, cpNone)),
      );
      // cpNone без ответственного: в области «Свои» Алишера Т. его нет.
      const own = contractorScope(accA);
      await expect(inA((tx) => lockOperation(tx, op!.id, own))).rejects.toEqual(notFound);
      expect(await inA((tx) => operationCard(tx, op!.id, own, t))).toBeNull();
      const acc = await inA((tx) => employeeAccountOf(tx, accA, own));
      // У cpOrg на счёте Алишера Т. был только перевод, и его удалили.
      expect(acc.contractors.map((c) => c.id).sort()).toEqual([cpEmp, cpRev, cpPay].sort());
      expect(await inA((tx) => orgHeldOf(tx, cpNone))).toBe(som(100));
    });

    it('чужая организация не видна: операции, счёт сотрудника; суммы операций и оплаты не стираются', async () => {
      const [op] = await inA((tx) => tx.select().from(moneyOperations).limit(1));
      await expect(inB((tx) => lockOperation(tx, op!.id, undefined))).rejects.toEqual(notFound);
      expect(await inB((tx) => operationCard(tx, op!.id, undefined, t))).toBeNull();
      expect((await inB((tx) => employeeAccountOf(tx, accA, undefined))).contractors).toEqual([]);
      expect(await inB((tx) => tx.select().from(feePayments))).toEqual([]);
      expect(
        await inB((tx) =>
          tx
            .update(feePayments)
            .set({ deleteReason: 'x', deletedAt: sql`now()`, deletedBy: b.ownerUserId })
            .returning(),
        ),
      ).toEqual([]);
      // Вид операции и контрагента оплаты за обслуживание роль приложения не меняет (сумму и дату меняет
      // «Изменить», задача 2.22); оплату, которая не часть поступления, не стирает.
      await expect(
        inA((tx) => tx.update(moneyOperations).set({ kind: 'in' }).returning()),
      ).rejects.toEqual(permissionDenied);
      await expect(
        inA((tx) => tx.update(feePayments).set({ contractorId: cpEmp }).returning()),
      ).rejects.toEqual(permissionDenied);
      expect(
        await inA((tx) =>
          tx
            .delete(feePayments)
            .where(sql`${feePayments.operationId} is null`)
            .returning(),
        ),
      ).toEqual([]);
    });
  },
);
