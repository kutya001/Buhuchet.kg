import { hashPassword } from '@buhuchet/adapters/password';
import { RecordChangedError, UI_TEXTS, type ListQuery } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from './context';
import {
  assignContractors,
  contractorScope,
  createContractor,
  deleteContractor,
  type ContractorFields,
} from './contractors';
import { readHistory } from './history';
import { createOrganization, type CreatedOrganization } from './organizations';
import { employees, taskComments, tasks } from './schema';
import { seedPermissions, seedRoleTemplates } from './seed';
import { readSpecJson } from './spec-data';
import { createEmployee } from './staff';
import { readStatusHistory } from './status';
import {
  addTaskComment,
  changeTaskStatus,
  contractorTasks,
  createTask,
  currentEmployeeId,
  exportTasks,
  getTask,
  listTaskComments,
  listTasksPage,
  listTaskValues,
  lockTask,
  taskContractorAccess,
  taskPendingStats,
  taskTabCounts,
  taskVisibility,
  updateTask,
  type TaskFields,
  type TaskListOptions,
  type TaskViewer,
} from './tasks';
import {
  createTestDatabase,
  databaseAvailable,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

const TODAY = '2026-10-27';
const t = (key: string) => (UI_TEXTS as Record<string, { ru: string }>)[key]?.ru ?? key;
const query = (patch: Partial<ListQuery> = {}): ListQuery =>
  ({ sort: undefined, page: 1, size: 'all', filters: {}, ...patch }) as ListQuery;
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});
const violates = (constraint: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ constraint_name: constraint }) });

const contractor = (patch: Partial<ContractorFields> = {}): ContractorFields => ({
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
  feeDay: 10,
  paysTo: 'emp',
  gkedConfirmation: null,
  ...patch,
});

describe.skipIf(!databaseAvailable())('Задачи: данные', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  /** Бухгалтер и главный бухгалтер организации А: сотрудник и его пользователь. */
  const acc = { employeeId: '', userId: '' };
  const chief = { employeeId: '', userId: '' };
  const other = { employeeId: '', userId: '' };
  let cpId = '';
  const ctxA = (userId = a.ownerUserId): OrgContext => ({ orgId: a.orgId, userId });
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2], userId?: string) =>
    withOrgContext(db.app.db, ctxA(userId), fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);
  const viewer = (who: { employeeId: string }, patch: Partial<TaskViewer> = {}): TaskViewer => ({
    employeeId: who.employeeId,
    all: false,
    canConfirm: false,
    ...patch,
  });
  const options = (v: TaskViewer, patch: Partial<TaskListOptions> = {}): TaskListOptions => ({
    t,
    today: TODAY,
    viewer: v,
    tab: 'all',
    ...patch,
  });
  const task = (patch: Partial<TaskFields> = {}): TaskFields => ({
    title: 'Собрать первичку за октябрь',
    description: '',
    categoryCode: 'КАТ-001',
    contractorId: null,
    executorEmployeeId: acc.employeeId,
    term: 'day',
    dueDate: '2026-10-30',
    needFile: false,
    confirm: true,
    ...patch,
  });
  /** Поставить задачу от имени главного бухгалтера. */
  const byChief = (patch: Partial<TaskFields> = {}) =>
    inA((tx) => createTask(tx, task(patch), chief.employeeId), chief.userId);

  beforeAll(async () => {
    db = await createTestDatabase();
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    await seedPermissions(db.admin.db, refDB.permissions, { update: false });
    await seedRoleTemplates(db.admin.db, refDB.roleTemplates, { update: false });
    await seedAllPlatformDictionaries(db.admin.db);
    const owner = async (login: string) => ({
      fullName: 'Владелец Организации',
      login,
      passwordHash: await hashPassword('Bh-4821-temp'),
    });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'task-a',
      owner: await owner('task-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'task-b',
      owner: await owner('task-owner-b'),
    });
    const role = (code: string) => a.roles.find((r) => r.templateCode === code)!;
    const add = (login: string, fullName: string, shortName: string, code: string) =>
      inA(async (tx) => {
        const employeeId = await createEmployee(tx, {
          fullName,
          shortName,
          login,
          passwordHash: 'x',
          phone: null,
          role: role(code),
        });
        const [row] = await tx
          .select({ userId: employees.userId })
          .from(employees)
          .where(eq(employees.id, employeeId));
        return { employeeId, userId: row!.userId };
      });
    Object.assign(acc, await add('task-acc', 'Токтогулов Алишер Бакытович', 'Алишер Т.', 'acc'));
    Object.assign(chief, await add('task-chief', 'Кадырова Мээрим Асановна', 'Мээрим К.', 'chief'));
    Object.assign(
      other,
      await add('task-other', 'Осмонова Айгерим Талантовна', 'Айгерим О.', 'acc'),
    );
    cpId = await inA((tx) =>
      createContractor(tx, a.orgId, contractor({ responsibleEmployeeId: acc.employeeId }), null),
    );
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('поставить задачу: постановщик, «К выполнению», история и «История статусов»', async () => {
    const id = await byChief({ contractorId: cpId, description: 'Счета-фактуры и акты' });
    const got = await inA((tx) => getTask(tx, id, undefined));
    expect(got).toMatchObject({
      title: 'Собрать первичку за октябрь',
      description: 'Счета-фактуры и акты',
      category: { code: 'КАТ-001', name: 'Сбор документов' },
      contractor: { id: cpId, name: 'ОсОО «Ала-Тоо Трейд»', responsibleEmployeeId: acc.employeeId },
      executor: { id: acc.employeeId, shortName: 'Алишер Т.' },
      author: { id: chief.employeeId, shortName: 'Мээрим К.' },
      executorFullName: 'Токтогулов Алишер Бакытович',
      status: 'todo',
      confirm: true,
      hasFile: false,
      audit: { createdBy: 'Мээрим К.' },
      version: 1,
    });
    expect(got?.lastStatus?.by).toBe('Мээрим К.');
    const history = await inA((tx) => readHistory(tx, 'task', id));
    expect(history).toMatchObject([{ action: 'create', contractorId: cpId }]);
    const statuses = await inA((tx) => readStatusHistory(tx, 'task', id));
    expect(statuses).toMatchObject([{ from: null, to: 'todo', actor: 'Мээрим К.' }]);
  });

  it('постановщик — только свой сотрудник: подменить его база не даёт', async () => {
    await expect(
      inA((tx) => createTask(tx, task(), chief.employeeId), acc.userId),
    ).rejects.toThrow();
    expect(await inA((tx) => currentEmployeeId(tx), acc.userId)).toBe(acc.employeeId);
  });

  it('чужая организация не видна: задачи и комментарии', async () => {
    const id = await byChief();
    await inA((tx) => addTaskComment(tx, id, 'Комментарий А'), acc.userId);
    expect(await inB((tx) => getTask(tx, id, undefined))).toBeNull();
    expect(await inB((tx) => tx.select().from(tasks))).toEqual([]);
    expect(await inB((tx) => tx.select().from(taskComments))).toEqual([]);
    // Вставить задачу или комментарий в чужую организацию нельзя.
    await expect(
      inB((tx) =>
        tx.insert(tasks).values({
          ...task(),
          orgId: a.orgId,
          authorEmployeeId: chief.employeeId,
          createdBy: b.ownerUserId,
        }),
      ),
    ).rejects.toEqual(permissionDenied);
    await expect(
      inB((tx) => tx.insert(taskComments).values({ orgId: a.orgId, taskId: id, text: 'x' })),
    ).rejects.toThrow();
    // Без контекста не видно ничего.
    expect(await db.app.db.select().from(tasks)).toEqual([]);
  });

  it('комментарии: автор и время ставит база, не меняются и не удаляются', async () => {
    const id = await byChief();
    await inA((tx) => addTaskComment(tx, id, 'По акту сверки расхождение'), acc.userId);
    expect(await inA((tx) => listTaskComments(tx, id))).toMatchObject([
      { author: 'Алишер Т.', text: 'По акту сверки расхождение' },
    ]);
    await expect(
      inA((tx) =>
        tx.insert(taskComments).values({
          orgId: a.orgId,
          taskId: id,
          text: 'от чужого имени',
          authorUserId: chief.userId,
        }),
      ),
    ).rejects.toEqual(permissionDenied);
    await expect(inA((tx) => tx.update(taskComments).set({ text: 'другой' }))).rejects.toEqual(
      permissionDenied,
    );
    await expect(inA((tx) => tx.delete(taskComments))).rejects.toEqual(permissionDenied);
  });

  it('задачи не удаляются; постановщика после вставки не поменять', async () => {
    const id = await byChief();
    await expect(inA((tx) => tx.delete(tasks).where(eq(tasks.id, id)))).rejects.toEqual(
      permissionDenied,
    );
    await expect(
      inA((tx) =>
        tx.update(tasks).set({ authorEmployeeId: acc.employeeId }).where(eq(tasks.id, id)),
      ),
    ).rejects.toEqual(permissionDenied);
  });

  it('ограничения: срок «На месяц» — последний день, подтверждение — только у задачи с ним', async () => {
    await expect(byChief({ term: 'month', dueDate: '2026-10-30' })).rejects.toEqual(
      violates('tasks_month_due_check'),
    );
    const id = await byChief({ term: 'month', dueDate: '2026-10-31', confirm: false });
    await expect(
      inA((tx) => tx.update(tasks).set({ status: 'on_confirm' }).where(eq(tasks.id, id))),
    ).rejects.toEqual(violates('tasks_confirm_status_check'));
  });

  it('видимость: свои задачи, все — по праву, ждущие подтверждения — с правом «Подтверждать»', async () => {
    const mine = await byChief({ title: 'Видимость: моя' });
    const foreign = await byChief({
      title: 'Видимость: чужая',
      executorEmployeeId: other.employeeId,
    });
    const pending = await byChief({
      title: 'Видимость: ждёт',
      executorEmployeeId: other.employeeId,
    });
    await inA((tx) =>
      changeTaskStatus(tx, pending, { from: 'todo', to: 'on_confirm' }, { doneAt: new Date() }),
    );
    const titles = async (v: TaskViewer) =>
      (await inA((tx) => listTasksPage(tx, query(), options(v)))).rows
        .map((r) => r.title)
        .filter((x) => x.startsWith('Видимость'));
    expect(await titles(viewer(acc))).toEqual(['Видимость: моя']);
    expect(await titles(viewer(acc, { canConfirm: true }))).toEqual(
      expect.arrayContaining(['Видимость: моя', 'Видимость: ждёт']),
    );
    expect(await titles(viewer(acc, { canConfirm: true }))).not.toContain('Видимость: чужая');
    expect(await titles(viewer(acc, { all: true }))).toHaveLength(3);
    // Карточка: видимость или доступ через контрагента.
    expect(await inA((tx) => getTask(tx, foreign, taskVisibility(viewer(acc))))).toBeNull();
    expect(await inA((tx) => getTask(tx, mine, taskVisibility(viewer(acc))))).not.toBeNull();
  });

  it('вкладки, срок «с текущего месяца» и плашка «На подтверждении»', async () => {
    const v = viewer(other);
    const old = await byChief({
      title: 'Месяц: прошлый, выполнена',
      executorEmployeeId: other.employeeId,
      dueDate: '2026-09-15',
      confirm: false,
    });
    await inA((tx) => changeTaskStatus(tx, old, { from: 'todo', to: 'done' }), other.userId);
    await byChief({
      title: 'Месяц: прошлый, просрочена',
      executorEmployeeId: other.employeeId,
      dueDate: '2026-09-20',
    });
    await byChief({
      title: 'Месяц: будущий',
      executorEmployeeId: other.employeeId,
      dueDate: '2026-12-01',
    });
    const titles = async (o: TaskListOptions, q = query()) =>
      (await inA((tx) => listTasksPage(tx, q, o))).rows
        .map((r) => r.title)
        .filter((x) => x.startsWith('Месяц'));
    expect(await titles(options(v, { tab: 'mine' }))).toEqual(
      expect.arrayContaining(['Месяц: прошлый, просрочена', 'Месяц: будущий']),
    );
    expect(await titles(options(v, { tab: 'mine' }))).not.toContain('Месяц: прошлый, выполнена');
    expect(await titles(options(v, { tab: 'overdue' }))).toEqual(['Месяц: прошлый, просрочена']);
    // «Поставленные мной» у главного бухгалтера.
    expect(await titles(options(viewer(chief), { tab: 'byme' }))).toHaveLength(2);
    const counts = await inA((tx) => taskTabCounts(tx, v, TODAY));
    expect(counts.overdue).toBe(1);
    expect(counts.mine).toBeGreaterThanOrEqual(2);
    // Плашка: ждущие подтверждения среди видимых и сколько можно подтвердить (свои — нельзя).
    const stats = await inA((tx) => taskPendingStats(tx, viewer(other, { canConfirm: true })));
    expect(stats.pending).toBeGreaterThanOrEqual(1);
    expect(stats.canConfirm).toBe(0);
    const chiefStats = await inA((tx) => taskPendingStats(tx, viewer(chief)));
    expect(chiefStats.canConfirm).toBe(chiefStats.pending);
    // Фильтр «На подтверждении» снимает вкладку и месяц.
    const pendingRows = await inA((tx) =>
      listTasksPage(
        tx,
        query({ filters: { status: { type: 'enum', vals: ['on_confirm'] } } }),
        options(viewer(chief), { tab: 'mine' }),
      ),
    );
    expect(pendingRows.rows.length).toBeGreaterThanOrEqual(1);
    expect(pendingRows.rows.every((r) => r.status === 'on_confirm')).toBe(true);
  });

  it('фильтр «Контрагент»: «Общие задачи» — первым значением; «Вид задачи» в выгрузке', async () => {
    await byChief({ title: 'Общая для фильтра' });
    await byChief({ title: 'По контрагенту для фильтра', contractorId: cpId });
    const values = await inA((tx) =>
      listTaskValues(tx, 'cp', options(viewer(chief, { all: true })), query()),
    );
    expect(values.items[0]).toMatchObject({ value: 'general', label: 'Общие задачи' });
    expect(values.items.map((x) => x.label)).toContain('ОсОО «Ала-Тоо Трейд»');
    const file = await inA((tx) =>
      exportTasks(
        tx,
        query(),
        ['title', 'cp', 'scope', 'date'],
        options(viewer(chief, { all: true })),
      ),
    );
    expect(file.columns.map((c) => c.label)).toEqual([
      'task.col.title',
      'task.col.cp',
      'task.col.scope',
      'task.col.date',
    ]);
    const general = file.rows.find((r) => r[0] === 'Общая для фильтра')!;
    expect(general[2]).toBe('Общая');
    const byCp = file.rows.find((r) => r[0] === 'По контрагенту для фильтра')!;
    expect(byCp.slice(1, 3)).toEqual(['ОсОО «Ала-Тоо Трейд»', 'По контрагенту']);
  });

  it('правка с версией: чужая правка не затирается; смена статуса — в «Истории статусов»', async () => {
    const id = await byChief();
    await inA((tx) =>
      updateTask(tx, id, 1, task({ title: 'Собрать первичку за ноябрь' }), null, null),
    );
    await expect(
      inA((tx) => updateTask(tx, id, 1, task({ title: 'Старая правка' }), null, null)),
    ).rejects.toBeInstanceOf(RecordChangedError);
    await inA((tx) => changeTaskStatus(tx, id, { from: 'todo', to: 'in_progress' }), acc.userId);
    await inA(
      (tx) =>
        updateTask(
          tx,
          id,
          3,
          task({ title: 'Собрать первичку за ноябрь', confirm: false }),
          null,
          null,
        ),
      chief.userId,
    );
    const lock = await inA((tx) => lockTask(tx, id));
    expect(lock).toMatchObject({ status: 'in_progress', confirm: false, version: 4 });
    const statuses = await inA((tx) => readStatusHistory(tx, 'task', id));
    expect(statuses.map((s) => s.to)).toEqual(['todo', 'in_progress']);
    expect(statuses[1]!.actor).toBe('Алишер Т.');
    const history = await inA((tx) => readHistory(tx, 'task', id));
    expect(history.at(-1)!.changes).toEqual([{ field: 'confirm', from: true, to: false }]);
  });

  it('передача контрагента: открытые задачи прежнего ответственного переходят к новому', async () => {
    const cp = await inA((tx) =>
      createContractor(
        tx,
        a.orgId,
        contractor({ inn: '02000000000077', responsibleEmployeeId: acc.employeeId }),
        null,
      ),
    );
    const open = await byChief({ contractorId: cp, title: 'Передача: открытая' });
    const done = await byChief({ contractorId: cp, title: 'Передача: выполнена', confirm: false });
    await inA((tx) => changeTaskStatus(tx, done, { from: 'todo', to: 'done' }));
    const foreign = await byChief({
      contractorId: cp,
      title: 'Передача: чужая',
      executorEmployeeId: chief.employeeId,
    });
    await inA((tx) => assignContractors(tx, [cp], other.employeeId, undefined));
    const exec = async (id: string) => (await inA((tx) => lockTask(tx, id)))!.executorEmployeeId;
    expect(await exec(open)).toBe(other.employeeId);
    expect(await exec(done)).toBe(acc.employeeId);
    expect(await exec(foreign)).toBe(chief.employeeId);
    const history = await inA((tx) => readHistory(tx, 'task', open));
    expect(history.at(-1)).toMatchObject({
      action: 'update',
      contractorId: cp,
      changes: [{ field: 'executorEmployeeId', from: acc.employeeId, to: other.employeeId }],
    });
    // Вкладка карточки контрагента и доступ через контрагента.
    const tab = await inA((tx) => contractorTasks(tx, cp));
    expect(tab).toMatchObject({ total: 3, open: 2 });
    const access = taskContractorAccess(contractorScope(other.employeeId));
    expect(await inA((tx) => getTask(tx, foreign, access))).not.toBeNull();
    expect(
      await inA((tx) =>
        getTask(tx, foreign, taskContractorAccess(contractorScope(acc.employeeId))),
      ),
    ).toBeNull();
    // Удалённый контрагент уносит свои задачи (прототип: «вместе с задачами и файлами карточки»).
    await inA((tx) => deleteContractor(tx, { id: cp, name: 'x', inn: '02000000000077' }));
    expect(await inA((tx) => lockTask(tx, open))).toBeNull();
    expect(
      await db.admin.db
        .select({ n: sql<number>`count(*)::int` })
        .from(tasks)
        .where(eq(tasks.id, open)),
    ).toEqual([{ n: 0 }]);
  });
});
