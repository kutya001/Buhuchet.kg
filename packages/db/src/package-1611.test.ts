import { randomUUID } from 'node:crypto';
import {
  FILE_LINK_SOURCE_KINDS,
  FILE_LINKABLE_FILE_KINDS,
  FILE_SOURCE_KINDS,
} from '@buhuchet/domain';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import { createContractor, type ContractorFields } from './contractors';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  bellNotifications,
  contractorSentFiles,
  feePayments,
  fileLinks,
  files,
  moneyOperations,
  news,
  newsAdminTexts,
  storageDeleteRetries,
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
 * Общая основа пакета доработок 16.11.2026 (этап 0, миграция 0157): колокольчик уведомлений, второй
 * текст и модули новостей, ссылки файла и перенос задвоенных чеков — изоляция организаций, права
 * роли приложения и защита базы. Правила модулей проверяют задачи потоков, которые их делают.
 */

const code = (c: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code: c }) });
const denied = code('42501');
const fkFailed = code('23503');
/** Ошибка именно этой проверки (код 23514 общий у CHECK и триггера `file_links_file_guard`). */
const checkOf = (name: string) =>
  expect.objectContaining({
    cause: expect.objectContaining({ code: '23514', constraint_name: name }),
  });
const fileCheck = checkOf('file_links_file_check');

const contractor = (inn: string, name: string): ContractorFields => ({
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
  responsibleEmployeeId: null,
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

describe.skipIf(!databaseAvailable())('Пакет 16.11: колокольчик, новости, ссылки файла', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let colleagueA = '';
  let adminId = '';
  let otherAdminId = '';
  let cpA = '';
  let cpB = '';
  type Fn<T> = Parameters<typeof withOrgContext<T>>[2];
  const inA = <T>(fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
  const asColleague = <T>(fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: colleagueA }, fn);
  const inB = <T>(fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);
  /** Задача по расписанию: контекст организации без пользователя. */
  const asJob = <T>(orgId: string, fn: Fn<T>) =>
    withOrgContext(db.app.db, { orgId, userId: null }, fn);
  const asAdmin = <T>(fn: Parameters<typeof withUserContext<T>>[2]) =>
    withUserContext(db.app.db, adminId, fn);

  const bell = (userId: string, over: Partial<typeof bellNotifications.$inferInsert> = {}) => ({
    userId,
    kind: 'files',
    event: 'cp_file',
    targetKind: 'contractor',
    targetId: cpA,
    contractorId: cpA,
    need: 'filesView',
    text: 'Новый файл от контрагента',
    eventKey: `cp_file:${randomUUID()}`,
    ...over,
  });

  /** Загруженный файл организации А (как после «закончить загрузку»), сразу владельцем базы. */
  const readyFile = async (over: Partial<typeof files.$inferInsert> = {}) => {
    const id = randomUUID();
    await db.admin.db.insert(files).values({
      id,
      orgId: a.orgId,
      sourceKind: 'sent_file',
      sourceId: null,
      contractorId: cpA,
      name: 'Чек.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1000,
      storageKey: `org/${a.orgId}/files/${id}`,
      state: 'ready',
      createdBy: a.ownerUserId,
      ...over,
    });
    return id;
  };

  /**
   * Принятый отправленный файл: чек контрагента, лёгший в его файлы (`file_id`). Название, тип и размер —
   * отправленного файла: у файла контрагента название могло стать «Имя (2)» (`acceptedFileName`).
   */
  const acceptedSent = async (
    fileId: string,
    over: Partial<typeof contractorSentFiles.$inferInsert> = {},
  ) => {
    const id = randomUUID();
    await db.admin.db.insert(contractorSentFiles).values({
      id,
      orgId: a.orgId,
      contractorId: cpA,
      source: 'page',
      comment: 'Чек: налоги, 5 000 сом',
      name: 'Чек.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1000,
      storageKey: `org/${a.orgId}/sent/${id}`,
      state: 'ready',
      status: 'accepted',
      decidedBy: a.ownerUserId,
      // Часы Node и базы могут разойтись на миллисекунды: «Принять» — заведомо раньше копии.
      decidedAt: new Date(Date.now() - 1000),
      fileId,
      ...over,
    });
    return id;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    await seedAllPlatformDictionaries(db.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец', login, passwordHash: 'x' });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'p1611-a',
      owner: owner('p1611-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'p1611-b',
      owner: owner('p1611-owner-b'),
    });
    const [colleague] = await db.admin.db
      .insert(users)
      .values({ orgId: a.orgId, login: 'p1611-colleague-a', passwordHash: 'x' })
      .returning({ id: users.id });
    colleagueA = colleague!.id;
    const admins = await db.admin.db
      .insert(users)
      .values([
        { login: 'p1611-platform', passwordHash: 'x', isPlatformAdmin: true },
        { login: 'p1611-platform-2', passwordHash: 'x', isPlatformAdmin: true },
      ])
      .returning({ id: users.id });
    adminId = admins[0]!.id;
    otherAdminId = admins[1]!.id;
    cpA = await inA((tx) =>
      createContractor(tx, a.orgId, contractor('03807819461915', 'ОсОО «А»'), null),
    );
    cpB = await inB((tx) =>
      createContractor(tx, b.orgId, contractor('03807819461916', 'ОсОО «Б»'), null),
    );
  });

  afterAll(async () => {
    await db?.drop();
  });

  describe('колокольчик (bell_notifications)', () => {
    /** Сделать строку старой (90 дней хранения) — владельцем базы. */
    const age = (eventKey: string, days: number) =>
      db.admin.db
        .update(bellNotifications)
        .set({ createdAt: new Date(Date.now() - days * 86_400_000) })
        .where(eq(bellNotifications.eventKey, eventKey));
    const left = async (keys: string[]) =>
      (
        await db.admin.db
          .select({ k: bellNotifications.eventKey })
          .from(bellNotifications)
          .where(sql`${bellNotifications.eventKey} in ${keys}`)
      )
        .map((r) => r.k)
        .sort();
    const cleanup = <T>(run: (fn: Fn<{ n: number }[]>) => Promise<T>) =>
      run((tx) => tx.execute<{ n: number }>(sql`select app.bell_cleanup() as n`));

    it('строку другому сотруднику своей организации кладут дважды одним ключом — строка одна, видит только получатель', async () => {
      const row = bell(colleagueA);
      for (let i = 0; i < 2; i++) {
        await inA((tx) => tx.insert(bellNotifications).values(row).onConflictDoNothing());
      }
      const [count] = await db.admin.db
        .select({ n: sql<number>`count(*)::int` })
        .from(bellNotifications)
        .where(eq(bellNotifications.eventKey, row.eventKey));
      expect(count).toEqual({ n: 1 });
      // Положивший (владелец) строку не видит; получатель видит.
      expect(
        await inA((tx) =>
          tx.select().from(bellNotifications).where(eq(bellNotifications.eventKey, row.eventKey)),
        ),
      ).toEqual([]);
      const mine = await asColleague((tx) =>
        tx
          .select({ orgId: bellNotifications.orgId, text: bellNotifications.text })
          .from(bellNotifications)
          .where(eq(bellNotifications.eventKey, row.eventKey)),
      );
      expect(mine).toEqual([{ orgId: a.orgId, text: row.text }]);
    });

    it('получатель отмечает «просмотрено» и «прочитано», остальное не меняет; чужую строку не отметить', async () => {
      const row = bell(colleagueA);
      await inA((tx) => tx.insert(bellNotifications).values(row));
      // Не получатель: ни условием по столбцу, ни без условия.
      for (const run of [inA, (fn: Fn<unknown>) => asJob(a.orgId, fn)]) {
        expect(
          await run((tx) =>
            tx
              .update(bellNotifications)
              .set({ seenAt: new Date() })
              .where(eq(bellNotifications.eventKey, row.eventKey))
              .returning({ id: bellNotifications.id }),
          ),
        ).toEqual([]);
        await run((tx) => tx.update(bellNotifications).set({ readAt: new Date() }));
      }
      const [untouched] = await db.admin.db
        .select({ seen: bellNotifications.seenAt, read: bellNotifications.readAt })
        .from(bellNotifications)
        .where(eq(bellNotifications.eventKey, row.eventKey));
      expect(untouched).toEqual({ seen: null, read: null });
      const now = new Date();
      const done = await asColleague((tx) =>
        tx
          .update(bellNotifications)
          .set({ seenAt: now, readAt: now })
          .where(eq(bellNotifications.eventKey, row.eventKey))
          .returning({ seen: bellNotifications.seenAt, read: bellNotifications.readAt }),
      );
      expect(done).toEqual([{ seen: now, read: now }]);
      await expect(
        asColleague((tx) =>
          tx
            .update(bellNotifications)
            .set({ text: 'Подмена' })
            .where(eq(bellNotifications.eventKey, row.eventKey)),
        ),
      ).rejects.toThrow(denied);
    });

    it('удаляет только получатель: DELETE без условия от коллеги, задачи или страницы контрагента строк не трогает', async () => {
      const ownerRow = bell(a.ownerUserId);
      const colleagueRow = bell(colleagueA);
      await inA((tx) => tx.insert(bellNotifications).values([ownerRow, colleagueRow]));
      // Без RETURNING и без условия по столбцам: политика чтения тут не включается — нужна своя на DELETE.
      // Сначала контекст без пользователя (задача, страница контрагента, бот клиента) — ничего.
      await asJob(a.orgId, (tx) => tx.delete(bellNotifications));
      expect(await left([ownerRow.eventKey, colleagueRow.eventKey])).toEqual(
        [ownerRow.eventKey, colleagueRow.eventKey].sort(),
      );
      // Коллега — только свои строки, строка владельца остаётся.
      await asColleague((tx) => tx.delete(bellNotifications));
      expect(await left([ownerRow.eventKey, colleagueRow.eventKey])).toEqual([ownerRow.eventKey]);
    });

    it('чужая организация: не видна, не меняется, не удаляется и не создаётся', async () => {
      const row = bell(colleagueA);
      await inA((tx) => tx.insert(bellNotifications).values(row));
      await inB(async (tx) => {
        expect(await tx.select().from(bellNotifications)).toEqual([]);
        expect(await tx.delete(bellNotifications).returning()).toEqual([]);
      });
      expect(await asJob(b.orgId, (tx) => tx.select().from(bellNotifications))).toEqual([]);
      expect(await left([row.eventKey])).toEqual([row.eventKey]);
      // Строка в организацию А из контекста Б — нет; сотруднику А с организацией Б — нет (ключ на пару).
      await expect(
        inB((tx) => tx.insert(bellNotifications).values({ ...bell(colleagueA), orgId: a.orgId })),
      ).rejects.toThrow(denied);
      await expect(
        inB((tx) =>
          tx.insert(bellNotifications).values({ ...bell(colleagueA), contractorId: null }),
        ),
      ).rejects.toThrow(fkFailed);
      // Контрагент другой организации в строке — нет.
      await expect(
        inA((tx) => tx.insert(bellNotifications).values(bell(colleagueA, { contractorId: cpB }))),
      ).rejects.toThrow(fkFailed);
      // Без контекста не видно ничего.
      expect(await db.app.db.select().from(bellNotifications)).toEqual([]);
    });

    it('задача без пользователя кладёт строки, но не видит их; старше 90 дней убирает app.bell_cleanup() — только своей организации', async () => {
      const fresh = bell(a.ownerUserId);
      const old = bell(colleagueA);
      const oldB = bell(b.ownerUserId, { contractorId: cpB, targetId: cpB });
      await asJob(a.orgId, (tx) => tx.insert(bellNotifications).values([fresh, old]));
      await inB((tx) => tx.insert(bellNotifications).values(oldB));
      expect(await asJob(a.orgId, (tx) => tx.select().from(bellNotifications))).toEqual([]);
      await age(old.eventKey, 91);
      await age(oldB.eventKey, 91);
      await age(fresh.eventKey, 89);
      const [res] = await cleanup((fn) => asJob(a.orgId, fn));
      expect(res).toEqual({ n: 1 });
      expect(await left([fresh.eventKey, old.eventKey, oldB.eventKey])).toEqual(
        [fresh.eventKey, oldB.eventKey].sort(),
      );
      // Строка организации А с контрагентом организации А, но от задачи организации Б — нет.
      await expect(
        asJob(b.orgId, (tx) => tx.insert(bellNotifications).values(bell(a.ownerUserId))),
      ).rejects.toThrow(fkFailed);
    });

    it('проверки: вид кнопки, вид события, что открыть, право, текст, ключ — каждая своя', async () => {
      const bad: [Partial<typeof bellNotifications.$inferInsert>, string][] = [
        [{ kind: 'all' }, 'bell_notifications_kind_check'],
        [{ event: 'Cp File' }, 'bell_notifications_event_check'],
        [{ targetKind: 'contractor', targetId: null }, 'bell_notifications_target_check'],
        [{ targetKind: null, targetId: cpA }, 'bell_notifications_target_check'],
        [{ targetKind: 'Contractor' }, 'bell_notifications_target_check'],
        [{ targetId: 'x'.repeat(101) }, 'bell_notifications_target_check'],
        [{ need: 'files.view' }, 'bell_notifications_need_check'],
        [{ text: '' }, 'bell_notifications_text_check'],
        [{ eventKey: '' }, 'bell_notifications_event_key_check'],
      ];
      for (const [over, name] of bad) {
        await expect(
          inA((tx) => tx.insert(bellNotifications).values(bell(colleagueA, over))),
        ).rejects.toThrow(checkOf(name));
      }
      await inA((tx) =>
        tx.insert(bellNotifications).values(
          bell(colleagueA, {
            targetKind: null,
            targetId: null,
            contractorId: null,
            need: null,
          }),
        ),
      );
      // Строка администратора платформы (без организации) — без контрагента: ключ на пару при пустой
      // организации не проверяется, держит только проверка.
      await expect(
        asAdmin((tx) =>
          tx.insert(bellNotifications).values(bell(adminId, { orgId: null, contractorId: cpA })),
        ),
      ).rejects.toThrow(checkOf('bell_notifications_contractor_check'));
    });

    it('строки администратора платформы (без организации): только свои и только ему; уборка без организации', async () => {
      const row = bell(adminId, {
        kind: 'other',
        event: 'lead',
        targetKind: 'lead',
        targetId: randomUUID(),
        contractorId: null,
        need: null,
        text: 'Новая заявка с лендинга',
      });
      const oldRow = { ...row, eventKey: `lead:${randomUUID()}` };
      await asAdmin((tx) => tx.insert(bellNotifications).values([row, oldRow]));
      const own = await asAdmin((tx) =>
        tx
          .select({ orgId: bellNotifications.orgId })
          .from(bellNotifications)
          .where(eq(bellNotifications.eventKey, row.eventKey)),
      );
      expect(own).toEqual([{ orgId: null }]);
      // Свою строку отмечает «просмотрено».
      const seen = await asAdmin((tx) =>
        tx
          .update(bellNotifications)
          .set({ seenAt: new Date() })
          .where(eq(bellNotifications.eventKey, row.eventKey))
          .returning({ id: bellNotifications.id }),
      );
      expect(seen).toHaveLength(1);
      // Другому администратору — нет; ни он, ни сотрудник организации их не видят и не удаляют.
      await expect(
        asAdmin((tx) =>
          tx.insert(bellNotifications).values({ ...row, userId: otherAdminId, eventKey: 'lead:x' }),
        ),
      ).rejects.toThrow(denied);
      const asOther = <T>(fn: Parameters<typeof withUserContext<T>>[2]) =>
        withUserContext(db.app.db, otherAdminId, fn);
      expect(await asOther((tx) => tx.select().from(bellNotifications))).toEqual([]);
      expect(await asOther((tx) => tx.delete(bellNotifications).returning())).toEqual([]);
      expect(
        await inA((tx) =>
          tx.select().from(bellNotifications).where(eq(bellNotifications.eventKey, row.eventKey)),
        ),
      ).toEqual([]);
      // Сотрудник организации не кладёт строку без организации.
      await expect(
        inA((tx) =>
          tx
            .insert(bellNotifications)
            .values({ ...bell(colleagueA), orgId: null, contractorId: null }),
        ),
      ).rejects.toThrow(denied);
      // Уборка без организации — строки администраторов старше 90 дней, строки организаций — нет.
      const orgOld = bell(colleagueA);
      await inA((tx) => tx.insert(bellNotifications).values(orgOld));
      await age(oldRow.eventKey, 91);
      await age(orgOld.eventKey, 91);
      const [res] = await cleanup((fn) => asOther(fn));
      expect(res).toEqual({ n: 1 });
      expect(await left([row.eventKey, oldRow.eventKey, orgOld.eventKey])).toEqual(
        [row.eventKey, orgOld.eventKey].sort(),
      );
    });
  });

  describe('новости: модули и текст «Для администратора платформы»', () => {
    const newsId = 'n1611test';

    beforeAll(async () => {
      await db.admin.db.insert(news).values({
        id: newsId,
        title: 'Версия 121',
        type: 'update',
        release: '121',
        publishDate: '2026-11-01',
        short: 'Коротко',
        md: '- Для пользователей',
        status: 'published',
        publishedAt: new Date('2026-11-01T03:00:00Z'),
      });
    });

    it('модули: по умолчанию пусто; коды модулей прототипа; каждая плохая комбинация — отказ', async () => {
      const [row] = await db.admin.db
        .select({ modules: news.modules })
        .from(news)
        .where(eq(news.id, newsId));
      expect(row).toEqual({ modules: [] });
      await asAdmin((tx) =>
        tx
          .update(news)
          .set({ modules: ['cps', 'reports', 'kb-news'] })
          .where(eq(news.id, newsId)),
      );
      const bad: string[][] = [
        ['Cps'],
        ['cps', ''],
        ['cps,reports'],
        ['модуль'],
        ['cps', null as unknown as string],
        Array.from({ length: 31 }, (_, i) => `m${i}`),
        ['a'.repeat(33)],
      ];
      for (const modules of bad) {
        await expect(
          asAdmin((tx) => tx.update(news).set({ modules }).where(eq(news.id, newsId))),
        ).rejects.toThrow(checkOf('news_modules_check'));
      }
      // 30 модулей и код из 32 знаков — можно.
      await asAdmin((tx) =>
        tx
          .update(news)
          .set({ modules: Array.from({ length: 30 }, (_, i) => `m${i}`) })
          .where(eq(news.id, newsId)),
      );
      await asAdmin((tx) =>
        tx
          .update(news)
          .set({ modules: ['a'.repeat(32), 'cps', 'reports', 'kb-news'] })
          .where(eq(news.id, newsId)),
      );
      // Пользователь организации видит новость вместе с модулями.
      const seen = await inA((tx) =>
        tx.select({ modules: news.modules }).from(news).where(eq(news.id, newsId)),
      );
      expect(seen).toEqual([{ modules: ['a'.repeat(32), 'cps', 'reports', 'kb-news'] }]);
    });

    it('второй текст видит и пишет только администратор платформы от своего имени; удаляется вместе с новостью', async () => {
      await asAdmin((tx) => tx.insert(newsAdminTexts).values({ newsId, md: '- Миграция 0157' }));
      expect(
        await asAdmin((tx) =>
          tx.select({ md: newsAdminTexts.md, by: newsAdminTexts.updatedBy }).from(newsAdminTexts),
        ),
      ).toEqual([{ md: '- Миграция 0157', by: adminId }]);
      // Другой администратор меняет текст только от своего имени.
      await expect(
        withUserContext(db.app.db, otherAdminId, (tx) =>
          tx
            .update(newsAdminTexts)
            .set({ md: '- Чужой автор' })
            .where(eq(newsAdminTexts.newsId, newsId)),
        ),
      ).rejects.toThrow(denied);
      await withUserContext(db.app.db, otherAdminId, (tx) =>
        tx
          .update(newsAdminTexts)
          .set({ md: '- Миграция 0157, проверить стенд', updatedBy: otherAdminId })
          .where(eq(newsAdminTexts.newsId, newsId)),
      );
      // Пользователь организации: не видит, не пишет, не меняет.
      expect(await inA((tx) => tx.select().from(newsAdminTexts))).toEqual([]);
      await expect(
        inA((tx) => tx.insert(newsAdminTexts).values({ newsId, md: 'подмена' })),
      ).rejects.toThrow(denied);
      expect(
        await inA((tx) =>
          tx
            .update(newsAdminTexts)
            .set({ md: 'подмена' })
            .where(eq(newsAdminTexts.newsId, newsId))
            .returning(),
        ),
      ).toEqual([]);
      expect(await db.app.db.select().from(newsAdminTexts)).toEqual([]);
      await expect(
        asAdmin((tx) =>
          tx
            .update(newsAdminTexts)
            .set({ md: '', updatedBy: adminId })
            .where(eq(newsAdminTexts.newsId, newsId)),
        ),
      ).rejects.toThrow(checkOf('news_admin_texts_md_check'));
      await db.admin.db.delete(news).where(eq(news.id, newsId));
      expect(await db.admin.db.select().from(newsAdminTexts)).toEqual([]);
    });
  });

  describe('ссылки файла (file_links)', () => {
    it('ссылку ставит вошедший на загруженный файл контрагента; не меняется; «Открепить» — удаление', async () => {
      const fileId = await readyFile();
      const receiptId = randomUUID();
      const [link] = await inA((tx) =>
        tx
          .insert(fileLinks)
          .values({ fileId, sourceKind: 'receipt', sourceId: receiptId })
          .returning({ orgId: fileLinks.orgId, createdBy: fileLinks.createdBy }),
      );
      expect(link).toEqual({ orgId: a.orgId, createdBy: a.ownerUserId });
      // Автора не подставить; ссылка не меняется.
      await expect(
        inA((tx) =>
          tx.insert(fileLinks).values({
            fileId,
            sourceKind: 'fee_payment',
            sourceId: randomUUID(),
            createdBy: colleagueA,
          }),
        ),
      ).rejects.toThrow(denied);
      await expect(
        inA((tx) =>
          tx.update(fileLinks).set({ sourceId: randomUUID() }).where(eq(fileLinks.fileId, fileId)),
        ),
      ).rejects.toThrow(denied);
      const removed = await inA((tx) =>
        tx
          .delete(fileLinks)
          .where(and(eq(fileLinks.fileId, fileId), eq(fileLinks.sourceId, receiptId)))
          .returning({ id: fileLinks.sourceId }),
      );
      expect(removed).toEqual([{ id: receiptId }]);
    });

    it('любой файл самого контрагента (акт, сверка, свидетельство, загруженный вручную) — ссылкой к записям всех видов, файл один', async () => {
      const act = await readyFile({
        name: 'Акт сверки.xlsx',
        contentType: 'application/vnd.ms-excel',
      });
      const records = FILE_LINK_SOURCE_KINDS.map((sourceKind) => ({
        fileId: act,
        sourceKind,
        sourceId: randomUUID(),
      }));
      await inA((tx) => tx.insert(fileLinks).values(records));
      const linked = await inA((tx) =>
        tx
          .select({ sourceKind: fileLinks.sourceKind })
          .from(fileLinks)
          .where(eq(fileLinks.fileId, act)),
      );
      expect(linked.map((l) => l.sourceKind).sort()).toEqual([...FILE_LINK_SOURCE_KINDS].sort());
      const copies = await db.admin.db
        .select({ id: files.id })
        .from(files)
        .where(and(eq(files.orgId, a.orgId), eq(files.name, 'Акт сверки.xlsx')));
      expect(copies).toEqual([{ id: act }]);
      for (const sourceKind of FILE_LINKABLE_FILE_KINDS) {
        const fileId = await readyFile({
          sourceKind,
          sourceId: sourceKind === 'contractor' ? cpA : null,
        });
        await inA((tx) =>
          tx.insert(fileLinks).values({ fileId, sourceKind: 'project', sourceId: randomUUID() }),
        );
      }
    });

    it('незагруженный, удалённый, общий файл и файл чужой записи (задачи, оплаты за обслуживание) — ошибка, а не пропуск', async () => {
      const pending = await readyFile({ state: 'pending' });
      const general = await readyFile({ sourceKind: 'manual', contractorId: null });
      const gone = await readyFile();
      await db.admin.db
        .update(files)
        .set({ state: 'deleted', deletedAt: new Date(), deletedBy: a.ownerUserId })
        .where(eq(files.id, gone));
      const ofRecords = await Promise.all(
        FILE_SOURCE_KINDS.filter(
          (k) => !(FILE_LINKABLE_FILE_KINDS as readonly string[]).includes(k),
        ).map((sourceKind) => readyFile({ sourceKind, sourceId: randomUUID() })),
      );
      for (const fileId of [pending, general, gone, ...ofRecords]) {
        await expect(
          inA((tx) =>
            tx.insert(fileLinks).values({ fileId, sourceKind: 'receipt', sourceId: randomUUID() }),
          ),
        ).rejects.toThrow(fileCheck);
      }
      expect(
        await db.admin.db
          .select()
          .from(fileLinks)
          .where(sql`${fileLinks.fileId} in ${[pending, general, gone, ...ofRecords]}`),
      ).toEqual([]);
    });

    it('вид записи без ссылки (задача и не записи контрагента) — ошибка своей проверки', async () => {
      const fileId = await readyFile();
      for (const sourceKind of [
        'task',
        'indicator_value',
        'manual',
        'contractor',
        'sent_file',
        'lead',
      ]) {
        await expect(
          inA((tx) => tx.insert(fileLinks).values({ fileId, sourceKind, sourceId: randomUUID() })),
        ).rejects.toThrow(checkOf('file_links_source_kind_check'));
      }
    });

    it('чужая организация: не видна, не удаляется, на чужой файл ссылку не поставить', async () => {
      const fileId = await readyFile();
      const receiptId = randomUUID();
      await inA((tx) =>
        tx.insert(fileLinks).values({ fileId, sourceKind: 'receipt', sourceId: receiptId }),
      );
      await inB(async (tx) => {
        expect(await tx.select().from(fileLinks)).toEqual([]);
        expect(await tx.delete(fileLinks).returning()).toEqual([]);
      });
      // Файл организации А из контекста Б не виден — ошибка защиты ссылки раньше внешнего ключа.
      await expect(
        inB((tx) =>
          tx.insert(fileLinks).values({ fileId, sourceKind: 'receipt', sourceId: randomUUID() }),
        ),
      ).rejects.toThrow(fileCheck);
      // С организацией А в строке — тоже отказ (защита ссылки срабатывает раньше политики изоляции).
      await expect(
        inB((tx) =>
          tx
            .insert(fileLinks)
            .values({ orgId: a.orgId, fileId, sourceKind: 'receipt', sourceId: randomUUID() }),
        ),
      ).rejects.toThrow(fileCheck);
      expect(await db.app.db.select().from(fileLinks)).toEqual([]);
      expect(
        await db.admin.db.select().from(fileLinks).where(eq(fileLinks.fileId, fileId)),
      ).toHaveLength(1);
    });
  });

  describe('перенос задвоенных чеков (app.file_copies_merge)', () => {
    const merge = () => db.admin.db.execute(sql`select app.file_copies_merge()`);

    /**
     * Принятый чек, как его делает «Принять»: отправленный файл с названием `name`, файл контрагента —
     * с названием `fileName` (по умолчанию то же; занятое — «Имя (2)»).
     */
    const sentCheck = async (
      name: string,
      o: { fileName?: string; type?: string; size?: number; at?: Date } = {},
    ) => {
      const type = o.type ?? 'image/jpeg';
      const size = o.size ?? 2048;
      const fileId = await readyFile({
        name: o.fileName ?? name,
        contentType: type,
        sizeBytes: size,
        ...(o.at ? { createdAt: o.at } : {}),
      });
      await acceptedSent(fileId, {
        name,
        contentType: type,
        sizeBytes: size,
        ...(o.at ? { decidedAt: o.at, createdAt: o.at } : {}),
      });
      return fileId;
    };
    /** Копия, как её делает «Принять» с прикреплением к деньгам до этапа 1 (`files/sent.ts`): название и тип отправленного файла. */
    const copyOf = (name: string, over: Partial<typeof files.$inferInsert> = {}) =>
      readyFile({
        name,
        contentType: 'image/jpeg',
        sizeBytes: 2048,
        sourceKind: 'receipt',
        sourceId: randomUUID(),
        createdBy: colleagueA,
        ...over,
      });
    const stateOf = async (ids: string[]) =>
      new Map(
        (
          await db.admin.db
            .select({
              id: files.id,
              state: files.state,
              deletedBy: files.deletedBy,
              updatedBy: files.updatedBy,
              key: files.storageKey,
            })
            .from(files)
            .where(sql`${files.id} in ${ids}`)
        ).map((r) => [r.id, r]),
      );
    const linksOf = (fileIds: string[]) =>
      db.admin.db
        .select({
          fileId: fileLinks.fileId,
          kind: fileLinks.sourceKind,
          id: fileLinks.sourceId,
          by: fileLinks.createdBy,
        })
        .from(fileLinks)
        .where(sql`${fileLinks.fileId} in ${fileIds}`);

    it('копия у поступления и у оплаты за обслуживание становится ссылкой оригинала — и когда оригинал назван «Имя (2)»; повтор ничего не меняет', async () => {
      const u = randomUUID().slice(0, 8);
      const name = `Скан ${u}.jpg`;
      const original = await sentCheck(name, { fileName: `Скан ${u} (2).jpg` });
      const copy = await copyOf(name);
      const [copyRow] = await db.admin.db
        .select({ id: files.sourceId })
        .from(files)
        .where(eq(files.id, copy));
      const feeCopy = await copyOf(name, { sourceKind: 'fee_payment', createdBy: a.ownerUserId });
      const [feeRow] = await db.admin.db
        .select({ id: files.sourceId })
        .from(files)
        .where(eq(files.id, feeCopy));
      // Не копия: другой размер.
      const other = await copyOf(name, { sizeBytes: 4096 });
      await merge();
      const links = await linksOf([original, copy, feeCopy, other]);
      expect(links).toEqual(
        expect.arrayContaining([
          { fileId: original, kind: 'receipt', id: copyRow!.id, by: colleagueA },
          { fileId: original, kind: 'fee_payment', id: feeRow!.id, by: a.ownerUserId },
        ]),
      );
      expect(links).toHaveLength(2);
      const byId = await stateOf([original, copy, feeCopy, other]);
      expect(byId.get(original)?.state).toBe('ready');
      expect(byId.get(other)?.state).toBe('ready');
      expect(byId.get(copy)).toMatchObject({
        state: 'deleted',
        deletedBy: colleagueA,
        updatedBy: colleagueA,
      });
      expect(byId.get(feeCopy)).toMatchObject({ state: 'deleted', deletedBy: a.ownerUserId });
      // Объекты копий хранилища удалит задача повторного удаления; объект оригинала — нет.
      const keys = (
        await db.admin.db.select({ key: storageDeleteRetries.key }).from(storageDeleteRetries)
      ).map((k) => k.key);
      expect(keys).toEqual(expect.arrayContaining([byId.get(copy)!.key, byId.get(feeCopy)!.key]));
      expect(keys).not.toContain(byId.get(original)!.key);
      await merge();
      expect(await linksOf([original, copy, feeCopy, other])).toHaveLength(2);
      expect((await stateOf([original, other])).get(other)?.state).toBe('ready');
    });

    it('копия, сделанная в той же транзакции, что «Принять» (то же время), объединяется', async () => {
      const u = randomUUID().slice(0, 8);
      const at = new Date(Date.now() - 5_000);
      const original = await sentCheck(`Чек ${u}.jpg`, { at });
      const copy = await copyOf(`Чек ${u}.jpg`, { createdAt: at });
      await merge();
      expect((await stateOf([copy])).get(copy)?.state).toBe('deleted');
      expect(await linksOf([original])).toHaveLength(1);
    });

    it('граница 15.11.2026 — полночь по Бишкеку: копия в 00:01 15.11 по Бишкеку (18:01 14.11 UTC) объединяется', async () => {
      const u = randomUUID().slice(0, 8);
      const original = await sentCheck(`Полночь ${u}.jpg`, {
        at: new Date('2026-11-14T10:00:00Z'),
      });
      const copy = await copyOf(`Полночь ${u}.jpg`, {
        createdAt: new Date('2026-11-14T18:01:00Z'),
      });
      await merge();
      expect((await stateOf([copy])).get(copy)?.state).toBe('deleted');
      expect(await linksOf([original])).toHaveLength(1);
    });

    it('один чек, присланный дважды («Квит» и «Квит (2)»), и копия другого контрагента не трогаются', async () => {
      const u = randomUUID().slice(0, 8);
      const name = `Квит ${u}.jpg`;
      const first = await sentCheck(name);
      const second = await sentCheck(name, { fileName: `Квит ${u} (2).jpg` });
      const ambiguous = await copyOf(name);
      // Копия контрагента «А-2» с названием, размером и типом принятого чека контрагента «А».
      const cpA2 = await inA((tx) =>
        createContractor(tx, a.orgId, contractor('03807819461917', 'ОсОО «А-2»'), null),
      );
      const single = await sentCheck(`Один ${u}.jpg`);
      const foreign = await copyOf(`Один ${u}.jpg`, { contractorId: cpA2 });
      await merge();
      const byId = await stateOf([ambiguous, foreign]);
      expect(byId.get(ambiguous)?.state).toBe('ready');
      expect(byId.get(foreign)?.state).toBe('ready');
      expect(await linksOf([first, second, single])).toEqual([]);
    });

    it('не копия, если нарушено любое условие пары — копия остаётся, ссылки нет', async () => {
      const cases: [string, (u: string) => Promise<{ originals: string[]; copy: string }>][] = [
        [
          'копия раньше «Принять»',
          async (u) => ({
            originals: [await sentCheck(`a${u}.jpg`)],
            copy: await copyOf(`a${u}.jpg`, { createdAt: new Date(Date.now() - 60_000) }),
          }),
        ],
        [
          'копия раньше 15.11.2026 по Бишкеку',
          async (u) => {
            const at = new Date('2026-11-14T10:00:00Z');
            return {
              originals: [await sentCheck(`b${u}.jpg`, { at })],
              copy: await copyOf(`b${u}.jpg`, { createdAt: new Date('2026-11-14T17:59:00Z') }),
            };
          },
        ],
        [
          'копию заменяли',
          async (u) => ({
            originals: [await sentCheck(`c${u}.jpg`)],
            copy: await copyOf(`c${u}.jpg`, {
              replacedAt: new Date(),
              replacedBy: a.ownerUserId,
            }),
          }),
        ],
        [
          'копия не загружена',
          async (u) => ({
            originals: [await sentCheck(`d${u}.jpg`)],
            copy: await copyOf(`d${u}.jpg`, { state: 'pending' }),
          }),
        ],
        [
          'у копии примечание',
          async (u) => ({
            originals: [await sentCheck(`e${u}.jpg`)],
            copy: await copyOf(`e${u}.jpg`, { note: 'Чек за октябрь' }),
          }),
        ],
        [
          'оригинал удалён',
          async (u) => {
            const original = await sentCheck(`f${u}.jpg`);
            await db.admin.db
              .update(files)
              .set({ state: 'deleted', deletedAt: new Date(), deletedBy: a.ownerUserId })
              .where(eq(files.id, original));
            return { originals: [original], copy: await copyOf(`f${u}.jpg`) };
          },
        ],
        [
          'оригинал заменяли',
          async (u) => {
            const original = await sentCheck(`g${u}.jpg`);
            await db.admin.db
              .update(files)
              .set({ replacedAt: new Date(), replacedBy: a.ownerUserId })
              .where(eq(files.id, original));
            return { originals: [original], copy: await copyOf(`g${u}.jpg`) };
          },
        ],
        [
          'другое название',
          async (u) => ({
            originals: [await sentCheck(`h${u}.jpg`)],
            copy: await copyOf(`h${u}-1.jpg`),
          }),
        ],
        [
          'другой тип',
          async (u) => ({
            originals: [await sentCheck(`i${u}.jpg`)],
            copy: await copyOf(`i${u}.jpg`, { contentType: 'image/png' }),
          }),
        ],
        [
          'копия у записи другого вида (оплата налога)',
          async (u) => ({
            originals: [await sentCheck(`j${u}.jpg`)],
            copy: await copyOf(`j${u}.jpg`, { sourceKind: 'tax_payment' }),
          }),
        ],
        [
          'копия у отчёта',
          async (u) => ({
            originals: [await sentCheck(`k${u}.jpg`)],
            copy: await copyOf(`k${u}.jpg`, { sourceKind: 'report' }),
          }),
        ],
      ];
      const built: { what: string; originals: string[]; copy: string }[] = [];
      for (const [what, build] of cases) {
        built.push({ what, ...(await build(randomUUID().slice(0, 8))) });
      }
      await merge();
      for (const { what, originals, copy } of built) {
        const [row] = await db.admin.db
          .select({ state: files.state })
          .from(files)
          .where(eq(files.id, copy));
        expect({ what, state: row?.state }).toEqual({
          what,
          state: what === 'копия не загружена' ? 'pending' : 'ready',
        });
        expect({ what, links: await linksOf(originals) }).toEqual({ what, links: [] });
      }
    });

    it('роль приложения функцию переноса не зовёт', async () => {
      await expect(inA((tx) => tx.execute(sql`select app.file_copies_merge()`))).rejects.toThrow(
        denied,
      );
    });

    /*
     * Второй перенос (этап 2, миграция 0160): копии, которые прежний код сделал, пока шёл выпуск этапа 1.
     * Те же условия пары и ещё одно — копия прикреплена не позже 10 минут после создания своей записи
     * денег: так прикреплял её прежний код сразу после «Сохранить» (docs/deviations.md п. К-19).
     */
    describe('второй перенос с границей по записи денег (app.file_copies_merge_late)', () => {
      const mergeLate = (until?: Date) =>
        until
          ? db.admin.db.execute(sql`select app.file_copies_merge_late(${until.toISOString()})`)
          : db.admin.db.execute(sql`select app.file_copies_merge_late()`);
      const minutes = (n: number) => n * 60_000;
      /** Поступление от контрагента (по умолчанию «А»), созданное в `at`. */
      const receiptAt = async (
        at: Date,
        over: Partial<typeof moneyOperations.$inferInsert> = {},
      ) => {
        const id = randomUUID();
        await db.admin.db.insert(moneyOperations).values({
          id,
          orgId: a.orgId,
          contractorId: cpA,
          kind: 'in',
          amount: 500_000,
          total: 500_000,
          opDate: '2026-11-16',
          holderKind: 'org',
          createdBy: a.ownerUserId,
          createdAt: at,
          ...over,
        });
        return id;
      };
      /** Оплата за обслуживание контрагента «А», созданная в `at`. */
      const feePaymentAt = async (at: Date) => {
        const id = randomUUID();
        await db.admin.db.insert(feePayments).values({
          id,
          orgId: a.orgId,
          contractorId: cpA,
          amount: 300_000,
          paidOn: '2026-11-16',
          toKind: 'owner',
          createdBy: a.ownerUserId,
          createdAt: at,
        });
        return id;
      };

      it('копия, прикреплённая сразу после записи денег, объединяется — у поступления и у оплаты за обслуживание; повтор ничего не меняет', async () => {
        const u = randomUUID().slice(0, 8);
        const accepted = new Date(Date.now() - minutes(30));
        const original = await sentCheck(`Поздний ${u}.jpg`, { at: accepted });
        const saved = new Date(Date.now() - minutes(20));
        const receipt = await receiptAt(saved);
        const copy = await copyOf(`Поздний ${u}.jpg`, {
          sourceId: receipt,
          createdAt: new Date(saved.getTime() + 3_000),
        });
        const fee = await feePaymentAt(saved);
        const feeCopy = await copyOf(`Поздний ${u}.jpg`, {
          sourceKind: 'fee_payment',
          sourceId: fee,
          createdBy: a.ownerUserId,
          createdAt: new Date(saved.getTime() + minutes(10)),
        });
        // Верхняя граница вызова (выкладка нового кода) раньше копий — копии не трогаются.
        await mergeLate(new Date(saved.getTime() + 1_000));
        expect((await stateOf([copy, feeCopy])).get(copy)?.state).toBe('ready');
        expect(await linksOf([original])).toEqual([]);
        await mergeLate();
        const byId = await stateOf([original, copy, feeCopy]);
        expect(byId.get(original)?.state).toBe('ready');
        expect(byId.get(copy)).toMatchObject({ state: 'deleted', deletedBy: colleagueA });
        expect(byId.get(feeCopy)).toMatchObject({ state: 'deleted', deletedBy: a.ownerUserId });
        expect(await linksOf([original])).toEqual(
          expect.arrayContaining([
            { fileId: original, kind: 'receipt', id: receipt, by: colleagueA },
            { fileId: original, kind: 'fee_payment', id: fee, by: a.ownerUserId },
          ]),
        );
        const keys = (
          await db.admin.db.select({ key: storageDeleteRetries.key }).from(storageDeleteRetries)
        ).map((k) => k.key);
        expect(keys).toEqual(expect.arrayContaining([byId.get(copy)!.key, byId.get(feeCopy)!.key]));
        await mergeLate();
        expect(await linksOf([original])).toHaveLength(2);
      });

      // Вызов миграции 0164 (выпуск 17.11.2026): граница — момент, когда рабочий сайт с новым кодом готов.
      it('вызов с верхней границей объединяет копию раньше границы; копия ровно на границе и позже остаётся', async () => {
        const u = randomUUID().slice(0, 8);
        const accepted = new Date(Date.now() - minutes(30));
        const original = await sentCheck(`Граница ${u}.jpg`, { at: accepted });
        const saved = new Date(Date.now() - minutes(20));
        const until = new Date(saved.getTime() + 5_000);
        const receipt = await receiptAt(saved);
        const early = await copyOf(`Граница ${u}.jpg`, {
          sourceId: receipt,
          createdAt: new Date(until.getTime() - 1_000),
        });
        const edge = await copyOf(`Граница ${u}.jpg`, {
          sourceId: await receiptAt(saved),
          createdAt: until,
        });
        const late = await copyOf(`Граница ${u}.jpg`, {
          sourceId: await receiptAt(saved),
          createdAt: new Date(until.getTime() + 1_000),
        });
        await mergeLate(until);
        const byId = await stateOf([original, early, edge, late]);
        expect(byId.get(original)?.state).toBe('ready');
        expect(byId.get(early)?.state).toBe('deleted');
        expect(byId.get(edge)?.state).toBe('ready');
        expect(byId.get(late)?.state).toBe('ready');
        expect(await linksOf([original])).toEqual([
          expect.objectContaining({ fileId: original, kind: 'receipt', id: receipt }),
        ]);
      });

      it('та же копия, прикреплённая позже 10 минут после записи денег, до записи или к записи без строки, не трогается', async () => {
        const u = randomUUID().slice(0, 8);
        const accepted = new Date(Date.now() - minutes(60));
        const original = await sentCheck(`Ручной ${u}.jpg`, { at: accepted });
        const saved = new Date(Date.now() - minutes(40));
        // Загрузили тот же файл в карточку записи позже — это не копия прежнего кода.
        const later = await copyOf(`Ручной ${u}.jpg`, {
          sourceId: await receiptAt(saved),
          createdAt: new Date(saved.getTime() + minutes(10) + 1_000),
        });
        const feeLater = await copyOf(`Ручной ${u}.jpg`, {
          sourceKind: 'fee_payment',
          sourceId: await feePaymentAt(saved),
          createdAt: new Date(saved.getTime() + minutes(15)),
        });
        // Время записи денег позже времени копии (часы разошлись) — тоже не копия.
        const before = await copyOf(`Ручной ${u}.jpg`, {
          sourceId: await receiptAt(saved),
          createdAt: new Date(saved.getTime() - 1_000),
        });
        // Записи денег нет (номер чужой записи).
        const orphan = await copyOf(`Ручной ${u}.jpg`, { createdAt: saved });
        // Первый перенос (0159) такую копию объединил бы: граница только у второго.
        await mergeLate();
        const byId = await stateOf([later, feeLater, before, orphan]);
        for (const id of [later, feeLater, before, orphan])
          expect(byId.get(id)?.state).toBe('ready');
        expect(await linksOf([original])).toEqual([]);
      });

      it('остальные условия пары — как у первого переноса: два одинаковых чека, примечание, другой контрагент, другая организация, запись денег не того контрагента или вида', async () => {
        const u = randomUUID().slice(0, 8);
        const name = `Двойной ${u}.jpg`;
        const accepted = new Date(Date.now() - minutes(30));
        const first = await sentCheck(name, { at: accepted });
        const second = await sentCheck(name, { fileName: `Двойной ${u} (2).jpg`, at: accepted });
        const saved = new Date(Date.now() - minutes(20));
        const ambiguous = await copyOf(name, {
          sourceId: await receiptAt(saved),
          createdAt: saved,
        });
        const single = await sentCheck(`Один-${u}.jpg`, { at: accepted });
        const noted = await copyOf(`Один-${u}.jpg`, {
          sourceId: await receiptAt(saved),
          createdAt: saved,
          note: 'Чек за октябрь',
        });
        // Другой контрагент той же организации: копия его поступления с названием, типом и размером
        // принятого чека «А» — не пара.
        const cpA3 = await inA((tx) =>
          createContractor(tx, a.orgId, contractor('03807819461918', 'ОсОО «А-3»'), null),
        );
        const other = await sentCheck(`Чужой-${u}.jpg`, { at: accepted });
        const foreign = await copyOf(`Чужой-${u}.jpg`, {
          contractorId: cpA3,
          sourceId: await receiptAt(saved, { contractorId: cpA3 }),
          createdAt: saved,
        });
        // Копия контрагента «А», но запись денег — другого контрагента: ссылка на чужие деньги не встаёт.
        const misplaced = await copyOf(`Чужой-${u}.jpg`, {
          sourceId: await receiptAt(saved, { contractorId: cpA3 }),
          createdAt: saved,
        });
        // Другая организация: копия у поступления контрагента «Б» с тем же названием, типом и размером.
        const elsewhere = await copyOf(`Чужой-${u}.jpg`, {
          orgId: b.orgId,
          contractorId: cpB,
          storageKey: `org/${b.orgId}/files/${randomUUID()}`,
          sourceId: await receiptAt(saved, {
            orgId: b.orgId,
            contractorId: cpB,
            createdBy: b.ownerUserId,
          }),
          createdBy: b.ownerUserId,
          createdAt: saved,
        });
        // Запись денег того же контрагента, но не поступление (возврат контрагенту): пары нет.
        const notReceipt = await copyOf(`Чужой-${u}.jpg`, {
          sourceId: await receiptAt(saved, { kind: 'refund', total: null }),
          createdAt: saved,
        });
        await mergeLate();
        const all = [ambiguous, noted, foreign, misplaced, elsewhere, notReceipt];
        const byId = await stateOf(all);
        for (const id of all) expect(byId.get(id)?.state).toBe('ready');
        expect(await linksOf([first, second, single, other])).toEqual([]);
      });

      it('роль приложения функцию второго переноса не зовёт', async () => {
        await expect(
          inA((tx) => tx.execute(sql`select app.file_copies_merge_late()`)),
        ).rejects.toThrow(denied);
      });
    });
  });
});
