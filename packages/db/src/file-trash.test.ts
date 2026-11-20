import { randomUUID } from 'node:crypto';
import { hashPassword } from '@buhuchet/adapters/password';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminStorageCheck, adminStorageCheckItem } from './admin-storage';
import { withUserContext } from './auth';
import type { Tx } from './client';
import { withOrgContext, type OrgContext } from './context';
import { createContractor, type ContractorFields } from './contractors';
import {
  adminFileTrash,
  adminFileTrashRow,
  adminStorageExtraDelete,
  fileTrashDone,
  fileTrashDue,
  fileTrashForRestore,
  insertFileTrash,
  restoreFileTrash,
} from './file-trash';
import { getFile, insertPendingFile, markFileDeleted, markFileReady, type NewFile } from './files';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  contractors,
  fileTrash,
  files,
  storageCheckItems,
  storageCheckRuns,
  users,
} from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

/*
 * «Ждут удаления», «Вернуть» и «Удалить» лишнего файла (доработки 20.11.2026, пакет 2, блок 5; этап 1,
 * П6, поток И; миграция 0167): только администратор платформы, чужая организация не видна, срок — по
 * часам базы, ключ живой записи не стирается.
 */

const contractor = (
  name: string,
  inn: string,
  responsibleEmployeeId: string,
): ContractorFields => ({
  name,
  inn,
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
  responsibleEmployeeId,
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
});

describe.skipIf(!databaseAvailable())('«Ждут удаления» и «Вернуть»', () => {
  let t: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId: string;
  let cpId: string;
  let runId: number;
  const ctxA = (): OrgContext => ({ orgId: a.orgId, userId: a.ownerUserId });
  const ctxB = (): OrgContext => ({ orgId: b.orgId, userId: b.ownerUserId });
  const adminInA = (): OrgContext => ({ orgId: a.orgId, userId: adminId });

  /** Загруженный и удалённый файл организации А со строкой «Ждут удаления». */
  async function deletedFile(values: Partial<NewFile> = {}) {
    const id = randomUUID();
    const file: NewFile = {
      id,
      sourceKind: 'manual',
      sourceId: null,
      contractorId: null,
      name: 'Акт сверки.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      storageKey: `org/${a.orgId}/files/${id}`,
      ...values,
    };
    await withOrgContext(t.app.db, ctxA(), async (tx) => {
      await insertPendingFile(tx, file);
      await markFileReady(tx, file.id);
      const ready = await getFile(tx, file.id);
      await markFileDeleted(tx, file.id, ready!.version);
      await insertFileTrash(tx, [
        {
          why: 'del',
          fileId: file.id,
          storageKey: file.storageKey,
          contractorId: file.contractorId,
          name: file.name,
          sizeBytes: file.sizeBytes,
          source: 'manual',
        },
      ]);
    });
    const [row] = await t.admin.db.select().from(fileTrash).where(eq(fileTrash.fileId, file.id));
    return { file, trashId: row!.id };
  }

  /** Сдвинуть срок строки в прошлое (как будто сутки прошли) — владельцем таблиц. */
  async function overdue(trashId: string) {
    await t.admin.db
      .update(fileTrash)
      .set({ deletedAt: sql`now() - interval '25 hours'`, eraseAt: sql`now() - interval '1 hour'` })
      .where(eq(fileTrash.id, trashId));
  }

  /** Строка «лишний файл» сверки: объект появился `hoursAgo` часов назад. */
  async function extraItem(key: string, hoursAgo: number): Promise<number> {
    const [row] = await t.admin.db
      .insert(storageCheckItems)
      .values({
        kind: 'extra',
        key,
        keyOrgId: key.startsWith(`org/${a.orgId}/`) ? a.orgId : null,
        sizeBytes: 77,
        objectAt: sql`now() - make_interval(hours => ${hoursAgo})`,
        firstRunId: runId,
        lastRunId: runId,
      })
      .returning({ id: storageCheckItems.id });
    return row!.id;
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    await seedAccessReference(t.admin.db);
    await seedAllPlatformDictionaries(t.admin.db);
    const passwordHash = await hashPassword('Bh-4821-temp');
    const [admin] = await t.admin.db
      .insert(users)
      .values({ login: 'platform', passwordHash, isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    a = await createOrganization(t.app.db, {
      name: 'ОсОО «Альфа»',
      inn: '01811201810456',
      slug: 'alfa',
      owner: { fullName: 'Асанов Асан', login: 'asanov', passwordHash },
    });
    b = await createOrganization(t.app.db, {
      name: 'ОсОО «Бета»',
      inn: '02811201810457',
      slug: 'beta',
      owner: { fullName: 'Бекова Бермет', login: 'bekova', passwordHash },
    });
    cpId = await withOrgContext(t.app.db, ctxA(), (tx) =>
      createContractor(
        tx,
        a.orgId,
        contractor('ОсОО «Первый»', '03744097401851', a.ownerEmployeeId),
        null,
      ),
    );
    const [run] = await t.admin.db
      .insert(storageCheckRuns)
      .values({ state: 'done', finishedAt: sql`now()` })
      .returning({ id: storageCheckRuns.id });
    runId = run!.id;
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('удалённый файл ждёт сутки: строка с ключом и сроком, своя организация видит её, чужая — нет', async () => {
    const { file, trashId } = await deletedFile();
    const [row] = await t.admin.db.select().from(fileTrash).where(eq(fileTrash.id, trashId));
    expect(row).toMatchObject({
      orgId: a.orgId,
      why: 'del',
      storageKey: file.storageKey,
      deletedBy: a.ownerUserId,
      contractorBound: false,
    });
    expect(row!.eraseAt.getTime() - row!.deletedAt.getTime()).toBe(24 * 3600 * 1000);
    const own = await withOrgContext(t.app.db, ctxA(), (tx) =>
      tx.select({ id: fileTrash.id }).from(fileTrash).where(eq(fileTrash.id, trashId)),
    );
    expect(own).toHaveLength(1);
    const foreign = await withOrgContext(t.app.db, ctxB(), (tx) =>
      tx.select({ id: fileTrash.id }).from(fileTrash),
    );
    expect(foreign).toEqual([]);
    // Сотрудник «Вернуть» не может ни функцией, ни правкой строки.
    expect(await withOrgContext(t.app.db, ctxA(), (tx) => restoreFileTrash(tx, trashId, []))).toBe(
      'denied',
    );
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) =>
        tx
          .update(fileTrash)
          .set({ restoredAt: sql`now()`, restoredBy: a.ownerUserId })
          .where(eq(fileTrash.id, trashId))
          .returning({ id: fileTrash.id }),
      ),
    ).resolves.toEqual([]);
  });

  it('стереть «сразу» нельзя: срок раньше суток не принимает база', async () => {
    const { trashId } = await deletedFile();
    await expect(
      t.admin.db
        .update(fileTrash)
        .set({ eraseAt: sql`deleted_at + interval '1 hour'` })
        .where(eq(fileTrash.id, trashId)),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining('file_trash_erase_check'),
      }),
    });
  });

  it('лишний файл ставит в «Ждут удаления» только администратор', async () => {
    const key = `org/${a.orgId}/files/${randomUUID()}`;
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) =>
        tx.insert(fileTrash).values({
          why: 'extra',
          storageKey: key,
          name: 'x',
          sizeBytes: 1,
        }),
      ),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }),
    });
  });

  it('задача берёт только то, чей срок наступил; ключ живой записи закрывает без стирания', async () => {
    const early = await deletedFile();
    const due = await deletedFile();
    const back = await deletedFile();
    await overdue(due.trashId);
    await overdue(back.trashId);
    // Ключ снова нужен живому файлу — так бывает, если файл вернули мимо «Вернуть».
    await t.admin.db
      .update(files)
      .set({ state: 'ready', deletedAt: null, deletedBy: null })
      .where(eq(files.id, back.file.id));
    // Вошедший пользователь (не задача) не получает ничего.
    expect(await withOrgContext(t.app.db, ctxA(), (tx) => fileTrashDue(tx))).toEqual([]);
    const rows = await fileTrashDue(t.app.db);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(due.trashId);
    expect(ids).not.toContain(early.trashId);
    expect(ids).not.toContain(back.trashId);
    expect(rows.find((r) => r.id === due.trashId)?.storageKey).toBe(due.file.storageKey);
    const [closed] = await t.admin.db
      .select()
      .from(fileTrash)
      .where(eq(fileTrash.id, back.trashId));
    expect(closed).toMatchObject({ lastError: 'in_use' });
    expect(closed!.erasedAt).not.toBeNull();

    // Не стёрлось — ещё попытка с кодом «storage»; стёрлось — отметка, больше не отдаётся.
    expect(await fileTrashDone(t.app.db, { done: [], failed: [due.trashId], stuck: 1 })).toEqual({
      left: 1,
      stuck: 1,
    });
    const [failed] = await t.admin.db.select().from(fileTrash).where(eq(fileTrash.id, due.trashId));
    expect(failed).toMatchObject({ attempts: 1, lastError: 'storage', erasedAt: null });
    // Ранняя строка не меняется, даже если её номер передали.
    await fileTrashDone(t.app.db, { done: [early.trashId, due.trashId], failed: [], stuck: 24 });
    const [erased] = await t.admin.db.select().from(fileTrash).where(eq(fileTrash.id, due.trashId));
    expect(erased!.erasedAt).not.toBeNull();
    expect(erased!.lastError).toBeNull();
    const [still] = await t.admin.db
      .select()
      .from(fileTrash)
      .where(eq(fileTrash.id, early.trashId));
    expect(still!.erasedAt).toBeNull();
    expect((await fileTrashDue(t.app.db)).map((r) => r.id)).not.toContain(due.trashId);
    // Вошедший пользователь отметить ничего не может.
    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) =>
        fileTrashDone(tx, { done: [early.trashId], failed: [], stuck: 1 }),
      ),
    ).toEqual({ left: 0, stuck: 0 });
  });

  it('«Ждут удаления» видит только администратор платформы', async () => {
    const { trashId } = await deletedFile({ name: 'Видно администратору.pdf' });
    const seen = await withUserContext(t.app.db, adminId, (tx) => adminFileTrash(tx));
    const row = seen.rows.find((r) => r.id === trashId);
    expect(row).toMatchObject({
      orgId: a.orgId,
      orgName: 'ОсОО «Альфа»',
      why: 'del',
      name: 'Видно администратору.pdf',
      deletedByName: expect.any(String),
    });
    expect(row).not.toHaveProperty('storageKey');
    const onlyB = await withUserContext(t.app.db, adminId, (tx) =>
      adminFileTrash(tx, { orgId: b.orgId }),
    );
    expect(onlyB.rows).toEqual([]);
    expect(await withOrgContext(t.app.db, ctxA(), (tx) => adminFileTrash(tx))).toEqual({
      rows: [],
      total: 0,
    });
    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) => adminFileTrashRow(tx, trashId)),
    ).toBeNull();
    expect(await withUserContext(t.app.db, a.ownerUserId, (tx) => adminStorageCheck(tx))).toEqual({
      checkedAt: null,
      lists: {
        missing: { rows: [], total: 0 },
        extra: { rows: [], total: 0 },
        stuck: { rows: [], total: 0 },
        failed: { rows: [], total: 0 },
      },
    });
  });

  it('«Вернуть» удалённый файл: файл снова загружен, срок и повтор — «уже возвращён»', async () => {
    const { file, trashId } = await deletedFile();
    // Без организации файла — не найдено (функция вернёт файл только в её контексте).
    expect(
      await withUserContext(t.app.db, adminId, (tx) => restoreFileTrash(tx, trashId, [])),
    ).toBe('missing');
    // В контексте чужой организации строки не видно.
    expect(
      await withOrgContext(t.app.db, { orgId: b.orgId, userId: adminId }, (tx) =>
        restoreFileTrash(tx, trashId, []),
      ),
    ).toBe('missing');
    const trash = await withOrgContext(t.app.db, adminInA(), (tx) =>
      fileTrashForRestore(tx, trashId),
    );
    expect(trash).toMatchObject({
      why: 'del',
      fileId: file.id,
      live: true,
      contractorBound: false,
    });
    expect(
      await withOrgContext(t.app.db, adminInA(), (tx) => restoreFileTrash(tx, trashId, [])),
    ).toBe('ok');
    const back = await withOrgContext(t.app.db, ctxA(), (tx) => getFile(tx, file.id));
    expect(back).toMatchObject({ state: 'ready' });
    const [row] = await t.admin.db.select().from(fileTrash).where(eq(fileTrash.id, trashId));
    expect(row).toMatchObject({ restoredBy: adminId });
    expect(
      await withOrgContext(t.app.db, adminInA(), (tx) => restoreFileTrash(tx, trashId, [])),
    ).toBe('gone');
    // Возвращённый файл задача не стирает.
    await t.admin.db
      .update(fileTrash)
      .set({ deletedAt: sql`now() - interval '25 hours'`, eraseAt: sql`now() - interval '1 hour'` })
      .where(eq(fileTrash.id, trashId));
    expect((await fileTrashDue(t.app.db)).map((r) => r.id)).not.toContain(trashId);
  });

  it('«Вернуть» нельзя: срок прошёл, прежняя версия после замены, файл удалённого контрагента', async () => {
    const late = await deletedFile();
    await overdue(late.trashId);
    expect(
      await withOrgContext(t.app.db, adminInA(), (tx) => restoreFileTrash(tx, late.trashId, [])),
    ).toBe('gone');

    const repKey = `org/${a.orgId}/files/${randomUUID()}`;
    await withOrgContext(t.app.db, ctxA(), (tx) =>
      insertFileTrash(tx, [
        {
          why: 'rep',
          storageKey: repKey,
          contractorId: null,
          name: 'Прежний.pdf',
          sizeBytes: 3,
          source: 'manual',
        },
      ]),
    );
    const [rep] = await t.admin.db.select().from(fileTrash).where(eq(fileTrash.storageKey, repKey));
    expect(
      await withOrgContext(t.app.db, adminInA(), (tx) => restoreFileTrash(tx, rep!.id, [])),
    ).toBe('kind');
    // Прежнюю версию с ключом живого файла поставить нельзя.
    const live = await deletedFile();
    await t.admin.db
      .update(files)
      .set({ state: 'ready', deletedAt: null, deletedBy: null })
      .where(eq(files.id, live.file.id));
    await t.admin.db.delete(fileTrash).where(eq(fileTrash.id, live.trashId));
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) =>
        insertFileTrash(tx, [
          {
            why: 'rep',
            storageKey: live.file.storageKey,
            contractorId: null,
            name: 'x.pdf',
            sizeBytes: 1,
            source: 'manual',
          },
        ]),
      ),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }),
    });

    const own = await deletedFile({ contractorId: cpId, name: 'Файл контрагента.pdf' });
    const [bound] = await t.admin.db.select().from(fileTrash).where(eq(fileTrash.id, own.trashId));
    expect(bound).toMatchObject({ contractorId: cpId, contractorBound: true });
    await t.admin.db.delete(contractors).where(eq(contractors.id, cpId));
    const after = await withOrgContext(t.app.db, adminInA(), (tx) =>
      fileTrashForRestore(tx, own.trashId),
    );
    expect(after).toMatchObject({ contractorId: null, contractorBound: true });
    expect(
      await withOrgContext(t.app.db, adminInA(), (tx) => restoreFileTrash(tx, own.trashId, [])),
    ).toBe('record');
    const still = await withOrgContext(t.app.db, ctxA(), (tx) => getFile(tx, own.file.id));
    expect(still?.state).toBe('deleted');
  });

  it('«Удалить» лишний файл: старше суток, не нужен базе, файл организации или заявки', async () => {
    const asAdmin = <T>(fn: (tx: Tx) => Promise<T>) => withUserContext(t.app.db, adminId, fn);
    const okKey = `org/${a.orgId}/files/${randomUUID()}`;
    const ok = await extraItem(okKey, 30);
    const young = await extraItem(`org/${a.orgId}/files/${randomUUID()}`, 2);
    const platform = await extraItem(`video/${randomUUID()}`, 30);
    const used = await deletedFile();
    await t.admin.db
      .update(files)
      .set({ state: 'ready', deletedAt: null, deletedBy: null })
      .where(eq(files.id, used.file.id));
    await t.admin.db.delete(fileTrash).where(eq(fileTrash.id, used.trashId));
    const inUse = await extraItem(used.file.storageKey, 30);

    // Сотрудник и администратор в контексте организации — нет права.
    expect(await withOrgContext(t.app.db, ctxA(), (tx) => adminStorageExtraDelete(tx, ok))).toEqual(
      {
        outcome: 'denied',
        trashId: null,
      },
    );
    expect(
      await withOrgContext(t.app.db, adminInA(), (tx) => adminStorageExtraDelete(tx, ok)),
    ).toEqual({ outcome: 'denied', trashId: null });

    const item = await asAdmin((tx) => adminStorageCheckItem(tx, ok));
    expect(item).toMatchObject({ kind: 'extra', path: okKey, orgId: a.orgId });
    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) => adminStorageCheckItem(tx, ok)),
    ).toBeNull();

    expect((await asAdmin((tx) => adminStorageExtraDelete(tx, young))).outcome).toBe('young');
    expect((await asAdmin((tx) => adminStorageExtraDelete(tx, platform))).outcome).toBe('platform');
    expect((await asAdmin((tx) => adminStorageExtraDelete(tx, inUse))).outcome).toBe('in_use');
    const [resolved] = await t.admin.db
      .select()
      .from(storageCheckItems)
      .where(eq(storageCheckItems.id, inUse));
    expect(resolved!.resolvedAt).not.toBeNull();

    const done = await asAdmin((tx) => adminStorageExtraDelete(tx, ok));
    expect(done.outcome).toBe('ok');
    const [trash] = await t.admin.db
      .select()
      .from(fileTrash)
      .where(eq(fileTrash.id, done.trashId!));
    expect(trash).toMatchObject({
      why: 'extra',
      orgId: a.orgId,
      storageKey: okKey,
      deletedBy: adminId,
      source: 'extra',
    });
    expect((await asAdmin((tx) => adminStorageExtraDelete(tx, ok))).outcome).toBe('missing');
    // Сверка нашла тот же файл снова, пока он ждёт стирания: расхождением он не показывается.
    const again = await extraItem(okKey, 30);
    const check = await asAdmin((tx) => adminStorageCheck(tx));
    expect(check.lists.extra.rows.map((r) => r.id)).not.toContain(again);
    expect((await asAdmin((tx) => adminStorageExtraDelete(tx, again))).outcome).toBe('waiting');
    await t.admin.db
      .update(storageCheckItems)
      .set({ resolvedAt: sql`now()` })
      .where(eq(storageCheckItems.id, again));

    // «Вернуть» лишний файл — вне организации: строка снова в списке лишних.
    expect(
      await withOrgContext(t.app.db, adminInA(), (tx) => restoreFileTrash(tx, done.trashId!, [])),
    ).toBe('missing');
    expect(await asAdmin((tx) => restoreFileTrash(tx, done.trashId!, []))).toBe('ok');
    const reopened = await t.admin.db
      .select()
      .from(storageCheckItems)
      .where(sql`${storageCheckItems.key} = ${okKey} and ${storageCheckItems.resolvedAt} is null`);
    expect(reopened).toHaveLength(1);
  });
});
