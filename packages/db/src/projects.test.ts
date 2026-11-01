import type { ListQuery } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from './context';
import { createContractor, type ContractorFields } from './contractors';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  addProjectWork,
  contractorProjectCount,
  contractorProjects,
  createProject,
  listProjectsPage,
  projectCard,
  projectOf,
  projectsForTask,
  projectSummary,
  projectVisibility,
  setProjectStatus,
  setProjectWorkDone,
  taskProjectAllowed,
  updateProject,
  type ProjectInput,
  type ProjectListOptions,
  type ProjectViewer,
} from './projects';
import { contractors, projectMembers, projects, projectWorks, tasks } from './schema';
import { seedPermissions, seedRoleTemplates } from './seed';
import { readSpecJson } from './spec-data';
import { createEmployee } from './staff';
import { readStatusHistory } from './status';
import { createTask } from './tasks';
import {
  createTestDatabase,
  databaseAvailable,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

/*
 * Проекты контрагентов (задача 2.26; прототип modules/projects.js `projVisible`, `projTabs`,
 * `openProject`, `projectDlg`, `setProjStatus`): создание с проверками окна, кто видит проект, вкладки и
 * плашки, «Изменить проект» (сделанная работа остаётся), шкала статусов с «Историей статусов», работы в
 * карточке, проект у задачи, запреты роли приложения, изоляция организаций.
 */

const TODAY = '2026-11-01';
const texts = (key: string) => key;
const som = (v: number) => v * 100;
const refused = (code: string, status = 400) =>
  expect.objectContaining({ name: 'ProjectRefusedError', code, status });
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

/** Отказ политики RLS (`WITH CHECK`): строка не своей организации. */
const RLS_DENIED = {
  cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }),
};

describe.skipIf(!databaseAvailable())('Проекты контрагентов', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let alisher = '';
  let meerim = '';
  let blocked = '';
  let cpA = '';
  let cpOther = '';
  let cpArchived = '';
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId } as OrgContext, fn);
  const input = (patch: Partial<ProjectInput> = {}): ProjectInput => ({
    name: 'Восстановление учёта 2024–2025',
    startsOn: '2026-11-01',
    endsOn: '2026-12-31',
    description: '',
    plan: som(50_000),
    members: [alisher],
    lead: alisher,
    works: [],
    ...patch,
  });
  const create = (
    patch: Partial<ProjectInput & { contractorId: string; status: 'planned' | 'in_progress' }> = {},
    scope?: ReturnType<typeof sql>,
  ) =>
    inA((tx) =>
      createProject(tx, { contractorId: cpA, status: 'planned', ...input(), ...patch }, { scope }),
    );
  const locked = (id: string) => inA((tx) => projectOf(tx, id, undefined, true));
  const viewer = (employeeId: string | null, seeAll = false): ProjectViewer => ({
    employeeId,
    seeAll,
  });
  const list = (o: Partial<ProjectListOptions> = {}) =>
    inA((tx) =>
      listProjectsPage(tx, query({ size: 'all' } as Partial<ListQuery>), {
        t: texts,
        today: TODAY,
        viewer: viewer(null, true),
        tab: 'all',
        money: true,
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
      slug: 'proj-a',
      owner: owner('proj-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810477',
      slug: 'proj-b',
      owner: owner('proj-owner-b'),
    });
    const role = a.roles.find((r) => r.templateCode === 'acc')!;
    const employee = (fullName: string, shortName: string, login: string) =>
      inA((tx) =>
        createEmployee(tx, { fullName, shortName, login, passwordHash: 'x', phone: null, role }),
      );
    alisher = await employee('Токтогулов Алишер Бакытович', 'Алишер Т.', 'proj-alisher');
    meerim = await employee('Касымова Мээрим Талантовна', 'Мээрим К.', 'proj-meerim');
    blocked = await employee('Уволенный Сотрудник', 'Уволенный С.', 'proj-blocked');
    await inA((tx) => tx.execute(sql`update employees set active = false where id = ${blocked}`));
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

  it('«Создать проект»: проверки окна, контрагент в области и не в архиве, сотрудники действующие', async () => {
    await expect(create({ name: '  ' })).rejects.toEqual(refused('project_name_required'));
    await expect(create({ endsOn: '2026-10-31' })).rejects.toEqual(refused('project_dates_order'));
    await expect(create({ members: [] })).rejects.toEqual(refused('project_members_required'));
    await expect(create({ lead: meerim })).rejects.toEqual(refused('project_lead_invalid'));
    await expect(create({ plan: -1 })).rejects.toEqual(refused('project_plan_invalid'));
    await expect(create({ members: [blocked], lead: blocked })).rejects.toEqual(
      refused('project_members_required'),
    );
    await expect(
      create({ works: [{ name: 'Акт сверки', executorEmployeeId: blocked, due: null }] }),
    ).rejects.toEqual(refused('project_work_invalid'));
    await expect(create({ contractorId: cpArchived })).rejects.toEqual(
      refused('project_contractor_required', 409),
    );
    await expect(create({}, sql`false`)).rejects.toEqual(refused('project_contractor_required'));
    await expect(create({ contractorId: 'не-номер' })).rejects.toEqual(
      refused('project_contractor_required'),
    );
  });

  it('новый проект: ответственные по порядку, работы без пустых, история и «История статусов»', async () => {
    const { id } = await create({
      status: 'in_progress',
      members: [meerim, alisher],
      lead: alisher,
      works: [
        { name: ' Собрать выписки ', executorEmployeeId: meerim, due: '2026-11-10' },
        { name: '  ', executorEmployeeId: '', due: null },
      ],
    });
    const card = (await inA((tx) => projectCard(tx, id, undefined)))!;
    expect(card.project).toMatchObject({ status: 'in_progress', plan: som(50_000), version: 1 });
    expect(card.members).toEqual([meerim, alisher]);
    expect(card.leadName).toBe('Алишер Т.');
    expect(card.memberNames.map((m) => m.name)).toEqual(['Мээрим К.', 'Алишер Т.']);
    expect(card.works).toEqual([
      expect.objectContaining({ name: 'Собрать выписки', due: '2026-11-10', done: false }),
    ]);
    expect(card.history).toEqual([
      expect.objectContaining({
        action: 'create',
        changes: expect.arrayContaining([{ field: 'status', to: 'in_progress' }]),
      }),
    ]);
    const statuses = await inA((tx) => readStatusHistory(tx, 'project', id));
    expect(statuses.map((h) => [h.from, h.to])).toEqual([[null, 'in_progress']]);
  });

  it('кто видит: область «Все»; ответственный контрагента; один из ответственных проекта', async () => {
    const { id: own } = await create({ name: 'Проект Алишера' });
    const { id: foreign } = await create({
      contractorId: cpOther,
      name: 'Проект Мээрим',
      members: [meerim],
      lead: meerim,
    });
    const { id: shared } = await create({
      contractorId: cpOther,
      name: 'Общий проект',
      members: [meerim, alisher],
      lead: meerim,
    });
    const seen = async (v: ProjectViewer) => (await list({ viewer: v })).rows.map((r) => r.id);
    const alisherSees = await seen(viewer(alisher));
    expect(alisherSees).toEqual(expect.arrayContaining([own, shared]));
    expect(alisherSees).not.toContain(foreign);
    const meerimSees = await seen(viewer(meerim));
    expect(meerimSees).toEqual(expect.arrayContaining([foreign, shared]));
    expect(meerimSees).not.toContain(own);
    expect(await seen(viewer(null))).toEqual([]);
    expect(await seen(viewer(null, true))).toEqual(expect.arrayContaining([own, foreign, shared]));
    // Карточка невидимого проекта — как будто его нет.
    expect(
      await inA((tx) => projectCard(tx, foreign, projectVisibility(viewer(alisher)))),
    ).toBeNull();
  });

  it('вкладки и плашки: «Активные», «Мои», срок прошёл, осталось получить; деньги — только кто их видит', async () => {
    const before = await inA((tx) => projectSummary(tx, viewer(alisher), TODAY, true));
    const { id: late } = await create({
      name: 'Просроченный',
      status: 'in_progress',
      startsOn: '2026-09-01',
      endsOn: '2026-10-15',
      plan: som(10_000),
    });
    const { id: done } = await create({ name: 'Будет завершён', status: 'in_progress' });
    await inA(async (tx) =>
      setProjectStatus(tx, await projectOf(tx, done, undefined, true), 'done', {}),
    );
    const after = await inA((tx) => projectSummary(tx, viewer(alisher), TODAY, true));
    expect(after.active - before.active).toBe(1);
    expect(after.mine - before.mine).toBe(1);
    expect(after.overdue - before.overdue).toBe(1);
    expect(after.left! - before.left!).toBe(som(10_000));
    expect((await inA((tx) => projectSummary(tx, viewer(alisher), TODAY, false))).left).toBeNull();
    const active = (await list({ tab: 'active', viewer: viewer(alisher) })).rows.map((r) => r.id);
    expect(active).toContain(late);
    expect(active).not.toContain(done);
    const mine = (await list({ tab: 'mine', viewer: viewer(alisher) })).rows.map((r) => r.id);
    expect(mine).toEqual(expect.arrayContaining([late, done]));
    const row = (await list({ viewer: viewer(alisher) })).rows.find((r) => r.id === late)!;
    expect(row).toMatchObject({ overdue: true, plan: som(10_000), paid: 0 });
    const hidden = (await list({ viewer: viewer(alisher), money: false })).rows.find(
      (r) => r.id === late,
    )!;
    expect(hidden).toMatchObject({ plan: null, paid: null });
  });

  it('«Изменить проект»: версия, сделанная работа остаётся, история «было → стало»', async () => {
    const { id } = await create({
      members: [alisher, meerim],
      works: [
        { name: 'Учётная политика', executorEmployeeId: alisher, due: '2026-11-07' },
        { name: 'Настройка 1С', executorEmployeeId: meerim, due: '2026-11-22' },
      ],
    });
    const before = (await inA((tx) => projectCard(tx, id, undefined)))!;
    const [policy, setup] = before.works;
    await inA(async (tx) =>
      setProjectWorkDone(tx, await projectOf(tx, id, undefined, true), policy!.id, true),
    );
    await expect(
      inA(async (tx) =>
        updateProject(tx, await projectOf(tx, id, undefined, true), { ...input(), version: 0 }),
      ),
    ).rejects.toMatchObject({ name: 'RecordChangedError' });
    // Во входе нет ни сделанной, ни несделанной работы: сделанная остаётся, несделанная убирается.
    const { changed } = await inA(async (tx) => {
      const l = await projectOf(tx, id, undefined, true);
      return updateProject(tx, l, {
        ...input({
          name: 'Постановка учёта',
          plan: null,
          members: [meerim],
          lead: meerim,
          works: [{ name: 'Кадровые документы', executorEmployeeId: meerim, due: null }],
        }),
        version: l.project.version,
      });
    });
    expect(changed).toBe(true);
    const card = (await inA((tx) => projectCard(tx, id, undefined)))!;
    expect(card.project).toMatchObject({
      name: 'Постановка учёта',
      plan: null,
      leadEmployeeId: meerim,
      version: 2,
    });
    expect(card.members).toEqual([meerim]);
    expect(card.works.map((w) => [w.name, w.done])).toEqual([
      ['Кадровые документы', false],
      ['Учётная политика', true],
    ]);
    expect(card.works.some((w) => w.id === setup!.id)).toBe(false);
    const update = card.history.find((h) => h.action === 'update')!;
    expect(update.changes).toEqual(
      expect.arrayContaining([
        { field: 'name', from: 'Восстановление учёта 2024–2025', to: 'Постановка учёта' },
        { field: 'plan', from: som(50_000), to: null },
        { field: 'lead', from: alisher, to: meerim },
        { field: 'worksRemoved', from: [], to: ['Настройка 1С'] },
        { field: 'worksAdded', from: [], to: ['Кадровые документы'] },
      ]),
    );
    expect(card.names[meerim]).toBe('Мээрим К.');
    // Работа с чужим номером — отказ.
    await expect(
      inA(async (tx) => {
        const l = await projectOf(tx, id, undefined, true);
        return updateProject(tx, l, {
          ...input({
            members: [meerim],
            lead: meerim,
            works: [
              {
                id: '00000000-0000-4000-8000-000000000000',
                name: 'Подмена',
                executorEmployeeId: meerim,
                due: null,
              },
            ],
          }),
          version: l.project.version,
        });
      }),
    ).rejects.toEqual(refused('project_work_invalid'));
  });

  it('шкала статусов: шаги вперёд, «Отменить проект», откат на шаг с причиной', async () => {
    const { id } = await create();
    const step = (
      to: Parameters<typeof setProjectStatus>[2],
      o: Parameters<typeof setProjectStatus>[3] = {},
    ) => inA(async (tx) => setProjectStatus(tx, await projectOf(tx, id, undefined, true), to, o));
    await expect(step('done')).rejects.toEqual(refused('project_status_invalid', 409));
    await step('in_progress');
    await expect(step('planned', { rollback: true, reason: '  ' })).rejects.toEqual(
      refused('project_status_invalid'),
    );
    await step('planned', { rollback: true, reason: 'Клиент перенёс начало' });
    await step('cancelled');
    await expect(step('in_progress')).rejects.toEqual(refused('project_status_invalid', 409));
    await expect(
      step('in_progress', { rollback: true, reason: 'Ошибся', version: 1 }),
    ).rejects.toMatchObject({
      name: 'RecordChangedError',
    });
    await step('in_progress', { rollback: true, reason: 'Клиент передумал' });
    const hist = await inA((tx) => readStatusHistory(tx, 'project', id));
    expect(hist.map((h) => [h.from, h.to, h.rollback])).toEqual([
      [null, 'planned', false],
      ['planned', 'in_progress', false],
      ['in_progress', 'planned', true],
      ['planned', 'cancelled', false],
      ['cancelled', 'in_progress', true],
    ]);
    expect(hist[2]).toMatchObject({ reason: 'Клиент перенёс начало' });
    expect((await locked(id)).project).toMatchObject({ status: 'in_progress', version: 5 });
  });

  it('работы в карточке: «Сделано» и «Добавить работу» — исполнитель из ответственных; история', async () => {
    const { id } = await create({
      works: [{ name: 'Акт сверки', executorEmployeeId: alisher, due: '2026-10-20' }],
    });
    const workId = (await inA((tx) => projectCard(tx, id, undefined)))!.works[0]!.id;
    const done = (d: boolean) =>
      inA(async (tx) =>
        setProjectWorkDone(tx, await projectOf(tx, id, undefined, true), workId, d),
      );
    expect(await done(true)).toEqual({ changed: true });
    expect(await done(true)).toEqual({ changed: false });
    expect(await done(false)).toEqual({ changed: true });
    const add = (exec: string, name = 'Сдать уточнённые отчёты') =>
      inA(async (tx) =>
        addProjectWork(tx, await projectOf(tx, id, undefined, true), {
          name,
          executorEmployeeId: exec,
          due: '2026-11-17',
        }),
      );
    await expect(add(meerim)).rejects.toEqual(refused('project_work_invalid'));
    await expect(add(alisher, ' ')).rejects.toEqual(refused('project_work_invalid'));
    await add(alisher);
    const card = (await inA((tx) => projectCard(tx, id, undefined)))!;
    expect(card.works.map((w) => w.name)).toEqual(['Акт сверки', 'Сдать уточнённые отчёты']);
    expect(card.history.map((h) => h.action)).toEqual([
      'work_add',
      'work_undone',
      'work_done',
      'create',
    ]);
    expect(card.history[0]!.changes).toEqual([
      { field: 'work', to: 'Сдать уточнённые отчёты' },
      { field: 'executor', to: alisher },
      { field: 'due', to: '2026-11-17' },
    ]);
    // Чужая работа (другого проекта) — не найдена.
    const { id: other } = await create({
      works: [{ name: 'Другая', executorEmployeeId: alisher, due: null }],
    });
    await expect(
      inA(async (tx) =>
        setProjectWorkDone(tx, await projectOf(tx, other, undefined, true), workId, true),
      ),
    ).rejects.toMatchObject({ name: 'RecordNotFoundError' });
  });

  it('задача по проекту: только проект своего контрагента, отменённый не предлагается', async () => {
    const { id } = await create({ name: 'Проект для задач' });
    const { id: cancelled } = await create({ name: 'Отменённый' });
    await inA(async (tx) =>
      setProjectStatus(tx, await projectOf(tx, cancelled, undefined, true), 'cancelled', {}),
    );
    const offered = await inA((tx) => projectsForTask(tx, cpA, null, undefined));
    expect(offered.map((p) => p.id)).toContain(id);
    expect(offered.map((p) => p.id)).not.toContain(cancelled);
    expect(await inA((tx) => taskProjectAllowed(tx, id, cpA, null, undefined))).toBe(true);
    expect(await inA((tx) => taskProjectAllowed(tx, id, cpOther, null, undefined))).toBe(false);
    expect(await inA((tx) => taskProjectAllowed(tx, cancelled, cpA, null, undefined))).toBe(false);
    // Мээрим (область «Свои», не ответственная ни за контрагента, ни в проекте) проекта не видит: его
    // нет в поле «Проект» и к задаче его не привязать; уже выбранный у задачи — остаётся.
    const hidden = projectVisibility(viewer(meerim));
    expect(
      (await inA((tx) => projectsForTask(tx, cpA, null, hidden))).map((p) => p.id),
    ).not.toContain(id);
    expect(await inA((tx) => taskProjectAllowed(tx, id, cpA, null, hidden))).toBe(false);
    expect((await inA((tx) => projectsForTask(tx, cpA, id, hidden))).map((p) => p.id)).toContain(
      id,
    );
    expect(await inA((tx) => taskProjectAllowed(tx, id, cpA, id, hidden))).toBe(true);
    const seen = projectVisibility(viewer(alisher));
    expect((await inA((tx) => projectsForTask(tx, cpA, null, seen))).map((p) => p.id)).toContain(
      id,
    );
    const task = {
      title: 'Подготовить акт',
      description: '',
      categoryCode: 'КАТ-001',
      contractorId: cpA,
      projectId: id,
      executorEmployeeId: alisher,
      term: 'day' as const,
      dueDate: '2026-11-05',
      needFile: false,
      confirm: false,
    };
    const author = a.ownerEmployeeId;
    await inA((tx) => createTask(tx, task, author));
    const card = (await inA((tx) => projectCard(tx, id, undefined)))!;
    expect(card.tasks).toEqual([
      expect.objectContaining({ title: 'Подготовить акт', open: true, executorName: 'Алишер Т.' }),
    ]);
    // Проект другого контрагента у задачи не записать: составной внешний ключ.
    await expect(
      inA((tx) => createTask(tx, { ...task, contractorId: cpOther }, author)),
    ).rejects.toThrow();
    // У общей задачи проекта нет.
    await expect(
      inA((tx) => createTask(tx, { ...task, contractorId: null }, author)),
    ).rejects.toThrow();
    expect(await inA((tx) => contractorProjectCount(tx, cpA))).toBeGreaterThan(0);
    const lines = await inA((tx) => contractorProjects(tx, cpA));
    expect(lines.find((l) => l.id === id)).toMatchObject({
      status: 'planned',
      leadName: 'Алишер Т.',
      paid: 0,
    });
  });

  it('роль приложения не удаляет проекты и сделанные работы, не меняет контрагента и автора', async () => {
    const { id } = await create({
      works: [{ name: 'Сделанная', executorEmployeeId: alisher, due: null }],
    });
    const workId = (await inA((tx) => projectCard(tx, id, undefined)))!.works[0]!.id;
    await inA(async (tx) =>
      setProjectWorkDone(tx, await projectOf(tx, id, undefined, true), workId, true),
    );
    await expect(inA((tx) => tx.delete(projects).where(eq(projects.id, id)))).rejects.toEqual(
      permissionDenied,
    );
    await expect(
      inA((tx) => tx.update(projects).set({ contractorId: cpOther }).where(eq(projects.id, id))),
    ).rejects.toEqual(permissionDenied);
    await expect(
      inA((tx) => tx.update(projects).set({ createdBy: null }).where(eq(projects.id, id))),
    ).rejects.toEqual(permissionDenied);
    await expect(
      inA((tx) =>
        tx.update(projectWorks).set({ projectId: id }).where(eq(projectWorks.id, workId)),
      ),
    ).rejects.toEqual(permissionDenied);
    await expect(
      inA((tx) =>
        tx.update(projectMembers).set({ position: 5 }).where(eq(projectMembers.projectId, id)),
      ),
    ).rejects.toEqual(permissionDenied);
    await expect(inA((tx) => tx.execute(sql`truncate project_works`))).rejects.toEqual(
      permissionDenied,
    );
    // Сделанную работу не удалить: строка не задета.
    expect(
      await inA((tx) =>
        tx
          .delete(projectWorks)
          .where(eq(projectWorks.id, workId))
          .returning({ id: projectWorks.id }),
      ),
    ).toEqual([]);
  });

  it('чужая организация не видна: проекты, ответственные, работы, задачи по проекту', async () => {
    const { id } = await create({
      works: [{ name: 'Работа А', executorEmployeeId: alisher, due: null }],
    });
    expect(await inB((tx) => tx.select().from(projects))).toEqual([]);
    expect(await inB((tx) => tx.select().from(projectMembers))).toEqual([]);
    expect(await inB((tx) => tx.select().from(projectWorks))).toEqual([]);
    expect(await inB((tx) => projectCard(tx, id, undefined))).toBeNull();
    expect(await inB((tx) => contractorProjects(tx, cpA))).toEqual([]);
    expect(await inB((tx) => projectsForTask(tx, cpA, null, undefined))).toEqual([]);
    const page = await inB((tx) =>
      listProjectsPage(tx, query(), {
        t: texts,
        today: TODAY,
        viewer: viewer(null, true),
        tab: 'all',
        money: true,
      }),
    );
    expect(page.rows).toEqual([]);
    // Проект с контрагентом чужой организации не записать: составной внешний ключ.
    await expect(
      inB((tx) =>
        tx.insert(projects).values({
          contractorId: cpA,
          name: 'Чужой',
          startsOn: TODAY,
          endsOn: TODAY,
          leadEmployeeId: alisher,
        }),
      ),
    ).rejects.toThrow();
    // Строку с явным org_id чужой организации не даёт политика RLS (`WITH CHECK`).
    await expect(
      inB((tx) =>
        tx.insert(projects).values({
          orgId: a.orgId,
          contractorId: cpA,
          name: 'Чужой с org_id',
          startsOn: TODAY,
          endsOn: TODAY,
          leadEmployeeId: alisher,
        }),
      ),
    ).rejects.toMatchObject(RLS_DENIED);
    // Ответственного и работу к чужому проекту — тоже.
    await expect(
      inB((tx) => tx.insert(projectMembers).values({ projectId: id, employeeId: alisher })),
    ).rejects.toThrow();
    await expect(
      inB((tx) =>
        tx.insert(projectMembers).values({ orgId: a.orgId, projectId: id, employeeId: alisher }),
      ),
    ).rejects.toMatchObject(RLS_DENIED);
    await expect(
      inB((tx) =>
        tx
          .insert(projectWorks)
          .values({ projectId: id, name: 'Чужая', executorEmployeeId: alisher }),
      ),
    ).rejects.toThrow();
    // Изменить чужой проект нельзя: ни одной строки не задето.
    expect(
      await inB((tx) =>
        tx
          .update(projects)
          .set({ name: 'Подмена' })
          .where(eq(projects.id, id))
          .returning({ id: projects.id }),
      ),
    ).toEqual([]);
    expect(
      await inB((tx) =>
        tx
          .delete(projectWorks)
          .where(eq(projectWorks.projectId, id))
          .returning({ id: projectWorks.id }),
      ),
    ).toEqual([]);
    expect(await inB((tx) => tx.select().from(tasks))).toEqual([]);
    expect((await locked(id)).project.name).toBe('Восстановление учёта 2024–2025');
  });
});
