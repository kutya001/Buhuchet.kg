import { randomUUID } from 'node:crypto';
import { hashPassword } from '@buhuchet/adapters/password';
import { RecordChangedError, RecordNotFoundError } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from './context';
import {
  dropPendingFile,
  dropPendingFiles,
  getFile,
  insertPendingFile,
  listSourceFiles,
  markFileDeleted,
  markFileReady,
  stalePendingFiles,
  type NewFile,
} from './files';
import { createOrganization, type CreatedOrganization } from './organizations';
import { employees, files, statusHistory, users } from './schema';
import { seedPermissions, seedRoleTemplates } from './seed';
import { readSpecJson } from './spec-data';
import { readStatusHistory, writeStatusChange } from './status';
import { createTestDatabase, databaseAvailable, type TestDatabase } from './testing';

const rlsViolation = expect.objectContaining({
  cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }),
});
const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ message: expect.stringMatching(/permission denied/) }),
});
const violation = (name: string) =>
  expect.objectContaining({
    cause: expect.objectContaining({ message: expect.stringContaining(name) }),
  });

describe.skipIf(!databaseAvailable())('файлы организации: таблица files', () => {
  let t: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let chiefUserId: string;
  const ctxA = (): OrgContext => ({ orgId: a.orgId, userId: a.ownerUserId });
  const ctxChief = (): OrgContext => ({ orgId: a.orgId, userId: chiefUserId });
  const ctxB = (): OrgContext => ({ orgId: b.orgId, userId: b.ownerUserId });

  const newFile = (org: CreatedOrganization, values: Partial<NewFile> = {}): NewFile => {
    const id = values.id ?? randomUUID();
    return {
      id,
      sourceKind: 'manual',
      sourceId: null,
      contractorId: null,
      name: 'Акт сверки.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      storageKey: `org/${org.orgId}/files/${id}`,
      ...values,
    };
  };

  /** Загруженный файл организации А от имени `ctx`. */
  async function readyFile(ctx = ctxA(), values: Partial<NewFile> = {}) {
    const file = newFile(a, values);
    await withOrgContext(t.app.db, ctx, async (tx) => {
      await insertPendingFile(tx, file);
      await markFileReady(tx, file.id);
    });
    return file;
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    await seedPermissions(t.admin.db, refDB.permissions, { update: false });
    await seedRoleTemplates(t.admin.db, refDB.roleTemplates, { update: false });
    const passwordHash = await hashPassword('Bh-4821-temp');
    a = await createOrganization(t.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'org-a',
      owner: { fullName: 'Токтомаматов Бекзат', login: 'owner-a', passwordHash },
    });
    const [chief] = await t.admin.db
      .insert(users)
      .values({ orgId: a.orgId, login: 'chief-a', passwordHash })
      .returning({ id: users.id });
    chiefUserId = chief!.id;
    await t.admin.db.insert(employees).values({
      orgId: a.orgId,
      userId: chiefUserId,
      fullName: 'Тилекова Алина',
      shortName: 'Тилекова А.',
      roleId: a.roles.find((r) => r.templateCode === 'chief')!.id,
    });
    b = await createOrganization(t.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'org-b',
      owner: { fullName: 'Абдыкадырова Айгуль', login: 'owner-b', passwordHash },
    });
  });

  afterAll(async () => {
    await t?.drop();
  });

  it('загрузка: запись «pending» не видна в записи, после проверки — видна с автором', async () => {
    const source = randomUUID();
    const file = newFile(a, { sourceKind: 'report', sourceId: source });
    const list = () =>
      withOrgContext(t.app.db, ctxChief(), (tx) => listSourceFiles(tx, 'report', source));
    await withOrgContext(t.app.db, ctxChief(), (tx) => insertPendingFile(tx, file));
    expect(await list()).toEqual([]);
    await withOrgContext(t.app.db, ctxChief(), (tx) => markFileReady(tx, file.id));
    const [item] = await list();
    expect(item).toMatchObject({
      id: file.id,
      name: 'Акт сверки.pdf',
      sizeBytes: 1024,
      state: 'ready',
      createdBy: chiefUserId,
      uploadedBy: 'Тилекова А.',
      version: 2,
    });
    // Второй раз «закончить» нельзя.
    await expect(
      withOrgContext(t.app.db, ctxChief(), (tx) => markFileReady(tx, file.id)),
    ).rejects.toThrow(RecordNotFoundError);
  });

  it('чужая организация не видна: файл Б не прочитать, не изменить и не создать от имени Б', async () => {
    const fileB = newFile(b);
    await withOrgContext(t.app.db, ctxB(), async (tx) => {
      await insertPendingFile(tx, fileB);
      await markFileReady(tx, fileB.id);
    });
    expect(await withOrgContext(t.app.db, ctxA(), (tx) => getFile(tx, fileB.id))).toBeNull();
    const seen = await withOrgContext(t.app.db, ctxA(), (tx) => tx.select().from(files));
    expect(seen.every((r) => r.orgId === a.orgId)).toBe(true);
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) => markFileDeleted(tx, fileB.id, 2)),
    ).rejects.toThrow(RecordNotFoundError);
    const changed = await withOrgContext(t.app.db, ctxA(), (tx) =>
      tx
        .update(files)
        .set({ note: 'чужое' })
        .where(eq(files.id, fileB.id))
        .returning({ id: files.id }),
    );
    expect(changed).toEqual([]);
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) =>
        tx.insert(files).values({ ...newFile(b), orgId: b.orgId }),
      ),
    ).rejects.toThrow(rlsViolation);
    // Без контекста организации не видно ничего.
    expect(await t.app.db.select().from(files)).toEqual([]);
  });

  it('создать можно только свою незаконченную загрузку', async () => {
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) =>
        tx.insert(files).values({ ...newFile(a), createdBy: chiefUserId }),
      ),
    ).rejects.toThrow(rlsViolation);
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) =>
        tx.insert(files).values({ ...newFile(a), state: 'ready' }),
      ),
    ).rejects.toThrow(rlsViolation);
    // Задача по расписанию (без пользователя) файлов не создаёт.
    await expect(
      withOrgContext(t.app.db, { orgId: a.orgId, kind: 'job' }, (tx) =>
        insertPendingFile(tx, newFile(a)),
      ),
    ).rejects.toThrow();
  });

  it('имя, размер, место в хранилище и источник после создания не меняются', async () => {
    const file = await readyFile();
    for (const set of [
      { name: 'другое.pdf' },
      { sizeBytes: 1 },
      { storageKey: `org/${a.orgId}/files/${randomUUID()}` },
      { sourceKind: 'report' },
      { createdBy: chiefUserId },
    ]) {
      await expect(
        withOrgContext(t.app.db, ctxA(), (tx) =>
          tx.update(files).set(set).where(eq(files.id, file.id)),
        ),
        JSON.stringify(set),
      ).rejects.toThrow(permissionDenied);
    }
  });

  it('проверки таблицы: размер до 20 МБ, длина имени, ключ хранилища, вид источника', async () => {
    const insert = (values: Partial<NewFile>) =>
      withOrgContext(t.app.db, ctxA(), (tx) => insertPendingFile(tx, newFile(a, values)));
    await expect(insert({ sizeBytes: 20 * 1048576 + 1 })).rejects.toThrow(
      violation('files_size_check'),
    );
    await expect(insert({ name: 'я'.repeat(256) })).rejects.toThrow(violation('files_name_check'));
    await expect(insert({ name: '' })).rejects.toThrow(violation('files_name_check'));
    await expect(insert({ storageKey: `org/${b.orgId}/files/${randomUUID()}` })).rejects.toThrow(
      violation('files_key_check'),
    );
    await expect(insert({ sourceKind: 'Report;drop' })).rejects.toThrow(
      violation('files_source_kind_check'),
    );
    await insert({ sizeBytes: 20 * 1048576, name: 'я'.repeat(255) });
  });

  it('удаление: отметка с автором и временем, устаревшая версия — «изменено другим»', async () => {
    const file = await readyFile();
    await expect(
      withOrgContext(t.app.db, ctxChief(), (tx) => markFileDeleted(tx, file.id, 1)),
    ).rejects.toThrow(RecordChangedError);
    await withOrgContext(t.app.db, ctxChief(), (tx) => markFileDeleted(tx, file.id, 2));
    const [row] = await t.admin.db.select().from(files).where(eq(files.id, file.id));
    expect(row).toMatchObject({ state: 'deleted', deletedBy: chiefUserId, version: 3 });
    expect(row!.deletedAt).toBeInstanceOf(Date);
    await expect(
      withOrgContext(t.app.db, ctxChief(), (tx) => markFileDeleted(tx, file.id, 3)),
    ).rejects.toThrow(RecordNotFoundError);
    expect(
      await withOrgContext(t.app.db, ctxA(), (tx) => listSourceFiles(tx, 'manual', null)),
    ).not.toContainEqual(expect.objectContaining({ id: file.id }));
  });

  it('удалённый файл не «воскресить»; удалить от имени другого пользователя нельзя', async () => {
    const file = await readyFile();
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) =>
        tx
          .update(files)
          .set({ state: 'deleted', deletedAt: sql`now()`, deletedBy: chiefUserId })
          .where(eq(files.id, file.id)),
      ),
    ).rejects.toThrow(rlsViolation);
    await withOrgContext(t.app.db, ctxA(), (tx) => markFileDeleted(tx, file.id, 2));
    const revived = await withOrgContext(t.app.db, ctxA(), (tx) =>
      tx
        .update(files)
        .set({ state: 'ready', deletedAt: null, deletedBy: null })
        .where(eq(files.id, file.id))
        .returning({ id: files.id }),
    );
    expect(revived).toEqual([]);
  });

  it('строку стереть можно только у незаконченной загрузки', async () => {
    const file = await readyFile();
    const gone = await withOrgContext(t.app.db, ctxA(), (tx) =>
      tx.delete(files).where(eq(files.id, file.id)).returning({ id: files.id }),
    );
    expect(gone).toEqual([]);
    const pending = newFile(a);
    await withOrgContext(t.app.db, ctxA(), async (tx) => {
      await insertPendingFile(tx, pending);
      await dropPendingFile(tx, pending.id);
      expect(await getFile(tx, pending.id)).toBeNull();
    });
  });

  it('очистка: незаконченные загрузки старше срока — по одной организации, порциями', async () => {
    const old = newFile(a);
    const fresh = newFile(a);
    const otherOrg = newFile(b);
    await withOrgContext(t.app.db, ctxA(), async (tx) => {
      await insertPendingFile(tx, old);
      await insertPendingFile(tx, fresh);
    });
    await withOrgContext(t.app.db, ctxB(), (tx) => insertPendingFile(tx, otherOrg));
    await t.admin.db
      .update(files)
      .set({ createdAt: sql`now() - interval '2 days'` })
      .where(sql`${files.id} in (${old.id}, ${otherOrg.id})`);
    const job = { orgId: a.orgId, kind: 'job' } as const;
    const before = new Date(Date.now() - 86_400_000);
    const stale = await withOrgContext(t.app.db, job, (tx) => stalePendingFiles(tx, before, 10));
    expect(stale).toEqual([{ id: old.id, storageKey: old.storageKey }]);
    expect(await withOrgContext(t.app.db, job, (tx) => stalePendingFiles(tx, before, 0))).toEqual(
      [],
    );
    await withOrgContext(t.app.db, job, (tx) => dropPendingFiles(tx, [old.id, otherOrg.id]));
    const left = await t.admin.db
      .select({ id: files.id })
      .from(files)
      .where(sql`${files.id} in (${old.id}, ${fresh.id}, ${otherOrg.id})`);
    expect(left.map((r) => r.id).sort()).toEqual([fresh.id, otherOrg.id].sort());
  });

  it('«История статусов»: файл к смене статуса — свой и загруженный; после удаления — без ссылки', async () => {
    const file = await readyFile();
    const report = randomUUID();
    await withOrgContext(t.app.db, ctxA(), (tx) =>
      writeStatusChange(tx, {
        scale: 'report',
        entityId: report,
        from: null,
        to: 'todo',
        fileId: file.id,
      }),
    );
    const read = () =>
      withOrgContext(t.app.db, ctxA(), (tx) => readStatusHistory(tx, 'report', report));
    expect((await read())[0]!.file).toEqual({ id: file.id, name: file.name, available: true });
    await withOrgContext(t.app.db, ctxA(), (tx) => markFileDeleted(tx, file.id, 2));
    expect((await read())[0]!.file).toEqual({ id: file.id, name: file.name, available: false });

    const fileB = newFile(b);
    await withOrgContext(t.app.db, ctxB(), (tx) => insertPendingFile(tx, fileB));
    await expect(
      withOrgContext(t.app.db, ctxA(), (tx) =>
        tx.insert(statusHistory).values({
          scale: 'report',
          entityId: report,
          fromStatus: 'todo',
          toStatus: 'in_progress',
          fileId: fileB.id,
        }),
      ),
    ).rejects.toThrow(violation('status_history_file_fk'));
  });
});
