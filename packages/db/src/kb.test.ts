import { hashPassword } from '@buhuchet/adapters/password';
import { KB_STEP_RULES } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import { writeHistory } from './history';
import {
  kbArticles,
  kbCatalog,
  kbDoneFacts,
  kbFeatureOnDates,
  kbMarkArticleRead,
  kbMarkDone,
  kbMarksOf,
  kbMembers,
  kbReachedOf,
  kbReadArticles,
  kbRecordLevels,
  kbScreenUi,
  kbSetSkipped,
} from './kb';
import { createOrganization, type CreatedOrganization } from './organizations';
import { kbArticleReads, kbLevels, kbProgress, telegramLinks, users } from './schema';
import { createEmployee } from './staff';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedKbReference,
  type TestDatabase,
} from './testing';

const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});

describe.skipIf(!databaseAvailable())('«База знаний»: прогресс пользователей', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId: string;
  let accUserId: string;
  let accEmployeeId: string;
  const inOrg = <T>(
    org: CreatedOrganization,
    userId: string,
    fn: Parameters<typeof withOrgContext<T>>[2],
  ) => withOrgContext(db.app.db, { orgId: org.orgId, userId }, fn);
  const asOwner = <T>(org: CreatedOrganization, fn: Parameters<typeof withOrgContext<T>>[2]) =>
    inOrg(org, org.ownerUserId, fn);

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    await seedKbReference(db.admin.db);
    const passwordHash = await hashPassword('Bh-4821-temp');
    const [admin] = await db.admin.db
      .insert(users)
      .values({ login: 'platform', passwordHash, isPlatformAdmin: true })
      .returning({ id: users.id });
    adminId = admin!.id;
    a = await createOrganization(db.app.db, {
      name: 'ОсОО «Альфа»',
      inn: '01811201810456',
      slug: 'alfa',
      owner: { fullName: 'Асанов Асан Асанович', login: 'asanov', passwordHash },
    });
    b = await createOrganization(db.app.db, {
      name: 'ОсОО «Бета»',
      inn: '02811201810457',
      slug: 'beta',
      owner: { fullName: 'Бекова Бермет', login: 'bekova', passwordHash },
    });
    const acc = a.roles.find((r) => r.templateCode === 'acc')!;
    accEmployeeId = await asOwner(a, (tx) =>
      createEmployee(tx, {
        fullName: 'Усенова Айгуль',
        shortName: 'Айгуль У.',
        login: 'usenova',
        passwordHash,
        phone: null,
        role: { id: acc.id, name: acc.name },
      }),
    );
    const [user] = await db.admin.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.login, 'usenova'));
    accUserId = user!.id;
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('шаги, группы, уровни, статьи и описание экранов — из refDB.json', async () => {
    const catalog = await kbCatalog(db.app.db);
    expect(catalog.steps.length).toBeGreaterThan(50);
    expect(catalog.steps.find((s) => s.id === 'profile')).toMatchObject({
      g: 'org',
      star: 1,
      evk: 'org.main',
    });
    expect(catalog.groups.map((g) => g.id)).toContain('lists');
    expect(catalog.levels.business[0]).toEqual({ n: 'Новичок', p: 0 });
    expect(catalog.levels.business.length).toBeGreaterThan(3);
    const articles = await kbArticles(db.app.db);
    expect(articles.find((x) => x.mod === 'staff')).toBeDefined();
    const ui = await kbScreenUi(db.app.db);
    expect(Object.keys(ui.tabs ?? {})).toContain('staff.list');
  });

  it('шаг засчитывается один раз и навсегда: способ и момент не меняются', async () => {
    expect(await asOwner(a, (tx) => kbMarkDone(tx, 'profile', 'action'))).toBe(true);
    expect(await asOwner(a, (tx) => kbMarkDone(tx, 'profile', 'data'))).toBe(false);
    const marks = await asOwner(a, (tx) => kbMarksOf(tx, [a.ownerUserId]));
    expect(marks.get(a.ownerUserId)?.get('profile')).toEqual({
      done: { how: 'action', at: expect.any(String) },
      skipped: false,
    });
    const [row] = await db.admin.db
      .select()
      .from(kbProgress)
      .where(eq(kbProgress.stepId, 'profile'));
    expect(row).toMatchObject({ orgId: a.orgId, userId: a.ownerUserId, doneHow: 'action' });
  });

  it('«Пропустить» — только не выполненный шаг; выполнение снимает пропуск; «Вернуть»', async () => {
    expect(await asOwner(a, (tx) => kbSetSkipped(tx, 'policy', true))).toBe(true);
    expect(await asOwner(a, (tx) => kbSetSkipped(tx, 'policy', true))).toBe(false);
    expect(await asOwner(a, (tx) => kbSetSkipped(tx, 'profile', true))).toBe(false);
    expect(await asOwner(a, (tx) => kbSetSkipped(tx, 'remind', true))).toBe(true);
    expect(await asOwner(a, (tx) => kbSetSkipped(tx, 'remind', false))).toBe(true);
    expect(await asOwner(a, (tx) => kbSetSkipped(tx, 'remind', false))).toBe(false);
    expect(await asOwner(a, (tx) => kbMarkDone(tx, 'policy', 'data'))).toBe(true);
    const marks = (await asOwner(a, (tx) => kbMarksOf(tx, [a.ownerUserId]))).get(a.ownerUserId)!;
    expect(marks.get('policy')).toEqual({
      done: { how: 'data', at: expect.any(String) },
      skipped: false,
    });
    expect(marks.get('remind')).toEqual({ done: null, skipped: false });
  });

  it('уровни записываются один раз, статья читается один раз', async () => {
    await asOwner(a, (tx) => kbRecordLevels(tx, [0, 1, 2]));
    await asOwner(a, (tx) => kbRecordLevels(tx, [2, 3]));
    await asOwner(a, (tx) => kbRecordLevels(tx, []));
    const reached = await asOwner(a, (tx) => kbReachedOf(tx, [a.ownerUserId, accUserId]));
    expect(reached.get(a.ownerUserId)?.map((r) => r.level)).toEqual([0, 1, 2, 3]);
    expect(reached.get(accUserId)).toEqual([]);
    expect(await asOwner(a, (tx) => kbMarkArticleRead(tx, 'a15'))).toBe(true);
    expect(await asOwner(a, (tx) => kbMarkArticleRead(tx, 'a15'))).toBe(false);
    const read = await asOwner(a, (tx) => kbReadArticles(tx, a.ownerUserId));
    expect([...read.keys()]).toEqual(['a15']);
  });

  it('чужая организация не видна', async () => {
    await asOwner(b, (tx) => kbMarkDone(tx, 'tg', 'data'));
    for (const table of [kbProgress, kbArticleReads, kbLevels]) {
      const rows = await asOwner(b, (tx) => tx.select({ userId: table.userId }).from(table));
      expect(rows.every((r) => r.userId === b.ownerUserId)).toBe(true);
    }
    expect(
      (await asOwner(b, (tx) => kbMarksOf(tx, [a.ownerUserId]))).get(a.ownerUserId)?.size,
    ).toBe(0);
    expect((await asOwner(b, (tx) => kbReachedOf(tx, [a.ownerUserId]))).get(a.ownerUserId)).toEqual(
      [],
    );
    expect((await asOwner(b, (tx) => kbReadArticles(tx, a.ownerUserId))).size).toBe(0);
    // Указать чужую организацию или чужого пользователя нельзя.
    await expect(
      asOwner(b, (tx) =>
        tx.insert(kbProgress).values({ orgId: a.orgId, userId: b.ownerUserId, stepId: 'x' }),
      ),
    ).rejects.toEqual(permissionDenied);
    const changed = await asOwner(b, (tx) =>
      tx
        .update(kbProgress)
        .set({ skippedAt: sql`now()` })
        .where(eq(kbProgress.userId, a.ownerUserId))
        .returning(),
    );
    expect(changed).toEqual([]);
  });

  it('в своей организации прогресс виден всем, а пишется только свой', async () => {
    await inOrg(a, accUserId, (tx) => kbMarkDone(tx, 'search', 'use'));
    const marks = await asOwner(a, (tx) => kbMarksOf(tx, [a.ownerUserId, accUserId]));
    expect(marks.get(accUserId)?.get('search')?.done?.how).toBe('use');
    expect(marks.get(a.ownerUserId)?.get('profile')?.done?.how).toBe('action');
    await expect(
      inOrg(a, accUserId, (tx) =>
        tx.insert(kbProgress).values({ userId: a.ownerUserId, stepId: 'tg' }),
      ),
    ).rejects.toEqual(permissionDenied);
    await expect(
      inOrg(a, accUserId, (tx) => tx.insert(kbLevels).values({ userId: a.ownerUserId, level: 5 })),
    ).rejects.toEqual(permissionDenied);
    const changed = await inOrg(a, accUserId, (tx) =>
      tx
        .update(kbProgress)
        .set({ skippedAt: sql`now()` })
        .where(eq(kbProgress.userId, a.ownerUserId))
        .returning(),
    );
    expect(changed).toEqual([]);
  });

  it('отметки не удаляются, а у шага меняются только способ, момент и пропуск', async () => {
    await expect(asOwner(a, (tx) => tx.delete(kbProgress))).rejects.toEqual(permissionDenied);
    await expect(asOwner(a, (tx) => tx.delete(kbLevels))).rejects.toEqual(permissionDenied);
    await expect(asOwner(a, (tx) => tx.delete(kbArticleReads))).rejects.toEqual(permissionDenied);
    await expect(
      asOwner(a, (tx) => tx.update(kbProgress).set({ stepId: 'other' })),
    ).rejects.toEqual(permissionDenied);
    await expect(
      asOwner(a, (tx) => tx.update(kbLevels).set({ reachedAt: sql`now()` })),
    ).rejects.toEqual(permissionDenied);
    await expect(
      asOwner(a, (tx) => tx.update(kbArticleReads).set({ readAt: sql`now()` })),
    ).rejects.toEqual(permissionDenied);
  });

  it('прогресс администратора платформы — без организации, виден только ему', async () => {
    const mark = (userId: string) =>
      withUserContext(db.app.db, userId, (tx) => kbMarkDone(tx, 'theme', 'use'));
    expect(await mark(adminId)).toBe(true);
    const [row] = await db.admin.db.select().from(kbProgress).where(eq(kbProgress.userId, adminId));
    expect(row).toMatchObject({ orgId: null, stepId: 'theme' });
    const own = await withUserContext(db.app.db, adminId, (tx) =>
      kbMarksOf(tx, [adminId, a.ownerUserId]),
    );
    expect([...own.get(adminId)!.keys()]).toEqual(['theme']);
    expect(own.get(a.ownerUserId)?.size).toBe(0);
    expect((await asOwner(a, (tx) => kbMarksOf(tx, [adminId]))).get(adminId)?.size).toBe(0);
  });

  it('факты «Сделать» — из своей истории изменений и своего Telegram', async () => {
    await asOwner(a, (tx) =>
      writeHistory(
        tx,
        {
          entity: 'organization',
          entityId: a.orgId,
          action: 'update',
          changes: [{ field: 'name', from: 'А', to: 'Б' }],
        },
        {
          entity: 'org_settings',
          entityId: a.orgId,
          action: 'update',
          changes: [{ field: 'features', from: { fee: false }, to: { fee: true } }],
        },
        {
          entity: 'org_report_type',
          entityId: 'ОТЧ-01',
          action: 'update',
          changes: [{ field: 'needFile', from: false, to: true }],
        },
        {
          entity: 'org_account',
          entityId: '00000000-0000-4000-8000-000000000001',
          action: 'create',
          changes: [{ field: 'bank', from: null, to: 'M-Bank' }],
        },
      ),
    );
    await db.admin.db
      .insert(telegramLinks)
      .values({ userId: a.ownerUserId, orgId: a.orgId, chatId: 7001 });
    const steps = ['profile', 'accs', 'policy', 'remind', 'types', 'typecfg', 'tg', 'emps'].map(
      (id) => ({
        id,
        rule: KB_STEP_RULES[id]!.done!,
      }),
    );
    const owner = await asOwner(a, (tx) => kbDoneFacts(tx, a.ownerUserId, steps));
    expect([...owner.keys()].sort()).toEqual([
      'accs',
      'emps',
      'policy',
      'profile',
      'tg',
      'typecfg',
    ]);
    expect(owner.get('tg')).toBeInstanceOf(Date);
    // Действия владельца сотруднику не засчитываются.
    const acc = await inOrg(a, accUserId, (tx) => kbDoneFacts(tx, accUserId, steps));
    expect(acc.size).toBe(0);
    // Другая организация не видит ни истории, ни Telegram владельца «Альфы».
    expect((await asOwner(b, (tx) => kbDoneFacts(tx, a.ownerUserId, steps))).size).toBe(0);
    expect(await asOwner(a, (tx) => kbDoneFacts(tx, a.ownerUserId, []))).toEqual(new Map());
  });

  it('«Подключили функцию» — дата последнего включения по истории учётной политики', async () => {
    const since = new Date(Date.now() - 60_000);
    const on = await asOwner(a, (tx) => kbFeatureOnDates(tx, since));
    expect(Object.keys(on)).toEqual(['fee']);
    expect(on.fee).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await asOwner(a, (tx) => kbFeatureOnDates(tx, new Date(Date.now() + 60_000)))).toEqual(
      {},
    );
    expect(await asOwner(b, (tx) => kbFeatureOnDates(tx, since))).toEqual({});
  });

  it('сотрудники организации с ролями', async () => {
    const members = await asOwner(a, (tx) => kbMembers(tx));
    expect(members.map((m) => [m.fullName, m.isOwner])).toEqual([
      ['Асанов Асан Асанович', true],
      ['Усенова Айгуль', false],
    ]);
    const one = await asOwner(a, (tx) => kbMembers(tx, [accEmployeeId]));
    expect(one).toEqual([expect.objectContaining({ userId: accUserId, active: true })]);
    expect(await asOwner(b, (tx) => kbMembers(tx, [accEmployeeId]))).toEqual([]);
  });
});
