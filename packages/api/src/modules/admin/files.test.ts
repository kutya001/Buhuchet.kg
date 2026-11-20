import { randomUUID } from 'node:crypto';
import type { MemoryStorage } from '@buhuchet/adapters';
import { schema } from '@buhuchet/db';
import { databaseAvailable } from '@buhuchet/db/testing';
import {
  AdminExtraDelete,
  AdminOrgFiles,
  AdminStorageCheck,
  AdminStorageFileList,
  AdminStorageSummary,
  AdminTrashList,
  ApiError,
  FileItem,
  FileLink,
  FileList,
  FileUploadTicket,
} from '@buhuchet/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiRequest, createStaffFixture, signIn, TEST_PASSWORD } from '../../testing';

/*
 * Админка → «Файлы» и «Файлы» карточки организации (доработки 20.11.2026, пакет 2, блоки 3–5; этап 1,
 * П4–П6, поток И): только администратор платформы; «Вернуть» и «Удалить» лишнего — с проверками базы.
 */

const { auditLog, fileTrash, files, platformAuditLog, storageCheckItems, storageCheckRuns } =
  schema;

type Fixture = Awaited<ReturnType<typeof createStaffFixture>>;

const apiErr = async (res: Response) => ApiError.parse(await res.json()).error;

describe.skipIf(!databaseAvailable())('Админка → «Файлы»: API', () => {
  let f: Fixture;
  let storage: MemoryStorage;
  let admin: string;
  let owner: string;
  let ownerB: string;
  let runId: number;

  const call = (method: 'GET' | 'POST' | 'DELETE', path: string, cookie?: string, body?: unknown) =>
    apiRequest(f.app, method, path, cookie, body);
  const ok = async (res: Response, status = 200) => {
    expect(res.status, await res.clone().text()).toBe(status);
    return res.json();
  };

  /** Загрузить файл «Загружен вручную» в организации входа. */
  async function upload(cookie: string, name: string): Promise<FileItem> {
    const body = new Uint8Array([1, 2, 3, 4, 5]);
    const started = await call('POST', '/api/files/uploads', cookie, {
      source: { kind: 'manual', id: null },
      name,
      size: body.length,
    });
    const ticket = FileUploadTicket.parse(await ok(started, 201));
    const url = new URL(ticket.upload.url);
    await storage.put(url.host + url.pathname, body, {
      contentType: ticket.upload.headers['content-type']!,
    });
    return FileItem.parse(await ok(await call('POST', `/api/files/${ticket.id}/complete`, cookie)));
  }

  /** Загрузить и удалить: строка «Ждут удаления». */
  async function trashed(name: string) {
    const item = await upload(owner, name);
    await ok(await call('DELETE', `/api/files/${item.id}?version=${item.version}`, owner));
    const [row] = await f.t.admin.db.select().from(fileTrash).where(eq(fileTrash.fileId, item.id));
    return { item, trashId: row!.id, key: row!.storageKey };
  }

  /** Лишний файл сверки: объект появился `hoursAgo` часов назад. */
  async function extraItem(key: string, hoursAgo: number) {
    const [row] = await f.t.admin.db
      .insert(storageCheckItems)
      .values({
        kind: 'extra',
        key,
        keyOrgId: f.a.orgId,
        sizeBytes: 9,
        objectAt: sql`now() - make_interval(hours => ${hoursAgo})`,
        firstRunId: runId,
        lastRunId: runId,
      })
      .returning({ id: storageCheckItems.id });
    return row!.id;
  }

  beforeAll(async () => {
    f = await createStaffFixture();
    storage = f.deps.storage as MemoryStorage;
    admin = await signIn(f.app, 'platform-admin', TEST_PASSWORD);
    owner = await signIn(f.app, 'owner-a', TEST_PASSWORD);
    ownerB = await signIn(f.app, 'owner-b', TEST_PASSWORD);
    const [run] = await f.t.admin.db
      .insert(storageCheckRuns)
      .values({ state: 'done', finishedAt: sql`now()` })
      .returning({ id: storageCheckRuns.id });
    runId = run!.id;
  });

  afterAll(async () => {
    await f?.t.drop();
  });

  it('без входа — 401, сотруднику организации — 403 у каждого метода', async () => {
    const id = randomUUID();
    const routes: ['GET' | 'POST', string][] = [
      ['GET', '/api/admin/files/summary'],
      ['GET', '/api/admin/files'],
      ['GET', '/api/admin/files/values?col=name'],
      ['GET', '/api/admin/files/export'],
      ['GET', `/api/admin/files/file/${id}/link`],
      ['GET', '/api/admin/files/trash'],
      ['POST', `/api/admin/files/trash/${id}/restore`],
      ['GET', '/api/admin/files/check'],
      ['POST', '/api/admin/files/check/1/delete'],
      ['GET', `/api/admin/organizations/${f.a.orgId}/files`],
    ];
    for (const [method, path] of routes) {
      expect((await call(method, path)).status, path).toBe(401);
      const res = await call(method, path, owner);
      expect(res.status, path).toBe(403);
    }
  });

  it('удалённый файл — в «Все файлы» и «Ждут удаления»; «Вернуть» возвращает его с историей', async () => {
    const { item, trashId } = await trashed('Договор аренды.pdf');
    // У организации файла больше нет.
    const before = FileList.parse(await ok(await call('GET', '/api/files?kind=manual', owner)));
    expect(before.items.map((i) => i.id)).not.toContain(item.id);

    const all = AdminStorageFileList.parse(
      await ok(await call('GET', `/api/admin/files?org=${f.a.orgId}&size=all`, admin)),
    );
    const row = all.items.find((r) => r.id === trashId);
    expect(row).toMatchObject({
      kind: 'trash',
      orgId: f.a.orgId,
      name: 'Договор аренды.pdf',
      state: 'trash',
      why: 'del',
      mem: false,
      restorable: true,
    });
    expect(JSON.stringify(all)).not.toContain('org/');
    const onlyB = AdminStorageFileList.parse(
      await ok(await call('GET', `/api/admin/files?org=${f.b.orgId}&size=all`, admin)),
    );
    expect(onlyB.items.map((r) => r.id)).not.toContain(trashId);

    const trash = AdminTrashList.parse(
      await ok(await call('GET', `/api/admin/files/trash?org=${f.a.orgId}`, admin)),
    );
    expect(trash.items.find((r) => r.id === trashId)).toMatchObject({
      why: 'del',
      name: 'Договор аренды.pdf',
      restorable: true,
      attempts: 0,
      byText: 'owner-a В.',
    });

    expect(
      await ok(await call('POST', `/api/admin/files/trash/${trashId}/restore`, admin)),
    ).toEqual({ id: trashId, restored: true });
    const after = FileList.parse(await ok(await call('GET', '/api/files?kind=manual', owner)));
    expect(after.items.map((i) => i.id)).toContain(item.id);
    const history = await f.t.admin.db
      .select({ action: auditLog.action, orgId: auditLog.orgId })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'file_restore')));
    expect(history).toEqual([{ action: 'file_restore', orgId: f.a.orgId }]);
    const platform = await f.t.admin.db
      .select({ entity: platformAuditLog.entity, action: platformAuditLog.action })
      .from(platformAuditLog)
      .where(eq(platformAuditLog.entityId, trashId));
    expect(platform).toEqual([{ entity: 'storage_file', action: 'file_restore' }]);

    // Второй раз — уже возвращён.
    const again = await call('POST', `/api/admin/files/trash/${trashId}/restore`, admin);
    expect(again.status).toBe(409);
    expect((await apiErr(again)).code).toBe('file_back_gone');
    expect(
      (await call('POST', `/api/admin/files/trash/${randomUUID()}/restore`, admin)).status,
    ).toBe(409);
  });

  it('«Вернуть» прежнюю версию после замены нельзя', async () => {
    const key = `org/${f.a.orgId}/files/${randomUUID()}`;
    const [row] = await f.t.admin.db
      .insert(fileTrash)
      .values({
        orgId: f.a.orgId,
        why: 'rep',
        storageKey: key,
        name: 'Прежняя версия.pdf',
        sizeBytes: 3,
        source: 'manual',
      })
      .returning({ id: fileTrash.id });
    const res = await call('POST', `/api/admin/files/trash/${row!.id}/restore`, admin);
    expect(res.status).toBe(409);
    expect((await apiErr(res)).code).toBe('file_back_rep');
  });

  it('ссылка на файл: только со своего сайта, в окне — только картинка и PDF', async () => {
    const pdf = await upload(owner, 'Счёт.pdf');
    const doc = await upload(owner, 'Письмо.docx');
    const link = FileLink.parse(
      await ok(await call('GET', `/api/admin/files/file/${pdf.id}/link`, admin)),
    );
    expect(decodeURIComponent(link.url)).toContain('Счёт.pdf');
    const cross = await f.app.request(`/api/admin/files/file/${pdf.id}/link`, {
      headers: { cookie: admin, 'sec-fetch-site': 'cross-site' },
    });
    expect(cross.status).toBe(403);
    const noPreview = await call('GET', `/api/admin/files/file/${doc.id}/link`, admin);
    expect(noPreview.status).toBe(400);
    expect((await apiErr(noPreview)).code).toBe('file_no_preview');
    await ok(await call('GET', `/api/admin/files/file/${doc.id}/link?download=1`, admin));
    expect((await call('GET', `/api/admin/files/file/${randomUUID()}/link`, admin)).status).toBe(
      404,
    );
  });

  it('«Удалить» лишний файл: старше суток — в «Ждут удаления», моложе и пропавший — отказ', async () => {
    const key = `org/${f.a.orgId}/files/${randomUUID()}`;
    const old = await extraItem(key, 30);
    const young = await extraItem(`org/${f.a.orgId}/files/${randomUUID()}`, 3);

    const check = AdminStorageCheck.parse(
      await ok(await call('GET', '/api/admin/files/check', admin)),
    );
    expect(check.extra.items.find((r) => r.id === old)).toMatchObject({
      path: key,
      deletable: true,
      orgId: f.a.orgId,
    });
    expect(check.extra.items.find((r) => r.id === young)).toMatchObject({ deletable: false });

    const refused = await call('POST', `/api/admin/files/check/${young}/delete`, admin);
    expect(refused.status).toBe(409);
    expect((await apiErr(refused)).code).toBe('storage_extra_young');

    const done = AdminExtraDelete.parse(
      await ok(await call('POST', `/api/admin/files/check/${old}/delete`, admin)),
    );
    const [trash] = await f.t.admin.db
      .select()
      .from(fileTrash)
      .where(eq(fileTrash.id, done.trashId));
    expect(trash).toMatchObject({ why: 'extra', storageKey: key });
    expect(new Date(done.eraseAt).getTime() - trash!.deletedAt.getTime()).toBe(24 * 3600 * 1000);
    const history = await f.t.admin.db
      .select({ action: platformAuditLog.action })
      .from(platformAuditLog)
      .where(eq(platformAuditLog.action, 'storage_delete'));
    expect(history).toHaveLength(1);

    const missing = await call('POST', `/api/admin/files/check/${old}/delete`, admin);
    expect(missing.status).toBe(404);
    expect((await apiErr(missing)).code).toBe('storage_extra_missing');

    // «Вернуть» лишний — снова в списке расхождений.
    await ok(await call('POST', `/api/admin/files/trash/${done.trashId}/restore`, admin));
    const back = AdminStorageCheck.parse(
      await ok(await call('GET', '/api/admin/files/check', admin)),
    );
    expect(back.extra.items.map((r) => r.path)).toContain(key);
  });

  it('«Хранилище» и «Файлы» карточки организации: объём и память', async () => {
    await upload(ownerB, 'Устав.pdf');
    const summary = AdminStorageSummary.parse(
      await ok(await call('GET', '/api/admin/files/summary', admin)),
    );
    expect(summary.months).toHaveLength(12);
    expect(summary.total.n).toBeGreaterThanOrEqual(summary.org.n);
    expect(summary.orgs.find((o) => o.orgId === f.b.orgId)).toMatchObject({ n: 1, bytes: 5 });

    const card = AdminOrgFiles.parse(
      await ok(await call('GET', `/api/admin/organizations/${f.b.orgId}/files`, admin)),
    );
    expect(card.usedBytes).toBe(5);
    expect(card.categories).toEqual([{ src: 'manual', n: 1, bytes: 5 }]);
    expect(
      (await call('GET', `/api/admin/organizations/${randomUUID()}/files`, admin)).status,
    ).toBe(404);
    // Ключей хранилища в ответах нет.
    expect(JSON.stringify(summary) + JSON.stringify(card)).not.toContain('org/');
  });

  it('удалённый файл не входит в память организации, а в «Объёме по категориям» — строкой «Ждут удаления»', async () => {
    const { item } = await trashed('Старый акт.pdf');
    const [row] = await f.t.admin.db.select().from(files).where(eq(files.id, item.id));
    expect(row!.state).toBe('deleted');
    const card = AdminOrgFiles.parse(
      await ok(await call('GET', `/api/admin/organizations/${f.a.orgId}/files`, admin)),
    );
    const [ready] = await f.t.admin.db
      .select({ n: sql<number>`count(*)::int`, b: sql<number>`sum(size_bytes)::int` })
      .from(files)
      .where(and(eq(files.orgId, f.a.orgId), eq(files.state, 'ready')));
    const [live] = await f.t.admin.db
      .select({ n: sql<number>`count(*)::int` })
      .from(fileTrash)
      .where(
        and(
          eq(fileTrash.orgId, f.a.orgId),
          sql`${fileTrash.erasedAt} is null and ${fileTrash.restoredAt} is null`,
        ),
      );
    expect(card.usedBytes).toBe(ready!.b);
    expect(card.categories.find((c) => c.src === 'manual')?.n).toBe(ready!.n);
    expect(card.categories.find((c) => c.src === 'trash')?.n).toBe(live!.n);
  });
});
