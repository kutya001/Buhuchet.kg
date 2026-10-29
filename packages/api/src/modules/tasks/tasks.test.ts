import type { MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  ApiError,
  Contractor,
  ContractorTasks,
  FileList,
  FileUploadTicket,
  ListValues,
  Task,
  TaskFormOptions,
  TaskList,
  TaskSummary,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD, unzipTexts } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())('Задачи: методы API', () => {
  let f: Fixture;
  let owner: string;
  let chief: string;
  let acc: string;
  let hr: string;
  let ownerB: string;
  /** Контрагент бухгалтера (видит и бухгалтер) и главного бухгалтера (бухгалтеру не виден). */
  let cpAcc: Contractor;
  let cpOther: Contractor;

  const employee = (login: string) => f.people[login]!.employeeId;
  const call = (method: 'GET' | 'POST' | 'PATCH', path: string, cookie: string, body?: unknown) =>
    apiRequest(f.app, method, path, cookie, body);
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  const body = (patch: Record<string, unknown> = {}) => ({
    title: 'Собрать первичку за октябрь',
    description: '',
    categoryCode: 'КАТ-001',
    contractorId: null,
    executorEmployeeId: employee('acc-a'),
    term: 'day',
    dueDate: '2026-10-25',
    needFile: false,
    confirm: true,
    ...patch,
  });
  const create = async (cookie: string, patch: Record<string, unknown> = {}) => {
    const res = await call('POST', '/api/tasks', cookie, body(patch));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    return Task.parse(await res.json());
  };
  const card = async (cookie: string, id: string) => {
    const res = await call('GET', `/api/tasks/${id}`, cookie);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    return Task.parse(await res.json());
  };
  const act = (cookie: string, id: string, action: string, payload: unknown = undefined) =>
    call('POST', `/api/tasks/${id}/${action}`, cookie, payload);
  const acted = async (cookie: string, id: string, action: string, payload: unknown = {}) => {
    const res = await act(cookie, id, action, payload);
    expect(res.status, JSON.stringify(await res.clone().json())).toBeLessThan(300);
    return Task.parse(await res.json());
  };
  const list = async (cookie: string, query: string) => {
    const res = await call('GET', `/api/tasks?${query}`, cookie);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    return TaskList.parse(await res.json());
  };
  const features = (value: Record<string, boolean>) =>
    f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: value })
      .where(eq(schema.orgSettings.orgId, f.a.orgId));
  const contractor = async (name: string, inn: string, responsible: string) => {
    const res = await call('POST', '/api/contractors', owner, {
      name,
      inn,
      phone: '+996505890076',
      kind: 'regular',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      gked: '46.34.0',
      gkedExtra: [],
      bases: [],
      startDate: '2024-07-16',
      responsibleEmployeeId: responsible,
    });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    return Contractor.parse(await res.json());
  };
  /** Загрузить файл к задаче через блок «Файлы»: начать, положить в хранилище, закончить. */
  const upload = async (cookie: string, taskId: string) => {
    const started = await call('POST', '/api/files/uploads', cookie, {
      source: { kind: 'task', id: taskId },
      name: 'акт-сверки.pdf',
      size: 5,
    });
    expect(started.status, JSON.stringify(await started.clone().json())).toBe(201);
    const ticket = FileUploadTicket.parse(await started.json());
    const [row] = await f.t.admin.db
      .select({ key: schema.files.storageKey })
      .from(schema.files)
      .where(eq(schema.files.id, ticket.id));
    await (f.deps.storage as MemoryStorage).put(row!.key, new Uint8Array(5), {
      contentType: 'application/pdf',
    });
    const done = await call('POST', `/api/files/${ticket.id}/complete`, cookie);
    expect(done.status).toBe(200);
    return ticket.id;
  };

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    await features({ tasks: true, files: true });
    [owner, chief, acc, hr, ownerB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'chief-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'hr-a', TEST_PASSWORD),
      signIn(f.app, 'owner-b', TEST_PASSWORD),
    ]);
    cpAcc = await contractor('ОсОО «Ала-Тоо Трейд»', '03744097401851', employee('acc-a'));
    cpOther = await contractor('ИП Садыков', '03744097401852', employee('chief-a'));
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('пока задач нет — «empty» (подсказка первого входа); после первой задачи — нет', async () => {
    const before = TaskSummary.parse(await (await call('GET', '/api/tasks/summary', acc)).json());
    expect(before).toMatchObject({ empty: true, mine: 0, byme: 0, overdue: 0, pending: 0 });
    expect(before.monthStart).toBe('2026-10-01');
  });

  it('ставит задачу: постановщик из сеанса, «На месяц» — до последнего дня, «Поставил»', async () => {
    const task = await create(chief, {
      term: 'month',
      dueDate: '2026-11-05',
      contractorId: cpAcc.id,
    });
    expect(task).toMatchObject({
      status: 'todo',
      term: 'month',
      dueDate: '2026-11-30',
      author: { id: employee('chief-a'), shortName: 'chief-a' },
      executor: { id: employee('acc-a') },
      contractor: { id: cpAcc.id, name: 'ОсОО «Ала-Тоо Трейд»' },
      category: { code: 'КАТ-001' },
      confirm: true,
      overdue: false,
      version: 1,
    });
    expect(task.statusHistory).toMatchObject([{ from: null, to: 'todo', actor: 'chief-a' }]);
    expect(task.history).toMatchObject([{ action: 'create', actor: 'chief-a' }]);
    // Без права «Ставить задачи» — 403, даже если в теле подставить себя постановщиком.
    const denied = await call('POST', '/api/tasks', acc, body());
    expect(denied.status).toBe(403);
  });

  it('проверяет поля: категория, контрагент в области и не в архиве, действующий исполнитель', async () => {
    const bad = async (cookie: string, patch: Record<string, unknown>) => {
      const res = await call('POST', '/api/tasks', cookie, body(patch));
      expect(res.status).toBe(400);
      return (await failure(res)).code;
    };
    expect(await bad(chief, { categoryCode: 'КАТ-999' })).toBe('task_category_not_found');
    expect(await bad(chief, { title: '   ' })).toBe('validation_failed');
    expect(await bad(chief, { executorEmployeeId: employee('acc-b') })).toBe(
      'task_executor_not_found',
    );
    await f.t.admin.db
      .update(schema.employees)
      .set({ active: false })
      .where(eq(schema.employees.id, employee('hr-a')));
    expect(await bad(chief, { executorEmployeeId: employee('hr-a') })).toBe(
      'task_executor_inactive',
    );
    await f.t.admin.db
      .update(schema.employees)
      .set({ active: true })
      .where(eq(schema.employees.id, employee('hr-a')));
    await f.t.admin.db
      .update(schema.taskCategories)
      .set({ active: false })
      .where(eq(schema.taskCategories.code, 'КАТ-002'));
    expect(await bad(chief, { categoryCode: 'КАТ-002' })).toBe('task_category_inactive');
    await f.t.admin.db
      .update(schema.taskCategories)
      .set({ active: true })
      .where(eq(schema.taskCategories.code, 'КАТ-002'));
  });

  it('форма: значения, исполнители, контрагенты в области, подтверждение по учётной политике', async () => {
    const res = await call('GET', '/api/tasks/form-options', chief);
    expect(res.status).toBe(200);
    const options = TaskFormOptions.parse(await res.json());
    expect(options.confirmDefault).toBe(true);
    expect(options.filesOn).toBe(true);
    expect(options.categories.length).toBeGreaterThan(3);
    expect(options.executors.map((e) => e.shortName)).toContain('acc-a');
    expect(options.executors.map((e) => e.shortName)).not.toContain('acc-b');
    expect(options.contractors).toMatchObject([
      { id: cpOther.id, responsibleEmployeeId: employee('chief-a') },
      { id: cpAcc.id, responsibleEmployeeId: employee('acc-a') },
    ]);
    expect((await call('GET', '/api/tasks/form-options', acc)).status).toBe(403);
  });

  it('видимость: свои — исполнителю и постановщику, все — по праву, чужая организация не видна', async () => {
    const task = await create(chief, { title: 'Только свои' });
    await card(acc, task.id);
    expect((await call('GET', `/api/tasks/${task.id}`, hr)).status).toBe(404);
    expect((await call('GET', `/api/tasks/${task.id}`, ownerB)).status).toBe(404);
    const mine = await list(acc, 'tab=mine&size=all');
    expect(mine.items.every((r) => r.executor.id === employee('acc-a'))).toBe(true);
    expect(mine.items.map((r) => r.id)).toContain(task.id);
    expect((await list(hr, 'tab=all&size=all')).items.map((r) => r.id)).not.toContain(task.id);
    expect((await list(chief, 'tab=all&size=all')).items.map((r) => r.id)).toContain(task.id);
    expect((await list(ownerB, 'tab=all&size=all')).total).toBe(0);
    // Кто видит контрагента, видит все его задачи (вкладка «Задачи» карточки контрагента).
    const byCp = await create(chief, {
      contractorId: cpOther.id,
      executorEmployeeId: employee('chief-a'),
    });
    const tab = await call('GET', `/api/contractors/${cpOther.id}/tasks`, owner);
    expect(ContractorTasks.parse(await tab.json())).toMatchObject({ open: 1 });
    expect((await call('GET', `/api/contractors/${cpOther.id}/tasks`, acc)).status).toBe(404);
    expect((await call('GET', `/api/tasks/${byCp.id}`, acc)).status).toBe(404);
  });

  it('чужая организация: правка, действия, комментарии, файлы, вкладка контрагента, значения и выгрузка — как несуществующие', async () => {
    await f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: { tasks: true, files: true } })
      .where(eq(schema.orgSettings.orgId, f.b.orgId));
    const task = await create(chief, { title: 'Задача организации А', contractorId: cpAcc.id });
    const edit = await call('PATCH', `/api/tasks/${task.id}`, ownerB, {
      ...body(),
      version: task.version,
    });
    expect(edit.status).toBe(404);
    const attempts: [string, unknown][] = [
      ['start', {}],
      ['done', {}],
      ['fail', { reason: 'x' }],
      ['confirm', {}],
      ['rework', { reason: 'x' }],
      ['cancel', {}],
      ['rollback', { to: 'todo', reason: 'x' }],
      ['comments', { text: 'x' }],
    ];
    for (const [action, payload] of attempts) {
      expect((await act(ownerB, task.id, action, payload)).status, action).toBe(404);
    }
    expect((await call('GET', `/api/files?kind=task&id=${task.id}`, ownerB)).status).toBe(404);
    expect((await call('GET', `/api/contractors/${cpAcc.id}/tasks`, ownerB)).status).toBe(404);
    for (const col of ['title', 'cp', 'exec']) {
      const values = ListValues.parse(
        await (await call('GET', `/api/tasks/values?col=${col}&tab=all`, ownerB)).json(),
      );
      expect(
        values.items.filter((v) => v.value !== 'general'),
        col,
      ).toEqual([]);
    }
    const res = await call('GET', '/api/tasks/export?tab=all&cols=title,cp', ownerB);
    expect(res.status).toBe(200);
    expect(JSON.stringify(unzipTexts(new Uint8Array(await res.arrayBuffer())))).not.toContain(
      'Задача организации А',
    );
    // Без «Видеть задачи всех» в значениях столбца «Контрагент» — только контрагенты своих задач.
    const hrValues = ListValues.parse(
      await (await call('GET', '/api/tasks/values?col=cp&tab=all', hr)).json(),
    );
    expect(hrValues.items.map((v) => v.label)).not.toContain(cpAcc.name);
    expect((await card(chief, task.id)).status).toBe('todo');
  });

  it('п. 40: исполнитель не подтверждает свою; вместо постановщика — видно в истории', async () => {
    const task = await create(chief);
    await acted(acc, task.id, 'start');
    const pending = await acted(acc, task.id, 'done', {});
    expect(pending).toMatchObject({ status: 'on_confirm', overdue: false });
    expect(pending.doneAt).not.toBeNull();
    const own = await act(acc, task.id, 'confirm', {});
    expect(own.status).toBe(403);
    expect((await failure(own)).code).toBe('task_confirm_own');
    // Плашка «На подтверждении»: владельцу видна и можно подтвердить.
    const summary = TaskSummary.parse(
      await (await call('GET', '/api/tasks/summary', owner)).json(),
    );
    expect(summary.pending).toBeGreaterThanOrEqual(1);
    expect(summary.canConfirm).toBe(summary.pending);
    expect(summary.empty).toBe(false);
    const confirmed = await acted(owner, task.id, 'confirm', { comment: 'проверил сам' });
    expect(confirmed).toMatchObject({
      status: 'confirmed',
      confirmedBy: { id: f.a.ownerEmployeeId },
      confirmNote: 'проверил сам',
    });
    expect(confirmed.statusHistory.at(-1)).toMatchObject({
      from: 'on_confirm',
      to: 'confirmed',
      reason: 'вместо постановщика chief-a, проверил сам',
    });
    // Подтверждённая не подтверждается второй раз.
    const again = await act(chief, task.id, 'confirm', {});
    expect(again.status).toBe(409);
    expect((await failure(again)).code).toBe('task_not_pending');
  });

  it('п. 41: «На доработку» с причиной; после срока — просрочена; снятое подтверждение — «Выполнена»', async () => {
    const task = await create(chief, { dueDate: '2026-10-17' });
    await acted(acc, task.id, 'done', {});
    const noReason = await act(chief, task.id, 'rework', { reason: '  ' });
    expect(noReason.status).toBe(400);
    const back = await acted(chief, task.id, 'rework', { reason: 'Нет сентября' });
    expect(back).toMatchObject({
      status: 'rework',
      reworkReason: 'Нет сентября',
      reworkBy: { id: employee('chief-a') },
      overdue: true,
    });
    expect((await list(acc, 'tab=overdue&size=all')).items.map((r) => r.id)).toContain(task.id);
    // Снять «Требуется подтверждение» у возвращённой — «В работе», у ждущей — сразу «Выполнена».
    const edited = await call('PATCH', `/api/tasks/${task.id}`, chief, {
      ...body({ dueDate: '2026-10-17', confirm: false }),
      version: back.version,
    });
    expect(edited.status, JSON.stringify(await edited.clone().json())).toBe(200);
    expect(Task.parse(await edited.json())).toMatchObject({
      status: 'in_progress',
      confirm: false,
    });
    const other = await create(chief);
    const waiting = await acted(acc, other.id, 'done', {});
    const off = await call('PATCH', `/api/tasks/${other.id}`, chief, {
      ...body({ confirm: false }),
      version: waiting.version,
    });
    const done = Task.parse(await off.json());
    expect(done.status).toBe('done');
    expect(done.statusHistory.at(-1)).toMatchObject({
      from: 'on_confirm',
      to: 'done',
      reason: 'подтверждение не требуется',
    });
  });

  it('п. 42: «Требуется файл» — без файла не закрыть; файл в «Истории статусов»', async () => {
    const task = await create(chief, { needFile: true, confirm: false });
    const noFile = await act(acc, task.id, 'done', {});
    expect(noFile.status).toBe(400);
    expect((await failure(noFile)).code).toBe('task_file_required');
    // Файл прикрепляет исполнитель открытой задачи; постановщик — нет.
    const files = FileList.parse(
      await (await call('GET', `/api/files?kind=task&id=${task.id}`, acc)).json(),
    );
    expect(files.canUpload).toBe(true);
    const chiefFiles = FileList.parse(
      await (await call('GET', `/api/files?kind=task&id=${task.id}`, chief)).json(),
    );
    expect(chiefFiles.canUpload).toBe(false);
    const fileId = await upload(acc, task.id);
    const wrong = await act(acc, task.id, 'done', { fileId: cpAcc.id });
    expect((await failure(wrong)).code).toBe('task_file_not_found');
    const done = await acted(acc, task.id, 'done', { fileId });
    expect(done).toMatchObject({ status: 'done', hasFile: true });
    expect(done.statusHistory.at(-1)).toMatchObject({
      to: 'done',
      file: { id: fileId, name: 'акт-сверки.pdf', available: true },
    });
    expect(done.history.map((h) => h.action)).toContain('file_attach');
    // Кто не видит файлы задачи (здесь — «Файлы в карточках» выключены), не видит и имя файла.
    await features({ tasks: true });
    const hidden = await card(chief, task.id);
    expect(hidden.statusHistory.find((h) => h.to === 'done')?.file).toBeNull();
    expect(hidden.history.map((h) => h.action)).not.toContain('file_attach');
    await features({ tasks: true, files: true });
  });

  it('права действий: «Выполнена» — исполнитель, «Изменить» и «Отменить» — постановщик или владелец', async () => {
    const task = await create(chief);
    const notMine = await act(chief, task.id, 'done', {});
    expect(notMine.status).toBe(403);
    expect((await failure(notMine)).code).toBe('task_executor_only');
    const edit = await call('PATCH', `/api/tasks/${task.id}`, acc, { ...body(), version: 1 });
    expect((await failure(edit)).code).toBe('task_author_only');
    expect((await failure(await act(acc, task.id, 'cancel'))).code).toBe('task_author_only');
    // Устаревшая версия — «запись изменена другим пользователем».
    const saved = await call('PATCH', `/api/tasks/${task.id}`, chief, {
      ...body({ title: 'Новое название' }),
      version: 1,
    });
    expect(saved.status).toBe(200);
    const stale = await call('PATCH', `/api/tasks/${task.id}`, owner, { ...body(), version: 1 });
    expect(stale.status).toBe(409);
    expect((await failure(stale)).code).toBe('record_changed');
    const cancelled = await acted(owner, task.id, 'cancel');
    expect(cancelled.status).toBe('cancelled');
    expect((await failure(await act(acc, task.id, 'fail', { reason: 'x' }))).code).toBe(
      'task_closed',
    );
    const changes = Task.parse(
      await (await call('GET', `/api/tasks/${task.id}`, chief)).json(),
    ).history.find((h) => h.action === 'update')!.changes;
    expect(changes).toContainEqual({
      field: 'title',
      from: 'Собрать первичку за октябрь',
      to: 'Новое название',
    });
  });

  it('откат на шаг: право «Откат статусов», причина, снимает подтверждение', async () => {
    const task = await create(chief);
    await acted(acc, task.id, 'done', {});
    await acted(chief, task.id, 'confirm', {});
    const noRight = await act(chief, task.id, 'rollback', { to: 'on_confirm', reason: 'ошибка' });
    expect((await failure(noRight)).code).toBe('task_rollback_right');
    const wrong = await act(owner, task.id, 'rollback', { to: 'todo', reason: 'ошибка' });
    expect((await failure(wrong)).code).toBe('task_not_back_step');
    const back = await acted(owner, task.id, 'rollback', { to: 'on_confirm', reason: 'ошибка' });
    expect(back).toMatchObject({ status: 'on_confirm', confirmedBy: null, confirmNote: '' });
    expect(back.statusHistory.at(-1)).toMatchObject({ rollback: true, reason: 'ошибка' });
    const open = await acted(owner, task.id, 'rollback', { to: 'in_progress', reason: 'ещё раз' });
    expect(open).toMatchObject({ status: 'in_progress', doneAt: null });
  });

  it('«Не выполнена» с причиной; комментарии от своего имени', async () => {
    const task = await create(chief);
    expect((await act(acc, task.id, 'fail', { reason: '' })).status).toBe(400);
    const failed = await acted(acc, task.id, 'fail', { reason: 'Клиент не передал документы' });
    expect(failed).toMatchObject({ status: 'failed', failReason: 'Клиент не передал документы' });
    expect((await act(acc, task.id, 'comments', { text: ' ' })).status).toBe(400);
    const commented = await acted(acc, task.id, 'comments', { text: 'Позвонил клиенту' });
    expect(commented.comments).toMatchObject([{ author: 'acc-a', text: 'Позвонил клиенту' }]);
    expect((await act(hr, task.id, 'comments', { text: 'чужая' })).status).toBe(404);
  });

  it('список: «Общие задачи» первым в фильтре контрагента, «Вид задачи» в Excel', async () => {
    const values = ListValues.parse(
      await (await call('GET', '/api/tasks/values?col=cp&tab=all', chief)).json(),
    );
    expect(values.items[0]).toMatchObject({ value: 'general', label: 'Общие задачи' });
    const res = await call('GET', '/api/tasks/export?tab=all&cols=title,cp', chief);
    expect(res.status).toBe(200);
    const files = unzipTexts(new Uint8Array(await res.arrayBuffer()));
    const sheet = Object.entries(files).find(([name]) => name.includes('sheet1'))?.[1] ?? '';
    const strings = files['xl/sharedStrings.xml'] ?? '';
    expect(`${sheet}${strings}`).toContain('Вид задачи');
    expect(`${sheet}${strings}`).toContain('Общая');
  });

  it('модуль выключен в учётной политике — 403 tasks_off', async () => {
    await features({ files: true });
    const res = await call('GET', '/api/tasks?tab=mine', acc);
    expect(res.status).toBe(403);
    expect((await failure(res)).code).toBe('tasks_off');
    expect((await call('GET', '/api/tasks/summary', acc)).status).toBe(403);
    await features({ tasks: true, files: true });
    const [row] = await f.t.admin.db
      .select({ n: schema.tasks.id })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.orgId, f.a.orgId)))
      .limit(1);
    expect(row).toBeDefined();
  });
});
