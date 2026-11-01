import { formatSomWithUnit, KB_STEP_RULES, type ListQuery } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from './context';
import { createContractor, type ContractorFields } from './contractors';
import { finSummary, listFinJournalPage, type FinJournalOptions } from './finance-journal';
import { kbDoneFacts } from './kb';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  addProjectPayment,
  deleteProjectPayment,
  editProjectPayment,
  projectPaymentCard,
  projectPaymentFileSource,
  projectPaymentLines,
  projectPaymentOf,
} from './project-payments';
import {
  createProject,
  projectCard,
  projectOf,
  projectSummary,
  projectVisibility,
  setProjectStatus,
  visibleProjectIds,
  type ProjectInput,
} from './projects';
import { auditLog, projectPayments } from './schema';
import { seedPermissions, seedRoleTemplates } from './seed';
import { readSpecJson } from './spec-data';
import { createEmployee } from './staff';
import {
  createTestDatabase,
  databaseAvailable,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

/*
 * Оплаты по проекту — транши (задача 2.26, часть 2; прототип modules/projects.js `projPay` → `tranchDlg`,
 * modules/fin-op.js `opEditDlg`, `opDelDlg` с `pt`): запись не больше остатка, «Изменить» и «Удалить» с
 * причиной, «получено» проекта, история в карточке, строки журнала по видимости проекта, запреты роли
 * приложения, изоляция организаций.
 */

const TODAY = '2026-11-01';
const texts = (key: string) => key;
const som = (v: number) => v * 100;
const refused = (code: string, status = 400) =>
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

describe.skipIf(!databaseAvailable())('Оплаты по проекту — транши', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let alisher = '';
  let meerim = '';
  let cpA = '';
  let cpOther = '';
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId } as OrgContext, fn);
  const project = (patch: Partial<ProjectInput & { contractorId: string }> = {}) =>
    inA((tx) =>
      createProject(
        tx,
        {
          contractorId: cpA,
          status: 'in_progress',
          name: 'Восстановление учёта 2024–2025',
          startsOn: '2026-10-01',
          endsOn: '2026-12-31',
          description: '',
          plan: som(50_000),
          members: [alisher],
          lead: alisher,
          works: [],
          ...patch,
        },
        { scope: undefined },
      ),
    );
  const pay = (projectId: string, amount: number, date = TODAY, note = '') =>
    inA(async (tx) =>
      addProjectPayment(
        tx,
        await projectOf(tx, projectId, undefined, true),
        { amount, date, note },
        { today: TODAY },
      ),
    );
  const edit = (
    id: string,
    patch: Partial<{ amount: number; date: string; note: string; reason: string }>,
  ) =>
    inA(async (tx) => {
      const locked = await projectPaymentOf(tx, id, undefined, true);
      return editProjectPayment(
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
  const remove = (id: string, reason: string) =>
    inA(async (tx) =>
      deleteProjectPayment(tx, await projectPaymentOf(tx, id, undefined, true), reason),
    );
  const paid = async (projectId: string) =>
    (await inA((tx) => projectCard(tx, projectId, undefined)))!.paid;
  const journal = (o: Partial<FinJournalOptions> = {}) =>
    inA((tx) =>
      listFinJournalPage(tx, query(), {
        tab: 'proj',
        deleted: false,
        tax: true,
        fee: true,
        proj: true,
        projects: { visible: undefined },
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
      inn: '01811201810476',
      slug: 'pt-a',
      owner: owner('pt-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810477',
      slug: 'pt-b',
      owner: owner('pt-owner-b'),
    });
    const role = a.roles.find((r) => r.templateCode === 'acc')!;
    const employee = (fullName: string, shortName: string, login: string) =>
      inA((tx) =>
        createEmployee(tx, { fullName, shortName, login, passwordHash: 'x', phone: null, role }),
      );
    alisher = await employee('Токтогулов Алишер Бакытович', 'Алишер Т.', 'pt-alisher');
    meerim = await employee('Касымова Мээрим Талантовна', 'Мээрим К.', 'pt-meerim');
    cpA = await inA((tx) =>
      createContractor(tx, a.orgId, fields({ responsibleEmployeeId: alisher }), null),
    );
    cpOther = await inA((tx) =>
      createContractor(
        tx,
        a.orgId,
        fields({ name: 'ИП Другой', inn: '21503198700025', responsibleEmployeeId: meerim }),
        null,
      ),
    );
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('«Записать оплату»: не больше остатка, «Получена вся стоимость», без стоимости — любая, дата', async () => {
    const { id } = await project();
    await expect(pay(id, 0)).rejects.toEqual(refused('op_amount_required'));
    await expect(pay(id, som(50_001))).rejects.toEqual(
      expect.objectContaining({
        code: 'project_pay_over',
        params: { amount: formatSomWithUnit(som(50_000)) },
      }),
    );
    await expect(pay(id, som(100), '2026-11-02')).rejects.toEqual(refused('money_date_future'));
    const first = await pay(id, som(20_000), '2026-10-05', '  Аванс ');
    expect(await paid(id)).toBe(som(20_000));
    await expect(pay(id, som(30_001))).rejects.toEqual(
      expect.objectContaining({
        code: 'project_pay_over',
        params: { amount: formatSomWithUnit(som(30_000)) },
      }),
    );
    await pay(id, som(30_000));
    await expect(pay(id, som(1))).rejects.toEqual(refused('project_paid_full', 409));
    // Строки карточки: по дате, «Записал» — автор, комментарий без пробелов по краям.
    const lines = await inA((tx) => projectPaymentLines(tx, id));
    expect(lines.map((l) => [l.date, l.amount, l.note])).toEqual([
      ['2026-10-05', som(20_000), 'Аванс'],
      [TODAY, som(30_000), ''],
    ]);
    const [h] = await inA((tx) =>
      tx.select().from(auditLog).where(eq(auditLog.entityId, first.id)),
    );
    expect(h).toMatchObject({ entity: 'project_payment', action: 'create', contractorId: cpA });
    // Шаг «Базы знаний» «Принять транш оплаты по проекту» засчитан тому, кто записал транш.
    const steps = [{ id: 'tranche', rule: KB_STEP_RULES.tranche!.done! }];
    expect([...(await inA((tx) => kbDoneFacts(tx, a.ownerUserId, steps))).keys()]).toEqual([
      'tranche',
    ]);
    expect((await inB((tx) => kbDoneFacts(tx, b.ownerUserId, steps))).size).toBe(0);
    // Без планируемой стоимости — любая сумма.
    const { id: free } = await project({ name: 'Без стоимости', plan: null });
    await pay(free, som(900_000));
    expect(await paid(free)).toBe(som(900_000));
  });

  it('отменённому проекту оплату не записать', async () => {
    const { id } = await project({ name: 'Отменённый' });
    await inA(async (tx) =>
      setProjectStatus(tx, await projectOf(tx, id, undefined, true), 'cancelled', {}),
    );
    await expect(pay(id, som(100))).rejects.toEqual(refused('project_pay_cancelled', 409));
  });

  it('п. 66: транш 50 000 сом, изменённый на 45 000 сом с причиной, уменьшает «получено»', async () => {
    const { id } = await project({ name: 'Приёмка п. 66', plan: som(60_000) });
    const { id: t } = await pay(id, som(50_000), TODAY, 'Аванс');
    expect(await paid(id)).toBe(som(50_000));
    await expect(edit(t, { amount: som(45_000) })).rejects.toEqual(refused('op_reason_required'));
    // Не больше стоимости без остальных траншей (прототип `opMax`).
    await expect(edit(t, { amount: som(60_001), reason: 'Ошибка' })).rejects.toEqual(
      expect.objectContaining({
        code: 'op_project_over',
        params: { max: formatSomWithUnit(som(60_000)) },
      }),
    );
    expect(await edit(t, { amount: som(45_000), reason: 'Ошибка в сумме' })).toEqual({
      changed: true,
    });
    expect(await paid(id)).toBe(som(45_000));
    const card = (await inA((tx) => projectPaymentCard(tx, t, undefined)))!;
    expect(card.payment).toMatchObject({ amount: som(45_000), edited: true, version: 2 });
    expect(card.paid).toBe(som(45_000));
    expect(card.history.map((x) => [x.action, x.reason])).toEqual([
      ['update', 'Ошибка в сумме'],
      ['create', null],
    ]);
    // В истории проекта — записи его траншей с номером транша.
    const history = (await inA((tx) => projectCard(tx, id, undefined)))!.history;
    expect(history.filter((x) => x.paymentId === t).map((x) => x.action)).toEqual([
      'update',
      'create',
    ]);
    // Только комментарий — без причины; устаревшее сохранение — «запись изменена».
    expect(await edit(t, { note: 'Аванс по договору' })).toEqual({ changed: true });
    expect(await edit(t, {})).toEqual({ changed: false });
    await expect(
      inA(async (tx) =>
        editProjectPayment(
          tx,
          await projectPaymentOf(tx, t, undefined, true),
          { version: 1, amount: som(1), date: TODAY, note: '', reason: 'x' },
          { today: TODAY },
        ),
      ),
    ).rejects.toEqual(expect.objectContaining({ name: 'RecordChangedError' }));
  });

  it('«Удалить» с причиной: транш не в «получено», остаётся в журнале с «Удалённые», повторно — нельзя', async () => {
    const { id } = await project({ name: 'Удаление транша' });
    const { id: t } = await pay(id, som(10_000));
    await expect(remove(t, '  ')).rejects.toEqual(refused('op_reason_required'));
    await remove(t, 'Записали дважды');
    expect(await paid(id)).toBe(0);
    expect(await inA((tx) => projectPaymentLines(tx, id))).toEqual([]);
    await expect(remove(t, 'Ещё раз')).rejects.toEqual(refused('op_deleted', 409));
    await expect(edit(t, { amount: som(1), reason: 'x' })).rejects.toEqual(
      refused('op_deleted', 409),
    );
    expect((await journal()).rows.some((r) => r.id === t)).toBe(false);
    expect((await journal({ deleted: true })).rows.find((r) => r.id === t)).toMatchObject({
      deleted: true,
    });
    expect((await inA((tx) => projectPaymentFileSource(tx, t, undefined)))?.deleted).toBe(true);
  });

  it('журнал: строка «Оплата по проекту» с проектом, видимость по проекту, плашка за месяц', async () => {
    const { id } = await project({
      name: 'Журнал',
      contractorId: cpOther,
      members: [meerim],
      lead: meerim,
    });
    const { id: t } = await pay(id, som(7_000), '2026-10-20', 'Транш');
    const row = (await journal()).rows.find((r) => r.id === t)!;
    expect(row).toMatchObject({
      src: 'pt',
      key: `pt:${t}`,
      contractor: { id: cpOther },
      what: 'Журнал · Транш',
      project: { id, name: 'Журнал' },
    });
    // «Проекты контрагентов» выключены — строк траншей нет.
    expect((await journal({ projects: undefined })).rows.some((r) => r.id === t)).toBe(false);
    // Алишер не видит проект другого контрагента, где он не ответственный.
    const onlyAlisher = { visible: visibleProjectIds({ employeeId: alisher, seeAll: false }) };
    expect((await journal({ projects: onlyAlisher })).rows.some((r) => r.id === t)).toBe(false);
    const sum = (projects?: FinJournalOptions['projects']) =>
      inA((tx) =>
        finSummary(tx, '2026-10', {
          tax: false,
          fee: false,
          proj: true,
          projects,
          scope: undefined,
        }),
      );
    const all = (await sum({ visible: undefined })).proj!.received;
    expect(all - (await sum(undefined)).proj!.received).toBe(som(27_000));
    expect(all - (await sum(onlyAlisher)).proj!.received).toBe(som(7_000));
    // Транш не виден, если не виден проект.
    await expect(
      inA((tx) =>
        projectPaymentOf(tx, t, projectVisibility({ employeeId: alisher, seeAll: false }), false),
      ),
    ).rejects.toEqual(expect.objectContaining({ name: 'RecordNotFoundError' }));
  });

  it('плашка «Осталось получить» учитывает транши', async () => {
    const before = await inA((tx) =>
      projectSummary(tx, { employeeId: null, seeAll: true }, TODAY, true),
    );
    const { id } = await project({ name: 'Остаток', plan: som(8_000) });
    await pay(id, som(3_000));
    const after = await inA((tx) =>
      projectSummary(tx, { employeeId: null, seeAll: true }, TODAY, true),
    );
    expect(after.left! - before.left!).toBe(som(5_000));
  });

  it('роль приложения: транш не стереть и не перенести в другой проект', async () => {
    const { id } = await project({ name: 'Запреты' });
    const { id: other } = await project({ name: 'Другой' });
    const { id: t } = await pay(id, som(100));
    await expect(
      inA((tx) => tx.delete(projectPayments).where(eq(projectPayments.id, t))),
    ).rejects.toEqual(permissionDenied);
    await expect(
      inA((tx) =>
        tx.update(projectPayments).set({ projectId: other }).where(eq(projectPayments.id, t)),
      ),
    ).rejects.toEqual(permissionDenied);
    await expect(
      inA((tx) =>
        tx.update(projectPayments).set({ createdBy: null }).where(eq(projectPayments.id, t)),
      ),
    ).rejects.toEqual(permissionDenied);
  });

  it('чужая организация не видна: транши, окно, журнал; к чужому проекту транш не записать', async () => {
    const { id } = await project({ name: 'Изоляция' });
    const { id: t } = await pay(id, som(500));
    expect(await inB((tx) => tx.select().from(projectPayments))).toEqual([]);
    expect(await inB((tx) => projectPaymentCard(tx, t, undefined))).toBeNull();
    expect(await inB((tx) => projectPaymentFileSource(tx, t, undefined))).toBeNull();
    const page = await inB((tx) =>
      listFinJournalPage(tx, query(), {
        tab: 'all',
        deleted: true,
        tax: true,
        fee: true,
        proj: true,
        projects: { visible: undefined },
        scope: undefined,
        t: texts,
      }),
    );
    expect(page.rows).toEqual([]);
    await expect(
      inB((tx) => tx.insert(projectPayments).values({ projectId: id, amount: 100, paidOn: TODAY })),
    ).rejects.toThrow();
    expect(
      await inB((tx) =>
        tx
          .update(projectPayments)
          .set({ amount: 1 })
          .where(eq(projectPayments.id, t))
          .returning({ id: projectPayments.id }),
      ),
    ).toEqual([]);
    expect(await paid(id)).toBe(som(500));
    // Без условия проверки (суперпользователь) транш на месте.
    const [kept] = await db.admin.db
      .select({ amount: projectPayments.amount })
      .from(projectPayments)
      .where(sql`${projectPayments.id} = ${t}`);
    expect(Number(kept!.amount)).toBe(som(500));
  });
});
