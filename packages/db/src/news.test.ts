import { hashPassword } from '@buhuchet/adapters/password';
import { addDays, bishkekDate, newsShowMoment } from '@buhuchet/domain';
import { asc, eq, inArray, sql } from 'drizzle-orm';
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
import { news, newsAdminTexts, newsReads, platformAuditLog, users } from './schema';
import { NEWS_NOT_YET, newsAdminTextSeedRows, newsSeedRows, seedNews } from './seed/news';
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
    modules: [],
    adminMd: '',
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
    const feed = await asOwner(a, (tx) => newsFeed(tx, []));
    expect(feed.map((n) => n.id)).toEqual(['v1']);
    // Политика базы прячет и при прямом запросе.
    const raw = await asOwner(a, (tx) => tx.select({ id: news.id }).from(news));
    expect(raw.map((r) => r.id)).toEqual(['v1']);
    expect(await asOwner(a, (tx) => getNews(tx, 'draft1'))).toBeNull();
  });

  it('администратор платформы в своей ленте видит новости для Админки, но не черновики', async () => {
    const feed = await asAdmin((tx) => newsFeed(tx, null));
    expect(feed.map((n) => n.id).sort()).toEqual(['adm1', 'v1']);
  });

  it('новость, вышедшая до появления учётной записи, прочитана; новая — нет', async () => {
    const created = await asAdmin((tx) => createNews(tx, input(), { publish: true }));
    const feed = await asOwner(a, (tx) => newsFeed(tx, []));
    expect(feed.map((n) => [n.id, n.read])).toEqual([
      [created.id, false],
      ['v1', true],
    ]);
    expect(await asOwner(a, (tx) => newsUnreadCount(tx, []))).toBe(1);
    const wn = await asOwner(a, (tx) => newsWhatsNew(tx, []));
    expect(wn.items.map((n) => n.id)).toEqual([created.id]);
    expect(wn.first).toBe(true);

    // Кто видел приветствие организации, тому приветствие в окне не повторяется (решение Г-4 «А»).
    expect((await asOwner(b, (tx) => newsWhatsNew(tx, []))).first).toBe(true);
    await asOwner(b, (tx) => markWelcomeSeen(tx));
    expect(await asOwner(b, (tx) => newsWhatsNew(tx, []))).toMatchObject({
      items: [expect.objectContaining({ id: created.id })],
      first: false,
    });
    // Администратор платформы без организации: строки «Приветствия» у него нет, ответ — без ошибки.
    expect((await asAdmin((tx) => newsWhatsNew(tx, null))).first).toBe(true);

    // «Понятно»: показанные — прочитаны; окно больше не открывается.
    expect(await asOwner(a, (tx) => markNewsRead(tx, [created.id, 'draft1', 'future1'], []))).toBe(
      1,
    );
    expect(await asOwner(a, (tx) => markNewsRead(tx, [created.id], []))).toBe(0);
    expect(await asOwner(a, (tx) => newsUnreadCount(tx, []))).toBe(0);
    expect((await asOwner(a, (tx) => newsWhatsNew(tx, []))).items).toEqual([]);
    expect((await asOwner(a, (tx) => newsWhatsNew(tx, []))).first).toBe(false);

    // У другой организации своя прочитанность.
    expect(await asOwner(b, (tx) => newsUnreadCount(tx, []))).toBe(1);
    expect(await asOwner(b, (tx) => markNewsRead(tx, 'all', []))).toBe(1);
    expect(await asOwner(b, (tx) => newsUnreadCount(tx, []))).toBe(0);
  });

  it('в окне «Что нового» — только новости «Показывать при входе»', async () => {
    const quiet = await asAdmin((tx) =>
      createNews(tx, input({ title: 'Исправления', type: 'fix', showOnLogin: false }), {
        publish: true,
      }),
    );
    expect((await asOwner(a, (tx) => newsWhatsNew(tx, []))).items).toEqual([]);
    expect(await asOwner(a, (tx) => newsUnreadCount(tx, []))).toBe(1);
    await asOwner(a, (tx) => markNewsRead(tx, [quiet.id], []));
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
    expect((await asOwner(a, (tx) => newsFeed(tx, []))).some((n) => n.id === draft.id)).toBe(false);
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
    // Ссылка на видео прототипа (vd-intro) не переносится: видео в базу не заливаются (п. О-53).
    expect(rows.find((r) => r.id === 'v79')).toMatchObject({ linkKind: null, linkId: null });
    // Новости версий, которых в продукте ещё нет (БИК v107–v108, п. Т-14), не наполняются; v109,
    // v110 (вся работа v110 — в продукте, п. К-10), v111 (блок «Telegram-уведомления», п. Т-15), v112
    // («Файлы от контрагентов», п. И-7), v113 (Telegram заявителя и пароль по ссылке, п. Т-18), v114
    // (регистрация по документам, п. И-9), v115 («К оплате» по дням, файлы и чеки через бота, п. К-11),
    // v116 («Я оплатил», оплата по месяцам и код на странице контрагента, п. К-14), v117 (тексты
    // лендинга), v118 (проверка сообщений бота, п. Т-13), v119 (принятый чек в окне денег, п. К-14),
    // v120 (подсказки и обучение на странице контрагента, п. К-16) и v121 (чек принимается только
    // вместе с деньгами, п. К-18), v122–v124 (колокольчик, новости по модулям, один файл — несколько
    // ссылок; доработки 16.11.2026, этап 1, п. Т-20, И-11, К-19) и v125–v128 (новости только о своём,
    // окно просмотра файлов, колокольчик — то же, что присылает бот; доработки 16.11.2026, этап 2,
    // п. Т-21, И-12, К-20), v129 («Задачи» — только задачи, п. О-58) и v132 (Админка «Запуски» и
    // переписка бота, п. Т-22, Т-23; новость — администратору платформы, «Подробнее» — на «Запуски») — да.
    expect(rows.filter((r) => NEWS_NOT_YET.has(r.id))).toEqual([]);
    // Скрыты только БИК (v107, v108), отменённый лендинг (v133, v140, v143, п. И-13) и правки кода
    // самого прототипа по замечаниям CodeQL (v147, v148, п. О-84) и доработки 20.11.2026 до переноса
    // (v149 — ответы на вопросы ТЗ, v155 — «Витрина данных» в меню, этап 3; пакет 2 — v150–v154 и v156 —
    // перенесён сборкой этапа 2, п. О-97): версия, попавшая сюда по ошибке, пропала бы из «Новостей» молча.
    expect([...NEWS_NOT_YET].sort()).toEqual([
      'v107',
      'v108',
      'v133',
      'v140',
      'v143',
      'v147',
      'v148',
      'v149',
      'v155',
    ]);
    // v150 — без пункта о демонстрационных данных у всех организаций: в продукте у каждой свои (п. О-97).
    const v150 = rows.find((r) => r.id === 'v150')?.md ?? '';
    expect(v150).toContain('Окно «Отчёт» только для просмотра');
    expect(v150).not.toContain('Данные у всех организаций');
    expect(v150).not.toContain('демонстрационных контрагентов');
    for (const id of ['v151', 'v152', 'v153', 'v154', 'v156']) {
      expect(rows.map((r) => r.id)).toContain(id);
    }
    expect(rows.filter((r) => Number(r.release) >= 147 && Number(r.release) <= 148)).toEqual([]);
    // Пометка прототипа «Пока только в прототипе…» в продукт не попадает (п. О-83): новость v134 и
    // v136 выходит вместе с самой работой; остальной текст — как в прототипе. Так же — страница
    // контрагента простыми словами v135, карточка контрагента v137 и карточки вверху её окна v142
    // (поток К, п. К-21, К-22).
    for (const id of ['v134', 'v135', 'v136', 'v137', 'v142']) {
      const md = rows.find((r) => r.id === id)?.md ?? '';
      expect(md).toContain('## Изменено');
      expect(md).not.toContain('только в прототипе');
      expect(md.endsWith('\n')).toBe(false);
    }
    // То же — у всех перенесённых версий v131–v146 (потоки Т, К, И): строки нет ни в одной.
    const ported = rows.filter((r) => Number(r.release) >= 131 && Number(r.release) <= 146);
    expect(ported.map((r) => r.id).sort()).toEqual(
      [131, 132, 134, 135, 136, 137, 138, 139, 141, 142, 144, 145, 146].map((n) => `v${n}`),
    );
    for (const r of ported) expect(r.md, r.id).not.toContain('только в прототипе');
    expect(rows.find((r) => r.id === 'v132')).toMatchObject({
      release: '132',
      linkKind: 'mod',
      linkId: 'runs',
    });
    expect(rows.find((r) => r.id === 'v109')).toMatchObject({ release: '109', showOnLogin: true });
    expect(rows.find((r) => r.id === 'v110')).toMatchObject({ release: '110' });
    expect(rows.find((r) => r.id === 'v111')).toMatchObject({ release: '111', showOnLogin: true });
    expect(rows.find((r) => r.id === 'v112')).toMatchObject({ release: '112' });
    expect(rows.find((r) => r.id === 'v113')).toMatchObject({ release: '113' });
    expect(rows.find((r) => r.id === 'v114')).toMatchObject({ release: '114' });
    expect(rows.find((r) => r.id === 'v115')).toMatchObject({ release: '115', showOnLogin: true });
    // Ссылка «Подробнее» «Версии 116» — на модуль «Контрагенты» (прототип v120, п. К-15).
    expect(rows.find((r) => r.id === 'v116')).toMatchObject({
      release: '116',
      showOnLogin: true,
      linkKind: 'mod',
      linkId: 'cps',
    });
    expect(rows.find((r) => r.id === 'v117')).toMatchObject({ release: '117', showOnLogin: true });
    expect(rows.find((r) => r.id === 'v118')).toMatchObject({ release: '118' });
    expect(rows.find((r) => r.id === 'v119')).toMatchObject({ release: '119' });
    expect(rows.find((r) => r.id === 'v120')).toMatchObject({ release: '120' });
    expect(rows.find((r) => r.id === 'v121')).toMatchObject({
      release: '121',
      linkKind: 'mod',
      linkId: 'cps',
    });
    expect(rows.find((r) => r.id === 'v122')).toMatchObject({ release: '122', showOnLogin: true });
    expect(rows.find((r) => r.id === 'v123')).toMatchObject({ release: '123', modules: [] });
    expect(rows.find((r) => r.id === 'v124')).toMatchObject({
      release: '124',
      linkKind: 'mod',
      linkId: 'files',
      modules: ['files'],
    });
    expect(rows.find((r) => r.id === 'v125')).toMatchObject({
      release: '125',
      showOnLogin: true,
      linkKind: 'mod',
      linkId: 'kb',
      modules: [],
    });
    expect(rows.find((r) => r.id === 'v126')).toMatchObject({
      release: '126',
      linkKind: 'mod',
      linkId: 'files',
      modules: ['files'],
    });
    expect(rows.find((r) => r.id === 'v127')).toMatchObject({ release: '127', linkId: 'cps' });
    expect(rows.find((r) => r.id === 'v127')?.modules).toEqual(
      expect.arrayContaining(['cps', 'files']),
    );
    expect(rows.find((r) => r.id === 'v128')).toMatchObject({
      release: '128',
      showOnLogin: true,
      linkKind: null,
    });
    // «Задачи» — только задачи (доработки 17.11.2026, п. О-58): «Подробнее» — модуль «Задачи».
    expect(rows.find((r) => r.id === 'v129')).toMatchObject({
      release: '129',
      linkKind: 'mod',
      linkId: 'tasks',
    });
    // Текст «Для администратора платформы» (admMd) идёт только во второй текст, не в текст новости.
    const withAdm = (refDB.news as { id: string; admMd?: string }[]).filter((x) => x.admMd?.trim());
    expect(withAdm.map((x) => x.id)).toEqual(expect.arrayContaining(['v123', 'v124']));
    // Ни одна строка второго текста (кроме заголовков разделов и коротких подписей) не попала в текст
    // и короткое описание той же новости.
    const plain = (line: string) =>
      line
        .replace(/^[\s>*\-\d.]+/, '')
        .replace(/\*\*|`/g, '')
        .trim();
    for (const x of withAdm) {
      const row = rows.find((r) => r.id === x.id);
      expect(row?.md ?? '').not.toContain('## Для администратора платформы');
      const leaked = x
        .admMd!.split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .map(plain)
        .filter((line) => line.length >= 20)
        .filter((line) => (row?.md ?? '').includes(line) || (row?.short ?? '').includes(line));
      expect(leaked, x.id).toEqual([]);
    }
    // Второй текст v123 есть; подпись «Для администратора платформы» экран ставит сам (с прототипа v125
    // её нет и в тексте).
    expect(newsAdminTextSeedRows(refDB.news).find((t) => t.newsId === 'v123')?.md).toBeTruthy();
    const source = refDB.news as { id: string; status: string }[];
    // Черновики прототипа («Версия N+1: план») не наполняются.
    const drafts = source.filter((x) => x.status !== 'Опубликовано').map((x) => x.id);
    expect(drafts.length).toBeGreaterThan(0);
    expect(rows.filter((r) => drafts.includes(r.id))).toEqual([]);
    // «Версия 104: темы в чате с ботом» прототип убрал (п. Т-10).
    expect(rows.find((r) => r.id === 'v104')).toBeUndefined();
    // Новости о работе Админки — «Только режим Админка» (разбор новостей v125, доработки 16.11.2026,
    // блок 4, пункт 5): организации их не видят.
    expect(
      rows
        .filter((r) => r.audience === 'adm')
        .map((r) => r.id)
        .sort(),
    ).toEqual(
      [
        'v32',
        'v65',
        'v66',
        'v67',
        'v70',
        'v71',
        'v72',
        'v78',
        'v91',
        'v99',
        'v103',
        'v113',
        'v117',
        'v118',
        // «Запуски» и переписка бота — модули Админки (перенос v132).
        'v132',
        // Подписки в Админке: виды, цены и вкладка «Подписки» (пакет 2, сборка этапа 2, п. О-97).
        'v151',
        'v153',
      ].sort(),
    );
    const [{ n }] = (await db.admin.db.execute<{ n: number }>(
      sql`select count(*)::integer as n from news where id = 'v1'`,
    )) as unknown as [{ n: number }];
    expect(n).toBe(1);
  });

  it('лента и «Что нового» — строго по номеру версии, новые сверху: дата выхода порядок версий не меняет', async () => {
    const make = (release: string, daysBack: number) =>
      asAdmin((tx) =>
        createNews(
          tx,
          input({ title: `Версия ${release}`, release, date: addDays(yesterday, -daysBack) }),
          { publish: true },
        ),
      );
    const v9000 = await make('9000', 3);
    const v9001 = await make('9001', 5);
    const v8999 = await make('8999', 0);
    const mine = new Set([v9000.id, v9001.id, v8999.id]);
    const order = [v9001.id, v9000.id, v8999.id];
    const feed = await asOwner(a, (tx) => newsFeed(tx, []));
    // Версии с номером больше всех остальных — в самом верху ленты.
    expect(feed.slice(0, 3).map((n) => n.id)).toEqual(order);
    const wn = await asOwner(a, (tx) => newsWhatsNew(tx, []));
    expect(wn.items.filter((n) => mine.has(n.id)).map((n) => n.id)).toEqual(order);
  });

  it('модули новости (доработки 16.11.2026, блок 4, пункт 3): видна, если есть хотя бы один из них; счётчик и отметки — так же', async () => {
    const make = (title: string, modules: string[]) =>
      asAdmin((tx) => createNews(tx, input({ title, modules }), { publish: true }));
    const fee = await make('Про обслуживание', ['fee']);
    const both = await make('Про задачи и обслуживание', ['tasks', 'fee']);
    const ids = async (mine: string[] | null) =>
      (
        await (mine === null
          ? asAdmin((tx) => newsFeed(tx, null))
          : asOwner(b, (tx) => newsFeed(tx, mine)))
      ).map((n) => n.id);
    // Бухгалтер без права «Видеть плату за обслуживание» и без «Задач» — не видит ни одной.
    expect(await ids(['home', 'cps', 'reports'])).not.toEqual(expect.arrayContaining([fee.id]));
    expect(await ids(['home', 'cps', 'reports'])).not.toContain(both.id);
    // Хотя бы один модуль из отмеченных — видна.
    expect(await ids(['tasks'])).toContain(both.id);
    expect(await ids(['tasks'])).not.toContain(fee.id);
    expect(await ids(['fee'])).toEqual(expect.arrayContaining([fee.id, both.id]));
    // Администратору платформы — все.
    expect(await ids(null)).toEqual(expect.arrayContaining([fee.id, both.id]));
    // Невидимую по модулям не отметить прочитанной и в счётчике её нет.
    const unread = await asOwner(b, (tx) => newsUnreadCount(tx, ['cps']));
    expect(await asOwner(b, (tx) => newsUnreadCount(tx, ['fee']))).toBe(unread + 2);
    expect(await asOwner(b, (tx) => markNewsRead(tx, [fee.id, both.id], ['cps']))).toBe(0);
    expect(await asOwner(b, (tx) => markNewsRead(tx, 'all', ['tasks']))).toBeGreaterThanOrEqual(1);
    expect(await asOwner(b, (tx) => newsUnreadCount(tx, ['fee']))).toBe(1);
    expect((await asOwner(b, (tx) => newsWhatsNew(tx, ['fee']))).items.map((n) => n.id)).toEqual([
      fee.id,
    ]);
    // Код не по образцу база не примет (незнакомые коды и повторы отклоняет API — раньше).
    await expect(
      asAdmin((tx) =>
        tx
          .update(news)
          .set({ modules: ['fee', 'Fee!'] })
          .where(eq(news.id, fee.id)),
      ),
    ).rejects.toThrow();
  });

  it('второй текст «Для администратора платформы» (блок 4, пункт 1): читает и пишет только администратор платформы, правка поднимает версию новости', async () => {
    const md = '## Для администратора платформы\n- Миграция 0157';
    const n = await asAdmin((tx) =>
      createNews(tx, input({ title: 'Со вторым текстом', adminMd: md }), { publish: true }),
    );
    expect(n.adminMd).toBe(md);
    expect((await asAdmin((tx) => getNews(tx, n.id)))?.adminMd).toBe(md);
    const adminFeed = await asAdmin((tx) => newsFeed(tx, null));
    expect(adminFeed.find((x) => x.id === n.id)?.adminMd).toBe(md);
    // Пользователю организации текста нет ни в ленте, ни прямым запросом; записать он не может.
    const feed = await asOwner(a, (tx) => newsFeed(tx, []));
    expect(feed.find((x) => x.id === n.id)?.adminMd).toBe('');
    expect(await asOwner(a, (tx) => tx.select().from(newsAdminTexts))).toEqual([]);
    await expect(
      asOwner(a, (tx) => tx.insert(newsAdminTexts).values({ newsId: n.id, md: 'чужой' })),
    ).rejects.toThrow();
    // Список Админки: есть ли второй текст, без самого текста.
    const page = await asAdmin((tx) =>
      listNewsAdminPage(tx, { page: 1, size: 100, sort: undefined, filters: {} }, t),
    );
    expect(page.rows.find((r) => r.id === n.id)).toMatchObject({ hasAdminMd: true });
    // Правка: новый текст — та же строка, версия новости +1, история «было → стало».
    const edited = await asAdmin((tx) =>
      saveNews(tx, n.id, n.version, input({ title: n.title, adminMd: `${md}\n- ещё` }), {
        publish: false,
      }),
    );
    expect(edited).toMatchObject({ ok: true, record: { version: n.version + 1 } });
    const history = await db.admin.db
      .select({ changes: platformAuditLog.changes })
      .from(platformAuditLog)
      .where(eq(platformAuditLog.entityId, n.id));
    expect(JSON.stringify(history)).toContain('adminMd');
    // Пустой текст — строки нет.
    const cleared = await asAdmin((tx) =>
      saveNews(tx, n.id, n.version + 1, input({ title: n.title, adminMd: '' }), {
        publish: false,
      }),
    );
    expect(cleared).toMatchObject({ ok: true, record: { adminMd: '', version: n.version + 2 } });
    expect(
      await db.admin.db.select().from(newsAdminTexts).where(eq(newsAdminTexts.newsId, n.id)),
    ).toEqual([]);
  });

  it('наполнение: модули и второй текст из refDB.json', async () => {
    const refDB = (await readSpecJson('data/refDB.json')) as { news: unknown[] };
    const rows = newsSeedRows(refDB.news);
    expect(rows.every((r) => Array.isArray(r.modules))).toBe(true);
    const texts = newsAdminTextSeedRows([
      {
        id: 'x1',
        t: 'Версия 1',
        type: 'Обновление',
        date: '2026-11-16',
        status: 'Опубликовано',
        aud: 'all',
        mods: ['fee', 'cps'],
        admMd: '## Для администратора платформы\n- Подробности\n\n## Изменено\n- ',
      },
    ]);
    expect(texts).toEqual([{ newsId: 'x1', md: '## Для администратора платформы\n- Подробности' }]);
    expect(
      newsSeedRows([
        {
          id: 'x1',
          t: 'Версия 1',
          type: 'Обновление',
          date: '2026-11-16',
          status: 'Опубликовано',
          aud: 'all',
          mods: ['fee', 'cps'],
        },
      ])[0]?.modules,
    ).toEqual(['cps', 'fee']);
    expect(() =>
      newsSeedRows([
        {
          id: 'x2',
          t: 'Версия 2',
          type: 'Обновление',
          date: '2026-11-16',
          status: 'Опубликовано',
          aud: 'all',
          mods: ['nope'],
        },
      ]),
    ).toThrow(/x2/);
    // «Для кого» — только «all» или «adm»: опечатка или пропуск останавливают наполнение, а не открывают
    // новость всем.
    const aud = (value: unknown) => () =>
      newsSeedRows([
        {
          id: 'x3',
          t: 'Версия 3',
          type: 'Обновление',
          date: '2026-11-16',
          status: 'Опубликовано',
          ...(value === undefined ? {} : { aud: value }),
        },
      ]);
    expect(aud('adn')).toThrow();
    expect(aud(undefined)).toThrow();
    expect(aud(null)).toThrow();
    expect(aud('adm')()[0]?.audience).toBe('adm');
  });

  it('наполнение с --update меняет «Для кого», модули и второй текст: разбор выпущенных новостей (доработки 16.11.2026, блок 4, пункт 5); поправленную администратором — нет', async () => {
    type Extra = { aud: 'all' | 'adm'; mods?: string[]; admMd?: string };
    const item = (id: string, x: Extra) => ({
      id,
      t: `Версия ${id}`,
      type: 'Обновление',
      ver: id,
      date: '2026-11-16',
      status: 'Опубликовано',
      short: 'Коротко',
      md: '- Текст',
      ...x,
    });
    const ids = ['x9301', 'x9302', 'x9303'];
    const before = [
      item('x9301', { aud: 'all' }),
      item('x9302', { aud: 'all' }),
      item('x9303', { aud: 'adm', admMd: '- Старый текст' }),
    ];
    // Разбор: x9301 — в Админку, модуль и второй текст; x9302 правил администратор; x9303 — всем, без
    // второго текста.
    const after = [
      item('x9301', { aud: 'adm', mods: ['fee'], admMd: '- Новый текст' }),
      item('x9302', { aud: 'adm', mods: ['fee'], admMd: '- Новый текст' }),
      item('x9303', { aud: 'all' }),
    ];
    try {
      await seedNews(db.admin.db, before, { update: false });
      await db.admin.db.update(news).set({ updatedBy: adminId }).where(eq(news.id, 'x9302'));
      const state = async () => {
        const rows = await db.admin.db
          .select({ id: news.id, audience: news.audience, modules: news.modules, v: news.version })
          .from(news)
          .where(inArray(news.id, ids))
          .orderBy(asc(news.id));
        const texts = await db.admin.db
          .select({ id: newsAdminTexts.newsId, md: newsAdminTexts.md })
          .from(newsAdminTexts)
          .where(inArray(newsAdminTexts.newsId, ids));
        const md = new Map(texts.map((x) => [x.id, x.md]));
        return Object.fromEntries(
          rows.map((r) => [r.id, [r.audience, r.modules, md.get(r.id) ?? null, r.v]]),
        );
      };
      // Без --update у залитых новостей не меняются «Для кого», модули и имеющийся второй текст —
      // добавляется только недостающий второй текст (не у новости, которую правил администратор).
      await seedNews(db.admin.db, after, { update: false });
      const start = await state();
      expect(Object.fromEntries(Object.entries(start).map(([k, x]) => [k, x.slice(0, 3)]))).toEqual(
        {
          x9301: ['all', [], '- Новый текст'],
          x9302: ['all', [], null],
          x9303: ['adm', [], '- Старый текст'],
        },
      );
      const report = await seedNews(db.admin.db, after, { update: true });
      const v = (id: string) => start[id]![3] as number;
      expect(await state()).toEqual({
        // «Для кого», модуль и второй текст — новые; версия поднялась (окно правки получит 409).
        x9301: ['adm', ['fee'], '- Новый текст', expect.any(Number)],
        // Правил администратор — ничего не меняется.
        x9302: ['all', [], null, v('x9302')],
        // «Для всех», второго текста больше нет.
        x9303: ['all', [], null, expect.any(Number)],
      });
      const now = await state();
      expect(now.x9301![3]).toBeGreaterThan(v('x9301'));
      expect(now.x9303![3]).toBeGreaterThan(v('x9303'));
      expect(report).toMatchObject({ inserted: 0, updated: 2 });
      // Сотруднику организации «Только режим Админка» после выпуска не видна, ставшая «для всех» — видна.
      expect(await asOwner(a, (tx) => getNews(tx, 'x9301'))).toBeNull();
      expect((await asOwner(a, (tx) => getNews(tx, 'x9303')))?.id).toBe('x9303');
      // Повтор ничего не меняет.
      expect(await seedNews(db.admin.db, after, { update: true })).toMatchObject({
        inserted: 0,
        updated: 0,
      });
      expect(await state()).toEqual(now);
    } finally {
      await db.admin.db.delete(newsAdminTexts).where(inArray(newsAdminTexts.newsId, ids));
      await db.admin.db.delete(news).where(inArray(news.id, ids));
    }
  });
});
