import type { MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  ApiError,
  ContractorHistory,
  ContractorProjects,
  FileUploadTicket,
  ProjectCard,
  ProjectForm,
  ProjectList,
  ProjectSaved,
  ProjectSummary,
  Task,
  TaskFormOptions,
  TaskProjects,
} from '@buhuchet/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const som = (n: number) => n * 100;
const ON = { projects: true, tasks: true, files: true, fee: false };
const MISSING = '00000000-0000-4000-8000-0000000000ff';

// Сегодня в тестах — 18.10.2026 (`createTestDeps`).
describe.skipIf(!databaseAvailable())(
  'Проекты контрагентов — методы API (задача 2.26)',
  () => {
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
        await (await expectStatus(await call('POST', '/api/projects', cookie, project(body)), 201)).json(),
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
      expect(
        await refused(await call('POST', '/api/projects', ownerB, project()), 400),
      ).toBe('project_contractor_required');
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
        (
          await get(chief, `/api/contractors/${cpArch}/projects`, (x) =>
            ContractorProjects.parse(x),
          )
        ).canCreate,
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
          works: c.works.map((w) => ({ id: w.id, name: w.name, executorId: w.executor.id, due: w.due })),
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
    });

    it('шкала статусов: шаги с правом «Вести проекты», откат — с «Откатом статусов» и причиной', async () => {
      const id = await create(chief);
      expect(await refused(await status(chief, id, { to: 'done', version: 1 }), 409)).toBe(
        'project_status_invalid',
      );
      let c = ProjectCard.parse(
        await (await expectStatus(await status(chief, id, { to: 'in_progress', version: 1 }), 200)).json(),
      );
      expect(c.status).toBe('in_progress');
      // Откат: у «Главного бухгалтера» нет права «Откат статусов».
      expect((await status(chief, id, { to: 'planned', version: c.version, reason: 'Перенос' })).status).toBe(403);
      expect(
        await refused(await status(owner, id, { to: 'planned', version: c.version }), 400),
      ).toBe('status.rollback_reason_required');
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
        await (await expectStatus(await status(chief, id, { to: 'cancelled', version: c.version }), 200)).json(),
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
      const offered = await get(
        chief,
        `/api/tasks/form-projects?contractorId=${cpChief}`,
        (x) => TaskProjects.parse(x),
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
      expect(
        (await call('GET', `/api/files?kind=project&id=${id}`, hr)).status,
      ).toBe(404);
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
  },
);
