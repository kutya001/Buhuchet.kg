import type { MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import {
  ApiError,
  Contractor,
  FileFormContractors,
  FileLink,
  FileList,
  FileManagerList,
  FileManagerSummary,
  FileUploadTicket,
  FileUsage,
  ListValues,
  Task,
} from '@buhuchet/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD, unzipTexts } from '../../testing';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

describe.skipIf(!databaseAvailable())('Файловый менеджер: методы API', () => {
  let f: Fixture;
  let owner: string;
  let chief: string;
  let acc: string;
  let senior: string;
  let accB: string;
  /** Контрагент бухгалтера (бухгалтер со «Свои» видит) и главного бухгалтера (не видит). */
  let cpAcc: Contractor;
  let cpOther: Contractor;
  const ids: Record<string, string> = {};

  const employee = (login: string) => f.people[login]!.employeeId;
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    cookie: string,
    body?: unknown,
  ) => apiRequest(f.app, method, path, cookie, body);
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
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
  const task = async (cookie: string, patch: Record<string, unknown>) => {
    const res = await call('POST', '/api/tasks', cookie, {
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
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    return Task.parse(await res.json());
  };
  const startUpload = (cookie: string, body: Record<string, unknown>) =>
    call('POST', '/api/files/uploads', cookie, { name: 'файл.pdf', size: 5, ...body });
  /** Загрузить файл: начать, положить в хранилище, закончить. */
  const upload = async (cookie: string, body: Record<string, unknown>, size = 5) => {
    const started = await startUpload(cookie, { size, ...body });
    expect(started.status, JSON.stringify(await started.clone().json())).toBe(201);
    const ticket = FileUploadTicket.parse(await started.json());
    const [row] = await f.t.admin.db
      .select({ key: schema.files.storageKey, type: schema.files.contentType })
      .from(schema.files)
      .where(eq(schema.files.id, ticket.id));
    await (f.deps.storage as MemoryStorage).put(row!.key, new Uint8Array(size), {
      contentType: row!.type,
    });
    const done = await call('POST', `/api/files/${ticket.id}/complete`, cookie);
    expect(done.status, JSON.stringify(await done.clone().json())).toBe(200);
    return ticket.id;
  };
  const manager = async (cookie: string, query = '') => {
    const res = await call('GET', `/api/files/manager?${query}`, cookie);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    return FileManagerList.parse(await res.json());
  };
  const names = async (cookie: string, query = '') =>
    (await manager(cookie, query)).items.map((r) => r.name).sort();
  const summary = async (cookie: string) => {
    const res = await call('GET', '/api/files/manager/summary', cookie);
    expect(res.status).toBe(200);
    return FileManagerSummary.parse(await res.json());
  };
  const MANUAL = { kind: 'manual', id: null };

  beforeAll(async () => {
    f = await createStaffFixture();
    await seedAllPlatformDictionaries(f.t.admin.db);
    await features({ tasks: true, files: true });
    [owner, chief, acc, senior, accB] = await Promise.all([
      signIn(f.app, 'owner-a', TEST_PASSWORD),
      signIn(f.app, 'chief-a', TEST_PASSWORD),
      signIn(f.app, 'acc-a', TEST_PASSWORD),
      signIn(f.app, 'senior-a', TEST_PASSWORD),
      signIn(f.app, 'acc-b', TEST_PASSWORD),
    ]);
    cpAcc = await contractor('ОсОО «Ала-Тоо Трейд»', '03744097401851', employee('acc-a'));
    cpOther = await contractor('ИП Садыков', '03744097401852', employee('chief-a'));
    ids.general = await upload(owner, { source: MANUAL, name: 'Устав организации.pdf' });
    ids.manualAcc = await upload(owner, {
      source: MANUAL,
      name: 'Договор обслуживания.pdf',
      contractorId: cpAcc.id,
      note: 'Подписанный экземпляр',
    });
    ids.manualOther = await upload(owner, {
      source: MANUAL,
      name: 'Договор Садыкова.docx',
      contractorId: cpOther.id,
    });
    const accTask = await task(owner, { title: 'Сверка с Ала-Тоо', contractorId: cpAcc.id });
    ids.taskAcc = await upload(acc, {
      source: { kind: 'task', id: accTask.id },
      name: 'Акт сверки.pdf',
    });
    const chiefTask = await task(owner, {
      title: 'Сверка с Садыковым',
      contractorId: cpOther.id,
      executorEmployeeId: employee('chief-a'),
    });
    ids.taskOther = await upload(chief, {
      source: { kind: 'task', id: chiefTask.id },
      name: 'Акт Садыкова.png',
    });
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('владелец видит все файлы организации с источником, контрагентом и тем, кто загрузил', async () => {
    const page = await manager(owner, 'sort=name.asc');
    expect(page.total).toBe(5);
    const byName = new Map(page.items.map((r) => [r.name, r]));
    expect(byName.get('Устав организации.pdf')).toMatchObject({
      kind: 'manual',
      source: 'Загружен вручную',
      contractor: null,
      uploadedBy: expect.any(String),
    });
    expect(byName.get('Договор обслуживания.pdf')).toMatchObject({
      kind: 'manual',
      contractor: { id: cpAcc.id, name: 'ОсОО «Ала-Тоо Трейд»' },
      note: 'Подписанный экземпляр',
    });
    expect(byName.get('Акт сверки.pdf')).toMatchObject({
      kind: 'task',
      source: 'Сверка с Ала-Тоо',
      contractor: { id: cpAcc.id },
      uploadedBy: 'acc-a',
    });
  });

  it('(проверка задачи #85) бухгалтер со «Свои» не видит файлов чужих контрагентов — ни в списке, ни по ссылке', async () => {
    expect(await names(acc)).toEqual([
      'Акт сверки.pdf',
      'Договор обслуживания.pdf',
      'Устав организации.pdf',
    ]);
    const values = ListValues.parse(
      await (await call('GET', '/api/files/manager/values?col=cp', acc)).json(),
    );
    expect(values.items.map((v) => v.label)).not.toContain('ИП Садыков');
    expect((await call('GET', `/api/files/${ids.manualOther}/link`, acc)).status).toBe(404);
    expect((await call('GET', `/api/files/${ids.taskOther}/view`, acc)).status).toBe(404);
    // Контрагенты окна «Загрузить файл» — тоже только свои; загрузить к чужому нельзя.
    const options = FileFormContractors.parse(
      await (await call('GET', '/api/files/manager/contractors', acc)).json(),
    );
    expect(options.items.map((c) => c.name)).toEqual(['ОсОО «Ала-Тоо Трейд»']);
    const denied = await startUpload(acc, { source: MANUAL, contractorId: cpOther.id });
    expect(denied.status).toBe(404);
  });

  it('файлы задачи видит тот, кто видит задачу: чужая задача — нет, даже у своего контрагента', async () => {
    const hidden = await task(owner, {
      title: 'Задача главного по Ала-Тоо',
      contractorId: cpAcc.id,
      executorEmployeeId: employee('chief-a'),
    });
    const id = await upload(chief, {
      source: { kind: 'task', id: hidden.id },
      name: 'Скрытый.pdf',
    });
    // Бухгалтер видит контрагента, а через карточку контрагента — и все его задачи (`taskAccessOf`).
    expect(await names(acc)).toContain('Скрытый.pdf');
    // У сотрудника без права «Просматривать контрагентов» доступа через контрагента нет.
    await f.t.admin.db
      .delete(schema.rolePermissions)
      .where(
        and(
          eq(schema.rolePermissions.roleId, f.roleIds.hr),
          eq(schema.rolePermissions.permissionId, 'cpView'),
        ),
      );
    const hr = await signIn(f.app, 'hr-a', TEST_PASSWORD);
    const hrNames = await names(hr);
    expect(hrNames).not.toContain('Скрытый.pdf');
    expect(hrNames).not.toContain('Акт сверки.pdf');
    await f.t.admin.db
      .update(schema.files)
      .set({ state: 'deleted', deletedAt: new Date(), deletedBy: f.people['chief-a']!.userId })
      .where(eq(schema.files.id, id));
  });

  it('плашки — по видам источника с файлами и «Загружено вручную» последней; щелчок — фильтр «Откуда»', async () => {
    expect((await summary(owner)).plates).toEqual([
      { kind: 'task', count: 2 },
      { kind: 'manual', count: 3 },
    ]);
    expect(await summary(acc)).toEqual({
      plates: [
        { kind: 'task', count: 1 },
        { kind: 'manual', count: 2 },
      ],
      canUpload: true,
    });
    const filters = encodeURIComponent(
      JSON.stringify({ kind: { type: 'enum', vals: ['manual'] } }),
    );
    expect(await names(owner, `filters=${filters}`)).toEqual([
      'Договор Садыкова.docx',
      'Договор обслуживания.pdf',
      'Устав организации.pdf',
    ]);
    // Поиск — по тому, что видно на экране: имени, источнику, контрагенту.
    expect(await names(owner, `q=${encodeURIComponent('садык')}`)).toEqual([
      'Акт Садыкова.png',
      'Договор Садыкова.docx',
    ]);
  });

  it('«Задачи» выключены — файлов задач в списке и плашки нет; «Файлы в карточках» выключены — 403', async () => {
    await features({ tasks: false, files: true });
    expect((await summary(owner)).plates).toEqual([{ kind: 'manual', count: 3 }]);
    expect((await manager(owner)).total).toBe(3);
    await features({ tasks: true, files: false });
    const off = await call('GET', '/api/files/manager', owner);
    expect(off.status).toBe(403);
    expect((await failure(off)).code).toBe('files_off');
    // Занятый объём виден и при выключенной функции: файлы всё равно лежат в хранилище.
    expect((await call('GET', '/api/files/usage', owner)).status).toBe(200);
    await features({ tasks: true, files: true });
  });

  it('без права «Просматривать файлы» — 403; чужая организация не видит файлов организации А', async () => {
    expect((await call('GET', '/api/files/manager', senior)).status).toBe(403);
    expect((await call('GET', '/api/files/usage', senior)).status).toBe(403);
    await f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: { files: true, tasks: true } })
      .where(eq(schema.orgSettings.orgId, f.b.orgId));
    expect((await manager(accB)).items).toEqual([]);
    expect(FileUsage.parse(await (await call('GET', '/api/files/usage', accB)).json())).toEqual({
      bytes: 0,
      count: 0,
    });
    expect((await call('GET', `/api/files/${ids.general}/view`, accB)).status).toBe(404);
  });

  it('«Хранилище файлов»: занятый объём и число видимых файлов', async () => {
    const big = await upload(owner, { source: MANUAL, name: 'Скан.jpg' }, 2048);
    expect(FileUsage.parse(await (await call('GET', '/api/files/usage', owner)).json())).toEqual({
      bytes: 5 * 5 + 2048,
      count: 6,
    });
    expect(FileUsage.parse(await (await call('GET', '/api/files/usage', acc)).json())).toEqual({
      bytes: 5 * 3 + 2048,
      count: 4,
    });
    const page = await manager(owner, `q=${encodeURIComponent('Скан')}`);
    expect(page.totals.size).toBe(2048);
    ids.big = big;
  });

  it('ручная загрузка: контрагент и комментарий — только у ручной; к архивному нельзя; в истории — у контрагента', async () => {
    const bad = await startUpload(acc, {
      source: { kind: 'task', id: '00000000-0000-4000-8000-000000000001' },
      note: 'нельзя',
    });
    expect(bad.status).toBe(400);
    const [entry] = await f.t.admin.db
      .select({ entity: schema.auditLog.entity, contractorId: schema.auditLog.contractorId })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.entityId, ids.manualAcc!),
          eq(schema.auditLog.action, 'file_attach'),
        ),
      );
    expect(entry).toEqual({ entity: 'file', contractorId: cpAcc.id });
    // Блок «Файлы» общих файлов организации показывает только общие файлы.
    const block = FileList.parse(await (await call('GET', '/api/files?kind=manual', owner)).json());
    expect(block.items.map((i) => i.name)).not.toContain('Договор обслуживания.pdf');
    await f.t.admin.db
      .update(schema.contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(schema.contractors.id, cpOther.id));
    expect((await startUpload(owner, { source: MANUAL, contractorId: cpOther.id })).status).toBe(
      403,
    );
    const options = FileFormContractors.parse(
      await (await call('GET', '/api/files/manager/contractors', owner)).json(),
    );
    expect(options.items.map((c) => c.name)).toEqual(['ОсОО «Ала-Тоо Трейд»']);
    // Файл архивного контрагента виден, но удалить его нельзя.
    const page = await manager(owner, `q=${encodeURIComponent('Договор Садыкова')}`);
    const file = page.items[0]!;
    const del = await call('DELETE', `/api/files/${file.id}?version=${file.version}`, owner);
    expect(del.status).toBe(403);
    await f.t.admin.db
      .update(schema.contractors)
      .set({ serviceStatus: 'active' })
      .where(eq(schema.contractors.id, cpOther.id));
  });

  it('просмотр в окне: картинка и PDF — ссылкой для браузера; остальное — 400, только скачать', async () => {
    const pdf = FileLink.parse(
      await (await call('GET', `/api/files/${ids.general}/view`, acc)).json(),
    );
    expect(pdf.url).toContain('inline=application%2Fpdf');
    const docx = await call('GET', `/api/files/${ids.manualOther}/view`, owner);
    expect(docx.status).toBe(400);
    expect((await failure(docx)).code).toBe('file_no_preview');
  });

  it('«Удалить» в списке: свой файл в течение суток — можно, чужой — с правом «Удалять файлы»', async () => {
    const mine = (await manager(acc)).items;
    expect(mine.find((r) => r.id === ids.taskAcc)?.canDelete).toBe(true);
    expect(mine.find((r) => r.id === ids.general)?.canDelete).toBe(false);
    expect((await manager(chief)).items.every((r) => r.canDelete)).toBe(true);
  });

  it('«В Excel» — видимые файлы с видимыми столбцами', async () => {
    const res = await call('GET', '/api/files/manager/export?cols=name,src,cp', acc);
    expect(res.status).toBe(200);
    const files = unzipTexts(new Uint8Array(await res.arrayBuffer()));
    const text = Object.values(files).join('');
    expect(text).toContain('Договор обслуживания.pdf');
    expect(text).toContain('Сверка с Ала-Тоо');
    expect(text).not.toContain('Садыков');
  });
});
