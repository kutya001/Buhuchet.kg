import { randomUUID } from 'node:crypto';
import { BELL_FROM, BELL_PAGE_SIZE, PERMISSION_IDS } from '@buhuchet/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { adminTelegramBroadcast } from './admin-telegram';
import { notifyAccountLocked, withUserContext } from './auth';
import { withOrgContext } from './context';
import { createContractor, type ContractorFields } from './contractors';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  bellNotifications,
  contractors,
  employees,
  news,
  newsReads,
  organizations,
  platformLeads,
  users,
} from './schema';
import { createEmployee } from './staff';
import {
  bellCleanup,
  bellPage,
  bellRead,
  bellReadAll,
  bellSeenAll,
  bellSyncLeads,
  bellSyncNews,
  bellOwnerUsers,
  bellUnseen,
  bellUnseenCounts,
  contractorBellStaff,
  insertBellRows,
  type BellRowInput,
  type BellSight,
} from './telegram-bell';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

/*
 * Колокольчик (доработки 16.11.2026, блок 3, этап 1; поток Т): запись строк, что видно по правам сейчас,
 * страница, просмотрено и прочитано, новости и заявки при чтении, уборка, «Вход заблокирован» и
 * рассылка платформы (миграция этапа 1). Таблицу, RLS и права роли приложения проверяет тест этапа 0
 * (`package-1611.test.ts`).
 */

const contractor = (inn: string, name: string, responsible: string | null): ContractorFields => ({
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
  responsibleEmployeeId: responsible,
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

/** Всё видно: все права, все контрагенты и записи, все функции. */
const ALL: BellSight = {
  permissions: PERMISSION_IDS,
  contractors: undefined,
  reports: undefined,
  tasks: undefined,
  cpSent: true,
  files: undefined,
  cpFee: true,
  staff: true,
  news: null,
};

describe.skipIf(!databaseAvailable())('Колокольчик: строки, права, новости, уборка', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let acc = { employeeId: '', userId: '' };
  let cpA = '';
  let cpArchived = '';
  let adminId = '';
  const NOW = new Date('2026-11-20T04:00:00Z');
  type Fn<T> = Parameters<typeof withOrgContext<T>>[2];
  const inA = <T>(userId: string | null, fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId }, fn);
  const inB = <T>(fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);
  const asAdmin = <T>(fn: Parameters<typeof withUserContext<T>>[2]) =>
    withUserContext(db.app.db, adminId, fn);

  const row = (userId: string, over: Partial<BellRowInput> = {}): BellRowInput => ({
    userId,
    kind: 'files',
    event: 'cp_file',
    targetKind: 'cp_sent',
    targetId: cpA,
    contractorId: cpA,
    need: null,
    text: 'Новый файл от контрагента',
    eventKey: `cp_file:${randomUUID()}`,
    ...over,
  });
  /** Ключи строк, которые вошедший видит при этих правах. */
  const keys = async (userId: string, sight: BellSight = ALL) => {
    const page = await inA(userId, (tx) => bellPage(tx, sight, { tab: 'all' }));
    const ids = page.items.map((i) => i.id);
    if (!ids.length) return [];
    const rows = await db.admin.db
      .select({ id: bellNotifications.id, key: bellNotifications.eventKey })
      .from(bellNotifications)
      .where(sql`${bellNotifications.id} in ${ids}`);
    return rows.map((r) => r.key).sort();
  };
  const clear = () => db.admin.db.delete(bellNotifications);
  /** Свои новости теста снять с публикации в его конце, и при падении: соседним тестам они не нужны. */
  const dropNewsAfter = (ids: readonly string[]) =>
    onTestFinished(async () => {
      await db.admin.db
        .update(news)
        .set({ off: true })
        .where(sql`${news.id} in ${[...ids]}`);
    });

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    await seedAllPlatformDictionaries(db.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец', login, passwordHash: 'x' });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'bell-a',
      owner: owner('bell-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'bell-b',
      owner: owner('bell-owner-b'),
    });
    const role = a.roles.find((r) => r.templateCode === 'acc')!;
    acc = await inA(a.ownerUserId, async (tx) => {
      const employeeId = await createEmployee(tx, {
        fullName: 'Токтогулов Алишер Бакытович',
        shortName: 'Алишер Т.',
        login: 'bell-acc',
        passwordHash: 'x',
        phone: null,
        role,
      });
      const [e] = await tx
        .select({ userId: employees.userId })
        .from(employees)
        .where(eq(employees.id, employeeId));
      return { employeeId, userId: e!.userId };
    });
    cpA = await inA(a.ownerUserId, (tx) =>
      createContractor(tx, a.orgId, contractor('03807819461915', 'ОсОО «А»', acc.employeeId), null),
    );
    cpArchived = await inA(a.ownerUserId, (tx) =>
      createContractor(tx, a.orgId, contractor('03807819461916', 'ОсОО «Архив»', null), null),
    );
    await db.admin.db
      .update(contractors)
      .set({ serviceStatus: 'archived' })
      .where(eq(contractors.id, cpArchived));
    const [admin] = await db.admin.db
      .insert(users)
      .values({
        login: 'bell-platform',
        passwordHash: 'x',
        isPlatformAdmin: true,
        // Старше новостей тестов: вышедшие раньше создания учётной записи считаются прочитанными (№ 57).
        createdAt: new Date('2026-11-01T00:00:00Z'),
      })
      .returning({ id: users.id });
    adminId = admin!.id;
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('строку кладут другому сотруднику своей организации; повтор того же события — ничего; видит только получатель', async () => {
    await clear();
    const r = row(acc.userId);
    expect(await inA(a.ownerUserId, (tx) => insertBellRows(tx, [r], NOW))).toBe(1);
    expect(await inA(a.ownerUserId, (tx) => insertBellRows(tx, [r], NOW))).toBe(0);
    // Задача по расписанию (без пользователя) тоже кладёт — и тоже без повтора.
    expect(await inA(null, (tx) => insertBellRows(tx, [r, row(acc.userId)], NOW))).toBe(1);
    expect(await keys(acc.userId)).toHaveLength(2);
    expect(await keys(a.ownerUserId)).toEqual([]);
    expect(await inB((tx) => bellPage(tx, ALL, { tab: 'all' }))).toEqual({
      items: [],
      more: false,
    });
    const [item] = (await inA(acc.userId, (tx) => bellPage(tx, ALL, { tab: 'files' }))).items;
    expect(item).toMatchObject({
      kind: 'files',
      event: 'cp_file',
      contractorId: cpA,
      contractorName: 'ОсОО «А»',
      text: 'Новый файл от контрагента',
      read: false,
      targetKind: 'cp_sent',
      targetId: cpA,
    });
    expect(item!.at).toEqual(NOW);
  });

  it('действие откатилось — строки нет (строку кладёт транзакция действия)', async () => {
    await clear();
    await expect(
      inA(a.ownerUserId, async (tx) => {
        await insertBellRows(tx, [row(acc.userId)], NOW);
        throw new Error('действие не удалось');
      }),
    ).rejects.toThrow('действие не удалось');
    expect(await keys(acc.userId)).toEqual([]);
  });

  it('сотруднику чужой организации строку не положить', async () => {
    await expect(
      inA(a.ownerUserId, (tx) => insertBellRows(tx, [row(b.ownerUserId)], NOW)),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: '23503' }) });
  });

  it('видно только то, что человек видит по правам сейчас: право, архив, область, функции', async () => {
    await clear();
    const put = (over: Partial<BellRowInput>) =>
      inA(null, (tx) => insertBellRows(tx, [row(acc.userId, over)], NOW));
    await put({ eventKey: 'plain' });
    await put({ eventKey: 'fee', need: 'fee', targetKind: 'cp_fee', event: 'fee_paid' });
    await put({ eventKey: 'archived', contractorId: cpArchived, targetId: cpArchived });
    await put({
      eventKey: 'employee',
      targetKind: 'employee',
      targetId: acc.employeeId,
      contractorId: null,
    });
    await put({
      eventKey: 'tasks_tab',
      targetKind: 'tasks_tab',
      targetId: 'mine',
      contractorId: null,
    });
    await put({
      eventKey: 'report',
      targetKind: 'report',
      targetId: randomUUID(),
      contractorId: null,
    });
    await put({ eventKey: 'lead', targetKind: 'lead', targetId: randomUUID(), contractorId: null });
    expect(await keys(acc.userId)).toEqual(['employee', 'fee', 'plain', 'tasks_tab']);
    // Сняли право «Видеть плату за обслуживание» — строки об оплате обслуживания нет; вернули — есть.
    const noFee = { ...ALL, permissions: PERMISSION_IDS.filter((p) => p !== 'fee') };
    expect(await keys(acc.userId, noFee)).toEqual(['employee', 'plain', 'tasks_tab']);
    // Контрагент вне области («Свои»): строк о нём нет.
    expect(await keys(acc.userId, { ...ALL, contractors: sql`false` })).toEqual([
      'employee',
      'tasks_tab',
    ]);
    // Контрагент вне области «Файлового менеджера» — «Отправленные файлы» о нём не открыть, строки нет.
    expect(await keys(acc.userId, { ...ALL, files: sql`false` })).toEqual([
      'employee',
      'fee',
      'tasks_tab',
    ]);
    // Функции и права экранов: «Отправленные файлы», «Обслуживание», карточка сотрудника, «Задачи».
    expect(
      await keys(acc.userId, { ...ALL, cpSent: false, cpFee: false, staff: false, tasks: null }),
    ).toEqual([]);
    // Счётчик считает так же.
    expect(await inA(acc.userId, (tx) => bellUnseen(tx, ALL))).toBe(4);
    expect(await inA(acc.userId, (tx) => bellUnseen(tx, noFee))).toBe(3);
  });

  it('страница — по 30 от новых к старым, «Показать ещё» — с последней показанной, вкладки', async () => {
    await clear();
    const rows = Array.from({ length: BELL_PAGE_SIZE + 1 }, (_, i) =>
      row(acc.userId, { eventKey: `k${i}`, kind: i === 0 ? 'money' : 'files' }),
    );
    for (const [i, r] of rows.entries()) {
      await inA(null, (tx) => insertBellRows(tx, [r], new Date(NOW.getTime() + i * 1000)));
    }
    const first = await inA(acc.userId, (tx) => bellPage(tx, ALL, { tab: 'all' }));
    expect(first.items).toHaveLength(BELL_PAGE_SIZE);
    expect(first.more).toBe(true);
    const times = first.items.map((x) => x.at.getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    const rest = await inA(acc.userId, (tx) =>
      bellPage(tx, ALL, { tab: 'all', before: first.items.at(-1)!.id }),
    );
    expect(rest.items.map((x) => x.kind)).toEqual(['money']);
    expect(rest.more).toBe(false);
    const money = await inA(acc.userId, (tx) => bellPage(tx, ALL, { tab: 'money' }));
    expect(money.items).toHaveLength(1);
    // Чужой или неверный номер «before» не открывает чужих строк и не ломает запрос.
    const bad = await inA(acc.userId, (tx) => bellPage(tx, ALL, { tab: 'all', before: 'x' }));
    expect(bad.items).toHaveLength(BELL_PAGE_SIZE);
  });

  it('открыл панель — просмотрено; нажал строку — прочитана; чужую строку не прочитать; «Прочитать все»', async () => {
    await clear();
    await inA(null, (tx) =>
      insertBellRows(
        tx,
        [
          row(acc.userId, { eventKey: 'one' }),
          row(acc.userId, { eventKey: 'two' }),
          row(a.ownerUserId, { eventKey: 'owner' }),
        ],
        NOW,
      ),
    );
    expect(await inA(acc.userId, (tx) => bellSeenAll(tx, NOW))).toBe(2);
    expect(await inA(acc.userId, (tx) => bellUnseen(tx, ALL))).toBe(0);
    expect(await inA(a.ownerUserId, (tx) => bellUnseen(tx, ALL))).toBe(1);
    const [one] = await db.admin.db
      .select({ id: bellNotifications.id })
      .from(bellNotifications)
      .where(eq(bellNotifications.eventKey, 'one'));
    expect(await inA(a.ownerUserId, (tx) => bellRead(tx, one!.id, NOW))).toBeNull();
    expect(await inA(acc.userId, (tx) => bellRead(tx, one!.id, NOW))).toEqual({ newsId: null });
    // Двойное нажатие — одна отметка, время первого нажатия.
    const later = new Date(NOW.getTime() + 60_000);
    await inA(acc.userId, (tx) => bellRead(tx, one!.id, later));
    const [mark] = await db.admin.db
      .select({ readAt: bellNotifications.readAt })
      .from(bellNotifications)
      .where(eq(bellNotifications.id, one!.id));
    expect(mark!.readAt).toEqual(NOW);
    expect(await inA(acc.userId, (tx) => bellRead(tx, 'not-an-id', NOW))).toBeNull();
    expect(await inA(acc.userId, (tx) => bellReadAll(tx, NOW))).toEqual([]);
    const page = await inA(acc.userId, (tx) => bellPage(tx, ALL, { tab: 'all' }));
    expect(page.items.every((x) => x.read)).toBe(true);
    // Строка владельца не тронута.
    expect(
      (await inA(a.ownerUserId, (tx) => bellPage(tx, ALL, { tab: 'all' }))).items[0]!.read,
    ).toBe(false);
  });

  it('новости — у каждого, кто их видит, с появления колокольчика; прочитанная в «Новостях» прочитана и здесь', async () => {
    await clear();
    // Учётная запись старше новостей: иначе вышедшие раньше её создания считаются прочитанными.
    await db.admin.db
      .update(users)
      .set({ createdAt: new Date('2026-11-01T00:00:00Z') })
      .where(eq(users.id, acc.userId));
    const base = { type: 'feature', short: 'Коротко', md: 'Текст', status: 'published' as const };
    await db.admin.db.insert(news).values([
      { ...base, id: 'bell-n1', title: 'Новая функция', publishDate: BELL_FROM, publishedAt: NOW },
      {
        ...base,
        id: 'bell-n0',
        title: 'Старая новость',
        publishDate: '2026-11-10',
        publishedAt: new Date('2026-11-10T03:00:00Z'),
      },
      {
        ...base,
        id: 'bell-adm',
        title: 'Только Админка',
        publishDate: BELL_FROM,
        publishedAt: NOW,
        audience: 'adm',
      },
      { ...base, id: 'bell-draft', title: 'Черновик', publishDate: BELL_FROM, status: 'draft' },
    ]);
    dropNewsAfter(['bell-n1', 'bell-n0', 'bell-adm', 'bell-draft']);
    const sync = () => inA(acc.userId, (tx) => bellSyncNews(tx, NOW, null));
    await sync();
    await sync();
    const page = await inA(acc.userId, (tx) => bellPage(tx, ALL, { tab: 'news' }));
    expect(page.items.map((x) => [x.targetId, x.text, x.read])).toEqual([
      ['bell-n1', 'Новая функция', false],
    ]);
    // (прототип v138) Во «Все» новостей версий нет, в красное число они не входят — считаются отдельно.
    expect((await inA(acc.userId, (tx) => bellPage(tx, ALL, { tab: 'all' }))).items).toEqual([]);
    expect(await inA(acc.userId, (tx) => bellUnseenCounts(tx, ALL))).toEqual({
      unseen: 0,
      news: 1,
    });
    // Время строки — появление новости: 09:00 по Бишкеку дня публикации.
    expect(page.items[0]!.at).toEqual(new Date(`${BELL_FROM}T03:00:00Z`));
    // Прочитал в «Новостях» — строка прочитана при следующем чтении.
    await inA(acc.userId, (tx) =>
      tx.insert(newsReads).values({ userId: acc.userId, newsId: 'bell-n1' }),
    );
    await sync();
    const after = await inA(acc.userId, (tx) => bellPage(tx, ALL, { tab: 'news' }));
    expect(after.items[0]!.read).toBe(true);
    // Нажатие строки новости отдаёт её номер — отметить и в «Новостях».
    expect(await inA(acc.userId, (tx) => bellRead(tx, after.items[0]!.id, NOW))).toEqual({
      newsId: 'bell-n1',
    });
    // Разбор новостей перевёл новость в «Только режим Админка» (`db:seed --update`, доработки 16.11.2026,
    // блок 4, пункт 5) — лежавшую строку не видно (счётчик идёт тем же условием `seen`); вернули «Для
    // всех» — видна снова.
    await db.admin.db.update(news).set({ audience: 'adm' }).where(eq(news.id, 'bell-n1'));
    expect((await inA(acc.userId, (tx) => bellPage(tx, ALL, { tab: 'news' }))).items).toEqual([]);
    await db.admin.db.update(news).set({ audience: 'all' }).where(eq(news.id, 'bell-n1'));
    expect((await inA(acc.userId, (tx) => bellPage(tx, ALL, { tab: 'news' }))).items).toHaveLength(
      1,
    );
    // Сняли с публикации — строки не видно.
    await db.admin.db.update(news).set({ off: true }).where(eq(news.id, 'bell-n1'));
    expect((await inA(acc.userId, (tx) => bellPage(tx, ALL, { tab: 'news' }))).items).toEqual([]);
    // «Только режим Админка» — администратору платформы.
    await asAdmin((tx) => bellSyncNews(tx, NOW, null));
    const adm = await asAdmin((tx) => bellPage(tx, ALL, { tab: 'news' }));
    expect(adm.items.map((x) => x.targetId)).toEqual(['bell-adm']);
  });

  it('новости с модулями — только тем, у кого есть хотя бы один из них (доработки 16.11, блок 4, пункт 3)', async () => {
    await clear();
    await db.admin.db
      .update(users)
      .set({ createdAt: new Date('2026-11-01T00:00:00Z') })
      .where(eq(users.id, acc.userId));
    const base = { type: 'feature', short: 'Коротко', md: 'Текст', status: 'published' as const };
    await db.admin.db.insert(news).values(
      [
        { ...base, id: 'bell-m-fee', title: 'Про обслуживание', modules: ['fee'] },
        { ...base, id: 'bell-m-two', title: 'Про задачи и отчёты', modules: ['tasks', 'reports'] },
        { ...base, id: 'bell-m-all', title: 'Для всех', modules: [] },
      ].map((n) => ({ ...n, publishDate: BELL_FROM, publishedAt: NOW })),
    );
    dropNewsAfter(['bell-m-fee', 'bell-m-two', 'bell-m-all']);
    const ids = async (mine: readonly string[] | null) => {
      await inA(acc.userId, (tx) => bellSyncNews(tx, NOW, mine));
      const page = await inA(acc.userId, (tx) =>
        bellPage(tx, { ...ALL, news: mine }, { tab: 'news' }),
      );
      return page.items.map((x) => x.targetId).sort();
    };
    // Бухгалтер без «Платы за обслуживание»: новости про неё нет ни в строках, ни в базе.
    expect(await ids(['home', 'reports'])).toEqual(['bell-m-all', 'bell-m-two']);
    const kept = await db.admin.db
      .select({ k: bellNotifications.eventKey })
      .from(bellNotifications)
      .where(eq(bellNotifications.eventKey, 'news:bell-m-fee'));
    expect(kept).toEqual([]);
    // Получил право — новость появляется при следующем чтении; потерял модуль — строки не видно.
    expect(await ids(['home', 'fee'])).toEqual(['bell-m-all', 'bell-m-fee']);
    expect(await ids(null)).toEqual(['bell-m-all', 'bell-m-fee', 'bell-m-two']);
  });

  it('заявки с лендинга — только администратору платформы: новые и поданные с появления колокольчика', async () => {
    await clear();
    const lead = (firm: string, over: Partial<typeof platformLeads.$inferInsert> = {}) => ({
      name: 'Заявитель',
      firm,
      phone: '+996555000000',
      size: '1-10',
      ...over,
    });
    // Время подачи — от «сейчас» теста, а не от часов базы: правило получает время параметром (№ 57).
    const recent = new Date(NOW.getTime() - 86_400_000);
    const own = await db.admin.db
      .insert(platformLeads)
      .values([
        lead('ОсОО «Новая»', { createdAt: recent }),
        lead('ОсОО «Старая»', { createdAt: new Date('2026-11-10T04:00:00Z') }),
        lead('ОсОО «Подключена»', { status: 'connected', createdAt: recent }),
      ])
      .returning({ id: platformLeads.id });
    try {
      const template = 'Новая заявка с сайта: {name}';
      await asAdmin((tx) => bellSyncLeads(tx, template, NOW));
      await asAdmin((tx) => bellSyncLeads(tx, template, NOW));
      const page = await asAdmin((tx) => bellPage(tx, ALL, { tab: 'all' }));
      expect(page.items.map((x) => [x.kind, x.text, x.targetKind])).toEqual([
        ['other', 'Новая заявка с сайта: ОсОО «Новая»', 'lead'],
      ]);
      // Сотрудник организации заявок не кладёт и не видит.
      await expect(
        inA(acc.userId, (tx) => bellSyncLeads(tx, template, NOW)),
      ).resolves.toBeUndefined();
      expect(await keys(acc.userId)).toEqual([]);
      // Страница строку заявки сотруднику и так прячет — «не кладёт» сверяем по таблице.
      const staffLeads = await db.admin.db
        .select({ k: bellNotifications.eventKey })
        .from(bellNotifications)
        .where(
          sql`${bellNotifications.event} = 'lead' and ${bellNotifications.userId} <> ${adminId}`,
        );
      expect(staffLeads).toEqual([]);
    } finally {
      // Свои заявки убираем и при падении: следующим тестам файла они не нужны.
      await db.admin.db
        .delete(platformLeads)
        .where(sql`${platformLeads.id} in ${own.map((x) => x.id)}`);
    }
  });

  it('новости и заявки старше срока хранения не кладутся: убранная уборкой строка не возвращается', async () => {
    await clear();
    await db.admin.db.insert(news).values({
      id: 'bell-keep',
      type: 'feature',
      title: 'Новость колокольчика',
      short: 'Коротко',
      md: 'Текст',
      status: 'published',
      publishDate: BELL_FROM,
      publishedAt: NOW,
    });
    const [old] = await db.admin.db
      .insert(platformLeads)
      .values({
        name: 'Заявитель',
        firm: 'ОсОО «Давняя»',
        phone: '+996555000001',
        size: '1-10',
        createdAt: new Date(`${BELL_FROM}T06:00:00Z`),
      })
      .returning({ id: platformLeads.id });
    // Только свои строки: новость и заявка этого теста (№ 2).
    const ownKeys = ['news:bell-keep', `lead:${old!.id}`];
    const put = async () => {
      const rows = await db.admin.db
        .select({ k: bellNotifications.eventKey, u: bellNotifications.userId })
        .from(bellNotifications)
        .where(sql`${bellNotifications.eventKey} in ${ownKeys}`);
      const who = (u: string) => (u === adminId ? 'admin' : u === acc.userId ? 'acc' : u);
      return rows.map((r) => `${who(r.u)} ${r.k}`).sort();
    };
    try {
      // Через 91 день после появления новости и заявки.
      const later = new Date(new Date(`${BELL_FROM}T03:00:00Z`).getTime() + 91 * 86_400_000);
      await inA(acc.userId, (tx) => bellSyncNews(tx, later, null));
      await asAdmin((tx) => bellSyncNews(tx, later, null));
      await asAdmin((tx) => bellSyncLeads(tx, 'Заявка: {name}', later));
      expect(await put()).toEqual([]);
      // В пределах срока — кладутся: новость сотруднику, заявка администратору платформы.
      await inA(acc.userId, (tx) => bellSyncNews(tx, NOW, null));
      await asAdmin((tx) => bellSyncLeads(tx, 'Заявка: {name}', NOW));
      expect(await put()).toEqual(['acc news:bell-keep', `admin lead:${old!.id}`]);
    } finally {
      await db.admin.db.delete(platformLeads).where(eq(platformLeads.id, old!.id));
      await db.admin.db.update(news).set({ off: true }).where(eq(news.id, 'bell-keep'));
    }
  });

  it('уборка: строки старше 90 дней — только своей организации или только администраторов', async () => {
    await clear();
    await inA(null, (tx) => insertBellRows(tx, [row(acc.userId, { eventKey: 'old' })], NOW));
    await inA(null, (tx) => insertBellRows(tx, [row(acc.userId, { eventKey: 'new' })], NOW));
    await withOrgContext(db.app.db, { orgId: b.orgId, userId: null }, (tx) =>
      insertBellRows(tx, [row(b.ownerUserId, { eventKey: 'old-b', contractorId: null })], NOW),
    );
    // Уборка сверяет с часами базы (`now()`): сроки строк — от настоящих часов (№ 52).
    await db.admin.db
      .update(bellNotifications)
      .set({ createdAt: new Date(Date.now() - 91 * 86_400_000) })
      .where(sql`${bellNotifications.eventKey} in ('old', 'old-b')`);
    await db.admin.db
      .update(bellNotifications)
      .set({ createdAt: new Date() })
      .where(eq(bellNotifications.eventKey, 'new'));
    expect(await inA(null, (tx) => bellCleanup(tx))).toBe(1);
    const left = await db.admin.db
      .select({ k: bellNotifications.eventKey })
      .from(bellNotifications)
      .orderBy(bellNotifications.eventKey);
    expect(left.map((r) => r.k)).toEqual(['new', 'old-b']);
  });

  it('кому о событии контрагента: ответственный и владельцы по порядку', async () => {
    expect(await inA(null, (tx) => contractorBellStaff(tx, cpA))).toEqual({
      responsibleId: acc.employeeId,
      ownerIds: [a.ownerEmployeeId],
    });
    expect(await inA(null, (tx) => contractorBellStaff(tx, randomUUID()))).toBeNull();
  });

  describe('миграция этапа 1: «Вход заблокирован» и рассылка платформы', () => {
    const bellOf = (userId: string) =>
      db.admin.db
        .select({
          orgId: bellNotifications.orgId,
          event: bellNotifications.event,
          text: bellNotifications.text,
          targetKind: bellNotifications.targetKind,
          targetId: bellNotifications.targetId,
          key: bellNotifications.eventKey,
        })
        .from(bellNotifications)
        .where(eq(bellNotifications.userId, userId));
    const lock = (userId: string) =>
      db.admin.db.update(users).set({ loginLockedAt: NOW }).where(eq(users.id, userId));
    const texts = {
      bellText: 'Вход заблокирован: 10 неверных паролей подряд',
      bellStaffText: 'Вход сотрудника {name} заблокирован: 10 неверных паролей подряд',
    };

    it('сотрудник: строка ему и владельцу (откроет карточку сотрудника) — и без бота, и без Telegram', async () => {
      await clear();
      await lock(acc.userId);
      await notifyAccountLocked(db.app.db, {
        userId: acc.userId,
        userText: null,
        unlockerText: null,
        ...texts,
        now: NOW,
      });
      const [own] = await bellOf(acc.userId);
      expect(own).toMatchObject({
        orgId: a.orgId,
        event: 'login_locked',
        text: texts.bellText,
        targetKind: null,
      });
      expect(await bellOf(a.ownerUserId)).toEqual([
        {
          orgId: a.orgId,
          event: 'login_locked',
          text: 'Вход сотрудника Алишер Т. заблокирован: 10 неверных паролей подряд',
          targetKind: 'employee',
          targetId: acc.employeeId,
          key: own!.key,
        },
      ]);
      // Владельцу другой организации — ничего.
      expect(await bellOf(b.ownerUserId)).toEqual([]);
      // Следующая блокировка — новые строки (ключ — по записи истории).
      await notifyAccountLocked(db.app.db, {
        userId: acc.userId,
        userText: null,
        unlockerText: null,
        ...texts,
        now: NOW,
      });
      expect(await bellOf(acc.userId)).toHaveLength(2);
      await db.admin.db.update(users).set({ loginLockedAt: null }).where(eq(users.id, acc.userId));
    });

    it('владелец: строка только ему; не закрытый вход — ничего', async () => {
      await clear();
      await notifyAccountLocked(db.app.db, {
        userId: a.ownerUserId,
        userText: null,
        unlockerText: null,
        ...texts,
        now: NOW,
      });
      expect(await bellOf(a.ownerUserId)).toEqual([]);
      await lock(a.ownerUserId);
      await notifyAccountLocked(db.app.db, {
        userId: a.ownerUserId,
        userText: null,
        unlockerText: null,
        ...texts,
        now: NOW,
      });
      expect((await bellOf(a.ownerUserId)).map((r) => r.text)).toEqual([texts.bellText]);
      expect(await db.admin.db.$count(bellNotifications)).toBe(1);
      await db.admin.db
        .update(users)
        .set({ loginLockedAt: null })
        .where(eq(users.id, a.ownerUserId));
    });

    it('рассылка: строка каждому действующему сотруднику действующих организаций, и без Telegram; одной организации — только ей', async () => {
      await clear();
      const cast = (orgId: string | null, bellText: string) =>
        asAdmin((tx) => adminTelegramBroadcast(tx, { orgId, text: 'Текст', now: NOW, bellText }));
      expect(await cast(null, 'Сообщение платформы: Обновление')).toBe(0);
      const all = await db.admin.db
        .select({
          user: bellNotifications.userId,
          org: bellNotifications.orgId,
          key: bellNotifications.eventKey,
        })
        .from(bellNotifications);
      expect(all.map((r) => r.user).sort()).toEqual(
        [a.ownerUserId, acc.userId, b.ownerUserId].sort(),
      );
      expect(new Set(all.map((r) => r.key)).size).toBe(1);
      expect(await cast(b.orgId, 'Сообщение платформы: Только Б')).toBe(0);
      expect((await bellOf(b.ownerUserId)).map((r) => r.text).sort()).toEqual([
        'Сообщение платформы: Обновление',
        'Сообщение платформы: Только Б',
      ]);
      expect(await bellOf(acc.userId)).toHaveLength(1);
      // Не администратор платформы — ни рассылки, ни строк.
      await clear();
      expect(
        await withUserContext(db.app.db, a.ownerUserId, (tx) =>
          adminTelegramBroadcast(tx, { orgId: null, text: 'x', now: NOW, bellText: 'x' }),
        ),
      ).toBeNull();
      expect(await db.admin.db.$count(bellNotifications)).toBe(0);
    });

    it('рассылка: строку не получают заблокированная учётная запись, неактивный сотрудник, заблокированная организация и администратор платформы', async () => {
      await clear();
      const cast = () =>
        asAdmin((tx) =>
          adminTelegramBroadcast(tx, {
            orgId: null,
            text: 'Текст',
            now: NOW,
            bellText: 'Сообщение платформы: Обновление',
          }),
        );
      const recipients = async () =>
        (await db.admin.db.select({ user: bellNotifications.userId }).from(bellNotifications)).map(
          (r) => r.user,
        );
      await db.admin.db.update(users).set({ blocked: true }).where(eq(users.id, acc.userId));
      await db.admin.db
        .update(organizations)
        .set({ status: 'blocked' })
        .where(eq(organizations.id, b.orgId));
      try {
        expect(await cast()).toBe(0);
        // Только владелец организации А: администратор платформы — не сотрудник, строки нет и ему.
        expect(await recipients()).toEqual([a.ownerUserId]);
        await clear();
        await db.admin.db.update(users).set({ blocked: false }).where(eq(users.id, acc.userId));
        await db.admin.db
          .update(employees)
          .set({ active: false })
          .where(eq(employees.userId, acc.userId));
        expect(await cast()).toBe(0);
        expect(await recipients()).toEqual([a.ownerUserId]);
      } finally {
        await db.admin.db.update(users).set({ blocked: false }).where(eq(users.id, acc.userId));
        await db.admin.db
          .update(employees)
          .set({ active: true })
          .where(eq(employees.userId, acc.userId));
        await db.admin.db
          .update(organizations)
          .set({ status: 'active' })
          .where(eq(organizations.id, b.orgId));
      }
    });
  });

  it('кому «Это не я»: действующие владельцы своей организации, кроме нажавшего; заблокированный и уволенный — нет', async () => {
    const c = await createOrganization(db.app.db, {
      name: 'Организация В',
      inn: '03811201810458',
      slug: 'bell-c',
      owner: { fullName: 'Владелец', login: 'bell-owner-c', passwordHash: 'x' },
    });
    const inC = <T>(fn: Fn<T>) => withOrgContext(db.app.db, { orgId: c.orgId, userId: null }, fn);
    const ownerRole = c.roles.find((r) => r.isOwner)!;
    const staff = c.roles.find((r) => r.templateCode === 'acc')!;
    const add = (login: string, role: typeof ownerRole) =>
      withOrgContext(db.app.db, { orgId: c.orgId, userId: c.ownerUserId }, async (tx) => {
        const employeeId = await createEmployee(tx, {
          fullName: 'Сотрудник',
          shortName: 'Сотрудник',
          login,
          passwordHash: 'x',
          phone: null,
          role,
        });
        const [e] = await tx
          .select({ userId: employees.userId })
          .from(employees)
          .where(eq(employees.id, employeeId));
        return e!.userId;
      });
    const second = await add('bell-owner-c2', ownerRole);
    const blocked = await add('bell-owner-c3', ownerRole);
    const fired = await add('bell-owner-c4', ownerRole);
    const presser = await add('bell-acc-c', staff);
    await db.admin.db.update(users).set({ blocked: true }).where(eq(users.id, blocked));
    await db.admin.db.update(employees).set({ active: false }).where(eq(employees.userId, fired));
    expect(await inC((tx) => bellOwnerUsers(tx, c.orgId, presser))).toEqual([
      c.ownerUserId,
      second,
    ]);
    expect(await inC((tx) => bellOwnerUsers(tx, c.orgId, c.ownerUserId))).toEqual([second]);
    // Чужая организация — ни одного: и условие запроса, и RLS.
    expect(await inC((tx) => bellOwnerUsers(tx, a.orgId, presser))).toEqual([]);
    expect(await inA(null, (tx) => bellOwnerUsers(tx, c.orgId, null))).toEqual([]);
  });
});
