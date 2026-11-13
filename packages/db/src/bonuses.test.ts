import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bonusBalanceRows,
  bonusBalances,
  bonusLogRows,
  undoBonusWriteoff,
  writeOffBonus,
} from './bonuses';
import { withOrgContext } from './context';
import { createContractor, type ContractorFields } from './contractors';
import { addServicePayment, createOneOffService, oneOffServiceOf } from './one-off-services';
import { createOrganization, type CreatedOrganization } from './organizations';
import { bonusWriteoffs, oneOffServiceBonuses } from './schema';
import { readSpecJson } from './spec-data';
import { DEMO_ORG_ID, demoId, seedAll, seedPermissions, seedRoleTemplates } from './seed';
import { createEmployee } from './staff';
import {
  createTestDatabase,
  databaseAvailable,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

/*
 * Бонусы сотрудников (прототип v84 и v87: modules/services.js `bonusLog`, `bonusSum`, `bonusOutDlg`,
 * `bonusUndo`; docs/deviations.md п. О-75): таблицы `one_off_service_bonuses` и `bonus_writeoffs` —
 * изоляция организаций, запреты роли приложения, остаток с учётом ожидающих и списанных бонусов.
 * Правила окна услуги, права и области — в тестах API (`finance/bonuses.test.ts`).
 */

const TODAY = '2026-10-28';
const som = (v: number) => v * 100;
const SEE_ALL = { ops: undefined, services: undefined };
const refused = (code: string, status = 409) =>
  expect.objectContaining({ name: 'MoneyRefusedError', code, status });
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
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

describe.skipIf(!databaseAvailable())('Бонусы сотрудников', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let accA = '';
  let accB = '';
  let cpA = '';
  let service = '';
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);
  const balance = async (id = accA) => (await inA((tx) => bonusBalances(tx, [id]))).get(id);
  const out = (amount: number, employeeId = accA) =>
    inA((tx) =>
      writeOffBonus(
        tx,
        { employeeId, amount, date: TODAY, note: 'Выдано с зарплатой' },
        { today: TODAY },
      ),
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
      slug: 'bon-a',
      owner: owner('bon-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810467',
      slug: 'bon-b',
      owner: owner('bon-owner-b'),
    });
    const employee = (org: CreatedOrganization, login: string) => ({
      fullName: 'Токтогулов Алишер Бакытович',
      shortName: 'Алишер Т.',
      login,
      passwordHash: 'x',
      phone: null,
      role: org.roles.find((r) => r.templateCode === 'acc')!,
    });
    accA = await inA((tx) => createEmployee(tx, employee(a, 'bon-acc-a')));
    accB = await inB((tx) => createEmployee(tx, employee(b, 'bon-acc-b')));
    cpA = await inA((tx) => createContractor(tx, a.orgId, fields(), null));
    ({ id: service } = await inA((tx) =>
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
          bonuses: [{ employeeId: accA, amount: som(1_000) }],
        },
        { today: TODAY, scope: undefined },
      ),
    ));
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('бонус за услугу ждёт полной оплаты, потом копится; списание — не больше остатка; отмена возвращает', async () => {
    expect(await balance()).toMatchObject({ svc: 0, wait: som(1_000), bal: 0 });
    await expect(out(som(100))).rejects.toEqual(refused('bonus_none'));
    await inA(async (tx) =>
      addServicePayment(
        tx,
        await oneOffServiceOf(tx, service, undefined, true),
        { amount: som(10_000), date: '2026-10-25', note: '' },
        { today: TODAY },
      ),
    );
    expect(await balance()).toMatchObject({ svc: som(1_000), wait: 0, bal: som(1_000) });
    await expect(out(som(1_001))).rejects.toEqual(refused('bonus_out_over', 400));
    const saved = await out(som(400));
    expect(saved.balance).toBe(som(600));
    expect(await balance()).toMatchObject({ out: som(400), bal: som(600) });
    // Устаревшая версия — «запись изменена другим пользователем»; повторная отмена — отказ.
    await expect(inA((tx) => undoBonusWriteoff(tx, saved.id, 5))).rejects.toMatchObject({
      name: 'RecordChangedError',
    });
    await inA((tx) => undoBonusWriteoff(tx, saved.id, 1));
    await expect(inA((tx) => undoBonusWriteoff(tx, saved.id, 2))).rejects.toEqual(
      refused('bonus_out_undone'),
    );
    expect(await balance()).toMatchObject({ out: 0, bal: som(1_000) });
    const rows = await inA((tx) => bonusBalanceRows(tx));
    expect(rows.find((r) => r.id === accA)).toMatchObject({ svc: som(1_000), bal: som(1_000) });
  });

  it('чужая организация не видна: бонусы услуг, списания, журнал и остатки', async () => {
    const saved = await out(som(100));
    expect(await inB((tx) => tx.select().from(oneOffServiceBonuses))).toEqual([]);
    expect(await inB((tx) => tx.select().from(bonusWriteoffs))).toEqual([]);
    expect(await inB((tx) => bonusLogRows(tx, SEE_ALL))).toEqual([]);
    expect((await inB((tx) => bonusBalances(tx, [accA]))).get(accA)).toBeUndefined();
    expect((await inB((tx) => bonusBalanceRows(tx))).some((r) => r.id === accA)).toBe(false);
    // Чужое списание не отменить и чужому сотруднику бонус не списать.
    await expect(inB((tx) => undoBonusWriteoff(tx, saved.id, 1))).rejects.toMatchObject({
      name: 'RecordNotFoundError',
    });
    await expect(
      inB((tx) =>
        writeOffBonus(
          tx,
          { employeeId: accA, amount: som(1), date: TODAY, note: 'x' },
          { today: TODAY },
        ),
      ),
    ).rejects.toMatchObject({ name: 'RecordNotFoundError' });
    // Строку бонуса к чужой услуге и списание чужому сотруднику не записать: составные внешние ключи.
    await expect(
      inB((tx) =>
        tx.insert(oneOffServiceBonuses).values({ serviceId: service, employeeId: accB, amount: 1 }),
      ),
    ).rejects.toThrow();
    await expect(
      inB((tx) =>
        tx
          .insert(bonusWriteoffs)
          .values({ employeeId: accA, amount: 1, paidOn: TODAY, note: 'Чужое' }),
      ),
    ).rejects.toThrow();
    // Запись с чужой организацией политика не пропускает.
    await expect(
      inB((tx) =>
        tx
          .insert(bonusWriteoffs)
          .values({ orgId: a.orgId, employeeId: accA, amount: 1, paidOn: TODAY, note: 'Чужое' }),
      ),
    ).rejects.toThrow();
    await inA((tx) => undoBonusWriteoff(tx, saved.id, 1));
  });

  it('роль приложения не стирает списания, не меняет их сумму и не правит строки бонусов на месте', async () => {
    const saved = await out(som(100));
    await expect(
      inA((tx) => tx.delete(bonusWriteoffs).where(eq(bonusWriteoffs.id, saved.id))),
    ).rejects.toEqual(permissionDenied);
    await expect(
      inA((tx) =>
        tx.update(bonusWriteoffs).set({ amount: 1 }).where(eq(bonusWriteoffs.id, saved.id)),
      ),
    ).rejects.toEqual(permissionDenied);
    await expect(
      inA((tx) =>
        tx
          .update(oneOffServiceBonuses)
          .set({ amount: som(9_000) })
          .where(eq(oneOffServiceBonuses.serviceId, service)),
      ),
    ).rejects.toEqual(permissionDenied);
    await expect(inA((tx) => tx.execute(sql`truncate bonus_writeoffs`))).rejects.toEqual(
      permissionDenied,
    );
    await expect(inA((tx) => tx.execute(sql`truncate one_off_service_bonuses`))).rejects.toEqual(
      permissionDenied,
    );
    // Списание записывают только от своего имени и действующим (политика вставки).
    const row = { employeeId: accA, amount: 1, paidOn: TODAY, note: 'Мимо правил' };
    await expect(inA((tx) => tx.insert(bonusWriteoffs).values(row))).rejects.toThrow();
    await expect(
      inA((tx) => tx.insert(bonusWriteoffs).values({ ...row, createdBy: b.ownerUserId })),
    ).rejects.toThrow();
    await expect(
      inA((tx) =>
        tx.insert(bonusWriteoffs).values({
          ...row,
          createdBy: a.ownerUserId,
          deletedAt: new Date(),
          deletedBy: a.ownerUserId,
        }),
      ),
    ).rejects.toThrow();
    await inA((tx) => undoBonusWriteoff(tx, saved.id, 1));
  });
});

/*
 * Демо-организация (demoDB.json): строки `bonus` услуг и списания `bonusOps`. Ожидаемые суммы считаются
 * из того же файла по правилам прототипа (`bonusLog`, `svcBonusOn`, `bonusSum`).
 */
describe.skipIf(!databaseAvailable())('Бонусы демо-организации из demoDB.json', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAll(db.admin.db, { update: false, demo: true });
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('остатки сотрудников — как `bonusSum` прототипа; повторное наполнение ничего не удваивает', async () => {
    type Pay = { amount: number; del?: unknown };
    const demo = await readSpecJson<{
      moneyOps: { kind: string; holder?: string; amount: number; del?: unknown }[];
      services: {
        amount: number;
        del?: unknown;
        pays?: Pay[];
        bonus?: { emp: string; amount: number }[];
      }[];
      bonusOps: { emp: string; amount: number; del?: unknown }[];
    }>('data/demoDB.json');
    const expected = new Map<string, { cp: number; svc: number; wait: number; out: number }>();
    const at = (emp: string) => {
      if (!expected.has(emp)) expected.set(emp, { cp: 0, svc: 0, wait: 0, out: 0 });
      return expected.get(emp)!;
    };
    for (const o of demo.moneyOps)
      if (o.kind === 'bonus' && !o.del && o.holder && o.holder !== 'org')
        at(o.holder).cp += som(o.amount);
    for (const s of demo.services) {
      if (s.del) continue;
      const paid = (s.pays ?? []).filter((p) => !p.del).reduce((sum, p) => sum + p.amount, 0);
      for (const b of s.bonus ?? []) at(b.emp)[paid >= s.amount ? 'svc' : 'wait'] += som(b.amount);
    }
    for (const x of demo.bonusOps) if (!x.del) at(x.emp).out += som(x.amount);
    // В демо-данных есть и начисленные, и ожидающие бонусы, и списания.
    expect([...expected.values()].some((b) => b.svc > 0)).toBe(true);
    expect([...expected.values()].some((b) => b.wait > 0)).toBe(true);
    expect([...expected.values()].some((b) => b.out > 0)).toBe(true);

    const read = () =>
      withOrgContext(db.app.db, { orgId: DEMO_ORG_ID, userId: demoId('user', 'e1') }, (tx) =>
        bonusBalances(tx),
      );
    const check = (got: Awaited<ReturnType<typeof read>>) => {
      for (const [emp, b] of expected)
        expect(got.get(demoId('employee', emp)), emp).toEqual({
          ...b,
          bal: b.cp + b.svc - b.out,
        });
    };
    check(await read());
    await seedAll(db.admin.db, { update: false, demo: true });
    check(await read());
  });
});
