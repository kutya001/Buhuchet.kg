import { formatSomWithUnit, type ListQuery } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from './context';
import { createContractor, type ContractorFields } from './contractors';
import { finSummary, listFinJournalPage, type FinJournalOptions } from './finance-journal';
import {
  addServicePayment,
  createOneOffService,
  deleteOneOffService,
  deleteServicePayment,
  editOneOffService,
  editServicePayment,
  oneOffServiceCard,
  oneOffServiceFileSource,
  oneOffServiceOf,
  servicePaymentCard,
  servicePaymentOf,
  type OneOffServiceInput,
} from './one-off-services';
import { createOrganization, type CreatedOrganization } from './organizations';
import { contractors, oneOffServicePayments, oneOffServices } from './schema';
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
 * Разовые услуги (задача 2.22; прототип modules/services.js `serviceDlg`, `svcPay`, `serviceCard`,
 * modules/fin-op.js `opEditDlg`, `opDelDlg` с `sp` и `svc`): создание с «Оплачено сразу», оплаты не
 * больше остатка, «Изменить» и «Удалить» с причиной, статус оплаты, строки журнала и плашка «Проекты и
 * разовые услуги», запреты роли приложения, изоляция организаций.
 */

const TODAY = '2026-10-28';
const texts = (key: string) => key;
const som = (v: number) => v * 100;
const refused = (code: string, status = 409) =>
  expect.objectContaining({ name: 'MoneyRefusedError', code, status });
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});
const query = (patch: Partial<ListQuery> = {}): ListQuery => ({
  sort: undefined,
  page: 1,
  size: 50,
  filters: {},
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
  startDate: '2026-07-01',
  firstMonthMode: 'full',
  feeDay: 15,
  paysTo: 'org',
  gkedConfirmation: null,
  socfundFlags: {},
  socfundTariff: null,
  ...patch,
});

describe.skipIf(!databaseAvailable())('Разовые услуги', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let accA = '';
  let cpA = '';
  let cpArchived = '';
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId } as OrgContext, fn);
  const service = (patch: Partial<OneOffServiceInput> = {}) =>
    inA((tx) =>
      createOneOffService(
        tx,
        {
          contractorId: cpA,
          name: 'Проверка учёта за 2025 год',
          date: '2026-10-20',
          amount: som(10_000),
          performerEmployeeId: accA,
          description: '',
          paidNow: false,
          ...patch,
        },
        { today: TODAY, scope: undefined },
      ),
    );
  const pay = (id: string, amount: number, date = TODAY) =>
    inA(async (tx) =>
      addServicePayment(
        tx,
        await oneOffServiceOf(tx, id, undefined, true),
        { amount, date, note: '' },
        { today: TODAY },
      ),
    );
  const card = (id: string) => inA((tx) => oneOffServiceCard(tx, id, undefined));
  const journal = (o: Partial<FinJournalOptions> = {}) =>
    inA((tx) =>
      listFinJournalPage(tx, query(), {
        tab: 'proj',
        deleted: false,
        tax: true,
        fee: true,
        proj: true,
        scope: undefined,
        t: texts,
        ...o,
      }),
    );

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
      slug: 'svc-a',
      owner: owner('svc-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810467',
      slug: 'svc-b',
      owner: owner('svc-owner-b'),
    });
    const role = a.roles.find((r) => r.templateCode === 'acc')!;
    accA = await inA((tx) =>
      createEmployee(tx, {
        fullName: 'Токтогулов Алишер Бакытович',
        shortName: 'Алишер Т.',
        login: 'svc-acc-a',
        passwordHash: 'x',
        phone: null,
        role,
      }),
    );
    cpA = await inA((tx) => createContractor(tx, a.orgId, fields(), null));
    cpArchived = await inA((tx) =>
      createContractor(tx, a.orgId, fields({ name: 'ИП Архивный', inn: '21503198700015' }), null),
    );
    await db.admin.db
      .update(contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(contractors.id, cpArchived));
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('«Добавить услугу»: проверки окна, контрагент не в архиве, исполнитель — действующий сотрудник', async () => {
    await expect(service({ name: '  ' })).rejects.toEqual(refused('service_name_required', 400));
    await expect(service({ amount: 0 })).rejects.toEqual(refused('service_amount_required', 400));
    await expect(service({ contractorId: cpArchived })).rejects.toEqual(
      refused('contractor_archived'),
    );
    await expect(service({ contractorId: '00000000-0000-4000-8000-000000000000' })).rejects.toEqual(
      refused('service_contractor_invalid', 400),
    );
    await expect(
      service({ performerEmployeeId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toEqual(refused('service_responsible_invalid', 400));
    // Область «Свои»: контрагента вне области не найти.
    await expect(
      inA((tx) =>
        createOneOffService(
          tx,
          {
            contractorId: cpA,
            name: 'Услуга',
            date: TODAY,
            amount: 100,
            performerEmployeeId: null,
            description: '',
            paidNow: false,
          },
          { today: TODAY, scope: sql`false` },
        ),
      ),
    ).rejects.toEqual(refused('service_contractor_invalid', 400));
  });

  it('«Оплачено сразу»: оплата на всю сумму сегодняшним днём, статус «Оплачено», запись в истории', async () => {
    const { id } = await service({ name: 'Консультация', amount: som(2_500), paidNow: true });
    const c = (await card(id))!;
    expect(c.status).toBe('paid');
    expect(c.paid).toBe(som(2_500));
    expect(c.payments).toEqual([
      expect.objectContaining({ date: TODAY, amount: som(2_500), edited: false }),
    ]);
    expect(c.performerName).toBe('Алишер Т.');
    expect(c.history).toEqual([
      expect.objectContaining({
        entity: 'one_off_service',
        action: 'create',
        changes: expect.arrayContaining([{ field: 'paid', to: true }]),
      }),
    ]);
    // Оплаченную полностью больше не оплатить.
    await expect(pay(id, 1)).rejects.toEqual(refused('service_paid_full'));
  });

  it('оплаты: не больше остатка, дата не позже сегодняшней; статус «Оплачено частично» → «Оплачено»', async () => {
    const { id } = await service();
    await expect(pay(id, som(10_001))).rejects.toEqual(refused('service_pay_over', 400));
    await expect(pay(id, 0)).rejects.toEqual(refused('op_amount_required', 400));
    await expect(pay(id, som(1), '2026-10-29')).rejects.toEqual(refused('money_date_future', 400));
    await pay(id, som(4_000));
    expect((await card(id))!.status).toBe('partial');
    await pay(id, som(6_000), '2026-10-27');
    const c = (await card(id))!;
    expect(c.status).toBe('paid');
    expect(c.payments.map((p) => p.amount)).toEqual([som(6_000), som(4_000)]);
    expect(c.history.filter((h) => h.entity === 'one_off_service_payment')).toHaveLength(2);
  });

  it('«Изменить» услугу: не меньше полученного, причина — если меняются стоимость или дата; «Изменена»', async () => {
    const { id } = await service({ amount: som(5_000) });
    await pay(id, som(3_000));
    const edit = (patch: Record<string, unknown>) =>
      inA(async (tx) => {
        const locked = await oneOffServiceOf(tx, id, undefined, true);
        return editOneOffService(tx, locked, {
          version: locked.service.version,
          name: locked.service.name,
          date: locked.service.serviceDate,
          amount: Number(locked.service.amount),
          performerEmployeeId: locked.service.performerEmployeeId,
          description: locked.service.description,
          reason: '',
          ...patch,
        });
      });
    await expect(edit({ amount: som(2_000), reason: 'x' })).rejects.toEqual(
      refused('service_amount_less', 400),
    );
    await expect(edit({ amount: som(6_000) })).rejects.toEqual(
      refused('service_reason_required', 400),
    );
    // Только название и описание — без причины и без отметки «Изменена».
    expect(await edit({ name: 'Проверка учёта', description: 'По договору' })).toEqual({
      changed: true,
    });
    let s = (await card(id))!.service;
    expect(s.edited).toBe(false);
    await edit({ amount: som(6_000), reason: 'Согласовали заново' });
    s = (await card(id))!.service;
    expect(s.edited).toBe(true);
    expect(Number(s.amount)).toBe(som(6_000));
    expect((await card(id))!.history[0]).toEqual(
      expect.objectContaining({
        action: 'update',
        reason: 'Согласовали заново',
        changes: [{ field: 'amount', from: som(5_000), to: som(6_000) }],
      }),
    );
    // Устаревшая версия — «запись изменена другим пользователем».
    await expect(
      inA(async (tx) =>
        editOneOffService(tx, await oneOffServiceOf(tx, id, undefined, true), {
          version: 1,
          name: 'X',
          date: TODAY,
          amount: som(6_000),
          performerEmployeeId: null,
          description: '',
          reason: '',
        }),
      ),
    ).rejects.toEqual(expect.objectContaining({ name: 'RecordChangedError' }));
  });

  it('оплата: «Изменить» не больше стоимости без остальных оплат, «Удалить» с причиной — статус пересчитан', async () => {
    const { id } = await service({ amount: som(10_000) });
    await pay(id, som(7_000));
    const { id: payId } = await pay(id, som(3_000));
    const editPay = (patch: Record<string, unknown>) =>
      inA(async (tx) => {
        const locked = await servicePaymentOf(tx, payId, undefined, true);
        return editServicePayment(
          tx,
          locked,
          {
            version: locked.payment.version,
            amount: Number(locked.payment.amount),
            date: locked.payment.paidOn,
            note: locked.payment.note,
            reason: '',
            ...patch,
          },
          { today: TODAY },
        );
      });
    await expect(editPay({ amount: som(3_001), reason: 'x' })).rejects.toEqual(
      expect.objectContaining({
        code: 'op_service_over',
        status: 400,
        params: { max: formatSomWithUnit(som(3_000)) },
      }),
    );
    await expect(editPay({ amount: som(2_000) })).rejects.toEqual(
      refused('op_reason_required', 400),
    );
    expect(await editPay({ note: 'по чеку' })).toEqual({ changed: true });
    await editPay({ amount: som(2_000), reason: 'Ошибка в сумме' });
    const w = (await inA((tx) => servicePaymentCard(tx, payId, undefined)))!;
    expect(w.paid).toBe(som(9_000));
    expect(w.payment.edited).toBe(true);
    expect(w.history.map((h) => h.action)).toEqual(['update', 'update', 'create']);
    await expect(
      inA(async (tx) =>
        deleteServicePayment(tx, await servicePaymentOf(tx, payId, undefined, true), ' '),
      ),
    ).rejects.toEqual(refused('op_reason_required', 400));
    await inA(async (tx) =>
      deleteServicePayment(tx, await servicePaymentOf(tx, payId, undefined, true), 'Дубль'),
    );
    const c = (await card(id))!;
    expect(c.paid).toBe(som(7_000));
    expect(c.status).toBe('partial');
    expect(c.payments).toHaveLength(1);
    expect(c.deletedPayments).toEqual([payId]);
    await expect(
      inA(async (tx) =>
        deleteServicePayment(tx, await servicePaymentOf(tx, payId, undefined, true), 'Ещё раз'),
      ),
    ).rejects.toEqual(refused('op_deleted'));
  });

  it('журнал: строка «Разовая услуга» во «Все» и «Проекты и услуги», статус оплаты; удалённая — с фильтром', async () => {
    const { id } = await service({ name: 'Восстановление учёта', amount: som(8_000) });
    await pay(id, som(1_000));
    const row = (await journal()).rows.find((r) => r.id === id)!;
    expect(row).toEqual(
      expect.objectContaining({
        key: `svc:${id}`,
        src: 'svc',
        kind: 'svc',
        what: 'Восстановление учёта',
        amount: som(8_000),
        signed: som(8_000),
        by: 'Алишер Т.',
        service: { status: 'partial', paid: som(1_000) },
      }),
    );
    expect((await journal({ tab: 'all' })).rows.some((r) => r.id === id)).toBe(true);
    // Без права на услуги — их нет ни во «Всех», ни на вкладке.
    expect((await journal({ tab: 'all', proj: false })).rows.some((r) => r.id === id)).toBe(false);
    expect((await journal({ tax: false, fee: false, proj: false })).rows).toEqual([]);
    const before = await inA((tx) =>
      finSummary(tx, '2026-10', { tax: false, fee: false, proj: true, scope: undefined }),
    );
    await inA(async (tx) =>
      deleteOneOffService(tx, await oneOffServiceOf(tx, id, undefined, true), 'Внесли дважды'),
    );
    expect((await journal()).rows.some((r) => r.id === id)).toBe(false);
    const deleted = (await journal({ deleted: true })).rows.find((r) => r.id === id)!;
    expect(deleted.deleted).toBe(true);
    // Удалённая уходит из плашки вместе со своими оплатами и из счётчика неоплаченных.
    const after = await inA((tx) =>
      finSummary(tx, '2026-10', { tax: false, fee: false, proj: true, scope: undefined }),
    );
    expect(after.proj!.received).toBe(before.proj!.received - som(1_000));
    expect(after.proj!.open).toBe(before.proj!.open - 1);
    // Удалённую не изменить и не оплатить.
    await expect(pay(id, som(1))).rejects.toEqual(refused('service_deleted'));
    expect((await card(id))!.history[0]).toEqual(
      expect.objectContaining({
        action: 'delete',
        reason: 'Внесли дважды',
        changes: expect.arrayContaining([{ field: 'payments', from: 1 }]),
      }),
    );
  });

  it('файлы: услуга и оплата — источник с контрагентом и отметкой «удалена»', async () => {
    const { id } = await service({ name: 'Акт сверки', amount: som(500) });
    const { id: payId } = await pay(id, som(500));
    const src = await inA((tx) => oneOffServiceFileSource(tx, 'one_off_service', id, undefined));
    expect(src).toEqual(
      expect.objectContaining({ serviceId: id, deleted: false, finops: expect.any(Boolean) }),
    );
    expect(src!.contractor.id).toBe(cpA);
    const psrc = await inA((tx) =>
      oneOffServiceFileSource(tx, 'one_off_service_payment', payId, undefined),
    );
    expect(psrc!.serviceId).toBe(id);
    expect(
      await inA((tx) => oneOffServiceFileSource(tx, 'one_off_service', id, sql`false`)),
    ).toBeNull();
  });

  it('роль приложения не стирает услуги и оплаты и не меняет контрагента и услугу оплаты', async () => {
    const { id } = await service({ amount: som(100) });
    const { id: payId } = await pay(id, som(100));
    await expect(
      inA((tx) => tx.delete(oneOffServices).where(eq(oneOffServices.id, id))),
    ).rejects.toEqual(permissionDenied);
    await expect(
      inA((tx) => tx.delete(oneOffServicePayments).where(eq(oneOffServicePayments.id, payId))),
    ).rejects.toEqual(permissionDenied);
    await expect(
      inA((tx) =>
        tx
          .update(oneOffServices)
          .set({ contractorId: cpArchived })
          .where(eq(oneOffServices.id, id)),
      ),
    ).rejects.toEqual(permissionDenied);
    await expect(
      inA((tx) =>
        tx
          .update(oneOffServicePayments)
          .set({ serviceId: id })
          .where(eq(oneOffServicePayments.id, payId)),
      ),
    ).rejects.toEqual(permissionDenied);
  });

  it('чужая организация не видна: услуги, оплаты, журнал', async () => {
    const { id } = await service({ amount: som(300) });
    const { id: payId } = await pay(id, som(100));
    expect(await inB((tx) => tx.select().from(oneOffServices))).toEqual([]);
    expect(await inB((tx) => tx.select().from(oneOffServicePayments))).toEqual([]);
    expect(await inB((tx) => oneOffServiceCard(tx, id, undefined))).toBeNull();
    expect(await inB((tx) => servicePaymentCard(tx, payId, undefined))).toBeNull();
    const page = await inB((tx) =>
      listFinJournalPage(tx, query(), {
        tab: 'all',
        deleted: true,
        tax: true,
        fee: true,
        proj: true,
        scope: undefined,
        t: texts,
      }),
    );
    expect(page.rows).toEqual([]);
    // Услугу с контрагентом чужой организации не записать: составной внешний ключ.
    await expect(
      inB((tx) =>
        tx.insert(oneOffServices).values({
          contractorId: cpA,
          name: 'Чужая',
          serviceDate: TODAY,
          amount: 100,
        }),
      ),
    ).rejects.toThrow();
  });
});
