import { createFakeDocumentReader, type DocumentText } from '@buhuchet/adapters/documents';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { RD_MAX_BYTES } from '@buhuchet/domain';
import {
  ApiError,
  ContractorCreated,
  FileManagerList,
  FileUploadTicket,
  RegdocsRecognized,
} from '@buhuchet/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';
import fixture from './__fixtures__/regdocs-docs.json';
import { REGDOCS_RATE_LIMIT } from './regdocs';

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

// «Из свидетельства и выписки» (задача 2.17; прототип modules/contractor-regdocs.js). Документы —
// синтетические свидетельство и выписка вымышленной организации; чтение PDF — подделка: по содержимому
// файла отдаёт текст документа (настоящее чтение проверяет @buhuchet/adapters).
describe.skipIf(!databaseAvailable())('«Из свидетельства и выписки»: методы API', () => {
  let f: Fixture;
  let app: ReturnType<typeof createApp>;
  let owner: string;
  let hr: string;
  let senior: string;
  let ownerB: string;

  const text = (name: keyof typeof fixture.docs): DocumentText => ({
    ...(fixture.docs[name] as Omit<DocumentText, 'ocr'>),
    ocr: false,
  });
  const reader = createFakeDocumentReader({
    svid: { ok: true, doc: text('svid') },
    vyp: { ok: true, doc: text('vyp') },
    'vyp-other': { ok: true, doc: text('vypOther') },
    other: { ok: true, doc: text('other') },
    branch: { ok: true, doc: text('vypBranch') },
    locked: { ok: false, error: 'password' },
    scan: { ok: false, error: 'no_text' },
  });
  const failure = async (res: Response) => ApiError.parse(await res.json()).error;
  const post = (path: string, cookie: string | undefined, body: unknown) =>
    apiRequest(app, 'POST', path, cookie, body);

  /** Загрузить документ: начать загрузку и положить файл в хранилище (как браузер по ссылке). */
  const upload = async (
    content: string | null,
    o: { cookie?: string; orgId?: string; name?: string; size?: number } = {},
  ) => {
    const bytes = new TextEncoder().encode(content ?? '');
    const res = await post('/api/contractors/regdocs/uploads', o.cookie ?? owner, {
      name: o.name ?? `${content ?? 'нет'}.pdf`,
      size: o.size ?? bytes.length,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const { id } = FileUploadTicket.parse(await res.json());
    if (content !== null) {
      await f.deps.storage.put(`org/${o.orgId ?? f.a.orgId}/files/${id}`, bytes, {
        contentType: 'application/pdf',
      });
    }
    return id;
  };
  const recognized = async (files: string[], cookie = owner) => {
    const res = await post('/api/contractors/regdocs/recognize', cookie, { files });
    expect(res.status, await res.clone().text()).toBe(200);
    return RegdocsRecognized.parse(await res.json());
  };
  const fileRows = (ids: string[]) =>
    f.t.admin.db.select().from(schema.files).where(inArray(schema.files.id, ids));
  const draft = (inn: string, patch: Record<string, unknown> = {}) => ({
    name: 'ОсОО «Тестовая бухгалтерия»',
    inn,
    phone: '+996555010203',
    kind: 'regular',
    formCode: 'ФС-01',
    regimeCode: 'РЕЖ-01',
    gked: '69.20.0',
    startDate: '2026-10-01',
    responsibleEmployeeId: f.people['acc-a']!.employeeId,
    reports: [{ code: 'nds' }],
    ...patch,
  });

  beforeAll(async () => {
    f = await createStaffFixture();
    app = createApp({ ...f.deps, documents: reader });
    await seedAllPlatformDictionaries(f.t.admin.db);
    await f.t.admin.db
      .update(schema.orgSettings)
      .set({ features: { files: true } })
      .where(eq(schema.orgSettings.orgId, f.a.orgId));
    [owner, hr, senior, ownerB] = await Promise.all([
      signIn(app, 'owner-a', TEST_PASSWORD),
      signIn(app, 'hr-a', TEST_PASSWORD),
      signIn(app, 'senior-a', TEST_PASSWORD),
      signIn(app, 'owner-b', TEST_PASSWORD),
    ]);
    for (const cookie of [owner, ownerB]) {
      const res = await post('/api/org-report-types/connect', cookie, {
        connect: ['nds'],
        disconnect: [],
      });
      expect(res.status, await res.clone().text()).toBe(200);
    }
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('без входа — 401; без права «Создавать и изменять контрагентов» — 403; неверные данные — 400', async () => {
    const id = crypto.randomUUID();
    expect(
      (await post('/api/contractors/regdocs/uploads', undefined, { name: 'a.pdf', size: 1 }))
        .status,
    ).toBe(401);
    expect(
      (await post('/api/contractors/regdocs/recognize', undefined, { files: [id] })).status,
    ).toBe(401);
    expect(
      (await post('/api/contractors/regdocs/uploads', senior, { name: 'a.pdf', size: 1 })).status,
    ).toBe(403);
    expect((await post('/api/contractors/regdocs/recognize', senior, { files: [id] })).status).toBe(
      403,
    );
    // Не PDF, больше 10 МБ, неверное имя — «Загрузите PDF до 10 МБ».
    for (const body of [
      { name: 'устав.docx', size: 10 },
      { name: 'выписка.pdf', size: RD_MAX_BYTES + 1 },
      { name: 'a/b.pdf', size: 10 },
    ]) {
      const res = await post('/api/contractors/regdocs/uploads', owner, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await failure(res)).code).toBe('regdocs_file');
    }
    for (const body of [
      { files: [] },
      { files: Array.from({ length: 5 }, () => crypto.randomUUID()) },
      { files: ['не-номер'] },
      { files: [id], extra: true },
    ]) {
      const res = await post('/api/contractors/regdocs/recognize', owner, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const res = await post('/api/contractors/regdocs/uploads', owner, { name: 'a.pdf' });
    expect(res.status).toBe(400);
  });

  it('загрузка: незаконченная загрузка вида «Контрагент» без контрагента, от имени загрузившего', async () => {
    const id = await upload('svid', { name: '  Свидетельство.PDF ' });
    const [row] = await fileRows([id]);
    expect(row).toMatchObject({
      orgId: f.a.orgId,
      sourceKind: 'contractor',
      sourceId: null,
      contractorId: null,
      name: 'Свидетельство.PDF',
      contentType: 'application/pdf',
      state: 'pending',
      createdBy: f.a.ownerUserId,
      storageKey: `org/${f.a.orgId}/files/${id}`,
    });
  });

  it('общая загрузка файлов не кладёт файл вида «Контрагент»: его прикрепляет только создание контрагента', async () => {
    const res = await post('/api/files/uploads', owner, {
      source: { kind: 'contractor', id: crypto.randomUUID() },
      name: 'устав.pdf',
      size: 10,
    });
    expect(res.status).toBe(400);
    expect(await failure(res)).toMatchObject({ code: 'validation_failed' });
  });

  it('«Распознать» свидетельство и выписку: вид и дата у каждого, реквизиты и ГКЭД для формы', async () => {
    const out = await recognized([await upload('vyp'), await upload('svid')]);
    expect(out.files.map((x) => [x.state, x.kind, x.issued, x.error])).toEqual([
      ['ok', 'vyp', '2026-10-18', null],
      ['ok', 'svid', '2026-10-18', null],
    ]);
    expect(out.error).toBeNull();
    expect(out.duplicate).toBeNull();
    expect(out.result?.v).toMatchObject({
      name: 'ОсОО «Тестовая бухгалтерия»',
      inn: '02503202010045',
      okpo: '31415926',
      form: 'ФС-01',
      phone: '+996555010203',
      head: 'Тестова Айгуль Тестовна',
    });
    expect(out.result?.src.inn).toBe('both');
    expect(out.result?.gk).toMatchObject({
      code: '69.20.0',
      name: 'Деятельность в области бухгалтерского учета и аудита',
      src: 'vyp',
    });
    expect(out.result?.ugns).not.toBe('');
  });

  it('документ не распознан: другой вид, пароль, нет текста, филиал, не загружен, другого размера, чужой', async () => {
    const hrFile = await upload('svid', { cookie: hr });
    const files = [
      await upload('other'),
      await upload('locked'),
      await upload('scan'),
      await upload('branch'),
      await upload(null),
      await upload('svid', { size: 100 }),
      hrFile,
      crypto.randomUUID(),
    ];
    const first = await recognized(files.slice(0, 4));
    const second = await recognized(files.slice(4));
    expect([...first.files, ...second.files].map((x) => [x.state, x.error])).toEqual([
      ['bad', 'kind'],
      ['bad', 'password'],
      ['bad', 'read'],
      ['bad', 'ip'],
      ['bad', 'upload'],
      ['bad', 'size'],
      ['bad', 'upload'],
      ['bad', 'upload'],
    ]);
    expect(first.error).toBe('none');
    expect(first.result).toBeNull();
    expect(second.error).toBe('none');
  });

  it('два документа одного вида; документы разных организаций — формы нет', async () => {
    const same = await recognized([await upload('svid'), await upload('svid')]);
    expect(same).toMatchObject({ error: 'same', sameKind: 'svid', result: null });
    const diff = await recognized([await upload('svid'), await upload('vyp-other')]);
    expect(diff).toMatchObject({ error: 'diff', result: null });
  });

  it('«Сохранить»: оба PDF прикрепляются к контрагенту, в истории — «Создан из свидетельства и выписки (бета)»; повторная загрузка — «уже есть»', async () => {
    const svid = await upload('svid');
    const vyp = await upload('vyp');
    const lost = await upload(null);
    const hrFile = await upload('vyp', { cookie: hr });
    const res = await post(
      '/api/contractors',
      owner,
      draft('02503202010045', {
        regdocs: { files: [svid, vyp, lost, hrFile], recognized: true },
      }),
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const cp = ContractorCreated.parse(await res.json());
    const rows = await fileRows([svid, vyp, lost, hrFile]);
    const state = Object.fromEntries(rows.map((r) => [r.id, r]));
    for (const id of [svid, vyp]) {
      expect(state[id]).toMatchObject({
        state: 'ready',
        sourceKind: 'contractor',
        sourceId: null,
        contractorId: cp.id,
      });
    }
    // Не дошедший до хранилища и чужой — не прикреплены.
    expect(state[lost]).toMatchObject({ state: 'pending', contractorId: null });
    expect(state[hrFile]).toMatchObject({ state: 'pending', contractorId: null });
    const [created] = await f.t.admin.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.entity, 'contractor'),
          eq(schema.auditLog.entityId, cp.id),
          eq(schema.auditLog.action, 'create'),
        ),
      );
    expect(created?.reason).toBe('Создан из свидетельства и выписки (бета)');
    // В «Файловом менеджере» и на вкладке «Файлы» — вид «Контрагент», источник «Из свидетельства и выписки».
    const list = await apiRequest(
      app,
      'GET',
      `/api/files/manager?size=all&filters=${encodeURIComponent(JSON.stringify({ cp: { type: 'enum', vals: [cp.id] } }))}`,
      owner,
    );
    expect(list.status, await list.clone().text()).toBe(200);
    const items = FileManagerList.parse(await list.json()).items;
    expect(items.map((x) => [x.kind, x.source]).sort()).toEqual([
      ['contractor', 'Из свидетельства и выписки'],
      ['contractor', 'Из свидетельства и выписки'],
    ]);
    // Файл открывается по ссылке тому, кто видит контрагента; другой организации — нет. Удаление — в
    // истории контрагента.
    expect((await apiRequest(app, 'GET', `/api/files/${svid}/link`, owner)).status).toBe(200);
    expect((await apiRequest(app, 'GET', `/api/files/${svid}/link`, ownerB)).status).toBe(404);
    const del = await apiRequest(
      app,
      'DELETE',
      `/api/files/${vyp}?version=${state[vyp]!.version}`,
      owner,
    );
    expect(del.status, await del.clone().text()).toBe(200);
    const [deleted] = await f.t.admin.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityId, vyp), eq(schema.auditLog.action, 'file_delete')));
    expect(deleted).toMatchObject({ entity: 'file', contractorId: cp.id });
    // Те же документы ещё раз: контрагент с этим ИНН уже есть. Сотруднику с областью «Свои» (контрагент
    // не его) — без номера: название, как в ответе формы, а открыть нельзя.
    const again = [await upload('svid'), await upload('vyp')];
    expect((await recognized(again)).duplicate).toEqual({
      inn: '02503202010045',
      id: cp.id,
      name: 'ОсОО «Тестовая бухгалтерия»',
      archived: false,
    });
    const own = [await upload('svid', { cookie: hr }), await upload('vyp', { cookie: hr })];
    expect((await recognized(own, hr)).duplicate).toEqual({
      inn: '02503202010045',
      id: null,
      name: 'ОсОО «Тестовая бухгалтерия»',
      archived: false,
    });
  });

  it('«Заполнить вручную»: файлы прикрепляются, в истории — обычное создание', async () => {
    const file = await upload('other');
    const res = await post(
      '/api/contractors',
      owner,
      draft('02503202010053', {
        name: 'ОсОО «Вручную»',
        regdocs: { files: [file], recognized: false },
      }),
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const cp = ContractorCreated.parse(await res.json());
    expect((await fileRows([file]))[0]).toMatchObject({ state: 'ready', contractorId: cp.id });
    const [created] = await f.t.admin.db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.entity, 'contractor'),
          eq(schema.auditLog.entityId, cp.id),
          eq(schema.auditLog.action, 'create'),
        ),
      );
    expect(created?.reason).toBeNull();
  });

  it('чужая организация не видна: документы другой организации не читаются и не прикрепляются', async () => {
    const mine = await upload('svid');
    const theirs = await upload('vyp', { cookie: ownerB, orgId: f.b.orgId });
    expect((await recognized([mine], ownerB)).files[0]).toMatchObject({
      state: 'bad',
      error: 'upload',
    });
    const res = await post(
      '/api/contractors',
      ownerB,
      draft('02503202010061', {
        responsibleEmployeeId: f.b.ownerEmployeeId,
        regdocs: { files: [mine, theirs], recognized: true },
      }),
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const cp = ContractorCreated.parse(await res.json());
    const rows = Object.fromEntries((await fileRows([mine, theirs])).map((r) => [r.id, r]));
    expect(rows[mine]).toMatchObject({ orgId: f.a.orgId, state: 'pending', contractorId: null });
    expect(rows[theirs]).toMatchObject({ orgId: f.b.orgId, state: 'ready', contractorId: cp.id });
    // ИНН контрагента другой организации не мешает: в своей его нет.
    const again = await recognized(
      [await upload('svid', { cookie: ownerB, orgId: f.b.orgId })],
      ownerB,
    );
    expect(again.duplicate).toBeNull();
  });

  it('по очереди: идёт прежнее распознавание — 429 «ещё распознаются», за час уже 30 — 429', async () => {
    const { userId } = f.people['chief-a']!;
    const chief = await signIn(app, 'chief-a', TEST_PASSWORD);
    const mine = and(
      eq(schema.rateLimits.kind, REGDOCS_RATE_LIMIT.kind),
      eq(schema.rateLimits.subject, userId),
    );
    const file = await upload('svid', { cookie: chief });
    await f.t.admin.db.insert(schema.rateLimits).values({
      kind: REGDOCS_RATE_LIMIT.kind,
      subject: userId,
      busyUntil: new Date(Date.now() + 60_000),
    });
    const busy = await post('/api/contractors/regdocs/recognize', chief, { files: [file] });
    expect(busy.status).toBe(429);
    expect((await failure(busy)).code).toBe('regdocs_busy');
    await f.t.admin.db.update(schema.rateLimits).set({ busyUntil: null }).where(mine);
    await f.t.admin.db.insert(schema.rateLimits).values(
      Array.from({ length: REGDOCS_RATE_LIMIT.max - 1 }, () => ({
        kind: REGDOCS_RATE_LIMIT.kind,
        subject: userId,
        at: new Date(Date.now() - 30 * 60_000),
      })),
    );
    const limited = await post('/api/contractors/regdocs/recognize', chief, { files: [file] });
    expect(limited.status).toBe(429);
    expect((await failure(limited)).code).toBe('regdocs_limit');
    await f.t.admin.db.delete(schema.rateLimits).where(mine);
  });
});
