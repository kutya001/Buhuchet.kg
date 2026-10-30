import { hashPassword } from '@buhuchet/adapters/password';
import { addDays, bishkekDate, newsShowMoment } from '@buhuchet/domain';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import {
  createNews,
  deleteNewsDraft,
  getNews,
  listNewsAdminPage,
  listNewsAdminValues,
  markNewsRead,
  newsAdminHistory,
  newsFeed,
  newsUnreadCount,
  newsWhatsNew,
  publishNews,
  saveNews,
  setNewsOff,
  type NewsInput,
} from './news';
import { markWelcomeSeen } from './onboarding';
import { createOrganization, type CreatedOrganization } from './organizations';
import { readPlatformHistory } from './platform-history';
import { news, newsReads, platformAuditLog, users } from './schema';
import { newsSeedRows } from './seed/news';
import { readSpecJson } from './spec-data';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  type TestDatabase,
} from './testing';

const permissionDenied = expect.objectContaining({
  cause: expect.objectContaining({ code: '42501' }),
});

const t = (key: string) => key;

describe.skipIf(!databaseAvailable())('«Новости» Базы знаний', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let adminId: string;
  const yesterday = addDays(bishkekDate(new Date()), -1);
  const tomorrow = addDays(bishkekDate(new Date()), 1);
  const asOwner = <T>(org: CreatedOrganization, fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: org.orgId, userId: org.ownerUserId }, fn);
  const asAdmin = <T>(fn: Parameters<typeof withUserContext<T>>[2]) =>
    withUserContext(db.app.db, adminId, fn);
  const input = (over: Partial<NewsInput> = {}): NewsInput => ({
    title: 'Версия 1.4',
    type: 'update',
    release: '1.4',
    date: yesterday,
    short: 'Коротко о версии',
    md: '## Что нового\n- Пункт',
    link: null,
    pinned: false,
    showOnLogin: true,
    audience: 'all',
    ...over,
  });

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
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
    // Старая новость (вышла до появления учётных записей) и черновик, будущая, снятая, для Админки.
    await db.admin.db.insert(news).values([
      {
        id: 'v1',
        title: 'Версия 1',
        type: 'feature',
        release: '1',
        publishDate: '2026-01-10',
        short: 'Первая',
        md: '- Первая',
        status: 'published',
        publishedAt: new Date('2026-01-10T03:00:00Z'),
      },
      {
        id: 'draft1',
        title: 'Черновик',
        type: 'update',
        publishDate: yesterday,
        short: 'Черновик',
        md: '- Черновик',
      },
      {
        id: 'future1',
        title: 'Завтра',
        type: 'update',
        release: '2.0',
        publishDate: tomorrow,
        short: 'Завтра',
        md: '- Завтра',
        status: 'published',
        publishedAt: new Date(),
      },
      {
        id: 'off1',
        title: 'Снята',
        type: 'fix',
        release: '1.3',
        publishDate: yesterday,
        short: 'Снята',
        md: '- Снята',
        status: 'published',
        publishedAt: new Date(),
        off: true,
      },
      {
        id: 'adm1',
        title: 'Для Админки',
        type: 'announce',
        publishDate: yesterday,
        short: 'Только режим Админка',
        md: '- Админка',
        status: 'published',
        publishedAt: new Date(),
        audience: 'adm',
        showOnLogin: false,
      },
    ]);
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('пользователь видит только опубликованные, не снятые, с наступившей датой и для всех', async () => {
    const feed = await asOwner(a, (tx) => newsFeed(tx));
    expect(feed.map((n) => n.id)).toEqual(['v1']);
    // Политика базы прячет и при прямом запросе.
    const raw = await asOwner(a, (tx) => tx.select({ id: news.id }).from(news));
    expect(raw.map((r) => r.id)).toEqual(['v1']);
    expect(await asOwner(a, (tx) => getNews(tx, 'draft1'))).toBeNull();
  });

  it('администратор платформы в своей ленте видит новости для Админки, но не черновики', async () => {
    const feed = await asAdmin((tx) => newsFeed(tx));
    expect(feed.map((n) => n.id).sort()).toEqual(['adm1', 'v1']);
  });

  it('новость, вышедшая до появления учётной записи, прочитана; новая — нет', async () => {
    const created = await asAdmin((tx) => createNews(tx, input(), { publish: true }));
    const feed = await asOwner(a, (tx) => newsFeed(tx));
    expect(feed.map((n) => [n.id, n.read])).toEqual([
      [created.id, false],
      ['v1', true],
    ]);
    expect(await asOwner(a, (tx) => newsUnreadCount(tx))).toBe(1);
    const wn = await asOwner(a, (tx) => newsWhatsNew(tx));
    expect(wn.items.map((n) => n.id)).toEqual([created.id]);
    expect(wn.first).toBe(true);

    // Кто видел приветствие организации, тому приветствие в окне не повторяется (решение Г-4 «А»).
    expect((await asOwner(b, (tx) => newsWhatsNew(tx))).first).toBe(true);
    await asOwner(b, (tx) => markWelcomeSeen(tx));
    expect(await asOwner(b, (tx) => newsWhatsNew(tx))).toMatchObject({
      items: [expect.objectContaining({ id: created.id })],
      first: false,
    });
    // Администратор платформы без организации: строки «Приветствия» у него нет, ответ — без ошибки.
    expect((await asAdmin((tx) => newsWhatsNew(tx))).first).toBe(true);

    // «Понятно»: показанные — прочитаны; окно больше не открывается.
    expect(await asOwner(a, (tx) => markNewsRead(tx, [created.id, 'draft1', 'future1']))).toBe(1);
    expect(await asOwner(a, (tx) => markNewsRead(tx, [created.id]))).toBe(0);
    expect(await asOwner(a, (tx) => newsUnreadCount(tx))).toBe(0);
    expect((await asOwner(a, (tx) => newsWhatsNew(tx))).items).toEqual([]);
    expect((await asOwner(a, (tx) => newsWhatsNew(tx))).first).toBe(false);

    // У другой организации своя прочитанность.
    expect(await asOwner(b, (tx) => newsUnreadCount(tx))).toBe(1);
    expect(await asOwner(b, (tx) => markNewsRead(tx, 'all'))).toBe(1);
    expect(await asOwner(b, (tx) => newsUnreadCount(tx))).toBe(0);
  });

  it('в окне «Что нового» — только новости «Показывать при входе»', async () => {
    const quiet = await asAdmin((tx) =>
      createNews(tx, input({ title: 'Исправления', type: 'fix', showOnLogin: false }), {
        publish: true,
      }),
    );
    expect((await asOwner(a, (tx) => newsWhatsNew(tx))).items).toEqual([]);
    expect(await asOwner(a, (tx) => newsUnreadCount(tx))).toBe(1);
    await asOwner(a, (tx) => markNewsRead(tx, [quiet.id]));
  });

  it('отметки прочитанности: свои видны, чужие нет; чужому не поставить, изменить и удалить нельзя', async () => {
    const mine = await asOwner(a, (tx) => tx.select().from(newsReads));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.userId === a.ownerUserId && r.orgId === a.orgId)).toBe(true);
    await expect(
      asOwner(a, (tx) => tx.insert(newsReads).values({ userId: b.ownerUserId, newsId: 'v1' })),
    ).rejects.toThrow();
    await expect(
      asOwner(a, (tx) => tx.update(newsReads).set({ readAt: new Date() })),
    ).rejects.toEqual(permissionDenied);
    await expect(asOwner(a, (tx) => tx.delete(newsReads))).rejects.toEqual(permissionDenied);
    // Администратор видит все — для столбца «Прочитали».
    const all = await asAdmin((tx) => tx.select().from(newsReads));
    expect(new Set(all.map((r) => r.userId))).toEqual(new Set([a.ownerUserId, b.ownerUserId]));
  });

  it('сотрудник организации новости не добавляет и не меняет', async () => {
    await expect(asOwner(a, (tx) => createNews(tx, input(), { publish: true }))).rejects.toThrow();
    const changed = await asOwner(a, (tx) =>
      tx.update(news).set({ title: 'Взлом' }).where(eq(news.id, 'v1')).returning({ id: news.id }),
    );
    expect(changed).toEqual([]);
    const deleted = await asOwner(a, (tx) =>
      tx
        .delete(news)
        .where(inArray(news.id, ['v1', 'draft1']))
        .returning({ id: news.id }),
    );
    expect(deleted).toEqual([]);
    // Опубликованную не удаляет и администратор платформы — только снимает с публикации.
    expect(
      await asAdmin((tx) => tx.delete(news).where(eq(news.id, 'v1')).returning({ id: news.id })),
    ).toEqual([]);
    expect(
      await db.admin.db.select({ id: news.id }).from(news).where(eq(news.id, 'draft1')),
    ).toEqual([{ id: 'draft1' }]);
  });

  it('дата публикации — с 09:00 по Бишкеку: «сегодня» видна, только когда этот момент наступил', async () => {
    // Момент в базе тот же, что у правила домена: 09:00 по Asia/Bishkek (UTC+6).
    const [row] = await db.admin.db.execute<{ at: Date | string }>(
      sql`select (date '2026-10-20' + time '09:00') at time zone 'Asia/Bishkek' as at`,
    );
    expect(new Date(row!.at).toISOString()).toBe(newsShowMoment('2026-10-20').toISOString());

    const today = bishkekDate(new Date());
    await db.admin.db.insert(news).values({
      id: 'today1',
      title: 'Сегодня',
      type: 'update',
      publishDate: today,
      short: 'Сегодня',
      md: '- Сегодня',
      status: 'published',
      publishedAt: new Date(),
      showOnLogin: false,
    });
    try {
      const shown = (await asOwner(a, (tx) => getNews(tx, 'today1'))) !== null;
      expect(shown).toBe(Date.now() >= newsShowMoment(today).getTime());
    } finally {
      await db.admin.db.delete(news).where(eq(news.id, 'today1'));
    }
  });

  it('Админка: черновик → публикация, правка опубликованной с «Изменено», снятие и возврат; всё — в истории платформы', async () => {
    const draft = await asAdmin((tx) =>
      createNews(tx, input({ release: null }), { publish: false }),
    );
    expect(draft).toMatchObject({ status: 'draft', publishedAt: null, version: 1 });
    const saved = await asAdmin((tx) =>
      saveNews(tx, draft.id, 1, input({ title: 'Версия 1.5' }), { publish: false }),
    );
    expect(saved).toMatchObject({ ok: true, record: { title: 'Версия 1.5', status: 'draft' } });
    expect(await asAdmin((tx) => saveNews(tx, draft.id, 1, input(), { publish: false }))).toEqual({
      ok: false,
      reason: 'changed',
      current: 2,
    });
    // Черновик снять с публикации нельзя: он ещё не опубликован.
    expect(await asAdmin((tx) => setNewsOff(tx, draft.id, 2, true))).toEqual({
      ok: false,
      reason: 'not_published',
    });
    const published = await asAdmin((tx) => publishNews(tx, draft.id, 2));
    expect(published).toMatchObject({ ok: true, record: { status: 'published', version: 3 } });
    expect(await asAdmin((tx) => publishNews(tx, draft.id, 3))).toEqual({
      ok: false,
      reason: 'not_draft',
    });
    const edited = await asAdmin((tx) =>
      saveNews(tx, draft.id, 3, input({ title: 'Версия 1.5 — исправлено' }), { publish: false }),
    );
    expect(edited.ok && edited.record.editedAt).toBeInstanceOf(Date);
    expect(edited.ok && edited.record.status).toBe('published');

    const off = await asAdmin((tx) => setNewsOff(tx, draft.id, 4, true));
    expect(off).toMatchObject({ ok: true, record: { off: true } });
    expect((await asOwner(a, (tx) => newsFeed(tx))).some((n) => n.id === draft.id)).toBe(false);
    expect(await asAdmin((tx) => setNewsOff(tx, draft.id, 5, false))).toMatchObject({
      ok: true,
      record: { off: false },
    });
    // Опубликованную удалить нельзя — ни методом, ни прямым запросом.
    expect(await asAdmin((tx) => deleteNewsDraft(tx, draft.id, 6))).toEqual({
      ok: false,
      reason: 'not_draft',
    });
    const direct = await asAdmin((tx) =>
      tx.delete(news).where(eq(news.id, draft.id)).returning({ id: news.id }),
    );
    expect(direct).toEqual([]);
    expect(await asAdmin((tx) => deleteNewsDraft(tx, 'draft1', 1))).toMatchObject({ ok: true });
    expect(await asAdmin((tx) => getNews(tx, 'draft1'))).toBeNull();

    // История: создание, правки с «было → стало», публикация, снятие и возврат; удаление черновика.
    const history = await asAdmin((tx) => readPlatformHistory(tx, 'news', draft.id));
    expect(history.map((h) => h.action)).toEqual([
      'create',
      'update',
      'update',
      'update',
      'update',
      'update',
    ]);
    expect(history.every((h) => h.actorUserId === adminId)).toBe(true);
    expect(history[0]!.changes).toContainEqual({ field: 'status', to: 'draft' });
    expect(history[1]!.changes).toEqual([
      { field: 'title', from: 'Версия 1.4', to: 'Версия 1.5' },
      { field: 'release', from: null, to: '1.4' },
    ]);
    expect(history[2]!.changes).toEqual([{ field: 'status', from: 'draft', to: 'published' }]);
    expect(history[4]!.changes).toEqual([{ field: 'off', from: false, to: true }]);
    const removed = await asAdmin((tx) => readPlatformHistory(tx, 'news', 'draft1'));
    expect(removed.map((h) => h.action)).toEqual(['delete']);

    // «История изменений · N» под списком в Админке: новые сверху, заголовок — на момент записи.
    const shown = await asAdmin((tx) => newsAdminHistory(tx));
    expect(shown.total).toBeGreaterThanOrEqual(7);
    expect(shown.items.slice(0, 9).map((h) => [h.kind, h.title])).toEqual([
      ['deleted', 'Черновик'],
      ['back', 'Версия 1.5 — исправлено'],
      ['off', 'Версия 1.5 — исправлено'],
      ['edited', 'Версия 1.5 — исправлено'],
      ['published', 'Версия 1.5'],
      ['draft_saved', 'Версия 1.5'],
      ['draft', 'Версия 1.4'],
      // Созданная сразу опубликованной — одна запись истории, две строки, как в прототипе.
      ['published', 'Исправления'],
      ['draft', 'Исправления'],
    ]);
    expect(shown.items[7]!.id).toBe(shown.items[8]!.id);
    const raw = await db.admin.db
      .select({ action: platformAuditLog.action, changes: platformAuditLog.changes })
      .from(platformAuditLog)
      .where(eq(platformAuditLog.entity, 'news'));
    const instant = raw.filter(
      (r) =>
        r.action === 'create' &&
        r.changes.some((c) => c.field === 'status' && c.to === 'published'),
    );
    expect(instant.length).toBe(2);
    expect(shown.total).toBe(raw.length + instant.length);
    expect(await asOwner(a, (tx) => newsAdminHistory(tx))).toEqual({ total: 0, items: [] });
  });

  it('список Админки: все новости, состояние, тип и «Прочитали»; фильтр по статусу', async () => {
    const page = await asAdmin((tx) =>
      listNewsAdminPage(tx, { page: 1, size: 25, sort: undefined, filters: {} }, t),
    );
    const byId = new Map(page.rows.map((r) => [r.id, r]));
    expect(byId.get('future1')).toMatchObject({ state: 'scheduled' });
    expect(byId.get('off1')).toMatchObject({ state: 'off' });
    expect(byId.get('v1')).toMatchObject({ state: 'live', reads: 0 });
    // Как во всех списках — от новых к старым по «Создано».
    const created = page.rows.map((r) => r.createdAt.getTime());
    expect(created).toEqual([...created].sort((a, b) => b - a));
    const values = await asAdmin((tx) => listNewsAdminValues(tx, 'status', t));
    expect(values.items.map((v) => v.value).sort()).toEqual(['live', 'off', 'scheduled']);
    // Сотруднику организации — только видимые ему.
    const forOwner = await asOwner(a, (tx) =>
      listNewsAdminPage(tx, { page: 1, size: 25, sort: undefined, filters: {} }, t),
    );
    expect(forOwner.rows.every((r) => r.state === 'live' && r.audience === 'all')).toBe(true);
  });

  it('начальное наполнение: опубликованные новости refDB.json с типами кодами', async () => {
    const refDB = await readSpecJson<Record<string, unknown>>('data/refDB.json');
    const rows = newsSeedRows(refDB.news);
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.every((r) => r.status === 'published')).toBe(true);
    expect(rows.find((r) => r.id === 'v1')).toMatchObject({
      type: 'feature',
      release: '1',
      showOnLogin: true,
      publishedAt: new Date('2026-10-12T03:00:00Z'),
    });
    const [{ n }] = (await db.admin.db.execute<{ n: number }>(
      sql`select count(*)::integer as n from news where id = 'v1'`,
    )) as unknown as [{ n: number }];
    expect(n).toBe(1);
  });
});
