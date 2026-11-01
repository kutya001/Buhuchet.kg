import type { MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  ApiError,
  ContractorHistory,
  ContractorProjects,
  FileUploadTicket,
  FinJournalRow,
  listPageSchema,
  OperationEdited,
  ProjectCard,
  ProjectForm,
  ProjectList,
  ProjectPaymentWindow,
  ProjectSaved,
  ProjectSummary,
  Task,
  TaskFormOptions,
  TaskProjects,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const som = (n: number) => n * 100;
const ON = { projects: true, tasks: true, files: true, fee: false };
const MISSING = '00000000-0000-4000-8000-0000000000ff';

// Сегодня в тестах — 18.10.2026 (`createTestDeps`).
describe.skipIf(!databaseAvailable())('Проекты контрагентов — методы API (задача 2.26)', () => {
  let f: Fixture;
  let owner: string;
  let chief: string;
  let acc: string;
  let hr: string;
  let senior: string;
  let ownerB: string;
  let cpAcc = '';
  let cpChief = '';
  let cpArch = '';

  const employee = (login: string) => f.people[login]!.employeeId;
  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    cookie: string,
    body?: unknown,
  ) => apiRequest(f.app, method, path, cookie, body);
  const expectStatus = async (res: Response, status: number) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return res;
  };
  const refused = async (res: Response, status: number) =>
    ApiError.parse(await (await expectStatus(res, status)).json()).error.code;
  const get = async <T>(cookie: string, path: string, parse: (x: unknown) => T) =>
    parse(await (await expectStatus(await call('GET', path, cookie), 200)).json());
  const card = (cookie: string, id: string) =>
    get(cookie, `/api/projects/${id}`, (x) => ProjectCard.parse(x));
  const list = (cookie: string, tab = 'all') =>
    get(cookie, `/api/projects?tab=${tab}&size=all`, (x) => ProjectList.parse(x));
  const summary = (cookie: string) =>
    get(cookie, '/api/projects/summary', (x) => ProjectSummary.parse(x));
  const project = (body: Record<string, unknown> = {}) => ({
    contractorId: cpAcc,
    name: 'Восстановление учёта 2024–2025',
    startsOn: '2026-10-01',
    endsOn: '2026-12-31',
    plan: som(50_000),
    members: [employee('acc-a')],
    lead: employee('acc-a'),
    ...body,
  });
  const create = async (cookie: string, body: Record<string, unknown> = {}) =>
    ProjectSaved.parse(
      await (
        await expectStatus(await call('POST', '/api/projects', cookie, project(body)), 201)
      ).json(),
    ).id;
  const status = (cookie: string, id: string, body: Record<string, unknown>) =>
    call('POST', `/api/projects/${id}/status`, cookie, body);
  const features = (orgId: string, on: Record<string, boolean>) =>
    f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: on, reportConfirm: false })
      .where(eq(schema.orgSettings.orgId, orgId));

  async function contractor(name: string, inn: string, responsible: string, archived = false) {
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
        paysTo: 'emp',
        ...(archived ? { serviceStatus: 'archived' as const } : {}),
      })
      .returning({ id: schema.contractors.id });
    return row!.id;
  }

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    await features(f.a.orgId, ON);
    await features(f.b.orgId, ON);
    [owner, chief, acc, hr, senior, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'chief-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'hr-a', TEST_PASSWORD),
      signIn(f.app, 'senior-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
    ]);
    cpAcc = await contractor('ОсОО «Ала-Тоо Трейд»', '03744097401851', employee('acc-a'));
    cpChief = await contractor('ИП Садыков', '20101199000123', employee('chief-a'));
    cpArch = await contractor('ОсОО «Архив»', '03744097401853', employee('acc-a'), true);
  }, 120_000);

  afterAll(async () => {
    await f?.t.drop();
  });

  it('вход, права, функция и изоляция организаций', async () => {
    const id = await create(chief);
    for (const [method, path] of [
      ['GET', '/api/projects'],
      ['GET', '/api/projects/summary'],
      ['POST', '/api/projects'],
      ['GET', `/api/projects/${id}`],
      ['POST', `/api/projects/${id}/status`],
    ] as const) {
      expect((await apiRequest(f.app, method, path)).status).toBe(401);
    }
    // «Старший» не видит проектов; «Бухгалтер» видит, но не ведёт.
    expect((await call('GET', '/api/projects', senior)).status).toBe(403);
    expect((await call('GET', `/api/projects/${id}`, senior)).status).toBe(403);
    expect((await call('GET', '/api/projects/form', acc)).status).toBe(403);
    expect((await call('POST', '/api/projects', acc, project())).status).toBe(403);
    expect((await status(acc, id, { to: 'in_progress', version: 1 })).status).toBe(403);
    // Другая организация: проекта нет, контрагента не выбрать.
    expect(await refused(await call('GET', `/api/projects/${id}`, ownerB), 404)).toBe(
      'project_not_found',
    );
    expect((await list(ownerB)).total).toBe(0);
    expect(await refused(await call('POST', '/api/projects', ownerB, project()), 400)).toBe(
      'project_contractor_required',
    );
    expect((await call('GET', `/api/projects/${MISSING}`, owner)).status).toBe(404);
    expect((await call('GET', '/api/projects/not-a-uuid', owner)).status).toBe(400);
    expect((await call('POST', '/api/projects', owner, { ...project(), extra: 1 })).status).toBe(
      400,
    );
    // «Проекты контрагентов» выключены — 403 `projects_off`.
    await features(f.a.orgId, { ...ON, projects: false });
    try {
      expect(await refused(await call('GET', '/api/projects', owner), 403)).toBe('projects_off');
      expect(await refused(await call('GET', `/api/projects/${id}`, owner), 403)).toBe(
        'projects_off',
      );
    } finally {
      await features(f.a.orgId, ON);
    }
  });

  it('окно и «Создать проект»: проверки полей, контрагент области, архивный — 409', async () => {
    const form = await get(chief, `/api/projects/form?contractorId=${cpAcc}`, (x) =>
      ProjectForm.parse(x),
    );
    expect(form.contractors.map((c) => c.id)).toEqual(expect.arrayContaining([cpAcc, cpChief]));
    expect(form.contractors.map((c) => c.id)).not.toContain(cpArch);
    expect(form.contractors.find((c) => c.id === cpAcc)!.responsible).toBe(employee('acc-a'));
    expect(form).toMatchObject({ me: employee('chief-a'), today: '2026-10-18', money: true });
    const bad = async (body: Record<string, unknown>, status = 400) =>
      refused(await call('POST', '/api/projects', chief, project(body)), status);
    expect(await bad({ name: ' ' })).toBe('project_name_required');
    expect(await bad({ endsOn: '2026-09-01' })).toBe('project_dates_order');
    expect(await bad({ members: [] })).toBe('project_members_required');
    expect(await bad({ lead: employee('chief-a') })).toBe('project_lead_invalid');
    expect(await bad({ contractorId: cpArch }, 409)).toBe('project_contractor_required');
    expect((await call('POST', '/api/projects', chief, project({ plan: -5 }))).status).toBe(400);
  });

  it('кто видит: ответственный контрагента, ответственный проекта; деньги — кто их видит', async () => {
    const own = await create(chief, { name: 'Проект на контрагенте бухгалтера' });
    const foreign = await create(chief, {
      contractorId: cpChief,
      name: 'Проект главного',
      members: [employee('chief-a')],
      lead: employee('chief-a'),
    });
    const shared = await create(chief, {
      contractorId: cpChief,
      name: 'Общий проект',
      status: 'in_progress',
      members: [employee('chief-a'), employee('acc-a')],
      lead: employee('chief-a'),
    });
    const seen = (await list(acc)).items.map((r) => r.id);
    expect(seen).toEqual(expect.arrayContaining([own, shared]));
    expect(seen).not.toContain(foreign);
    expect(await refused(await call('GET', `/api/projects/${foreign}`, acc), 404)).toBe(
      'project_not_found',
    );
    // «Мои» — где он ответственный, «Активные» — «Планируется» и «В работе».
    expect((await list(acc, 'mine')).items.map((r) => r.id)).toEqual(
      expect.arrayContaining([own, shared]),
    );
    expect((await list(chief)).items.map((r) => r.id)).toEqual(
      expect.arrayContaining([own, foreign, shared]),
    );
    // «Бухгалтер» не видит денег: ни в списке, ни в карточке, ни в плашке.
    expect((await list(acc)).items.find((r) => r.id === own)).toMatchObject({
      plan: null,
      paid: null,
    });
    expect((await card(acc, own)).money).toBeNull();
    const s = await summary(acc);
    expect(s.left).toBeNull();
    expect(s.can).toEqual({ keep: false, rollback: false, task: false, money: false });
    expect((await card(chief, own)).money).toEqual({ plan: som(50_000), paid: 0 });
    expect((await summary(chief)).can).toMatchObject({ keep: true, task: true, money: true });
    // «Кадры» (область «Свои») чужих проектов не видят.
    expect((await list(hr)).items.map((r) => r.id)).not.toContain(own);
    // Вкладка «Проекты» карточки контрагента — видимые проекты; «Новый проект» — с правом.
    const tab = await get(acc, `/api/contractors/${cpAcc}/projects`, (x) =>
      ContractorProjects.parse(x),
    );
    expect(tab.items.map((p) => p.id)).toContain(own);
    expect(tab).toMatchObject({ canCreate: false, money: false });
    expect((await call('GET', `/api/contractors/${cpChief}/projects`, acc)).status).toBe(404);
    expect(
      (await get(chief, `/api/contractors/${cpArch}/projects`, (x) => ContractorProjects.parse(x)))
        .canCreate,
    ).toBe(false);
  });

  it('«Изменить»: версия, стоимость без права не меняется; история «было → стало»', async () => {
    const id = await create(chief, {
      works: [{ name: 'Собрать выписки', executorId: employee('acc-a'), due: '2026-10-25' }],
    });
    const c = await card(chief, id);
    const edit = (cookie: string, body: Record<string, unknown>) =>
      call('PUT', `/api/projects/${id}`, cookie, {
        version: c.version,
        name: c.name,
        startsOn: c.startsOn,
        endsOn: c.endsOn,
        description: '',
        plan: som(60_000),
        members: [employee('acc-a'), employee('chief-a')],
        lead: employee('chief-a'),
        works: c.works.map((w) => ({
          id: w.id,
          name: w.name,
          executorId: w.executor.id,
          due: w.due,
        })),
        ...body,
      });
    expect((await edit(acc, {})).status).toBe(403);
    await expectStatus(await edit(chief, { name: 'Восстановление учёта' }), 200);
    expect(await refused(await edit(chief, {}), 409)).toBe('record_changed');
    const after = await card(chief, id);
    expect(after).toMatchObject({
      name: 'Восстановление учёта',
      lead: { id: employee('chief-a') },
      money: { plan: som(60_000) },
    });
    expect(after.history[0]).toMatchObject({ action: 'update' });
    expect(after.names[employee('chief-a')]).toBe('chief-a');
    // Стоимость «было → стало» — только тому, кто видит деньги: «Бухгалтер» (ответственный
    // контрагента) видит запись без неё, а запись только о стоимости не видит совсем.
    const plans = (items: readonly { changes: readonly { field: string }[] }[]) =>
      items.flatMap((e) => e.changes.map((x) => x.field)).filter((x) => x === 'plan');
    const cpHistory = async (cookie: string) =>
      (
        await get(cookie, `/api/contractors/${cpAcc}/history`, (x) => ContractorHistory.parse(x))
      ).items.filter((e) => e.entity === 'project');
    expect(plans(after.history)).toEqual(['plan']);
    expect(plans((await card(acc, id)).history)).toEqual([]);
    expect(plans(await cpHistory(chief))).toContain('plan');
    expect(plans(await cpHistory(acc))).toEqual([]);
    const accBefore = (await card(acc, id)).history.length;
    const accCpBefore = (await cpHistory(acc)).length;
    await expectStatus(
      await call('PUT', `/api/projects/${id}`, chief, {
        version: after.version,
        name: after.name,
        startsOn: after.startsOn,
        endsOn: after.endsOn,
        description: '',
        plan: som(70_000),
        members: after.members.map((m) => m.id),
        lead: after.lead.id,
        works: after.works.map((w) => ({
          id: w.id,
          name: w.name,
          executorId: w.executor.id,
          due: w.due,
        })),
      }),
      200,
    );
    expect((await card(chief, id)).history[0]!.changes).toEqual([
      { field: 'plan', from: som(60_000), to: som(70_000) },
    ]);
    expect((await card(acc, id)).history).toHaveLength(accBefore);
    expect(await cpHistory(acc)).toHaveLength(accCpBefore);
  });

  it('шкала статусов: шаги с правом «Вести проекты», откат — с «Откатом статусов» и причиной', async () => {
    const id = await create(chief);
    expect(await refused(await status(chief, id, { to: 'done', version: 1 }), 409)).toBe(
      'project_status_invalid',
    );
    let c = ProjectCard.parse(
      await (
        await expectStatus(await status(chief, id, { to: 'in_progress', version: 1 }), 200)
      ).json(),
    );
    expect(c.status).toBe('in_progress');
    // Откат: у «Главного бухгалтера» нет права «Откат статусов».
    expect(
      (await status(chief, id, { to: 'planned', version: c.version, reason: 'Перенос' })).status,
    ).toBe(403);
    expect(await refused(await status(owner, id, { to: 'planned', version: c.version }), 400)).toBe(
      'status.rollback_reason_required',
    );
    c = ProjectCard.parse(
      await (
        await expectStatus(
          await status(owner, id, { to: 'planned', version: c.version, reason: 'Клиент перенёс' }),
          200,
        )
      ).json(),
    );
    expect(c.statusHistory.map((h) => [h.from, h.to, h.rollback])).toEqual([
      [null, 'planned', false],
      ['planned', 'in_progress', false],
      ['in_progress', 'planned', true],
    ]);
    expect(await refused(await status(chief, id, { to: 'cancelled', version: 1 }), 409)).toBe(
      'record_changed',
    );
    c = ProjectCard.parse(
      await (
        await expectStatus(await status(chief, id, { to: 'cancelled', version: c.version }), 200)
      ).json(),
    );
    expect(c.status).toBe('cancelled');
    expect(c.can.task).toBe(true);
  });

  it('работы: ответственный без права отмечает и добавляет; не ответственный — нет', async () => {
    const id = await create(chief, {
      contractorId: cpChief,
      members: [employee('chief-a'), employee('acc-a')],
      lead: employee('chief-a'),
      works: [{ name: 'Акт сверки', executorId: employee('acc-a'), due: '2026-10-10' }],
    });
    let c = await card(acc, id);
    expect(c.can.works).toBe(true);
    expect(c.works[0]).toMatchObject({ name: 'Акт сверки', overdue: true, done: false });
    await expectStatus(
      await call('PUT', `/api/projects/${id}/works/${c.works[0]!.id}/done`, acc, { done: true }),
      200,
    );
    await expectStatus(
      await call('POST', `/api/projects/${id}/works`, acc, {
        name: 'Сдать уточнённые',
        executorId: employee('acc-a'),
        due: null,
      }),
      201,
    );
    expect(
      await refused(
        await call('POST', `/api/projects/${id}/works`, acc, {
          name: 'Чужой исполнитель',
          executorId: employee('hr-a'),
          due: null,
        }),
        400,
      ),
    ).toBe('project_work_invalid');
    c = await card(acc, id);
    expect(c.works.map((w) => [w.name, w.done])).toEqual([
      ['Акт сверки', true],
      ['Сдать уточнённые', false],
    ]);
    expect(c.history.map((h) => h.action).slice(0, 2)).toEqual(['work_add', 'work_done']);
    // Проект, где бухгалтер не ответственный (но видит как ответственный контрагента), — только смотреть.
    const other = await create(chief, {
      works: [{ name: 'Работа', executorId: employee('chief-a'), due: null }],
      members: [employee('chief-a')],
      lead: employee('chief-a'),
    });
    const o = await card(acc, other);
    expect(o.can.works).toBe(false);
    expect(
      await refused(
        await call('PUT', `/api/projects/${other}/works/${o.works[0]!.id}/done`, acc, {
          done: true,
        }),
        403,
      ),
    ).toBe('project_work_add_forbidden');
  });

  it('задача по проекту: поле «Проект», карточка проекта, задача видна ответственному проекта', async () => {
    const id = await create(chief, {
      contractorId: cpChief,
      name: 'Проект с задачами',
      members: [employee('chief-a'), employee('acc-a')],
      lead: employee('chief-a'),
    });
    const options = TaskFormOptions.parse(
      await (await call('GET', '/api/tasks/form-options', chief)).json(),
    );
    expect(options.projectsOn).toBe(true);
    const offered = await get(chief, `/api/tasks/form-projects?contractorId=${cpChief}`, (x) =>
      TaskProjects.parse(x),
    );
    expect(offered.items.map((p) => p.id)).toContain(id);
    const task = (body: Record<string, unknown>) =>
      call('POST', '/api/tasks', chief, {
        title: 'Подготовить акт',
        description: '',
        categoryCode: 'КАТ-001',
        contractorId: cpChief,
        projectId: id,
        executorEmployeeId: employee('chief-a'),
        term: 'day',
        dueDate: '2026-10-25',
        needFile: false,
        confirm: false,
        ...body,
      });
    expect(await refused(await task({ contractorId: cpAcc }), 400)).toBe('task_project_invalid');
    expect(await refused(await task({ contractorId: null }), 400)).toBe('task_project_invalid');
    const created = Task.parse(await (await expectStatus(await task({}), 201)).json());
    expect(created.project).toEqual({ id, name: 'Проект с задачами' });
    const c = await card(acc, id);
    expect(c.tasks!.map((t) => t.id)).toEqual([created.id]);
    // Бухгалтер не видит контрагента главного и задача не его — но он ответственный проекта.
    await expectStatus(await call('GET', `/api/tasks/${created.id}`, acc), 200);
    expect((await call('GET', `/api/tasks/${created.id}`, hr)).status).toBe(404);
    // Отменённый проект в поле «Проект» не предлагается.
    await expectStatus(await status(chief, id, { to: 'cancelled', version: c.version }), 200);
    expect(
      (
        await get(chief, `/api/tasks/form-projects?contractorId=${cpChief}`, (x) =>
          TaskProjects.parse(x),
        )
      ).items.map((p) => p.id),
    ).not.toContain(id);
  });

  it('поле «Проект» задачи — только проекты, которые сотрудник видит; без «Просматривать проекты» поля нет', async () => {
    const id = await create(chief, {
      contractorId: cpChief,
      name: 'Проект только главного',
      members: [employee('chief-a')],
      lead: employee('chief-a'),
    });
    // «Кадры» с «Ставить задачи», контрагенты — «Все», проекты — «Свои»: контрагента главного видят,
    // его проект — нет.
    const hrCps = and(
      eq(schema.roleScopes.roleId, f.roleIds.hr),
      eq(schema.roleScopes.permGroup, 'cps'),
    );
    const hrPermission = (permissionId: string) =>
      and(
        eq(schema.rolePermissions.roleId, f.roleIds.hr),
        eq(schema.rolePermissions.permissionId, permissionId),
      );
    await f.t.admin.db.update(schema.roleScopes).set({ scope: 'all' }).where(hrCps);
    await f.t.admin.db
      .insert(schema.rolePermissions)
      .values({ orgId: f.a.orgId, roleId: f.roleIds.hr, permissionId: 'tasksCreate' });
    try {
      const offered = await get(hr, `/api/tasks/form-projects?contractorId=${cpChief}`, (x) =>
        TaskProjects.parse(x),
      );
      expect(offered.items.map((p) => p.id)).not.toContain(id);
      // Номер проекта в «current» не открывает его названия: у видимых задач такого проекта нет.
      const asCurrent = await get(
        hr,
        `/api/tasks/form-projects?contractorId=${cpChief}&current=${id}`,
        (x) => TaskProjects.parse(x),
      );
      expect(asCurrent.items.map((p) => p.id)).not.toContain(id);
      const res = await call('POST', '/api/tasks', hr, {
        title: 'Задача по чужому проекту',
        description: '',
        categoryCode: 'КАТ-001',
        contractorId: cpChief,
        projectId: id,
        executorEmployeeId: employee('hr-a'),
        term: 'day',
        dueDate: '2026-10-25',
        needFile: false,
        confirm: false,
      });
      expect(await refused(res, 400)).toBe('task_project_invalid');
      // Без «Просматривать проекты»: в форме поля «Проект» нет, список проектов — 403.
      await f.t.admin.db.delete(schema.rolePermissions).where(hrPermission('projView'));
      const options = TaskFormOptions.parse(
        await (await expectStatus(await call('GET', '/api/tasks/form-options', hr), 200)).json(),
      );
      expect(options.projectsOn).toBe(false);
      expect(
        await refused(
          await call('GET', `/api/tasks/form-projects?contractorId=${cpChief}`, hr),
          403,
        ),
      ).toBe('forbidden');
    } finally {
      await f.t.admin.db.update(schema.roleScopes).set({ scope: 'own' }).where(hrCps);
      await f.t.admin.db.delete(schema.rolePermissions).where(hrPermission('tasksCreate'));
      await f.t.admin.db
        .insert(schema.rolePermissions)
        .values({ orgId: f.a.orgId, roleId: f.roleIds.hr, permissionId: 'projView' })
        .onConflictDoNothing();
    }
  });

  it('файлы проекта: прикрепляет ответственный; история проекта видна в истории контрагента', async () => {
    const id = await create(chief, { name: 'Проект с файлами' });
    const started = await call('POST', '/api/files/uploads', acc, {
      name: 'Акт.pdf',
      size: 5,
      source: { kind: 'project', id },
    });
    const ticket = FileUploadTicket.parse(await (await expectStatus(started, 201)).json());
    const [row] = await f.t.admin.db
      .select({ key: schema.files.storageKey, type: schema.files.contentType })
      .from(schema.files)
      .where(eq(schema.files.id, ticket.id));
    await (f.deps.storage as MemoryStorage).put(row!.key, new Uint8Array(5), {
      contentType: row!.type,
    });
    await expectStatus(await call('POST', `/api/files/${ticket.id}/complete`, acc), 200);
    expect((await card(chief, id)).history[0]).toMatchObject({ action: 'file_attach' });
    // «Кадры» проекта не видят — и его файлов тоже.
    expect((await call('GET', `/api/files?kind=project&id=${id}`, hr)).status).toBe(404);
    const history = await get(chief, `/api/contractors/${cpAcc}/history`, (x) =>
      ContractorHistory.parse(x),
    );
    expect(JSON.stringify(history)).toContain('Проект с файлами');
  });

  it('выгрузка в Excel и значения фильтра', async () => {
    const res = await call('GET', '/api/projects/export?tab=all&cols=name,cp,status', chief);
    await expectStatus(res, 200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    const values = await call('GET', '/api/projects/values?tab=all&col=status', chief);
    await expectStatus(values, 200);
    expect((await call('GET', '/api/projects/values?tab=all&col=plan', acc)).status).toBe(400);
  });

  it('транши: «Записать оплату» не больше остатка, окно, «Изменить» с причиной (п. 66), «Удалить»', async () => {
    const id = await create(chief, { name: 'Проект с траншами', plan: som(60_000) });
    const pay = (cookie: string, body: Record<string, unknown>, pid = id) =>
      call('POST', `/api/projects/${pid}/payments`, cookie, body);
    const tranche = { amount: som(50_000), date: '2026-10-15', note: 'Аванс' };
    expect((await apiRequest(f.app, 'POST', `/api/projects/${id}/payments`)).status).toBe(401);
    // «Бухгалтер» проект видит, но не ведёт; чужая организация проекта не видит.
    expect((await pay(acc, tranche)).status).toBe(403);
    expect((await pay(ownerB, tranche)).status).toBe(404);
    expect((await pay(chief, { ...tranche, extra: 1 })).status).toBe(400);
    expect(await refused(await pay(chief, { ...tranche, amount: som(60_001) }), 400)).toBe(
      'project_pay_over',
    );
    expect(await refused(await pay(chief, { ...tranche, date: '2026-10-19' }), 400)).toBe(
      'money_date_future',
    );
    const t = ProjectSaved.parse(
      await (await expectStatus(await pay(chief, tranche), 201)).json(),
    ).id;
    // Карточка: «Оплаты (транши)», «получено», «Записать оплату»; бухгалтеру — без денег и траншей.
    const c = await card(chief, id);
    expect(c.money).toEqual({ plan: som(60_000), paid: som(50_000) });
    expect(c.payments).toEqual([
      expect.objectContaining({ id: t, amount: som(50_000), note: 'Аванс', edited: false }),
    ]);
    expect(c.can.pay).toBe(true);
    expect(c.history[0]).toMatchObject({ action: 'create', paymentId: t });
    const seen = await card(acc, id);
    expect(seen.payments).toBeNull();
    expect(seen.can.pay).toBe(false);
    expect(seen.history.some((h) => h.paymentId !== null)).toBe(false);
    // Окно транша: «получено X из Y», предел для «Изменить» — стоимость без остальных траншей.
    const win = (cookie: string) =>
      get(cookie, `/api/project-payments/${t}`, (x) => ProjectPaymentWindow.parse(x));
    expect(await win(chief)).toMatchObject({
      amount: som(50_000),
      project: { id, plan: som(60_000), paid: som(50_000) },
      max: som(60_000),
      locks: { edit: null, del: null },
    });
    expect(await refused(await call('GET', `/api/project-payments/${t}`, acc), 403)).toBe(
      'forbidden',
    );
    expect((await call('GET', `/api/project-payments/${t}`, ownerB)).status).toBe(404);
    // п. 66: 50 000 → 45 000 с причиной — «получено» уменьшилось; без причины — нельзя.
    const edit = (body: Record<string, unknown>) =>
      call('PUT', `/api/project-payments/${t}`, chief, {
        version: 1,
        amount: som(50_000),
        date: '2026-10-15',
        note: 'Аванс',
        ...body,
      });
    expect(await refused(await edit({ amount: som(45_000) }), 400)).toBe('op_reason_required');
    expect(await refused(await edit({ amount: som(60_001), reason: 'x' }), 400)).toBe(
      'op_project_over',
    );
    expect(
      (
        await call('PUT', `/api/project-payments/${t}`, acc, {
          version: 1,
          amount: 1,
          date: '2026-10-15',
        })
      ).status,
    ).toBe(403);
    const edited = await edit({ amount: som(45_000), reason: 'Ошибка в сумме платёжки' });
    expect(OperationEdited.parse(await (await expectStatus(edited, 200)).json())).toEqual({
      changed: true,
    });
    expect((await card(chief, id)).money).toEqual({ plan: som(60_000), paid: som(45_000) });
    expect(await refused(await edit({ amount: som(44_000), reason: 'x' }), 409)).toBe(
      'record_changed',
    );
    // «Удалить» — с причиной; удалённый — в окне с отметкой, в карточке его нет.
    const del = (body: Record<string, unknown>) =>
      call('POST', `/api/project-payments/${t}/delete`, chief, body);
    expect((await del({ reason: ' ' })).status).toBe(400);
    await expectStatus(await del({ reason: 'Записали не тому проекту' }), 200);
    expect(await refused(await del({ reason: 'ещё раз' }), 409)).toBe('op_deleted');
    expect((await win(chief)).deleted).toMatchObject({ reason: 'Записали не тому проекту' });
    expect((await card(chief, id)).payments).toEqual([]);
    expect((await card(chief, id)).money!.paid).toBe(0);
  });

  it('транши: отменённому проекту и полностью оплаченному — нельзя; строка журнала «Оплата по проекту»', async () => {
    const full = await create(chief, { name: 'Оплачен целиком', plan: som(1_000) });
    const pay = (pid: string, amount: number) =>
      call('POST', `/api/projects/${pid}/payments`, chief, { amount, date: '2026-10-18' });
    const { id: t } = ProjectSaved.parse(
      await (await expectStatus(await pay(full, som(1_000)), 201)).json(),
    );
    expect(await refused(await pay(full, som(1)), 409)).toBe('project_paid_full');
    const cancelled = await create(chief, { name: 'Отменённый проект' });
    await expectStatus(await status(chief, cancelled, { to: 'cancelled', version: 1 }), 200);
    expect(await refused(await pay(cancelled, som(1)), 409)).toBe('project_pay_cancelled');
    expect((await card(chief, cancelled)).can.pay).toBe(false);
    // Журнал «Финансовых операций»: строка транша с проектом; «Проекты» выключены — строк нет.
    const journal = async () =>
      (
        await get(chief, '/api/fin/journal?tab=proj&size=all', (x) =>
          listPageSchema(FinJournalRow).parse(x),
        )
      ).items;
    await features(f.a.orgId, { ...ON, finops: true });
    try {
      expect((await journal()).find((r) => r.id === t)).toMatchObject({
        src: 'pt',
        what: 'Оплачен целиком',
        project: { id: full, name: 'Оплачен целиком' },
        locks: { edit: null, del: null },
      });
      await features(f.a.orgId, { ...ON, finops: true, projects: false });
      expect((await journal()).some((r) => r.id === t)).toBe(false);
    } finally {
      await features(f.a.orgId, ON);
    }
  });

  it('транши: область «Свои» — транш чужого проекта «не найден»; без «Просматривать проекты» — по области «Финансовых операций»', async () => {
    const id = await create(chief, {
      contractorId: cpChief,
      name: 'Проект главного с траншем',
      plan: som(10_000),
      members: [employee('chief-a')],
      lead: employee('chief-a'),
    });
    const { id: t } = ProjectSaved.parse(
      await (
        await expectStatus(
          await call('POST', `/api/projects/${id}/payments`, chief, {
            amount: som(1_000),
            date: '2026-10-18',
          }),
          201,
        )
      ).json(),
    );
    const hrPermission = (permissionId: string) =>
      and(
        eq(schema.rolePermissions.roleId, f.roleIds.hr),
        eq(schema.rolePermissions.permissionId, permissionId),
      );
    const hrScope = (group: string) =>
      and(eq(schema.roleScopes.roleId, f.roleIds.hr), eq(schema.roleScopes.permGroup, group));
    const grant = (...ids: string[]) =>
      f.t.admin.db
        .insert(schema.rolePermissions)
        .values(
          ids.map((permissionId) => ({ orgId: f.a.orgId, roleId: f.roleIds.hr, permissionId })),
        )
        .onConflictDoNothing();
    const scope = (group: string, value: 'own' | 'all') =>
      f.t.admin.db.update(schema.roleScopes).set({ scope: value }).where(hrScope(group));
    const window = () => call('GET', `/api/project-payments/${t}`, hr);
    // «Кадры» с «Вести проекты», область «Свои»: транш проекта главного — «не найден» во всех методах.
    await grant('projects');
    try {
      expect((await window()).status).toBe(404);
      const paid = await call('POST', `/api/projects/${id}/payments`, hr, {
        amount: 100,
        date: '2026-10-18',
      });
      expect(paid.status).toBe(404);
      const edited = await call('PUT', `/api/project-payments/${t}`, hr, {
        version: 1,
        amount: 100,
        date: '2026-10-18',
        reason: 'Ошибка',
      });
      expect(edited.status).toBe(404);
      const deleted = await call('POST', `/api/project-payments/${t}/delete`, hr, {
        reason: 'Ошибка',
      });
      expect(deleted.status).toBe(404);
      // Только журнал (без «Просматривать проекты»), деньги проектов — правом «Плата за обслуживание»:
      // область «Проектов» — «Все», «Финансовых операций» — «Свои» — транш контрагента главного не открыть.
      await f.t.admin.db.delete(schema.rolePermissions).where(hrPermission('projects'));
      await f.t.admin.db.delete(schema.rolePermissions).where(hrPermission('projView'));
      await grant('fee');
      await features(f.a.orgId, { ...ON, fee: true, finops: true });
      await scope('projects', 'all');
      expect((await window()).status).toBe(404);
      await scope('fin', 'all');
      expect(
        await get(hr, `/api/project-payments/${t}`, (x) => ProjectPaymentWindow.parse(x)),
      ).toMatchObject({ id: t, amount: som(1_000) });
      // «Финансовые операции» выключены — без «Просматривать проекты» окна транша нет.
      await features(f.a.orgId, { ...ON, fee: true, finops: false });
      expect(await refused(await window(), 403)).toBe('forbidden');
    } finally {
      await features(f.a.orgId, ON);
      await scope('projects', 'own');
      await scope('fin', 'own');
      await f.t.admin.db.delete(schema.rolePermissions).where(hrPermission('projects'));
      await f.t.admin.db.delete(schema.rolePermissions).where(hrPermission('fee'));
      await grant('projView');
    }
  });
});
