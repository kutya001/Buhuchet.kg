import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from './context';
import { enableContractorPage } from './contractor-page';
import { createContractor, type ContractorFields } from './contractors';
import { createOrganization, type CreatedOrganization } from './organizations';
import {
  contractorPages,
  contractorPayClaims,
  contractorSentFiles,
  contractorTelegramLinks,
  contractorTelegramMessages,
  files,
  organizations,
  orgTelegramNotices,
} from './schema';
import {
  createTestDatabase,
  databaseAvailable,
  seedAccessReference,
  seedAllPlatformDictionaries,
  type TestDatabase,
} from './testing';

/*
 * Общая основа пакета доработок 14.11.2026 (этап 0, миграция 0147): новые таблицы и поля — изоляция
 * организаций и права роли приложения. Правила модулей проверяют задачи потоков, которые их делают.
 */

const code = (c: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code: c }) });
const denied = code('42501');
const checkFailed = code('23514');
const duplicate = code('23505');

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

describe.skipIf(!databaseAvailable())('Пакет 14.11: новые таблицы и поля', () => {
  let db: TestDatabase;
  let a: CreatedOrganization;
  let b: CreatedOrganization;
  let cpA = '';
  let cpB = '';
  const inA = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: a.orgId, userId: a.ownerUserId }, fn);
  const inB = <T>(fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId: b.orgId, userId: b.ownerUserId }, fn);
  /** Страница контрагента и бот: контекст организации без пользователя. */
  const asGuest = <T>(orgId: string, fn: Parameters<typeof withOrgContext<T>>[2]) =>
    withOrgContext(db.app.db, { orgId, userId: null }, fn);

  const sentFile = (orgId: string, contractorId: string, over: Record<string, unknown> = {}) => {
    const id = randomUUID();
    return {
      id,
      orgId,
      contractorId,
      source: 'page' as const,
      comment: 'Акт сверки',
      name: 'Акт.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1200,
      storageKey: `org/${orgId}/sent/${id}`,
      ...over,
    };
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedAccessReference(db.admin.db);
    await seedAllPlatformDictionaries(db.admin.db);
    const owner = (login: string) => ({ fullName: 'Владелец', login, passwordHash: 'x' });
    a = await createOrganization(db.app.db, {
      name: 'Организация А',
      inn: '01811201810456',
      slug: 'p1411-a',
      owner: owner('p1411-owner-a'),
    });
    b = await createOrganization(db.app.db, {
      name: 'Организация Б',
      inn: '02811201810457',
      slug: 'p1411-b',
      owner: owner('p1411-owner-b'),
    });
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

  it('организация: «ОКПО» меняет владелец, «Форму» — нет; ОКПО — 8 цифр', async () => {
    await inA((tx) =>
      tx.update(organizations).set({ okpo: '12345678' }).where(eq(organizations.id, a.orgId)),
    );
    await expect(
      inA((tx) =>
        tx.update(organizations).set({ legalForm: 'ip' }).where(eq(organizations.id, a.orgId)),
      ),
    ).rejects.toThrow(denied);
    await expect(
      inA((tx) =>
        tx.update(organizations).set({ okpo: '1234567' }).where(eq(organizations.id, a.orgId)),
      ),
    ).rejects.toThrow(checkFailed);
    // Форму ставит администратор платформы (здесь — владелец базы).
    await db.admin.db
      .update(organizations)
      .set({ legalForm: 'osoo' })
      .where(eq(organizations.id, a.orgId));
    await expect(
      db.admin.db
        .update(organizations)
        .set({ legalForm: 'ooo' as 'ip' })
        .where(eq(organizations.id, a.orgId)),
    ).rejects.toThrow(checkFailed);
    const [row] = await db.admin.db
      .select({ okpo: organizations.okpo, legalForm: organizations.legalForm })
      .from(organizations)
      .where(eq(organizations.id, a.orgId));
    expect(row).toEqual({ okpo: '12345678', legalForm: 'osoo' });
  });

  it('документы и Telegram заявки, ссылки «задать пароль», темы бота: роли приложения недоступны', async () => {
    for (const table of [
      'platform_lead_docs',
      'platform_lead_tg_tokens',
      'password_setup_tokens',
    ]) {
      await expect(
        inA((tx) => tx.execute(sql.raw(`select 1 from public.${table}`))),
      ).rejects.toThrow(denied);
    }
    // Темы в чате с ботом удалены вместе с функциями.
    const [left] = await db.admin.db.execute<{ t: string | null; f: number }>(
      sql`select to_regclass('public.telegram_topics')::text as t,
        (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname like '%telegram_topic%') as f`,
    );
    expect(left).toEqual({ t: null, f: 0 });
  });

  it('«Контрагент может отправлять файлы»: по умолчанию включено, у контрагента меняет сотрудник', async () => {
    await inA((tx) => enableContractorPage(tx, cpA, '482915'));
    const flag = () =>
      inA((tx) =>
        tx
          .select({ on: contractorPages.filesUpload })
          .from(contractorPages)
          .where(eq(contractorPages.contractorId, cpA)),
      );
    expect(await flag()).toEqual([{ on: true }]);
    await inA((tx) =>
      tx
        .update(contractorPages)
        .set({ filesUpload: false })
        .where(eq(contractorPages.contractorId, cpA)),
    );
    expect(await flag()).toEqual([{ on: false }]);
    const [policy] = await db.admin.db.execute<{ on: boolean }>(
      sql`select cp_files_upload as on from org_settings where org_id = ${a.orgId}`,
    );
    expect(policy).toEqual({ on: true });
  });

  it('отправленные файлы: чужая организация не видна, не меняется и не создаётся', async () => {
    const mine = sentFile(a.orgId, cpA);
    await asGuest(a.orgId, (tx) => tx.insert(contractorSentFiles).values(mine));
    await inB(async (tx) => {
      expect(await tx.select().from(contractorSentFiles)).toEqual([]);
      const changed = await tx
        .update(contractorSentFiles)
        .set({ state: 'ready' })
        .where(eq(contractorSentFiles.id, mine.id))
        .returning();
      expect(changed).toEqual([]);
      expect(
        await tx.delete(contractorSentFiles).where(eq(contractorSentFiles.id, mine.id)).returning(),
      ).toEqual([]);
    });
    // Строка чужой организации и чужой контрагент не записываются.
    await expect(
      inB((tx) => tx.insert(contractorSentFiles).values(sentFile(a.orgId, cpA))),
    ).rejects.toThrow(denied);
    await expect(
      inB((tx) => tx.insert(contractorSentFiles).values(sentFile(b.orgId, cpA))),
    ).rejects.toThrow();
    expect(await db.app.db.select().from(contractorSentFiles)).toEqual([]);
    expect(await inA((tx) => tx.select().from(contractorSentFiles))).toHaveLength(1);
  });

  it('отправленные файлы: вставка только новой загрузки, решение — с причиной и автором, принятый не меняется', async () => {
    // Вставка сразу «готовым» или «принятым» — нет; ключ хранилища — только своей организации.
    await expect(
      asGuest(a.orgId, (tx) =>
        tx.insert(contractorSentFiles).values(sentFile(a.orgId, cpA, { state: 'ready' })),
      ),
    ).rejects.toThrow(denied);
    await expect(
      asGuest(a.orgId, (tx) =>
        tx.insert(contractorSentFiles).values({
          ...sentFile(a.orgId, cpA),
          storageKey: `org/${b.orgId}/sent/${randomUUID()}`,
        }),
      ),
    ).rejects.toThrow(checkFailed);
    // Из Telegram — с номером чата; со страницы — без него.
    await expect(
      asGuest(a.orgId, (tx) =>
        tx.insert(contractorSentFiles).values(sentFile(a.orgId, cpA, { source: 'telegram' })),
      ),
    ).rejects.toThrow(checkFailed);

    const f = sentFile(a.orgId, cpA, { source: 'telegram', tgChatId: 7001, senderName: '@client' });
    await asGuest(a.orgId, (tx) => tx.insert(contractorSentFiles).values(f));
    await asGuest(a.orgId, (tx) =>
      tx
        .update(contractorSentFiles)
        .set({ state: 'ready' })
        .where(eq(contractorSentFiles.id, f.id)),
    );
    // Имя файла и комментарий после отправки не меняются.
    await expect(
      inA((tx) =>
        tx
          .update(contractorSentFiles)
          .set({ comment: 'другой' })
          .where(eq(contractorSentFiles.id, f.id)),
      ),
    ).rejects.toThrow(denied);
    const now = new Date();
    // «Отклонить» без причины — нет; решение за другого — нет.
    await expect(
      inA((tx) =>
        tx
          .update(contractorSentFiles)
          .set({ status: 'rejected', decidedBy: a.ownerUserId, decidedAt: now })
          .where(eq(contractorSentFiles.id, f.id)),
      ),
    ).rejects.toThrow(checkFailed);
    await expect(
      asGuest(a.orgId, (tx) =>
        tx
          .update(contractorSentFiles)
          .set({
            status: 'rejected',
            rejectReason: 'Не тот файл',
            decidedBy: a.ownerUserId,
            decidedAt: now,
          })
          .where(eq(contractorSentFiles.id, f.id)),
      ),
    ).rejects.toThrow(denied);
    // «Принять» — только вместе с файлом контрагента своей организации.
    await expect(
      inA((tx) =>
        tx
          .update(contractorSentFiles)
          .set({ status: 'accepted', decidedBy: a.ownerUserId, decidedAt: now })
          .where(eq(contractorSentFiles.id, f.id)),
      ),
    ).rejects.toThrow(checkFailed);
    const fileId = randomUUID();
    await db.admin.db.insert(files).values({
      id: fileId,
      orgId: a.orgId,
      sourceKind: 'sent_file',
      sourceId: f.id,
      contractorId: cpA,
      name: 'Акт.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1200,
      storageKey: `org/${a.orgId}/files/${fileId}`,
      state: 'ready',
      createdBy: a.ownerUserId,
    });
    await inA((tx) =>
      tx
        .update(contractorSentFiles)
        .set({ status: 'accepted', decidedBy: a.ownerUserId, decidedAt: now, fileId })
        .where(eq(contractorSentFiles.id, f.id)),
    );
    // Принятый не меняется и не удаляется.
    await inA(async (tx) => {
      expect(
        await tx
          .update(contractorSentFiles)
          .set({ status: 'rejected', rejectReason: 'Передумал', fileId: null })
          .where(eq(contractorSentFiles.id, f.id))
          .returning(),
      ).toEqual([]);
      expect(
        await tx.delete(contractorSentFiles).where(eq(contractorSentFiles.id, f.id)).returning(),
      ).toEqual([]);
    });
  });

  it('«Я оплатил»: изоляция, вставка только ждущего, меняется только решение, чек удаляется — сообщение остаётся', async () => {
    const receipt = sentFile(a.orgId, cpA, { comment: 'Чек: налоги, 6 250,50 сом' });
    await asGuest(a.orgId, (tx) => tx.insert(contractorSentFiles).values(receipt));
    const [claim] = await asGuest(a.orgId, (tx) =>
      tx
        .insert(contractorPayClaims)
        .values({
          orgId: a.orgId,
          contractorId: cpA,
          source: 'page',
          purpose: 'tax',
          month: '2026-10',
          amount: 625_050,
          sentFileId: receipt.id,
        })
        .returning({ id: contractorPayClaims.id }),
    );
    // Сразу «принятым» — нет; чужой организации — нет; сумма — больше нуля.
    await expect(
      asGuest(a.orgId, (tx) =>
        tx.insert(contractorPayClaims).values({
          orgId: a.orgId,
          contractorId: cpA,
          source: 'page',
          purpose: 'fee',
          status: 'done',
          decidedAt: new Date(),
        }),
      ),
    ).rejects.toThrow(denied);
    await expect(
      inB((tx) =>
        tx
          .insert(contractorPayClaims)
          .values({ orgId: a.orgId, contractorId: cpA, source: 'page', purpose: 'tax' }),
      ),
    ).rejects.toThrow(denied);
    await expect(
      asGuest(a.orgId, (tx) =>
        tx
          .insert(contractorPayClaims)
          .values({ orgId: a.orgId, contractorId: cpA, source: 'page', purpose: 'tax', amount: 0 }),
      ),
    ).rejects.toThrow(checkFailed);
    // Чек — только отправленный файл своей организации.
    await expect(
      inB((tx) =>
        tx.insert(contractorPayClaims).values({
          orgId: b.orgId,
          contractorId: cpB,
          source: 'page',
          purpose: 'tax',
          sentFileId: receipt.id,
        }),
      ),
    ).rejects.toThrow();
    await inB(async (tx) => {
      expect(await tx.select().from(contractorPayClaims)).toEqual([]);
      expect(
        await tx
          .update(contractorPayClaims)
          .set({ status: 'done', decidedAt: new Date() })
          .where(eq(contractorPayClaims.id, claim!.id))
          .returning(),
      ).toEqual([]);
    });
    expect(await db.app.db.select().from(contractorPayClaims)).toEqual([]);
    // Сумму после отправки не поменять, строку не удалить; решение — можно.
    await expect(
      inA((tx) =>
        tx
          .update(contractorPayClaims)
          .set({ amount: 1 })
          .where(eq(contractorPayClaims.id, claim!.id)),
      ),
    ).rejects.toThrow(denied);
    await expect(
      inA((tx) => tx.delete(contractorPayClaims).where(eq(contractorPayClaims.id, claim!.id))),
    ).rejects.toThrow(denied);
    await inA((tx) =>
      tx
        .update(contractorPayClaims)
        .set({ status: 'done', decidedBy: a.ownerUserId, decidedAt: new Date() })
        .where(eq(contractorPayClaims.id, claim!.id)),
    );
    // Непринятый чек удалили через 30 дней — сообщение об оплате остаётся без чека.
    await inA((tx) => tx.delete(contractorSentFiles).where(eq(contractorSentFiles.id, receipt.id)));
    const [left] = await inA((tx) =>
      tx
        .select({ status: contractorPayClaims.status, sentFileId: contractorPayClaims.sentFileId })
        .from(contractorPayClaims)
        .where(eq(contractorPayClaims.id, claim!.id)),
    );
    expect(left).toEqual({ status: 'done', sentFileId: null });
  });

  it('«Оплата за обслуживание до …» — одно сообщение на чат в день; «Оплатил» — только своего контрагента', async () => {
    const link = async (orgId: string, contractorId: string, chatId: number) => {
      const [row] = await db.admin.db
        .insert(contractorTelegramLinks)
        .values({ orgId, contractorId, chatId, name: `@c${chatId}`, status: 'on' })
        .returning({ id: contractorTelegramLinks.id });
      return row!.id;
    };
    const linkA = await link(a.orgId, cpA, 7101);
    const linkB = await link(b.orgId, cpB, 7201);
    // Само сообщение уходит без пользователя (задача по расписанию): автора у него нет.
    const fee = (linkId: string, contractorId: string, chatId: number, day: string) => ({
      contractorId,
      linkId,
      chatId,
      kind: 'fee' as const,
      total: 150_000,
      day,
      payload: { text: 'Оплата за обслуживание до 01.12.2026' },
    });
    const [msg] = await asGuest(a.orgId, (tx) =>
      tx
        .insert(contractorTelegramMessages)
        .values({ orgId: a.orgId, ...fee(linkA, cpA, 7101, '2026-11-26') })
        .returning({ id: contractorTelegramMessages.id }),
    );
    // Второе в тот же день, в том числе ручное, — нет.
    await expect(
      inA((tx) =>
        tx.insert(contractorTelegramMessages).values({
          orgId: a.orgId,
          ...fee(linkA, cpA, 7101, '2026-11-26'),
          sentBy: a.ownerUserId,
        }),
      ),
    ).rejects.toThrow(duplicate);
    // Без дня — нет.
    await expect(
      asGuest(a.orgId, (tx) =>
        tx
          .insert(contractorTelegramMessages)
          .values({ orgId: a.orgId, ...fee(linkA, cpA, 7101, '2026-11-27'), day: null }),
      ),
    ).rejects.toThrow(checkFailed);
    await asGuest(b.orgId, (tx) =>
      tx
        .insert(contractorTelegramMessages)
        .values({ orgId: b.orgId, ...fee(linkB, cpB, 7201, '2026-11-26') }),
    );
    // «Оплатил» под чужим сообщением не записать: сообщение — своего контрагента своей организации.
    await expect(
      inB((tx) =>
        tx.insert(contractorPayClaims).values({
          orgId: b.orgId,
          contractorId: cpB,
          source: 'telegram',
          purpose: 'fee',
          amount: 150_000,
          tgMessageId: msg!.id,
        }),
      ),
    ).rejects.toThrow();
    await asGuest(a.orgId, (tx) =>
      tx.insert(contractorPayClaims).values({
        orgId: a.orgId,
        contractorId: cpA,
        source: 'telegram',
        purpose: 'fee',
        amount: 150_000,
        tgMessageId: msg!.id,
      }),
    );
    // Со страницы — без сообщения бота.
    await expect(
      asGuest(a.orgId, (tx) =>
        tx.insert(contractorPayClaims).values({
          orgId: a.orgId,
          contractorId: cpA,
          source: 'page',
          purpose: 'fee',
          tgMessageId: msg!.id,
        }),
      ),
    ).rejects.toThrow(checkFailed);
  });

  it('строки «Telegram-уведомления»: изоляция и допустимые дни, день недели, час', async () => {
    await inA((tx) =>
      tx.insert(orgTelegramNotices).values([
        { orgId: a.orgId, code: 'staff_week', weekday: 1, updatedBy: a.ownerUserId },
        { orgId: a.orgId, code: 'cp_pay', days: [5, 3], atTime: '10:00' },
        { orgId: a.orgId, code: 'cp_fee', days: [5], weekday: 1, atTime: '10:00' },
      ]),
    );
    for (const bad of [
      { code: 'cp_pay' as const, days: [6], atTime: '10:00' },
      { code: 'cp_pay' as const, days: [5], weekday: 1, atTime: '10:00' },
      { code: 'cp_fee' as const, days: [5], weekday: 8, atTime: '10:00' },
      { code: 'cp_fee' as const, days: [5] },
      { code: 'staff_week' as const, days: [1], weekday: 1 },
    ]) {
      await expect(
        inB((tx) => tx.insert(orgTelegramNotices).values({ orgId: b.orgId, ...bad })),
      ).rejects.toThrow(checkFailed);
    }
    await inB(async (tx) => {
      expect(await tx.select().from(orgTelegramNotices)).toEqual([]);
      expect(
        await tx
          .update(orgTelegramNotices)
          .set({ days: [1] })
          .where(and(eq(orgTelegramNotices.orgId, a.orgId), eq(orgTelegramNotices.code, 'cp_pay')))
          .returning(),
      ).toEqual([]);
    });
    await expect(
      inB((tx) =>
        tx
          .insert(orgTelegramNotices)
          .values({ orgId: a.orgId, code: 'cp_fee', days: [1], atTime: '09:00' }),
      ),
    ).rejects.toThrow(denied);
    // Автор правки — сотрудник своей организации.
    await expect(
      inB((tx) =>
        tx
          .insert(orgTelegramNotices)
          .values({ orgId: b.orgId, code: 'staff_week', weekday: 2, updatedBy: a.ownerUserId }),
      ),
    ).rejects.toThrow();
    expect(await db.app.db.select().from(orgTelegramNotices)).toEqual([]);
    expect(await inA((tx) => tx.select().from(orgTelegramNotices))).toHaveLength(3);
  });
});
