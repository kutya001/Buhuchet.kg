import type { MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
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
