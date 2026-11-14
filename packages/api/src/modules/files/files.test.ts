import type { MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable, seedAllPlatformDictionaries } from '@buhuchet/db/testing';
import { FILE_MAX_BYTES, FILE_MESSAGES, FILE_UPLOADS_PER_HOUR } from '@buhuchet/domain';
import {
  ApiError,
  FileItem,
  FileLink,
  FileList,
  FileUploadTicket,
  OrgPolicy,
} from '@buhuchet/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';
import { cleanupPendingFiles } from './cleanup';
import { FILE_SOURCES, type FileSource } from './sources';

const { auditLog, files, rateLimits } = schema;

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

async function apiErr(res: Response) {
  return ApiError.parse(await res.json()).error;
}

/** Записи-подделки с контрагентом: `id → ответственный и можно ли менять`. */
const records = new Map<string, { responsible: string | null; editable: boolean }>();

/** Источник «запись с контрагентом» — как будущие отчёты и проекты (история — у записи). */
const recordSource: FileSource = {
  async resolve(_tx, _subject, id) {
    const r = id ? records.get(id) : undefined;
    if (!id || !r) return null;
    return {
      contractor: {
        id: '00000000-0000-4000-8000-0000000000c1',
        responsibleEmployeeId: r.responsible,
      },
      editable: r.editable,
      history: () => ({
        entity: 'org_report_type',
        entityId: id,
        contractorId: '00000000-0000-4000-8000-0000000000c1',
      }),
    };
  },
};

describe.skipIf(!databaseAvailable())('Файлы записей: API', () => {
  let f: Fixture;
  let app: ReturnType<typeof createApp>;
  let storage: MemoryStorage;
  let owner: string;
  let chief: string;
  let acc: string;
  let senior: string;
  let accB: string;

  const call = (
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    path: string,
    cookie?: string,
    body?: unknown,
  ) => apiRequest(app, method, path, cookie, body);

  const MANUAL = { kind: 'manual', id: null };

  async function list(cookie: string, query = 'kind=manual'): Promise<FileList> {
    const res = await call('GET', `/api/files?${query}`, cookie);
    expect(res.status).toBe(200);
    return FileList.parse(await res.json());
  }

  async function start(
    cookie: string,
    name: string,
    size: number,
    source: { kind: string; id: string | null } = MANUAL,
  ) {
    return call('POST', '/api/files/uploads', cookie, { source, name, size });
  }

  /** Загрузить файл целиком: начать, положить в хранилище, закончить. */
  async function upload(
    cookie: string,
    name: string,
    body = new Uint8Array([1, 2, 3, 4, 5]),
    source: { kind: string; id: string | null } = MANUAL,
  ): Promise<FileItem> {
    const started = await start(cookie, name, body.length, source);
    expect(started.status).toBe(201);
    const ticket = FileUploadTicket.parse(await started.json());
    const key = new URL(ticket.upload.url).host + new URL(ticket.upload.url).pathname;
    await storage.put(key, body, { contentType: ticket.upload.headers['content-type']! });
    const done = await call('POST', `/api/files/${ticket.id}/complete`, cookie);
    expect(done.status).toBe(200);
    return FileItem.parse(await done.json());
  }

  const history = (entityId: string) =>
    f.t.admin.db
      .select({ action: auditLog.action, changes: auditLog.changes, entity: auditLog.entity })
      .from(auditLog)
      .where(eq(auditLog.entityId, entityId))
      .orderBy(auditLog.id);

  const keyOf = async (id: string) =>
    (await f.t.admin.db.select({ key: files.storageKey }).from(files).where(eq(files.id, id)))[0]!
      .key;

  beforeAll(async () => {
    f = await createStaffFixture();
    // Контрагент записей-подделок: на него ссылаются файлы и история (внешние ключи на контрагентов).
    await seedAllPlatformDictionaries(f.t.admin.db);
    await f.t.admin.db.insert(schema.contractors).values({
      id: '00000000-0000-4000-8000-0000000000c1',
      orgId: f.a.orgId,
      name: 'ОсОО «Ала-Тоо Трейд»',
      inn: '03744097401851',
      phone: '+996505890076',
      formCode: 'ФС-01',
      regimeCode: 'РЕЖ-01',
      startDate: '2026-01-15',
    });
    storage = f.deps.storage as MemoryStorage;
    app = createApp({ ...f.deps, fileSources: { ...FILE_SOURCES, record: recordSource } });
    owner = await signIn(app, 'owner-a', TEST_PASSWORD);
    chief = await signIn(app, 'chief-a', TEST_PASSWORD);
    acc = await signIn(app, 'acc-a', TEST_PASSWORD);
    senior = await signIn(app, 'senior-a', TEST_PASSWORD);
    accB = await signIn(app, 'acc-b', TEST_PASSWORD);
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  describe('кто видит блок «Файлы»', () => {
    it('без входа — 401; без права «Просматривать файлы» — 403', async () => {
      expect((await call('GET', '/api/files?kind=manual')).status).toBe(401);
      const res = await call('GET', '/api/files?kind=manual', senior);
      expect(res.status).toBe(403);
      expect((await apiErr(res)).code).toBe('forbidden');
    });

    it('пустой список и «Прикрепить» для того, у кого есть «Загружать файлы»', async () => {
      expect(await list(owner)).toEqual({ items: [], canUpload: true });
      expect((await list(acc)).canUpload).toBe(true);
    });

    it('неизвестный вид записи, номер у «Загружен вручную», нет такой записи — 404', async () => {
      for (const query of [
        'kind=unknown',
        'kind=manual&id=00000000-0000-4000-8000-000000000001',
        'kind=record&id=00000000-0000-4000-8000-000000000001',
        'kind=record',
        // Поля прототипа объекта — не источники.
        'kind=constructor',
        'kind=__proto__',
        'kind=to_string',
      ]) {
        const res = await call('GET', `/api/files?${query}`, chief);
        expect(res.status, query).toBe(404);
      }
      expect((await call('GET', '/api/files?kind=Bad-Kind', chief)).status).toBe(400);
    });

    it('область «Свои»: файлы записи чужого контрагента не видны, своего — видны', async () => {
      const chiefsRecord = crypto.randomUUID();
      const accsRecord = crypto.randomUUID();
      records.set(chiefsRecord, { responsible: f.people['chief-a']!.employeeId, editable: true });
      records.set(accsRecord, { responsible: f.people['acc-a']!.employeeId, editable: true });
      expect((await call('GET', `/api/files?kind=record&id=${chiefsRecord}`, acc)).status).toBe(
        404,
      );
      expect((await start(acc, 'акт.pdf', 10, { kind: 'record', id: chiefsRecord })).status).toBe(
        404,
      );
      expect((await list(acc, `kind=record&id=${accsRecord}`)).canUpload).toBe(true);
      // «Все» у главного бухгалтера.
      expect((await list(chief, `kind=record&id=${chiefsRecord}`)).items).toEqual([]);
    });

    it('запись, которую менять нельзя (архив): прикреплять нельзя — 403', async () => {
      const archived = crypto.randomUUID();
      records.set(archived, { responsible: f.people['acc-a']!.employeeId, editable: false });
      expect((await list(acc, `kind=record&id=${archived}`)).canUpload).toBe(false);
      const res = await start(acc, 'акт.pdf', 10, { kind: 'record', id: archived });
      expect(res.status).toBe(403);
      expect((await apiErr(res)).code).toBe('forbidden');
    });
  });

  describe('загрузка', () => {
    it('файл записывается, виден в записи и в её истории («Прикреплён файл»)', async () => {
      const recordId = crypto.randomUUID();
      records.set(recordId, { responsible: f.people['acc-a']!.employeeId, editable: true });
      const item = await upload(acc, ' Акт сверки.PDF ', new Uint8Array(1500), {
        kind: 'record',
        id: recordId,
      });
      expect(item).toMatchObject({
        name: 'Акт сверки.PDF',
        contentType: 'application/pdf',
        size: 1500,
        uploadedBy: 'acc-a',
        canDelete: true,
        version: 2,
      });
      expect((await list(acc, `kind=record&id=${recordId}`)).items).toEqual([item]);
      expect(await history(recordId)).toEqual([
        {
          entity: 'org_report_type',
          action: 'file_attach',
          changes: [{ field: 'file', to: 'Акт сверки.PDF' }],
        },
      ]);
      const [row] = await f.t.admin.db.select().from(files).where(eq(files.id, item.id));
      expect(row).toMatchObject({
        orgId: f.a.orgId,
        state: 'ready',
        sourceKind: 'record',
        sourceId: recordId,
        contractorId: '00000000-0000-4000-8000-0000000000c1',
        storageKey: `org/${f.a.orgId}/files/${item.id}`,
        createdBy: f.people['acc-a']!.userId,
      });
    });

    it('ссылка на хранилище подписана на размер и тип файла', async () => {
      const res = await start(acc, 'отчёт.xlsx', 2048);
      const ticket = FileUploadTicket.parse(await res.json());
      expect(ticket.upload.method).toBe('PUT');
      expect(ticket.upload.headers).toEqual({
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      expect(ticket.upload.url).toContain(`org/${f.a.orgId}/files/${ticket.id}`);
      expect(ticket.upload.url).toContain('size=2048');
      // Ссылка на загрузку — 2 минуты: показанный в записи файл ею потом не подменить.
      expect(ticket.upload.url).toContain('expires=120');
      // Пока файл не загружен, его нет в записи.
      expect((await list(acc)).items.some((i) => i.id === ticket.id)).toBe(false);
    });

    it('файл больше 20 МБ, программа или веб-страница, неверное имя — 400 с понятным текстом', async () => {
      const cases: [string, number, keyof typeof FILE_MESSAGES][] = [
        ['большой.pdf', FILE_MAX_BYTES + 1, 'file_too_large'],
        ['setup.exe', 10, 'file_type_forbidden'],
        ['page.HTML', 10, 'file_type_forbidden'],
        ['папка/акт.pdf', 10, 'file_name_invalid'],
        ['   ', 10, 'file_name_invalid'],
      ];
      for (const [name, size, code] of cases) {
        const res = await start(acc, name, size);
        expect(res.status, name).toBe(400);
        expect(await apiErr(res), name).toEqual({ code, message: FILE_MESSAGES[code] });
      }
      expect((await start(acc, 'ровно.pdf', FILE_MAX_BYTES)).status).toBe(201);
    });

    it('без права «Загружать файлы» начать загрузку нельзя', async () => {
      expect((await start(senior, 'акт.pdf', 10)).status).toBe(403);
    });

    it('файл не дошёл до хранилища — 409, загрузку можно повторить', async () => {
      const ticket = FileUploadTicket.parse(await (await start(acc, 'акт.pdf', 5)).json());
      const res = await call('POST', `/api/files/${ticket.id}/complete`, acc);
      expect(res.status).toBe(409);
      expect((await apiErr(res)).code).toBe('file_not_uploaded');
      const key = await keyOf(ticket.id);
      await storage.put(key, new Uint8Array(5), { contentType: 'application/pdf' });
      expect((await call('POST', `/api/files/${ticket.id}/complete`, acc)).status).toBe(200);
      // Второй раз закончить нельзя.
      expect((await call('POST', `/api/files/${ticket.id}/complete`, acc)).status).toBe(404);
    });

    it('в хранилище файл другого размера — загрузка отменяется, файл удаляется', async () => {
      const ticket = FileUploadTicket.parse(await (await start(acc, 'акт.pdf', 5)).json());
      const key = await keyOf(ticket.id);
      await storage.put(key, new Uint8Array(7), { contentType: 'application/pdf' });
      const res = await call('POST', `/api/files/${ticket.id}/complete`, acc);
      expect(res.status).toBe(409);
      expect(await storage.exists(key)).toBe(false);
      expect(await f.t.admin.db.select().from(files).where(eq(files.id, ticket.id))).toEqual([]);
    });

    it('в хранилище файл другого типа (не тот, что подписан) — загрузка отменяется', async () => {
      const ticket = FileUploadTicket.parse(await (await start(acc, 'акт.pdf', 5)).json());
      const key = await keyOf(ticket.id);
      await storage.put(key, new Uint8Array(5), { contentType: 'text/html' });
      const res = await call('POST', `/api/files/${ticket.id}/complete`, acc);
      expect(res.status).toBe(409);
      expect((await apiErr(res)).code).toBe('file_not_uploaded');
      expect(await storage.exists(key)).toBe(false);
      expect(await f.t.admin.db.select().from(files).where(eq(files.id, ticket.id))).toEqual([]);
    });

    it('больше 300 начатых загрузок за час — 429, загрузка не начинается', async () => {
      const userId = f.people['hr-a']!.userId;
      const hr = await signIn(app, 'hr-a', TEST_PASSWORD);
      await f.t.admin.db.insert(rateLimits).values(
        Array.from({ length: FILE_UPLOADS_PER_HOUR - 1 }, () => ({
          kind: 'file_upload',
          subject: userId,
        })),
      );
      expect((await start(hr, 'последний.pdf', 5)).status).toBe(201);
      const res = await start(hr, 'лишний.pdf', 5);
      expect(res.status).toBe(429);
      expect(await apiErr(res)).toEqual({
        code: 'file_upload_limit',
        message: FILE_MESSAGES.file_upload_limit,
      });
      // Другому пользователю предел не мешает.
      expect((await start(acc, 'свой.pdf', 5)).status).toBe(201);
      await f.t.admin.db.delete(rateLimits).where(eq(rateLimits.subject, userId));
    });

    it('в хранилище больше 20 МБ — 400 «Файл больше 20 МБ», файл удаляется', async () => {
      const ticket = FileUploadTicket.parse(await (await start(acc, 'акт.pdf', 5)).json());
      const key = await keyOf(ticket.id);
      await storage.put(key, new Uint8Array(FILE_MAX_BYTES + 1), {
        contentType: 'application/pdf',
      });
      const res = await call('POST', `/api/files/${ticket.id}/complete`, acc);
      expect(res.status).toBe(400);
      expect((await apiErr(res)).message).toBe('Файл больше 20 МБ');
      expect(await storage.exists(key)).toBe(false);
    });

    it('закончить чужую загрузку нельзя — 404', async () => {
      const ticket = FileUploadTicket.parse(await (await start(acc, 'акт.pdf', 5)).json());
      await storage.put(await keyOf(ticket.id), new Uint8Array(5), {
        contentType: 'application/pdf',
      });
      expect((await call('POST', `/api/files/${ticket.id}/complete`, chief)).status).toBe(404);
      expect((await call('POST', `/api/files/${ticket.id}/complete`, accB)).status).toBe(404);
    });
  });

  describe('скачивание', () => {
    it('ссылка на 15 минут с именем файла; /download переходит на неё', async () => {
      const item = await upload(acc, 'Договор №5.docx');
      const res = await call('GET', `/api/files/${item.id}/link`, chief);
      expect(res.status).toBe(200);
      const link = FileLink.parse(await res.json());
      expect(link.url).toContain(`org/${f.a.orgId}/files/${item.id}`);
      expect(link.url).toContain('expires=900');
      expect(new URL(link.url).searchParams.get('name')).toBe('Договор №5.docx');
      const go = await call('GET', `/api/files/${item.id}/download`, chief);
      expect(go.status).toBe(302);
      expect(go.headers.get('location')).toBe(link.url);
    });

    it('без входа, без права и из чужой организации — не скачать', async () => {
      const item = await upload(acc, 'секрет.pdf');
      expect((await call('GET', `/api/files/${item.id}/link`)).status).toBe(401);
      expect((await call('GET', `/api/files/${item.id}/link`, senior)).status).toBe(403);
      for (const path of [`/api/files/${item.id}/link`, `/api/files/${item.id}/download`]) {
        expect((await call('GET', path, accB)).status, path).toBe(404);
      }
      expect((await list(accB)).items).toEqual([]);
    });
  });

  describe('удаление', () => {
    it('свой файл в течение суток удаляется без права «Удалять файлы»; в истории — «Удалён файл»', async () => {
      const item = await upload(acc, 'черновик.txt');
      const key = await keyOf(item.id);
      const res = await call('DELETE', `/api/files/${item.id}?version=${item.version}`, acc);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: item.id });
      expect((await list(acc)).items.some((i) => i.id === item.id)).toBe(false);
      expect(await storage.exists(key)).toBe(false);
      expect((await history(item.id)).map((h) => [h.entity, h.action, h.changes])).toEqual([
        ['file', 'file_attach', [{ field: 'file', to: 'черновик.txt' }]],
        ['file', 'file_delete', [{ field: 'file', from: 'черновик.txt' }]],
      ]);
      const [row] = await f.t.admin.db.select().from(files).where(eq(files.id, item.id));
      expect(row).toMatchObject({ state: 'deleted', deletedBy: f.people['acc-a']!.userId });
      // Удалённый файл не скачать.
      expect((await call('GET', `/api/files/${item.id}/link`, acc)).status).toBe(404);
    });

    it('чужой файл и свой старше суток — только с правом «Удалять файлы»', async () => {
      const chiefs = await upload(chief, 'приказ.pdf');
      const old = await upload(acc, 'старый.pdf');
      await f.t.admin.db
        .update(files)
        .set({ createdAt: sql`now() - interval '25 hours'` })
        .where(eq(files.id, old.id));
      const items = (await list(acc)).items;
      expect(items.find((i) => i.id === chiefs.id)?.canDelete).toBe(false);
      expect(items.find((i) => i.id === old.id)?.canDelete).toBe(false);
      for (const item of [chiefs, old]) {
        const res = await call('DELETE', `/api/files/${item.id}?version=${item.version}`, acc);
        expect(res.status).toBe(403);
        expect(await apiErr(res)).toEqual({
          code: 'file_delete_forbidden',
          message: FILE_MESSAGES.file_delete_forbidden,
        });
      }
      expect((await list(chief)).items.find((i) => i.id === old.id)?.canDelete).toBe(true);
      expect(
        (await call('DELETE', `/api/files/${old.id}?version=${old.version}`, chief)).status,
      ).toBe(200);
    });

    it('устаревшая версия — «запись изменена другим пользователем»', async () => {
      const item = await upload(acc, 'версия.pdf');
      const res = await call('DELETE', `/api/files/${item.id}?version=${item.version - 1}`, acc);
      expect(res.status).toBe(409);
      expect((await apiErr(res)).code).toBe('record_changed');
      expect(
        (await call('DELETE', `/api/files/${item.id}?version=${item.version}`, acc)).status,
      ).toBe(200);
      expect(
        (await call('DELETE', `/api/files/${item.id}?version=${item.version + 1}`, acc)).status,
      ).toBe(404);
    });

    it('файл записи, которую менять нельзя, не удаляется даже главным бухгалтером', async () => {
      const recordId = crypto.randomUUID();
      records.set(recordId, { responsible: f.people['chief-a']!.employeeId, editable: true });
      const item = await upload(chief, 'акт.pdf', undefined, { kind: 'record', id: recordId });
      records.set(recordId, { responsible: f.people['chief-a']!.employeeId, editable: false });
      const res = await call('DELETE', `/api/files/${item.id}?version=${item.version}`, chief);
      expect(res.status).toBe(403);
      expect((await apiErr(res)).code).toBe('forbidden');
    });

    it('файл чужой организации — 404', async () => {
      const item = await upload(acc, 'чужое.pdf');
      expect(
        (await call('DELETE', `/api/files/${item.id}?version=${item.version}`, accB)).status,
      ).toBe(404);
    });
  });

  describe('показ на странице контрагента (прототип v74)', () => {
    const C1 = '00000000-0000-4000-8000-0000000000c1';
    const cppage = (on: boolean) =>
      f.t.admin.db
        .update(schema.orgSettings)
        .set({
          features: sql`${schema.orgSettings.features} || ${JSON.stringify({ cppage: on })}::jsonb`,
        })
        .where(eq(schema.orgSettings.orgId, f.a.orgId));
    /** Ручная загрузка с контрагентом (Файловый менеджер, вкладка «Файлы» карточки). */
    async function uploadFor(
      cookie: string,
      name: string,
      extra: { contractorId?: string; page?: boolean } = { contractorId: C1 },
    ): Promise<FileItem> {
      const started = await call('POST', '/api/files/uploads', cookie, {
        source: MANUAL,
        name,
        size: 5,
        ...extra,
      });
      expect(started.status, await started.clone().text()).toBe(201);
      const ticket = FileUploadTicket.parse(await started.json());
      const key = new URL(ticket.upload.url).host + new URL(ticket.upload.url).pathname;
      await storage.put(key, new Uint8Array(5), {
        contentType: ticket.upload.headers['content-type']!,
      });
      const done = await call('POST', `/api/files/${ticket.id}/complete`, cookie);
      expect(done.status).toBe(200);
      return FileItem.parse(await done.json());
    }
    const setPage = (cookie: string, id: string, hidden: boolean) =>
      call('POST', `/api/files/${id}/page`, cookie, { hidden });
    const hiddenOf = async (id: string) =>
      (await f.t.admin.db.select({ v: files.pageHidden }).from(files).where(eq(files.id, id)))[0]!
        .v;

    beforeAll(async () => {
      await cppage(true);
    });
    afterAll(async () => {
      await cppage(false);
    });

    it('«Скрыть со страницы контрагента» и «Показать»: отметка у файла, смена — в истории', async () => {
      const item = await uploadFor(owner, 'Устав.pdf');
      expect(item.page).toEqual({ hidden: false, canChange: true });
      const hide = await setPage(owner, item.id, true);
      expect(hide.status).toBe(200);
      expect(await hide.json()).toEqual({ hidden: true, canChange: true });
      expect(await hiddenOf(item.id)).toBe(true);
      // Уже скрыт — без новой записи в истории.
      expect((await setPage(chief, item.id, true)).status).toBe(200);
      expect((await setPage(chief, item.id, false)).status).toBe(200);
      expect(await hiddenOf(item.id)).toBe(false);
      expect((await history(item.id)).map((h) => [h.entity, h.action, h.changes])).toEqual([
        ['file', 'file_attach', [{ field: 'file', to: 'Устав.pdf' }]],
        ['file', 'file_hide', [{ field: 'file', to: 'Устав.pdf' }]],
        ['file', 'file_show', [{ field: 'file', to: 'Устав.pdf' }]],
      ]);
    });

    it('загрузка со снятой галочкой «Показывать контрагенту»: файл скрыт, в истории — «скрыт»', async () => {
      const item = await uploadFor(owner, 'Черновик.pdf', { contractorId: C1, page: false });
      expect(item.page).toEqual({ hidden: true, canChange: true });
      expect((await history(item.id)).map((h) => h.action)).toEqual(['file_attach', 'file_hide']);
      // Без контрагента галочка ничего не меняет: файл на страницу не попадает.
      const general = await uploadFor(owner, 'Общий.pdf', { page: false });
      expect(general.page).toBeNull();
      expect(await hiddenOf(general.id)).toBe(false);
    });

    it('без права «Управлять страницей контрагента» — 403; файл не контрагента — 400; нет файла — 404', async () => {
      const item = await uploadFor(owner, 'Договор.pdf');
      const denied = await setPage(acc, item.id, true);
      expect(denied.status).toBe(403);
      expect((await apiErr(denied)).code).toBe('forbidden');
      expect(await hiddenOf(item.id)).toBe(false);
      // Общий файл организации и файл записи без страницы (здесь — запись-подделка) не показываются.
      const general = await uploadFor(owner, 'Приказ.pdf', {});
      const recordId = crypto.randomUUID();
      records.set(recordId, { responsible: f.people['chief-a']!.employeeId, editable: true });
      const recordFile = await upload(chief, 'акт.pdf', undefined, {
        kind: 'record',
        id: recordId,
      });
      expect(recordFile.page).toBeNull();
      for (const id of [general.id, recordFile.id]) {
        const res = await setPage(owner, id, true);
        expect(res.status, id).toBe(400);
        expect((await apiErr(res)).code).toBe('validation_failed');
      }
      expect((await setPage(owner, crypto.randomUUID(), true)).status).toBe(404);
      expect((await setPage(accB, item.id, true)).status).toBe(403);
      // Владелец другой организации (право есть) файла не находит — 404, существование не раскрыто.
      const ownerB = await signIn(app, 'owner-b', TEST_PASSWORD);
      expect((await setPage(ownerB, item.id, true)).status).toBe(404);
      expect(await hiddenOf(item.id)).toBe(false);
      const bad = await call('POST', `/api/files/${item.id}/page`, owner, { hidden: 'да' });
      expect(bad.status).toBe(400);
    });

    it('«Страница контрагента по ссылке» выключена — отметки нет, менять — 403', async () => {
      const item = await uploadFor(owner, 'Выписка.pdf');
      await cppage(false);
      try {
        const res = await setPage(owner, item.id, true);
        expect(res.status).toBe(403);
        expect((await apiErr(res)).code).toBe('cppage_off');
        // Галочка при выключенной функции файл не скрывает.
        const quiet = await uploadFor(owner, 'Тихий.pdf', { contractorId: C1, page: false });
        expect(quiet.page).toBeNull();
        expect(await hiddenOf(quiet.id)).toBe(false);
      } finally {
        await cppage(true);
      }
    });
  });

  describe('«Изменить файл» и примечание (прототип v95)', () => {
    const newRecord = (who: string, editable = true) => {
      const id = crypto.randomUUID();
      records.set(id, { responsible: f.people[who]!.employeeId, editable });
      return { kind: 'record', id };
    };
    const edit = (cookie: string, id: string, body: unknown) =>
      call('PATCH', `/api/files/${id}`, cookie, body);

    /** Начать замену и положить новый файл в хранилище; ответ — номер загрузки-замены. */
    async function replacement(cookie: string, id: string, name: string, body: Uint8Array) {
      const started = await call('POST', `/api/files/${id}/replacement`, cookie, {
        name,
        size: body.length,
      });
      expect(started.status).toBe(201);
      const ticket = FileUploadTicket.parse(await started.json());
      const key = new URL(ticket.upload.url).host + new URL(ticket.upload.url).pathname;
      await storage.put(key, body, { contentType: ticket.upload.headers['content-type']! });
      return ticket.id;
    }

    it('примечание при прикреплении: одной строкой, в ответе, в списке записи и в её истории', async () => {
      const source = newRecord('acc-a');
      const started = await call('POST', '/api/files/uploads', acc, {
        source,
        name: 'договор.pdf',
        size: 3,
        note: '  Договор\n за 2026   год ',
      });
      expect(started.status).toBe(201);
      const ticket = FileUploadTicket.parse(await started.json());
      const key = new URL(ticket.upload.url).host + new URL(ticket.upload.url).pathname;
      await storage.put(key, new Uint8Array(3), { contentType: 'application/pdf' });
      const done = await call('POST', `/api/files/${ticket.id}/complete`, acc);
      const item = FileItem.parse(await done.json());
      expect(item).toMatchObject({
        note: 'Договор за 2026 год',
        canEdit: true,
        canReplace: true,
      });
      expect((await list(acc, `kind=record&id=${source.id}`)).items).toEqual([item]);
      expect((await history(source.id)).map((h) => [h.action, h.changes])).toEqual([
        [
          'file_attach',
          [
            { field: 'file', to: 'договор.pdf' },
            { field: 'note', to: 'Договор за 2026 год' },
          ],
        ],
      ]);
      // Без примечания — как раньше: в ответе null, в истории только файл.
      const plain = await upload(acc, 'без примечания.pdf', undefined, source);
      expect(plain.note).toBeNull();
    });

    it('название и примечание: расширение остаётся, история — одной записью, без изменений — ничего', async () => {
      const source = newRecord('acc-a');
      const item = await upload(acc, 'скан0001.pdf', undefined, source);
      const res = await edit(acc, item.id, {
        version: item.version,
        name: ' Договор   обслуживания.pdf ',
        note: 'подписан\nобеими сторонами',
      });
      expect(res.status).toBe(200);
      const saved = FileItem.parse(await res.json());
      expect(saved).toMatchObject({
        id: item.id,
        name: 'Договор обслуживания.pdf',
        note: 'подписан обеими сторонами',
        contentType: 'application/pdf',
        size: 5,
        version: item.version + 1,
      });
      // То же самое ещё раз — ни новой версии, ни записи в истории.
      const same = await edit(acc, item.id, {
        version: saved.version,
        name: saved.name,
        note: saved.note,
      });
      expect(same.status).toBe(200);
      expect(FileItem.parse(await same.json()).version).toBe(saved.version);
      // Примечание убрано.
      const cleared = await edit(acc, item.id, {
        version: saved.version,
        name: saved.name,
        note: '',
      });
      expect(FileItem.parse(await cleared.json())).toMatchObject({
        note: null,
        version: saved.version + 1,
      });
      expect((await history(source.id)).map((h) => [h.action, h.changes])).toEqual([
        ['file_attach', [{ field: 'file', to: 'скан0001.pdf' }]],
        [
          'file_edit',
          [
            { field: 'file', to: 'Договор обслуживания.pdf' },
            { field: 'name', from: 'скан0001.pdf', to: 'Договор обслуживания.pdf' },
            { field: 'note', from: null, to: 'подписан обеими сторонами' },
          ],
        ],
        [
          'file_edit',
          [
            { field: 'file', to: 'Договор обслуживания.pdf' },
            { field: 'note', from: 'подписан обеими сторонами', to: null },
          ],
        ],
      ]);
      // Файл в хранилище тот же: правка названия его не трогает.
      const [row] = await f.t.admin.db.select().from(files).where(eq(files.id, item.id));
      expect(row).toMatchObject({ replacedAt: null, replacedBy: null });
      expect(await storage.exists(row!.storageKey)).toBe(true);
    });

    it('название: пустое, запрещённые знаки, слишком длинное, другое расширение — 400 под полем', async () => {
      const item = await upload(acc, 'акт.pdf');
      const cases: [string, string][] = [
        ['.pdf', 'file_name_empty'],
        ['   .pdf', 'file_name_empty'],
        ['акт: сверка.pdf', 'file_name_chars'],
        ['акт?.pdf', 'file_name_chars'],
        [`${'я'.repeat(252)}.pdf`, 'file_name_long'],
        ['акт.exe', 'file_name_invalid'],
        ['акт', 'file_name_invalid'],
        ['акт.PDF', 'file_name_invalid'],
        ['акт‮fdp.pdf', 'file_name_invalid'],
      ];
      for (const [name, code] of cases) {
        const res = await edit(acc, item.id, { version: item.version, name, note: '' });
        expect(res.status, name).toBe(400);
        const err = await apiErr(res);
        expect(err.code, name).toBe(code);
        expect(err.details, name).toEqual({ field: 'name' });
      }
      // У файла без расширения точка в названии сменила бы тип — нельзя.
      const bare = await upload(acc, 'README');
      const res = await edit(acc, bare.id, { version: bare.version, name: 'README.exe', note: '' });
      expect((await apiErr(res)).code).toBe('file_name_invalid');
      expect((await list(acc)).items.find((i) => i.id === item.id)?.name).toBe('акт.pdf');
    });

    it('права: без «Просматривать файлы» — 403, чужая организация и область — 404, запись в архиве — 403, устаревшая версия — 409', async () => {
      const item = await upload(acc, 'права.pdf');
      const body = { version: item.version, name: 'права 2.pdf', note: '' };
      expect((await edit(senior, item.id, body)).status).toBe(403);
      expect((await edit(accB, item.id, body)).status).toBe(404);
      const stale = await edit(acc, item.id, { ...body, version: item.version - 1 });
      expect(stale.status).toBe(409);
      expect((await apiErr(stale)).code).toBe('record_changed');
      // Файл записи чужого контрагента (область «Свои») — как несуществующий.
      const foreign = newRecord('chief-a');
      const theirs = await upload(chief, 'чужой контрагент.pdf', undefined, foreign);
      expect(
        (await edit(acc, theirs.id, { version: theirs.version, name: 'x.pdf', note: '' })).status,
      ).toBe(404);
      // Запись, которую менять нельзя (архив): ни названия, ни примечания.
      const closed = newRecord('chief-a');
      const archived = await upload(chief, 'архив.pdf', undefined, closed);
      records.set(closed.id, { responsible: f.people['chief-a']!.employeeId, editable: false });
      const res = await edit(chief, archived.id, {
        version: archived.version,
        name: 'архив 2.pdf',
        note: 'примечание',
      });
      expect(res.status).toBe(403);
      expect((await apiErr(res)).code).toBe('forbidden');
      const shown = (await list(chief, `kind=record&id=${closed.id}`)).items[0]!;
      expect(shown).toMatchObject({ name: 'архив.pdf', canEdit: false, canReplace: false });
    });

    it('оба метода: без входа — 401; «Просматривать файлы» без «Загружать файлы» — 403; замену файла чужого контрагента не начать — 404', async () => {
      const item = await upload(acc, 'вход.pdf');
      const body = { version: item.version, name: 'вход 2.pdf', note: '' };
      const begin = (cookie: string | undefined, id: string) =>
        call('POST', `/api/files/${id}/replacement`, cookie, { name: 'вход.pdf', size: 3 });
      expect((await call('PATCH', `/api/files/${item.id}`, undefined, body)).status).toBe(401);
      expect((await begin(undefined, item.id)).status).toBe(401);
      // Видит файлы, но не загружает: ни названия с примечанием, ни замены.
      await f.t.admin.db.insert(schema.rolePermissions).values({
        orgId: f.a.orgId,
        roleId: f.roleIds.senior,
        permissionId: 'filesView',
      });
      try {
        const viewer = await signIn(f.app, 'senior-a', TEST_PASSWORD);
        expect((await call('GET', '/api/files?kind=manual', viewer)).status).toBe(200);
        for (const res of [await edit(viewer, item.id, body), await begin(viewer, item.id)]) {
          expect(res.status).toBe(403);
          expect((await apiErr(res)).code).toBe('forbidden');
        }
      } finally {
        await f.t.admin.db
          .delete(schema.rolePermissions)
          .where(
            and(
              eq(schema.rolePermissions.roleId, f.roleIds.senior),
              eq(schema.rolePermissions.permissionId, 'filesView'),
            ),
          );
      }
      // Файл записи чужого контрагента (область «Свои») — как несуществующий и для начала замены.
      const foreign = newRecord('chief-a');
      const theirs = await upload(chief, 'чужой контрагент 2.pdf', undefined, foreign);
      expect((await begin(acc, theirs.id)).status).toBe(404);
      expect((await list(acc)).items.find((i) => i.id === item.id)).toMatchObject({
        name: 'вход.pdf',
        version: item.version,
      });
    });

    it('замену, начатую больше часа назад, сохранить нельзя — 404; управляющие знаки в примечании — пробелом', async () => {
      const item = await upload(acc, 'час.pdf');
      const old = await replacement(acc, item.id, 'час.pdf', new Uint8Array(4));
      await f.t.admin.db
        .update(files)
        .set({ createdAt: sql`now() - interval '61 minutes'` })
        .where(eq(files.id, old));
      const late = await edit(acc, item.id, {
        version: item.version,
        name: item.name,
        note: '',
        uploadId: old,
      });
      expect(late.status).toBe(404);
      // Файл остался прежним; свежая замена сохраняется.
      expect((await list(acc)).items.find((i) => i.id === item.id)).toMatchObject({
        size: item.size,
        version: item.version,
      });
      const fresh = await replacement(acc, item.id, 'час.pdf', new Uint8Array(6));
      const saved = await edit(acc, item.id, {
        version: item.version,
        name: item.name,
        note: 'первая\u0000строка\nвторая\tстрока',
        uploadId: fresh,
      });
      expect(saved.status).toBe(200);
      expect(FileItem.parse(await saved.json())).toMatchObject({
        size: 6,
        note: 'первая строка вторая строка',
      });
    });

    it('замена файла: номер прежний, содержимое, размер, тип и расширение — нового; прежний стёрт из хранилища', async () => {
      const source = newRecord('acc-a');
      const item = await upload(acc, 'скан.pdf', undefined, source);
      const oldKey = await keyOf(item.id);
      const uploadId = await replacement(acc, item.id, ' новый скан.JPG ', new Uint8Array(7));
      // Пока замена не сохранена, прежний файл на месте, а загрузки-замены в записи не видно.
      expect((await list(acc, `kind=record&id=${source.id}`)).items).toEqual([item]);
      // Расширение — от нового файла: прежнее не подходит.
      const wrong = await edit(acc, item.id, {
        version: item.version,
        name: 'скан.pdf',
        note: '',
        uploadId,
      });
      expect(wrong.status).toBe(400);
      expect((await apiErr(wrong)).code).toBe('file_name_invalid');
      const res = await edit(acc, item.id, {
        version: item.version,
        name: 'скан.JPG',
        note: 'цветной',
        uploadId,
      });
      expect(res.status).toBe(200);
      const saved = FileItem.parse(await res.json());
      expect(saved).toMatchObject({
        id: item.id,
        name: 'скан.JPG',
        note: 'цветной',
        contentType: 'image/jpeg',
        size: 7,
        uploadedBy: 'acc-a',
        version: item.version + 1,
      });
      expect((await list(acc, `kind=record&id=${source.id}`)).items).toEqual([saved]);
      const [row] = await f.t.admin.db.select().from(files).where(eq(files.id, item.id));
      expect(row).toMatchObject({
        storageKey: `org/${f.a.orgId}/files/${uploadId}`,
        replacedBy: f.people['acc-a']!.userId,
        createdBy: f.people['acc-a']!.userId,
      });
      expect(row!.replacedAt).not.toBeNull();
      expect(await storage.exists(oldKey)).toBe(false);
      expect(await storage.exists(row!.storageKey)).toBe(true);
      // Строка загрузки-замены стёрта: её ключ перешёл к файлу.
      expect(await f.t.admin.db.select().from(files).where(eq(files.id, uploadId))).toEqual([]);
      expect((await call('GET', `/api/files/${item.id}/link`, acc)).status).toBe(200);
      expect((await history(source.id)).map((h) => [h.action, h.changes]).at(-1)).toEqual([
        'file_edit',
        [
          { field: 'file', to: 'скан.JPG' },
          { field: 'name', from: 'скан.pdf', to: 'скан.JPG' },
          { field: 'note', from: null, to: 'цветной' },
          { field: 'size', from: 5, to: 7 },
        ],
      ]);
      // Ту же загрузку второй раз не подставить.
      const again = await edit(acc, item.id, {
        version: saved.version,
        name: 'скан.JPG',
        note: 'цветной',
        uploadId,
      });
      expect(again.status).toBe(404);
    });

    it('заменить чужой файл и свой старше суток — только с правом «Удалять файлы»', async () => {
      const chiefs = await upload(chief, 'приказ.pdf');
      const old = await upload(acc, 'давний.pdf');
      await f.t.admin.db
        .update(files)
        .set({ createdAt: sql`now() - interval '25 hours'` })
        .where(eq(files.id, old.id));
      const items = (await list(acc)).items;
      for (const item of [chiefs, old]) {
        expect(items.find((i) => i.id === item.id)).toMatchObject({
          canEdit: true,
          canReplace: false,
        });
        const res = await call('POST', `/api/files/${item.id}/replacement`, acc, {
          name: 'новый.pdf',
          size: 3,
        });
        expect(res.status).toBe(403);
        expect(await apiErr(res)).toEqual({
          code: 'file_replace_forbidden',
          message: FILE_MESSAGES.file_replace_forbidden,
        });
      }
      // Название и примечание чужого файла менять можно — как прикреплять к этой записи.
      const renamed = await edit(acc, chiefs.id, {
        version: chiefs.version,
        name: 'приказ о приёме.pdf',
        note: '',
      });
      expect(renamed.status).toBe(200);
      // Главный бухгалтер заменяет и чужой давний файл.
      const uploadId = await replacement(chief, old.id, 'давний.pdf', new Uint8Array(2));
      const res = await edit(chief, old.id, {
        version: old.version,
        name: 'давний.pdf',
        note: '',
        uploadId,
      });
      expect(res.status).toBe(200);
      expect(FileItem.parse(await res.json())).toMatchObject({ size: 2, uploadedBy: 'acc-a' });
    });

    it('чужую, обычную и начатую для другого файла загрузку заменой не подставить; замена обычным «закончить» файлом не становится', async () => {
      const a = await upload(acc, 'первый.pdf');
      const b = await upload(acc, 'второй.pdf');
      const forA = await replacement(acc, a.id, 'первый.pdf', new Uint8Array(4));
      const body = (item: FileItem, uploadId: string) => ({
        version: item.version,
        name: item.name,
        note: '',
        uploadId,
      });
      // Загрузка-замена файла «первый» — не для файла «второй».
      expect((await edit(acc, b.id, body(b, forA))).status).toBe(404);
      // Начал один — сохранить замену его загрузкой другой не может.
      expect((await edit(chief, a.id, body(a, forA))).status).toBe(404);
      // Обычная начатая загрузка — не замена.
      const plain = FileUploadTicket.parse(await (await start(acc, 'обычный.pdf', 3)).json());
      expect((await edit(acc, a.id, body(a, plain.id))).status).toBe(404);
      // «Закончить загрузку» не делает замену отдельным файлом записи.
      expect((await call('POST', `/api/files/${forA}/complete`, acc)).status).toBe(404);
      // Замена начата, но файл до хранилища не дошёл.
      const started = await call('POST', `/api/files/${b.id}/replacement`, acc, {
        name: 'второй.pdf',
        size: 9,
      });
      const lost = FileUploadTicket.parse(await started.json());
      const res = await edit(acc, b.id, body(b, lost.id));
      expect(res.status).toBe(409);
      expect((await apiErr(res)).code).toBe('file_not_uploaded');
      // Файлы остались как были, замену «первого» всё ещё можно сохранить.
      expect((await list(acc)).items.find((i) => i.id === b.id)).toMatchObject({ size: 5 });
      expect((await edit(acc, a.id, body(a, forA))).status).toBe(200);
      // Новый файл запрещённого типа и больше 20 МБ не принимается уже в начале замены.
      const exe = await call('POST', `/api/files/${b.id}/replacement`, acc, {
        name: 'второй.exe',
        size: 3,
      });
      expect((await apiErr(exe)).code).toBe('file_type_forbidden');
      const big = await call('POST', `/api/files/${b.id}/replacement`, acc, {
        name: 'второй.pdf',
        size: FILE_MAX_BYTES + 1,
      });
      expect((await apiErr(big)).code).toBe('file_too_large');
      // Чужая организация замену начать не может.
      expect(
        (await call('POST', `/api/files/${b.id}/replacement`, accB, { name: 'x.pdf', size: 1 }))
          .status,
      ).toBe(404);
    });
  });

  it('«Файлы в карточках» выключены — 403 с текстом', async () => {
    const policy = async () =>
      OrgPolicy.parse(await (await call('GET', '/api/org/policy', owner)).json());
    const patch = async (files: boolean) =>
      call('PATCH', '/api/org/policy', owner, {
        version: (await policy()).version,
        features: { files },
      });
    const item = await upload(acc, 'выкл.pdf');
    expect((await patch(false)).status).toBe(200);
    try {
      for (const res of [
        await call('GET', '/api/files?kind=manual', acc),
        await start(acc, 'акт.pdf', 10),
        await call('GET', `/api/files/${item.id}/link`, acc),
        await call('DELETE', `/api/files/${item.id}?version=${item.version}`, acc),
        await call('PATCH', `/api/files/${item.id}`, acc, {
          version: item.version,
          name: 'выкл 2.pdf',
          note: '',
        }),
        await call('POST', `/api/files/${item.id}/replacement`, acc, { name: 'выкл.pdf', size: 3 }),
      ]) {
        expect(res.status).toBe(403);
        expect(await apiErr(res)).toEqual({ code: 'files_off', message: FILE_MESSAGES.files_off });
      }
    } finally {
      expect((await patch(true)).status).toBe(200);
    }
  });

  it('очистка: незаконченные загрузки старше суток удаляются с файлом, свежие остаются', async () => {
    const stale = FileUploadTicket.parse(await (await start(acc, 'брошен.pdf', 5)).json());
    const fresh = FileUploadTicket.parse(await (await start(acc, 'идёт.pdf', 5)).json());
    const staleKey = await keyOf(stale.id);
    await storage.put(staleKey, new Uint8Array(3), { contentType: 'application/pdf' });
    await f.t.admin.db
      .update(files)
      .set({ createdAt: sql`now() - interval '25 hours'` })
      .where(eq(files.id, stale.id));
    await cleanupPendingFiles(f.deps);
    await cleanupPendingFiles(f.deps);
    const left = await f.t.admin.db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.state, 'pending'), eq(files.orgId, f.a.orgId)));
    expect(left.map((r) => r.id)).toContain(fresh.id);
    expect(left.map((r) => r.id)).not.toContain(stale.id);
    expect(await storage.exists(staleKey)).toBe(false);
  });
});
