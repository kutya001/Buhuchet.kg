import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserContext } from './auth';
import { withOrgContext } from './context';
import { createContractor, type ContractorFields } from './contractors';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  bellNotifications,
  contractorSentFiles,
  fileLinks,
  files,
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
 * текст и модули новостей, вторая ссылка файла и перенос задвоенных чеков — изоляция организаций, права
 * роли приложения и защита базы. Правила модулей проверяют задачи потоков, которые их делают.
 */

const code = (c: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code: c }) });
const denied = code('42501');
const checkFailed = code('23514');
const fkFailed = code('23503');
const fileCheck = expect.objectContaining({
  cause: expect.objectContaining({ code: '23514', constraint_name: 'file_links_file_check' }),
});

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

describe.skipIf(!databaseAvailable())(
  'Пакет 16.11: колокольчик, новости, вторая ссылка файла',
  () => {
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

    /** Принятый отправленный файл: чек контрагента, лёгший в его файлы (`file_id`). */
    const acceptedSent = async (fileId: string) => {
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
        decidedAt: new Date(),
        fileId,
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
        // Положивший (владелец) строку не видит и не отмечает; получатель видит.
        expect(
          await inA((tx) =>
            tx.select().from(bellNotifications).where(eq(bellNotifications.eventKey, row.eventKey)),
          ),
        ).toEqual([]);
        const marked = await inA((tx) =>
          tx
            .update(bellNotifications)
            .set({ seenAt: new Date() })
            .where(eq(bellNotifications.eventKey, row.eventKey))
            .returning({ id: bellNotifications.id }),
        );
        expect(marked).toEqual([]);
        const mine = await asColleague((tx) =>
          tx
            .select({ orgId: bellNotifications.orgId, text: bellNotifications.text })
            .from(bellNotifications)
            .where(eq(bellNotifications.eventKey, row.eventKey)),
        );
        expect(mine).toEqual([{ orgId: a.orgId, text: row.text }]);
      });

      it('получатель отмечает «просмотрено» и «прочитано», остальное не меняет', async () => {
        const row = bell(colleagueA);
        await inA((tx) => tx.insert(bellNotifications).values(row));
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

      it('чужая организация: не видна, не меняется, не удаляется и не создаётся', async () => {
        const row = bell(colleagueA);
        await inA((tx) => tx.insert(bellNotifications).values(row));
        await inB(async (tx) => {
          expect(await tx.select().from(bellNotifications)).toEqual([]);
          expect(
            await tx
              .delete(bellNotifications)
              .where(eq(bellNotifications.eventKey, row.eventKey))
              .returning(),
          ).toEqual([]);
        });
        expect(await asJob(b.orgId, (tx) => tx.select().from(bellNotifications))).toEqual([]);
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

      it('задача без пользователя видит строки своей организации и убирает старые', async () => {
        const row = bell(a.ownerUserId);
        await inA((tx) => tx.insert(bellNotifications).values(row));
        const seen = await asJob(a.orgId, (tx) =>
          tx.select({ k: bellNotifications.eventKey }).from(bellNotifications),
        );
        expect(seen).toEqual(expect.arrayContaining([{ k: row.eventKey }]));
        const removed = await asJob(a.orgId, (tx) =>
          tx
            .delete(bellNotifications)
            .where(eq(bellNotifications.eventKey, row.eventKey))
            .returning({ k: bellNotifications.eventKey }),
        );
        expect(removed).toEqual([{ k: row.eventKey }]);
        // Строка организации А с контрагентом организации А, но от задачи организации Б — нет.
        await expect(
          asJob(b.orgId, (tx) => tx.insert(bellNotifications).values(bell(a.ownerUserId))),
        ).rejects.toThrow(fkFailed);
      });

      it('проверки: вид кнопки, вид события, что открыть, право, текст', async () => {
        const bad: Partial<typeof bellNotifications.$inferInsert>[] = [
          { kind: 'all' },
          { event: 'Cp File' },
          { targetKind: 'contractor', targetId: null },
          { targetKind: null, targetId: cpA },
          { need: 'files.view' },
          { text: '' },
          { eventKey: '' },
        ];
        for (const over of bad) {
          await expect(
            inA((tx) => tx.insert(bellNotifications).values(bell(colleagueA, over))),
          ).rejects.toThrow(checkFailed);
        }
        await inA((tx) =>
          tx
            .insert(bellNotifications)
            .values(
              bell(colleagueA, {
                targetKind: null,
                targetId: null,
                contractorId: null,
                need: null,
              }),
            ),
        );
      });

      it('строки администратора платформы (без организации): только свои и только ему', async () => {
        const row = bell(adminId, {
          kind: 'other',
          event: 'lead',
          targetKind: 'lead',
          targetId: randomUUID(),
          contractorId: null,
          need: null,
          text: 'Новая заявка с лендинга',
        });
        await asAdmin((tx) => tx.insert(bellNotifications).values(row));
        const own = await asAdmin((tx) =>
          tx
            .select({ orgId: bellNotifications.orgId })
            .from(bellNotifications)
            .where(eq(bellNotifications.eventKey, row.eventKey)),
        );
        expect(own).toEqual([{ orgId: null }]);
        // Другому администратору — нет; сотрудник организации их не видит.
        await expect(
          asAdmin((tx) =>
            tx
              .insert(bellNotifications)
              .values({ ...row, userId: otherAdminId, eventKey: 'lead:x' }),
          ),
        ).rejects.toThrow(denied);
        expect(
          await withUserContext(db.app.db, otherAdminId, (tx) =>
            tx.select().from(bellNotifications).where(eq(bellNotifications.eventKey, row.eventKey)),
          ),
        ).toEqual([]);
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

      it('модули: по умолчанию пусто; коды модулей прототипа; неверный код и пустой элемент — нет', async () => {
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
        for (const modules of [['Cps'], ['cps', ''], ['cps,reports'], ['модуль']]) {
          await expect(
            asAdmin((tx) => tx.update(news).set({ modules }).where(eq(news.id, newsId))),
          ).rejects.toThrow(checkFailed);
        }
        // Пользователь организации видит новость вместе с модулями.
        const seen = await inA((tx) =>
          tx.select({ modules: news.modules }).from(news).where(eq(news.id, newsId)),
        );
        expect(seen).toEqual([{ modules: ['cps', 'reports', 'kb-news'] }]);
      });

      it('второй текст видит и пишет только администратор платформы; удаляется вместе с новостью', async () => {
        await asAdmin((tx) =>
          tx.insert(newsAdminTexts).values({ newsId, md: '- Миграция 0157', updatedBy: adminId }),
        );
        expect(
          await asAdmin((tx) => tx.select({ md: newsAdminTexts.md }).from(newsAdminTexts)),
        ).toEqual([{ md: '- Миграция 0157' }]);
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
            tx.update(newsAdminTexts).set({ md: '' }).where(eq(newsAdminTexts.newsId, newsId)),
          ),
        ).rejects.toThrow(checkFailed);
        await db.admin.db.delete(news).where(eq(news.id, newsId));
        expect(await db.admin.db.select().from(newsAdminTexts)).toEqual([]);
      });
    });

    describe('вторая ссылка файла (file_links)', () => {
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
            tx
              .insert(fileLinks)
              .values({
                fileId,
                sourceKind: 'fee_payment',
                sourceId: randomUUID(),
                createdBy: colleagueA,
              }),
          ),
        ).rejects.toThrow(denied);
        await expect(
          inA((tx) =>
            tx
              .update(fileLinks)
              .set({ sourceId: randomUUID() })
              .where(eq(fileLinks.fileId, fileId)),
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

      it('незагруженный файл, файл без контрагента, та же запись, что источник файла, и чужой вид — ошибка, а не пропуск', async () => {
        const pending = await readyFile({ state: 'pending' });
        const general = await readyFile({ contractorId: null });
        const ownReceipt = randomUUID();
        const receiptFile = await readyFile({ sourceKind: 'receipt', sourceId: ownReceipt });
        for (const fileId of [pending, general]) {
          await expect(
            inA((tx) =>
              tx
                .insert(fileLinks)
                .values({ fileId, sourceKind: 'receipt', sourceId: randomUUID() }),
            ),
          ).rejects.toThrow(fileCheck);
        }
        await expect(
          inA((tx) =>
            tx
              .insert(fileLinks)
              .values({ fileId: receiptFile, sourceKind: 'receipt', sourceId: ownReceipt }),
          ),
        ).rejects.toThrow(fileCheck);
        await expect(
          inA((tx) =>
            tx
              .insert(fileLinks)
              .values({ fileId: receiptFile, sourceKind: 'tax_payment', sourceId: randomUUID() }),
          ),
        ).rejects.toThrow(checkFailed);
        // Удалённый файл — тоже нет.
        const gone = await readyFile();
        await db.admin.db
          .update(files)
          .set({ state: 'deleted', deletedAt: new Date(), deletedBy: a.ownerUserId })
          .where(eq(files.id, gone));
        await expect(
          inA((tx) =>
            tx
              .insert(fileLinks)
              .values({ fileId: gone, sourceKind: 'receipt', sourceId: randomUUID() }),
          ),
        ).rejects.toThrow(fileCheck);
      });

      it('чужая организация: не видна, не удаляется, на чужой файл ссылку не поставить', async () => {
        const fileId = await readyFile();
        const receiptId = randomUUID();
        await inA((tx) =>
          tx.insert(fileLinks).values({ fileId, sourceKind: 'receipt', sourceId: receiptId }),
        );
        await inB(async (tx) => {
          expect(await tx.select().from(fileLinks)).toEqual([]);
          expect(
            await tx.delete(fileLinks).where(eq(fileLinks.fileId, fileId)).returning(),
          ).toEqual([]);
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
      });
    });

    describe('перенос задвоенных чеков (app.file_copies_merge)', () => {
      const merge = async () => {
        const [row] = await db.admin.db.execute<{ n: number }>(
          sql`select app.file_copies_merge() as n`,
        );
        return row!.n;
      };

      it('копия чека у поступления становится второй ссылкой оригинала, копия удаляется; повтор ничего не меняет', async () => {
        await db.admin.db.delete(fileLinks);
        const original = await readyFile({
          name: 'Чек_перевода.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 2048,
        });
        await acceptedSent(original);
        const receiptId = randomUUID();
        const copy = await readyFile({
          name: 'Чек_перевода.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 2048,
          sourceKind: 'receipt',
          sourceId: receiptId,
          createdBy: colleagueA,
        });
        // Не копия: другой размер; копия к оплате за обслуживание того же чека.
        const other = await readyFile({
          name: 'Чек_перевода.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 4096,
          sourceKind: 'receipt',
          sourceId: randomUUID(),
        });
        const feeId = randomUUID();
        const feeCopy = await readyFile({
          name: 'Чек_перевода.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 2048,
          sourceKind: 'fee_payment',
          sourceId: feeId,
        });
        expect(await merge()).toBe(2);
        const links = await db.admin.db
          .select({
            fileId: fileLinks.fileId,
            kind: fileLinks.sourceKind,
            id: fileLinks.sourceId,
            by: fileLinks.createdBy,
          })
          .from(fileLinks)
          .where(eq(fileLinks.fileId, original));
        expect(links).toEqual(
          expect.arrayContaining([
            { fileId: original, kind: 'receipt', id: receiptId, by: colleagueA },
            { fileId: original, kind: 'fee_payment', id: feeId, by: a.ownerUserId },
          ]),
        );
        expect(links).toHaveLength(2);
        const states = await db.admin.db
          .select({ id: files.id, state: files.state, by: files.deletedBy, key: files.storageKey })
          .from(files)
          .where(sql`${files.id} in (${original}, ${copy}, ${other}, ${feeCopy})`);
        const byId = new Map(states.map((s) => [s.id, s]));
        expect(byId.get(original)?.state).toBe('ready');
        expect(byId.get(other)?.state).toBe('ready');
        expect(byId.get(copy)).toMatchObject({ state: 'deleted', by: colleagueA });
        expect(byId.get(feeCopy)).toMatchObject({ state: 'deleted', by: a.ownerUserId });
        // Объекты копий хранилища удалит задача повторного удаления.
        const keys = await db.admin.db
          .select({ key: storageDeleteRetries.key })
          .from(storageDeleteRetries);
        expect(keys.map((k) => k.key)).toEqual(
          expect.arrayContaining([byId.get(copy)!.key, byId.get(feeCopy)!.key]),
        );
        expect(keys.map((k) => k.key)).not.toContain(byId.get(original)!.key);
        expect(await merge()).toBe(0);
      });

      it('копия, подходящая к двум оригиналам, и копия другого контрагента не трогаются', async () => {
        const first = await readyFile({
          name: 'Скрин.png',
          contentType: 'image/png',
          sizeBytes: 777,
        });
        const second = await readyFile({
          name: 'Скрин.png',
          contentType: 'image/png',
          sizeBytes: 777,
        });
        await acceptedSent(first);
        await acceptedSent(second);
        const ambiguous = await readyFile({
          name: 'Скрин.png',
          contentType: 'image/png',
          sizeBytes: 777,
          sourceKind: 'receipt',
          sourceId: randomUUID(),
        });
        const cpA2 = await inA((tx) =>
          createContractor(tx, a.orgId, contractor('03807819461917', 'ОсОО «А-2»'), null),
        );
        const foreign = await readyFile({
          name: 'Чек.pdf',
          sourceKind: 'receipt',
          sourceId: randomUUID(),
          contractorId: cpA2,
        });
        expect(await merge()).toBe(0);
        const left = await db.admin.db
          .select({ state: files.state })
          .from(files)
          .where(sql`${files.id} in (${ambiguous}, ${foreign})`);
        expect(left).toEqual([{ state: 'ready' }, { state: 'ready' }]);
      });

      it('роль приложения функцию переноса не зовёт', async () => {
        await expect(inA((tx) => tx.execute(sql`select app.file_copies_merge()`))).rejects.toThrow(
          denied,
        );
      });
    });
  },
);
