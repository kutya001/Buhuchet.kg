import { createHash, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  dmRequests,
  dmTemplateOrgs,
  dmTemplates,
  dmTemplateSql,
  dmTokens,
  files,
  fileTrash,
  orgSettings,
  storageCheckItems,
  storageCheckRuns,
  users,
} from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const denied = expect.objectContaining({
  cause: expect.objectContaining({ code: expect.stringMatching(/^(42501|23514)$/) }),
});
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const DAY = 24 * 60 * 60 * 1000;

// «Витрина данных», сверка хранилища и отложенное удаление (доработки 20.11.2026; миграция 0165, этап 0,
// пункты П2 и П3): кто что видит и меняет — решает база.
describe.skipIf(!databaseAvailable())('витрина данных и файлы Админки: таблицы этапа 0', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId = '';
  const tpl = { all: '', selected: '', draft: '', admin: '' };
  type Fn<T> = Parameters<typeof withOrgContext<T>>[2];
  const inA = <T>(fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
  const inB = <T>(fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);
  const asAdmin = <T>(fn: Parameters<typeof withUserContext<T>>[2]) =>
    withUserContext(db.app.db, adminId, fn);
  const token = (over: Partial<typeof dmTokens.$inferInsert> = {}) => {
    const raw = `bk_${randomUUID().replaceAll('-', '')}`;
    return {
      templateId: tpl.all,
      name: 'Power BI директора',
      tokenHash: hash(raw),
      prefix: raw.slice(0, 7),
      expiresAt: new Date(Date.now() + 30 * DAY),
      ...over,
    };
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец', login, passwordHash: 'x' });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810470',
      slug: 'dm-a',
      owner: owner('dm-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810471',
      slug: 'dm-b',
      owner: owner('dm-owner-b'),
    });
    const [admin] = await db.admin.db
      .insert(users)
      .values({ login: 'dm-platform', passwordHash: 'x', isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    const add = async (code: string, over: Partial<typeof dmTemplates.$inferInsert>) => {
      const [t] = await asAdmin((tx) =>
        tx
          .insert(dmTemplates)
          .values({ code, name: code, module: 'reports', state: 'published', ...over })
          .returning({ id: dmTemplates.id }),
      );
      await asAdmin((tx) =>
        tx.insert(dmTemplateSql).values({ templateId: t!.id, query: 'select 1 as n' }),
      );
      return t!.id;
    };
    tpl.all = await add('reports-due', {});
    tpl.selected = await add('reports-late', { access: 'selected' });
    tpl.draft = await add('draft-one', { state: 'draft' });
    tpl.admin = await add('orgs-admin', { audience: 'admin' });
    await asAdmin((tx) =>
      tx.insert(dmTemplateOrgs).values({ templateId: tpl.selected, orgId: a.orgId }),
    );
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('организация видит только опубликованные шаблоны для организаций, разрешённые ей; текста запроса не видит', async () => {
    const codes = async (fn: typeof inA) =>
      (await fn((tx) => tx.select({ code: dmTemplates.code }).from(dmTemplates)))
        .map((r) => r.code)
        .sort();
    expect(await codes(inA)).toEqual(['reports-due', 'reports-late']);
    expect(await codes(inB)).toEqual(['reports-due']);
    expect(await inA((tx) => tx.select().from(dmTemplateSql))).toEqual([]);
    expect((await inB((tx) => tx.select().from(dmTemplateOrgs))).map((r) => r.orgId)).toEqual([]);
    // Организация шаблонов не меняет и доступа себе не даёт.
    expect(
      await inA((tx) =>
        tx.update(dmTemplates).set({ name: 'x' }).returning({ id: dmTemplates.id }),
      ),
    ).toEqual([]);
    await expect(
      inB((tx) => tx.insert(dmTemplateOrgs).values({ templateId: tpl.selected, orgId: b.orgId })),
    ).rejects.toEqual(denied);
    // Администратор видит всё, вместе с запросами.
    expect(await asAdmin((tx) => tx.select().from(dmTemplates))).toHaveLength(4);
    expect(await asAdmin((tx) => tx.select().from(dmTemplateSql))).toHaveLength(4);
  });

  it('токены: свой — только своей организации; администратор выпускает только токен Админки и видит все; срок — до 180 дней', async () => {
    const [mine] = await inA((tx) =>
      tx.insert(dmTokens).values(token()).returning({ id: dmTokens.id }),
    );
    expect(await inB((tx) => tx.select().from(dmTokens))).toEqual([]);
    expect((await inA((tx) => tx.select().from(dmTokens))).map((t) => t.id)).toEqual([mine!.id]);
    // Выпустить токен за организацию администратор не может — ни в её контексте, ни вне его.
    await expect(
      withOrgContext(db.app.db, { orgId: a.orgId, userId: adminId }, (tx) =>
        tx.insert(dmTokens).values(token()),
      ),
    ).rejects.toEqual(denied);
    await expect(
      asAdmin((tx) => tx.insert(dmTokens).values(token({ orgId: a.orgId }))),
    ).rejects.toEqual(denied);
    await asAdmin((tx) => tx.insert(dmTokens).values(token({ templateId: tpl.admin })));
    expect(await asAdmin((tx) => tx.select().from(dmTokens))).toHaveLength(2);
    // Сотрудник не выпускает токен Админки и не подставляет чужого автора.
    await expect(
      withUserContext(db.app.db, a.ownerUserId, (tx) => tx.insert(dmTokens).values(token())),
    ).rejects.toEqual(denied);
    await expect(
      inA((tx) => tx.insert(dmTokens).values(token({ createdBy: b.ownerUserId }))),
    ).rejects.toEqual(denied);
    await expect(
      inA((tx) =>
        tx.insert(dmTokens).values(token({ expiresAt: new Date(Date.now() + 181 * DAY) })),
      ),
    ).rejects.toEqual(denied);
    // Отзывает тот, кто вошёл; отозванный не возвращается; токены не удаляются.
    await expect(
      inA((tx) =>
        tx
          .update(dmTokens)
          .set({ revokedAt: new Date(), revokedBy: b.ownerUserId })
          .where(eq(dmTokens.id, mine!.id)),
      ),
    ).rejects.toEqual(denied);
    await asAdmin((tx) =>
      tx
        .update(dmTokens)
        .set({ revokedAt: new Date(), revokedBy: adminId })
        .where(eq(dmTokens.id, mine!.id)),
    );
    expect(
      await inA((tx) =>
        tx
          .update(dmTokens)
          .set({ revokedAt: null, revokedBy: null })
          .where(eq(dmTokens.id, mine!.id))
          .returning({ id: dmTokens.id }),
      ),
    ).toEqual([]);
    await expect(inA((tx) => tx.delete(dmTokens).where(eq(dmTokens.id, mine!.id)))).rejects.toEqual(
      denied,
    );
  });

  it('журнал запросов пишет только исполнитель Витрины; организация видит свои строки, Админка — все', async () => {
    await expect(
      inA((tx) => tx.insert(dmRequests).values({ orgId: a.orgId, via: 'screen', outcome: 'ok' })),
    ).rejects.toEqual(denied);
    await db.admin.db.insert(dmRequests).values([
      { orgId: a.orgId, templateId: tpl.all, via: 'api', outcome: 'ok', rowCount: 5 },
      { orgId: b.orgId, templateId: tpl.all, via: 'screen', outcome: 'ok', rowCount: 1 },
      { orgId: null, templateId: tpl.admin, via: 'api', outcome: 'rate' },
    ]);
    expect((await inA((tx) => tx.select().from(dmRequests))).map((r) => r.orgId)).toEqual([
      a.orgId,
    ]);
    expect(await asAdmin((tx) => tx.select().from(dmRequests))).toHaveLength(3);
    await expect(inA((tx) => tx.delete(dmRequests))).rejects.toEqual(denied);
  });

  it('«Внешний доступ по API» сначала выключен', async () => {
    const [s] = await inA((tx) => tx.select({ extApi: orgSettings.extApi }).from(orgSettings));
    expect(s!.extApi).toBe(false);
  });

  it('сверка хранилища: пишут только функции задачи, читает только администратор платформы', async () => {
    await expect(inA((tx) => tx.insert(storageCheckRuns).values({}))).rejects.toEqual(denied);
    const [run] = await db.admin.db
      .insert(storageCheckRuns)
      .values({})
      .returning({ id: storageCheckRuns.id });
    await db.admin.db.insert(storageCheckItems).values({
      kind: 'extra',
      key: `org/${a.orgId}/files/${randomUUID()}`,
      keyOrgId: a.orgId,
      sizeBytes: 10,
      firstRunId: run!.id,
      lastRunId: run!.id,
    });
    expect(await inA((tx) => tx.select().from(storageCheckItems))).toEqual([]);
    expect(await asAdmin((tx) => tx.select().from(storageCheckItems))).toHaveLength(1);
    expect(await asAdmin((tx) => tx.select().from(storageCheckRuns))).toHaveLength(1);
    await expect(
      asAdmin((tx) => tx.update(storageCheckItems).set({ resolvedAt: new Date() })),
    ).rejects.toEqual(denied);
  });

  it('«Ждут удаления»: файл стирается не раньше чем через сутки; ставит удаливший, «Вернуть» — администратор; Админка видит все', async () => {
    const id = randomUUID();
    const key = `org/${b.orgId}/files/${id}`;
    await db.admin.db.insert(files).values({
      id,
      orgId: b.orgId,
      sourceKind: 'manual',
      name: 'Договор.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100,
      storageKey: key,
      state: 'deleted',
      createdBy: b.ownerUserId,
      deletedAt: new Date(),
      deletedBy: b.ownerUserId,
    });
    const row = {
      why: 'del' as const,
      fileId: id,
      storageKey: key,
      name: 'Договор.pdf',
      sizeBytes: 100,
    };
    // Раньше суток, от чужого имени, лишний файл — организация не ставит.
    await expect(
      inB((tx) => tx.insert(fileTrash).values({ ...row, eraseAt: new Date() })),
    ).rejects.toEqual(denied);
    await expect(
      inB((tx) => tx.insert(fileTrash).values({ ...row, deletedBy: a.ownerUserId })),
    ).rejects.toEqual(denied);
    await expect(
      inB((tx) => tx.insert(fileTrash).values({ ...row, why: 'extra', fileId: null })),
    ).rejects.toEqual(denied);
    const [t1] = await inB((tx) => tx.insert(fileTrash).values(row).returning());
    expect(t1!.eraseAt.getTime() - t1!.deletedAt.getTime()).toBe(24 * 60 * 60 * 1000);
    // Тот же объект второй раз не ждёт; чужая организация строку не видит.
    await expect(inB((tx) => tx.insert(fileTrash).values(row))).rejects.toEqual(
      expect.objectContaining({ cause: expect.objectContaining({ code: '23505' }) }),
    );
    expect(await inA((tx) => tx.select().from(fileTrash))).toEqual([]);
    // Сама организация не возвращает и не стирает; администратор возвращает от своего имени.
    expect(
      await inB((tx) =>
        tx
          .update(fileTrash)
          .set({ restoredAt: new Date(), restoredBy: b.ownerUserId })
          .returning({ id: fileTrash.id }),
      ),
    ).toEqual([]);
    await expect(inB((tx) => tx.delete(fileTrash))).rejects.toEqual(denied);
    // Прежнюю версию после замены вернуть нельзя.
    const rep = await inB((tx) =>
      tx
        .insert(fileTrash)
        .values({
          why: 'rep',
          storageKey: `org/${b.orgId}/files/${randomUUID()}`,
          name: 'Старый.pdf',
          sizeBytes: 5,
        })
        .returning({ id: fileTrash.id }),
    );
    await expect(
      asAdmin((tx) =>
        tx
          .update(fileTrash)
          .set({ restoredAt: new Date(), restoredBy: adminId })
          .where(eq(fileTrash.id, rep[0]!.id)),
      ),
    ).rejects.toEqual(denied);
    await asAdmin((tx) =>
      tx
        .update(fileTrash)
        .set({ restoredAt: new Date(), restoredBy: adminId })
        .where(eq(fileTrash.id, t1!.id)),
    );
    // Лишний файл хранилища без организации — только администратор.
    await asAdmin((tx) =>
      tx
        .insert(fileTrash)
        .values({
          why: 'extra',
          storageKey: 'org/x/files/y',
          name: 'y',
          sizeBytes: 1,
          source: 'Лишний файл хранилища',
        }),
    );
    expect(await asAdmin((tx) => tx.select().from(fileTrash))).toHaveLength(3);
  });

  it('файлы всех организаций для Админки — без ключа хранилища; сотруднику — ничего', async () => {
    const rows = await asAdmin((tx) =>
      tx.execute<Record<string, unknown>>(sql`select * from app.admin_files`),
    );
    expect(rows.map((r) => r.org_id)).toEqual([b.orgId]);
    expect(Object.keys(rows[0]!)).not.toContain('storage_key');
    expect(await inA((tx) => tx.execute(sql`select * from app.admin_files`))).toHaveLength(0);
  });
});
